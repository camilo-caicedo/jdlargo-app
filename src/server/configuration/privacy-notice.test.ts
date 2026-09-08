import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createOrganizationWithAdmin } from '../organizations/use-cases';
import { seedBaseConfiguration } from '../auth/role-config';
import { createDraftConfiguration, publishDraftConfiguration } from './service';
import { addPrivacyNotice, getPrivacyNoticeForVersion } from './privacy-notice';

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

const TEST_ORG_NAMES = ['Privacy Notice Test Org'];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.privacy_notices
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu011-pn.com')
  `;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu011-pn.com')
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
    DELETE FROM public.requirements
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.counterparty_types
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
    WHERE email LIKE '%@test-hu011-pn.com'
  `;
  await adminSql`
    DELETE FROM auth.users
    WHERE email LIKE '%@test-hu011-pn.com'
  `;
}

describe('HU-011: Privacy Notice Configuration Domain', () => {
  let orgId: string;
  let adminUserId: string;

  beforeAll(async () => {
    await cleanupTestData();
    adminUserId = await createTestAuthUser('admin@test-hu011-pn.com', 'Admin PN');
    const org = await createOrganizationWithAdmin(adminUserId, {
      name: 'Privacy Notice Test Org',
    });
    orgId = org.id;
    await seedBaseConfiguration(orgId, adminUserId);
  });

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  });

  it('adds and updates privacy notice for a draft configuration version', async () => {
    const { versionId } = await createDraftConfiguration({
      organizationId: orgId,
      standard: 'SARLAFT',
    });

    const samplePurposes = [
      {
        key: 'laft_screening',
        description: 'Prevención del riesgo LA/FT/FPADM y consulta en listas restrictivas',
        requiresAuthorization: true,
      },
      {
        key: 'legal_compliance',
        description: 'Cumplimiento normativo ante entidades de vigilancia y control',
        requiresAuthorization: false,
      },
    ];

    const result = await addPrivacyNotice({
      organizationId: orgId,
      configurationVersionId: versionId,
      text: 'Aviso de Privacidad versión 1 para debida diligencia de contrapartes.',
      purposes: samplePurposes,
      dataController: 'Privacy Notice Test Org S.A.S.',
      dataProcessor: 'JD Largo Platform',
      rightsChannels: 'habeasdata@test-hu011-pn.com',
    });

    expect(result.id).toBeDefined();

    // Query it back
    const notice = await getPrivacyNoticeForVersion(orgId, versionId);
    expect(notice).not.toBeNull();
    expect(notice?.text).toBe('Aviso de Privacidad versión 1 para debida diligencia de contrapartes.');
    expect(notice?.purposes).toHaveLength(2);
    expect(notice?.dataController).toBe('Privacy Notice Test Org S.A.S.');

    // Updating existing notice in draft replaces fields
    await addPrivacyNotice({
      organizationId: orgId,
      configurationVersionId: versionId,
      text: 'Aviso de Privacidad actualizado.',
      purposes: samplePurposes,
      dataController: 'Privacy Notice Test Org S.A.S.',
      dataProcessor: 'JD Largo Platform v2',
      rightsChannels: 'privacidad@test-hu011-pn.com',
    });

    const updated = await getPrivacyNoticeForVersion(orgId, versionId);
    expect(updated?.text).toBe('Aviso de Privacidad actualizado.');
    expect(updated?.rightsChannels).toBe('privacidad@test-hu011-pn.com');
  });

  it('rejects adding privacy notice on published configuration version', async () => {
    const { versionId } = await createDraftConfiguration({
      organizationId: orgId,
      standard: 'SARLAFT',
    });

    await publishDraftConfiguration({
      organizationId: orgId,
      versionId,
      publishedBy: adminUserId,
      reason: 'Publicando versión para prueba de inmutabilidad de aviso',
    });

    await expect(
      addPrivacyNotice({
        organizationId: orgId,
        configurationVersionId: versionId,
        text: 'Intento de modificar aviso en versión publicada',
        purposes: [],
        dataController: 'Test',
        dataProcessor: 'Test',
        rightsChannels: 'Test',
      }),
    ).rejects.toThrow('Solo se pueden modificar avisos de privacidad en versiones en estado borrador');
  });
});
