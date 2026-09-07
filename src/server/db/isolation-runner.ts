import postgres from 'postgres';

export interface DomainTableAudit {
  tableName: string;
  hasRLS: boolean;
  hasForceRLS: boolean;
  hasOrganizationId: boolean;
  organizationIdNullable: boolean;
}

// Users lives globally above tenants (ADR-0001 §10). Organizations represents the tenant itself (ADR-0001 §9).
export const EXCEPTED_GLOBAL_TABLES = ['users', 'organizations'];

/**
 * Inspects Postgres metadata catalogs to verify compliance with ADR-0001 and HU-002:
 * Every domain table (except global user accounts) MUST have:
 * 1. Row-Level Security enabled (rowsecurity = true)
 * 2. FORCE ROW LEVEL SECURITY enabled (forcerowsecurity = true)
 * 3. An organization_id column with NOT NULL constraint
 */
export async function auditDomainTables(sql: postgres.Sql): Promise<{
  domainTables: DomainTableAudit[];
  violations: string[];
}> {
  // Query all public tables, their RLS and FORCE RLS status
  const tables = await sql<{
    table_name: string;
    rowsecurity: boolean;
    forcerowsecurity: boolean;
  }[]>`
    SELECT 
      c.relname as table_name,
      c.relrowsecurity as rowsecurity,
      c.relforcerowsecurity as forcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT LIKE 'pg_%'
      AND c.relname NOT LIKE '_drizzle_%'
    ORDER BY c.relname;
  `;

  // Query all columns in public schema
  const columns = await sql<{
    table_name: string;
    column_name: string;
    is_nullable: string;
  }[]>`
    SELECT 
      table_name,
      column_name,
      is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public';
  `;

  const domainTables: DomainTableAudit[] = [];
  const violations: string[] = [];

  for (const table of tables) {
    const isExcepted = EXCEPTED_GLOBAL_TABLES.includes(table.table_name);
    const tableCols = columns.filter((c) => c.table_name === table.table_name);
    const orgIdCol = tableCols.find((c) => c.column_name === 'organization_id');

    const audit: DomainTableAudit = {
      tableName: table.table_name,
      hasRLS: table.rowsecurity,
      hasForceRLS: table.forcerowsecurity,
      hasOrganizationId: !!orgIdCol,
      organizationIdNullable: orgIdCol ? orgIdCol.is_nullable === 'YES' : false,
    };

    domainTables.push(audit);

    // Rule 1: Every table (including users) must have RLS enabled
    if (!audit.hasRLS) {
      violations.push(`Table '${table.table_name}' does NOT have Row-Level Security (RLS) enabled.`);
    }

    // Rule 2: Every domain table must have FORCE ROW LEVEL SECURITY enabled (Fix HU-002 auditoría)
    if (!isExcepted && !audit.hasForceRLS) {
      violations.push(`Domain table '${table.table_name}' does NOT have FORCE ROW LEVEL SECURITY enabled.`);
    }

    // Rule 3: Every domain table (except global user accounts) must have organization_id NOT NULL
    if (!isExcepted) {
      if (!audit.hasOrganizationId) {
        violations.push(`Domain table '${table.table_name}' lacks required 'organization_id' column.`);
      } else if (audit.organizationIdNullable) {
        violations.push(`Domain table '${table.table_name}' has nullable 'organization_id', but it must be NOT NULL.`);
      }
    }
  }

  return { domainTables, violations };
}