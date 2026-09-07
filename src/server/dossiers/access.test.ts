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
import { issueAccessLink, revokeAccessLink } from './access';
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

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`DELETE FROM public.audit_log`;
  await adminSql`DELETE FROM public.assertions`;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`DELETE FROM public.memberships`;
  await adminSql`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`DELETE FROM public.dossier_access_otp_codes`;
  await adminSql`DELETE FROM public.dossier_access_uses`;
  await adminSql`DELETE FROM public.dossier_access_tokens`;
  await adminSql`DELETE FROM public.dossier_transitions`;
  await adminSql`DELETE FROM public.dossiers`;
  await adminSql`DELETE FROM public.parties`;
  await adminSql`DELETE FROM public.requirements`;
  await adminSql`DELETE FROM public.counterparty_types`;
  await adminSql`DELETE FROM public.role_permissions`;
  await adminSql`DELETE FROM public.roles`;
  await adminSql`DELETE FROM public.configuration_versions`;
  await adminSql`DELETE FROM public.organizations`;
  await adminSql`DELETE FROM public.users`;
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
      name: 'proveedor',
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
      counterpartyTypeName: 'proveedor',
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
      name: 'proveedor',
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
      counterpartyTypeName: 'proveedor',
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
    });

    // Emitir enlace 2 (reemplazo)
    const link2 = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analystUser,
      requiresSecondFactor: true,
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
      name: 'proveedor',
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
      counterpartyTypeName: 'proveedor',
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
});
