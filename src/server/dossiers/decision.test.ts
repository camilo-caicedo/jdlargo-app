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
import { executeTransition } from './state-machine';
import { registerAssertion } from '../assertions/service';
import { confirmDocumentUpload, markDocumentValid } from '../documents/document';
import { recordDecision, getDecisionsForDossier } from './decision';
import { getEntityAuditHistory } from '../audit/service';

const directUrl = process.env.DIRECT_URL;
const adminSql = postgres(directUrl || '');

async function createTestAuthUser(email: string, name: string): Promise<string> {
  const meta = JSON.stringify({ name });
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
      ${meta}::jsonb,
      now(),
      now()
    ) RETURNING id
  `;
  return res[0].id;
}

const TEST_ORG_NAMES = ['Decision Domain Org Test', 'Decision Org Other'];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR configuration_version_id IN (
         SELECT id FROM public.configuration_versions
         WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       )
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu015-dec.com')
  `;
  await adminSql`
    DELETE FROM public.decision_conditions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.decisions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.assertions
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
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu015-dec.com')
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
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu015-dec.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu015-dec.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-015: Decisión del Oficial de Cumplimiento', () => {
  let orgId: string;
  let adminUserId: string;
  let analystUserId: string;
  let officerUserId: string;
  let configVersionId: string;

  beforeAll(async () => {
    await cleanupTestData();

    adminUserId = await createTestAuthUser('admin@test-hu015-dec.com', 'Admin Decision');
    analystUserId = await createTestAuthUser('analyst@test-hu015-dec.com', 'Analyst Decision');
    officerUserId = await createTestAuthUser('officer@test-hu015-dec.com', 'Officer Decision');

    const org = await createOrganizationWithAdmin(adminUserId, {
      name: 'Decision Domain Org Test',
    });
    orgId = org.id;

    await seedBaseConfiguration(orgId, adminUserId);

    // Grant roles:
    // analyst has compliance_analyst (no dossier:approve)
    // officer has compliance_officer (has dossier:approve and dossier:edit)
    await grantMembership(adminUserId, {
      organizationId: orgId,
      userId: analystUserId,
      role: 'compliance_analyst',
    });
    await grantMembership(adminUserId, {
      organizationId: orgId,
      userId: officerUserId,
      role: 'compliance_officer',
    });

    const draft = await createDraftConfiguration({
      organizationId: orgId,
      standard: 'SARLAFT',
    });

    const cpType = await addCounterpartyType({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });

    await addRequirement({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: cpType.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'legal_name',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });

    await addRequirement({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: cpType.id,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'rut',
      mandatory: 'always',
    });

    const published = await publishDraftConfiguration({
      organizationId: orgId,
      versionId: draft.versionId,
      publishedBy: adminUserId,
      reason: 'Publicación para tests de decisión',
    });
    configVersionId = published.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  });

  /**
   * Helper to create a dossier at 'pendiente_de_decision' state with 1 active assertion and 1 valid document
   */
  async function setupDossierInPendingDecision(idNumber: string) {
    const d = await createDossierRequest({
      organizationId: orgId,
      counterpartyTypeName: 'proveedor',
      party: {
        identificationType: 'NIT',
        identificationNumber: idNumber,
        declaredName: `Proveedor Test ${idNumber}`,
      },
      requestedBy: adminUserId,
      internalOwnerId: adminUserId,
    });

    // Register active assertion
    const assertion = await registerAssertion({
      organizationId: orgId,
      dossierId: d.id,
      partyId: d.partyId,
      configurationVersionId: configVersionId,
      field: 'legal_name',
      value: 'Proveedor Decision Test SAS',
      origin: 'declared',
    });

    // borrador -> enviada -> en_diligenciamiento
    await executeTransition({
      organizationId: orgId,
      dossierId: d.id,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUserId,
    });
    await executeTransition({
      organizationId: orgId,
      dossierId: d.id,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    // Upload & validate document
    const doc = await confirmDocumentUpload({
      organizationId: orgId,
      dossierId: d.id,
      documentType: 'rut',
      storagePath: `test/${d.id}/rut.pdf`,
      hash: `hash-${d.id}`,
      format: 'pdf',
      size: 1024,
      uploadedByType: 'user',
      uploadedByUserId: adminUserId,
    });
    await markDocumentValid({
      organizationId: orgId,
      dossierId: d.id,
      documentId: doc.id,
      reviewedBy: analystUserId,
    });

    // Transitions to reach 'pendiente_de_decision'
    // en_diligenciamiento -> documentos_recibidos -> en_revision -> pendiente_de_decision
    await executeTransition({
      organizationId: orgId,
      dossierId: d.id,
      toState: 'documentos_recibidos',
      actorType: 'counterparty',
    });
    await executeTransition({
      organizationId: orgId,
      dossierId: d.id,
      toState: 'en_revision',
      actorType: 'user',
      actorId: analystUserId,
    });
    await executeTransition({
      organizationId: orgId,
      dossierId: d.id,
      toState: 'pendiente_de_decision',
      actorType: 'user',
      actorId: analystUserId,
    });

    return {
      dossierId: d.id,
      assertionId: assertion.id,
      documentId: doc.id,
    };
  }

  it('Escenario: Aprobar una vinculación', async () => {
    const { dossierId, assertionId, documentId } = await setupDossierInPendingDecision('900100101-1');

    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const res = await recordDecision({
      organizationId: orgId,
      dossierId,
      type: 'approve',
      responsibleId: officerUserId,
      title: 'Oficial de Cumplimiento Titular',
      rationale: 'Se verificó documentación completa y no hay hallazgos LA/FT.',
      evidence: [
        { kind: 'assertion', id: assertionId },
        { kind: 'document', id: documentId },
      ],
      validUntil: futureDate,
    });

    expect(res.id).toBeDefined();

    // Check dossier state transitioned to 'aprobada'
    const [dossier] = await adminSql`SELECT state FROM dossiers WHERE id = ${dossierId}`;
    expect(dossier.state).toBe('aprobada');

    // Check decisions table
    const decisions = await getDecisionsForDossier(orgId, dossierId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].type).toBe('approve');
    expect(decisions[0].title).toBe('Oficial de Cumplimiento Titular');
    expect(decisions[0].rationale).toBe('Se verificó documentación completa y no hay hallazgos LA/FT.');
    expect(decisions[0].evidence).toHaveLength(2);
    expect(decisions[0].conditions).toHaveLength(0);

    // Check audit trail
    const auditLogs = await getEntityAuditHistory(orgId, 'dossier', dossierId);
    const decisionLog = auditLogs.find((l) => l.action === 'dossier.decision_recorded');
    expect(decisionLog).toBeDefined();
    expect(decisionLog?.metadata?.decision_type).toBe('approve');
  });

  it('Escenario: Aprobar con condiciones', async () => {
    const { dossierId, assertionId, documentId } = await setupDossierInPendingDecision('900100102-2');

    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const res = await recordDecision({
      organizationId: orgId,
      dossierId,
      type: 'approve_with_conditions',
      responsibleId: officerUserId,
      title: 'Oficial de Cumplimiento Suplente',
      rationale: 'Aprobación condicionada a actualización de estados financieros semestrales.',
      evidence: [
        { kind: 'assertion', id: assertionId },
        { kind: 'document', id: documentId },
      ],
      validUntil: futureDate,
      conditions: [
        'Presentar estados financieros al corte de junio 30',
        'Actualizar composición accionaria si supera el 5%',
      ],
    });

    expect(res.id).toBeDefined();

    // Check dossier state transitioned to 'aprobada_con_condiciones'
    const [dossier] = await adminSql`SELECT state FROM dossiers WHERE id = ${dossierId}`;
    expect(dossier.state).toBe('aprobada_con_condiciones');

    // Check decisions & conditions
    const decisions = await getDecisionsForDossier(orgId, dossierId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].type).toBe('approve_with_conditions');
    expect(decisions[0].conditions).toHaveLength(2);
    expect(decisions[0].conditions[0]).toBe('Presentar estados financieros al corte de junio 30');
    expect(decisions[0].conditions[1]).toBe('Actualizar composición accionaria si supera el 5%');
  });

  it('Escenario: Rechazar una vinculación', async () => {
    const { dossierId, documentId } = await setupDossierInPendingDecision('900100103-3');

    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const res = await recordDecision({
      organizationId: orgId,
      dossierId,
      type: 'reject',
      responsibleId: officerUserId,
      title: 'Oficial de Cumplimiento',
      rationale: 'Contraparte vinculada en listas restrictivas vinculantes.',
      evidence: [{ kind: 'document', id: documentId }],
      validUntil: futureDate,
    });

    expect(res.id).toBeDefined();

    const [dossier] = await adminSql`SELECT state FROM dossiers WHERE id = ${dossierId}`;
    expect(dossier.state).toBe('rechazada');
  });

  it('Escenario: Una decisión sin fundamento o evidencia no se registra', async () => {
    const { dossierId, documentId } = await setupDossierInPendingDecision('900100104-4');

    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    // 1. Sin fundamento
    await expect(
      recordDecision({
        organizationId: orgId,
        dossierId,
        type: 'approve',
        responsibleId: officerUserId,
        title: 'Oficial de Cumplimiento',
        rationale: '   ',
        evidence: [{ kind: 'document', id: documentId }],
        validUntil: futureDate,
      }),
    ).rejects.toThrow('El fundamento de la decisión es obligatorio y no puede estar vacío');

    // Estado no cambia
    let [dossier] = await adminSql`SELECT state FROM dossiers WHERE id = ${dossierId}`;
    expect(dossier.state).toBe('pendiente_de_decision');

    // 2. Sin evidencia
    await expect(
      recordDecision({
        organizationId: orgId,
        dossierId,
        type: 'approve',
        responsibleId: officerUserId,
        title: 'Oficial de Cumplimiento',
        rationale: 'Fundamento válido',
        evidence: [],
        validUntil: futureDate,
      }),
    ).rejects.toThrow('Debe indicar al menos una evidencia en la que se basó la decisión');

    // 3. Con evidencia inexistente
    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    await expect(
      recordDecision({
        organizationId: orgId,
        dossierId,
        type: 'approve',
        responsibleId: officerUserId,
        title: 'Oficial de Cumplimiento',
        rationale: 'Fundamento válido',
        evidence: [{ kind: 'document', id: fakeUuid }],
        validUntil: futureDate,
      }),
    ).rejects.toThrow(/no existe para este expediente/);

    // No queda ninguna decisión
    const decisions = await getDecisionsForDossier(orgId, dossierId);
    expect(decisions).toHaveLength(0);

    [dossier] = await adminSql`SELECT state FROM dossiers WHERE id = ${dossierId}`;
    expect(dossier.state).toBe('pendiente_de_decision');
  });

  it('Escenario: La decisión es inmutable (triggers de inmutabilidad)', async () => {
    const { dossierId, assertionId } = await setupDossierInPendingDecision('900100105-5');

    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const res = await recordDecision({
      organizationId: orgId,
      dossierId,
      type: 'approve_with_conditions',
      responsibleId: officerUserId,
      title: 'Oficial de Cumplimiento',
      rationale: 'Aprobada con condiciones para test de inmutabilidad.',
      evidence: [{ kind: 'assertion', id: assertionId }],
      validUntil: futureDate,
      conditions: ['Condicion 1'],
    });

    // Attempt direct UPDATE on decisions without cleanup bypass -> must fail
    await expect(
      adminSql`UPDATE decisions SET rationale = 'Hacked rationale' WHERE id = ${res.id}`,
    ).rejects.toThrow(/immutable/i);

    // Attempt direct DELETE on decisions -> must fail
    await expect(
      adminSql`DELETE FROM decisions WHERE id = ${res.id}`,
    ).rejects.toThrow(/immutable/i);

    // Attempt direct UPDATE on decision_conditions -> must fail
    await expect(
      adminSql`UPDATE decision_conditions SET text = 'Hacked condition' WHERE decision_id = ${res.id}`,
    ).rejects.toThrow(/immutable/i);

    // Attempt direct DELETE on decision_conditions -> must fail
    await expect(
      adminSql`DELETE FROM decision_conditions WHERE decision_id = ${res.id}`,
    ).rejects.toThrow(/immutable/i);

    // Verify record remains unchanged
    const decisions = await getDecisionsForDossier(orgId, dossierId);
    expect(decisions[0].rationale).toBe('Aprobada con condiciones para test de inmutabilidad.');
    expect(decisions[0].conditions[0]).toBe('Condicion 1');
  });

  it('Escenario: Nadie decide sin permiso (Analista de cumplimiento sin dossier:approve)', async () => {
    const { dossierId, assertionId } = await setupDossierInPendingDecision('900100106-6');

    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    await expect(
      recordDecision({
        organizationId: orgId,
        dossierId,
        type: 'approve',
        responsibleId: analystUserId, // No permission dossier:approve
        title: 'Analista de Cumplimiento',
        rationale: 'Intento de aprobación sin permiso',
        evidence: [{ kind: 'assertion', id: assertionId }],
        validUntil: futureDate,
      }),
    ).rejects.toThrow(/falta el permiso 'dossier:approve'/i);

    // State remains pendiente_de_decision
    const [dossier] = await adminSql`SELECT state FROM dossiers WHERE id = ${dossierId}`;
    expect(dossier.state).toBe('pendiente_de_decision');

    // No decision recorded
    const decisions = await getDecisionsForDossier(orgId, dossierId);
    expect(decisions).toHaveLength(0);

    // Audit log records denial with security.permission_denied
    const auditLogs = await getEntityAuditHistory(orgId, 'role_permission', 'dossier:approve');
    const deniedLog = auditLogs.find((l) => l.action === 'security.permission_denied');
    expect(deniedLog).toBeDefined();
    expect(deniedLog?.actorUserId).toBe(analystUserId);
    expect(deniedLog?.configurationVersionId).toBe(configVersionId);
  });

  it('Escenario: El sistema nunca decide solo', async () => {
    const { dossierId } = await setupDossierInPendingDecision('900100108-8');

    // Verify that dossier remains in pendiente_de_decision when no decision has been taken by a user
    const [dossier] = await adminSql`SELECT state FROM dossiers WHERE id = ${dossierId}`;
    expect(dossier.state).toBe('pendiente_de_decision');

    // No automated decisions exist for this dossier
    const decisions = await getDecisionsForDossier(orgId, dossierId);
    expect(decisions).toHaveLength(0);

    // Transitions to decision states require a user actor via recordDecision
    await expect(
      executeTransition({
        organizationId: orgId,
        dossierId,
        toState: 'aprobada',
        actorType: 'user', // without valid actorId, or non-privileged
      }),
    ).rejects.toThrow(/actorId/);
  });

  it('Escenario: Cambiar de parecer es una decisión nueva', async () => {
    const { dossierId, assertionId, documentId } = await setupDossierInPendingDecision('900100109-9');

    const futureDate1 = new Date();
    futureDate1.setFullYear(futureDate1.getFullYear() + 1);

    const first = await recordDecision({
      organizationId: orgId,
      dossierId,
      type: 'approve',
      responsibleId: officerUserId,
      title: 'Oficial de Cumplimiento',
      rationale: 'Primera decisión: aprobación inicial.',
      evidence: [{ kind: 'assertion', id: assertionId }],
      validUntil: futureDate1,
    });

    // Suppose later in history another decision record is added
    const futureDate2 = new Date();
    futureDate2.setFullYear(futureDate2.getFullYear() + 2);

    // Direct insert to simulate a second decision event over time
    const [second] = await adminSql`
      INSERT INTO decisions (
        organization_id, dossier_id, type, responsible_id, title,
        made_at, rationale, evidence, valid_until, configuration_version_id
      ) VALUES (
        ${orgId}, ${dossierId}, 'reject', ${officerUserId}, 'Oficial de Cumplimiento',
        now() + interval '1 minute', 'Segunda decisión: hallazgo sobreviniente.',
        ${JSON.stringify([{ kind: 'document', id: documentId }])}::jsonb,
        ${futureDate2.toISOString()}, ${configVersionId}
      ) RETURNING id
    `;

    const allDecisions = await getDecisionsForDossier(orgId, dossierId);
    expect(allDecisions).toHaveLength(2);
    expect(allDecisions[0].id).toBe(first.id);
    expect(allDecisions[0].rationale).toBe('Primera decisión: aprobación inicial.');
    expect(allDecisions[1].id).toBe(second.id);
    expect(allDecisions[1].rationale).toBe('Segunda decisión: hallazgo sobreviniente.');
  });

  it('Escenario: Cerrar el expediente (Oficial de Cumplimiento con dossier:edit)', async () => {
    const { dossierId, assertionId } = await setupDossierInPendingDecision('900100107-7');

    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    await recordDecision({
      organizationId: orgId,
      dossierId,
      type: 'approve',
      responsibleId: officerUserId,
      title: 'Oficial de Cumplimiento',
      rationale: 'Aprobado para posterior cierre',
      evidence: [{ kind: 'assertion', id: assertionId }],
      validUntil: futureDate,
    });

    // Officer closes the dossier using executeTransition (permission dossier:edit)
    await executeTransition({
      organizationId: orgId,
      dossierId,
      toState: 'cerrada',
      actorType: 'user',
      actorId: officerUserId,
    });

    const [dossier] = await adminSql`SELECT state FROM dossiers WHERE id = ${dossierId}`;
    expect(dossier.state).toBe('cerrada');

    // Verify it is in final state and rejects further transitions
    await expect(
      executeTransition({
        organizationId: orgId,
        dossierId,
        toState: 'pendiente_de_decision',
        actorType: 'user',
        actorId: officerUserId,
      }),
    ).rejects.toThrow(/Transición no permitida/);
  });
});
