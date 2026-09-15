import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createOrganizationWithAdmin, grantMembership } from '../organizations/use-cases';
import { seedBaseConfiguration } from '../auth/role-config';
import { createDraftConfiguration, publishDraftConfiguration } from '../configuration/service';
import { addCounterpartyType, addRequirement } from '../configuration/requirement-matrix';
import { createDossierRequest } from './dossier';
import {
  issueAccessLink,
  revokeAccessLink,
  getAccessUsesForDossier,
  getActiveAccessLinkForDossier,
} from './access';
import { executeTransition } from './state-machine';
import { registerAssertion } from '../assertions/service';
import { confirmDocumentUpload } from '../documents/document';
import { resolveAccessToken } from '../privileged/portal-access';
import { mockSentEmails } from '../notifications/email';

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
  'Enlace Org 1',
  'Reemplazo Enlace Org',
  'Revocacion Enlace Org',
  'Reconstruccion Accesos Org',
  'Revoke Flow Org S.A.S.',
  'Reactivate Org S.A.S.',
];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu010-acc.com')
  `;
  await adminSql`
    DELETE FROM public.assertions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu010-acc.com')
  `;
  await adminSql`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.dossier_access_otp_codes
    WHERE access_token_id IN (
      SELECT id FROM public.dossier_access_tokens
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
    )
  `;
  await adminSql`
    DELETE FROM public.dossier_access_uses
    WHERE access_token_id IN (
      SELECT id FROM public.dossier_access_tokens
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
    )
  `;
  await adminSql`
    DELETE FROM public.dossier_access_tokens
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.documents
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.dossier_transitions
    WHERE dossier_id IN (
      SELECT id FROM public.dossiers
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
    )
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
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu010-acc.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu010-acc.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-010: Emisión y gestión del enlace de acceso (App interna)', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  }, 60000);

  it('Escenario: Emitir un enlace de acceso para un expediente', async () => {
    const adminUser = await createTestAuthUser('admin1@test-hu010-acc.com', 'Admin Org 1');
    const opUser = await createTestAuthUser('op1@test-hu010-acc.com', 'Operativo 1');
    const analystUser = await createTestAuthUser('analyst1@test-hu010-acc.com', 'Analista 1');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Enlace Org 1' });
    await seedBaseConfiguration(org.id, adminUser);
    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: opUser,
      role: 'operational_user',
    });
    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: analystUser,
      role: 'compliance_analyst',
    });

    // En la configuración del borrador, aseguramos que compliance_analyst tenga dossier:edit para emitir enlaces
    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
      rolesConfig: [
        {
          code: 'operational_user',
          name: 'Usuario operativo',
          permissions: ['dossier:create', 'dossier:view', 'document:upload'],
        },
        {
          code: 'compliance_analyst',
          name: 'Analista de Cumplimiento',
          permissions: [
            'dossier:view',
            'dossier:edit',
            'dossier:review',
            'dossier:export',
            'document:view',
            'document:review',
            'alert:view',
            'alert:resolve',
            'audit:view',
            'configuration:view',
          ],
        },
        {
          code: 'admin',
          name: 'Administrador',
          permissions: [
            'configuration:view',
            'configuration:publish',
            'configuration:administer',
            'memberships:manage',
            'audit:view',
          ],
        },
      ],
    });
    const typeRes = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'proveedor_custom',
      nature: 'legal_entity',
    });
    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeRes.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });
    await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft.versionId,
      publishedBy: adminUser,
      reason: 'Config inicial con roles adaptados',
    });

    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: opUser,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '901234567-1',
        declaredName: 'Proveedor Enlace S.A.S.',
      },
      internalOwnerId: analystUser,
    });

    // Emitir enlace de acceso
    const link = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: false,
      recipientEmail: 'contacto@proveedorenlace.com',
    });

    expect(link.id).toBeDefined();
    expect(link.dossierId).toBe(dossier.id);
    expect(link.rawToken).toHaveLength(64);
    expect(link.state).toBe('active');
    expect(link.requiresSecondFactor).toBe(false);
    expect(link.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Verifica que la emisión quedó registrada en audit_log
    const auditLogs = await adminSql<{ action: string }[]>`
      SELECT action FROM public.audit_log
      WHERE organization_id = ${org.id}
        AND action = 'dossier.access_link_issued'
        AND entity_id = ${dossier.id}
    `;
    expect(auditLogs).toHaveLength(1);

    // Verifica que el correo se intentó despachar
    const emailSent = mockSentEmails.find((e) => e.type === 'access_link' && e.to === 'contacto@proveedorenlace.com');
    expect(emailSent).toBeDefined();
  }, 60000);

  it('Escenario: Emitir un enlace nuevo invalida el anterior', async () => {
    const adminUser = await createTestAuthUser('admin2@test-hu010-acc.com', 'Admin Org 2');
    const opUser = await createTestAuthUser('op2@test-hu010-acc.com', 'Operativo 2');
    const analystUser = await createTestAuthUser('analyst2@test-hu010-acc.com', 'Analista 2');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Reemplazo Enlace Org' });
    await seedBaseConfiguration(org.id, adminUser);
    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: opUser,
      role: 'operational_user',
    });
    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: analystUser,
      role: 'compliance_analyst',
    });

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
      rolesConfig: [
        {
          code: 'operational_user',
          name: 'Usuario operativo',
          permissions: ['dossier:create', 'dossier:view', 'document:upload'],
        },
        {
          code: 'compliance_analyst',
          name: 'Analista de Cumplimiento',
          permissions: [
            'dossier:view',
            'dossier:edit',
            'dossier:review',
            'dossier:export',
            'document:view',
            'document:review',
            'alert:view',
            'alert:resolve',
            'audit:view',
            'configuration:view',
          ],
        },
        {
          code: 'admin',
          name: 'Administrador',
          permissions: [
            'configuration:view',
            'configuration:publish',
            'configuration:administer',
            'memberships:manage',
            'audit:view',
          ],
        },
      ],
    });
    const typeRes = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'proveedor_custom',
      nature: 'legal_entity',
    });
    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeRes.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });
    await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft.versionId,
      publishedBy: adminUser,
      reason: 'Config inicial',
    });

    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: opUser,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '901234567-2',
        declaredName: 'Proveedor Reemplazo S.A.S.',
      },
      internalOwnerId: analystUser,
    });

    // Emitir enlace 1
    const link1 = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: false,
      recipientEmail: 'contacto@reemplazo.com',
    });

    // Emitir enlace 2 (reemplazo)
    const link2 = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: true,
      recipientEmail: 'contacto@reemplazo.com',
    });

    expect(link1.id).not.toBe(link2.id);
    expect(link2.state).toBe('active');

    // Comprobar estado en base de datos: solo un enlace activo a la vez
    const tokensInDb = await adminSql<{ id: string; state: string }[]>`
      SELECT id, state FROM public.dossier_access_tokens
      WHERE dossier_id = ${dossier.id}
      ORDER BY created_at ASC
    `;

    expect(tokensInDb).toHaveLength(2);
    expect(tokensInDb[0].id).toBe(link1.id);
    expect(tokensInDb[0].state).toBe('replaced');
    expect(tokensInDb[1].id).toBe(link2.id);
    expect(tokensInDb[1].state).toBe('active');

    // Ambos hechos auditados
    const replacementLogs = await adminSql<{ action: string }[]>`
      SELECT action FROM public.audit_log
      WHERE organization_id = ${org.id}
        AND action IN ('dossier.access_link_issued', 'dossier.access_link_replaced')
        AND entity_id = ${dossier.id}
    `;
    expect(replacementLogs.length).toBeGreaterThanOrEqual(2);
  }, 60000);

  it('Escenario: Revocar un enlace corta el acceso de inmediato', async () => {
    const adminUser = await createTestAuthUser('admin3@test-hu010-acc.com', 'Admin Org 3');
    const opUser = await createTestAuthUser('op3@test-hu010-acc.com', 'Operativo 3');
    const analystUser = await createTestAuthUser('analyst3@test-hu010-acc.com', 'Analista 3');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Revocacion Enlace Org' });
    await seedBaseConfiguration(org.id, adminUser);
    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: opUser,
      role: 'operational_user',
    });
    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: analystUser,
      role: 'compliance_analyst',
    });

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
      rolesConfig: [
        {
          code: 'operational_user',
          name: 'Usuario operativo',
          permissions: ['dossier:create', 'dossier:view', 'document:upload'],
        },
        {
          code: 'compliance_analyst',
          name: 'Analista de Cumplimiento',
          permissions: [
            'dossier:view',
            'dossier:edit',
            'dossier:review',
            'dossier:export',
            'document:view',
            'document:review',
            'alert:view',
            'alert:resolve',
            'audit:view',
            'configuration:view',
          ],
        },
        {
          code: 'admin',
          name: 'Administrador',
          permissions: [
            'configuration:view',
            'configuration:publish',
            'configuration:administer',
            'memberships:manage',
            'audit:view',
          ],
        },
      ],
    });
    const typeRes = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'proveedor_custom',
      nature: 'legal_entity',
    });
    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeRes.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });
    await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft.versionId,
      publishedBy: adminUser,
      reason: 'Config inicial',
    });

    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: opUser,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '901234567-3',
        declaredName: 'Proveedor Revocacion S.A.S.',
      },
      internalOwnerId: analystUser,
    });

    const link = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: false,
      recipientEmail: 'contacto@revocacion.com',
    });

    // Revocar enlace
    await revokeAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      revokedBy: analystUser,
    });

    // Verificar en BD
    const [tokenRow] = await adminSql<{ state: string; revoked_by: string }[]>`
      SELECT state, revoked_by FROM public.dossier_access_tokens WHERE id = ${link.id}
    `;
    expect(tokenRow.state).toBe('revoked');
    expect(tokenRow.revoked_by).toBe(analystUser);

    // Auditoría registrada
    const revokeLogs = await adminSql<{ action: string }[]>`
      SELECT action FROM public.audit_log
      WHERE organization_id = ${org.id}
        AND action = 'dossier.access_link_revoked'
        AND entity_id = ${dossier.id}
    `;
    expect(revokeLogs).toHaveLength(1);
  }, 60000);

  it('HU-016: getAccessUsesForDossier devuelve los usos del enlace en orden cronológico aislados por organización', async () => {
    const adminUser = await createTestAuthUser('admin-rec@test-hu010-acc.com', 'Admin Rec');
    const opUser = await createTestAuthUser('op-rec@test-hu010-acc.com', 'Op Rec');
    const analystUser = await createTestAuthUser('analyst-rec@test-hu010-acc.com', 'Analyst Rec');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Reconstruccion Accesos Org' });
    await seedBaseConfiguration(org.id, adminUser);

    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: opUser,
      role: 'operational_user',
    });
    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: analystUser,
      role: 'compliance_analyst',
    });

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
      rolesConfig: [
        {
          code: 'operational_user',
          name: 'Usuario operativo',
          permissions: ['dossier:create', 'dossier:view', 'document:upload'],
        },
        {
          code: 'compliance_analyst',
          name: 'Analista de Cumplimiento',
          permissions: [
            'dossier:view',
            'dossier:edit',
            'dossier:review',
            'dossier:export',
            'document:view',
            'document:review',
            'alert:view',
            'alert:resolve',
            'audit:view',
            'configuration:view',
          ],
        },
        {
          code: 'admin',
          name: 'Administrador',
          permissions: [
            'configuration:view',
            'configuration:publish',
            'configuration:administer',
            'memberships:manage',
            'audit:view',
            'dossier:view',
          ],
        },
      ],
    });

    const cpType = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'proveedor_custom',
      nature: 'legal_entity',
    });

    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: cpType.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });

    await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft.versionId,
      publishedBy: adminUser,
      reason: 'Setup HU-016 test',
    });

    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: opUser,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '901234567-4',
        declaredName: 'Proveedor Reconstruccion S.A.S.',
      },
      internalOwnerId: analystUser,
    });

    const link = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: false,
      recipientEmail: 'contacto@reconstruccion.com',
    });

    // Insert access uses directly with known timestamps
    const time1 = new Date('2026-03-01T10:00:00Z');
    const time2 = new Date('2026-03-01T10:05:00Z');
    const time3 = new Date('2026-03-01T10:10:00Z');

    await adminSql`
      INSERT INTO public.dossier_access_uses (organization_id, dossier_id, access_token_id, ip_address, user_agent, result, denial_reason, occurred_at)
      VALUES 
        (${org.id}, ${dossier.id}, ${link.id}, '192.168.1.10', 'Mozilla/5.0 (Windows)', 'denied', 'Código OTP incorrecto', ${time2}),
        (${org.id}, ${dossier.id}, ${link.id}, '192.168.1.10', 'Mozilla/5.0 (Windows)', 'denied', 'Enlace expirado', ${time1}),
        (${org.id}, ${dossier.id}, ${link.id}, '192.168.1.10', 'Mozilla/5.0 (Windows)', 'granted', NULL, ${time3})
    `;

    const uses = await getAccessUsesForDossier(org.id, dossier.id);
    expect(uses).toHaveLength(3);

    // Debe venir en orden cronológico ASC
    expect(new Date(uses[0].occurredAt).getTime()).toBe(time1.getTime());
    expect(uses[0].result).toBe('denied');
    expect(uses[0].denialReason).toBe('Enlace expirado');

    expect(new Date(uses[1].occurredAt).getTime()).toBe(time2.getTime());
    expect(uses[1].result).toBe('denied');

    expect(new Date(uses[2].occurredAt).getTime()).toBe(time3.getTime());
    expect(uses[2].result).toBe('granted');
    expect(uses[2].denialReason).toBeNull();

    // Aislamiento: otra organización no obtiene los usos
    const otherOrgId = '00000000-0000-0000-0000-000000000099';
    const usesOther = await getAccessUsesForDossier(otherOrgId, dossier.id);
    expect(usesOther).toHaveLength(0);
  }, 60000);

  it('Verifica el flujo de revocación de enlace: getActiveAccessLinkForDossier devuelve null y el portal rechaza el token', async () => {
    const adminUser = await createTestAuthUser(`admin-revokeflow-${Date.now()}@test-hu010-acc.com`, 'Admin Revoke Flow');
    const analystUser = await createTestAuthUser(`analyst-revokeflow-${Date.now()}@test-hu010-acc.com`, 'Analyst Revoke Flow');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Revoke Flow Org S.A.S.' });
    await seedBaseConfiguration(org.id, adminUser);
    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: analystUser,
      role: 'compliance_analyst',
    });

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
      rolesConfig: [
        {
          code: 'compliance_analyst',
          name: 'Analista de Cumplimiento',
          permissions: ['dossier:view', 'dossier:edit', 'dossier:create'],
        },
        {
          code: 'admin',
          name: 'Administrador',
          permissions: ['configuration:view', 'configuration:publish'],
        },
      ],
    });

    const cpType = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'proveedor_custom',
      nature: 'legal_entity',
    });

    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: cpType.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });

    await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft.versionId,
      publishedBy: adminUser,
      reason: 'Config for revoke test',
    });

    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: analystUser,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '901234567-9',
        declaredName: 'Proveedor Revoke Flow S.A.S.',
      },
      internalOwnerId: analystUser,
    });

    // 1. Emitir enlace
    const issuedLink = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: false,
      recipientEmail: 'contacto@revokeflow.com',
    });
    expect(issuedLink.rawToken).toBeDefined();

    // 2. Comprobar que el enlace activo existe
    const activeLinkBefore = await getActiveAccessLinkForDossier(org.id, dossier.id);
    expect(activeLinkBefore).not.toBeNull();
    expect(activeLinkBefore?.id).toBe(issuedLink.id);
    expect(activeLinkBefore?.state).toBe('active');

    // 3. Revocar enlace
    await revokeAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      revokedBy: analystUser,
    });

    // 4. getActiveAccessLinkForDossier debe devolver null
    const activeLinkAfter = await getActiveAccessLinkForDossier(org.id, dossier.id);
    expect(activeLinkAfter).toBeNull();

    // 5. El portal público debe rechazar el token con motivo 'revoked'
    const resolveResult = await resolveAccessToken(issuedLink.rawToken, {
      ipAddress: '127.0.0.1',
      userAgent: 'Vitest Revoke Test Runner',
    });
    expect(resolveResult.outcome).toBe('denied');
    expect(resolveResult.denialReason).toBe('revoked');
  }, 60000);

  it('HU-063: Reemitir el enlace sobre un expediente en expirado_pendiente lo regresa a en_diligenciamiento y conserva datos', async () => {
    const adminUser = await createTestAuthUser(`admin-reactivate-${Date.now()}@test-hu010-acc.com`, 'Admin Reactivate');
    const analystUser = await createTestAuthUser(`analyst-reactivate-${Date.now()}@test-hu010-acc.com`, 'Analyst Reactivate');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Reactivate Org S.A.S.' });
    await seedBaseConfiguration(org.id, adminUser);
    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: analystUser,
      role: 'compliance_analyst',
    });

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
      rolesConfig: [
        {
          code: 'compliance_analyst',
          name: 'Analista de Cumplimiento',
          permissions: ['dossier:view', 'dossier:edit', 'dossier:create'],
        },
        {
          code: 'admin',
          name: 'Administrador',
          permissions: ['configuration:view', 'configuration:publish'],
        },
      ],
    });

    const cpType = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'proveedor_custom',
      nature: 'legal_entity',
    });

    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: cpType.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });

    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: cpType.id,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'doc_rut',
      mandatory: 'always',
    });

    await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft.versionId,
      publishedBy: adminUser,
      reason: 'Config for reactivation test',
    });

    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: analystUser,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '901234567-8',
        declaredName: 'Proveedor Reactivacion S.A.S.',
      },
      internalOwnerId: analystUser,
    });

    // 1. Emitir enlace inicial
    const initialLink = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: false,
      recipientEmail: 'contacto@reactivacion.com',
    });

    // 2. Contraparte entra y pasa a en_diligenciamiento
    await executeTransition({
      organizationId: org.id,
      dossierId: dossier.id,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    // 3. Contraparte diligencia un campo y carga un documento parcial
    const assertionRes = await registerAssertion({
      organizationId: org.id,
      dossierId: dossier.id,
      partyId: dossier.partyId,
      configurationVersionId: dossier.configurationVersionId,
      field: 'tax_id',
      value: '901234567-8',
      origin: 'declared',
    });

    const docRes = await confirmDocumentUpload({
      organizationId: org.id,
      dossierId: dossier.id,
      documentType: 'doc_rut',
      storagePath: `${dossier.id}/doc_rut/rut.pdf`,
      hash: 'b'.repeat(64),
      format: 'pdf',
      size: 2048,
      uploadedByType: 'counterparty',
    });

    // 4. Simular que el enlace venció y el sistema pasa el expediente a expirado_pendiente
    await executeTransition({
      organizationId: org.id,
      dossierId: dossier.id,
      toState: 'expirado_pendiente',
      actorType: 'system',
    });

    const [expiredDossier] = await adminSql<{ state: string }[]>`
      SELECT state FROM public.dossiers WHERE id = ${dossier.id}
    `;
    expect(expiredDossier.state).toBe('expirado_pendiente');

    // 5. Usuario interno reemite el enlace de acceso
    const newLink = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: false,
      recipientEmail: 'contacto@reactivacion.com',
    });
    expect(newLink.rawToken).toBeDefined();

    // 6. El expediente debe regresar automáticamente a 'en_diligenciamiento'
    const [reactivatedDossier] = await adminSql<{ state: string }[]>`
      SELECT state FROM public.dossiers WHERE id = ${dossier.id}
    `;
    expect(reactivatedDossier.state).toBe('en_diligenciamiento');

    // 7. Las afirmaciones y documentos previos siguen intactos
    const [persistedAssertion] = await adminSql<{ value: unknown }[]>`
      SELECT value FROM public.assertions WHERE id = ${assertionRes.id}
    `;
    expect(persistedAssertion.value).toBe('901234567-8');

    const [persistedDoc] = await adminSql<{ id: string; state: string }[]>`
      SELECT id, state FROM public.documents WHERE id = ${docRes.id}
    `;
    expect(persistedDoc.id).toBe(docRes.id);

    // 8. El enlace anterior quedó 'replaced'
    const [oldTokenRow] = await adminSql<{ state: string }[]>`
      SELECT state FROM public.dossier_access_tokens WHERE id = ${initialLink.id}
    `;
    expect(oldTokenRow.state).toBe('replaced');
  }, 60000);
});
