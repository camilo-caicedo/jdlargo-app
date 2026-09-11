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
      name: 'proveedor',
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
      counterpartyTypeName: 'proveedor',
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
});
