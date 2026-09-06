import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import { customLookup } from './dns-helper';

const connectionString = process.env.DATABASE_URL;

if (!connectionString && process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL environment variable is missing.');
}

// Transaction mode pooler connection for application traffic
export const sqlClient = postgres(connectionString || '', {
  prepare: false, // Required for transaction mode / pgbouncer
  // Use custom lookup when standard system DNS fails to resolve Supabase pooler host
  connection: {
    lookup: customLookup as unknown as undefined,
  },
});

export const db = drizzle(sqlClient, { schema });

export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withUserContext<T>(
  userId: string,
  fn: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}