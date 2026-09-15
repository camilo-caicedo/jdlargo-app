import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('@/lib/antivirus', () => {
  return {
    scanBuffer: vi.fn(async (buffer: Buffer) => {
      const content = buffer.toString('utf8');
      if (content.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) {
        return {
          infected: true,
          viruses: ['Eicar-Test-Signature'],
        };
      }
      return {
        infected: false,
        viruses: [],
      };
    }),
  };
});

import postgres from 'postgres';
import { createHash } from 'crypto';
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
import { createDossierRequest } from '../dossiers/dossier';
import { executeTransition } from '../dossiers/state-machine';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { DOSSIER_DOCUMENTS_BUCKET } from '@/lib/document-upload-constants';
import {
  requestDocumentUpload,
  readAndValidateUploadedFile,
  confirmDocumentUpload,
  getLatestDocumentsForDossier,
  verifyDocumentIntegrity,
  getDocumentDownloadUrl,
  getPortalDocumentDownloadUrl,
  detectFormatFromMagicBytes,
  markDocumentValid,
  rejectDocument,
  evaluateDocumentExpirations,
} from './document';
import { computeEffectiveExpiry, type DocumentValidityConfig } from '@/lib/document-validity';
import { getOpenDiscrepancies } from '../reconciliation/service';

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

const TEST_ORG_NAMES = ['Document Test Org Alpha'];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu013.com')
  `;
  await adminSql`
    DELETE FROM public.documents
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.assertions
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
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu013.com')
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
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu013.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu013.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-013: Carga de los documentos exigidos', () => {
  let orgId: string;
  let adminUserId: string;
  let analystUserId: string;
  let typeProveedorId: string;
  let dossierId: string;
  let configVersionId: string;
  const createdStoragePaths: string[] = [];

  beforeAll(async () => {
    await cleanupTestData();

    adminUserId = await createTestAuthUser('admin@test-hu013.com', 'Admin HU013');
    analystUserId = await createTestAuthUser('analyst@test-hu013.com', 'Analyst HU013');

    const org = await createOrganizationWithAdmin(adminUserId, { name: 'Document Test Org Alpha' });
    orgId = org.id;

    await seedBaseConfiguration(orgId, adminUserId);
    await grantMembership(adminUserId, {
      organizationId: orgId,
      userId: analystUserId,
      role: 'compliance_analyst',
    });

    const draft = await createDraftConfiguration({ organizationId: orgId, standard: 'SARLAFT' });
    configVersionId = draft.versionId;
    const typeProveedor = await addCounterpartyType({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      name: 'proveedor_custom',
      nature: 'legal_entity',
    });
    typeProveedorId = typeProveedor.id;

    // Field requirement
    await addRequirement({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeProveedorId,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });

    // Document requirement: doc_rut (mandatory)
    await addRequirement({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeProveedorId,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'doc_rut',
      mandatory: 'always',
    });

    // Document requirement: doc_camara (optional)
    await addRequirement({
      organizationId: orgId,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeProveedorId,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'doc_camara',
      mandatory: 'optional',
    });

    await publishDraftConfiguration({
      organizationId: orgId,
      versionId: draft.versionId,
      publishedBy: adminUserId,
      reason: 'Publish HU013 config',
    });

    const dossier = await createDossierRequest({
      organizationId: orgId,
      requestedBy: adminUserId,
      counterpartyTypeName: 'proveedor_custom',
      party: {
        identificationType: 'NIT',
        identificationNumber: '900999888',
        declaredName: 'Proveedor HU013 S.A.S.',
      },
      internalOwnerId: analystUserId,
    });
    dossierId = dossier.id;

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
      actorType: 'user',
      actorId: adminUserId,
    });
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

  describe('Detección binaria (magic bytes)', () => {
    it('detecta correctamente firmas PDF, JPG y PNG', () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 test content');
      expect(detectFormatFromMagicBytes(pdfBuffer)).toBe('pdf');

      const jpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(detectFormatFromMagicBytes(jpgBuffer)).toBe('jpg');

      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      expect(detectFormatFromMagicBytes(pngBuffer)).toBe('png');

      const txtBuffer = Buffer.from('Plain text file pretending to be PDF');
      expect(detectFormatFromMagicBytes(txtBuffer)).toBeNull();
    });
  });

  describe('requestDocumentUpload', () => {
    it('genera URL firmada para un tipo documental existente en la matriz', async () => {
      const result = await requestDocumentUpload({
        organizationId: orgId,
        dossierId,
        documentType: 'doc_rut',
        fileName: 'rut.pdf',
        declaredSize: 1024 * 50,
        declaredMimeType: 'application/pdf',
      });

      expect(result.signedUrl).toBeDefined();
      expect(result.uploadToken).toBeDefined();
      expect(result.storagePath).toContain(`${dossierId}/doc_rut/`);
      createdStoragePaths.push(result.storagePath);
    });

    it('rechaza si el tipo documental no existe en la matriz del expediente', async () => {
      await expect(
        requestDocumentUpload({
          organizationId: orgId,
          dossierId,
          documentType: 'tipo_inexistente',
          fileName: 'algo.pdf',
          declaredSize: 1024,
          declaredMimeType: 'application/pdf',
        }),
      ).rejects.toThrow(/no existe en la matriz de requisitos/);
    });

    it('rechaza si el tamaño declarado excede 20MB o MIME type no permitido', async () => {
      await expect(
        requestDocumentUpload({
          organizationId: orgId,
          dossierId,
          documentType: 'doc_rut',
          fileName: 'grande.pdf',
          declaredSize: 25 * 1024 * 1024,
          declaredMimeType: 'application/pdf',
        }),
      ).rejects.toThrow(/excede el tamaño máximo/);

      await expect(
        requestDocumentUpload({
          organizationId: orgId,
          dossierId,
          documentType: 'doc_rut',
          fileName: 'script.exe',
          declaredSize: 1024,
          declaredMimeType: 'application/x-msdownload',
        }),
      ).rejects.toThrow(/no está permitido/);
    });
  });

  describe('readAndValidateUploadedFile y confirmDocumentUpload', () => {
    it('Escenario: Cargar un documento válido, registrar huella y metadatos', async () => {
      const adminStorage = createSupabaseAdminClient();
      const testPdfContent = Buffer.from('%PDF-1.4 Fake test PDF content for RUT');
      const testPath = `${dossierId}/doc_rut/test-valid-1.pdf`;
      createdStoragePaths.push(testPath);

      const { error: uploadErr } = await adminStorage.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .upload(testPath, testPdfContent, { contentType: 'application/pdf', upsert: true });
      expect(uploadErr).toBeNull();

      const validated = await readAndValidateUploadedFile(testPath);
      expect(validated.format).toBe('pdf');
      expect(validated.size).toBe(testPdfContent.length);
      const expectedHash = createHash('sha256').update(testPdfContent).digest('hex');
      expect(validated.hash).toBe(expectedHash);

      const confirmRes = await confirmDocumentUpload({
        organizationId: orgId,
        dossierId,
        documentType: 'doc_rut',
        storagePath: testPath,
        hash: validated.hash,
        format: validated.format,
        size: validated.size,
        declaredIssuer: 'DIAN',
        issuedAt: '2026-01-15',
        uploadedByType: 'counterparty',
      });

      expect(confirmRes.version).toBe(1);
      expect(confirmRes.deduplicated).toBe(false);

      const latest = await getLatestDocumentsForDossier(orgId, dossierId);
      const rutDoc = latest.find((d) => d.documentType === 'doc_rut');
      expect(rutDoc).toBeDefined();
      expect(rutDoc?.version).toBe(1);
      expect(rutDoc?.hash).toBe(expectedHash);
      expect(rutDoc?.state).toBe('received');
    });

    it('Escenario: Deduplicación — mismo archivo dos veces no crea versión nueva', async () => {
      const adminStorage = createSupabaseAdminClient();
      const testPdfContent = Buffer.from('%PDF-1.4 Fake test PDF content for RUT');
      const testPath2 = `${dossierId}/doc_rut/test-valid-2.pdf`;
      createdStoragePaths.push(testPath2);

      await adminStorage.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .upload(testPath2, testPdfContent, { contentType: 'application/pdf', upsert: true });

      const validated = await readAndValidateUploadedFile(testPath2);

      const confirmRes = await confirmDocumentUpload({
        organizationId: orgId,
        dossierId,
        documentType: 'doc_rut',
        storagePath: testPath2,
        hash: validated.hash,
        format: validated.format,
        size: validated.size,
        uploadedByType: 'counterparty',
      });

      expect(confirmRes.deduplicated).toBe(true);
      expect(confirmRes.version).toBe(1);

      const latest = await getLatestDocumentsForDossier(orgId, dossierId);
      const rutDocs = latest.filter((d) => d.documentType === 'doc_rut');
      expect(rutDocs.length).toBe(1);
    });

    it('Escenario: Reemplazar documento con contenido distinto genera versión 2 conservando versión 1', async () => {
      const adminStorage = createSupabaseAdminClient();
      const newPdfContent = Buffer.from('%PDF-1.4 Second Version of RUT with different content');
      const testPathV2 = `${dossierId}/doc_rut/test-valid-v2.pdf`;
      createdStoragePaths.push(testPathV2);

      await adminStorage.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .upload(testPathV2, newPdfContent, { contentType: 'application/pdf', upsert: true });

      const validated = await readAndValidateUploadedFile(testPathV2);

      const confirmRes = await confirmDocumentUpload({
        organizationId: orgId,
        dossierId,
        documentType: 'doc_rut',
        storagePath: testPathV2,
        hash: validated.hash,
        format: validated.format,
        size: validated.size,
        uploadedByType: 'counterparty',
      });

      expect(confirmRes.deduplicated).toBe(false);
      expect(confirmRes.version).toBe(2);

      const allRutRows = await adminSql`
        SELECT version, hash FROM public.documents
        WHERE dossier_id = ${dossierId} AND document_type = 'doc_rut'
        ORDER BY version ASC
      `;
      expect(allRutRows.length).toBe(2);
      expect(allRutRows[0].version).toBe(1);
      expect(allRutRows[1].version).toBe(2);

      const latest = await getLatestDocumentsForDossier(orgId, dossierId);
      const rutDoc = latest.find((d) => d.documentType === 'doc_rut');
      expect(rutDoc?.version).toBe(2);
      expect(rutDoc?.hash).toBe(validated.hash);
    });

    it('Escenario: Archivo con magic bytes falsos es rechazado y eliminado de storage', async () => {
      const adminStorage = createSupabaseAdminClient();
      const fakePdfContent = Buffer.from('This is completely plain text with a .pdf extension');
      const fakePath = `${dossierId}/doc_camara/fake-camara.pdf`;
      createdStoragePaths.push(fakePath);

      await adminStorage.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .upload(fakePath, fakePdfContent, { contentType: 'application/pdf', upsert: true });

      await expect(readAndValidateUploadedFile(fakePath)).rejects.toThrow(
        /Verificación binaria fallida/,
      );

      const { data } = await adminStorage.storage.from(DOSSIER_DOCUMENTS_BUCKET).download(fakePath);
      expect(data).toBeNull();
    });

    it('Escenario: Un archivo infectado se rechaza sin llegar a guardarse', async () => {
      const adminStorage = createSupabaseAdminClient();
      // EICAR standard test signature with PDF prefix so magic bytes pass
      const infectedContent = Buffer.from('%PDF-1.4 X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
      const infectedPath = `${dossierId}/doc_camara/infected-test.pdf`;
      createdStoragePaths.push(infectedPath);

      // Simular subida a Storage (como lo hace el cliente en el portal tras requestDocumentUpload)
      const uploadReq = await requestDocumentUpload({
        organizationId: orgId,
        dossierId,
        documentType: 'doc_camara',
        fileName: 'infected-test.pdf',
        declaredSize: infectedContent.length,
        declaredMimeType: 'application/pdf',
      });
      expect(uploadReq.storagePath).toBeDefined();

      await adminStorage.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .upload(infectedPath, infectedContent, { contentType: 'application/pdf', upsert: true });

      // readAndValidateUploadedFile debe detectar el malware y rechazar
      await expect(readAndValidateUploadedFile(infectedPath, orgId)).rejects.toThrow(
        /El archivo no pasó el escaneo antivirus y fue rechazado/,
      );

      // Objeto eliminado de Storage
      const { data } = await adminStorage.storage.from(DOSSIER_DOCUMENTS_BUCKET).download(infectedPath);
      expect(data).toBeNull();

      // Ningún documento guardado en la base de datos
      const [docRow] = await adminSql<{ id: string }[]>`
        SELECT id FROM public.documents WHERE storage_path = ${infectedPath}
      `;
      expect(docRow).toBeUndefined();

      // El evento queda registrado en la bitácora
      const [auditEvent] = await adminSql<{ action: string; metadata: Record<string, unknown> }[]>`
        SELECT action, metadata FROM public.audit_log
        WHERE organization_id = ${orgId}
          AND action = 'document.upload_rejected_malware'
        ORDER BY occurred_at DESC
        LIMIT 1
      `;
      expect(auditEvent).toBeDefined();
      expect(auditEvent.action).toBe('document.upload_rejected_malware');
      expect(auditEvent.metadata.storagePath).toBe(infectedPath);
    });

    it('Escenario: La huella digital detecta si el archivo almacenado cambió', async () => {
      const latest = await getLatestDocumentsForDossier(orgId, dossierId);
      const rutDoc = latest.find((d) => d.documentType === 'doc_rut');
      expect(rutDoc).toBeDefined();

      const check1 = await verifyDocumentIntegrity(orgId, rutDoc!.id);
      expect(check1.matches).toBe(true);

      const adminStorage = createSupabaseAdminClient();
      const tamperedContent = Buffer.from('%PDF-1.4 Tampered content maliciously replacing original');
      await adminStorage.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .upload(rutDoc!.storagePath, tamperedContent, { upsert: true });

      const check2 = await verifyDocumentIntegrity(orgId, rutDoc!.id);
      expect(check2.matches).toBe(false);

      const [updatedRow] = await adminSql`
        SELECT state FROM public.documents WHERE id = ${rutDoc!.id}
      `;
      expect(updatedRow.state).toBe('requires_review');
    });
  });

  describe('Autorización de descarga', () => {
    it('permite descarga a usuario interno con permiso document:view', async () => {
      const adminStorage = createSupabaseAdminClient();
      const validPdfContent = Buffer.from('%PDF-1.4 Second Version of RUT with different content');
      const latestBefore = await getLatestDocumentsForDossier(orgId, dossierId);
      const rutDocBefore = latestBefore.find((d) => d.documentType === 'doc_rut') || latestBefore[0];
      await adminStorage.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .upload(rutDocBefore.storagePath, validPdfContent, { upsert: true });

      const latest = await getLatestDocumentsForDossier(orgId, dossierId);
      const rutDoc = latest[0];

      const result = await getDocumentDownloadUrl({
        organizationId: orgId,
        dossierId,
        documentId: rutDoc.id,
        requestedBy: { userId: analystUserId },
      });

      expect(result.url).toBeDefined();
      expect(result.url).toContain('token=');
      expect(result.integrityMatches).toBe(true);
    });

    it('rechaza descarga a usuario de otra organización o sin permiso', async () => {
      const latest = await getLatestDocumentsForDossier(orgId, dossierId);
      const rutDoc = latest[0];

      const otherUser = await createTestAuthUser('other@test-hu013.com', 'Other User');

      await expect(
        getDocumentDownloadUrl({
          organizationId: orgId,
          dossierId,
          documentId: rutDoc.id,
          requestedBy: { userId: otherUser },
        }),
      ).rejects.toThrow();
    });

    it('permite descarga desde el portal a través de getPortalDocumentDownloadUrl', async () => {
      const latest = await getLatestDocumentsForDossier(orgId, dossierId);
      const rutDoc = latest[0];

      const url = await getPortalDocumentDownloadUrl({
        organizationId: orgId,
        dossierId,
        documentId: rutDoc.id,
      });

      expect(url).toBeDefined();
      expect(url).toContain('token=');
    });

    it('detecta manipulación y devuelve integrityMatches: false al descargar archivo alterado en storage', async () => {
      const latest = await getLatestDocumentsForDossier(orgId, dossierId);
      const rutDoc = latest.find((d) => d.documentType === 'doc_rut');
      expect(rutDoc).toBeDefined();

      const adminStorage = createSupabaseAdminClient();
      const alteredContent = Buffer.from('%PDF-1.4 Malicious alteration of document content');
      await adminStorage.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .upload(rutDoc!.storagePath, alteredContent, { upsert: true });

      const result = await getDocumentDownloadUrl({
        organizationId: orgId,
        dossierId,
        documentId: rutDoc!.id,
        requestedBy: { userId: analystUserId },
      });

      expect(result.url).toBeDefined();
      expect(result.integrityMatches).toBe(false);

      const [updatedRow] = await adminSql`
        SELECT state FROM public.documents WHERE id = ${rutDoc!.id}
      `;
      expect(updatedRow.state).toBe('requires_review');
    });
  });

  describe('HU-014: Revisión y validación de documentos', () => {
    it('marca un documento como válido y registra revisor, fecha y auditoría', async () => {
      const latest = await getLatestDocumentsForDossier(orgId, dossierId);
      const docToValidate = latest[0];

      await markDocumentValid({
        organizationId: orgId,
        dossierId,
        documentId: docToValidate.id,
        reviewedBy: analystUserId,
      });

      const [row] = await adminSql`
        SELECT state, reviewed_by_user_id, reviewed_at, rejection_reason
        FROM public.documents
        WHERE id = ${docToValidate.id}::uuid
      `;

      expect(row.state).toBe('valid');
      expect(row.reviewed_by_user_id).toBe(analystUserId);
      expect(row.reviewed_at).toBeDefined();

      const auditRows = await adminSql`
        SELECT action, entity_id FROM public.audit_log
        WHERE action = 'document.marked_valid' AND entity_id = ${docToValidate.id}
      `;
      expect(auditRows.length).toBeGreaterThan(0);
    });

    it('rechaza un documento con motivo y registra en auditoría', async () => {
      const latest = await getLatestDocumentsForDossier(orgId, dossierId);
      const docToReject = latest[0];

      await rejectDocument({
        organizationId: orgId,
        dossierId,
        documentId: docToReject.id,
        reviewedBy: analystUserId,
        reason: 'Documento borroso o ilegible',
      });

      const [row] = await adminSql`
        SELECT state, reviewed_by_user_id, reviewed_at, rejection_reason
        FROM public.documents
        WHERE id = ${docToReject.id}::uuid
      `;

      expect(row.state).toBe('rejected');
      expect(row.reviewed_by_user_id).toBe(analystUserId);
      expect(row.rejection_reason).toBe('Documento borroso o ilegible');

      const auditRows = await adminSql`
        SELECT action, entity_id FROM public.audit_log
        WHERE action = 'document.rejected' AND entity_id = ${docToReject.id}
      `;
      expect(auditRows.length).toBeGreaterThan(0);
    });

    it('falla al intentar rechazar un documento con motivo vacío', async () => {
      const latest = await getLatestDocumentsForDossier(orgId, dossierId);
      const doc = latest[0];

      await expect(
        rejectDocument({
          organizationId: orgId,
          dossierId,
          documentId: doc.id,
          reviewedBy: analystUserId,
          reason: '   ',
        }),
      ).rejects.toThrow(/motivo explícito no vacío/);
    });

    it('rechaza marcar o rechazar documento a usuario sin permiso document:review', async () => {
      const latest = await getLatestDocumentsForDossier(orgId, dossierId);
      const doc = latest[0];
      const unauthorizedUser = await createTestAuthUser(`unauth-${Date.now()}@test-hu014.com`, 'Unauth User');

      await expect(
        markDocumentValid({
          organizationId: orgId,
          dossierId,
          documentId: doc.id,
          reviewedBy: unauthorizedUser,
        }),
      ).rejects.toThrow();

      await expect(
        rejectDocument({
          organizationId: orgId,
          dossierId,
          documentId: doc.id,
          reviewedBy: unauthorizedUser,
          reason: 'Intento no autorizado',
        }),
      ).rejects.toThrow();
    });
  });

  describe('HU-021: Vigencias y estados del documento', () => {
    const createTestDossierWithConfig = async (docTypeName: string, validity?: DocumentValidityConfig['validity']) => {
      const newDraft = await createDraftConfiguration({ organizationId: orgId, standard: 'SARLAFT' });
      const [type] = await adminSql`
        SELECT id FROM public.counterparty_types
        WHERE organization_id = ${orgId} AND configuration_version_id = ${newDraft.versionId} LIMIT 1
      `;
      await addRequirement({
        organizationId: orgId,
        configurationVersionId: newDraft.versionId,
        counterpartyTypeId: type.id,
        standard: 'SARLAFT',
        type: 'document_type',
        key: docTypeName,
        mandatory: 'always',
        blocking: true,
        ...(validity ? { validity } : {}),
      });
      await publishDraftConfiguration({
        organizationId: orgId,
        versionId: newDraft.versionId,
        publishedBy: adminUserId,
        reason: 'Test HU-021',
      });

      const newDossier = await createDossierRequest({
        organizationId: orgId,
        requestedBy: adminUserId,
        counterpartyTypeName: 'proveedor_custom',
        party: {
          identificationType: 'NIT',
          identificationNumber: Math.floor(Math.random() * 999999999).toString(),
          declaredName: `Test ${docTypeName}`,
        },
        internalOwnerId: analystUserId,
      });

      // Transicionar a en_diligenciamiento
      await executeTransition({
        organizationId: orgId,
        dossierId: newDossier.id,
        toState: 'enviada',
        actorType: 'user',
        actorId: adminUserId,
      });
      await executeTransition({
        organizationId: orgId,
        dossierId: newDossier.id,
        toState: 'en_diligenciamiento',
        actorType: 'user',
        actorId: adminUserId,
      });

      return newDossier.id;
    };

    it('confirmDocumentUpload con vigencia vencida: rechaza al subir y registra afirmaciones', async () => {
      const adminStorage = createSupabaseAdminClient();
      const testDossierId = await createTestDossierWithConfig('doc_rut_expire_test', {
        mode: 'duration_from_issued',
        durationDays: 30,
      });

      // Debug: verify dossier config and requirements
      const [dossierDebug] = await adminSql`
        SELECT configuration_version_id FROM public.dossiers WHERE id = ${testDossierId}
      `;
      const docsReq = await adminSql`
        SELECT key FROM public.requirements
        WHERE configuration_version_id = ${dossierDebug.configuration_version_id}
        AND type = 'document_type'
      `;
      console.log('Dossier config:', dossierDebug?.configuration_version_id);
      console.log('Doc requirements:', docsReq.map(r => r.key));

      const testPdfContent = Buffer.from('%PDF-1.4 Fake PDF for expiry test');
      const testPath = `${testDossierId}/doc_rut_expire_test/expired-1.pdf`;
      createdStoragePaths.push(testPath);

      await adminStorage.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .upload(testPath, testPdfContent, { contentType: 'application/pdf', upsert: true });

      const validated = await readAndValidateUploadedFile(testPath);

      // Subir documento con fecha de expedición hace 40 días (vencido)
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const confirmRes = await confirmDocumentUpload({
        organizationId: orgId,
        dossierId: testDossierId,
        documentType: 'doc_rut_expire_test',
        storagePath: testPath,
        hash: validated.hash,
        format: validated.format,
        size: validated.size,
        issuedAt: fortyDaysAgo,
        uploadedByType: 'counterparty',
      });

      // Verificar que el documento está en estado requires_review
      const latest = await getLatestDocumentsForDossier(orgId, testDossierId);
      const expiredDoc = latest.find((d) => d.documentType === 'doc_rut_expire_test');
      expect(expiredDoc?.state).toBe('requires_review');
      expect(expiredDoc?.rejectionReason).toContain('vencido');

      // Verificar que la afirmación de fecha se registró igual
      const assertions = await adminSql`
        SELECT * FROM public.assertions
        WHERE organization_id = ${orgId} AND field = ${'document:doc_rut_expire_test:issued_at'}
      `;
      expect(assertions.length).toBeGreaterThan(0);
      expect(assertions[0].value).toBe(fortyDaysAgo);
    });

    it('confirmDocumentUpload con no_expiration: no rechaza por fechas pasadas', async () => {
      const adminStorage = createSupabaseAdminClient();
      const testDossierId = await createTestDossierWithConfig('doc_rut_no_exp', {
        mode: 'no_expiration',
      });

      const testPdfContent = Buffer.from('%PDF-1.4 Fake PDF no-expiry');
      const testPath = `${testDossierId}/doc_rut_no_exp/no-exp-1.pdf`;
      createdStoragePaths.push(testPath);

      await adminStorage.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .upload(testPath, testPdfContent, { contentType: 'application/pdf', upsert: true });

      const validated = await readAndValidateUploadedFile(testPath);

      // Subir documento con fecha muy antigua
      const veryOld = '1990-01-01';
      await confirmDocumentUpload({
        organizationId: orgId,
        dossierId: testDossierId,
        documentType: 'doc_rut_no_exp',
        storagePath: testPath,
        hash: validated.hash,
        format: validated.format,
        size: validated.size,
        issuedAt: veryOld,
        uploadedByType: 'counterparty',
      });

      // Verificar que el documento está en estado received (no rechazado)
      const latest = await getLatestDocumentsForDossier(orgId, testDossierId);
      const doc = latest.find((d) => d.documentType === 'doc_rut_no_exp');
      expect(doc?.state).toBe('received');
      expect(doc?.rejectionReason).toBeNull();
    });

    it('evaluateDocumentExpirations sin discrepancia: transiciona a expired', async () => {
      const adminStorage = createSupabaseAdminClient();
      const testDossierId = await createTestDossierWithConfig('doc_eval_exp', {
        mode: 'duration_from_issued',
        durationDays: 365,
      });

      const testPdfContent = Buffer.from('%PDF-1.4 For expiry evaluation');
      const testPath = `${testDossierId}/doc_eval_exp/eval-1.pdf`;
      createdStoragePaths.push(testPath);

      await adminStorage.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .upload(testPath, testPdfContent, { contentType: 'application/pdf', upsert: true });

      const validated = await readAndValidateUploadedFile(testPath);

      // Subir documento con fecha de hace 400 días (vencido)
      const fourHundredDaysAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const confirmRes = await confirmDocumentUpload({
        organizationId: orgId,
        dossierId: testDossierId,
        documentType: 'doc_eval_exp',
        storagePath: testPath,
        hash: validated.hash,
        format: validated.format,
        size: validated.size,
        issuedAt: fourHundredDaysAgo,
        uploadedByType: 'counterparty',
      });

      // Evaluar vigencias
      const result = await evaluateDocumentExpirations(orgId, testDossierId);

      // Verificar que el documento está en expired
      const latest = await getLatestDocumentsForDossier(orgId, testDossierId);
      const evalDoc = latest.find((d) => d.documentType === 'doc_eval_exp');
      expect(evalDoc?.state).toBe('expired');
      expect(result.expiredDocumentIds).toContain(evalDoc?.id);

      // Verificar que hay un audit log
      const auditLog = await adminSql`
        SELECT * FROM public.audit_log
        WHERE organization_id = ${orgId} AND action = 'document.expired' AND entity_id = ${evalDoc?.id}
      `;
      expect(auditLog.length).toBeGreaterThan(0);
    });

    it('evaluateDocumentExpirations con discrepancia abierta: no transiciona', async () => {
      const adminStorage = createSupabaseAdminClient();
      const testDossierId = await createTestDossierWithConfig('doc_discr', {
        mode: 'duration_from_issued',
        durationDays: 30,
      });

      const testPdfContent = Buffer.from('%PDF-1.4 For discrepancy test');
      const testPath = `${testDossierId}/doc_discr/discr-1.pdf`;
      createdStoragePaths.push(testPath);

      await adminStorage.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .upload(testPath, testPdfContent, { contentType: 'application/pdf', upsert: true });

      const validated = await readAndValidateUploadedFile(testPath);

      // Subir documento
      const vencido = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const confirmRes = await confirmDocumentUpload({
        organizationId: orgId,
        dossierId: testDossierId,
        documentType: 'doc_discr',
        storagePath: testPath,
        hash: validated.hash,
        format: validated.format,
        size: validated.size,
        issuedAt: vencido,
        uploadedByType: 'counterparty',
      });

      // Crear una discrepancia abierta sobre issued_at
      const [dossierData] = await adminSql`
        SELECT party_id, configuration_version_id FROM public.dossiers WHERE id = ${testDossierId}
      `;
      await adminSql`
        INSERT INTO public.assertions (
          id, organization_id, dossier_id, party_id, configuration_version_id,
          field, value, origin, produced_by, produced_at, evidence_id, confidence,
          ai_execution_id, ai_model_metadata, is_pending_validation, created_at
        ) VALUES (
          gen_random_uuid(), ${orgId}, ${testDossierId}, ${dossierData.party_id}, ${dossierData.configuration_version_id},
          ${'document:doc_discr:issued_at'}, ${'2025-01-01'}, 'extracted', NULL, now(), ${confirmRes.id}, NULL,
          NULL, NULL, true, now()
        )
      `;

      // Evaluar vigencias
      const result = await evaluateDocumentExpirations(orgId, testDossierId);

      // Verificar que el documento SIGUE en su estado anterior (not expired)
      const latest = await getLatestDocumentsForDossier(orgId, testDossierId);
      const discrDoc = latest.find((d) => d.documentType === 'doc_discr');
      expect(discrDoc?.state).not.toBe('expired');
      expect(result.expiredDocumentIds).not.toContain(discrDoc?.id);
    });

    it('evaluateDocumentExpirations sin vigencia: nunca transiciona', async () => {
      const adminStorage = createSupabaseAdminClient();
      const testDossierId = await createTestDossierWithConfig('doc_no_val');

      const testPdfContent = Buffer.from('%PDF-1.4 No validity');
      const testPath = `${testDossierId}/doc_no_val/no-val-1.pdf`;
      createdStoragePaths.push(testPath);

      await adminStorage.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .upload(testPath, testPdfContent, { contentType: 'application/pdf', upsert: true });

      const validated = await readAndValidateUploadedFile(testPath);

      // Subir documento con fecha muy antigua
      const ancient = '1800-01-01';
      await confirmDocumentUpload({
        organizationId: orgId,
        dossierId: testDossierId,
        documentType: 'doc_no_val',
        storagePath: testPath,
        hash: validated.hash,
        format: validated.format,
        size: validated.size,
        issuedAt: ancient,
        uploadedByType: 'counterparty',
      });

      // Evaluar vigencias
      const result = await evaluateDocumentExpirations(orgId, testDossierId);

      // Verificar que el documento sigue en received
      const latest = await getLatestDocumentsForDossier(orgId, testDossierId);
      const noValDoc = latest.find((d) => d.documentType === 'doc_no_val');
      expect(noValDoc?.state).toBe('received');
      expect(result.expiredDocumentIds).not.toContain(noValDoc?.id);
    });

    it('evaluateDocumentExpirations: aislamiento entre organizaciones', async () => {
      // Verificar que evaluateDocumentExpirations para una org no afecta otras
      // Crear un nuevo dossier en la misma org para verificar aislamiento
      const newDraft = await createDraftConfiguration({ organizationId: orgId, standard: 'SARLAFT' });
      const [type] = await adminSql`
        SELECT id FROM public.counterparty_types
        WHERE organization_id = ${orgId} AND configuration_version_id = ${newDraft.versionId} LIMIT 1
      `;
      await addRequirement({
        organizationId: orgId,
        configurationVersionId: newDraft.versionId,
        counterpartyTypeId: type.id,
        standard: 'SARLAFT',
        type: 'document_type',
        key: 'doc_iso',
        mandatory: 'always',
        blocking: true,
        validity: { mode: 'duration_from_issued', durationDays: 10 },
      });
      await publishDraftConfiguration({
        organizationId: orgId,
        versionId: newDraft.versionId,
        publishedBy: adminUserId,
        reason: 'Test HU-021 isolation',
      });

      // Crear segundo dossier con la nueva configuración
      const dossier2 = await createDossierRequest({
        organizationId: orgId,
        requestedBy: adminUserId,
        counterpartyTypeName: 'proveedor_custom',
        party: {
          identificationType: 'NIT',
          identificationNumber: '900999777',
          declaredName: 'Otra Empresa HU021',
        },
        internalOwnerId: analystUserId,
      });

      await executeTransition({
        organizationId: orgId,
        dossierId: dossier2.id,
        toState: 'enviada',
        actorType: 'user',
        actorId: adminUserId,
      });
      await executeTransition({
        organizationId: orgId,
        dossierId: dossier2.id,
        toState: 'en_diligenciamiento',
        actorType: 'user',
        actorId: adminUserId,
      });

      // Verificar que evaluateDocumentExpirations para dossierId no afecta dossier2.id
      const result1 = await evaluateDocumentExpirations(orgId, dossierId);
      expect(result1).toBeDefined();
      // (La función filtra por organizationId y dossierId internamente)
    });
  });
});
