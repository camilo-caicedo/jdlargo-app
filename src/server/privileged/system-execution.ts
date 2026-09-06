import { sql } from 'drizzle-orm';
import { adminDb, adminSqlClient } from '../db/admin-client';
import type { DatabaseTransaction } from '../db/client';

export interface PrivilegedOperationOptions {
  action: string;
  organizationId?: string;
  metadata?: Record<string, unknown>;
  description?: string;
}

/**
 * Executes an administrative or automated system operation bypassing standard tenant RLS,
 * while mandating an immutable audit trail with actor_type = 'system'.
 */
export async function executePrivilegedSystemOperation<T>(
  options: PrivilegedOperationOptions,
  operation: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return adminDb.transaction(async (tx) => {
    // 1. Execute the core privileged operation
    const result = await operation(tx);

    // 2. Mandatory audit log entry (ADR-0007, RF-006, HU-002)
    if (options.organizationId) {
      await tx.execute(sql`
        INSERT INTO public.audit_log (
          organization_id,
          actor_user_id,
          action,
          metadata,
          origin
        ) VALUES (
          ${options.organizationId}::uuid,
          NULL,
          ${options.action},
          ${JSON.stringify(options.metadata || {})}::jsonb,
          ${JSON.stringify({ actor: 'system', description: options.description || 'automated process' })}::jsonb
        )
      `);
    }

    return result;
  });
}

export { adminDb, adminSqlClient };