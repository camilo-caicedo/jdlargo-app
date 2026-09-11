import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createOrganizationWithAdmin, grantMembership } from '../organizations/use-cases';
import { seedBaseConfiguration } from '../auth/role-config';
import type { Organization } from '../organizations/types';
import {
  createDraftConfiguration,
  updateDraftConfiguration,
  publishDraftConfiguration,
  getActiveConfiguration,
  getConfigurationAtDate,
  getConfigurationVersionDetail,
  compareConfigurationVersions,
} from './service';

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
  'Empresa Alpha S.A.S.',
  'Empresa Beta S.A.S.',
  'Empresa Tres S.A.S.',
  'Empresa Cuatro S.A.S.',
  'Empresa Cinco S.A.S.',
];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu004.com')
  `;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu004.com')
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
    DELETE FROM public.privacy_notices
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
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu004.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu004.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-004: Publicación de versiones de configuración inmutables', () => {
  let orgA: Organization;
  let orgB: Organization;
  let adminAId: string;
  let analystAId: string;

  beforeAll(async () => {
    await cleanupTestData();

    // Create Admin and Org A
    adminAId = await createTestAuthUser('adminA@test-hu004.com', 'Admin Org A');
    orgA = await createOrganizationWithAdmin(adminAId, { name: 'Empresa Alpha S.A.S.' });
    await seedBaseConfiguration(orgA.id, adminAId);

    // Create Analyst in Org A
    analystAId = await createTestAuthUser('analystA@test-hu004.com', 'Analyst Org A');
    await grantMembership(adminAId, {
      organizationId: orgA.id,
      userId: analystAId,
      role: 'compliance_analyst',
    });

    // Create Org B
    const adminBId = await createTestAuthUser('adminB@test-hu004.com', 'Admin Org B');
    orgB = await createOrganizationWithAdmin(adminBId, { name: 'Empresa Beta S.A.S.' });
    await seedBaseConfiguration(orgB.id, adminBId);
  }, 30000);

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  }, 30000);

  it('Escenario 1: Publicar la primera versión de configuración', async () => {
    // Admin creates and publishes first version for Org A
    const active = await getActiveConfiguration(orgA.id);
    expect(active).not.toBeNull();
    expect(active?.versionNumber).toBe('1');
    expect(active?.status).toBe('published');
    expect(active?.roles.length).toBeGreaterThan(0);
    expect(active?.publishedBy).toBe(adminAId);

    // Verify audit log
    const auditRows = await adminSql`
      SELECT * FROM public.audit_log
      WHERE organization_id = ${orgA.id}::uuid AND action = 'configuration.published'
    `;
    expect(auditRows.length).toBe(1);
  });

  it('Escenario 2: Una versión publicada no se puede modificar (inmutabilidad por trigger)', async () => {
    const active = await getActiveConfiguration(orgA.id);
    expect(active).not.toBeNull();

    // Attempting direct UPDATE on configuration_versions
    await expect(
      adminSql`
        UPDATE public.configuration_versions
        SET standard = 'MODIFIED_ILLEGALLY'
        WHERE id = ${active!.id}::uuid
      `
    ).rejects.toThrow(/Cannot modify published configuration version/);

    // Attempting direct DELETE on configuration_versions
    await expect(
      adminSql`
        DELETE FROM public.configuration_versions
        WHERE id = ${active!.id}::uuid
      `
    ).rejects.toThrow(/Cannot delete published or replaced configuration version/);
  });

  it('Escenario 3: Cambiar la configuración es publicar una versión nueva (diff y reemplazo)', async () => {
    // Create new org for isolated version upgrade testing
    const admin3Id = await createTestAuthUser('admin3@test-hu004.com', 'Admin Org 3');
    const org3 = await createOrganizationWithAdmin(admin3Id, { name: 'Empresa Tres S.A.S.' });
    await seedBaseConfiguration(org3.id, admin3Id);

    // Create draft v2 for Org 3
    const draft = await createDraftConfiguration({
      organizationId: org3.id,
      standard: 'SARLAFT + PTEE',
      referenceRegulation: 'Circular Básica Jurídica 2025',
      rolesConfig: [
        {
          code: 'admin',
          name: 'Administrador',
          permissions: ['configuration:publish', 'configuration:view', 'memberships:manage'],
        },
        {
          code: 'compliance_officer',
          name: 'Oficial de Cumplimiento Senior',
          permissions: ['configuration:publish', 'dossier:approve', 'dossier:view'],
        },
        {
          code: 'new_specialist_role',
          name: 'Especialista AML',
          permissions: ['dossier:view', 'alert:view'],
        },
      ],
    });

    expect(draft.versionNumber).toBe('2');

    // Publish v2 with reason
    const v2Published = await publishDraftConfiguration({
      organizationId: org3.id,
      versionId: draft.versionId,
      publishedBy: admin3Id,
      reason: 'Adopción marco complementario PTEE y nuevo rol especialista',
    });

    expect(v2Published.versionNumber).toBe('2');
    expect(v2Published.status).toBe('published');

    // Active version is now v2
    const currentActive = await getActiveConfiguration(org3.id);
    expect(currentActive?.versionNumber).toBe('2');

    // v1 is now replaced
    const v1Rows = await adminSql`
      SELECT id, status FROM public.configuration_versions
      WHERE organization_id = ${org3.id}::uuid AND version_number = '1'
    `;
    expect(v1Rows[0].status).toBe('replaced');

    // Fix HU-003 & HU-004 auditoría: verificar que una versión en estado replaced rechaza UPDATE
    await expect(
      adminSql`
        UPDATE public.configuration_versions
        SET reason = 'INTENTO_REESCRITURA_REPLACED'
        WHERE id = ${v1Rows[0].id}::uuid
      `
    ).rejects.toThrow(/Cannot modify replaced configuration version/);

    // Fix HU-004 auditoría: verificar que publicar con motivo vacío falla
    const emptyReasonDraft = await createDraftConfiguration({
      organizationId: org3.id,
      standard: 'SARLAFT V3 INVALID',
    });
    await expect(
      publishDraftConfiguration({
        organizationId: org3.id,
        versionId: emptyReasonDraft.versionId,
        publishedBy: admin3Id,
        reason: '   ',
      })
    ).rejects.toThrow(/motivo explícito no vacío/);

    // Compare diff between v1 and v2
    const diff = await compareConfigurationVersions(org3.id, '1', '2');
    expect(diff.rolesAdded).toContain('new_specialist_role');
    expect(diff.rolesRemoved).toContain('compliance_analyst');
  });

  it('Escenario 4: Un borrador de configuración no rige mientras no se publique', async () => {
    // Create new org for isolated draft testing
    const admin4Id = await createTestAuthUser('admin4@test-hu004.com', 'Admin Org 4');
    const org4 = await createOrganizationWithAdmin(admin4Id, { name: 'Empresa Cuatro S.A.S.' });
    await seedBaseConfiguration(org4.id, admin4Id);

    const draft = await createDraftConfiguration({
      organizationId: org4.id,
      standard: 'EXPERIMENTAL_DRAFT',
      rolesConfig: [
        {
          code: 'experimental_role',
          name: 'Rol Experimental',
          permissions: ['dossier:create'],
        },
      ],
    });

    // Update draft freely
    await updateDraftConfiguration(org4.id, draft.versionId, {
      standard: 'EXPERIMENTAL_DRAFT_UPDATED',
    });

    const draftDetail = await getConfigurationVersionDetail(org4.id, draft.versionId);
    expect(draftDetail.status).toBe('draft');
    expect(draftDetail.standard).toBe('EXPERIMENTAL_DRAFT_UPDATED');

    // Active configuration is still v1!
    const active = await getActiveConfiguration(org4.id);
    expect(active?.versionNumber).toBe('1');
    expect(active?.standard).toBe('SARLAFT');
  });

  it('Escenario 5: Reconstruir la configuración de una fecha pasada (as-of)', async () => {
    // Dedicated org for time travel
    const admin5Id = await createTestAuthUser('admin5@test-hu004.com', 'Admin Org 5');
    const org5 = await createOrganizationWithAdmin(admin5Id, { name: 'Empresa Cinco S.A.S.' });
    await seedBaseConfiguration(org5.id, admin5Id);

    // Dates
    const t0 = new Date('2025-01-01T00:00:00Z');
    const t1 = new Date('2025-06-01T00:00:00Z');
    const t2 = new Date('2025-12-01T00:00:00Z');

    // Bypass trigger to simulate historical effective_from
    await adminSql`SET app.allow_config_cleanup = 'true'`;
    await adminSql`
      UPDATE public.configuration_versions
      SET effective_from = ${t1.toISOString()}
      WHERE organization_id = ${org5.id}::uuid AND version_number = '1'
    `;
    await adminSql`RESET app.allow_config_cleanup`;

    // Publish v2 effective at t2
    const draft2 = await createDraftConfiguration({
      organizationId: org5.id,
      standard: 'SARLAFT V2 HISTORICO',
    });
    await publishDraftConfiguration({
      organizationId: org5.id,
      versionId: draft2.versionId,
      publishedBy: admin5Id,
      reason: 'Histórico v2',
      effectiveFrom: t2,
    });

    // At t0 (before v1): null
    const atT0 = await getConfigurationAtDate(org5.id, t0);
    expect(atT0).toBeNull();

    // In between t1 and t2: should reconstruct v1
    const midDate = new Date('2025-08-01T00:00:00Z');
    const atMid = await getConfigurationAtDate(org5.id, midDate);
    expect(atMid?.versionNumber).toBe('1');
    expect(atMid?.standard).toBe('SARLAFT');

    // At or after t2: should reconstruct v2
    const afterT2 = new Date('2026-01-01T00:00:00Z');
    const atAfter = await getConfigurationAtDate(org5.id, afterT2);
    expect(atAfter?.versionNumber).toBe('2');
    expect(atAfter?.standard).toBe('SARLAFT V2 HISTORICO');
  });

  it('Escenario 6: Aislamiento estricto entre organizaciones sobre la configuración', async () => {
    // Draft in Org A
    const draftA = await createDraftConfiguration({
      organizationId: orgA.id,
      standard: 'PRIVATE_A',
    });

    // Org B should not be able to get Org A's version detail
    await expect(
      getConfigurationVersionDetail(orgB.id, draftA.versionId)
    ).rejects.toThrow(/Versión no encontrada/);

    // Active configuration of Org B is its own v1, not Org A's
    const activeB = await getActiveConfiguration(orgB.id);
    expect(activeB?.organizationId).toBe(orgB.id);
  });

  it('Escenario 7: Publicar exige el permiso correspondiente (configuration:publish)', async () => {
    const draft = await createDraftConfiguration({
      organizationId: orgA.id,
      standard: 'SARLAFT TEST AUTH',
    });

    // Attempting to publish using analyst user (analyst does NOT have configuration:publish)
    await expect(
      publishDraftConfiguration({
        organizationId: orgA.id,
        versionId: draft.versionId,
        publishedBy: analystAId,
        reason: 'Intento no autorizado',
      })
    ).rejects.toThrow(/Acción no autorizada: falta el permiso 'configuration:publish'/);

    // Verify security violation was logged in audit_log
    const forbiddenLogs = await adminSql`
      SELECT * FROM public.audit_log
      WHERE organization_id = ${orgA.id}::uuid AND action = 'security.permission_denied'
    `;
    expect(forbiddenLogs.length).toBeGreaterThan(0);
    expect(forbiddenLogs[0].metadata.permission).toBe('configuration:publish');
  });
});
