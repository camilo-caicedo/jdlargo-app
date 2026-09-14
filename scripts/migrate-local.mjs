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

for (const file of files) {
  const content = readFileSync(path.join(migrationsDir, file), 'utf8');
  const statements = content
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await sql.unsafe(statement);
  }
  console.log(`✓ ${file}`);
}

await sql.end();
console.log(`\n${files.length} migraciones aplicadas contra ${process.env.DIRECT_URL}`);
