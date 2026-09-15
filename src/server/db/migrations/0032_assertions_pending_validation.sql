-- Migration 0032: Assertions pending_validation status and human validation metadata (HU-020)
--
-- 1. Extend assertions.status to include 'pending_validation'
-- Assertions produced by AI start with pending_validation status, await human confirmation
-- Update default check constraint to allow the new status value
--
ALTER TABLE assertions ADD COLUMN status_new text DEFAULT 'active';
UPDATE assertions SET status_new = status;
ALTER TABLE assertions DROP COLUMN status;
ALTER TABLE assertions RENAME COLUMN status_new TO status;
ALTER TABLE assertions ADD CONSTRAINT assertions_status_check CHECK (status IN ('pending_validation', 'active', 'discarded'));

--> statement-breakpoint

-- 2. Add validation metadata columns (who validated, when)
-- Parallel to resolution_note/resolved_by/resolved_at (used for discarding)
-- validatedBy: user who confirmed the extracted assertion
-- validatedAt: timestamp of confirmation
ALTER TABLE assertions ADD COLUMN validated_by uuid REFERENCES public.users(id);
ALTER TABLE assertions ADD COLUMN validated_at timestamp with time zone;

--> statement-breakpoint

-- 2b. Restore NOT NULL constraint on status column (all existing rows have valid status now)
ALTER TABLE assertions ALTER COLUMN status SET NOT NULL;

--> statement-breakpoint

-- 3. Update immutability trigger to allow updates to validation and resolution metadata
-- Pattern: resolution_note/resolved_by/resolved_at (HU-019) + validated_by/validated_at (HU-020)
-- Both are allowed as they represent human decisions about the assertion, not the assertion itself
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
    -- Only metadata fields (status, resolution_note, resolved_by, resolved_at, validated_by, validated_at) can be updated.
    -- Core provenance fields (field, value, origin, produced_by, produced_at, evidence_id, confidence, ai_model_metadata, ai_execution_id, configuration_version_id, dossier_id, organization_id, party_id) are strictly immutable.
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
