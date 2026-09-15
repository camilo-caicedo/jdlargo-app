import { randomUUID, createHash } from 'crypto';
import { eq, and, desc } from 'drizzle-orm';
import { db, DrizzleClient, DatabaseTransaction } from '../db/client';
import { documents, dossiers } from '../db/schema';
import { getDossierPendingRequirements } from '../dossiers/dossier';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  MAX_UPLOAD_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
  DOSSIER_DOCUMENTS_BUCKET,
} from '@/lib/document-upload-constants';
import { registerAssertion, getActiveAssertionsForDossier } from '../assertions/service';
import { logAuditEvent } from '../audit/service';
import { getOpenDiscrepancies } from '../reconciliation/service';
import { enforceUserPermission } from '../auth/access-control';
import { scanBuffer } from '@/lib/antivirus';
import { computeEffectiveExpiry } from '@/lib/document-validity';
import { invalidateActiveSignatureIfContentChanged } from '../signature/service';

export interface RequestDocumentUploadInput {
  organizationId: string;
  dossierId: string;
  documentType: string;
  fileName: string;
  declaredSize: number;
  declaredMimeType: string;
}

export interface RequestDocumentUploadResult {
  signedUrl: string;
  uploadToken: string;
  storagePath: string;
}

/**
 * Validates request conditions and generates a signed upload URL to Supabase Storage.
 */
export async function requestDocumentUpload(
  input: RequestDocumentUploadInput,
  txClient?: DrizzleClient,
): Promise<RequestDocumentUploadResult> {
  const client = txClient || db;

  // 1. Carga expediente; state !== 'en_diligenciamiento' -> rechaza
  const [dossier] = await client
    .select({
      id: dossiers.id,
      state: dossiers.state,
    })
    .from(dossiers)
    .where(
      and(
        eq(dossiers.organizationId, input.organizationId),
        eq(dossiers.id, input.dossierId),
      ),
    )
    .limit(1);

  if (!dossier) {
    throw new Error('Expediente no encontrado');
  }

  if (dossier.state !== 'en_diligenciamiento') {
    throw new Error(
      `No se puede solicitar subida de documentos para un expediente en estado '${dossier.state}'`,
    );
  }

  // 2. documentType debe existir en getDossierPendingRequirements filtrado type: 'document_type'
  const pendingReqs = await getDossierPendingRequirements(
    input.organizationId,
    input.dossierId,
    client,
  );
  const docReq = pendingReqs.find(
    (r) => r.type === 'document_type' && r.key === input.documentType,
  );
  if (!docReq) {
    throw new Error(
      `El tipo documental '${input.documentType}' no existe en la matriz de requisitos del expediente`,
    );
  }

  // 3. Pre-validación barata de tamaño y MIME type declarado
  if (input.declaredSize > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error(
      `El archivo excede el tamaño máximo permitido de ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)} MB`,
    );
  }

  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(input.declaredMimeType)) {
    throw new Error(
      `El formato '${input.declaredMimeType}' no está permitido. Formatos aceptados: PDF, JPG, PNG`,
    );
  }

  // 4. storagePath = `${dossierId}/${documentType}/${randomUUID()}`
  const storagePath = `${input.dossierId}/${input.documentType}/${randomUUID()}`;

  // 5. Generar signed upload URL con Supabase admin
  const adminStorage = createSupabaseAdminClient();
  const { data, error } = await adminStorage.storage
    .from(DOSSIER_DOCUMENTS_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    throw new Error(
      `Error al generar URL firmada de subida: ${error?.message || 'Respuesta vacía'}`,
    );
  }

  return {
    signedUrl: data.signedUrl,
    uploadToken: data.token,
    storagePath,
  };
}

export interface ValidatedFile {
  hash: string;
  format: 'pdf' | 'jpg' | 'png';
  size: number;
}

/**
 * Inspects binary magic bytes to determine actual file format.
 */
export function detectFormatFromMagicBytes(buffer: Buffer): 'pdf' | 'jpg' | 'png' | null {
  // PDF starts with %PDF- (0x25 0x50 0x44 0x46)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return 'pdf';
  }

  // JPEG starts with 0xFF 0xD8 0xFF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'jpg';
  }

  // PNG starts with 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  return null;
}

/**
 * Downloads the uploaded object from storage, calculates real SHA-256 and detects true format.
 * If invalid, over size or infected by malware, deletes the file from storage and throws error.
 * Runs outside of DB transactions.
 */
export async function readAndValidateUploadedFile(
  storagePath: string,
  organizationId?: string,
): Promise<ValidatedFile> {
  const adminStorage = createSupabaseAdminClient();
  const { data, error } = await adminStorage.storage
    .from(DOSSIER_DOCUMENTS_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`No se pudo descargar el archivo subido de storage: ${error?.message || 'Archivo no encontrado'}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const size = buffer.length;

  const format = detectFormatFromMagicBytes(buffer);

  if (!format) {
    // Delete invalid object from storage
    await adminStorage.storage.from(DOSSIER_DOCUMENTS_BUCKET).remove([storagePath]);
    throw new Error('El archivo no corresponde a un formato válido (PDF, JPG, PNG). Verificación binaria fallida.');
  }

  if (size > MAX_UPLOAD_SIZE_BYTES) {
    await adminStorage.storage.from(DOSSIER_DOCUMENTS_BUCKET).remove([storagePath]);
    throw new Error(`El archivo excede el tamaño máximo permitido de ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)} MB`);
  }

  const scan = await scanBuffer(buffer);
  if (scan.infected) {
    await adminStorage.storage.from(DOSSIER_DOCUMENTS_BUCKET).remove([storagePath]);
    if (organizationId) {
      await logAuditEvent({
        organizationId,
        action: 'document.upload_rejected_malware',
        actorType: 'system',
        entity: 'document',
        metadata: { storagePath, viruses: scan.viruses },
      });
    }
    throw new Error('El archivo no pasó el escaneo antivirus y fue rechazado.');
  }

  const hash = createHash('sha256').update(buffer).digest('hex');

  return {
    hash,
    format,
    size,
  };
}

export interface ConfirmDocumentUploadInput {
  organizationId: string;
  dossierId: string;
  documentType: string;
  storagePath: string;
  hash: string;
  format: 'pdf' | 'jpg' | 'png';
  size: number;
  declaredIssuer?: string;
  issuedAt?: string;
  expiresAt?: string;
  uploadedByType: 'user' | 'counterparty';
  uploadedByUserId?: string;
}

export interface ConfirmDocumentUploadResult {
  id: string;
  version: number;
  deduplicated: boolean;
}

/**
 * Confirms document upload within a transaction:
 * - Revalidates requirement in frozen matrix (defense in depth)
 * - Checks deduplication (RNF-025)
 * - Calculates version (MAX + 1)
 * - Registers declared assertions for metadata if provided
 * - Logs audit event
 */
export async function confirmDocumentUpload(
  input: ConfirmDocumentUploadInput,
  txClient?: DrizzleClient,
): Promise<ConfirmDocumentUploadResult> {
  const execute = async (tx: DatabaseTransaction) => {
    // 1. Carga expediente + valida documentType en la matriz
    const [dossier] = await tx
      .select({
        id: dossiers.id,
        state: dossiers.state,
        partyId: dossiers.partyId,
        configurationVersionId: dossiers.configurationVersionId,
      })
      .from(dossiers)
      .where(
        and(
          eq(dossiers.organizationId, input.organizationId),
          eq(dossiers.id, input.dossierId),
        ),
      )
      .limit(1);

    if (!dossier) {
      throw new Error('Expediente no encontrado');
    }

    if (!dossier.partyId) {
      throw new Error('El expediente no tiene sujeto contraparte (partyId) asociado');
    }

    if (dossier.state !== 'en_diligenciamiento') {
      throw new Error(
        `No se puede confirmar documentos en un expediente en estado '${dossier.state}'`,
      );
    }

    const pendingReqs = await getDossierPendingRequirements(
      input.organizationId,
      input.dossierId,
      tx,
    );
    const docReq = pendingReqs.find(
      (r) => r.type === 'document_type' && r.key === input.documentType,
    );
    if (!docReq) {
      throw new Error(
        `El tipo documental '${input.documentType}' no pertenece a los requisitos exigidos para este expediente`,
      );
    }

    // 2. Busca fila existente con (dossierId, documentType, hash) -> deduplicación (RNF-025)
    const [existing] = await tx
      .select({
        id: documents.id,
        version: documents.version,
      })
      .from(documents)
      .where(
        and(
          eq(documents.dossierId, input.dossierId),
          eq(documents.documentType, input.documentType),
          eq(documents.hash, input.hash),
        ),
      )
      .limit(1);

    if (existing) {
      return {
        id: existing.id,
        version: existing.version,
        deduplicated: true,
      };
    }

    // 3. Obtener versión máxima existente para dossierId + documentType
    const existingVersions = await tx
      .select({ version: documents.version })
      .from(documents)
      .where(
        and(
          eq(documents.dossierId, input.dossierId),
          eq(documents.documentType, input.documentType),
        ),
      )
      .orderBy(desc(documents.version))
      .limit(1);

    const nextVersion = existingVersions.length > 0 ? existingVersions[0].version + 1 : 1;

    // 4. Validar vigencia: si el documento está vencido al momento de subir, rechazarlo
    let initialState: 'received' | 'requires_review' = 'received';
    let initialRejectionReason: string | null = null;

    if (docReq.validity && docReq.validity.mode !== 'no_expiration') {
      const computedExpiry = computeEffectiveExpiry(
        docReq.validity,
        input.issuedAt ?? null,
        input.expiresAt ?? null,
      );
      if (computedExpiry && computedExpiry < new Date()) {
        initialState = 'requires_review';
        initialRejectionReason = `El documento ya está vencido (vigencia expiró el ${computedExpiry.toISOString().split('T')[0]})`;
      }
    }

    // 5. INSERT en documents
    const [createdDoc] = await tx
      .insert(documents)
      .values({
        organizationId: input.organizationId,
        dossierId: input.dossierId,
        documentType: input.documentType,
        version: nextVersion,
        storagePath: input.storagePath,
        hash: input.hash,
        size: input.size,
        format: input.format,
        state: initialState,
        uploadedByType: input.uploadedByType,
        uploadedByUserId: input.uploadedByUserId,
        rejectionReason: initialRejectionReason,
      })
      .returning({ id: documents.id, version: documents.version });

    // 6. Metadatos declarados -> registerAssertion
    if (input.declaredIssuer) {
      await registerAssertion(
        {
          organizationId: input.organizationId,
          dossierId: input.dossierId,
          partyId: dossier.partyId,
          configurationVersionId: dossier.configurationVersionId,
          field: `document:${input.documentType}:issuer`,
          value: input.declaredIssuer,
          origin: 'declared',
          producedBy: input.uploadedByUserId,
          evidenceId: createdDoc.id,
        },
        tx,
      );
    }

    if (input.issuedAt) {
      await registerAssertion(
        {
          organizationId: input.organizationId,
          dossierId: input.dossierId,
          partyId: dossier.partyId,
          configurationVersionId: dossier.configurationVersionId,
          field: `document:${input.documentType}:issued_at`,
          value: input.issuedAt,
          origin: 'declared',
          producedBy: input.uploadedByUserId,
          evidenceId: createdDoc.id,
        },
        tx,
      );
    }

    if (input.expiresAt) {
      await registerAssertion(
        {
          organizationId: input.organizationId,
          dossierId: input.dossierId,
          partyId: dossier.partyId,
          configurationVersionId: dossier.configurationVersionId,
          field: `document:${input.documentType}:expires_at`,
          value: input.expiresAt,
          origin: 'declared',
          producedBy: input.uploadedByUserId,
          evidenceId: createdDoc.id,
        },
        tx,
      );
    }

    // 7. logAuditEvent
    await logAuditEvent(
      {
        organizationId: input.organizationId,
        action: 'document.uploaded',
        actorType: input.uploadedByType,
        actorUserId: input.uploadedByUserId,
        entity: 'document',
        entityId: createdDoc.id,
        metadata: {
          dossierId: input.dossierId,
          documentType: input.documentType,
          version: nextVersion,
          hash: input.hash,
          size: input.size,
          format: input.format,
        },
      },
      tx,
    );

    // 8. Invalidate active signature if content changed (HU-022)
    await invalidateActiveSignatureIfContentChanged(input.organizationId, input.dossierId, tx);

    return {
      id: createdDoc.id,
      version: createdDoc.version,
      deduplicated: false,
    };
  };

  if (txClient && 'execute' in txClient) {
    return execute(txClient as DatabaseTransaction);
  }
  return db.transaction(execute);
}

export interface EvaluateDocumentExpirationsResult {
  expiredDocumentIds: string[];
}

export async function evaluateDocumentExpirations(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<EvaluateDocumentExpirationsResult> {
  const client = txClient || db;

  const [latestDocs, requirements, activeAssertions, openDiscrepancies] = await Promise.all([
    getLatestDocumentsForDossier(organizationId, dossierId, client),
    getDossierPendingRequirements(organizationId, dossierId, client),
    getActiveAssertionsForDossier(organizationId, dossierId, client),
    getOpenDiscrepancies(organizationId, dossierId, client),
  ]);

  const validityByDocType = new Map(
    requirements
      .filter((r): r is typeof r & { validity: NonNullable<typeof r.validity> } => r.type === 'document_type' && r.validity !== null)
      .map((r) => [r.key, r.validity]),
  );
  const discrepancyFields = new Set(openDiscrepancies.map((d) => d.field));
  const expiredDocumentIds: string[] = [];
  const now = new Date();

  for (const doc of latestDocs) {
    if (!['received', 'under_review', 'valid'].includes(doc.state)) continue;

    const validity = validityByDocType.get(doc.documentType);
    if (!validity || validity.mode === 'no_expiration') continue;

    const issuedField = `document:${doc.documentType}:issued_at`;
    const expiresField = `document:${doc.documentType}:expires_at`;
    if (discrepancyFields.has(issuedField) || discrepancyFields.has(expiresField)) continue; // vigencia pendiente

    const issuedVal = activeAssertions.find((a) => a.field === issuedField)?.value as string | undefined;
    const expiresVal = activeAssertions.find((a) => a.field === expiresField)?.value as string | undefined;
    const effectiveExpiry = computeEffectiveExpiry(validity, issuedVal ?? null, expiresVal ?? null);

    if (effectiveExpiry && effectiveExpiry < now) {
      await client.update(documents).set({ state: 'expired' }).where(eq(documents.id, doc.id));
      await logAuditEvent(
        {
          organizationId,
          actorType: 'system',
          action: 'document.expired',
          entity: 'document',
          entityId: doc.id,
          metadata: { documentType: doc.documentType, expiresAt: effectiveExpiry.toISOString() },
        },
        client,
      );
      expiredDocumentIds.push(doc.id);
    }
  }

  return { expiredDocumentIds };
}

export interface DocumentSummary {
  id: string;
  organizationId: string;
  dossierId: string;
  documentType: string;
  version: number;
  storagePath: string;
  hash: string;
  size: number;
  format: string;
  state: string;
  uploadedByType: string;
  uploadedByUserId: string | null;
  rejectionReason: string | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

/**
 * Returns latest version of each documentType for a given dossier.
 */
export async function getLatestDocumentsForDossier(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<DocumentSummary[]> {
  const client = txClient || db;

  const allDocs = await client
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.dossierId, dossierId),
      ),
    )
    .orderBy(desc(documents.version));

  const map = new Map<string, DocumentSummary>();
  for (const doc of allDocs) {
    if (!map.has(doc.documentType)) {
      map.set(doc.documentType, {
        id: doc.id,
        organizationId: doc.organizationId,
        dossierId: doc.dossierId,
        documentType: doc.documentType,
        version: doc.version,
        storagePath: doc.storagePath,
        hash: doc.hash,
        size: doc.size,
        format: doc.format,
        state: doc.state,
        uploadedByType: doc.uploadedByType,
        uploadedByUserId: doc.uploadedByUserId,
        rejectionReason: doc.rejectionReason,
        reviewedByUserId: doc.reviewedByUserId,
        reviewedAt: doc.reviewedAt,
        createdAt: doc.createdAt,
      });
    }
  }

  return Array.from(map.values());
}

/**
 * Verifies document integrity by downloading it from storage and comparing its current hash
 * with the registered hash. If tampered, marks state as 'requires_review' and audits the event.
 */
export async function verifyDocumentIntegrity(
  organizationId: string,
  documentId: string,
  txClient?: DrizzleClient,
): Promise<{ matches: boolean; registeredHash: string; currentHash: string }> {
  const client = txClient || db;

  const [doc] = await client
    .select()
    .from(documents)
    .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)))
    .limit(1);

  if (!doc) {
    throw new Error('Documento no encontrado');
  }

  const adminStorage = createSupabaseAdminClient();
  const { data, error } = await adminStorage.storage
    .from(DOSSIER_DOCUMENTS_BUCKET)
    .download(doc.storagePath);

  if (error || !data) {
    throw new Error(`Error descargando documento para verificación de integridad: ${error?.message || 'Archivo no encontrado'}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  const currentHash = createHash('sha256').update(Buffer.from(arrayBuffer)).digest('hex');
  const matches = currentHash === doc.hash;

  if (!matches) {
    await client
      .update(documents)
      .set({ state: 'requires_review' })
      .where(and(eq(documents.organizationId, organizationId), eq(documents.id, documentId)));

    await logAuditEvent(
      {
        organizationId,
        action: 'document.integrity_failed',
        actorType: 'system',
        entity: 'document',
        entityId: documentId,
        metadata: {
          dossierId: doc.dossierId,
          documentType: doc.documentType,
          registeredHash: doc.hash,
          currentHash,
        },
      },
      client,
    );
  }

  return {
    matches,
    registeredHash: doc.hash,
    currentHash,
  };
}

/**
 * Generates a short-lived download URL for staff with document:view permission.
 */
export async function getDocumentDownloadUrl(input: {
  organizationId: string;
  dossierId: string;
  documentId: string;
  requestedBy: { userId: string };
}): Promise<{ url: string; integrityMatches: boolean }> {
  // 1. enforceUserPermission
  await enforceUserPermission(
    {
      userId: input.requestedBy.userId,
      organizationId: input.organizationId,
    },
    'document:view',
  );

  // 2. Validate document belongs to org & dossier
  const [doc] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, input.organizationId),
        eq(documents.dossierId, input.dossierId),
        eq(documents.id, input.documentId),
      ),
    )
    .limit(1);

  if (!doc) {
    throw new Error('Documento no encontrado en el expediente especificado');
  }

  // 3. Verify document integrity before generating signed URL (HU-016)
  const integrity = await verifyDocumentIntegrity(input.organizationId, input.documentId);

  // 4. Create short-lived signed URL (60s)
  const adminStorage = createSupabaseAdminClient();
  const { data, error } = await adminStorage.storage
    .from(DOSSIER_DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storagePath, 60);

  if (error || !data) {
    throw new Error(`Error al generar URL de descarga: ${error?.message || 'Error desconocido'}`);
  }

  // 5. logAuditEvent
  await logAuditEvent({
    organizationId: input.organizationId,
    action: 'document.downloaded',
    actorType: 'user',
    actorUserId: input.requestedBy.userId,
    entity: 'document',
    entityId: input.documentId,
    metadata: {
      dossierId: input.dossierId,
      documentType: doc.documentType,
      version: doc.version,
      integrity_matches: integrity.matches,
    },
  });

  return {
    url: data.signedUrl,
    integrityMatches: integrity.matches,
  };
}

/**
 * Generates a short-lived download URL for portal counterparty (after token verification).
 */
export async function getPortalDocumentDownloadUrl(input: {
  organizationId: string;
  dossierId: string;
  documentId: string;
}): Promise<string> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, input.organizationId),
        eq(documents.dossierId, input.dossierId),
        eq(documents.id, input.documentId),
      ),
    )
    .limit(1);

  if (!doc) {
    throw new Error('Documento no encontrado en el expediente especificado');
  }

  const adminStorage = createSupabaseAdminClient();
  const { data, error } = await adminStorage.storage
    .from(DOSSIER_DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storagePath, 60);

  if (error || !data) {
    throw new Error(`Error al generar URL de descarga: ${error?.message || 'Error desconocido'}`);
  }

  await logAuditEvent({
    organizationId: input.organizationId,
    action: 'document.downloaded',
    actorType: 'counterparty',
    entity: 'document',
    entityId: input.documentId,
    metadata: {
      dossierId: input.dossierId,
      documentType: doc.documentType,
      version: doc.version,
    },
  });

  return data.signedUrl;
}

/**
 * Marks a document as 'valid' by an authorized reviewer (document:review).
 * (HU-014 Escenario: Marcar un documento como válido)
 */
export async function markDocumentValid(
  input: { organizationId: string; dossierId: string; documentId: string; reviewedBy: string },
  txClient?: DrizzleClient,
): Promise<void> {
  // 1. Enforce permission 'document:review'
  await enforceUserPermission(
    {
      userId: input.reviewedBy,
      organizationId: input.organizationId,
    },
    'document:review',
    { dossierId: input.dossierId, documentId: input.documentId },
    txClient,
  );

  const execute = async (tx: DatabaseTransaction) => {
    // 2. Verify document belongs to dossier and organization
    const [doc] = await tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, input.organizationId),
          eq(documents.dossierId, input.dossierId),
          eq(documents.id, input.documentId),
        ),
      )
      .limit(1);

    if (!doc) {
      throw new Error('Documento no encontrado en el expediente especificado');
    }

    const reviewedAt = new Date();

    // 3. Update state, reviewedByUserId, reviewedAt
    await tx
      .update(documents)
      .set({
        state: 'valid',
        reviewedByUserId: input.reviewedBy,
        reviewedAt,
      })
      .where(eq(documents.id, input.documentId));

    // 4. Register audit event
    await logAuditEvent(
      {
        organizationId: input.organizationId,
        actorType: 'user',
        actorUserId: input.reviewedBy,
        action: 'document.marked_valid',
        entity: 'document',
        entityId: input.documentId,
        metadata: {
          dossierId: input.dossierId,
          documentType: doc.documentType,
          version: doc.version,
          previousState: doc.state,
        },
      },
      tx,
    );
  };

  if (txClient && 'execute' in txClient) {
    await execute(txClient as DatabaseTransaction);
  } else {
    await db.transaction(execute);
  }
}

/**
 * Rejects a document with a mandatory reason by an authorized reviewer (document:review).
 * (HU-014 Escenario: Rechazar un documento sin perder lo demás)
 */
export async function rejectDocument(
  input: {
    organizationId: string;
    dossierId: string;
    documentId: string;
    reviewedBy: string;
    reason: string;
  },
  txClient?: DrizzleClient,
): Promise<void> {
  // Business rule: reason must be non-empty
  if (!input.reason || input.reason.trim() === '') {
    throw new Error('El rechazo de un documento exige un motivo explícito no vacío');
  }

  // 1. Enforce permission 'document:review'
  await enforceUserPermission(
    {
      userId: input.reviewedBy,
      organizationId: input.organizationId,
    },
    'document:review',
    { dossierId: input.dossierId, documentId: input.documentId, reason: input.reason },
    txClient,
  );

  const execute = async (tx: DatabaseTransaction) => {
    // 2. Verify document belongs to dossier and organization
    const [doc] = await tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, input.organizationId),
          eq(documents.dossierId, input.dossierId),
          eq(documents.id, input.documentId),
        ),
      )
      .limit(1);

    if (!doc) {
      throw new Error('Documento no encontrado en el expediente especificado');
    }

    const reviewedAt = new Date();

    // 3. Update state, rejectionReason, reviewedByUserId, reviewedAt
    await tx
      .update(documents)
      .set({
        state: 'rejected',
        rejectionReason: input.reason.trim(),
        reviewedByUserId: input.reviewedBy,
        reviewedAt,
      })
      .where(eq(documents.id, input.documentId));

    // 4. Register audit event
    await logAuditEvent(
      {
        organizationId: input.organizationId,
        actorType: 'user',
        actorUserId: input.reviewedBy,
        action: 'document.rejected',
        entity: 'document',
        entityId: input.documentId,
        metadata: {
          dossierId: input.dossierId,
          documentType: doc.documentType,
          version: doc.version,
          previousState: doc.state,
          rejectionReason: input.reason.trim(),
        },
      },
      tx,
    );
  };

  if (txClient && 'execute' in txClient) {
    await execute(txClient as DatabaseTransaction);
  } else {
    await db.transaction(execute);
  }
}

/**
 * Marks a document as 'requires_review' with a reason by the system.
 * (HU-017 Escenario: Documento ilegible o fallido en extracción)
 */
export async function markDocumentRequiresReview(
  input: {
    organizationId: string;
    dossierId: string;
    documentId: string;
    reason: string;
  },
  txClient?: DrizzleClient,
): Promise<void> {
  const execute = async (tx: DatabaseTransaction) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, input.organizationId),
          eq(documents.dossierId, input.dossierId),
          eq(documents.id, input.documentId),
        ),
      )
      .limit(1);

    if (!doc) {
      throw new Error('Documento no encontrado en el expediente especificado');
    }

    await tx
      .update(documents)
      .set({
        state: 'requires_review',
        rejectionReason: input.reason,
      })
      .where(eq(documents.id, input.documentId));

    await logAuditEvent(
      {
        organizationId: input.organizationId,
        actorType: 'system',
        action: 'document.marked_requires_review',
        entity: 'document',
        entityId: input.documentId,
        metadata: {
          dossierId: input.dossierId,
          documentType: doc.documentType,
          version: doc.version,
          previousState: doc.state,
          reason: input.reason,
        },
      },
      tx,
    );
  };

  if (txClient && 'execute' in txClient) {
    await execute(txClient as DatabaseTransaction);
  } else {
    await db.transaction(execute);
  }
}

