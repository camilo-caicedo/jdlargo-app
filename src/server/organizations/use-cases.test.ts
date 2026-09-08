import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { withUserContext } from '../db/client';
import {
  createOrganizationWithAdmin,
  grantMembership,
  listMembers,
  revokeMembership,
} from './use-cases';



const directUrl = process.env.DIRECT_URL;
const adminSql = postgres(directUrl || '');

// Helpers for test setup
async function createTestAuthUser(email: string, name: string): Promise<string> {
  const res = await adminSql`
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      ${email},
      'fake_encrypted_pw',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      ${JSON.stringify({ name })}::jsonb,
      now(),
      now()
    ) RETURNING id
  `;
  return res[0].id;
}

const TEST_ORG_NAMES = [
  'Transportes Ficticios S.A.S.',
  'Alfa Ficticia S.A.S.',
  'Beta Ficticia S.A.S.',
  'Empresa Privada S.A.S.',
  'Alfa Org',
  'Beta Org',
  'Mi Empresa Original',
  'Empresa Retiro S.A.S.',
];

async function cleanupTestData() {
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu001.com')
  `;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu001.com')
  `;
  await adminSql`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.role_permissions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.roles
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.configuration_versions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.organizations
    WHERE name IN ${adminSql(TEST_ORG_NAMES)}
  `;
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu001.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu001.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-001: Organizaciones, cuentas de usuario y pertenencia', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  });

  it('Escenario: Crear una organización cliente con su primer miembro', async () => {
    const userEmail = 'first-admin@test-hu001.com';
    const userName = 'Primer Admin';
    const userId = await createTestAuthUser(userEmail, userName);

    const origin = { ip: '127.0.0.1', userAgent: 'vitest' };
    const org = await createOrganizationWithAdmin(userId, {
      name: 'Transportes Ficticios S.A.S.',
      slug: 'transportes-ficticios',
      taxId: '900.123.456-1',
      origin,
    });

    expect(org).toBeDefined();
    expect(org.id).toBeDefined();
    expect(org.name).toBe('Transportes Ficticios S.A.S.');
    expect(org.slug).toBe('transportes-ficticios');

    // Verificar que el usuario queda como miembro con rol 'admin'
    const members = await listMembers(userId, org.id);
    expect(members).toHaveLength(1);
    expect(members[0].membership.userId).toBe(userId);
    expect(members[0].membership.role).toBe('admin');
    expect(members[0].membership.status).toBe('active');

    // Verificar que la creación queda registrada en la bitácora
    const logs = await withUserContext(userId, async (tx) => {
      return tx.execute(sql`select * from audit_log where organization_id = ${org.id}`);
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const creationLog = (logs as unknown as Array<{ action: string; actor_user_id: string; origin: unknown }>).find((l) => l.action === 'organization.created');
    expect(creationLog).toBeDefined();
    expect(creationLog!.actor_user_id).toBe(userId);
    expect(creationLog!.origin).toMatchObject(origin);
  });

  it('Escenario: Un usuario pertenece a dos organizaciones clientes con roles distintos', async () => {
    const adminA = await createTestAuthUser('admin-a@test-hu001.com', 'Admin Alfa');
    const adminB = await createTestAuthUser('admin-b@test-hu001.com', 'Admin Beta');
    const consultant = await createTestAuthUser('consultant@test-hu001.com', 'Consultor Externo');

    const orgAlfa = await createOrganizationWithAdmin(adminA, { name: 'Alfa Ficticia S.A.S.', slug: 'alfa-ficticia' });
    const orgBeta = await createOrganizationWithAdmin(adminB, { name: 'Beta Ficticia S.A.S.', slug: 'beta-ficticia' });

    // Se le otorga membresía en Alfa con compliance_analyst y en Beta con auditor
    const memAlfa = await grantMembership(adminA, {
      organizationId: orgAlfa.id,
      userId: consultant,
      role: 'compliance_analyst',
    });
    const memBeta = await grantMembership(adminB, {
      organizationId: orgBeta.id,
      userId: consultant,
      role: 'auditor',
    });

    expect(memAlfa.organizationId).toBe(orgAlfa.id);
    expect(memAlfa.role).toBe('compliance_analyst');

    expect(memBeta.organizationId).toBe(orgBeta.id);
    expect(memBeta.role).toBe('auditor');

    // Membresías independientes
    expect(memAlfa.id).not.toBe(memBeta.id);
  });

  it('Escenario: Autenticarse no otorga por sí solo acceso a ninguna organización cliente', async () => {
    const standaloneUser = await createTestAuthUser('lonely@test-hu001.com', 'Usuario Sin Membresía');
    const adminUser = await createTestAuthUser('org-owner@test-hu001.com', 'Org Owner');
    const org = await createOrganizationWithAdmin(adminUser, { name: 'Empresa Privada S.A.S.', slug: 'empresa-privada' });

    // Intento de leer miembros con contexto de usuario sin membresía
    await expect(listMembers(standaloneUser, org.id)).rejects.toThrow();

    // Intento de escribir membresía con contexto de usuario sin membresía
    await expect(
      grantMembership(standaloneUser, {
        organizationId: org.id,
        userId: standaloneUser,
        role: 'auditor',
      })
    ).rejects.toThrow();
  });

  it('Escenario: Aislamiento entre organizaciones sobre las tablas de esta historia', async () => {
    const userAlfaAdmin = await createTestAuthUser('alfa-admin@test-hu001.com', 'Alfa Admin');
    const userBetaAdmin = await createTestAuthUser('beta-admin@test-hu001.com', 'Beta Admin');

    const orgAlfa = await createOrganizationWithAdmin(userAlfaAdmin, { name: 'Alfa Org', slug: 'alfa-org' });
    const orgBeta = await createOrganizationWithAdmin(userBetaAdmin, { name: 'Beta Org', slug: 'beta-org' });

    // Consulta miembros de Alfa con contexto de userAlfaAdmin -> solo ve Alfa
    const membersAlfa = await listMembers(userAlfaAdmin, orgAlfa.id);
    expect(membersAlfa).toHaveLength(1);
    expect(membersAlfa[0].membership.organizationId).toBe(orgAlfa.id);

    // Consulta miembros de Beta con contexto de userAlfaAdmin -> rechazado por RLS (vacío o error)
    await expect(listMembers(userAlfaAdmin, orgBeta.id)).rejects.toThrow();

    // Intento de userAlfaAdmin de agregar un miembro a Beta Org -> rechazado por política de BD
    const thirdUser = await createTestAuthUser('third@test-hu001.com', 'Tercero');
    await expect(
      grantMembership(userAlfaAdmin, {
        organizationId: orgBeta.id,
        userId: thirdUser,
        role: 'compliance_analyst',
      })
    ).rejects.toThrow();
  });

  it('Escenario: El slug de la organización debe ser único en la plataforma', async () => {
    const user1 = await createTestAuthUser('slug-admin1@test-hu001.com', 'Slug Admin 1');
    const user2 = await createTestAuthUser('slug-admin2@test-hu001.com', 'Slug Admin 2');

    // Primera organización con slug 'mi-empresa'
    const org1 = await createOrganizationWithAdmin(user1, {
      name: 'Mi Empresa Original',
      slug: 'mi-empresa',
    });
    expect(org1.slug).toBe('mi-empresa');

    // Intento de crear otra organización con el mismo slug (incluso con nombre distinto)
    await expect(
      createOrganizationWithAdmin(user2, {
        name: 'Otra Empresa Con Mismo Slug',
        slug: 'mi-empresa',
      }),
    ).rejects.toMatchObject({
      code: 'DUPLICATE_ORG_SLUG',
    });

    // Caso feliz: dos organizaciones con el MISMO nombre pero slugs distintos sí se permiten
    const org3 = await createOrganizationWithAdmin(user2, {
      name: 'Mi Empresa Original', // Mismo nombre que org1
      slug: 'mi-empresa-sucursal', // Slug diferente
    });
    expect(org3.name).toBe(org1.name);
    expect(org3.slug).toBe('mi-empresa-sucursal');
  });

  it('Escenario: Retirar a un miembro no borra lo que ya hizo', async () => {
    const admin = await createTestAuthUser('admin-retire@test-hu001.com', 'Admin Org');
    const member = await createTestAuthUser('member-to-retire@test-hu001.com', 'Miembro A Retirar');

    const org = await createOrganizationWithAdmin(admin, { name: 'Empresa Retiro S.A.S.', slug: 'empresa-retiro' });

    const mem = await grantMembership(admin, {
      organizationId: org.id,
      userId: member,
      role: 'compliance_analyst',
    });

    // Se revoca membresía
    const revoked = await revokeMembership(admin, {
      organizationId: org.id,
      membershipId: mem.id,
    });
    expect(revoked.status).toBe('revoked');

    // Miembro retirado ya no puede leer datos de la organización
    await expect(listMembers(member, org.id)).rejects.toThrow();

    // Las entradas de bitácora siguen existiendo y la revocación quedó registrada
    const logs = await withUserContext(admin, async (tx) => {
      return tx.execute(sql`select * from audit_log where organization_id = ${org.id}`);
    });
    const revocationLog = (logs as unknown as Array<{ action: string; actor_user_id: string }>).find((l) => l.action === 'membership.revoked');
    expect(revocationLog).toBeDefined();
    expect(revocationLog!.actor_user_id).toBe(admin);
  });
});