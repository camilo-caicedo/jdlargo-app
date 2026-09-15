import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createOrganizationWithAdmin, grantMembership } from '../organizations/use-cases';
import { seedBaseConfiguration } from '../auth/role-config';
import {
  createDraftConfiguration,
  publishDraftConfiguration,
} from '../configuration/service';
import {
  addCounterpartyType,
  addRequirement,
} from '../configuration/requirement-matrix';
import { createDossierRequest } from './dossier';
import { executeTransition } from './state-machine';
import {
  getDeclarationForm,
  saveDeclaredFields,
  completeDeclaration,
  IncompleteDeclarationError,
} from './declaration';
import { confirmDocumentUpload } from '../documents/document';
import { registerAssertion } from '../assertions/service';
import { recordAiExecution } from '../ai/execution';

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

const TEST_ORG_NAMES = ['Declaration Org Test'];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu012.com')
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
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu012.com')
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
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu012.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu012.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-012: Formulario dinámico de identificación', () => {
  let orgId: string;
  let adminUserId: string;
  let analystUserId: string;
  let typeProveedorId: string;
  let typeConductorId: string;
  let dossierProveedorId: string;
  let dossierConductorId: string;

  beforeAll(async () => {
    await cleanupTestData();

    adminUserId = await createTestAuthUser('admin@test-hu012.com', 'Admin HU012');
    const org = await createOrganizationWithAdmin(adminUserId, { name: 'Declaration Org Test' });
    orgId = org.id;

    await seedBaseConfiguration(orgId, adminUserId);

    analystUserId = await createTestAuthUser('analyst@test-hu012.com', 'Analyst HU012');
    await grantMembership(adminUserId, {
      organizationId: orgId,
      userId: analystUserId,
      role: 'compliance_analyst',
    });

    // Create draft configuration and configure custom types and requirements
    const draft = await createDraftConfiguration({ organizationId: orgId, standard: 'SARLAFT' });

    const typeProveedor = await addCounterpartyType({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      name: 'proveedor_custom',
      nature: 'legal_entity',
    });
    typeProveedorId = typeProveedor.id;

    const typeConductor = await addCounterpartyType({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      name: 'conductor',
      nature: 'natural_person',
    });
    typeConductorId = typeConductor.id;

    // Requirements for Proveedor:
    // 1. razon_social (always, min 3)
    await addRequirement({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeProveedorId,
      standard: 'SARLAFT',
      type: 'field',
      key: 'razon_social',
      mandatory: 'always',
      validation: { dataType: 'string', min: 3 },
    });

    // 2. es_pep (always, boolean)
    await addRequirement({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeProveedorId,
      standard: 'SARLAFT',
      type: 'field',
      key: 'es_pep',
      mandatory: 'always',
      validation: { dataType: 'boolean' },
    });

    // 3. detalle_cargo_pep (conditional on es_pep = true)
    await addRequirement({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeProveedorId,
      standard: 'SARLAFT',
      type: 'field',
      key: 'detalle_cargo_pep',
      mandatory: 'conditional',
      condition: { field: 'es_pep', operator: 'eq', value: true },
      validation: { dataType: 'string', min: 5 },
    });

    // 4. doc_rut (document_type, informative)
    await addRequirement({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeProveedorId,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'doc_rut',
      mandatory: 'always',
    });

    // Requirements for Conductor:
    // 1. licencia_conduccion (always)
    await addRequirement({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeConductorId,
      standard: 'SARLAFT',
      type: 'field',
      key: 'licencia_conduccion',
      mandatory: 'always',
      validation: { dataType: 'string', min: 5 },
    });

    // Publish configuration
    await publishDraftConfiguration({
      organizationId: orgId,
      versionId: draft.versionId,
      publishedBy: adminUserId,
      reason: 'Configuración para tests HU-012',
    });

    // Create dossier for Proveedor
    const dossierProv = await createDossierRequest({
      organizationId: orgId,
      requestedBy: adminUserId,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '900999888',
        declaredName: 'Transportes Rápidos S.A.S.',
      },
      internalOwnerId: adminUserId,
    });
    dossierProveedorId = dossierProv.id;

    // Create dossier for Conductor
    const dossierCond = await createDossierRequest({
      organizationId: orgId,
      requestedBy: adminUserId,
      counterpartyTypeName: 'conductor',
      party: {
        identificationType: 'CC',
        identificationNumber: '10203040',
        declaredName: 'Carlos Conductor',
      },
      internalOwnerId: adminUserId,
    });
    dossierConductorId = dossierCond.id;

    // Transition both to 'en_diligenciamiento' (borrador -> enviada -> en_diligenciamiento)
    await executeTransition({
      organizationId: orgId,
      dossierId: dossierProveedorId,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUserId,
    });
    await executeTransition({
      organizationId: orgId,
      dossierId: dossierProveedorId,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    await executeTransition({
      organizationId: orgId,
      dossierId: dossierConductorId,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUserId,
    });
    await executeTransition({
      organizationId: orgId,
      dossierId: dossierConductorId,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  }, 60000);

  it('Escenario: El formulario se arma desde la matriz y dos tipos ven formularios distintos', async () => {
    const provForm = await getDeclarationForm(orgId, dossierProveedorId);
    expect(provForm.fieldRequirements.map((r) => r.key)).toEqual(
      expect.arrayContaining(['razon_social', 'es_pep', 'detalle_cargo_pep']),
    );
    expect(provForm.fieldRequirements.map((r) => r.key)).not.toContain('licencia_conduccion');
    expect(provForm.documentRequirements.map((r) => r.key)).toEqual(['doc_rut']);

    const condForm = await getDeclarationForm(orgId, dossierConductorId);
    expect(condForm.fieldRequirements.map((r) => r.key)).toEqual(['licencia_conduccion']);
    expect(condForm.fieldRequirements.map((r) => r.key)).not.toContain('razon_social');
  });

  it('rechaza guardar claves que no pertenezcan a la matriz del expediente', async () => {
    await expect(
      saveDeclaredFields({
        organizationId: orgId,
        dossierId: dossierProveedorId,
        fields: {
          campo_inexistente: 'hack',
        },
      }),
    ).rejects.toThrow("El campo 'campo_inexistente' no pertenece a los requisitos exigidos");
  });

  it('Escenario: Las validaciones vienen de la configuración y se aplican en el servidor', async () => {
    await expect(
      saveDeclaredFields({
        organizationId: orgId,
        dossierId: dossierProveedorId,
        fields: {
          razon_social: 'AB', // min is 3
        },
      }),
    ).rejects.toThrow('Debe tener al menos 3 caracteres');
  });

  it('Escenario: Lo que se guarda es una afirmación declarada y el avance parcial no se pierde', async () => {
    await saveDeclaredFields({
      organizationId: orgId,
      dossierId: dossierProveedorId,
      fields: {
        razon_social: 'Ficticia S.A.S.',
        es_pep: false,
      },
    });

    // Recover saved values
    const form = await getDeclarationForm(orgId, dossierProveedorId);
    expect(form.values['razon_social']).toBe('Ficticia S.A.S.');
    expect(form.values['es_pep']).toBe(false);

    // Verify assertion table row has origin 'declared' and null producedBy
    const assertions = await adminSql`
      SELECT field, value, origin, produced_by FROM public.assertions
      WHERE organization_id = ${orgId}::uuid AND dossier_id = ${dossierProveedorId}::uuid AND field = 'razon_social'
    `;
    expect(assertions.length).toBe(1);
    expect(assertions[0].origin).toBe('declared');
    expect(assertions[0].produced_by).toBeNull();
  });

  it('Escenario: Corregir antes de enviar añade una afirmación nueva y no reemplaza la anterior', async () => {
    await saveDeclaredFields({
      organizationId: orgId,
      dossierId: dossierProveedorId,
      fields: {
        razon_social: 'Ficticia Internacional S.A.S.',
      },
    });

    const form = await getDeclarationForm(orgId, dossierProveedorId);
    expect(form.values['razon_social']).toBe('Ficticia Internacional S.A.S.');

    const assertions = await adminSql`
      SELECT id, value FROM public.assertions
      WHERE organization_id = ${orgId}::uuid AND dossier_id = ${dossierProveedorId}::uuid AND field = 'razon_social'
      ORDER BY produced_at ASC
    `;
    expect(assertions.length).toBe(2);
    expect(assertions[0].value).toBe('Ficticia S.A.S.');
    expect(assertions[1].value).toBe('Ficticia Internacional S.A.S.');
  });

  it('Escenario: No se puede enviar el formulario incompleto cuando un campo condicional pasa a exigirse', async () => {
    // Current state: es_pep is false, so detalle_cargo_pep is not required.
    // However, if contraparte changes es_pep to true:
    await saveDeclaredFields({
      organizationId: orgId,
      dossierId: dossierProveedorId,
      fields: {
        es_pep: true,
      },
    });

    // Now completeDeclaration should fail because detalle_cargo_pep is missing!
    await expect(
      completeDeclaration({
        organizationId: orgId,
        dossierId: dossierProveedorId,
      }),
    ).rejects.toThrow(IncompleteDeclarationError);

    // Verify state has NOT changed
    const [dossier] = await adminSql`
      SELECT state FROM public.dossiers WHERE id = ${dossierProveedorId}::uuid
    `;
    expect(dossier.state).toBe('en_diligenciamiento');
  });

  it('permite completar el formulario cuando todos los campos exigidos están diligenciados y transiciona a documentos_recibidos', async () => {
    // Supply the conditional requirement
    await saveDeclaredFields({
      organizationId: orgId,
      dossierId: dossierProveedorId,
      fields: {
        detalle_cargo_pep: 'Viceministro de Comercio Exterior',
      },
    });

    // Attempting to complete with mandatory doc_rut missing should fail with IncompleteDeclarationError
    await expect(
      completeDeclaration({
        organizationId: orgId,
        dossierId: dossierProveedorId,
      }),
    ).rejects.toThrow(IncompleteDeclarationError);

    // Confirm doc_rut document upload
    await confirmDocumentUpload({
      organizationId: orgId,
      dossierId: dossierProveedorId,
      documentType: 'doc_rut',
      storagePath: `${dossierProveedorId}/doc_rut/test-rut.pdf`,
      hash: 'fakehash1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
      format: 'pdf',
      size: 1024,
      uploadedByType: 'counterparty',
    });

    // Complete declaration now succeeds
    await completeDeclaration({
      organizationId: orgId,
      dossierId: dossierProveedorId,
    });

    // Verify transition
    const [dossier] = await adminSql`
      SELECT state FROM public.dossiers WHERE id = ${dossierProveedorId}::uuid
    `;
    expect(dossier.state).toBe('documentos_recibidos');

    // Trying to save or complete again must be rejected because state is no longer en_diligenciamiento
    await expect(
      saveDeclaredFields({
        organizationId: orgId,
        dossierId: dossierProveedorId,
        fields: {
          razon_social: 'Nueva Razón Social',
        },
      }),
    ).rejects.toThrow();

    await expect(
      completeDeclaration({
        organizationId: orgId,
        dossierId: dossierProveedorId,
      }),
    ).rejects.toThrow();
  });

  it('HU-014: Un documento rechazado no cuenta como entregado para finalizar declaración', async () => {
    // Transition from documentos_recibidos to en_revision
    await executeTransition({
      organizationId: orgId,
      dossierId: dossierProveedorId,
      toState: 'en_revision',
      actorType: 'system',
    });

    // Request corrections: en_revision to en_diligenciamiento with reason
    await executeTransition({
      organizationId: orgId,
      dossierId: dossierProveedorId,
      toState: 'en_diligenciamiento',
      actorType: 'user',
      actorId: analystUserId,
      reason: 'Documento RUT ilegible, requiere reenvío',
    });

    // Mark doc_rut as rejected
    await adminSql`
      UPDATE public.documents
      SET state = 'rejected', rejection_reason = 'Documento ilegible'
      WHERE dossier_id = ${dossierProveedorId}::uuid AND document_type = 'doc_rut'
    `;

    // Attempting to complete declaration should fail because rejected document does not count as delivered
    await expect(
      completeDeclaration({
        organizationId: orgId,
        dossierId: dossierProveedorId,
      }),
    ).rejects.toThrow(IncompleteDeclarationError);

    // Re-upload doc_rut as a valid received document
    await adminSql`
      UPDATE public.documents
      SET state = 'received'
      WHERE dossier_id = ${dossierProveedorId}::uuid AND document_type = 'doc_rut'
    `;

    // Now completes successfully
    await completeDeclaration({
      organizationId: orgId,
      dossierId: dossierProveedorId,
    });
  });

  it('Sugerencias: Campo sin valor declared y con extracted aparece en suggestions', async () => {
    // Create a fresh dossier for this test to avoid state from previous tests
    const dossierTest = await createDossierRequest({
      organizationId: orgId,
      requestedBy: adminUserId,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '999999999',
        declaredName: 'Test Company Suggestions',
      },
      internalOwnerId: adminUserId,
    });

    // Transition to en_diligenciamiento
    await executeTransition({
      organizationId: orgId,
      dossierId: dossierTest.id,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUserId,
    });
    await executeTransition({
      organizationId: orgId,
      dossierId: dossierTest.id,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    // Create a test document first
    const docResult = await adminSql`
      INSERT INTO public.documents (
        organization_id, dossier_id, document_type, version, storage_path, hash, size, format, state, uploaded_by_type
      ) VALUES (
        ${orgId}::uuid, ${dossierTest.id}::uuid, 'doc_rut', 1, 'path/to/doc', 'fakehash123', 1024, 'pdf', 'received', 'counterparty'
      ) RETURNING id
    `;
    const docId = docResult[0].id;

    // Get the dossier's partyId and configurationVersionId for creating assertions
    const [dossierData] = await adminSql`
      SELECT party_id, configuration_version_id FROM public.dossiers WHERE id = ${dossierTest.id}::uuid
    `;

    // Register an extracted assertion for razon_social (no declared value yet)
    // Use producedBy to make it a human-corrected assertion (doesn't require aiExecutionId)
    await registerAssertion(
      {
        organizationId: orgId,
        dossierId: dossierTest.id,
        partyId: dossierData.party_id,
        configurationVersionId: dossierData.configuration_version_id,
        field: 'razon_social',
        value: 'Empresa Sugerida S.A.S.',
        origin: 'extracted',
        confidence: '0.95',
        evidenceId: docId,
        producedBy: analystUserId,
      },
    );

    // Get the form and check suggestions
    const form = await getDeclarationForm(orgId, dossierTest.id);
    expect(form.values['razon_social']).toBeUndefined();
    expect(form.suggestions['razon_social']).toBeDefined();
    expect(form.suggestions['razon_social'].value).toBe('Empresa Sugerida S.A.S.');
    expect(form.suggestions['razon_social'].confidence).toBe('0.95');
  });

  it('Sugerencias: Campo con declared y extracted iguales NO aparece en suggestions', async () => {
    // Create another fresh dossier
    const dossierTest2 = await createDossierRequest({
      organizationId: orgId,
      requestedBy: adminUserId,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '888888888',
        declaredName: 'Test Company Equal Values',
      },
      internalOwnerId: adminUserId,
    });

    await executeTransition({
      organizationId: orgId,
      dossierId: dossierTest2.id,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUserId,
    });
    await executeTransition({
      organizationId: orgId,
      dossierId: dossierTest2.id,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    // Create a test document
    const docResult2 = await adminSql`
      INSERT INTO public.documents (
        organization_id, dossier_id, document_type, version, storage_path, hash, size, format, state, uploaded_by_type
      ) VALUES (
        ${orgId}::uuid, ${dossierTest2.id}::uuid, 'doc_rut', 1, 'path/to/doc2', 'fakehash456', 1024, 'pdf', 'received', 'counterparty'
      ) RETURNING id
    `;
    const docId2 = docResult2[0].id;

    const [dossierData2] = await adminSql`
      SELECT party_id, configuration_version_id FROM public.dossiers WHERE id = ${dossierTest2.id}::uuid
    `;

    // First declare a value
    await saveDeclaredFields({
      organizationId: orgId,
      dossierId: dossierTest2.id,
      fields: {
        razon_social: 'Exact Company Name',
      },
    });

    // Register an extracted assertion with the exact same value
    await registerAssertion(
      {
        organizationId: orgId,
        dossierId: dossierTest2.id,
        partyId: dossierData2.party_id,
        configurationVersionId: dossierData2.configuration_version_id,
        field: 'razon_social',
        value: 'Exact Company Name',
        origin: 'extracted',
        confidence: '0.99',
        evidenceId: docId2,
        producedBy: analystUserId,
      },
    );

    // Get the form and check that suggestion is NOT present (values are equal)
    const form = await getDeclarationForm(orgId, dossierTest2.id);
    expect(form.values['razon_social']).toBe('Exact Company Name');
    expect(form.suggestions['razon_social']).toBeUndefined();
  });

  it('Sugerencias: Campo con declared y extracted distintos aparece en suggestions', async () => {
    // Create another fresh dossier
    const dossierTest3 = await createDossierRequest({
      organizationId: orgId,
      requestedBy: adminUserId,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '777777777',
        declaredName: 'Test Company Conflict',
      },
      internalOwnerId: adminUserId,
    });

    await executeTransition({
      organizationId: orgId,
      dossierId: dossierTest3.id,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUserId,
    });
    await executeTransition({
      organizationId: orgId,
      dossierId: dossierTest3.id,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    // Create a test document
    const docResult3 = await adminSql`
      INSERT INTO public.documents (
        organization_id, dossier_id, document_type, version, storage_path, hash, size, format, state, uploaded_by_type
      ) VALUES (
        ${orgId}::uuid, ${dossierTest3.id}::uuid, 'doc_rut', 1, 'path/to/doc3', 'fakehash789', 1024, 'pdf', 'received', 'counterparty'
      ) RETURNING id
    `;
    const docId3 = docResult3[0].id;

    const [dossierData3] = await adminSql`
      SELECT party_id, configuration_version_id FROM public.dossiers WHERE id = ${dossierTest3.id}::uuid
    `;

    // Declare one value
    await saveDeclaredFields({
      organizationId: orgId,
      dossierId: dossierTest3.id,
      fields: {
        razon_social: 'Company Declared Value',
      },
    });

    // Register extracted assertion with different value
    await registerAssertion(
      {
        organizationId: orgId,
        dossierId: dossierTest3.id,
        partyId: dossierData3.party_id,
        configurationVersionId: dossierData3.configuration_version_id,
        field: 'razon_social',
        value: 'Company Extracted Value',
        origin: 'extracted',
        confidence: '0.85',
        evidenceId: docId3,
        producedBy: analystUserId,
      },
    );

    // Get the form and verify suggestion appears because values differ
    const form = await getDeclarationForm(orgId, dossierTest3.id);
    expect(form.values['razon_social']).toBe('Company Declared Value');
    expect(form.suggestions['razon_social']).toBeDefined();
    expect(form.suggestions['razon_social'].value).toBe('Company Extracted Value');
  });

  it('Sugerencias: Sin afirmación extracted, suggestions es vacío sin romper form', async () => {
    // Create another fresh dossier
    const dossierTest4 = await createDossierRequest({
      organizationId: orgId,
      requestedBy: adminUserId,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '666666666',
        declaredName: 'Test Company No Extraction',
      },
      internalOwnerId: adminUserId,
    });

    await executeTransition({
      organizationId: orgId,
      dossierId: dossierTest4.id,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUserId,
    });
    await executeTransition({
      organizationId: orgId,
      dossierId: dossierTest4.id,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    // Don't register any extracted assertions, just get the form
    const form = await getDeclarationForm(orgId, dossierTest4.id);
    expect(form.suggestions).toEqual({});
    expect(form.fieldRequirements.length).toBeGreaterThan(0);
    expect(form.documentRequirements.length).toBeGreaterThan(0);
  });

  it('Sugerencias: Extracción real de IA (con aiExecutionId, sin producedBy) también genera suggestions', async () => {
    // Create another fresh dossier for this test
    const dossierTest5 = await createDossierRequest({
      organizationId: orgId,
      requestedBy: adminUserId,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '555555555',
        declaredName: 'Test Company Real AI Extraction',
      },
      internalOwnerId: adminUserId,
    });

    await executeTransition({
      organizationId: orgId,
      dossierId: dossierTest5.id,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUserId,
    });
    await executeTransition({
      organizationId: orgId,
      dossierId: dossierTest5.id,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    // Create a test document
    const docResult5 = await adminSql`
      INSERT INTO public.documents (
        organization_id, dossier_id, document_type, version, storage_path, hash, size, format, state, uploaded_by_type
      ) VALUES (
        ${orgId}::uuid, ${dossierTest5.id}::uuid, 'doc_rut', 1, 'path/to/doc5', 'fakehash555', 1024, 'pdf', 'received', 'counterparty'
      ) RETURNING id
    `;
    const docId5 = docResult5[0].id;

    const [dossierData5] = await adminSql`
      SELECT party_id, configuration_version_id FROM public.dossiers WHERE id = ${dossierTest5.id}::uuid
    `;

    // Record a real AI execution (succeeded status, with confidence)
    const aiExec = await recordAiExecution({
      organizationId: orgId,
      dossierId: dossierTest5.id,
      documentId: docId5,
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      modelVersion: '1.0',
      instructionTemplateId: 'template-1',
      instructionTemplateVersion: '1.0',
      dataDestination: 'US',
      sentFragmentHash: 'hash123456',
      status: 'succeeded',
      result: { razon_social: 'AI-Extracted Company Inc.' },
      confidence: '0.92',
    });

    // Register extracted assertion with the real AI execution (no producedBy = genuine AI extraction)
    await registerAssertion({
      organizationId: orgId,
      dossierId: dossierTest5.id,
      partyId: dossierData5.party_id,
      configurationVersionId: dossierData5.configuration_version_id,
      field: 'razon_social',
      value: 'AI-Extracted Company Inc.',
      origin: 'extracted',
      confidence: '0.92',
      evidenceId: docId5,
      aiExecutionId: aiExec.id,
      // no producedBy — this is a genuine AI extraction, will be pending_validation
    });

    // Get the form and verify suggestion appears
    const form = await getDeclarationForm(orgId, dossierTest5.id);
    expect(form.values['razon_social']).toBeUndefined();
    expect(form.suggestions['razon_social']).toBeDefined();
    expect(form.suggestions['razon_social'].value).toBe('AI-Extracted Company Inc.');
    expect(form.suggestions['razon_social'].confidence).toBe('0.92');

    // Verify the assertion is pending_validation (not yet validated)
    const assertions5 = await adminSql`
      SELECT status FROM public.assertions
      WHERE organization_id = ${orgId}::uuid AND dossier_id = ${dossierTest5.id}::uuid AND field = 'razon_social'
    `;
    expect(assertions5[0].status).toBe('pending_validation');
  });
});
