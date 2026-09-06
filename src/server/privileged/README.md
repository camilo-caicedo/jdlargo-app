# Privileged System Operations Module

> ⚠️ **CRITICAL SECURITY BOUNDARY (`ADR-0001`, `ADR-0007`, `HU-002`)**
>
> This module encapsulates operations executed by the automated system, background jobs,
> data migrations, and system reconciliations that require elevated privileges or bypass RLS.
>
> Rules:
> 1. **No User Path Allowed:** No controller, Server Action, or Route Handler handling user requests may import or invoke this module directly.
> 2. **Mandatory Audit Logging:** Every privileged operation MUST write an entry to `public.audit_log` with `actor_user_id = null` and `origin = { actor: "system" }` within the same transaction.
> 3. **Isolated Direct Connection:** Only this module accesses `adminDb` and `adminSqlClient` (`DIRECT_URL`).