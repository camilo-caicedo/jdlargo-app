-- Migration 0031: Assertions AI Execution ID (HU-017)

ALTER TABLE assertions ADD COLUMN IF NOT EXISTS ai_execution_id uuid REFERENCES ai_executions(id);

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
       COALESCE(OLD.ai_execution_id::text, '') <> COALESCE(NEW.ai_execution_id::text, '') OR
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
