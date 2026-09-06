import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const directConnectionString = process.env.DIRECT_URL;

if (!directConnectionString && process.env.NODE_ENV === 'production') {
  throw new Error('DIRECT_URL environment variable is missing.');
}

// Direct connection (port 5432) reserved for admin/migration tasks
const adminSqlClient = postgres(directConnectionString || '');

export const adminDb = drizzle(adminSqlClient, { schema });
