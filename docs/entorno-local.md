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

## Antivirus local (ClamAV, HU-013)

`src/lib/antivirus.ts` escanea todo documento subido antes de aceptarlo, y **falla cerrado**
si `CLAMAV_HOST` no está configurado — sin eso, subir cualquier archivo revienta con
`Antivirus no configurado: falta CLAMAV_HOST`. Hay una salida explícita para desarrollo sin
un ClamAV real (`SKIP_ANTIVIRUS_SCAN=true`), pero eso nunca escanea de verdad — no sirve para
probar el flujo completo de HU-013 (detección real de un archivo malicioso).

Para tener un ClamAV real local, no hace falta instalar nada en el sistema — un contenedor
Docker basta (mismo Docker/colima que ya usa el stack de Supabase):

```bash
docker run -d --name clamav -p 3310:3310 clamav/clamav:stable
```

La primera vez, el contenedor descarga las firmas de virus (`freshclam`) antes de que `clamd`
acepte conexiones — pesa varios cientos de MB y puede tardar unos minutos. `docker logs -f
clamav` para ver cuándo terminó.

Con el contenedor arriba, en `.env.local` (para `npm run dev`) y/o `.env.test` (para
`npm run test`):

```bash
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
```

Y quitar `SKIP_ANTIVIRUS_SCAN` de ese mismo archivo — con `CLAMAV_HOST` configurado, el
código lo usa en vez del bypass. Para probar que detecta algo de verdad, el archivo de
prueba estándar de la industria es [EICAR](https://www.eicar.org/download-anti-malware-testfile/)
— no es un virus real, pero todo antivirus (incluido ClamAV) lo marca como infectado a
propósito, así se puede probar el camino "documento infectado rechazado" sin manipular
malware real.

`docker stop clamav && docker rm clamav` para bajarlo cuando no se necesite (consume RAM en
reposo por las firmas cargadas en memoria).
