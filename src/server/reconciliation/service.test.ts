import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { withTenantContext } from '../db/client';
import { createOrganizationWithAdmin, grantMembership } from '../organizations/use-cases';
import { seedBaseConfiguration, getActiveConfigurationVersion } from '../auth/role-config';
import { createDraftConfiguration, publishDraftConfiguration } from '../configuration/service';
import { addCounterpartyType, addRequirement } from '../configuration/requirement-matrix';
import { createDossierRequest } from '../dossiers/dossier';
import { executeTransition } from '../dossiers/state-machine';
import { registerAssertion, resolveDiscrepancy } from '../assertions/service';
import { recordAiExecution } from '../ai/execution';
import { completeReview } from '../dossiers/review';
import {
  getOpenDiscrepancies,
  getFieldReconciliation,
} from './service';
import type { Organization } from '../organizations/types';

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
  await adminSql`
    INSERT INTO public.users (id, email, name)
    VALUES (${userId}::uuid, ${email}, ${name})
    ON CONFLICT (email) DO UPDATE
    SET id = EXCLUDED.id,
        name = EXCLUDED.name
  `;
  return userId;
}

const TEST_ORG_NAMES = [
  'Alfa Reconciliation S.A.S.',
  'Beta Reconciliation S.A.S.',
];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu019.com')
  `;
  await adminSql`
    DELETE FROM public.assertions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.ai_executions
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
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu019.com')
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
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu019.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu019.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-019: Conciliación de lo declarado con lo extraído', () => {
  let orgAlfa: Organization;
  let orgBeta: Organization;
  let adminAlfaId: string;
  let analystAlfaId: string;
  let officerAlfaId: string;
  let adminBetaId: string;
  let analystBetaId: string;
  let configAlfaVersionId: string;
  let dossierAlfaId: string;
  let partyAlfaId: string;
  let dossierBetaId: string;
  let partyBetaId: string;

  beforeAll(async () => {
    await cleanupTestData();

    // 1. Setup Org Alfa
    adminAlfaId = await createTestAuthUser('adminAlfa@test-hu019.com', 'Admin Alfa');
    analystAlfaId = await createTestAuthUser('analystAlfa@test-hu019.com', 'Analyst Alfa');
    officerAlfaId = await createTestAuthUser('officerAlfa@test-hu019.com', 'Officer Alfa');

    orgAlfa = await createOrganizationWithAdmin(adminAlfaId, { name: 'Alfa Reconciliation S.A.S.' });
    await seedBaseConfiguration(orgAlfa.id, adminAlfaId);

    await grantMembership(adminAlfaId, {
      organizationId: orgAlfa.id,
      userId: analystAlfaId,
      role: 'compliance_analyst',
    });
    await grantMembership(adminAlfaId, {
      organizationId: orgAlfa.id,
      userId: officerAlfaId,
      role: 'compliance_officer',
    });

    // Custom draft config for Alfa with requirements
    const draftAlfa = await createDraftConfiguration({ organizationId: orgAlfa.id, standard: 'SARLAFT' });
    const cpTypeAlfa = await addCounterpartyType({
      organizationId: orgAlfa.id,
      configurationVersionId: draftAlfa.versionId,
      name: 'proveedor_custom',
      nature: 'legal_entity',
    });

    await addRequirement({
      organizationId: orgAlfa.id,
      configurationVersionId: draftAlfa.versionId,
      counterpartyTypeId: cpTypeAlfa.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'razon_social',
      mandatory: 'always',
      blocking: true,
      validation: { dataType: 'string' },
    });

    await addRequirement({
      organizationId: orgAlfa.id,
      configurationVersionId: draftAlfa.versionId,
      counterpartyTypeId: cpTypeAlfa.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'nit',
      mandatory: 'always',
      blocking: true,
      validation: { dataType: 'string' },
    });

    await addRequirement({
      organizationId: orgAlfa.id,
      configurationVersionId: draftAlfa.versionId,
      counterpartyTypeId: cpTypeAlfa.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'representante_legal',
      mandatory: 'optional',
      validation: { dataType: 'string' },
    });

    await publishDraftConfiguration({
      organizationId: orgAlfa.id,
      versionId: draftAlfa.versionId,
      publishedBy: adminAlfaId,
      reason: 'Versión inicial conciliación Alfa',
    });

    const activeAlfa = await getActiveConfigurationVersion(orgAlfa.id);
    configAlfaVersionId = activeAlfa!.id;

    // Create dossier Alfa
    const dAlfa = await createDossierRequest({
      organizationId: orgAlfa.id,
      requestedBy: adminAlfaId,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '900123456-1',
        declaredName: 'Transportes Alfa Ficticia S.A.S.',
      },
      internalOwnerId: adminAlfaId,
    });
    dossierAlfaId = dAlfa.id;
    partyAlfaId = dAlfa.partyId;

    // Advance dossier to en_revision
    await executeTransition({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminAlfaId,
    });
    await executeTransition({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });
    await executeTransition({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      toState: 'documentos_recibidos',
      actorType: 'counterparty',
    });
    await executeTransition({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      toState: 'en_revision',
      actorType: 'user',
      actorId: analystAlfaId,
    });

    // 2. Setup Org Beta
    adminBetaId = await createTestAuthUser('adminBeta@test-hu019.com', 'Admin Beta');
    analystBetaId = await createTestAuthUser('analystBeta@test-hu019.com', 'Analyst Beta');
    orgBeta = await createOrganizationWithAdmin(adminBetaId, { name: 'Beta Reconciliation S.A.S.' });
    await seedBaseConfiguration(orgBeta.id, adminBetaId);

    await grantMembership(adminBetaId, {
      organizationId: orgBeta.id,
      userId: analystBetaId,
      role: 'compliance_analyst',
    });

    const draftBeta = await createDraftConfiguration({ organizationId: orgBeta.id, standard: 'SARLAFT' });
    const cpTypeBeta = await addCounterpartyType({
      organizationId: orgBeta.id,
      configurationVersionId: draftBeta.versionId,
      name: 'proveedor_custom',
      nature: 'legal_entity',
    });
    await addRequirement({
      organizationId: orgBeta.id,
      configurationVersionId: draftBeta.versionId,
      counterpartyTypeId: cpTypeBeta.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'razon_social',
      mandatory: 'always',
      blocking: true,
      validation: { dataType: 'string' },
    });
    await publishDraftConfiguration({
      organizationId: orgBeta.id,
      versionId: draftBeta.versionId,
      publishedBy: adminBetaId,
      reason: 'Versión inicial conciliación Beta',
    });

    const dBeta = await createDossierRequest({
      organizationId: orgBeta.id,
      requestedBy: adminBetaId,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '900999888-2',
        declaredName: 'Transportes Beta S.A.S.',
      },
      internalOwnerId: adminBetaId,
    });
    dossierBetaId = dBeta.id;
    partyBetaId = dBeta.partyId;
  }, 30000);

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  }, 30000);

  // Helper to record AI execution for extracted assertions
  async function helperRecordAiExecution(orgId: string, dosId: string): Promise<string> {
    const aiExec = await recordAiExecution({
      organizationId: orgId,
      dossierId: dosId,
      provider: 'google-vertex',
      model: 'gemini-1.5-pro',
      modelVersion: '001',
      instructionTemplateId: 'tmpl-extract',
      instructionTemplateVersion: 'v1',
      dataDestination: 'us-central1',
      sentFragmentHash: 'abc123hash',
      status: 'succeeded',
      confidence: '0.95',
      result: { extracted: true },
    });
    return aiExec.id;
  }

  it('Escenario: Mostrar la comparación lado a lado', async () => {
    const aiExecutionId = await helperRecordAiExecution(orgAlfa.id, dossierAlfaId);

    // Declared assertion
    const decl = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      partyId: partyAlfaId,
      configurationVersionId: configAlfaVersionId,
      field: 'razon_social',
      value: 'Transportes Alfa Ficticia S.A.S.',
      origin: 'declared',
    });

    // Extracted assertion
    const ext = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      partyId: partyAlfaId,
      configurationVersionId: configAlfaVersionId,
      field: 'razon_social',
      value: 'Transportes Alfa Logística S.A.S.',
      origin: 'extracted',
      evidenceId: 'doc_rut_alfa.pdf',
      confidence: '0.95',
      aiExecutionId,
    });

    const reconciliation = await getFieldReconciliation(orgAlfa.id, dossierAlfaId);
    const row = reconciliation.find((r) => r.field === 'razon_social');

    expect(row).toBeDefined();
    expect(row!.declaredValue).toBe('Transportes Alfa Ficticia S.A.S.');
    expect(row!.declaredAssertionId).toBe(decl.id);
    expect(row!.extractedValue).toBe('Transportes Alfa Logística S.A.S.');
    expect(row!.extractedAssertionId).toBe(ext.id);
    expect(row!.extractedSource).toBe('doc_rut_alfa.pdf');
    expect(row!.extractedConfidence).toBe('0.95');
    expect(row!.status).toBe('discrepancia');
    expect(row!.requiredAction).toBe('Resolver discrepancia');
    expect(row!.isBlocking).toBe(true);
  });

  it('Escenario: Valores coincidentes no generan discrepancia (con normalización)', async () => {
    const aiExecutionId = await helperRecordAiExecution(orgAlfa.id, dossierAlfaId);

    // Declared: with accents and mixed case
    const decl = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      partyId: partyAlfaId,
      configurationVersionId: configAlfaVersionId,
      field: 'nit',
      value: '  900.123.456-1  ',
      origin: 'declared',
    });

    // Extracted: clean trimmed lowercase
    const ext = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      partyId: partyAlfaId,
      configurationVersionId: configAlfaVersionId,
      field: 'nit',
      value: '900.123.456-1',
      origin: 'extracted',
      evidenceId: 'doc_rut_nit.pdf',
      confidence: '0.99',
      aiExecutionId,
    });

    const reconciliation = await getFieldReconciliation(orgAlfa.id, dossierAlfaId);
    const row = reconciliation.find((r) => r.field === 'nit');

    expect(row).toBeDefined();
    expect(row!.status).toBe('concordante');
    expect(row!.requiredAction).toBe('Ninguna');

    // Both assertions still exist with their respective origin
    expect(row!.declaredAssertionId).toBe(decl.id);
    expect(row!.extractedAssertionId).toBe(ext.id);

    // Open discrepancies must NOT include 'nit'
    const open = await getOpenDiscrepancies(orgAlfa.id, dossierAlfaId);
    expect(open.some((d) => d.field === 'nit')).toBe(false);
  });

  it('Escenario: Valores distintos abren una discrepancia', async () => {
    const open = await getOpenDiscrepancies(orgAlfa.id, dossierAlfaId);
    const disc = open.find((d) => d.field === 'razon_social');

    expect(disc).toBeDefined();
    expect(disc!.isBlocking).toBe(true);
    expect(disc!.assertionIds.length).toBeGreaterThanOrEqual(2);
  });

  it('Escenario: La discrepancia no se cierra sola ante una nueva extracción', async () => {
    // Run another extraction assertion on the same field
    const aiExecutionId = await helperRecordAiExecution(orgAlfa.id, dossierAlfaId);

    await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      partyId: partyAlfaId,
      configurationVersionId: configAlfaVersionId,
      field: 'razon_social',
      value: 'Transportes Alfa Operaciones S.A.S.',
      origin: 'extracted',
      evidenceId: 'doc_camara_2026.pdf',
      confidence: '0.90',
      aiExecutionId,
    });

    // Discrepancy is STILL open and now contains 3 active assertions
    const open = await getOpenDiscrepancies(orgAlfa.id, dossierAlfaId);
    const disc = open.find((d) => d.field === 'razon_social');
    expect(disc).toBeDefined();
    expect(disc!.assertionIds.length).toBe(3);
  });

  it('Escenario: Resolver una discrepancia deja registro y conserva lo descartado', async () => {
    const openBefore = await getOpenDiscrepancies(orgAlfa.id, dossierAlfaId);
    const discBefore = openBefore.find((d) => d.field === 'razon_social');
    expect(discBefore).toBeDefined();

    const selectedAssertionId = discBefore!.assertionIds[0];

    // Compliance Analyst resolves discrepancy
    const resolution = await resolveDiscrepancy({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      field: 'razon_social',
      selectedAssertionId,
      resolvedBy: analystAlfaId,
      resolutionNote: 'Se toma el valor declarado por la contraparte según contrato firmado',
    });

    expect(resolution.activeAssertion.id).toBe(selectedAssertionId);
    expect(resolution.activeAssertion.status).toBe('active');
    expect(resolution.discardedAssertions.length).toBe(2);
    for (const discarded of resolution.discardedAssertions) {
      expect(discarded.status).toBe('discarded');
      expect(discarded.resolvedBy).toBe(analystAlfaId);
      expect(discarded.resolutionNote).toBe('Se toma el valor declarado por la contraparte según contrato firmado');
    }

    // Discrepancy is now CLOSED (only 1 active assertion remains for 'razon_social')
    const openAfter = await getOpenDiscrepancies(orgAlfa.id, dossierAlfaId);
    expect(openAfter.some((d) => d.field === 'razon_social')).toBe(false);

    // Audit log has assertion.discrepancy_resolved
    const auditRows = await adminSql`
      SELECT * FROM public.audit_log
      WHERE organization_id = ${orgAlfa.id}::uuid
        AND action = 'assertion.discrepancy_resolved'
        AND entity_id = ${selectedAssertionId}
    `;
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].reason).toBe('Se toma el valor declarado por la contraparte según contrato firmado');
  });

  it('Escenario: Un expediente con discrepancias abiertas no pasa a decisión', async () => {
    // Open a new discrepancy on required field 'nit'
    const aiExecutionId = await helperRecordAiExecution(orgAlfa.id, dossierAlfaId);
    await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      partyId: partyAlfaId,
      configurationVersionId: configAlfaVersionId,
      field: 'nit',
      value: '800.999.000-5', // Different from 900.123.456-1
      origin: 'extracted',
      evidenceId: 'doc_camara_nit.pdf',
      confidence: '0.98',
      aiExecutionId,
    });

    const open = await getOpenDiscrepancies(orgAlfa.id, dossierAlfaId);
    expect(open.some((d) => d.field === 'nit' && d.isBlocking)).toBe(true);

    // Attempting to completeReview must be rejected because of open discrepancy on 'nit'
    await expect(
      completeReview({
        organizationId: orgAlfa.id,
        dossierId: dossierAlfaId,
        reviewedBy: officerAlfaId,
      }),
    ).rejects.toThrow(/discrepancias abiertas pendientes de resolver: nit/);

    // Even with override, completeReview is still rejected
    await expect(
      completeReview({
        organizationId: orgAlfa.id,
        dossierId: dossierAlfaId,
        reviewedBy: officerAlfaId,
        override: { reason: 'Intento de aprobar con discrepancia activa' },
      }),
    ).rejects.toThrow(/discrepancias abiertas pendientes de resolver: nit/);
  });

  it('Escenario: Aislamiento entre organizaciones sobre las discrepancias', async () => {
    // Create an open discrepancy in Org Beta
    const aiExecutionIdBeta = await helperRecordAiExecution(orgBeta.id, dossierBetaId);

    const declBeta = await registerAssertion({
      organizationId: orgBeta.id,
      dossierId: dossierBetaId,
      partyId: partyBetaId,
      configurationVersionId: configAlfaVersionId,
      field: 'razon_social',
      value: 'Transportes Beta S.A.S.',
      origin: 'declared',
    });

    const extBeta = await registerAssertion({
      organizationId: orgBeta.id,
      dossierId: dossierBetaId,
      partyId: partyBetaId,
      configurationVersionId: configAlfaVersionId,
      field: 'razon_social',
      value: 'Beta Diferente S.A.S.',
      origin: 'extracted',
      evidenceId: 'doc_beta_rut.pdf',
      confidence: '0.95',
      aiExecutionId: aiExecutionIdBeta,
    });

    // 1. User from Org Alfa querying with tenant context only sees Alfa's discrepancies
    const alfaDiscrepancies = await withTenantContext(
      { userId: analystAlfaId, organizationId: orgAlfa.id },
      async (tx) => getOpenDiscrepancies(orgAlfa.id, dossierAlfaId, tx),
    );
    expect(alfaDiscrepancies.some((d) => d.assertionIds.includes(declBeta.id))).toBe(false);
    expect(alfaDiscrepancies.some((d) => d.assertionIds.includes(extBeta.id))).toBe(false);

    // 2. User from Org Alfa querying Beta's dossier gets 0 assertions due to RLS
    const crossOrgDiscrepancies = await withTenantContext(
      { userId: analystAlfaId, organizationId: orgAlfa.id },
      async (tx) => getOpenDiscrepancies(orgBeta.id, dossierBetaId, tx),
    );
    expect(crossOrgDiscrepancies.length).toBe(0);

    // 3. User from Org Alfa attempting to resolve discrepancy in Org Beta is rejected
    await expect(
      withTenantContext(
        { userId: analystAlfaId, organizationId: orgAlfa.id },
        async (tx) =>
          resolveDiscrepancy(
            {
              organizationId: orgBeta.id,
              dossierId: dossierBetaId,
              field: 'razon_social',
              selectedAssertionId: declBeta.id,
              resolvedBy: analystAlfaId,
              resolutionNote: 'Cross-tenant resolve attempt',
            },
            tx,
          ),
      ),
    ).rejects.toThrow();
  });

  it('Regresión: isBlocking usa el valor MÁS RECIENTE de un campo condicional, no el primero no-falsy', async () => {
    // getOpenDiscrepancies construye un diccionario "latestValues" para evaluar condiciones
    // (isRequirementCurrentlyRequired). Si ese diccionario se llena con `if (!latestValues[field])`
    // en vez de comprobar presencia, un valor falsy (false/0/'') más reciente queda tapado por
    // un valor más viejo -- exactamente el caso que esta prueba fija.
    const draft = await createDraftConfiguration({ organizationId: orgAlfa.id, standard: 'SARLAFT' });
    const cpType = await addCounterpartyType({
      organizationId: orgAlfa.id,
      configurationVersionId: draft.versionId,
      name: 'proveedor_condicional',
      nature: 'legal_entity',
    });

    await addRequirement({
      organizationId: orgAlfa.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: cpType.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'es_pep',
      mandatory: 'always',
      blocking: true,
      validation: { dataType: 'boolean' },
    });

    await addRequirement({
      organizationId: orgAlfa.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: cpType.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'beneficiario_final',
      mandatory: 'conditional',
      blocking: true,
      condition: { field: 'es_pep', operator: 'eq', value: true },
      validation: { dataType: 'string' },
    });

    await publishDraftConfiguration({
      organizationId: orgAlfa.id,
      versionId: draft.versionId,
      publishedBy: adminAlfaId,
      reason: 'Versión para probar orden de latestValues',
    });

    const condDossier = await createDossierRequest({
      organizationId: orgAlfa.id,
      requestedBy: adminAlfaId,
      counterpartyTypeName: 'proveedor_condicional',
      party: {
        identificationType: 'NIT',
        identificationNumber: '900777666-5',
        declaredName: 'Empresa Condicional SAS',
      },
      internalOwnerId: adminAlfaId,
    });

    await executeTransition({
      organizationId: orgAlfa.id,
      dossierId: condDossier.id,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminAlfaId,
    });
    await executeTransition({
      organizationId: orgAlfa.id,
      dossierId: condDossier.id,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    // es_pep: primero true (más viejo), luego false (más reciente) -- ambas activas, en conflicto.
    await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId: condDossier.id,
      partyId: condDossier.partyId,
      configurationVersionId: condDossier.configurationVersionId,
      field: 'es_pep',
      value: true,
      origin: 'declared',
    });
    await new Promise((r) => setTimeout(r, 20));
    await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId: condDossier.id,
      partyId: condDossier.partyId,
      configurationVersionId: condDossier.configurationVersionId,
      field: 'es_pep',
      value: false,
      origin: 'declared',
    });

    // beneficiario_final: dos valores en conflicto, para que el campo aparezca en la lista de discrepancias
    await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId: condDossier.id,
      partyId: condDossier.partyId,
      configurationVersionId: condDossier.configurationVersionId,
      field: 'beneficiario_final',
      value: 'Juan Perez',
      origin: 'declared',
    });
    await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId: condDossier.id,
      partyId: condDossier.partyId,
      configurationVersionId: condDossier.configurationVersionId,
      field: 'beneficiario_final',
      value: 'Pedro Gomez',
      origin: 'declared',
    });

    const discrepancies = await getOpenDiscrepancies(orgAlfa.id, condDossier.id);
    const bfDiscrepancy = discrepancies.find((d) => d.field === 'beneficiario_final');

    // El es_pep vigente (más reciente) es false, así que beneficiario_final NO está
    // actualmente exigido -- su discrepancia no debe bloquear la decisión.
    expect(bfDiscrepancy).toBeDefined();
    expect(bfDiscrepancy?.isBlocking).toBe(false);
  });
});
