// Aplica src/server/db/migrations/*.sql, en orden, contra el stack local de Supabase
// (npx supabase start), leyendo las credenciales de .env.test — ver docs/entorno-local.md.
//
// No usa `drizzle-kit migrate`: su journal (meta/_journal.json) quedó desincronizado hace
// tiempo porque varias migraciones se aplicaron directo contra Supabase remoto sin pasar
// por drizzle-kit. Estos archivos .sql son el registro real y correcto — se ejecutan tal
// cual, secuencialmente, igual que ya corrieron contra producción.
import { readFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import postgres from 'postgres';

const root = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(root, '..', '.env.test');
if (!existsSync(envPath)) {
  console.error('Falta .env.test. Copia .env.test.example y llénalo con `npx supabase status`.');
  process.exit(1);
}

for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  process.env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
}

const migrationsDir = path.join(root, '..', 'src', 'server', 'db', 'migrations');
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const sql = postgres(process.env.DIRECT_URL, { max: 1 });

// Tabla propia de seguimiento, independiente del journal de drizzle-kit (que está
// desincronizado — ver comentario arriba). Solo existe en local, nunca se aplica a
// producción porque este script nunca corre contra DIRECT_URL de Supabase remoto.
// Vive en su propio esquema, no en `public`: isolation.test.ts (HU-002) escanea todas las
// tablas de `public` y exige RLS + organization_id en cada una — esta tabla es tooling de
// desarrollo, no dominio, y no le corresponde esa regla.
await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS _local_tooling`);
await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS _local_tooling.migrations_applied (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);
const alreadyApplied = new Set(
  (await sql.unsafe('SELECT filename FROM _local_tooling.migrations_applied')).map((r) => r.filename),
);

let appliedCount = 0;
for (const file of files) {
  if (alreadyApplied.has(file)) continue;

  const content = readFileSync(path.join(migrationsDir, file), 'utf8');
  const statements = content
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await sql.unsafe(statement);
  }
  await sql.unsafe('INSERT INTO _local_tooling.migrations_applied (filename) VALUES ($1)', [file]);
  console.log(`✓ ${file}`);
  appliedCount++;
}

await sql.end();
console.log(
  appliedCount === 0
    ? '\nYa estaba al día, nada nuevo que aplicar.'
    : `\n${appliedCount} migración(es) nueva(s) aplicada(s) contra ${process.env.DIRECT_URL}`,
);
