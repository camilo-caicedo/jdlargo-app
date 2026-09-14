# Entorno local (Supabase + pruebas)

Este repo no tiene un stack local por defecto: hasta ahora `npm run test` y `npm run dev`
apuntaban siempre a la base de datos real de Supabase vía `.env.local`, iteración por
iteración, con toda la latencia de red que eso implica. Cuando una historia toca esquema o
triggers de base de datos, iterar así se vuelve lento — ya pasó con `HU-018`.

Este documento deja el stack local reproducible, para que cualquier agente (Antigravity
incluido) o persona lo levante en un comando.

## Por qué existe esto

`vitest.config.ts` y `src/test/setup.ts` **ya** traían un cargador de variables de entorno
con precedencia `.env.local` → `.env.test` → `.env.test.local` (el último gana). Ese
mecanismo estaba listo desde antes, pero nunca se completó con un `.env.test` real
apuntando a un stack local — por eso las pruebas seguían golpeando producción aunque el
cargador ya sabía cómo evitarlo.

## Prerrequisitos

- Docker Desktop corriendo.
- CLI de Supabase (`supabase`, ya es `devDependency` del proyecto — se invoca con
  `npm run supabase:*`, no hace falta instalarlo aparte).

## Primera vez

```bash
npm run supabase:start        # levanta Postgres + Auth + Storage + Studio en Docker
npm run supabase:status       # imprime las credenciales locales (API_URL, keys, DB_URL)
cp .env.test.example .env.test
# pegar en .env.test los valores que imprimió `supabase:status`
npm run db:migrate:local      # aplica src/server/db/migrations/*.sql, en orden, contra local
```

`.env.test` es local y gitignored (`.env.test.example` es la plantilla que sí vive en el
repo). No es información sensible: son las llaves fijas que cualquier stack local de
Supabase genera igual.

## Uso diario

Con `.env.test` ya lleno, no hace falta nada más — el cargador de `vitest.config.ts` lo
toma automático:

```bash
npm run test           # corre TODA la suite contra el Postgres local (~1 min, 27 archivos)
npm run dev             # sirve la app contra el Postgres local también
npm run supabase:stop   # apaga los contenedores cuando termines
```

## Por qué no `drizzle-kit migrate`

`drizzle-kit migrate` depende de `src/server/db/migrations/meta/_journal.json` para saber
qué ya se aplicó. Ese journal quedó desincronizado en algún punto (varias migraciones se
aplicaron directo contra Supabase remoto sin pasar por `drizzle-kit`, así que nunca
quedaron en el journal) — hoy solo registra hasta la migración `0017` aunque hay `0029`
archivos. `scripts/migrate-local.mjs` no usa el journal: ejecuta cada `.sql` de
`src/server/db/migrations/` en orden alfabético, tal cual, con el driver `postgres` (ya es
dependencia del proyecto). Es el mismo efecto que tuvo aplicar esos archivos contra
producción, reproducido en local.

## Cuando se agregue una migración nueva

No hace falta ningún paso extra: `npm run db:migrate:local` vuelve a leer el directorio
completo. Si el stack local ya tiene el esquema viejo aplicado y quieres repartir desde
cero, `npx supabase db reset` reinicia el contenedor de Postgres vacío antes de
volver a correr `db:migrate:local`.
