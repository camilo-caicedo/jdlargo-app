# Server Architecture & Domain Modules

This folder contains the server-side modules and database access logic for Plataforma JD Largo.

For domain definitions, module responsibilities, and architecture principles, refer to:
[arquitectura-de-aplicacion.md](../../../jdlargo-specs/08-desarrollo/arquitectura-de-aplicacion.md)

## Core Principles:
- Domain modules live under src/server/<module>/ (named strictly in English).
- Server Actions must be lightweight orchestration layers (<= 20 lines) delegating business logic to domain functions.
- Database access occurs solely via src/server/db/client.ts (application/pooler) and src/server/db/admin-client.ts (direct/admin).
