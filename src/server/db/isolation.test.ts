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
  await adminSql`DELETE FROM public.requirements`;
  await adminSql`DELETE FROM public.counterparty_types`;
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
    // 1. Inspecciona catálogo de base de datos Postgres
    const { domainTables, violations } = await auditDomainTables(adminSql);

    // Debe auditar todas las tablas existentes
    expect(domainTables.length).toBeGreaterThanOrEqual(5);
    const tableNames = domainTables.map((t) => t.tableName);
    expect(tableNames).toContain('organizations');
    expect(tableNames).toContain('memberships');
    expect(tableNames).toContain('audit_log');
    expect(tableNames).toContain('configuration_versions');
    expect(tableNames).toContain('roles');
    expect(tableNames).toContain('role_permissions');
    expect(tableNames).toContain('assertions');
    expect(tableNames).toContain('users');

    // Falla automáticamente si alguna tabla de dominio no tiene RLS, no tiene FORCE RLS o carece de organization_id NOT NULL
    expect(violations).toEqual([]);

    // 2. Ejecutar prueba obligatoria de lectura y escritura cruzadas real para cada tabla de dominio
    // (ADR-0001 §10 y HU-002 Criterio Gherkin: "verifica lectura y escritura cruzadas entre dos organizaciones clientes")
    const userA = await createTestAuthUser('user-table-a@test-hu002.com', 'User A');
    const userB = await createTestAuthUser('user-table-b@test-hu002.com', 'User B');
    const orgA = await createOrganizationWithAdmin(userA, { name: 'Org Alfa Tables' });
    const orgB = await createOrganizationWithAdmin(userB, { name: 'Org Beta Tables' });

    // Filtrar tablas de dominio (excluyendo tablas globales users y organizations)
    const tablesToVerify = domainTables
      .map((t) => t.tableName)
      .filter((name) => !['users', 'organizations'].includes(name));

    for (const tableName of tablesToVerify) {
      // (a) Lectura cruzada: Usuario de Org B con su contexto no debe ver filas de Org A
      const crossRead = await withTenantContext(
        { userId: userB, organizationId: orgB.id },
        async (tx) => {
          return tx.execute(
            sql.raw(`SELECT * FROM public.${tableName} WHERE organization_id = '${orgA.id}'`)
          );
        },
      );
      expect(crossRead.length).toBe(0);

      // (b) Escritura cruzada: Usuario con contexto de Org B intentando insertar con organization_id de Org A debe fallar
      // Probamos inserciones con columnas mínimas según tabla
      let insertSql: string;
      if (tableName === 'memberships') {
        insertSql = `INSERT INTO public.memberships (organization_id, user_id, role, status) VALUES ('${orgA.id}', '${userB}', 'compliance_analyst', 'active')`;
      } else if (tableName === 'audit_log') {
        insertSql = `INSERT INTO public.audit_log (organization_id, actor_user_id, action, event_hash) VALUES ('${orgA.id}', '${userB}', 'cross.write', 'hash')`;
      } else if (tableName === 'configuration_versions') {
        insertSql = `INSERT INTO public.configuration_versions (organization_id, version_number, status) VALUES ('${orgA.id}', '88', 'draft')`;
      } else if (tableName === 'roles') {
        insertSql = `INSERT INTO public.roles (organization_id, configuration_version_id, code, name) VALUES ('${orgA.id}', gen_random_uuid(), 'cross_role', 'Rol Cruzado')`;
      } else if (tableName === 'role_permissions') {
        insertSql = `INSERT INTO public.role_permissions (organization_id, configuration_version_id, role_id, permission_key) VALUES ('${orgA.id}', gen_random_uuid(), gen_random_uuid(), 'dossier:view')`;
      } else if (tableName === 'assertions') {
        insertSql = `INSERT INTO public.assertions (organization_id, dossier_id, party_id, configuration_version_id, field, value, origin, produced_by) VALUES ('${orgA.id}', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'nit', '{"nit":"123"}'::jsonb, 'declared', '${userB}')`;
      } else if (tableName === 'counterparty_types') {
        insertSql = `INSERT INTO public.counterparty_types (organization_id, configuration_version_id, name, nature) VALUES ('${orgA.id}', gen_random_uuid(), 'cross_type', 'natural_person')`;
      } else if (tableName === 'requirements') {
        insertSql = `INSERT INTO public.requirements (organization_id, configuration_version_id, counterparty_type_id, standard, type, key, mandatory) VALUES ('${orgA.id}', gen_random_uuid(), gen_random_uuid(), 'SARLAFT', 'field', 'tax_id', 'always')`;
      } else {
        insertSql = `INSERT INTO public.${tableName} (organization_id) VALUES ('${orgA.id}')`;
      }

      await expect(
        withTenantContext(
          { userId: userB, organizationId: orgB.id },
          async (tx) => {
            return tx.execute(sql.raw(insertSql));
          },
        ),
      ).rejects.toThrow();
    }
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