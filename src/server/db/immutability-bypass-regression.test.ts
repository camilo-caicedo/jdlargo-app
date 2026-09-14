import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { db } from './client';
import { createOrganizationWithAdmin } from '../organizations/use-cases';
import { seedBaseConfiguration } from '../auth/role-config';
import type { Organization } from '../organizations/types';

/**
 * Regresión (2026-09-14): trg_prevent_assertion_tampering_func y
 * trg_prevent_dossier_access_tokens_tampering_func perdieron en silencio la restricción de
 * rol sobre app.allow_config_cleanup cuando migraciones posteriores (0011, 0020) volvieron a
 * hacer CREATE OR REPLACE FUNCTION sin ella. Ambas tablas tienen política RLS de UPDATE
 * amplia (cualquier fila de la organización es visible), así que el trigger era el único
 * control real sobre qué columnas se pueden tocar — cualquier sesión con rol `authenticated`
 * podía fijar esa bandera ella misma y tocar columnas núcleo. 0030 reaplica la restricción.
 * (trg_prevent_dossier_access_uses_tampering_func tenía el mismo hueco textual, pero esa
 * tabla nunca tuvo política de UPDATE ni DELETE — RLS ya la protegía sola, sin depender del
 * trigger; se corrigió por consistencia, no porque hubiera una ruta explotable.)
 * Esta prueba existe para que un futuro CREATE OR REPLACE nunca la vuelva a perder sin que
 * la suite falle.
 */

const directUrl = process.env.DIRECT_URL;
const adminSql = postgres(directUrl || '');

async function createTestAuthUser(email: string, name: string): Promise<string> {
  const res = await adminSql`
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      ${email}, 'fake_encrypted_pw', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, ${JSON.stringify({ name })}::jsonb, now(), now()
    ) RETURNING id
  `;
  return res[0].id;
}

const TEST_ORG_NAMES = ['Bypass Regression Org S.A.S.'];

async function cleanupTestData() {
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`DELETE FROM public.audit_log WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})`;
  await adminSql`DELETE FROM public.assertions WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})`;
  await adminSql`DELETE FROM public.dossier_access_uses WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})`;
  await adminSql`DELETE FROM public.dossier_access_tokens WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})`;
  await adminSql`DELETE FROM public.dossiers WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})`;
  await adminSql`DELETE FROM public.parties WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})`;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`DELETE FROM public.memberships WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)}) OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-bypass-regression.com')`;
  await adminSql`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`DELETE FROM public.role_permissions WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})`;
  await adminSql`DELETE FROM public.roles WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})`;
  await adminSql`DELETE FROM public.requirements WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})`;
  await adminSql`DELETE FROM public.counterparty_types WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})`;
  await adminSql`DELETE FROM public.privacy_notices WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})`;
  await adminSql`DELETE FROM public.configuration_versions WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})`;
  await adminSql`DELETE FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)}`;
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-bypass-regression.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-bypass-regression.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

/**
 * Intenta la operación como haría un atacante: rol `authenticated`, bandera de limpieza
 * encendida. DELETE no sirve para probar esto: ninguna de las dos tablas tiene política RLS
 * de DELETE, así que RLS ya oculta la fila por su cuenta (0 filas afectadas, sin error)
 * antes de que el trigger la vea — eso no prueba nada sobre el propio trigger. UPDATE sí,
 * porque ambas tienen política de UPDATE amplia (cualquier fila de la organización).
 */
async function attemptBypassedUpdate(actorUserId: string, organizationId: string, rawUpdateSql: string) {
  return db.transaction(async (tx) => {
    // Mismo contexto que withTenantContext (client.ts): un miembro legítimo de la
    // organización, con sesión real — no un extraño sin RLS de por medio. El ataque es
    // que ese miembro legítimo, sin más permiso que el que ya tiene, se fija la bandera
    // de limpieza a sí mismo.
    const claims = JSON.stringify({ sub: actorUserId, role: 'authenticated' });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`select set_config('app.current_organization_id', ${organizationId}, true)`);
    await tx.execute(sql`set local role authenticated`);
    await tx.execute(sql`select set_config('app.allow_config_cleanup', 'true', true)`);
    await tx.execute(sql.raw(rawUpdateSql));
  });
}

describe('Regresión de seguridad: bypass de inmutabilidad vía app.allow_config_cleanup', () => {
  let org: Organization;
  let adminId: string;
  let dossierId: string;
  let partyId: string;
  let assertionId: string;
  let accessTokenId: string;

  beforeAll(async () => {
    await cleanupTestData();

    adminId = await createTestAuthUser('admin@test-bypass-regression.com', 'Admin Bypass');
    org = await createOrganizationWithAdmin(adminId, { name: 'Bypass Regression Org S.A.S.' });
    await seedBaseConfiguration(org.id, adminId);

    const [party] = await adminSql<{ id: string }[]>`
      INSERT INTO public.parties (organization_id, identification_type, identification_number)
      VALUES (${org.id}, 'CC', '900000001')
      RETURNING id
    `;
    partyId = party.id;

    const [dossier] = await adminSql<{ id: string }[]>`
      INSERT INTO public.dossiers (organization_id, party_id, state, configuration_version_id)
      VALUES (
        ${org.id}, ${partyId}, 'en_diligenciamiento',
        (SELECT id FROM public.configuration_versions WHERE organization_id = ${org.id} LIMIT 1)
      )
      RETURNING id
    `;
    dossierId = dossier.id;

    const [assertion] = await adminSql<{ id: string }[]>`
      INSERT INTO public.assertions (organization_id, dossier_id, party_id, configuration_version_id, field, value, origin, produced_by)
      VALUES (
        ${org.id}, ${dossierId}, ${partyId},
        (SELECT id FROM public.configuration_versions WHERE organization_id = ${org.id} LIMIT 1),
        'razon_social', '"Bypass Regression S.A.S."'::jsonb, 'declared', ${adminId}
      )
      RETURNING id
    `;
    assertionId = assertion.id;

    const [accessToken] = await adminSql<{ id: string }[]>`
      INSERT INTO public.dossier_access_tokens (organization_id, dossier_id, token_hash, expires_at, recipient_email, issued_by)
      VALUES (${org.id}, ${dossierId}, 'fake_hash_bypass_test', now() + interval '1 day', 'contraparte@example.com', ${adminId})
      RETURNING id
    `;
    accessTokenId = accessToken.id;
  }, 40000);

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  }, 40000);

  // drizzle envuelve el error de postgres.js en "Failed query: ..."; el mensaje real de la
  // excepción de Postgres (la que lanza el trigger) queda en `.cause`.
  async function expectRejectionMatching(promise: Promise<unknown>, pattern: RegExp) {
    let caught: unknown;
    try {
      await promise;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as Error & { cause?: Error }).cause;
    expect(cause?.message ?? (caught as Error).message).toMatch(pattern);
  }

  it('assertions: UPDATE de valor núcleo bajo rol authenticated con allow_config_cleanup=true sigue rechazado', async () => {
    await expectRejectionMatching(
      attemptBypassedUpdate(
        adminId,
        org.id,
        `UPDATE public.assertions SET value = '"Tamperado"'::jsonb WHERE id = '${assertionId}'::uuid`,
      ),
      /Cannot modify assertion provenance or value/,
    );

    const [row] = await adminSql`SELECT value FROM public.assertions WHERE id = ${assertionId}::uuid`;
    expect(row.value).toBe('Bypass Regression S.A.S.');
  });

  it('dossier_access_tokens: UPDATE de token_hash bajo rol authenticated con allow_config_cleanup=true sigue rechazado', async () => {
    await expectRejectionMatching(
      attemptBypassedUpdate(
        adminId,
        org.id,
        `UPDATE public.dossier_access_tokens SET state = 'revoked', token_hash = 'stolen_hash' WHERE id = '${accessTokenId}'::uuid`,
      ),
      /Cannot modify core token fields/,
    );

    const [row] = await adminSql`SELECT token_hash, state FROM public.dossier_access_tokens WHERE id = ${accessTokenId}::uuid`;
    expect(row.tokenHash ?? row.token_hash).toBe('fake_hash_bypass_test');
    expect(row.state).toBe('active');
  });
});
