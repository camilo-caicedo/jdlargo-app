import { eq, and } from 'drizzle-orm';
import { db, DrizzleClient, DatabaseTransaction } from '../db/client';
import { dossiers } from '../db/schema';
import { getDossierPendingRequirements } from './dossier';
import { getLatestDeclaredValuesForDossier } from '../assertions/service';
import { getLatestDocumentsForDossier } from '../documents/document';
import { executeTransition } from './state-machine';
import { isRequirementCurrentlyRequired } from '@/lib/requirement-evaluation';
import { enforceUserPermission } from '../auth/access-control';
import { logAuditEvent } from '../audit/service';
import { getOpenDiscrepancies } from '../reconciliation/service';
import { getDossierSignatureStatus } from '../signature/service';

export class IncompleteReviewError extends Error {
  constructor(
    public missingFields: string[],
    public missingOrInvalidDocumentTypes: string[],
    public openDiscrepancyFields: string[] = [],
  ) {
    const parts: string[] = [];
    if (missingFields.length > 0) {
      parts.push(`campos obligatorios pendientes: ${missingFields.join(', ')}`);
    }
    if (missingOrInvalidDocumentTypes.length > 0) {
      parts.push(`documentos obligatorios pendientes o no válidos: ${missingOrInvalidDocumentTypes.join(', ')}`);
    }
    if (openDiscrepancyFields.length > 0) {
      parts.push(`discrepancias abiertas pendientes de resolver: ${openDiscrepancyFields.join(', ')}`);
    }
    super(`No se puede dar por revisado el expediente: ${parts.join('; ')}`);
    this.name = 'IncompleteReviewError';
  }
}

/**
 * Ensures entry transition from 'documentos_recibidos' to 'en_revision' when opened by staff.
 * Idempotent: if dossier is in any other state, does nothing.
 * Guard: only promotes if an active signature exists covering current content (HU-022).
 * (HU-014 §2.1, §2.5)
 */
export async function ensureReviewEntryTransition(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<void> {
  const client = txClient || db;

  const [dossier] = await client
    .select({
      id: dossiers.id,
      state: dossiers.state,
    })
    .from(dossiers)
    .where(
      and(
        eq(dossiers.organizationId, organizationId),
        eq(dossiers.id, dossierId),
      ),
    )
    .limit(1);

  if (!dossier || dossier.state !== 'documentos_recibidos') {
    return;
  }

  // Guard: only promote if active signature exists (HU-022)
  const signatureStatus = await getDossierSignatureStatus(organizationId, dossierId, client);
  if (!signatureStatus.activeSignature) {
    return; // pending signature, don't promote yet
  }

  await executeTransition(
    {
      organizationId,
      dossierId,
      toState: 'en_revision',
      actorType: 'system',
    },
    txClient,
  );
}

export interface ReviewSummary {
  missingFields: string[];
  missingOrInvalidDocumentTypes: string[];
  blockingMissingKeys: string[];
  openDiscrepancyFields: string[];
  canOverride: boolean;
  isReadyForDecision: boolean;
}

/**
 * Evaluates current requirements completeness and document validity for a dossier.
 */
export async function getReviewSummary(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<ReviewSummary> {
  const client = txClient || db;

  const allRequirements = await getDossierPendingRequirements(organizationId, dossierId, client);
  const fieldRequirements = allRequirements.filter((r) => r.type === 'field');
  const documentRequirements = allRequirements.filter((r) => r.type === 'document_type');

  const latestValues = await getLatestDeclaredValuesForDossier(organizationId, dossierId, client);
  const values: Record<string, unknown> = {};
  for (const item of latestValues) {
    values[item.field] = item.value;
  }

  // 1. Mandatory field requirements
  const missingFields: string[] = [];
  const blockingMissingKeys: string[] = [];

  for (const req of fieldRequirements) {
    const isRequired = isRequirementCurrentlyRequired(req, values);
    if (isRequired) {
      const val = values[req.key];
      if (val === undefined || val === null || val === '') {
        missingFields.push(req.key);
        if (req.blocking) {
          blockingMissingKeys.push(req.key);
        }
      }
    }
  }

  // 2. Mandatory document requirements: must have a document with state === 'valid'
  const latestDocs = await getLatestDocumentsForDossier(organizationId, dossierId, client);
  const validDocTypes = new Set(
    latestDocs.filter((d) => d.state === 'valid').map((d) => d.documentType),
  );

  const missingOrInvalidDocumentTypes: string[] = [];
  for (const req of documentRequirements) {
    const isRequired = isRequirementCurrentlyRequired(req, values);
    if (isRequired && !validDocTypes.has(req.key)) {
      missingOrInvalidDocumentTypes.push(req.key);
      if (req.blocking) {
        blockingMissingKeys.push(req.key);
      }
    }
  }

  // 3. Open discrepancies on currently required fields (HU-019)
  const openDiscrepancies = await getOpenDiscrepancies(organizationId, dossierId, client);
  const openDiscrepancyFields = openDiscrepancies
    .filter((d) => d.isBlocking)
    .map((d) => d.field);

  const isReadyForDecision =
    missingFields.length === 0 &&
    missingOrInvalidDocumentTypes.length === 0 &&
    openDiscrepancyFields.length === 0;

  // An override is possible ONLY if there are no blocking missing requirements AND no open blocking discrepancies
  const canOverride =
    !isReadyForDecision &&
    blockingMissingKeys.length === 0 &&
    openDiscrepancyFields.length === 0;

  return {
    missingFields,
    missingOrInvalidDocumentTypes,
    blockingMissingKeys,
    openDiscrepancyFields,
    canOverride,
    isReadyForDecision,
  };
}

/**
 * Completes review and transitions dossier to 'pendiente_de_decision'.
 * Supports override exception path if all missing requirements are non-blocking and actor has dossier:approve.
 * (HU-014 / PA-029 / HU-019)
 */
export async function completeReview(
  input: {
    organizationId: string;
    dossierId: string;
    reviewedBy: string;
    override?: { reason: string };
  },
  txClient?: DrizzleClient,
): Promise<void> {
  const client = txClient || db;

  const [dossier] = await client
    .select({
      id: dossiers.id,
      state: dossiers.state,
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

  if (dossier.state !== 'en_revision') {
    throw new Error(
      `Solo se puede dar por revisado un expediente en estado 'en_revision' (actual: '${dossier.state}')`,
    );
  }

  const summary = await getReviewSummary(input.organizationId, input.dossierId, client);

  if (summary.isReadyForDecision) {
    // Standard path: all requirements met and no open discrepancies
    await executeTransition(
      {
        organizationId: input.organizationId,
        dossierId: input.dossierId,
        toState: 'pendiente_de_decision',
        actorType: 'user',
        actorId: input.reviewedBy,
      },
      txClient,
    );
    return;
  }

  // Blocking check: Open discrepancies on currently required fields NEVER allow override exception (HU-019 §2)
  if (summary.openDiscrepancyFields.length > 0) {
    throw new IncompleteReviewError(
      summary.missingFields,
      summary.missingOrInvalidDocumentTypes,
      summary.openDiscrepancyFields,
    );
  }

  // Not ready for decision
  if (!input.override) {
    throw new IncompleteReviewError(
      summary.missingFields,
      summary.missingOrInvalidDocumentTypes,
      summary.openDiscrepancyFields,
    );
  }

  // Override attempted:
  // a. Cannot override blocking requirements
  if (summary.blockingMissingKeys.length > 0) {
    throw new IncompleteReviewError(
      summary.missingFields,
      summary.missingOrInvalidDocumentTypes,
      summary.openDiscrepancyFields,
    );
  }

  // b. Override reason must be non-empty
  if (!input.override.reason || input.override.reason.trim() === '') {
    throw new Error('La excepción exige un motivo explícito no vacío');
  }

  // c. Enforce permission 'dossier:approve' for override
  await enforceUserPermission(
    {
      userId: input.reviewedBy,
      organizationId: input.organizationId,
    },
    'dossier:approve',
    {
      dossierId: input.dossierId,
      reason: input.override.reason.trim(),
    },
    txClient,
  );

  // d. Transition to 'pendiente_de_decision' + e. log the exception audit event, atomically:
  // both must land together, or neither — an approved-with-pending dossier with no audit
  // trail of why would defeat PA-029's "advertencia explícita ... queda registrada".
  const skippedRequirementKeys = [
    ...summary.missingFields,
    ...summary.missingOrInvalidDocumentTypes,
  ];

  const applyOverride = async (tx: DatabaseTransaction) => {
    await executeTransition(
      {
        organizationId: input.organizationId,
        dossierId: input.dossierId,
        toState: 'pendiente_de_decision',
        actorType: 'user',
        actorId: input.reviewedBy,
      },
      tx,
    );

    await logAuditEvent(
      {
        organizationId: input.organizationId,
        actorType: 'user',
        actorUserId: input.reviewedBy,
        action: 'dossier.review_completed_with_exception',
        entity: 'dossier',
        entityId: input.dossierId,
        configurationVersionId: dossier.configurationVersionId,
        reason: input.override!.reason.trim(),
        metadata: {
          overridden_by: input.reviewedBy,
          reason: input.override!.reason.trim(),
          skipped_requirement_keys: skippedRequirementKeys,
        },
        origin: { actor: 'user', action: 'completeReview' },
      },
      tx,
    );
  };

  if (txClient && 'execute' in txClient) {
    await applyOverride(txClient as DatabaseTransaction);
  } else {
    await db.transaction(applyOverride);
  }
}

/**
 * Requests corrections from the counterparty, returning the dossier to 'en_diligenciamiento'.
 * Reason is strictly mandatory.
 * (HU-014 Escenario: Solicitar corrección devuelve el expediente a la contraparte)
 */
export async function requestCorrections(
  input: { organizationId: string; dossierId: string; requestedBy: string; reason: string },
  txClient?: DrizzleClient,
): Promise<void> {
  const client = txClient || db;

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

  if (dossier.state !== 'en_revision') {
    throw new Error(
      `Solo se pueden solicitar correcciones para un expediente en estado 'en_revision' (actual: '${dossier.state}')`,
    );
  }

  if (!input.reason || input.reason.trim() === '') {
    throw new Error('La solicitud de corrección exige un motivo explícito no vacío');
  }

  // Transition to 'en_diligenciamiento' (permission dossier:review, reason mandatory)
  await executeTransition(
    {
      organizationId: input.organizationId,
      dossierId: input.dossierId,
      toState: 'en_diligenciamiento',
      actorType: 'user',
      actorId: input.requestedBy,
      reason: input.reason.trim(),
    },
    txClient,
  );
}
