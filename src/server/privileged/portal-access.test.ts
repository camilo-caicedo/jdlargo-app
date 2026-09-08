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
import { createDossierRequest } from '../dossiers/dossier';
import { issueAccessLink, revokeAccessLink } from '../dossiers/access';
import { executeTransition } from '../dossiers/state-machine';
import {
  resolveAccessToken,
  requestOtpCode,
  verifyOtpCode,
  ensureEntryTransition,
} from './portal-access';
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
      jsonb_build_object('name', ${name}::text),
      now(),
      now()
    ) RETURNING id
  `;
  const userId = res[0].id;
  await adminSql`UPDATE public.users SET name = ${name} WHERE id = ${userId}`;
  return userId;
}

const TEST_ORG_NAMES = [
  'Portal Org 1',
  'Portal Org 2',
  'Portal Org 3',
  'Portal Org 4',
];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu010-portal.com')
  `;
  await adminSql`
    DELETE FROM public.assertions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu010-portal.com')
  `;
  await adminSql`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.dossier_access_otp_codes
    WHERE token_id IN (
      SELECT id FROM public.dossier_access_tokens
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
    )
  `;
  await adminSql`
    DELETE FROM public.dossier_access_uses
    WHERE token_id IN (
      SELECT id FROM public.dossier_access_tokens
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
    )
  `;
  await adminSql`
    DELETE FROM public.dossier_access_tokens
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
    DELETE FROM public.configuration_versions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.organizations
    WHERE name IN ${adminSql(TEST_ORG_NAMES)}
  `;
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu010-portal.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu010-portal.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-010: Acceso de la contraparte por enlace (Portal público privilegiado)', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  }, 60000);

  it('Escenario: Entrar con un enlace vigente (sin usuario) y transitar expediente', async () => {
    const adminUser = await createTestAuthUser('admin1@test-hu010-portal.com', 'Admin Portal 1');
    const opUser = await createTestAuthUser('op1@test-hu010-portal.com', 'Operativo Portal 1');
    const analystUser = await createTestAuthUser('analyst1@test-hu010-portal.com', 'Analista Portal 1');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Portal Org 1' });
    await seedBaseConfiguration(org.id, adminUser);
    await grantMembership(adminUser, { organizationId: org.id, userId: opUser, role: 'operational_user' });
    await grantMembership(adminUser, { organizationId: org.id, userId: analystUser, role: 'compliance_analyst' });

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
      rolesConfig: [
        { code: 'operational_user', name: 'Usuario operativo', permissions: ['dossier:create', 'dossier:view', 'document:upload'] },
        { code: 'compliance_analyst', name: 'Analista de Cumplimiento', permissions: ['dossier:view', 'dossier:edit', 'dossier:review', 'dossier:export', 'document:view', 'document:review', 'alert:view', 'alert:resolve', 'audit:view', 'configuration:view'] },
        { code: 'admin', name: 'Administrador', permissions: ['configuration:view', 'configuration:publish', 'configuration:administer', 'memberships:manage', 'audit:view'] },
      ],
    });
    const typeRes = await addCounterpartyType({ organizationId: org.id, configurationVersionId: draft.versionId, name: 'proveedor', nature: 'legal_entity' });
    await addRequirement({ organizationId: org.id, configurationVersionId: draft.versionId, counterpartyTypeId: typeRes.id, standard: 'SARLAFT', type: 'field', key: 'tax_id', mandatory: 'always', validation: { dataType: 'string' } });
    await publishDraftConfiguration({ organizationId: org.id, versionId: draft.versionId, publishedBy: adminUser, reason: 'Config 1' });

    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: opUser,
      counterpartyTypeName: 'proveedor',
      party: { identificationType: 'NIT', identificationNumber: '901888001-1', declaredName: 'Proveedor Portal S.A.S.' },
      internalOwnerId: analystUser,
    });

    // Mover expediente de 'borrador' a 'enviada' (usando analista con dossier:edit)
    await executeTransition({
      organizationId: org.id,
      dossierId: dossier.id,
      toState: 'enviada',
      actorType: 'user',
      actorId: analystUser,
    });

    // Emitir enlace de acceso
    const link = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: false,
      recipientEmail: 'contraparte@portal1.com',
    });

    // Resolver token desde el portal público
    const result = await resolveAccessToken(link.rawToken, {
      ipAddress: '190.25.100.4',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });

    expect(result.outcome).toBe('granted');
    expect(result.dossierId).toBe(dossier.id);
    expect(result.organizationId).toBe(org.id);

    // Disparar transición de entrada
    await ensureEntryTransition(dossier.id, org.id);

    // Comprobar que el estado del expediente avanzó a 'en_diligenciamiento'
    const [updatedDossier] = await adminSql<{ state: string }[]>`
      SELECT state FROM public.dossiers WHERE id = ${dossier.id}
    `;
    expect(updatedDossier.state).toBe('en_diligenciamiento');

    // Comprobar que el acceso quedó registrado en dossier_access_uses con fecha, ip y user_agent
    const [useRecord] = await adminSql<{ result: string; ip_address: string; user_agent: string }[]>`
      SELECT result, ip_address, user_agent FROM public.dossier_access_uses
      WHERE dossier_id = ${dossier.id}
    `;
    expect(useRecord).toBeDefined();
    expect(useRecord.result).toBe('granted');
    expect(useRecord.ip_address).toBe('190.25.100.4');
    expect(useRecord.user_agent).toContain('iPhone');
  }, 60000);

  it('Escenario: Un enlace expirado no deja entrar y muestra a quién dirigirse', async () => {
    const adminUser = await createTestAuthUser('admin2@test-hu010-portal.com', 'Admin Portal 2');
    const opUser = await createTestAuthUser('op2@test-hu010-portal.com', 'Operativo Portal 2');
    const analystUser = await createTestAuthUser('analyst2@test-hu010-portal.com', 'Juan Analista');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Portal Org 2' });
    await seedBaseConfiguration(org.id, adminUser);
    await grantMembership(adminUser, { organizationId: org.id, userId: opUser, role: 'operational_user' });
    await grantMembership(adminUser, { organizationId: org.id, userId: analystUser, role: 'compliance_analyst' });

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
      rolesConfig: [
        { code: 'operational_user', name: 'Usuario operativo', permissions: ['dossier:create', 'dossier:view', 'document:upload'] },
        { code: 'compliance_analyst', name: 'Analista de Cumplimiento', permissions: ['dossier:view', 'dossier:edit', 'dossier:review', 'dossier:export', 'document:view', 'document:review', 'alert:view', 'alert:resolve', 'audit:view', 'configuration:view'] },
        { code: 'admin', name: 'Administrador', permissions: ['configuration:view', 'configuration:publish', 'configuration:administer', 'memberships:manage', 'audit:view'] },
      ],
    });
    const typeRes = await addCounterpartyType({ organizationId: org.id, configurationVersionId: draft.versionId, name: 'proveedor', nature: 'legal_entity' });
    await addRequirement({ organizationId: org.id, configurationVersionId: draft.versionId, counterpartyTypeId: typeRes.id, standard: 'SARLAFT', type: 'field', key: 'tax_id', mandatory: 'always', validation: { dataType: 'string' } });
    await publishDraftConfiguration({ organizationId: org.id, versionId: draft.versionId, publishedBy: adminUser, reason: 'Config 2' });

    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: opUser,
      counterpartyTypeName: 'proveedor',
      party: { identificationType: 'NIT', identificationNumber: '901888002-2', declaredName: 'Proveedor Expirado S.A.S.' },
      internalOwnerId: analystUser,
    });

    const link = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: false,
      recipientEmail: 'contraparte@portal2.com',
    });

    // Modificar fecha de expiración para simular expirado en el pasado
    await adminSql`SET app.allow_config_cleanup = 'true'`;
    await adminSql`
      UPDATE public.dossier_access_tokens
      SET expires_at = now() - interval '2 days'
      WHERE id = ${link.id}
    `;
    await adminSql`RESET app.allow_config_cleanup`;

    // Intentar resolver desde portal
    const result = await resolveAccessToken(link.rawToken, {
      ipAddress: '181.49.50.2',
      userAgent: 'Chrome/120.0.0.0',
    });

    expect(result.outcome).toBe('denied');
    expect(result.denialReason).toBe('expired');
    expect(result.ownerContact).toBeDefined();
    expect(result.ownerContact?.name).toBe('Juan Analista');
    expect(result.ownerContact?.email).toBe('analyst2@test-hu010-portal.com');

    // Comprobar registro de intento en dossier_access_uses
    const [useRecord] = await adminSql<{ result: string; denial_reason: string; ip_address: string }[]>`
      SELECT result, denial_reason, ip_address FROM public.dossier_access_uses
      WHERE access_token_id = ${link.id}
    `;
    expect(useRecord.result).toBe('denied');
    expect(useRecord.denial_reason).toBe('expired');
    expect(useRecord.ip_address).toBe('181.49.50.2');
  }, 60000);

  it('Escenario: Segundo factor cuando la configuración lo exige', async () => {
    const adminUser = await createTestAuthUser('admin3@test-hu010-portal.com', 'Admin Portal 3');
    const opUser = await createTestAuthUser('op3@test-hu010-portal.com', 'Operativo Portal 3');
    const analystUser = await createTestAuthUser('analyst3@test-hu010-portal.com', 'Analista Portal 3');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Portal Org 3' });
    await seedBaseConfiguration(org.id, adminUser);
    await grantMembership(adminUser, { organizationId: org.id, userId: opUser, role: 'operational_user' });
    await grantMembership(adminUser, { organizationId: org.id, userId: analystUser, role: 'compliance_analyst' });

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
      rolesConfig: [
        { code: 'operational_user', name: 'Usuario operativo', permissions: ['dossier:create', 'dossier:view', 'document:upload'] },
        { code: 'compliance_analyst', name: 'Analista de Cumplimiento', permissions: ['dossier:view', 'dossier:edit', 'dossier:review', 'dossier:export', 'document:view', 'document:review', 'alert:view', 'alert:resolve', 'audit:view', 'configuration:view'] },
        { code: 'admin', name: 'Administrador', permissions: ['configuration:view', 'configuration:publish', 'configuration:administer', 'memberships:manage', 'audit:view'] },
      ],
    });
    const typeRes = await addCounterpartyType({ organizationId: org.id, configurationVersionId: draft.versionId, name: 'proveedor', nature: 'legal_entity' });
    await addRequirement({ organizationId: org.id, configurationVersionId: draft.versionId, counterpartyTypeId: typeRes.id, standard: 'SARLAFT', type: 'field', key: 'tax_id', mandatory: 'always', validation: { dataType: 'string' } });
    await publishDraftConfiguration({ organizationId: org.id, versionId: draft.versionId, publishedBy: adminUser, reason: 'Config 3' });

    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: opUser,
      counterpartyTypeName: 'proveedor',
      party: { identificationType: 'NIT', identificationNumber: '901888003-3', declaredName: 'Proveedor Segundo Factor S.A.S.' },
      internalOwnerId: analystUser,
    });

    // Emitir enlace con requiresSecondFactor = true
    const link = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: true,
      recipientEmail: 'contraparte@segundofactor.com',
    });

    const resolveRes = await resolveAccessToken(link.rawToken, {
      ipAddress: '190.0.0.1',
      userAgent: 'Mozilla/5.0',
    });

    expect(resolveRes.outcome).toBe('granted');
    expect(resolveRes.requiresSecondFactor).toBe(true);

    // Solicitar código OTP
    await requestOtpCode(link.id);

    // Obtener código generado desde la memoria de tests mockSentEmails
    const otpEmail = mockSentEmails.find((e) => e.type === 'otp');
    expect(otpEmail).toBeDefined();
    const sentCode = otpEmail?.payload.code as string;
    expect(sentCode).toHaveLength(6);

    // Intento con código erróneo
    const badVerify = await verifyOtpCode(link.id, '000000');
    expect(badVerify.verified).toBe(false);

    // Intento con código correcto
    const goodVerify = await verifyOtpCode(link.id, sentCode);
    expect(goodVerify.verified).toBe(true);

    // Intentar reutilizar el código ya consumido
    const reuseVerify = await verifyOtpCode(link.id, sentCode);
    expect(reuseVerify.verified).toBe(false);
    expect(reuseVerify.reason).toContain('ya ha sido utilizado');

    // Confirmar que las operaciones privilegiadas escribieron en public.audit_log
    const portalAuditLogs = await adminSql<{ action: string; actor_type: string }[]>`
      SELECT action, actor_type FROM public.audit_log
      WHERE organization_id = ${org.id}
        AND action IN ('portal.resolve_access_token', 'portal.request_otp_code', 'portal.verify_otp_code')
    `;
    expect(portalAuditLogs.length).toBeGreaterThanOrEqual(3);
    expect(portalAuditLogs.some((l) => l.action === 'portal.resolve_access_token')).toBe(true);
    expect(portalAuditLogs.some((l) => l.action === 'portal.request_otp_code')).toBe(true);
    expect(portalAuditLogs.some((l) => l.action === 'portal.verify_otp_code')).toBe(true);
    expect(portalAuditLogs.every((l) => l.actor_type === 'system')).toBe(true);
  }, 60000);

  it('Escenario: Un enlace revocado o reemplazado no permite acceso y registra el intento', async () => {
    const adminUser = await createTestAuthUser('admin4@test-hu010-portal.com', 'Admin Portal 4');
    const opUser = await createTestAuthUser('op4@test-hu010-portal.com', 'Operativo Portal 4');
    const analystUser = await createTestAuthUser('analyst4@test-hu010-portal.com', 'Analista Portal 4');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Portal Org 4' });
    await seedBaseConfiguration(org.id, adminUser);
    await grantMembership(adminUser, { organizationId: org.id, userId: opUser, role: 'operational_user' });
    await grantMembership(adminUser, { organizationId: org.id, userId: analystUser, role: 'compliance_analyst' });

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
      rolesConfig: [
        { code: 'operational_user', name: 'Usuario operativo', permissions: ['dossier:create', 'dossier:view', 'document:upload'] },
        { code: 'compliance_analyst', name: 'Analista de Cumplimiento', permissions: ['dossier:view', 'dossier:edit', 'dossier:review', 'dossier:export', 'document:view', 'document:review', 'alert:view', 'alert:resolve', 'audit:view', 'configuration:view'] },
        { code: 'admin', name: 'Administrador', permissions: ['configuration:view', 'configuration:publish', 'configuration:administer', 'memberships:manage', 'audit:view'] },
      ],
    });
    const typeRes = await addCounterpartyType({ organizationId: org.id, configurationVersionId: draft.versionId, name: 'proveedor', nature: 'legal_entity' });
    await addRequirement({ organizationId: org.id, configurationVersionId: draft.versionId, counterpartyTypeId: typeRes.id, standard: 'SARLAFT', type: 'field', key: 'tax_id', mandatory: 'always', validation: { dataType: 'string' } });
    await publishDraftConfiguration({ organizationId: org.id, versionId: draft.versionId, publishedBy: adminUser, reason: 'Config 4' });

    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: opUser,
      counterpartyTypeName: 'proveedor',
      party: { identificationType: 'NIT', identificationNumber: '901888004-4', declaredName: 'Proveedor Revocado y Reemplazado S.A.S.' },
      internalOwnerId: analystUser,
    });

    // 1. Probar rama 'revoked'
    const linkRevoked = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: false,
      recipientEmail: 'revoked@portal.com',
    });

    await revokeAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      revokedBy: analystUser,
    });

    const revokedResult = await resolveAccessToken(linkRevoked.rawToken, {
      ipAddress: '186.20.10.1',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });

    expect(revokedResult.outcome).toBe('denied');
    expect(revokedResult.denialReason).toBe('revoked');

    // Confirmar que se registró en dossier_access_uses
    const [revokedUse] = await adminSql<{ result: string; denial_reason: string }[]>`
      SELECT result, denial_reason FROM public.dossier_access_uses
      WHERE access_token_id = ${linkRevoked.id}
    `;
    expect(revokedUse.result).toBe('denied');
    expect(revokedUse.denial_reason).toBe('revoked');

    // 2. Probar rama 'replaced'
    const link1 = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: false,
      recipientEmail: 'replaced@portal.com',
    });

    // Al emitir link2, link1 pasa atómicamente a 'replaced'
    const link2 = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: false,
      recipientEmail: 'active@portal.com',
    });

    const replacedResult = await resolveAccessToken(link1.rawToken, {
      ipAddress: '186.20.10.2',
      userAgent: 'Mozilla/5.0 (Macintosh)',
    });

    expect(replacedResult.outcome).toBe('denied');
    expect(replacedResult.denialReason).toBe('replaced');

    // Confirmar que se registró en dossier_access_uses
    const [replacedUse] = await adminSql<{ result: string; denial_reason: string }[]>`
      SELECT result, denial_reason FROM public.dossier_access_uses
      WHERE access_token_id = ${link1.id}
    `;
    expect(replacedUse.result).toBe('denied');
    expect(replacedUse.denial_reason).toBe('replaced');

    // Y el nuevo enlace link2 sí resuelve granted
    const activeResult = await resolveAccessToken(link2.rawToken, {
      ipAddress: '186.20.10.3',
      userAgent: 'Mozilla/5.0 (Linux)',
    });
    expect(activeResult.outcome).toBe('granted');
  }, 60000);
});
