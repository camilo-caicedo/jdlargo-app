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
import { confirmDocumentUpload, markDocumentValid, rejectDocument } from '../documents/document';
import {
  ensureReviewEntryTransition,
  getReviewSummary,
  completeReview,
  requestCorrections,
  IncompleteReviewError,
} from './review';

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

const TEST_ORG_NAMES = ['Review Domain Org Test', 'Review Org Other'];

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
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu014-rev.com')
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
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu014-rev.com')
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
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu014-rev.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu014-rev.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-014: Revisión del expediente y solicitud de correcciones', () => {
  let orgId: string;
  let adminUserId: string;
  let analystUserId: string;
  let officerUserId: string;
  let dossierId: string;
  let partyId: string;

  beforeAll(async () => {
    await cleanupTestData();

    adminUserId = await createTestAuthUser('admin@test-hu014-rev.com', 'Admin Review');
    const org = await createOrganizationWithAdmin(adminUserId, { name: 'Review Domain Org Test' });
    orgId = org.id;

    await seedBaseConfiguration(orgId, adminUserId);

    // Create Analyst & Officer
    analystUserId = await createTestAuthUser('analyst@test-hu014-rev.com', 'Analyst Review');
    await grantMembership(adminUserId, {
      organizationId: orgId,
      userId: analystUserId,
      role: 'compliance_analyst',
    });

    officerUserId = await createTestAuthUser('officer@test-hu014-rev.com', 'Officer Review');
    await grantMembership(adminUserId, {
      organizationId: orgId,
      userId: officerUserId,
      role: 'compliance_officer',
    });

    // Create draft configuration with fields and documents
    const draft = await createDraftConfiguration({ organizationId: orgId, standard: 'SARLAFT' });
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
      key: 'tax_id',
      mandatory: 'always',
      validation: { dataType: 'string', min: 3 },
    });

    await addRequirement({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: cpType.id,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'doc_rut',
      mandatory: 'always',
    });

    await publishDraftConfiguration({
      organizationId: orgId,
      versionId: draft.versionId,
      publishedBy: adminUserId,
      reason: 'Versión con requisitos para HU-014',
    });

    // Create dossier
    const dossier = await createDossierRequest({
      organizationId: orgId,
      requestedBy: adminUserId,
      counterpartyTypeName: 'proveedor',
      party: {
        identificationType: 'NIT',
        identificationNumber: '901234567',
        declaredName: 'Proveedora del Norte S.A.S.',
      },
      internalOwnerId: adminUserId,
    });
    dossierId = dossier.id;
    partyId = dossier.partyId;

    // Progress dossier to documentos_recibidos: borrador -> enviada -> en_diligenciamiento -> documentos_recibidos
    await executeTransition({
      organizationId: orgId,
      dossierId,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUserId,
    });
    await executeTransition({
      organizationId: orgId,
      dossierId,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    // Declare required field
    await registerAssertion({
      organizationId: orgId,
      dossierId,
      partyId,
      configurationVersionId: dossier.configurationVersionId,
      field: 'tax_id',
      value: '901234567-8',
      origin: 'declared',
    });

    // Upload required document
    await confirmDocumentUpload({
      organizationId: orgId,
      dossierId,
      documentType: 'doc_rut',
      storagePath: `${dossierId}/doc_rut/rut.pdf`,
      hash: 'fakehash1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
      format: 'pdf',
      size: 2048,
      uploadedByType: 'counterparty',
    });

    await executeTransition({
      organizationId: orgId,
      dossierId,
      toState: 'documentos_recibidos',
      actorType: 'counterparty',
    });
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  }, 60000);

  it('Escenario: Ver el expediente completo para revisarlo y transición automática a en_revision', async () => {
    // Calling ensureReviewEntryTransition simulates opening the dossier in staff UI
    await ensureReviewEntryTransition(orgId, dossierId);

    const [row] = await adminSql`
      SELECT state FROM public.dossiers WHERE id = ${dossierId}::uuid
    `;
    expect(row.state).toBe('en_revision');

    // Calling it again is idempotent
    await ensureReviewEntryTransition(orgId, dossierId);
    const [rowAgain] = await adminSql`
      SELECT state FROM public.dossiers WHERE id = ${dossierId}::uuid
    `;
    expect(rowAgain.state).toBe('en_revision');
  });

  it('Escenario: Un expediente incompleto no pasa a decisión (documento en estado received sin validar)', async () => {
    // Document exists but is state: 'received', NOT 'valid'
    const summary = await getReviewSummary(orgId, dossierId);
    expect(summary.isReadyForDecision).toBe(false);
    expect(summary.missingOrInvalidDocumentTypes).toContain('doc_rut');

    await expect(
      completeReview({
        organizationId: orgId,
        dossierId,
        reviewedBy: analystUserId,
      }),
    ).rejects.toThrow(IncompleteReviewError);

    // State is still en_revision
    const [row] = await adminSql`
      SELECT state FROM public.dossiers WHERE id = ${dossierId}::uuid
    `;
    expect(row.state).toBe('en_revision');
  });

  it('Escenario: Rechazar un documento sin perder lo demás y solicitar corrección devuelve a en_diligenciamiento', async () => {
    const [doc] = await adminSql`
      SELECT id FROM public.documents WHERE dossier_id = ${dossierId}::uuid AND document_type = 'doc_rut'
    `;

    // Reject document with reason
    await rejectDocument({
      organizationId: orgId,
      dossierId,
      documentId: doc.id,
      reviewedBy: analystUserId,
      reason: 'RUT desactualizado o borroso',
    });

    // Request corrections with reason
    await requestCorrections({
      organizationId: orgId,
      dossierId,
      requestedBy: analystUserId,
      reason: 'Por favor actualice su RUT con fecha de generación del año en curso',
    });

    // Dossier is now back to en_diligenciamiento
    const [dossierRow] = await adminSql`
      SELECT state FROM public.dossiers WHERE id = ${dossierId}::uuid
    `;
    expect(dossierRow.state).toBe('en_diligenciamiento');

    // Field assertions are still intact
    const [assertionRow] = await adminSql`
      SELECT value FROM public.assertions
      WHERE dossier_id = ${dossierId}::uuid AND field = 'tax_id' AND status = 'active'
    `;
    expect(assertionRow.value).toBe('901234567-8');
  });

  it('rechaza solicitar correcciones sin motivo obligatorio', async () => {
    // Put back to en_revision
    await executeTransition({
      organizationId: orgId,
      dossierId,
      toState: 'documentos_recibidos',
      actorType: 'counterparty',
    });
    await executeTransition({
      organizationId: orgId,
      dossierId,
      toState: 'en_revision',
      actorType: 'system',
    });

    await expect(
      requestCorrections({
        organizationId: orgId,
        dossierId,
        requestedBy: analystUserId,
        reason: '   ',
      }),
    ).rejects.toThrow(/motivo explícito no vacío/);
  });

  it('Escenario: Marcar documento como válido y dar el expediente por listo para decisión', async () => {
    const [doc] = await adminSql`
      SELECT id FROM public.documents WHERE dossier_id = ${dossierId}::uuid AND document_type = 'doc_rut'
    `;

    // Mark valid
    await markDocumentValid({
      organizationId: orgId,
      dossierId,
      documentId: doc.id,
      reviewedBy: analystUserId,
    });

    const summary = await getReviewSummary(orgId, dossierId);
    expect(summary.isReadyForDecision).toBe(true);

    // Complete review: transitions to 'pendiente_de_decision'
    await completeReview({
      organizationId: orgId,
      dossierId,
      reviewedBy: analystUserId,
    });

    const [row] = await adminSql`
      SELECT state FROM public.dossiers WHERE id = ${dossierId}::uuid
    `;
    expect(row.state).toBe('pendiente_de_decision');
  });

  it('Escenario: La revisión no decide (analista sin permiso dossier:approve no puede aprobar)', async () => {
    // Attempt to transition to 'aprobada' using analyst credentials should fail
    await expect(
      executeTransition({
        organizationId: orgId,
        dossierId,
        toState: 'aprobada',
        actorType: 'user',
        actorId: analystUserId,
      }),
    ).rejects.toThrow(/falta el permiso 'dossier:approve'/);

    // State remains pendiente_de_decision
    const [row] = await adminSql`
      SELECT state FROM public.dossiers WHERE id = ${dossierId}::uuid
    `;
    expect(row.state).toBe('pendiente_de_decision');
  });
});
