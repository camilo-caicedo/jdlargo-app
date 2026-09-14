import { createHash } from 'crypto';
import { eq, and, gte, lte, lt, desc, or } from 'drizzle-orm';
import { db, DrizzleClient } from '../db/client';
import { auditLog, users } from '../db/schema';
import { getActiveConfigurationVersion } from '../auth/role-config';

export type ActorType = 'user' | 'system' | 'counterparty';

export interface AiModelAudit {
  model: string;
  provider: string;
  version?: string;
  promptTemplate?: string;
}

export interface RequestOrigin {
  ipAddress?: string;
  userAgent?: string;
  route?: string;
  actorType?: ActorType;
}

export interface LogAuditEventInput {
  organizationId: string;
  action: string;
  actorType?: ActorType;
  actorUserId?: string; // Required if actorType === 'user'
  actorDetails?: Record<string, unknown>; // e.g. systemJobName, cronDetails
  entity?: string;
  entityId?: string;
  requestOrigin?: RequestOrigin;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string;
  source?: string;
  automatic?: boolean;
  aiModel?: AiModelAudit;
  configurationVersionId?: string;
  metadata?: Record<string, unknown>;
  origin?: Record<string, unknown>;
  requireReason?: boolean; // If true, reason is mandatory
}

/**
 * Catálogo de acciones sensibles del dominio que exigen justificación explícita obligatoria.
 * (HU-006 & ADR-0007)
 */
export const SENSITIVE_ACTIONS_REQUIRING_REASON = new Set([
  'dossier.override_risk',
  'assertion.discrepancy_resolved',
  'configuration.published',
]);


export interface AuditLogDetail {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  actorUserName?: string | null;
  actorUserEmail?: string | null;
  actorType: ActorType;
  actorDetails: Record<string, unknown> | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  occurredAt: Date;
  requestOrigin: RequestOrigin | null;
  previousValue: unknown;
  newValue: unknown;
  reason: string | null;
  source: string | null;
  automatic: boolean;
  aiModel: AiModelAudit | null;
  configurationVersionId: string | null;
  eventHash: string;
  metadata: Record<string, unknown> | null;
  origin: Record<string, unknown> | null;
}

/**
 * Computes deterministic SHA-256 event hash for tamper-evidence (ADR-0007).
 */
export function computeEventHash(payload: {
  organizationId: string;
  actorType: string;
  actorUserId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  occurredAt: string;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}): string {
  const hash = createHash('sha256');
  const canonicalString = JSON.stringify({
    org: payload.organizationId,
    actorType: payload.actorType,
    actorUser: payload.actorUserId || null,
    action: payload.action,
    entity: payload.entity || null,
    entityId: payload.entityId || null,
    occurredAt: payload.occurredAt,
    prev: payload.previousValue !== undefined ? payload.previousValue : null,
    next: payload.newValue !== undefined ? payload.newValue : null,
    reason: payload.reason || null,
  });
  hash.update(canonicalString);
  return hash.digest('hex');
}

/**
 * Logs an atomic immutable audit event.
 * (ADR-0007, HU-006)
 */
export async function logAuditEvent(
  input: LogAuditEventInput,
  txClient?: DrizzleClient,
): Promise<AuditLogDetail> {
  const client = txClient || db;

  const actorType: ActorType = input.actorType || (input.actorUserId ? 'user' : 'system');
  const isAutomatic = input.automatic !== undefined ? input.automatic : actorType === 'system';

  // 1. Validate user actor requires actorUserId
  if (actorType === 'user' && !input.actorUserId) {
    throw new Error('Un evento con tipo de actor user exige un actorUserId');
  }

  // 2. Validate system actor must not have personal user attributed
  if (actorType === 'system' && input.actorUserId) {
    throw new Error('Un proceso automático del sistema no se puede atribuir a una persona');
  }

  // 3. Validate mandatory justification (either explicit requireReason or automatic by sensitive catalog)
  const isReasonMandatory = input.requireReason || SENSITIVE_ACTIONS_REQUIRING_REASON.has(input.action);
  if (isReasonMandatory && (!input.reason || input.reason.trim() === '')) {
    throw new Error('Esta acción exige una justificación o motivo explícito');
  }

  // 4. Resolve active configuration version if not explicitly provided
  let configVersionId = input.configurationVersionId;
  if (!configVersionId) {
    const activeVer = await getActiveConfigurationVersion(input.organizationId, client);
    if (activeVer) {
      configVersionId = activeVer.id;
    }
  }

  const occurredAt = new Date();

  // 5. Compute event hash
  const eventHash = computeEventHash({
    organizationId: input.organizationId,
    actorType,
    actorUserId: input.actorUserId || null,
    action: input.action,
    entity: input.entity || null,
    entityId: input.entityId || null,
    occurredAt: occurredAt.toISOString(),
    previousValue: input.previousValue,
    newValue: input.newValue,
    reason: input.reason || null,
  });

  const [row] = await client
    .insert(auditLog)
    .values({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId || null,
      actorType,
      actorDetails: input.actorDetails || null,
      action: input.action,
      entity: input.entity || null,
      entityId: input.entityId || null,
      occurredAt,
      requestOrigin: input.requestOrigin || null,
      previousValue: input.previousValue !== undefined ? input.previousValue : null,
      newValue: input.newValue !== undefined ? input.newValue : null,
      reason: input.reason || null,
      source: input.source || null,
      automatic: isAutomatic,
      aiModel: input.aiModel || null,
      configurationVersionId: configVersionId || null,
      eventHash,
      metadata: input.metadata || null,
      origin: input.origin || null,
    })
    .returning();

  return {
    ...row,
    actorType: row.actorType as ActorType,
    actorDetails: row.actorDetails as Record<string, unknown> | null,
    requestOrigin: row.requestOrigin as RequestOrigin | null,
    aiModel: row.aiModel as AiModelAudit | null,
    eventHash: row.eventHash!,
    metadata: row.metadata as Record<string, unknown> | null,
    origin: row.origin as Record<string, unknown> | null,
  };
}

/**
 * Reconstructs the complete chronological audit history of a specific domain entity.
 * (HU-006 Escenario: Reconstruir la historia de una fila)
 */
export async function getEntityAuditHistory(
  organizationId: string,
  entity: string,
  entityId: string,
  txClient?: DrizzleClient,
): Promise<AuditLogDetail[]> {
  const client = txClient || db;

  const rows = await client
    .select({
      log: auditLog,
      actorUserName: users.name,
      actorUserEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorUserId, users.id))
    .where(
      and(
        eq(auditLog.organizationId, organizationId),
        eq(auditLog.entity, entity),
        eq(auditLog.entityId, entityId),
      ),
    )
    .orderBy(auditLog.occurredAt);

  return rows.map(({ log, actorUserName, actorUserEmail }) => ({
    ...log,
    actorUserName: actorUserName || null,
    actorUserEmail: actorUserEmail || null,
    actorType: log.actorType as ActorType,
    actorDetails: log.actorDetails as Record<string, unknown> | null,
    requestOrigin: log.requestOrigin as RequestOrigin | null,
    aiModel: log.aiModel as AiModelAudit | null,
    eventHash: log.eventHash!,
    metadata: log.metadata as Record<string, unknown> | null,
    origin: log.origin as Record<string, unknown> | null,
  }));
}

export interface ListAuditLogFilter {
  actorUserId?: string;
  action?: string;
  entity?: string;
  from?: Date;
  to?: Date;
  limit?: number; // paginación, default 50
  cursor?: string; // id del último registro leído
}

/**
 * Lists audit log entries for an entire organization, supporting filters and pagination.
 * (HU-006 & Panel de administración consolidado)
 */
export async function listAuditLogForOrganization(
  organizationId: string,
  filter: ListAuditLogFilter = {},
  txClient?: DrizzleClient,
): Promise<{ entries: AuditLogDetail[]; nextCursor: string | null }> {
  const client = txClient || db;
  const limit = filter.limit && filter.limit > 0 ? filter.limit : 50;

  const conditions = [eq(auditLog.organizationId, organizationId)];

  if (filter.actorUserId) {
    conditions.push(eq(auditLog.actorUserId, filter.actorUserId));
  }
  if (filter.action) {
    conditions.push(eq(auditLog.action, filter.action));
  }
  if (filter.entity) {
    conditions.push(eq(auditLog.entity, filter.entity));
  }
  if (filter.from) {
    conditions.push(gte(auditLog.occurredAt, filter.from));
  }
  if (filter.to) {
    conditions.push(lte(auditLog.occurredAt, filter.to));
  }

  // If cursor provided, fetch its occurredAt/id to paginate backwards in time
  if (filter.cursor) {
    const [cursorRow] = await client
      .select({ occurredAt: auditLog.occurredAt, id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, organizationId), eq(auditLog.id, filter.cursor)))
      .limit(1);

    if (cursorRow) {
      conditions.push(
        or(
          lt(auditLog.occurredAt, cursorRow.occurredAt),
          and(eq(auditLog.occurredAt, cursorRow.occurredAt), lt(auditLog.id, cursorRow.id)),
        )!,
      );
    }
  }

  const rows = await client
    .select({
      log: auditLog,
      actorUserName: users.name,
      actorUserEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorUserId, users.id))
    .where(and(...conditions))
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? pageRows[pageRows.length - 1].log.id : null;

  const entries: AuditLogDetail[] = pageRows.map(({ log, actorUserName, actorUserEmail }) => ({
    ...log,
    actorUserName: actorUserName || null,
    actorUserEmail: actorUserEmail || null,
    actorType: log.actorType as ActorType,
    actorDetails: log.actorDetails as Record<string, unknown> | null,
    requestOrigin: log.requestOrigin as RequestOrigin | null,
    aiModel: log.aiModel as AiModelAudit | null,
    eventHash: log.eventHash!,
    metadata: log.metadata as Record<string, unknown> | null,
    origin: log.origin as Record<string, unknown> | null,
  }));

  return {
    entries,
    nextCursor,
  };
}
