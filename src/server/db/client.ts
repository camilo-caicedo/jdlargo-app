import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import dns from 'dns';

try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

const connectionString = process.env.DATABASE_URL;

if (!connectionString && process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL environment variable is missing.');
}

// Transaction mode pooler connection for application traffic
export const sqlClient = postgres(connectionString || '', {
  prepare: false, // Required for transaction mode / pgbouncer
});

export const db = drizzle(sqlClient, { schema });

export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TenantContext {
  userId: string;
  organizationId: string;
  actorType?: 'user' | 'system' | 'counterparty';
}

/**
 * Propagates user identity and active tenant context to Postgres session variables.
 * Enforces database-level isolation for all domain tables via RLS.
 */
export async function withTenantContext<T>(
  context: TenantContext,
  fn: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({
      sub: context.userId,
      role: 'authenticated',
      actor_type: context.actorType || 'user',
    });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`select set_config('app.current_organization_id', ${context.organizationId}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

/**
 * User-only context helper (backwards-compatible with HU-001).
 * When organizationId is not specified, domain tables rely on active membership lookups.
 */
export async function withUserContext<T>(
  userId: string,
  fn: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`select set_config('app.current_organization_id', '', true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}