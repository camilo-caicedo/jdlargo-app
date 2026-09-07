import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { db, withTenantContext } from './client';
import { auditDomainTables } from './isolation-runner';
import { executePrivilegedSystemOperation } from '../privileged/system-execution';
import { createOrganizationWithAdmin } from '../organizations/use-cases';

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

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`DELETE FROM public.audit_log`;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`DELETE FROM public.memberships`;
  await adminSql`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`DELETE FROM public.role_permissions`;
  await adminSql`DELETE FROM public.roles`;
  await adminSql`DELETE FROM public.configuration_versions`;
  await adminSql`DELETE FROM public.organizations`;
  await adminSql`DELETE FROM public.users`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu002.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-002: Aislamiento entre organizaciones con contexto de usuario', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  });

  it('Escenario: Una consulta con contexto de usuario solo devuelve lo de su organización cliente', async () => {
    const userAlfa = await createTestAuthUser('user-alfa@test-hu002.com', 'Usuario Alfa');
    const userBeta = await createTestAuthUser('user-beta@test-hu002.com', 'Usuario Beta');

    const orgAlfa = await createOrganizationWithAdmin(userAlfa, { name: 'Alfa Ficticia S.A.S.' });
    const orgBeta = await createOrganizationWithAdmin(userBeta, { name: 'Beta Ficticia S.A.S.' });

    // Consulta con contexto de usuario Alfa propagado (without application-level org filter)
    const logsAlfa = await withTenantContext(
      { userId: userAlfa, organizationId: orgAlfa.id },
      async (tx) => {
        return tx.execute<{ id: string; organization_id: string }>(
          sql`SELECT id, organization_id FROM public.audit_log`
        );
      },
    );

    // Obtiene únicamente filas de Alfa
    expect(logsAlfa.length).toBeGreaterThanOrEqual(1);
    for (const row of logsAlfa) {
      expect(row.organization_id).toBe(orgAlfa.id);
      expect(row.organization_id).not.toBe(orgBeta.id);
    }
  });

  it('Escenario: Escribir en otra organización cliente es rechazado por la base de datos', async () => {
    const userAlfa = await createTestAuthUser('writer-alfa@test-hu002.com', 'Writer Alfa');
    const userBeta = await createTestAuthUser('owner-beta@test-hu002.com', 'Owner Beta');
    const thirdUser = await createTestAuthUser('third-hu002@test-hu002.com', 'Third User');

    const orgAlfa = await createOrganizationWithAdmin(userAlfa, { name: 'Alfa Org Two' });
    const orgBeta = await createOrganizationWithAdmin(userBeta, { name: 'Beta Org Two' });

    // Intento directo a nivel SQL de insertar membresía en Beta con contexto de Alfa (sin filtro en TS)
    await expect(
      withTenantContext(
        { userId: userAlfa, organizationId: orgAlfa.id },
        async (tx) => {
          return tx.execute(
            sql`INSERT INTO public.memberships (organization_id, user_id, role, status)
                VALUES (${orgBeta.id}, ${thirdUser}, 'compliance_analyst', 'active')`
          );
        },
      ),
    ).rejects.toThrow();

    // Intento de escribir en tablas gobernadas por current_org_id() (configuration_versions)
    await expect(
      withTenantContext(
        { userId: userAlfa, organizationId: orgAlfa.id },
        async (tx) => {
          return tx.execute(
            sql`INSERT INTO public.configuration_versions (organization_id, version_number, status)
                VALUES (${orgBeta.id}, '99', 'draft')`
          );
        },
      ),
    ).rejects.toThrow();
  });

  it('Escenario: Sin contexto de usuario no se ve nada', async () => {
    const user = await createTestAuthUser('someone@test-hu002.com', 'Alguien');
    await createOrganizationWithAdmin(user, { name: 'Org With Rows' });

    // Consulta sin contexto de usuario / rol anon (sin claims ni org id)
    const rawResult = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role anon`);
      return tx.execute<{ count: string }>(
        sql`SELECT count(*) as count FROM public.audit_log`
      );
    });

    expect(Number(rawResult[0].count)).toBe(0);
  });

  it('Escenario: Prueba de aislamiento obligatoria por tabla', async () => {
    // Inspecciona catálogo de base de datos Postgres
    const { domainTables, violations } = await auditDomainTables(adminSql);

    // Debe auditar las tablas existentes
    expect(domainTables.length).toBeGreaterThanOrEqual(3);
    const tableNames = domainTables.map((t) => t.tableName);
    expect(tableNames).toContain('organizations');
    expect(tableNames).toContain('memberships');
    expect(tableNames).toContain('audit_log');
    expect(tableNames).toContain('users');

    // Falla automáticamente si alguna tabla de dominio no tiene RLS o carece de organization_id NOT NULL
    expect(violations).toEqual([]);
  });

  it('Escenario: La conexión de administrador está acotada y deja rastro', async () => {
    const userAdmin = await createTestAuthUser('admin-sys@test-hu002.com', 'Admin Sys');
    const org = await createOrganizationWithAdmin(userAdmin, { name: 'Org For System Job' });

    // Proceso de sistema ejecuta operación privilegiada
    const jobResult = await executePrivilegedSystemOperation(
      {
        action: 'system.reconciliation_job',
        organizationId: org.id,
        metadata: { batchId: 'batch-99' },
        description: 'Automatic nightly reconciliation',
      },
      async (tx) => {
        // Puede leer sin restricciones de RLS
        const count = await tx.execute<{ count: string }>(
          sql`SELECT count(*) as count FROM public.audit_log WHERE organization_id = ${org.id}`
        );
        return Number(count[0].count);
      },
    );

    expect(jobResult).toBeGreaterThanOrEqual(1);

    // Verifica que quedó registrada en la bitácora identificada como proceso automático (origin.actor = 'system')
    const logs = await adminSql<{ action: string; origin: Record<string, unknown> | null; actor_user_id: string | null }[]>`
      SELECT action, origin, actor_user_id
      FROM public.audit_log
      WHERE organization_id = ${org.id}
        AND action = 'system.reconciliation_job'
    `;

    expect(logs).toHaveLength(1);
    expect(logs[0].actor_user_id).toBeNull();
    expect(logs[0].origin?.actor).toBe('system');
  });
});