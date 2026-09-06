import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import dns from 'dns';

try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

const directConnectionString = process.env.DIRECT_URL;

if (!directConnectionString && process.env.NODE_ENV === 'production') {
  throw new Error('DIRECT_URL environment variable is missing.');
}

// Direct connection (port 5432) reserved for admin/migration tasks
export const adminSqlClient = postgres(directConnectionString || '');

export const adminDb = drizzle(adminSqlClient, { schema });
