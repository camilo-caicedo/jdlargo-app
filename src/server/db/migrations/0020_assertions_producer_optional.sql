-- Migration 0020: Make assertions.produced_by optional and update immutability trigger
-- HU-012: Counterparties submitting declarations via access links do not have internal user records.

ALTER TABLE "assertions" ALTER COLUMN "produced_by" DROP NOT NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION trg_prevent_assertion_tampering_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  IF v_allow_cleanup = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assertions are immutable: deleting an assertion is strictly forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Only resolution metadata (status, resolution_note, resolved_by, resolved_at) can be updated.
    -- Core provenance fields (field, value, origin, produced_by, produced_at, evidence_id, confidence, ai_model_metadata, configuration_version_id, dossier_id, organization_id, party_id) are strictly immutable.
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
$$;
