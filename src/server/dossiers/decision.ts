import { eq, and, asc, inArray } from 'drizzle-orm';
import { db, DrizzleClient, DatabaseTransaction } from '../db/client';
import {
  decisions,
  decisionConditions,
  dossiers,
  assertions,
  documents,
} from '../db/schema';
import { executeTransition } from './state-machine';
import { logAuditEvent } from '../audit/service';

export interface EvidenceRef {
  kind: 'assertion' | 'document';
  id: string;
}

export interface RecordDecisionInput {
  organizationId: string;
  dossierId: string;
  type: 'approve' | 'approve_with_conditions' | 'reject';
  responsibleId: string;
  title: string;
  rationale: string;
  evidence: EvidenceRef[];
  validUntil: Date;
  conditions?: string[];
}

const DECISION_TYPE_TO_STATE = {
  approve: 'aprobada',
  approve_with_conditions: 'aprobada_con_condiciones',
  reject: 'rechazada',
} as const;

export interface DecisionRecord {
  id: string;
  type: string;
  responsibleId: string;
  title: string;
  madeAt: Date;
  rationale: string;
  evidence: EvidenceRef[];
  validUntil: Date;
  conditions: string[];
}

/**
 * Records a formal compliance decision for a dossier.
 * Reuses executeTransition within the same database transaction.
 */
export async function recordDecision(
  input: RecordDecisionInput,
  txClient?: DrizzleClient,
): Promise<{ id: string }> {
  // 1. Validation before hitting database
  if (!input.rationale || input.rationale.trim() === '') {
    throw new Error('El fundamento de la decisión es obligatorio y no puede estar vacío');
  }

  if (!input.title || input.title.trim() === '') {
    throw new Error('El cargo del responsable es obligatorio');
  }

  if (!input.evidence || input.evidence.length === 0) {
    throw new Error('Debe indicar al menos una evidencia en la que se basó la decisión');
  }

  const now = new Date();
  if (!input.validUntil || input.validUntil.getTime() <= now.getTime()) {
    throw new Error('La fecha de vigencia debe ser posterior a la fecha actual');
  }

  if (input.type === 'approve_with_conditions') {
    if (!input.conditions || input.conditions.length === 0 || input.conditions.some((c) => !c || c.trim() === '')) {
      throw new Error('La decisión de aprobar con condiciones exige especificar al menos una condición no vacía');
    }
  } else {
    if (input.conditions && input.conditions.length > 0) {
      throw new Error('Solo la decisión de aprobar con condiciones puede incluir condiciones estructuradas');
    }
  }

  const execute = async (tx: DatabaseTransaction): Promise<{ id: string }> => {
    // 2. Load dossier
    const [dossier] = await tx
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

    // 3. Verify evidence references exist in the database for this dossier and organization
    const assertionIds = input.evidence.filter((e) => e.kind === 'assertion').map((e) => e.id);
    const documentIds = input.evidence.filter((e) => e.kind === 'document').map((e) => e.id);

    if (assertionIds.length > 0) {
      const activeAssertions = await tx
        .select({ id: assertions.id })
        .from(assertions)
        .where(
          and(
            eq(assertions.organizationId, input.organizationId),
            eq(assertions.dossierId, input.dossierId),
            eq(assertions.status, 'active'),
            inArray(assertions.id, assertionIds),
          ),
        );

      const foundAssertionIds = new Set(activeAssertions.map((a) => a.id));
      for (const id of assertionIds) {
        if (!foundAssertionIds.has(id)) {
          throw new Error(`La afirmación citada como evidencia con ID '${id}' no existe o no está activa para este expediente`);
        }
      }
    }

    if (documentIds.length > 0) {
      const existingDocs = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.organizationId, input.organizationId),
            eq(documents.dossierId, input.dossierId),
            inArray(documents.id, documentIds),
          ),
        );

      const foundDocIds = new Set(existingDocs.map((d) => d.id));
      for (const id of documentIds) {
        if (!foundDocIds.has(id)) {
          throw new Error(`El documento citado como evidencia con ID '${id}' no existe para este expediente`);
        }
      }
    }

    // 4. Insert into decisions
    const [createdDecision] = await tx
      .insert(decisions)
      .values({
        organizationId: input.organizationId,
        dossierId: input.dossierId,
        type: input.type,
        responsibleId: input.responsibleId,
        title: input.title.trim(),
        rationale: input.rationale.trim(),
        evidence: input.evidence,
        validUntil: input.validUntil,
        configurationVersionId: dossier.configurationVersionId,
      })
      .returning();

    // 5. Insert conditions if applicable
    if (input.type === 'approve_with_conditions' && input.conditions) {
      for (const condText of input.conditions) {
        await tx.insert(decisionConditions).values({
          organizationId: input.organizationId,
          decisionId: createdDecision.id,
          text: condText.trim(),
        });
      }
    }

    // 6. Execute state transition (reusing executeTransition with rationale as reason)
    const targetState = DECISION_TYPE_TO_STATE[input.type];
    await executeTransition(
      {
        organizationId: input.organizationId,
        dossierId: input.dossierId,
        toState: targetState,
        actorType: 'user',
        actorId: input.responsibleId,
        reason: input.rationale.trim(),
      },
      tx,
    );

    // 7. Log decision audit event
    await logAuditEvent(
      {
        organizationId: input.organizationId,
        actorType: 'user',
        actorUserId: input.responsibleId,
        action: 'dossier.decision_recorded',
        entity: 'dossier',
        entityId: input.dossierId,
        configurationVersionId: dossier.configurationVersionId,
        metadata: {
          decision_id: createdDecision.id,
          decision_type: input.type,
          valid_until: input.validUntil.toISOString(),
          evidence_count: input.evidence.length,
          conditions_count: input.conditions ? input.conditions.length : 0,
        },
        origin: { actor: 'user', action: 'recordDecision' },
      },
      tx,
    );

    return { id: createdDecision.id };
  };

  if (txClient && 'execute' in txClient) {
    return execute(txClient as DatabaseTransaction);
  }
  return db.transaction(execute);
}

/**
 * Retrieves all recorded decisions for a dossier in chronological order (made_at ascending).
 */
export async function getDecisionsForDossier(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<DecisionRecord[]> {
  const client = txClient || db;

  const decisionRows = await client
    .select()
    .from(decisions)
    .where(
      and(
        eq(decisions.organizationId, organizationId),
        eq(decisions.dossierId, dossierId),
      ),
    )
    .orderBy(asc(decisions.madeAt));

  if (decisionRows.length === 0) {
    return [];
  }

  const decisionIds = decisionRows.map((d) => d.id);

  const conditionRows = await client
    .select()
    .from(decisionConditions)
    .where(
      and(
        eq(decisionConditions.organizationId, organizationId),
        inArray(decisionConditions.decisionId, decisionIds),
      ),
    )
    .orderBy(asc(decisionConditions.createdAt));

  const conditionsByDecision = new Map<string, string[]>();
  for (const cond of conditionRows) {
    const list = conditionsByDecision.get(cond.decisionId) || [];
    list.push(cond.text);
    conditionsByDecision.set(cond.decisionId, list);
  }

  return decisionRows.map((d) => ({
    id: d.id,
    type: d.type,
    responsibleId: d.responsibleId,
    title: d.title,
    madeAt: d.madeAt,
    rationale: d.rationale,
    evidence: d.evidence as EvidenceRef[],
    validUntil: d.validUntil,
    conditions: conditionsByDecision.get(d.id) || [],
  }));
}
