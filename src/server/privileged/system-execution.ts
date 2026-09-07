import { adminDb, adminSqlClient } from '../db/admin-client';
import type { DatabaseTransaction } from '../db/client';
import { logAuditEvent } from '../audit/service';

export interface PrivilegedOperationOptions {
  action: string;
  organizationId: string;
  metadata?: Record<string, unknown>;
  description?: string;
  entity?: string;
  entityId?: string;
}

/**
 * Executes an administrative or automated system operation bypassing standard tenant RLS,
 * while mandating an immutable audit trail with actor_type = 'system'.
 * (ADR-0001, ADR-0007, HU-002, HU-010)
 */
export async function executePrivilegedSystemOperation<T>(
  options: PrivilegedOperationOptions,
  operation: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  if (!options.organizationId) {
    throw new Error(`executePrivilegedSystemOperation requires organizationId to guarantee mandatory audit trail for action '${options.action}'`);
  }

  return adminDb.transaction(async (tx) => {
    // 1. Execute the core privileged operation
    const result = await operation(tx);

    // 2. Mandatory audit log entry (ADR-0007, RF-006, HU-002)
    await logAuditEvent(
      {
        organizationId: options.organizationId,
        actorType: 'system',
        action: options.action,
        entity: options.entity,
        entityId: options.entityId,
        automatic: true,
        metadata: options.metadata || {},
        origin: { actor: 'system', description: options.description || 'automated process' },
      },
      tx,
    );

    return result;
  });
}

export { adminDb, adminSqlClient };