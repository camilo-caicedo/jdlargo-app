import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { withTenantContext } from '../db/client';
import { createOrganizationWithAdmin } from '../organizations/use-cases';
import { seedBaseConfiguration } from '../auth/role-config';
import { createDraftConfiguration, publishDraftConfiguration } from '../configuration/service';
import { addCounterpartyType, addRequirement } from '../configuration/requirement-matrix';
import { createDossierRequest } from '../dossiers/dossier';
import { executeTransition } from '../dossiers/state-machine';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { DOSSIER_DOCUMENTS_BUCKET, EXTRACTION_CONFIDENCE_THRESHOLD } from '@/lib/document-upload-constants';
import { confirmDocumentUpload } from '../documents/document';
import { registerAssertion, getAssertionsForField } from '../assertions/service';
import { runDocumentExtraction } from './service';
import { type ExtractionEngine, type ExtractionEngineInput, type ExtractionEngineResult } from './port';
import type { Organization } from '../organizations/types';

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

const TEST_ORG_NAMES = [
  'Alfa Ficticia S.A.S.',
  'Beta Ficticia S.A.S.',
];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu017.com')
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
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu017.com')
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
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu017.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu017.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

class MockExtractionEngine implements ExtractionEngine {
  readonly id = 'mock-extraction-engine';
  public lastInput?: ExtractionEngineInput;
  public mockResult?: ExtractionEngineResult;
  public callCount = 0;

  constructor(mockResult?: ExtractionEngineResult) {
    this.mockResult = mockResult;
  }

  async extract(input: ExtractionEngineInput): Promise<ExtractionEngineResult> {
    this.callCount++;
    this.lastInput = input;
    if (this.mockResult) {
      return this.mockResult;
    }
    return {
      status: 'succeeded',
      provider: 'mock-provider',
      model: 'mock-model-v1',
      modelVersion: '2026.1',
      instructionTemplateId: 'mock-template-v1',
      instructionTemplateVersion: '1.0',
      dataDestination: 'mock-datacenter',
      fields: [
        { field: 'nit', value: '900123456-1', confidence: 0.95 },
        { field: 'razon_social', value: 'Alfa Ficticia S.A.S.', confidence: 0.92 },
      ],
    };
  }
}

describe('HU-017: Extracción de datos desde los documentos', () => {
  let orgAlfa: Organization;
  let orgBeta: Organization;
  let adminAlfaId: string;
  let adminBetaId: string;
  let dossierAlfaId: string;
  let dossierBetaId: string;
  let documentAlfaId: string;
  let documentBetaId: string;
  const createdStoragePaths: string[] = [];

  beforeAll(async () => {
    await cleanupTestData();

    adminAlfaId = await createTestAuthUser('adminAlfa@test-hu017.com', 'Admin Alfa');
    orgAlfa = await createOrganizationWithAdmin(adminAlfaId, { name: 'Alfa Ficticia S.A.S.' });
    await seedBaseConfiguration(orgAlfa.id, adminAlfaId);

    adminBetaId = await createTestAuthUser('adminBeta@test-hu017.com', 'Admin Beta');
    orgBeta = await createOrganizationWithAdmin(adminBetaId, { name: 'Beta Ficticia S.A.S.' });
    await seedBaseConfiguration(orgBeta.id, adminBetaId);

    // Setup Alfa Config
    const draftAlfa = await createDraftConfiguration({ organizationId: orgAlfa.id, standard: 'SARLAFT' });
    const cpTypeAlfa = await addCounterpartyType({
      organizationId: orgAlfa.id,
      configurationVersionId: draftAlfa.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });
    await addRequirement({
      organizationId: orgAlfa.id,
      configurationVersionId: draftAlfa.versionId,
      counterpartyTypeId: cpTypeAlfa.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'nit',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });
    await addRequirement({
      organizationId: orgAlfa.id,
      configurationVersionId: draftAlfa.versionId,
      counterpartyTypeId: cpTypeAlfa.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'razon_social',
      mandatory: 'always',
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
    await addRequirement({
      organizationId: orgAlfa.id,
      configurationVersionId: draftAlfa.versionId,
      counterpartyTypeId: cpTypeAlfa.id,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'doc_rut',
      mandatory: 'always',
    });
    await publishDraftConfiguration({
      organizationId: orgAlfa.id,
      versionId: draftAlfa.versionId,
      publishedBy: adminAlfaId,
      reason: 'Publish Alfa Config',
    });

    // Setup Beta Config
    const draftBeta = await createDraftConfiguration({ organizationId: orgBeta.id, standard: 'SARLAFT' });
    const cpTypeBeta = await addCounterpartyType({
      organizationId: orgBeta.id,
      configurationVersionId: draftBeta.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });
    await addRequirement({
      organizationId: orgBeta.id,
      configurationVersionId: draftBeta.versionId,
      counterpartyTypeId: cpTypeBeta.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'nit',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });
    await addRequirement({
      organizationId: orgBeta.id,
      configurationVersionId: draftBeta.versionId,
      counterpartyTypeId: cpTypeBeta.id,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'doc_rut',
      mandatory: 'always',
    });
    await publishDraftConfiguration({
      organizationId: orgBeta.id,
      versionId: draftBeta.versionId,
      publishedBy: adminBetaId,
      reason: 'Publish Beta Config',
    });

    // Create Dossier Alfa
    const dossierAlfa = await createDossierRequest({
      organizationId: orgAlfa.id,
      requestedBy: adminAlfaId,
      counterpartyTypeName: 'proveedor',
      party: {
        identificationType: 'NIT',
        identificationNumber: '900123456-1',
        declaredName: 'Alfa Ficticia S.A.S.',
      },
      internalOwnerId: adminAlfaId,
    });
    dossierAlfaId = dossierAlfa.id;

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
      actorType: 'user',
      actorId: adminAlfaId,
    });

    // Upload Document in Storage for Alfa
    const adminStorage = createSupabaseAdminClient();
    const pdfAlfaContent = Buffer.from('%PDF-1.4 Mock RUT Content for Alfa');
    const storagePathAlfa = `${dossierAlfaId}/doc_rut/rut-alfa.pdf`;
    createdStoragePaths.push(storagePathAlfa);

    await adminStorage.storage
      .from(DOSSIER_DOCUMENTS_BUCKET)
      .upload(storagePathAlfa, pdfAlfaContent, { contentType: 'application/pdf', upsert: true });

    const docAlfaConfirm = await confirmDocumentUpload({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      documentType: 'doc_rut',
      storagePath: storagePathAlfa,
      hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      format: 'pdf',
      size: pdfAlfaContent.length,
      uploadedByType: 'user',
      uploadedByUserId: adminAlfaId,
    });
    documentAlfaId = docAlfaConfirm.id;

    // Create Dossier Beta
    const dossierBeta = await createDossierRequest({
      organizationId: orgBeta.id,
      requestedBy: adminBetaId,
      counterpartyTypeName: 'proveedor',
      party: {
        identificationType: 'NIT',
        identificationNumber: '800654321-9',
        declaredName: 'Beta Ficticia S.A.S.',
      },
      internalOwnerId: adminBetaId,
    });
    dossierBetaId = dossierBeta.id;

    await executeTransition({
      organizationId: orgBeta.id,
      dossierId: dossierBetaId,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminBetaId,
    });
    await executeTransition({
      organizationId: orgBeta.id,
      dossierId: dossierBetaId,
      toState: 'en_diligenciamiento',
      actorType: 'user',
      actorId: adminBetaId,
    });

    // Upload Document in Storage for Beta
    const pdfBetaContent = Buffer.from('%PDF-1.4 Mock RUT Content for Beta');
    const storagePathBeta = `${dossierBetaId}/doc_rut/rut-beta.pdf`;
    createdStoragePaths.push(storagePathBeta);

    await adminStorage.storage
      .from(DOSSIER_DOCUMENTS_BUCKET)
      .upload(storagePathBeta, pdfBetaContent, { contentType: 'application/pdf', upsert: true });

    const docBetaConfirm = await confirmDocumentUpload({
      organizationId: orgBeta.id,
      dossierId: dossierBetaId,
      documentType: 'doc_rut',
      storagePath: storagePathBeta,
      hash: 'f4c1b22398fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b999',
      format: 'pdf',
      size: pdfBetaContent.length,
      uploadedByType: 'user',
      uploadedByUserId: adminBetaId,
    });
    documentBetaId = docBetaConfirm.id;
  }, 60000);

  afterAll(async () => {
    if (createdStoragePaths.length > 0) {
      try {
        const adminStorage = createSupabaseAdminClient();
        await adminStorage.storage.from(DOSSIER_DOCUMENTS_BUCKET).remove(createdStoragePaths);
      } catch {}
    }
    await cleanupTestData();
    await adminSql.end();
  }, 60000);

  it('Escenario: Extraer campos de un documento cargado', async () => {
    // 1. Existing declared assertion
    const declaredAssertion = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      partyId: (await adminSql`SELECT party_id FROM public.dossiers WHERE id = ${dossierAlfaId}::uuid`)[0].party_id,
      configurationVersionId: (await adminSql`SELECT configuration_version_id FROM public.dossiers WHERE id = ${dossierAlfaId}::uuid`)[0].configuration_version_id,
      field: 'representante_legal',
      value: 'Carlos Declarante',
      origin: 'declared',
      producedBy: adminAlfaId,
    });

    const mockEngine = new MockExtractionEngine({
      status: 'succeeded',
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      modelVersion: '2026.03',
      instructionTemplateId: 'extract_rut_v1',
      instructionTemplateVersion: '1.0.0',
      dataDestination: 'US-East',
      fields: [
        { field: 'nit', value: '900123456-1', confidence: 0.98 },
        { field: 'razon_social', value: 'Alfa Ficticia S.A.S.', confidence: 0.95 },
      ],
    });

    const result = await runDocumentExtraction({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      documentId: documentAlfaId,
      engine: mockEngine,
    });

    expect(result.status).toBe('succeeded');
    expect(result.assertionsCreated).toBe(2);
    expect(result.aiExecutionId).toBeDefined();

    // Verify assertions produced
    const nitAssertions = await getAssertionsForField(orgAlfa.id, dossierAlfaId, 'nit');
    const extractedNit = nitAssertions.find((a) => a.origin === 'extracted');
    expect(extractedNit).toBeDefined();
    expect(extractedNit?.value).toBe('900123456-1');
    expect(extractedNit?.confidence).toBe('0.98');
    expect(extractedNit?.evidenceId).toBe(documentAlfaId);
    expect(extractedNit?.aiExecutionId).toBe(result.aiExecutionId);

    // Verify declared assertion remains intact and unmodified
    const repAssertions = await getAssertionsForField(orgAlfa.id, dossierAlfaId, 'representante_legal');
    const preservedDeclared = repAssertions.find((a) => a.id === declaredAssertion.id);
    expect(preservedDeclared).toBeDefined();
    expect(preservedDeclared?.value).toBe('Carlos Declarante');
    expect(preservedDeclared?.origin).toBe('declared');
    expect(preservedDeclared?.status).toBe('active');
  });

  it('Escenario: Lo extraído no desplaza a lo declarado', async () => {
    // Reset document state to received for test isolation
    await adminSql`UPDATE public.documents SET state = 'received', rejection_reason = null WHERE id = ${documentAlfaId}::uuid`;

    const partyId = (await adminSql`SELECT party_id FROM public.dossiers WHERE id = ${dossierAlfaId}::uuid`)[0].party_id;
    const configVerId = (await adminSql`SELECT configuration_version_id FROM public.dossiers WHERE id = ${dossierAlfaId}::uuid`)[0].configuration_version_id;

    // Contraparte declara 'Alfa Antigua S.A.S.' para razon_social
    await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      partyId,
      configurationVersionId: configVerId,
      field: 'razon_social',
      value: 'Alfa Antigua S.A.S.',
      origin: 'declared',
      producedBy: adminAlfaId,
    });

    // Motor extrae 'Alfa Nueva S.A.S.' para el mismo campo razon_social
    const mockEngine = new MockExtractionEngine({
      status: 'succeeded',
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      modelVersion: '2026.03',
      instructionTemplateId: 'extract_rut_v1',
      instructionTemplateVersion: '1.0.0',
      dataDestination: 'US-East',
      fields: [
        { field: 'razon_social', value: 'Alfa Nueva S.A.S.', confidence: 0.94 },
      ],
    });

    const result = await runDocumentExtraction({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      documentId: documentAlfaId,
      engine: mockEngine,
    });

    expect(result.status).toBe('succeeded');
    expect(result.assertionsCreated).toBe(1);

    // Both assertions must coexist with their respective origins
    const rsAssertions = await getAssertionsForField(orgAlfa.id, dossierAlfaId, 'razon_social');
    const declared = rsAssertions.find((a) => a.origin === 'declared' && a.value === 'Alfa Antigua S.A.S.');
    const extracted = rsAssertions.find((a) => a.origin === 'extracted' && a.value === 'Alfa Nueva S.A.S.');

    expect(declared).toBeDefined();
    expect(extracted).toBeDefined();
    // El sistema no elige ninguna por su cuenta: lo declarado sigue activo, lo extraído por IA
    // nace pendiente de validación (HU-020) — ninguna desplaza a la otra.
    expect(declared?.status).toBe('active');
    expect(extracted?.status).toBe('pending_validation');
  });

  it('Escenario: Extracción con confianza insuficiente', async () => {
    const mockEngine = new MockExtractionEngine({
      status: 'succeeded',
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      modelVersion: '2026.03',
      instructionTemplateId: 'extract_rut_v1',
      instructionTemplateVersion: '1.0.0',
      dataDestination: 'US-East',
      fields: [
        { field: 'representante_legal', value: 'Firma Ilegible', confidence: 0.45 },
      ],
    });

    const result = await runDocumentExtraction({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      documentId: documentAlfaId,
      engine: mockEngine,
    });

    expect(result.status).toBe('succeeded');
    expect(result.assertionsCreated).toBe(1);

    const assertions = await getAssertionsForField(orgAlfa.id, dossierAlfaId, 'representante_legal');
    const lowConfidenceAssertion = assertions.find((a) => a.aiExecutionId === result.aiExecutionId);
    expect(lowConfidenceAssertion).toBeDefined();
    expect(Number(lowConfidenceAssertion?.confidence)).toBe(0.45);
    // Identificable como pendiente de validación por estar debajo del umbral 0.70
    expect(Number(lowConfidenceAssertion?.confidence)).toBeLessThan(EXTRACTION_CONFIDENCE_THRESHOLD);
  });

  it('Escenario: Documento ilegible', async () => {
    const mockEngine = new MockExtractionEngine({
      status: 'failed',
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      modelVersion: '2026.03',
      instructionTemplateId: 'extract_rut_v1',
      instructionTemplateVersion: '1.0.0',
      dataDestination: 'US-East',
      failureReason: 'Documento borroso o resolución insuficiente',
    });

    const countBefore = await adminSql`SELECT count(*)::int as c FROM public.assertions WHERE dossier_id = ${dossierAlfaId}::uuid`;

    const result = await runDocumentExtraction({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      documentId: documentAlfaId,
      engine: mockEngine,
    });

    expect(result.status).toBe('failed');
    expect(result.assertionsCreated).toBe(0);

    // No se registra ninguna afirmación extraída
    const countAfter = await adminSql`SELECT count(*)::int as c FROM public.assertions WHERE dossier_id = ${dossierAlfaId}::uuid`;
    expect(countAfter[0].c).toBe(countBefore[0].c);

    // El documento se marca para revisión humana con el motivo
    const [docRow] = await adminSql`SELECT state, rejection_reason FROM public.documents WHERE id = ${documentAlfaId}::uuid`;
    expect(docRow.state).toBe('requires_review');
    expect(docRow.rejection_reason).toBe('Documento borroso o resolución insuficiente');

    // La ejecución fallida queda registrada igualmente
    const [execRow] = await adminSql`SELECT status, failure_reason FROM public.ai_executions WHERE id = ${result.aiExecutionId}::uuid`;
    expect(execRow.status).toBe('failed');
    expect(execRow.failure_reason).toBe('Documento borroso o resolución insuficiente');
  });

  it('Escenario: La extracción es reintentable y no duplica', async () => {
    // Reset document state to received for retry simulation
    await adminSql`UPDATE public.documents SET state = 'received', rejection_reason = null WHERE id = ${documentAlfaId}::uuid`;

    // 1st attempt: fails due to provider unavailability
    const failEngine = new MockExtractionEngine({
      status: 'failed',
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      modelVersion: '2026.03',
      instructionTemplateId: 'extract_rut_v1',
      instructionTemplateVersion: '1.0.0',
      dataDestination: 'US-East',
      failureReason: '503 Service Unavailable',
    });

    const firstRun = await runDocumentExtraction({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      documentId: documentAlfaId,
      engine: failEngine,
    });

    expect(firstRun.status).toBe('failed');
    expect(firstRun.assertionsCreated).toBe(0);

    // Reintento: reset document to received and run with successful engine
    await adminSql`UPDATE public.documents SET state = 'received', rejection_reason = null WHERE id = ${documentAlfaId}::uuid`;

    const successEngine = new MockExtractionEngine({
      status: 'succeeded',
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      modelVersion: '2026.03',
      instructionTemplateId: 'extract_rut_v1',
      instructionTemplateVersion: '1.0.0',
      dataDestination: 'US-East',
      fields: [
        { field: 'nit', value: '900123456-1', confidence: 0.99 },
      ],
    });

    const secondRun = await runDocumentExtraction({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      documentId: documentAlfaId,
      engine: successEngine,
    });

    expect(secondRun.status).toBe('succeeded');
    expect(secondRun.assertionsCreated).toBe(1);

    // Cada intento queda registrado por separado en ai_executions
    expect(firstRun.aiExecutionId).not.toBe(secondRun.aiExecutionId);

    const execs = await adminSql`
      SELECT id, status FROM public.ai_executions
      WHERE id IN (${firstRun.aiExecutionId}::uuid, ${secondRun.aiExecutionId}::uuid)
      ORDER BY created_at ASC
    `;
    expect(execs.length).toBe(2);
    expect(execs[0].status).toBe('failed');
    expect(execs[1].status).toBe('succeeded');

    // No se produjeron afirmaciones duplicadas de la ejecución fallida
    const assertionsFromFirst = await adminSql`
      SELECT count(*)::int as c FROM public.assertions WHERE ai_execution_id = ${firstRun.aiExecutionId}::uuid
    `;
    expect(assertionsFromFirst[0].c).toBe(0);

    const assertionsFromSecond = await adminSql`
      SELECT count(*)::int as c FROM public.assertions WHERE ai_execution_id = ${secondRun.aiExecutionId}::uuid
    `;
    expect(assertionsFromSecond[0].c).toBe(1);
  });

  it('Escenario: Al modelo se le envía lo mínimo necesario', async () => {
    // Reset document state to received
    await adminSql`UPDATE public.documents SET state = 'received' WHERE id = ${documentAlfaId}::uuid`;

    const mockEngine = new MockExtractionEngine({
      status: 'succeeded',
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      modelVersion: '2026.03',
      instructionTemplateId: 'extract_rut_v1',
      instructionTemplateVersion: '1.0.0',
      dataDestination: 'US-East',
      fields: [
        { field: 'nit', value: '900123456-1', confidence: 0.99 },
      ],
    });

    const runResult = await runDocumentExtraction({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      documentId: documentAlfaId,
      engine: mockEngine,
    });

    // Solo se envían los bytes del documento específico y los expectedFields de tipo field
    expect(mockEngine.lastInput).toBeDefined();
    expect(mockEngine.lastInput?.mimeType).toBe('application/pdf');
    expect(mockEngine.lastInput?.documentBytes).toBeInstanceOf(Buffer);

    // expectedFields solo contiene los campos tipo 'field' (nit, razon_social, representante_legal), NO doc_rut ni datos ajenos
    const fieldKeys = mockEngine.lastInput?.expectedFields.map((f) => f.key);
    expect(fieldKeys).toContain('nit');
    expect(fieldKeys).toContain('razon_social');
    expect(fieldKeys).toContain('representante_legal');
    expect(fieldKeys).not.toContain('doc_rut');

    // Queda registrado en ai_executions a qué proveedor se envió y la huella del fragmento
    const [exec] = await adminSql`
      SELECT provider, model, sent_fragment_hash FROM public.ai_executions
      WHERE id = ${runResult.aiExecutionId}::uuid
    `;
    expect(exec.provider).toBe('google');
    expect(exec.model).toBe('gemini-3.5-flash-lite');
    expect(exec.sent_fragment_hash).toBeDefined();
    expect(exec.sent_fragment_hash.length).toBe(64); // SHA-256 hex
  });

  it('Escenario: Aislamiento entre organizaciones sobre lo extraído', async () => {
    // 1. Extraer sobre Beta
    const mockEngineBeta = new MockExtractionEngine({
      status: 'succeeded',
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      modelVersion: '2026.03',
      instructionTemplateId: 'extract_rut_v1',
      instructionTemplateVersion: '1.0.0',
      dataDestination: 'US-East',
      fields: [
        { field: 'nit', value: '800654321-9', confidence: 0.97 },
      ],
    });

    const runBeta = await runDocumentExtraction({
      organizationId: orgBeta.id,
      dossierId: dossierBetaId,
      documentId: documentBetaId,
      engine: mockEngineBeta,
    });
    expect(runBeta.status).toBe('succeeded');

    const [betaExtracted] = await adminSql`
      SELECT id FROM public.assertions WHERE ai_execution_id = ${runBeta.aiExecutionId}::uuid
    `;
    expect(betaExtracted).toBeDefined();

    // 2. Consultar con contexto de usuario de Alfa
    const visibleInAlfa = await withTenantContext(
      { userId: adminAlfaId, organizationId: orgAlfa.id },
      async (tx) => {
        return tx.execute<{ id: string; organization_id: string }>(
          sql`SELECT id, organization_id FROM public.assertions WHERE id = ${betaExtracted.id}::uuid`
        );
      },
    );
    expect(visibleInAlfa.length).toBe(0);

    // 3. Consultar con contexto de usuario de Beta
    const visibleInBeta = await withTenantContext(
      { userId: adminBetaId, organizationId: orgBeta.id },
      async (tx) => {
        return tx.execute<{ id: string; organization_id: string }>(
          sql`SELECT id, organization_id FROM public.assertions WHERE id = ${betaExtracted.id}::uuid`
        );
      },
    );
    expect(visibleInBeta.length).toBe(1);
    expect(visibleInBeta[0].id).toBe(betaExtracted.id);
  });

  it('Escenario: Tipo de documento no soportado no invoca al motor de IA', async () => {
    // Create a requirement for an unsupported type first
    const configVerAlfa = (await adminSql`SELECT configuration_version_id FROM public.dossiers WHERE id = ${dossierAlfaId}::uuid`)[0].configuration_version_id;
    const counterpartyTypeAlfa = (await adminSql`SELECT counterparty_type_id FROM public.dossiers WHERE id = ${dossierAlfaId}::uuid`)[0].counterparty_type_id;

    // Insert an unsupported type requirement
    await adminSql`
      INSERT INTO public.requirements (organization_id, configuration_version_id, counterparty_type_id, standard, type, key, mandatory, blocking, created_at)
      VALUES (${orgAlfa.id}::uuid, ${configVerAlfa}::uuid, ${counterpartyTypeAlfa}::uuid, 'SARLAFT', 'document_type', 'doc_unsupported_type', 'always', true, NOW())
    `;

    // Upload document to storage
    const adminStorage = createSupabaseAdminClient();
    const fileBuffer = Buffer.from('test pdf content for unsupported type');
    const storagePathUnsupported = `${dossierAlfaId}/unsupported/doc.pdf`;
    createdStoragePaths.push(storagePathUnsupported);

    const { error: uploadError } = await adminStorage.storage
      .from(DOSSIER_DOCUMENTS_BUCKET)
      .upload(storagePathUnsupported, fileBuffer, { contentType: 'application/pdf', upsert: true });
    expect(uploadError).toBeNull();

    // Confirm document with unsupported type
    const unsupportedDoc = await confirmDocumentUpload({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      documentType: 'doc_unsupported_type', // Not in catalog but in requirements
      storagePath: storagePathUnsupported,
      hash: 'abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567ijk890lmn',
      format: 'pdf',
      size: fileBuffer.length,
      uploadedByType: 'user',
      uploadedByUserId: adminAlfaId,
    });

    const mockEngine = new MockExtractionEngine();
    const result = await runDocumentExtraction({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      documentId: unsupportedDoc.id,
      engine: mockEngine,
    });

    // Motor NUNCA fue invocado
    expect(mockEngine.callCount).toBe(0);

    // Resultado indica tipo no soportado
    expect(result.status).toBe('unsupported_document_type');
    expect(result.aiExecutionId).toBeNull();
    expect(result.assertionsCreated).toBe(0);

    // No hay fila en ai_executions
    const [aiExec] = await adminSql`
      SELECT id FROM public.ai_executions WHERE organization_id = ${orgAlfa.id}::uuid AND document_id = ${unsupportedDoc.id}::uuid
    `;
    expect(aiExec).toBeUndefined();
  });
});
