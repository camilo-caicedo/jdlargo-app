import { eq, and, sql, asc } from 'drizzle-orm';
import { db, DrizzleClient, DatabaseTransaction } from '../db/client';
import { dossiers, dossierTransitions, validTransitions } from '../db/schema';
import { enforceUserPermission } from '../auth/access-control';
import { logAuditEvent } from '../audit/service';
import type { PermissionKey } from '../auth/permissions';

export interface ExecuteTransitionInput {
  organizationId: string;
  dossierId: string;
  toState: string;
  actorType: 'user' | 'system' | 'counterparty';
  actorId?: string;
  reason?: string;
}

export interface DossierTransitionRecord {
  id: string;
  dossierId: string;
  fromState: string;
  toState: string;
  actorType: 'user' | 'system' | 'counterparty';
  actorId: string | null;
  occurredAt: Date;
  reason: string | null;
  configurationVersionId: string;
}

/**
 * Creates the minimal shell of a dossier in the initial state ('borrador').
 * HU-008 calls this and decorates the record with business attributes.
 */
export async function createDossierShell(
  input: { organizationId: string; configurationVersionId: string },
  txClient?: DrizzleClient,
): Promise<{ id: string; state: string }> {
  const client = txClient || db;

  const [inserted] = await client
    .insert(dossiers)
    .values({
      organizationId: input.organizationId,
      configurationVersionId: input.configurationVersionId,
      state: 'borrador',
    })
    .returning();

  return {
    id: inserted.id,
    state: inserted.state,
  };
}

/**
 * Single entry point for transitions on dossiers.state.
 * Validates domain rules, permissions, audit trails and database session triggers.
 */
export async function executeTransition(
  input: ExecuteTransitionInput,
  txClient?: DrizzleClient,
): Promise<DossierTransitionRecord> {
  const client = txClient || db;

  // 1. Load dossier
  const [dossier] = await client
    .select()
    .from(dossiers)
    .where(
      and(
        eq(dossiers.organizationId, input.organizationId),
        eq(dossiers.id, input.dossierId),
      ),
    );

  if (!dossier) {
    throw new Error('Expediente no encontrado');
  }

  // 2. Validate transition exists in valid_transitions
  const [validTransition] = await client
    .select()
    .from(validTransitions)
    .where(
      and(
        eq(validTransitions.source, dossier.state),
        eq(validTransitions.target, input.toState),
      ),
    );

  if (!validTransition) {
    const reasonMessage = `Transición no permitida: no existe transición declarada de '${dossier.state}' hacia '${input.toState}'`;
    await logAuditEvent(
      {
        organizationId: input.organizationId,
        actorType: input.actorType,
        actorUserId: input.actorType === 'user' ? input.actorId : undefined,
        action: 'dossier.transition_rejected',
        entity: 'dossier',
        entityId: input.dossierId,
        configurationVersionId: dossier.configurationVersionId,
        reason: reasonMessage,
        metadata: {
          dossier_id: input.dossierId,
          from_state: dossier.state,
          attempted_to_state: input.toState,
          rejection_type: 'undeclared_transition',
        },
        origin: { actor: input.actorType, action: 'executeTransition' },
      },
      db, // Top-level db so error/caller rollback does not lose rejection audit record
    );

    throw new Error(reasonMessage);
  }

  // 3. Validate reason if required
  if (validTransition.requiresReason && (!input.reason || input.reason.trim() === '')) {
    const reasonMessage = `La transición de '${dossier.state}' hacia '${input.toState}' exige un motivo obligatorio`;
    await logAuditEvent(
      {
        organizationId: input.organizationId,
        actorType: input.actorType,
        actorUserId: input.actorType === 'user' ? input.actorId : undefined,
        action: 'dossier.transition_rejected',
        entity: 'dossier',
        entityId: input.dossierId,
        configurationVersionId: dossier.configurationVersionId,
        reason: reasonMessage,
        metadata: {
          dossier_id: input.dossierId,
          from_state: dossier.state,
          attempted_to_state: input.toState,
          rejection_type: 'missing_required_reason',
        },
        origin: { actor: input.actorType, action: 'executeTransition' },
      },
      db,
    );

    throw new Error(reasonMessage);
  }

  // 4. Permission enforcement:
  // For 'user' actors, verify user permission in the organization.
  // For 'system' and 'counterparty' actors, no user role applies, so permission enforcement is bypassed.
  if (input.actorType === 'user') {
    if (!input.actorId) {
      throw new Error("El actor tipo 'user' exige un actorId válido");
    }

    await enforceUserPermission(
      {
        userId: input.actorId,
        organizationId: input.organizationId,
      },
      validTransition.permission as PermissionKey,
      {
        dossierId: input.dossierId,
        fromState: dossier.state,
        toState: input.toState,
      },
      txClient,
    );
  }

  // 5. Execute state change and persistence within a database transaction
  const executeInTx = async (tx: DatabaseTransaction): Promise<DossierTransitionRecord> => {
    // Set session flag required by trg_validate_dossier_transition
    await tx.execute(sql`select set_config('app.dossier_transition_in_progress', 'true', true)`);

    // Update dossier state
    await tx
      .update(dossiers)
      .set({
        state: input.toState,
      })
      .where(
        and(
          eq(dossiers.id, input.dossierId),
          eq(dossiers.organizationId, input.organizationId),
        ),
      );

    // Insert transition record into dossier_transitions
    const [transitionRecord] = await tx
      .insert(dossierTransitions)
      .values({
        organizationId: input.organizationId,
        dossierId: input.dossierId,
        fromState: dossier.state,
        toState: input.toState,
        actorType: input.actorType,
        actorId: input.actorType === 'user' ? input.actorId : null,
        reason: input.reason || null,
        configurationVersionId: dossier.configurationVersionId,
      })
      .returning();

    // Log to transversal immutable audit trail (ADR-0007 / HU-006)
    await logAuditEvent(
      {
        organizationId: input.organizationId,
        actorType: input.actorType,
        actorUserId: input.actorType === 'user' ? input.actorId : undefined,
        action: 'dossier.transitioned',
        entity: 'dossier',
        entityId: input.dossierId,
        reason: input.reason || undefined,
        configurationVersionId: dossier.configurationVersionId,
        metadata: {
          dossier_id: input.dossierId,
          from_state: dossier.state,
          to_state: input.toState,
          permission: validTransition.permission,
        },
        origin: { actor: input.actorType, action: 'executeTransition' },
      },
      tx,
    );

    return {
      id: transitionRecord.id,
      dossierId: transitionRecord.dossierId,
      fromState: transitionRecord.fromState,
      toState: transitionRecord.toState,
      actorType: transitionRecord.actorType as 'user' | 'system' | 'counterparty',
      actorId: transitionRecord.actorId,
      occurredAt: transitionRecord.occurredAt,
      reason: transitionRecord.reason,
      configurationVersionId: transitionRecord.configurationVersionId,
    };
  };

  if (txClient && 'execute' in txClient) {
    return executeInTx(txClient as DatabaseTransaction);
  }
  return db.transaction(executeInTx);
}

/**
 * Returns complete sequential history of transitions for a dossier.
 */
export async function getDossierHistory(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<DossierTransitionRecord[]> {
  const client = txClient || db;

  const rows = await client
    .select()
    .from(dossierTransitions)
    .where(
      and(
        eq(dossierTransitions.organizationId, organizationId),
        eq(dossierTransitions.dossierId, dossierId),
      ),
    )
    .orderBy(asc(dossierTransitions.occurredAt), asc(dossierTransitions.createdAt));

  return rows.map((r) => ({
    id: r.id,
    dossierId: r.dossierId,
    fromState: r.fromState,
    toState: r.toState,
    actorType: r.actorType as 'user' | 'system' | 'counterparty',
    actorId: r.actorId,
    occurredAt: r.occurredAt,
    reason: r.reason,
    configurationVersionId: r.configurationVersionId,
  }));
}

/**
 * Lists all valid transitions from a given state.
 */
export async function listValidTransitionsFrom(
  fromState: string,
  txClient?: DrizzleClient,
): Promise<{ target: string; permission: string; requiresReason: boolean }[]> {
  const client = txClient || db;

  const rows = await client
    .select()
    .from(validTransitions)
    .where(eq(validTransitions.source, fromState));

  return rows.map((r) => ({
    target: r.target,
    permission: r.permission,
    requiresReason: r.requiresReason,
  }));
}