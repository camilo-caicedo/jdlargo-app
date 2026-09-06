import { sql, eq, and, desc } from 'drizzle-orm';
import { db, DrizzleClient } from '../db/client';
import { assertions } from '../db/schema';

export type AssertionOrigin = 'declared' | 'extracted' | 'verified' | 'evaluated';
export type AssertionStatus = 'active' | 'discarded';

export interface AiModelMetadata {
  model: string;
  provider: string;
  version?: string;
  promptTemplate?: string;
}

export interface RegisterAssertionInput {
  organizationId: string;
  dossierId: string;
  partyId: string;
  configurationVersionId: string;
  field: string;
  value: unknown;
  origin: AssertionOrigin;
  producedBy: string;
  evidenceId?: string;
  confidence?: string; // Number 0.00 - 1.00 as string
  aiModelMetadata?: AiModelMetadata;
}

export interface ResolveDiscrepancyInput {
  organizationId: string;
  dossierId: string;
  field: string;
  selectedAssertionId: string;
  resolvedBy: string;
  resolutionNote: string;
}

export interface AssertionDetail {
  id: string;
  organizationId: string;
  dossierId: string;
  partyId: string;
  configurationVersionId: string;
  field: string;
  value: unknown;
  origin: AssertionOrigin;
  producedBy: string;
  producedAt: Date;
  evidenceId: string | null;
  confidence: string | null;
  aiModelMetadata: AiModelMetadata | null;
  status: AssertionStatus;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/**
 * Registers an immutable assertion with complete provenance.
 * (ADR-0005, HU-005)
 */
export async function registerAssertion(
  input: RegisterAssertionInput,
  txClient?: DrizzleClient,
): Promise<AssertionDetail> {
  const client = txClient || db;

  // 1. Validate required origin
  if (!input.origin) {
    throw new Error('No se puede registrar una afirmación sin origen');
  }

  const validOrigins: AssertionOrigin[] = ['declared', 'extracted', 'verified', 'evaluated'];
  if (!validOrigins.includes(input.origin)) {
    throw new Error(`Origen de afirmación inválido: ${input.origin}`);
  }

  // 2. Validate extracted requirements: confidence and evidence mandatory
  if (input.origin === 'extracted') {
    if (!input.confidence) {
      throw new Error("Una afirmación con origen 'extracted' exige un nivel de confianza registrado");
    }
    const confVal = parseFloat(input.confidence);
    if (isNaN(confVal) || confVal < 0 || confVal > 1) {
      throw new Error('El nivel de confianza debe ser un número entre 0.00 y 1.00');
    }
    if (!input.evidenceId) {
      throw new Error("Una afirmación con origen 'extracted' exige una evidencia asociada (documento)");
    }
  }

  // 3. Validate verified requirements: evidence mandatory
  if (input.origin === 'verified') {
    if (!input.evidenceId) {
      throw new Error("Una afirmación verificada solo puede crearse citando la fuente externa o evidencia que la respalda");
    }
  }

  // 4. Insert assertion
  const [created] = await client
    .insert(assertions)
    .values({
      organizationId: input.organizationId,
      dossierId: input.dossierId,
      partyId: input.partyId,
      configurationVersionId: input.configurationVersionId,
      field: input.field,
      value: input.value,
      origin: input.origin,
      producedBy: input.producedBy,
      evidenceId: input.evidenceId || null,
      confidence: input.confidence || null,
      aiModelMetadata: input.aiModelMetadata || null,
      status: 'active',
    })
    .returning();

  // 5. Register in audit_log
  await client.execute(sql`
    INSERT INTO public.audit_log (
      organization_id,
      actor_user_id,
      action,
      metadata,
      origin
    ) VALUES (
      ${input.organizationId}::uuid,
      ${input.producedBy}::uuid,
      'assertion.registered',
      ${JSON.stringify({
        assertion_id: created.id,
        dossier_id: input.dossierId,
        field: input.field,
        origin: input.origin,
        evidence_id: input.evidenceId,
        confidence: input.confidence,
      })}::jsonb,
      ${JSON.stringify({ actor: 'user', service: 'registerAssertion' })}::jsonb
    )
  `);

  return {
    ...created,
    origin: created.origin as AssertionOrigin,
    status: created.status as AssertionStatus,
    aiModelMetadata: created.aiModelMetadata as AiModelMetadata | null,
  };
}

/**
 * Gets all assertions for a specific field in a dossier, ordered chronologically.
 */
export async function getAssertionsForField(
  organizationId: string,
  dossierId: string,
  field: string,
  txClient?: DrizzleClient,
): Promise<AssertionDetail[]> {
  const client = txClient || db;

  const rows = await client
    .select()
    .from(assertions)
    .where(
      and(
        eq(assertions.organizationId, organizationId),
        eq(assertions.dossierId, dossierId),
        eq(assertions.field, field),
      ),
    )
    .orderBy(desc(assertions.producedAt));

  return rows.map((r) => ({
    ...r,
    origin: r.origin as AssertionOrigin,
    status: r.status as AssertionStatus,
    aiModelMetadata: r.aiModelMetadata as AiModelMetadata | null,
  }));
}

/**
 * Resolves a discrepancy between conflicting assertions.
 * Marks the unselected assertion(s) as 'discarded' with a resolution note and author.
 * NEVER DELETES OR OVERWRITES ANY ASSERTION.
 */
export async function resolveDiscrepancy(
  input: ResolveDiscrepancyInput,
  txClient?: DrizzleClient,
): Promise<{ activeAssertion: AssertionDetail; discardedAssertions: AssertionDetail[] }> {
  const client = txClient || db;

  if (!input.resolutionNote || input.resolutionNote.trim() === '') {
    throw new Error('La resolución de una discrepancia exige una justificación o fundamento');
  }

  // Get all active assertions for the field
  const fieldAssertions = await client
    .select()
    .from(assertions)
    .where(
      and(
        eq(assertions.organizationId, input.organizationId),
        eq(assertions.dossierId, input.dossierId),
        eq(assertions.field, input.field),
      ),
    );

  const selected = fieldAssertions.find((a) => a.id === input.selectedAssertionId);
  if (!selected) {
    throw new Error('La afirmación seleccionada no existe para este campo y expediente');
  }

  const otherAssertions = fieldAssertions.filter((a) => a.id !== input.selectedAssertionId);

  const now = new Date();

  // Mark other assertions as discarded (trigger permits updating status, note, resolvedBy, resolvedAt)
  for (const other of otherAssertions) {
    await client
      .update(assertions)
      .set({
        status: 'discarded',
        resolutionNote: input.resolutionNote,
        resolvedBy: input.resolvedBy,
        resolvedAt: now,
      })
      .where(eq(assertions.id, other.id));
  }

  // Record discrepancy resolution in audit log
  await client.execute(sql`
    INSERT INTO public.audit_log (
      organization_id,
      actor_user_id,
      action,
      metadata,
      origin
    ) VALUES (
      ${input.organizationId}::uuid,
      ${input.resolvedBy}::uuid,
      'assertion.discrepancy_resolved',
      ${JSON.stringify({
        field: input.field,
        dossier_id: input.dossierId,
        selected_assertion_id: input.selectedAssertionId,
        discarded_assertion_ids: otherAssertions.map((a) => a.id),
        resolution_note: input.resolutionNote,
      })}::jsonb,
      ${JSON.stringify({ actor: 'user', service: 'resolveDiscrepancy' })}::jsonb
    )
  `);

  const updatedRows = await getAssertionsForField(input.organizationId, input.dossierId, input.field, client);
  const active = updatedRows.find((a) => a.id === input.selectedAssertionId)!;
  const discarded = updatedRows.filter((a) => a.id !== input.selectedAssertionId);

  return { activeAssertion: active, discardedAssertions: discarded };
}
