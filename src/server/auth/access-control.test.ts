import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { withTenantContext } from '../db/client';
import { createOrganizationWithAdmin, grantMembership } from '../organizations/use-cases';
import { seedBaseConfiguration, publishConfigurationVersion, BASE_ROLES_TEMPLATE } from './role-config';
import { checkUserPermission, enforceUserPermission } from './access-control';
import { configurationVersions, roles, rolePermissions } from '../db/schema';

const directUrl = process.env.DIRECT_URL;
const adminSql = postgres(directUrl || '');

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
  'Empresa Base S.A.S.',
  'Alfa Ficticia S.A.S.',
  'Alfa Ficticia S.A.S. Matriz',
  'Beta Ficticia S.A.S. Matriz',
  'Alfa Isolation Org',
  'Beta Isolation Org',
  'Audit Test S.A.S.',
  'Auditor Org S.A.S.',
];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu003.com')
  `;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu003.com')
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
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu003.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu003.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-003: Permisos por rol como configuración de la organización', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  });

  it('Escenario: Cargar la matriz base como datos de la organización cliente', async () => {
    const adminUser = await createTestAuthUser('admin1@test-hu003.com', 'Admin Org 1');
    const org = await createOrganizationWithAdmin(adminUser, { name: 'Empresa Base S.A.S.' });

    // Carga la configuración inicial como datos en la base de datos
    await seedBaseConfiguration(org.id, adminUser);

    // Consulta los roles creados en base de datos
    const dbRoles = await adminSql<{ name: string; code: string }[]>`
      SELECT name, code FROM public.roles WHERE organization_id = ${org.id}
    `;

    // Existen los roles: Administrador, Oficial de Cumplimiento, Analista de Cumplimiento, Revisor, Auditor y Usuario operativo
    const roleNames = dbRoles.map((r) => r.name);
    expect(roleNames).toContain('Administrador');
    expect(roleNames).toContain('Oficial de Cumplimiento');
    expect(roleNames).toContain('Analista de Cumplimiento');
    expect(roleNames).toContain('Revisor / Aprobador');
    expect(roleNames).toContain('Auditor / Consulta');
    expect(roleNames).toContain('Usuario operativo');

    // Cada permiso de cada rol es una fila de configuración en la tabla role_permissions
    const dbPerms = await adminSql<{ count: string }[]>`
      SELECT count(*) as count FROM public.role_permissions WHERE organization_id = ${org.id}
    `;
    expect(Number(dbPerms[0].count)).toBeGreaterThan(15);
  });

  it('Escenario: Ajustar la matriz sin desplegar el producto', async () => {
    const adminUser = await createTestAuthUser('admin-alfa@test-hu003.com', 'Admin Alfa');
    const analystUser = await createTestAuthUser('analyst-alfa@test-hu003.com', 'Analyst Alfa');
    const orgAlfa = await createOrganizationWithAdmin(adminUser, { name: 'Alfa Ficticia S.A.S.' });

    // Se carga versión base (donde compliance_analyst no tiene 'dossier:approve')
    await seedBaseConfiguration(orgAlfa.id, adminUser);
    await grantMembership(adminUser, {
      organizationId: orgAlfa.id,
      userId: analystUser,
      role: 'compliance_analyst',
    });

    // 1. Verificación inicial: Analista de cumplimiento NO puede aprobar
    const initialCheck = await checkUserPermission(analystUser, orgAlfa.id, 'dossier:approve');
    expect(initialCheck.granted).toBe(false);

    // 2. Administrador publica una nueva versión donde ese rol SÍ puede aprobar
    const customRoles = BASE_ROLES_TEMPLATE.map((r) => {
      if (r.code === 'compliance_analyst') {
        return {
          ...r,
          permissions: [...r.permissions, 'dossier:approve' as const],
        };
      }
      return { ...r, permissions: [...r.permissions] };
    });

    const { versionNumber } = await publishConfigurationVersion({
      organizationId: orgAlfa.id,
      publishedBy: adminUser,
      reason: 'Política interna autoriza a analistas a aprobar expedientes',
      rolesConfig: customRoles,
    });

    expect(versionNumber).toBe('2');

    // 3. Los usuarios con ese rol en esa organización pueden aprobar desde ese momento
    const updatedCheck = await checkUserPermission(analystUser, orgAlfa.id, 'dossier:approve');
    expect(updatedCheck.granted).toBe(true);
    expect(updatedCheck.configurationVersionNumber).toBe('2');

    // 4. El cambio queda registrado en la bitácora con quién lo publicó, cuándo y qué versión quedó vigente
    const publishLogs = await adminSql<{ action: string; metadata: Record<string, unknown> | null; actor_user_id: string }[]>`
      SELECT action, metadata, actor_user_id
      FROM public.audit_log
      WHERE organization_id = ${orgAlfa.id}
        AND action = 'configuration.published'
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    expect(publishLogs).toHaveLength(1);
    expect(publishLogs[0].actor_user_id).toBe(adminUser);
    expect(publishLogs[0].metadata?.version_number).toBe('2');
  });

  it('Escenario: La matriz de una organización cliente no afecta a otra', async () => {
    const adminAlfa = await createTestAuthUser('admin-a@test-hu003.com', 'Admin A');
    const adminBeta = await createTestAuthUser('admin-b@test-hu003.com', 'Admin B');
    const sharedAnalyst = await createTestAuthUser('shared-analyst@test-hu003.com', 'Shared Analyst');

    const orgAlfa = await createOrganizationWithAdmin(adminAlfa, { name: 'Alfa Ficticia S.A.S. Matriz' });
    const orgBeta = await createOrganizationWithAdmin(adminBeta, { name: 'Beta Ficticia S.A.S. Matriz' });

    // En Alfa el analista SÍ puede aprobar
    await publishConfigurationVersion({
      organizationId: orgAlfa.id,
      publishedBy: adminAlfa,
      reason: 'Alfa permite aprobar a analistas',
      rolesConfig: BASE_ROLES_TEMPLATE.map((r) =>
        r.code === 'compliance_analyst'
          ? { ...r, permissions: [...r.permissions, 'dossier:approve' as const] }
          : { ...r, permissions: [...r.permissions] },
      ),
    });

    // En Beta el analista NO puede aprobar (versión base estándar)
    await seedBaseConfiguration(orgBeta.id, adminBeta);

    // Mismo usuario pertenece a ambas organizaciones como compliance_analyst
    await grantMembership(adminAlfa, {
      organizationId: orgAlfa.id,
      userId: sharedAnalyst,
      role: 'compliance_analyst',
    });
    await grantMembership(adminBeta, {
      organizationId: orgBeta.id,
      userId: sharedAnalyst,
      role: 'compliance_analyst',
    });

    // Evaluación en Alfa: permitido
    const alfaCheck = await checkUserPermission(sharedAnalyst, orgAlfa.id, 'dossier:approve');
    expect(alfaCheck.granted).toBe(true);

    // Evaluación en Beta: rechazada
    const betaCheck = await checkUserPermission(sharedAnalyst, orgBeta.id, 'dossier:approve');
    expect(betaCheck.granted).toBe(false);
  });

  it('Escenario: Aislamiento entre organizaciones sobre las tablas de configuración de acceso', async () => {
    const adminAlfa = await createTestAuthUser('iso-admin-a@test-hu003.com', 'Iso Admin A');
    const adminBeta = await createTestAuthUser('iso-admin-b@test-hu003.com', 'Iso Admin B');

    const orgAlfa = await createOrganizationWithAdmin(adminAlfa, { name: 'Alfa Isolation Org' });
    const orgBeta = await createOrganizationWithAdmin(adminBeta, { name: 'Beta Isolation Org' });

    await seedBaseConfiguration(orgAlfa.id, adminAlfa);
    await seedBaseConfiguration(orgBeta.id, adminBeta);

    // 1. Con contexto de Alfa, solo se ven roles y configuraciones de Alfa
    await withTenantContext(
      { userId: adminAlfa, organizationId: orgAlfa.id },
      async (tx) => {
        const rolesAlfa = await tx.select().from(roles);
        expect(rolesAlfa.length).toBeGreaterThan(0);
        for (const r of rolesAlfa) {
          expect(r.organizationId).toBe(orgAlfa.id);
        }

        const permsAlfa = await tx.select().from(rolePermissions);
        expect(permsAlfa.length).toBeGreaterThan(0);
        for (const p of permsAlfa) {
          expect(p.organizationId).toBe(orgAlfa.id);
        }

        const versionsAlfa = await tx.select().from(configurationVersions);
        expect(versionsAlfa.length).toBeGreaterThan(0);
        for (const v of versionsAlfa) {
          expect(v.organizationId).toBe(orgAlfa.id);
        }
      },
    );

    // 2. Un intento de modificar o insertar en la matriz de Beta con contexto de Alfa es rechazado por RLS
    const [betaVersion] = await adminSql<{ id: string }[]>`
      SELECT id FROM public.configuration_versions WHERE organization_id = ${orgBeta.id} LIMIT 1
    `;

    await expect(
      withTenantContext(
        { userId: adminAlfa, organizationId: orgAlfa.id },
        async (tx) => {
          return tx.execute(
            sql`INSERT INTO public.roles (organization_id, configuration_version_id, name, code)
                VALUES (${orgBeta.id}, ${betaVersion.id}, 'Hacker Role', 'hacker')`
          );
        },
      ),
    ).rejects.toThrow();
  });

  it('Escenario: Una acción sin permiso se rechaza y queda registrada', async () => {
    const admin = await createTestAuthUser('admin-audit@test-hu003.com', 'Admin Audit');
    const analyst = await createTestAuthUser('analyst-audit@test-hu003.com', 'Analyst Audit');
    const org = await createOrganizationWithAdmin(admin, { name: 'Audit Test S.A.S.' });

    await seedBaseConfiguration(org.id, admin);
    await grantMembership(admin, {
      organizationId: org.id,
      userId: analyst,
      role: 'compliance_analyst',
    });

    // Intenta ejecutar acción que requiere 'dossier:approve'
    await expect(
      enforceUserPermission(
        { userId: analyst, organizationId: org.id },
        'dossier:approve',
        { dossierId: 'dossier-123' },
      ),
    ).rejects.toThrow(/Acción no autorizada/);

    // La bitácora registra el intento con el usuario, la acción pretendida y la versión de configuración con la que se evaluó
    const logs = await adminSql<{ action: string; metadata: Record<string, unknown> | null; actor_user_id: string }[]>`
      SELECT action, metadata, actor_user_id
      FROM public.audit_log
      WHERE organization_id = ${org.id}
        AND action = 'security.permission_denied'
      ORDER BY occurred_at DESC
      LIMIT 1
    `;

    expect(logs).toHaveLength(1);
    expect(logs[0].actor_user_id).toBe(analyst);
    expect(logs[0].metadata?.attempted_action).toBe('dossier:approve');
    expect(logs[0].metadata?.configuration_version_number).toBe('1');
  });

  it('Escenario: El Auditor solo consulta', async () => {
    const admin = await createTestAuthUser('admin-aud@test-hu003.com', 'Admin Aud');
    const auditor = await createTestAuthUser('auditor-user@test-hu003.com', 'Auditor User');
    const org = await createOrganizationWithAdmin(admin, { name: 'Auditor Org S.A.S.' });

    await seedBaseConfiguration(org.id, admin);
    await grantMembership(admin, {
      organizationId: org.id,
      userId: auditor,
      role: 'auditor',
    });

    // 1. Auditor puede consultar la bitácora de la organización
    const auditPerm = await checkUserPermission(auditor, org.id, 'audit:view');
    expect(auditPerm.granted).toBe(true);

    const dossierViewPerm = await checkUserPermission(auditor, org.id, 'dossier:view');
    expect(dossierViewPerm.granted).toBe(true);

    // 2. Cualquier intento suyo de escribir o aprobar sobre el dominio es denegado
    const approvePerm = await checkUserPermission(auditor, org.id, 'dossier:approve');
    expect(approvePerm.granted).toBe(false);

    const editPerm = await checkUserPermission(auditor, org.id, 'risk_methodology:edit');
    expect(editPerm.granted).toBe(false);

    await expect(
      enforceUserPermission(
        { userId: auditor, organizationId: org.id },
        'dossier:approve',
      ),
    ).rejects.toThrow(/Acción no autorizada/);
  });

  it('Verifica que los roles operativos por defecto cuentan con el permiso dossier:edit', async () => {
    const operationalRoles = ['admin', 'compliance_analyst', 'operational_user'];
    for (const code of operationalRoles) {
      const role = BASE_ROLES_TEMPLATE.find((r) => r.code === code);
      expect(role).toBeDefined();
      expect(
        role?.permissions,
        `El rol operativo '${code}' debe incluir el permiso 'dossier:edit'`,
      ).toContain('dossier:edit');
    }

    // Roles de solo lectura o revisión externa no deben tener dossier:edit
    const readOnlyRoles = ['reviewer', 'auditor'];
    for (const code of readOnlyRoles) {
      const role = BASE_ROLES_TEMPLATE.find((r) => r.code === code);
      expect(role).toBeDefined();
      expect(role?.permissions).not.toContain('dossier:edit');
    }
  });
});
