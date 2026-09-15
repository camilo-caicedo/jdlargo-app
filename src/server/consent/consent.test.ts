import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createOrganizationWithAdmin } from '../organizations/use-cases';
import { seedBaseConfiguration, BASE_ROLES_TEMPLATE } from '../auth/role-config';
import { createDraftConfiguration, publishDraftConfiguration } from '../configuration/service';
import { addCounterpartyType, addRequirement } from '../configuration/requirement-matrix';
import { addPrivacyNotice } from '../configuration/privacy-notice';
import { createDossierRequest } from '../dossiers/dossier';
import { executeTransition, getDossierHistory } from '../dossiers/state-machine';
import { recordConsent, getConsentForDossier } from './consent';
import { mockSentEmails } from '../notifications/email';
import { withTenantContext } from '../db/client';
import { sql } from 'drizzle-orm';

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

const TEST_ORG_NAMES = ['Consent Test Org'];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.consents
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.privacy_notices
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.dossier_transitions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.assertions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.dossiers
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.parties
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu011-consent.com')
  `;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu011-consent.com')
  `;
  await adminSql`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.requirements
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.counterparty_types
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
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
  await adminSql`
    DELETE FROM public.users
    WHERE email LIKE '%@test-hu011-consent.com'
  `;
  await adminSql`
    DELETE FROM auth.users
    WHERE email LIKE '%@test-hu011-consent.com'
  `;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-011: Consent and Privacy Notice Domain', () => {
  let orgId: string;
  let adminUserId: string;
  let privacyNoticeId: string;

  beforeAll(async () => {
    await adminSql.unsafe(`
      DROP POLICY IF EXISTS consents_update_policy ON public.consents;
      CREATE POLICY consents_update_policy ON public.consents
        FOR UPDATE TO authenticated
        USING (is_current_org(organization_id))
        WITH CHECK (is_current_org(organization_id));

      DROP POLICY IF EXISTS consents_delete_policy ON public.consents;
      CREATE POLICY consents_delete_policy ON public.consents
        FOR DELETE TO authenticated
        USING (is_current_org(organization_id));
    `);
    await cleanupTestData();
    adminUserId = await createTestAuthUser('admin@test-hu011-consent.com', 'Admin Consent');
    const org = await createOrganizationWithAdmin(adminUserId, {
      name: 'Consent Test Org',
    });
    orgId = org.id;
    await seedBaseConfiguration(orgId, adminUserId);

    const customRoles = BASE_ROLES_TEMPLATE.map((r) => {
      if (r.code === 'admin') {
        const perms = Array.from(new Set([...r.permissions, 'dossier:edit' as const, 'dossier:approve' as const]));
        return {
          ...r,
          permissions: perms,
        };
      }
      return { ...r, permissions: [...r.permissions] };
    });

    // Create draft configuration with counterparty type and requirement
    const { versionId } = await createDraftConfiguration({
      organizationId: orgId,
      standard: 'SARLAFT',
      rolesConfig: customRoles,
    });

    const cpType = await addCounterpartyType({
      organizationId: orgId,
      configurationVersionId: versionId,
      name: 'proveedor_custom',
      nature: 'legal_entity',
    });

    await addRequirement({
      organizationId: orgId,
      configurationVersionId: versionId,
      counterpartyTypeId: cpType.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'rut_number',
      mandatory: 'always',
    });

    // Add privacy notice
    const pnResult = await addPrivacyNotice({
      organizationId: orgId,
      configurationVersionId: versionId,
      text: 'Texto congelado de aviso v1.',
      purposes: [
        {
          key: 'laft',
          description: 'Consulta y validación LA/FT',
          requiresAuthorization: true,
        },
      ],
      dataController: 'Consent Test Org',
      dataProcessor: 'JD Largo',
      rightsChannels: 'privacidad@consent-test.com',
    });
    privacyNoticeId = pnResult.id;

    // Publish configuration
    await publishDraftConfiguration({
      organizationId: orgId,
      versionId,
      publishedBy: adminUserId,
      reason: 'Publicando versión 1 con aviso de privacidad para tests de consentimiento',
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  });

  it('records acceptance of privacy notice and preserves snapshot', async () => {
    // 1. Create dossier
    const dossier = await createDossierRequest({
      organizationId: orgId,
      requestedBy: adminUserId,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '900999001-1',
        declaredName: 'Proveedor Aceptante S.A.S.',
      },
      internalOwnerId: adminUserId,
    });

    // 2. Advance to en_diligenciamiento (borrador -> enviada -> en_diligenciamiento)
    await executeTransition({
      dossierId: dossier.id,
      organizationId: orgId,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUserId,
    });
    await executeTransition({
      dossierId: dossier.id,
      organizationId: orgId,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    // 3. Record consent accepted
    const consent = await recordConsent({
      organizationId: orgId,
      dossierId: dossier.id,
      privacyNoticeId,
      result: 'accepted',
      channel: 'portal',
      ipAddress: '192.168.1.50',
    });

    expect(consent.id).toBeDefined();
    expect(consent.result).toBe('accepted');
    expect(consent.privacyNoticeTextSnapshot).toBe('Texto congelado de aviso v1.');
    expect(consent.ipAddress).toBe('192.168.1.50');

    // Query back
    const stored = await getConsentForDossier(orgId, dossier.id);
    expect(stored).not.toBeNull();
    expect(stored?.result).toBe('accepted');
    expect(stored?.privacyNoticeTextSnapshot).toBe('Texto congelado de aviso v1.');

    // 4. Idempotency: cannot record consent again for the same dossier
    await expect(
      recordConsent({
        organizationId: orgId,
        dossierId: dossier.id,
        privacyNoticeId,
        result: 'accepted',
        channel: 'portal',
        ipAddress: '192.168.1.50',
      }),
    ).rejects.toThrow('El consentimiento para este expediente ya ha sido registrado');
  });

  it('records non-acceptance, transitions dossier to rechazada_por_contraparte, and sends email', async () => {
    mockSentEmails.length = 0;

    const dossier = await createDossierRequest({
      organizationId: orgId,
      requestedBy: adminUserId,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '900999002-2',
        declaredName: 'Proveedor Rechazante S.A.S.',
      },
      internalOwnerId: adminUserId,
    });

    await executeTransition({
      dossierId: dossier.id,
      organizationId: orgId,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUserId,
    });

    await executeTransition({
      dossierId: dossier.id,
      organizationId: orgId,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    const consent = await recordConsent({
      organizationId: orgId,
      dossierId: dossier.id,
      privacyNoticeId,
      result: 'not_accepted',
      channel: 'portal',
      ipAddress: '10.0.0.99',
    });

    expect(consent.result).toBe('not_accepted');

    // Verify history contains transition to rechazada_por_contraparte
    const history = await getDossierHistory(orgId, dossier.id);
    const lastTransition = history[history.length - 1];
    expect(lastTransition.toState).toBe('rechazada_por_contraparte');
    expect(lastTransition.actorType).toBe('counterparty');

    // Verify email notification was queued
    const sentEmail = mockSentEmails.find((e) => e.type === 'dossier_rejected');
    expect(sentEmail).toBeDefined();
    expect(sentEmail?.to).toBe('admin@test-hu011-consent.com');
  });

  it('enforces immutability of consents at database level', async () => {
    const dossier = await createDossierRequest({
      organizationId: orgId,
      requestedBy: adminUserId,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '900999003-3',
        declaredName: 'Proveedor Inmutable S.A.S.',
      },
      internalOwnerId: adminUserId,
    });

    await executeTransition({
      dossierId: dossier.id,
      organizationId: orgId,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUserId,
    });

    await executeTransition({
      dossierId: dossier.id,
      organizationId: orgId,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    const consent = await recordConsent({
      organizationId: orgId,
      dossierId: dossier.id,
      privacyNoticeId,
      result: 'accepted',
      channel: 'portal',
      ipAddress: '172.16.0.1',
    });

    // Attempting to UPDATE the consent record must fail due to trigger
    await expect(
      adminSql`
        UPDATE public.consents
        SET result = 'not_accepted'
        WHERE id = ${consent.id}
      `,
    ).rejects.toThrow('consents entries are append-only evidence: updates are strictly forbidden');

    // Attempting to DELETE the consent record must fail due to trigger
    await expect(
      adminSql`
        DELETE FROM public.consents
        WHERE id = ${consent.id}
      `,
    ).rejects.toThrow('consents entries are immutable evidence: deleting is strictly forbidden');

    // Attempting bypass via app.allow_config_cleanup from authenticated role must still fail
    let updateError: unknown;
    try {
      await withTenantContext(
        { userId: adminUserId, organizationId: orgId },
        async (tx) => {
          await tx.execute(sql`SET app.allow_config_cleanup = 'true'`);
          return tx.execute(sql`
            UPDATE public.consents
            SET result = 'not_accepted'
            WHERE id = ${consent.id}
          `);
        },
      );
    } catch (err) {
      updateError = err;
    }
    expect(updateError).toBeDefined();
    const updateMsg =
      updateError instanceof Error && updateError.cause instanceof Error
        ? updateError.cause.message
        : updateError instanceof Error
          ? updateError.message
          : String(updateError);
    expect(updateMsg).toMatch(
      /consents entries are append-only evidence: updates are strictly forbidden/,
    );

    let deleteError: unknown;
    try {
      await withTenantContext(
        { userId: adminUserId, organizationId: orgId },
        async (tx) => {
          await tx.execute(sql`SET app.allow_config_cleanup = 'true'`);
          return tx.execute(sql`
            DELETE FROM public.consents
            WHERE id = ${consent.id}
          `);
        },
      );
    } catch (err) {
      deleteError = err;
    }
    expect(deleteError).toBeDefined();
    const deleteMsg =
      deleteError instanceof Error && deleteError.cause instanceof Error
        ? deleteError.cause.message
        : deleteError instanceof Error
          ? deleteError.message
          : String(deleteError);
    expect(deleteMsg).toMatch(
      /consents entries are immutable evidence: deleting is strictly forbidden/,
    );
  });
});
