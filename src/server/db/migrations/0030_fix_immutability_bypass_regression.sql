-- Migration 0030: Fix immutability-bypass check (security)
--
-- Auditoría 2026-09-14 (Claude Code, previo a HU-017).
--
-- Hallazgo real: `current_user` dentro de una función `SECURITY DEFINER` refleja al
-- DUEÑO de la función (aquí, `postgres`), no al rol con el que la sesión que la invocó
-- está actuando en ese momento (`SET LOCAL ROLE authenticated`, que es exactamente lo que
-- hace `withTenantContext` en cada request). Confirmado empíricamente contra el stack local
-- reproduciendo el historial real de migraciones. Consecuencia: en las seis funciones de
-- este archivo (todas `SECURITY DEFINER`), el chequeo
-- `current_user IN ('postgres','service_role','supabase_admin')` **siempre evalúa
-- verdadero** sin importar qué rol tenga activo la sesión que llama — nunca protegió nada,
-- desde que `0008`/`0009` lo introdujeron. Cualquier código que pudiera ejecutar
-- `SET LOCAL app.allow_config_cleanup = 'true'` dentro de una transacción con rol
-- `authenticated` (p. ej. `withTenantContext`) podía tocar columnas núcleo de assertions,
-- dossier_access_tokens, dossier_access_uses, ai_executions, documents e invitations.
--
-- (Las otras cuatro funciones que también leen esta bandera —audit_log, consents,
-- dossier_transitions, published_config— NO son SECURITY DEFINER, así que en ellas
-- `current_user` sí refleja el rol real de la sesión: ese chequeo ya funcionaba
-- correctamente y no se toca aquí.)
--
-- Fix: usar `current_setting('role', true)` en vez de `current_user`. A diferencia de
-- `current_user`, el GUC `role` sí sobrevive intacto el contexto SECURITY DEFINER —
-- confirmado empíricamente: dentro de la función, con la sesión en rol `authenticated`,
-- `current_setting('role', true)` devuelve `'authenticated'`; sin ningún `SET ROLE` previo,
-- devuelve `'none'`. Es la señal correcta para "esta operación está actuando como un
-- usuario final emulado (o anónimo), nunca dejar que la bandera de limpieza la bypasee".

CREATE OR REPLACE FUNCTION trg_prevent_assertion_tampering_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  IF v_allow_cleanup = 'true' AND COALESCE(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assertions are immutable: deleting an assertion is strictly forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.field <> NEW.field OR
       OLD.value::text <> NEW.value::text OR
       OLD.origin <> NEW.origin OR
       COALESCE(OLD.produced_by::text, '') <> COALESCE(NEW.produced_by::text, '') OR
       OLD.produced_at <> NEW.produced_at OR
       COALESCE(OLD.evidence_id, '') <> COALESCE(NEW.evidence_id, '') OR
       COALESCE(OLD.confidence, '') <> COALESCE(NEW.confidence, '') OR
       OLD.organization_id <> NEW.organization_id OR
       OLD.dossier_id <> NEW.dossier_id OR
       OLD.party_id <> NEW.party_id OR
       OLD.configuration_version_id <> NEW.configuration_version_id THEN
      RAISE EXCEPTION 'Cannot modify assertion provenance or value: assertions are append-only';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$func$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION trg_prevent_dossier_access_tokens_tampering_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  IF v_allow_cleanup = 'true' AND COALESCE(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'dossier_access_tokens are permanent records: deleting is strictly forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.state <> 'active' THEN
      RAISE EXCEPTION 'Cannot update token that is no longer active (current state: %)', OLD.state;
    END IF;

    IF NEW.state NOT IN ('revoked', 'replaced', 'expired') THEN
      RAISE EXCEPTION 'Invalid token state transition from % to %', OLD.state, NEW.state;
    END IF;

    IF OLD.id <> NEW.id OR
       OLD.organization_id <> NEW.organization_id OR
       OLD.dossier_id <> NEW.dossier_id OR
       OLD.token_hash <> NEW.token_hash OR
       OLD.expires_at <> NEW.expires_at OR
       OLD.requires_second_factor <> NEW.requires_second_factor OR
       OLD.recipient_email <> NEW.recipient_email OR
       OLD.issued_by <> NEW.issued_by OR
       OLD.created_at <> NEW.created_at THEN
      RAISE EXCEPTION 'Cannot modify core token fields: only state and revocation details can be updated';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$func$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION trg_prevent_dossier_access_uses_tampering_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  IF v_allow_cleanup = 'true' AND COALESCE(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'dossier_access_uses entries are immutable: deleting is strictly forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'dossier_access_uses entries are append-only: updates are strictly forbidden';
  END IF;

  RETURN NEW;
END;
$func$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION trg_prevent_ai_execution_tampering_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  IF v_allow_cleanup = 'true' AND COALESCE(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ai_executions are immutable: deleting an AI execution record is strictly forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.id <> NEW.id OR
       OLD.organization_id <> NEW.organization_id OR
       OLD.dossier_id <> NEW.dossier_id OR
       COALESCE(OLD.document_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(NEW.document_id, '00000000-0000-0000-0000-000000000000'::uuid) OR
       OLD.provider <> NEW.provider OR
       OLD.model <> NEW.model OR
       OLD.model_version <> NEW.model_version OR
       OLD.instruction_template_id <> NEW.instruction_template_id OR
       OLD.instruction_template_version <> NEW.instruction_template_version OR
       OLD.data_destination <> NEW.data_destination OR
       OLD.sent_fragment_hash <> NEW.sent_fragment_hash OR
       COALESCE(OLD.sent_fragment_reference, '') <> COALESCE(NEW.sent_fragment_reference, '') OR
       OLD.status <> NEW.status OR
       COALESCE(OLD.result::text, '') <> COALESCE(NEW.result::text, '') OR
       COALESCE(OLD.confidence, '') <> COALESCE(NEW.confidence, '') OR
       COALESCE(OLD.failure_reason, '') <> COALESCE(NEW.failure_reason, '') OR
       OLD.occurred_at <> NEW.occurred_at OR
       OLD.created_at <> NEW.created_at THEN
      RAISE EXCEPTION 'Cannot modify AI execution core fields: executions are append-only (only human validation metadata may be updated)';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$func$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION trg_prevent_documents_tampering_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  IF v_allow_cleanup = 'true' AND COALESCE(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'documents entries are immutable evidence: deleting is strictly forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.id <> NEW.id OR
       OLD.organization_id <> NEW.organization_id OR
       OLD.dossier_id <> NEW.dossier_id OR
       OLD.document_type <> NEW.document_type OR
       OLD.version <> NEW.version OR
       OLD.storage_path <> NEW.storage_path OR
       OLD.hash <> NEW.hash OR
       OLD.size <> NEW.size OR
       OLD.format <> NEW.format OR
       OLD.uploaded_by_type <> NEW.uploaded_by_type OR
       COALESCE(OLD.uploaded_by_user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(NEW.uploaded_by_user_id, '00000000-0000-0000-0000-000000000000'::uuid) OR
       OLD.created_at <> NEW.created_at THEN
      RAISE EXCEPTION 'Cannot modify document evidence fields: documents are append-only (only state and review metadata may be modified)';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$func$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION trg_prevent_invitations_tampering_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  IF v_allow_cleanup = 'true' AND COALESCE(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invitations are permanent records: deleting is strictly forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.state <> 'pending' THEN
      RAISE EXCEPTION 'Cannot update invitation that is no longer pending (current state: %)', OLD.state;
    END IF;

    IF NEW.state NOT IN ('accepted', 'revoked', 'replaced', 'expired') THEN
      RAISE EXCEPTION 'Invalid invitation state transition from % to %', OLD.state, NEW.state;
    END IF;

    IF OLD.id <> NEW.id OR
       OLD.organization_id <> NEW.organization_id OR
       OLD.email <> NEW.email OR
       OLD.role <> NEW.role OR
       OLD.token_hash <> NEW.token_hash OR
       OLD.expires_at <> NEW.expires_at OR
       OLD.invited_by <> NEW.invited_by OR
       OLD.created_at <> NEW.created_at THEN
      RAISE EXCEPTION 'Cannot modify core invitation fields: only state, acceptance and revocation details can be updated';
    END IF;

    IF NEW.state = 'accepted' THEN
      IF NEW.accepted_at IS NULL THEN
        RAISE EXCEPTION 'Transition to accepted requires accepted_at timestamp';
      END IF;
      IF NEW.revoked_by IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Transition to accepted cannot set revocation fields';
      END IF;
    ELSIF NEW.state = 'revoked' THEN
      IF NEW.revoked_at IS NULL OR NEW.revoked_by IS NULL THEN
        RAISE EXCEPTION 'Transition to revoked requires revoked_by and revoked_at';
      END IF;
      IF NEW.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Transition to revoked cannot set accepted_at';
      END IF;
    ELSIF NEW.state IN ('replaced', 'expired') THEN
      IF NEW.accepted_at IS NOT NULL OR NEW.revoked_by IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Transition to % cannot set accepted or revocation fields', NEW.state;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$func$;
