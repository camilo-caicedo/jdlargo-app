import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { createOrganizationWithAdmin, grantMembership } from '../organizations/use-cases';
import { seedBaseConfiguration } from '../auth/role-config';
import { createDraftConfiguration, publishDraftConfiguration } from '../configuration/service';
import { addCounterpartyType, addRequirement } from '../configuration/requirement-matrix';
import { createDossierRequest } from './dossier';
import { issueAccessLink } from './access';
import { executeTransition } from './state-machine';
import { registerAssertion } from '../assertions/service';
import { detectAndProcessExpiredDossiers } from './expiration';
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
  const userId = res[0].id;
  await adminSql`UPDATE public.users SET name = ${name} WHERE id = ${userId}`;
  return userId;
}

const TEST_ORG_NAMES = [
  'Expiry Alfa Org S.A.S.',
  'Expiry Beta Org S.A.S.',
];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu063.com')
  `;
  await adminSql`
    DELETE FROM public.assertions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.documents
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu063.com')
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
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu063.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu063.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-063: Expiración y reactivación del acceso de la contraparte', () => {
  beforeAll(async () => {
    await cleanupTestData();
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  }, 60000);

  beforeEach(() => {
    mockSentEmails.length = 0;
  });

  it('Escenario: El expediente pasa a Expirado/Pendiente cuando el enlace vence sin avance y conserva datos', async () => {
    const admin = await createTestAuthUser(`admin-exp1-${Date.now()}@test-hu063.com`, 'Admin Expiry 1');
    const analyst = await createTestAuthUser(`analyst-exp1-${Date.now()}@test-hu063.com`, 'Analyst Expiry 1');

    const org = await createOrganizationWithAdmin(admin, { name: 'Expiry Alfa Org S.A.S.' });
    await seedBaseConfiguration(org.id, admin);
    await grantMembership(admin, { organizationId: org.id, userId: analyst, role: 'compliance_analyst' });

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
      rolesConfig: [
        { code: 'compliance_analyst', name: 'Analista de Cumplimiento', permissions: ['dossier:view', 'dossier:edit', 'dossier:create'] },
        { code: 'compliance_officer', name: 'Oficial de Cumplimiento', permissions: ['dossier:view', 'dossier:edit', 'dossier:approve'] },
        { code: 'admin', name: 'Administrador', permissions: ['configuration:view', 'configuration:publish'] },
      ],
    });
    const cpType = await addCounterpartyType({ organizationId: org.id, configurationVersionId: draft.versionId, name: 'proveedor_custom', nature: 'legal_entity' });
    await addRequirement({ organizationId: org.id, configurationVersionId: draft.versionId, counterpartyTypeId: cpType.id, standard: 'SARLAFT', type: 'field', key: 'tax_id', mandatory: 'always', validation: { dataType: 'string' } });
    await publishDraftConfiguration({ organizationId: org.id, versionId: draft.versionId, publishedBy: admin, reason: 'Config 1' });

    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: analyst,
      counterpartyTypeName: 'proveedor_custom',
      party: { identificationType: 'NIT', identificationNumber: '900111222-1', declaredName: 'Alfa Contraparte S.A.S.' },
      internalOwnerId: analyst,
    });

    const link = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: analyst,
      requiresSecondFactor: false,
      recipientEmail: 'contraparte@alfa.com',
    });

    // Pasa a en_diligenciamiento y diligencia datos
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'en_diligenciamiento', actorType: 'counterparty' });
    const assertionRes = await registerAssertion({
      organizationId: org.id,
      dossierId: dossier.id,
      partyId: dossier.partyId,
      configurationVersionId: dossier.configurationVersionId,
      field: 'tax_id',
      value: '900111222-1',
      origin: 'declared',
    });

    // Simular que el token venció
    await adminSql`SET app.allow_config_cleanup = 'true'`;
    await adminSql`
      UPDATE public.dossier_access_tokens
      SET expires_at = now() - interval '1 hour'
      WHERE id = ${link.id}
    `;
    await adminSql`RESET app.allow_config_cleanup`;

    // Ejecutar detección
    const summary = await detectAndProcessExpiredDossiers();
    expect(summary.transitionedToExpired).toBeGreaterThanOrEqual(1);

    // Expediente pasó a expirado_pendiente
    const [updatedDossier] = await adminSql<{ state: string }[]>`
      SELECT state FROM public.dossiers WHERE id = ${dossier.id}
    `;
    expect(updatedDossier.state).toBe('expirado_pendiente');

    // Bitácora registra la transición
    const transitions = await adminSql<{ from_state: string; to_state: string; actor_type: string }[]>`
      SELECT from_state, to_state, actor_type FROM public.dossier_transitions
      WHERE dossier_id = ${dossier.id} AND to_state = 'expirado_pendiente'
    `;
    expect(transitions).toHaveLength(1);
    expect(transitions[0].from_state).toBe('en_diligenciamiento');
    expect(transitions[0].actor_type).toBe('system');

    // Datos permanecen intactos
    const [persistedAssertion] = await adminSql<{ value: unknown }[]>`
      SELECT value FROM public.assertions WHERE id = ${assertionRes.id}
    `;
    expect(persistedAssertion.value).toBe('900111222-1');

    // En la primera corrida se envió 1 recordatorio
    const reminderEmails = mockSentEmails.filter((e) => e.type === 'expiration_reminder');
    expect(reminderEmails.length).toBeGreaterThanOrEqual(1);
  }, 60000);

  it('Escenario: Recordatorio automático al responsable interno y no duplica el mismo día', async () => {
    // Tomamos el expediente ya en expirado_pendiente de la prueba anterior
    const [dossierRow] = await adminSql<{ id: string; organization_id: string }[]>`
      SELECT id, organization_id FROM public.dossiers WHERE state = 'expirado_pendiente' LIMIT 1
    `;
    expect(dossierRow).toBeDefined();

    mockSentEmails.length = 0;

    // Ejecutar de nuevo en el mismo día: NO debe enviar otro recordatorio ni transicionar de nuevo
    const summarySecondRun = await detectAndProcessExpiredDossiers();
    expect(summarySecondRun.transitionedToExpired).toBe(0);
    expect(summarySecondRun.remindersSent).toBe(0);
    expect(mockSentEmails.filter((e) => e.type === 'expiration_reminder')).toHaveLength(0);
  }, 60000);

  it('Escenario: Tras 3 recordatorios sin acción, se escala a los miembros con dossier:approve y no se repite', async () => {
    const [dossierRow] = await adminSql<{ id: string; organization_id: string; configuration_version_id: string }[]>`
      SELECT id, organization_id, configuration_version_id FROM public.dossiers WHERE state = 'expirado_pendiente' LIMIT 1
    `;

    // Obtener el admin de la organización para otorgar membresía
    const [adminMember] = await adminSql<{ user_id: string }[]>`
      SELECT user_id FROM public.memberships WHERE organization_id = ${dossierRow.organization_id} AND role = 'admin' LIMIT 1
    `;

    // Crear un oficial de cumplimiento con dossier:approve
    const officer = await createTestAuthUser(`officer-exp1-${Date.now()}@test-hu063.com`, 'Oficial Cumplimiento');
    await grantMembership(adminMember.user_id, { organizationId: dossierRow.organization_id, userId: officer, role: 'compliance_officer' });

    // Inyectar 2 recordatorios previos simulados con fechas anteriores en audit_log para sumar 3 recordatorios en total
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    await adminSql`
      INSERT INTO public.audit_log (
        organization_id, actor_type, action, entity, entity_id,
        configuration_version_id, automatic, occurred_at, event_hash
      ) VALUES
        (${dossierRow.organization_id}, 'system', 'dossier.expiration_reminder_sent', 'dossier', ${dossierRow.id}, ${dossierRow.configuration_version_id}, true, ${yesterday}, 'hash-fake-reminder-1'),
        (${dossierRow.organization_id}, 'system', 'dossier.expiration_reminder_sent', 'dossier', ${dossierRow.id}, ${dossierRow.configuration_version_id}, true, ${twoDaysAgo}, 'hash-fake-reminder-2')
    `;

    // Simular que el último recordatorio fue ayer (cambiamos occurred_at del recordatorio de hoy)
    await adminSql`SET app.allow_config_cleanup = 'true'`;
    await adminSql`
      UPDATE public.audit_log
      SET occurred_at = now() - interval '3 days'
      WHERE entity_id = ${dossierRow.id}
        AND action = 'dossier.expiration_reminder_sent'
        AND occurred_at >= date_trunc('day', now())
    `;
    await adminSql`RESET app.allow_config_cleanup`;

    mockSentEmails.length = 0;

    // Ejecutar detección: con 3 recordatorios previos, debe enviar ESCALACIÓN
    const summaryEscalation = await detectAndProcessExpiredDossiers();
    expect(summaryEscalation.escalationsSent).toBe(1);

    const escalationEmails = mockSentEmails.filter((e) => e.type === 'expiration_escalation');
    expect(escalationEmails.length).toBeGreaterThanOrEqual(1);

    // Auditoría de escalación registrada
    const [escalatedAudit] = await adminSql<{ action: string }[]>`
      SELECT action FROM public.audit_log
      WHERE entity_id = ${dossierRow.id} AND action = 'dossier.expiration_escalated'
    `;
    expect(escalatedAudit).toBeDefined();

    // Corridas posteriores: NO debe repetir la escalación
    mockSentEmails.length = 0;
    const summaryPostEscalation = await detectAndProcessExpiredDossiers();
    expect(summaryPostEscalation.escalationsSent).toBe(0);
    expect(summaryPostEscalation.remindersSent).toBe(0);
    expect(mockSentEmails).toHaveLength(0);
  }, 60000);

  it('Escenario: Un expediente que ya avanzó (documentos_recibidos) no entra en Expirado/Pendiente', async () => {
    const admin = await createTestAuthUser(`admin-exp2-${Date.now()}@test-hu063.com`, 'Admin Expiry 2');
    const org = await createOrganizationWithAdmin(admin, { name: 'Expiry Beta Org S.A.S.' });
    await seedBaseConfiguration(org.id, admin);

    const draft = await createDraftConfiguration({ organizationId: org.id, standard: 'SARLAFT' });
    const cpType = await addCounterpartyType({ organizationId: org.id, configurationVersionId: draft.versionId, name: 'proveedor_custom', nature: 'legal_entity' });
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
    await publishDraftConfiguration({ organizationId: org.id, versionId: draft.versionId, publishedBy: admin, reason: 'Config Beta' });

    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: admin,
      counterpartyTypeName: 'proveedor_custom',
      party: { identificationType: 'NIT', identificationNumber: '900222333-2', declaredName: 'Beta Avanzado S.A.S.' },
      internalOwnerId: admin,
    });

    const link = await issueAccessLink({
      organizationId: org.id,
      dossierId: dossier.id,
      issuedBy: admin,
      requiresSecondFactor: false,
      recipientEmail: 'contacto@beta.com',
    });

    // Avanzar a documentos_recibidos
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'en_diligenciamiento', actorType: 'counterparty' });
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'documentos_recibidos', actorType: 'counterparty' });

    // Simular que el enlace venció
    await adminSql`SET app.allow_config_cleanup = 'true'`;
    await adminSql`
      UPDATE public.dossier_access_tokens
      SET expires_at = now() - interval '10 days'
      WHERE id = ${link.id}
    `;
    await adminSql`RESET app.allow_config_cleanup`;

    // Ejecutar detección
    await detectAndProcessExpiredDossiers();

    // El expediente debe permanecer en 'documentos_recibidos'
    const [dossierState] = await adminSql<{ state: string }[]>`
      SELECT state FROM public.dossiers WHERE id = ${dossier.id}
    `;
    expect(dossierState.state).toBe('documentos_recibidos');
  }, 60000);

  it('Escenario: Aislamiento entre organizaciones sobre la detección de expiración', async () => {
    // Tomamos el expediente de Expiry Alfa Org y creamos uno nuevo en Expiry Beta Org
    const [orgBeta] = await adminSql<{ id: string }[]>`SELECT id FROM public.organizations WHERE name = 'Expiry Beta Org S.A.S.'`;
    const [adminBetaOriginal] = await adminSql<{ user_id: string }[]>`
      SELECT user_id FROM public.memberships WHERE organization_id = ${orgBeta.id} AND role = 'admin' LIMIT 1
    `;

    const adminBeta = await createTestAuthUser(`admin-iso-beta-${Date.now()}@test-hu063.com`, 'Admin Beta Iso');
    await grantMembership(adminBetaOriginal.user_id, { organizationId: orgBeta.id, userId: adminBeta, role: 'admin' });

    const dossierBeta = await createDossierRequest({
      organizationId: orgBeta.id,
      requestedBy: adminBeta,
      counterpartyTypeName: 'proveedor_custom',
      party: { identificationType: 'NIT', identificationNumber: '900999888-9', declaredName: 'Beta Iso S.A.S.' },
      internalOwnerId: adminBeta,
    });

    const linkBeta = await issueAccessLink({
      organizationId: orgBeta.id,
      dossierId: dossierBeta.id,
      issuedBy: adminBeta,
      requiresSecondFactor: false,
      recipientEmail: 'contacto@betaiso.com',
    });

    // Simular que el enlace de Beta expiró
    await adminSql`SET app.allow_config_cleanup = 'true'`;
    await adminSql`
      UPDATE public.dossier_access_tokens
      SET expires_at = now() - interval '1 hour'
      WHERE id = ${linkBeta.id}
    `;
    await adminSql`RESET app.allow_config_cleanup`;

    mockSentEmails.length = 0;

    // Ejecutar detección
    await detectAndProcessExpiredDossiers();

    // Expediente de Beta pasó a expirado_pendiente
    const [betaState] = await adminSql<{ state: string }[]>`
      SELECT state FROM public.dossiers WHERE id = ${dossierBeta.id}
    `;
    expect(betaState.state).toBe('expirado_pendiente');

    // El recordatorio debe haber sido enviado a adminBeta, NO a usuarios de Alfa
    const reminderEmails = mockSentEmails.filter((e) => e.type === 'expiration_reminder');
    const betaEmails = reminderEmails.filter((e) => e.to.includes('admin-iso-beta'));
    expect(betaEmails.length).toBe(1);

    // Las bitácoras quedan estrictamente en su organization_id respectivo
    const betaAudit = await adminSql<{ organization_id: string }[]>`
      SELECT organization_id FROM public.audit_log WHERE entity_id = ${dossierBeta.id}
    `;
    expect(betaAudit.every((a) => a.organization_id === orgBeta.id)).toBe(true);
  }, 60000);
});

