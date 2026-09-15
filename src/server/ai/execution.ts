import { eq, and, desc } from 'drizzle-orm';
import { db, DrizzleClient } from '../db/client';
import { aiExecutions } from '../db/schema';

export type AiExecutionStatus = 'succeeded' | 'failed';

export interface RecordAiExecutionInput {
  organizationId: string;
  dossierId: string;
  documentId?: string; // condicional: obligatorio si la ejecución partió de un documento
  provider: string;
  model: string;
  modelVersion: string;
  instructionTemplateId: string;
  instructionTemplateVersion: string;
  dataDestination: string; // país/región al que se envió el fragmento
  sentFragmentHash: string; // huella del fragmento enviado, siempre se guarda
  sentFragmentReference?: string; // puntero al fragmento, solo si el contrato lo permite
  status: AiExecutionStatus;
  result?: unknown; // requerido si status === 'succeeded'
  confidence?: string; // requerido si status === 'succeeded'; texto decimal 0..1, como assertions.confidence
  failureReason?: string; // requerido si status === 'failed'
}

export interface AiExecutionDetail extends RecordAiExecutionInput {
  id: string;
  occurredAt: Date;
  validatedBy: string | null;
  validatedAt: Date | null;
  finalResult: unknown;
}

export async function recordAiExecution(
  input: RecordAiExecutionInput,
  txClient?: DrizzleClient,
): Promise<AiExecutionDetail> {
  const client = txClient || db;

  if (!input.organizationId) {
    throw new Error('organizationId is required');
  }
  if (!input.dossierId) {
    throw new Error('dossierId is required');
  }
  if (!input.provider) {
    throw new Error('provider is required');
  }
  if (!input.model) {
    throw new Error('model is required');
  }
  if (!input.modelVersion) {
    throw new Error('modelVersion is required');
  }
  if (!input.instructionTemplateId) {
    throw new Error('instructionTemplateId is required');
  }
  if (!input.instructionTemplateVersion) {
    throw new Error('instructionTemplateVersion is required');
  }
  if (!input.dataDestination) {
    throw new Error('dataDestination is required');
  }
  if (!input.sentFragmentHash) {
    throw new Error('sentFragmentHash is required');
  }

  if (input.status === 'succeeded') {
    if (input.result === undefined || input.result === null) {
      throw new Error("result is required when status is 'succeeded'");
    }
    if (!input.confidence) {
      throw new Error("confidence is required when status is 'succeeded'");
    }
    if (input.failureReason !== undefined && input.failureReason !== null) {
      throw new Error("failureReason must not be provided when status is 'succeeded'");
    }
  } else if (input.status === 'failed') {
    if (!input.failureReason) {
      throw new Error("failureReason is required when status is 'failed'");
    }
    if (input.result !== undefined && input.result !== null) {
      throw new Error("result must not be provided when status is 'failed'");
    }
    if (input.confidence !== undefined && input.confidence !== null) {
      throw new Error("confidence must not be provided when status is 'failed'");
    }
  } else {
    throw new Error(`Invalid status: ${input.status}`);
  }

  const [created] = await client
    .insert(aiExecutions)
    .values({
      organizationId: input.organizationId,
      dossierId: input.dossierId,
      documentId: input.documentId || null,
      provider: input.provider,
      model: input.model,
      modelVersion: input.modelVersion,
      instructionTemplateId: input.instructionTemplateId,
      instructionTemplateVersion: input.instructionTemplateVersion,
      dataDestination: input.dataDestination,
      sentFragmentHash: input.sentFragmentHash,
      sentFragmentReference: input.sentFragmentReference || null,
      status: input.status,
      result: input.result ?? null,
      confidence: input.confidence ?? null,
      failureReason: input.failureReason ?? null,
    })
    .returning();

  return {
    id: created.id,
    organizationId: created.organizationId,
    dossierId: created.dossierId,
    documentId: created.documentId ?? undefined,
    provider: created.provider,
    model: created.model,
    modelVersion: created.modelVersion,
    instructionTemplateId: created.instructionTemplateId,
    instructionTemplateVersion: created.instructionTemplateVersion,
    dataDestination: created.dataDestination,
    sentFragmentHash: created.sentFragmentHash,
    sentFragmentReference: created.sentFragmentReference ?? undefined,
    status: created.status as AiExecutionStatus,
    result: created.result ?? undefined,
    confidence: created.confidence ?? undefined,
    failureReason: created.failureReason ?? undefined,
    occurredAt: created.occurredAt,
    validatedBy: created.validatedBy,
    validatedAt: created.validatedAt,
    finalResult: created.finalResult,
  };
}

export async function getAiExecutionById(
  organizationId: string,
  id: string,
  txClient?: DrizzleClient,
): Promise<AiExecutionDetail | null> {
  const client = txClient || db;

  const [row] = await client
    .select()
    .from(aiExecutions)
    .where(and(eq(aiExecutions.organizationId, organizationId), eq(aiExecutions.id, id)))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organizationId: row.organizationId,
    dossierId: row.dossierId,
    documentId: row.documentId ?? undefined,
    provider: row.provider,
    model: row.model,
    modelVersion: row.modelVersion,
    instructionTemplateId: row.instructionTemplateId,
    instructionTemplateVersion: row.instructionTemplateVersion,
    dataDestination: row.dataDestination,
    sentFragmentHash: row.sentFragmentHash,
    sentFragmentReference: row.sentFragmentReference ?? undefined,
    status: row.status as AiExecutionStatus,
    result: row.result ?? undefined,
    confidence: row.confidence ?? undefined,
    failureReason: row.failureReason ?? undefined,
    occurredAt: row.occurredAt,
    validatedBy: row.validatedBy,
    validatedAt: row.validatedAt,
    finalResult: row.finalResult,
  };
}

export async function getAiExecutionsByDossier(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<AiExecutionDetail[]> {
  const client = txClient || db;

  const rows = await client
    .select()
    .from(aiExecutions)
    .where(and(eq(aiExecutions.organizationId, organizationId), eq(aiExecutions.dossierId, dossierId)))
    .orderBy(desc(aiExecutions.occurredAt));

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    dossierId: row.dossierId,
    documentId: row.documentId ?? undefined,
    provider: row.provider,
    model: row.model,
    modelVersion: row.modelVersion,
    instructionTemplateId: row.instructionTemplateId,
    instructionTemplateVersion: row.instructionTemplateVersion,
    dataDestination: row.dataDestination,
    sentFragmentHash: row.sentFragmentHash,
    sentFragmentReference: row.sentFragmentReference ?? undefined,
    status: row.status as AiExecutionStatus,
    result: row.result ?? undefined,
    confidence: row.confidence ?? undefined,
    failureReason: row.failureReason ?? undefined,
    occurredAt: row.occurredAt,
    validatedBy: row.validatedBy,
    validatedAt: row.validatedAt,
    finalResult: row.finalResult,
  }));
}

export interface MarkAiExecutionValidatedInput {
  organizationId: string;
  aiExecutionId: string;
  validatedBy: string;
  finalResult: unknown; // { field, value, result: 'confirmed'|'discarded'|'corrected' }
}

/**
 * Marks an AI execution as human-validated with final result.
 * Called after validateExtractedAssertion or correctExtractedAssertion.
 * (HU-020)
 */
export async function markAiExecutionValidated(
  input: MarkAiExecutionValidatedInput,
  txClient?: DrizzleClient,
): Promise<void> {
  const client = txClient || db;

  await client
    .update(aiExecutions)
    .set({
      validatedBy: input.validatedBy,
      validatedAt: new Date(),
      finalResult: input.finalResult,
    })
    .where(and(eq(aiExecutions.id, input.aiExecutionId), eq(aiExecutions.organizationId, input.organizationId)));
}
