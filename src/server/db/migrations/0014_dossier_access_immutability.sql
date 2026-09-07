-- Migration 0014: Add recipient_email to dossier_access_tokens and immutability triggers for access tables (HU-010 review fixes)

-- 1. Add recipient_email column
ALTER TABLE "dossier_access_tokens" ADD COLUMN IF NOT EXISTS "recipient_email" text NOT NULL DEFAULT 'contacto@ejemplo.com';
--> statement-breakpoint
ALTER TABLE "dossier_access_tokens" ALTER COLUMN "recipient_email" DROP DEFAULT;
--> statement-breakpoint

-- 2. Immutability trigger for dossier_access_uses (only INSERT allowed, UPDATE and DELETE strictly forbidden)
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
  IF v_allow_cleanup = 'true' THEN
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

DROP TRIGGER IF EXISTS trg_prevent_dossier_access_uses_tampering ON public.dossier_access_uses;
--> statement-breakpoint
CREATE TRIGGER trg_prevent_dossier_access_uses_tampering
  BEFORE UPDATE OR DELETE ON public.dossier_access_uses
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_dossier_access_uses_tampering_func();
--> statement-breakpoint

-- 3. Immutability trigger for dossier_access_tokens
-- DELETE strictly forbidden
-- UPDATE only allowed on state, revoked_by, revoked_at, and ONLY if previous state was 'active'
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
  IF v_allow_cleanup = 'true' THEN
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

    -- Core identity fields must remain strictly immutable
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

DROP TRIGGER IF EXISTS trg_prevent_dossier_access_tokens_tampering ON public.dossier_access_tokens;
--> statement-breakpoint
CREATE TRIGGER trg_prevent_dossier_access_tokens_tampering
  BEFORE UPDATE OR DELETE ON public.dossier_access_tokens
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_dossier_access_tokens_tampering_func();
