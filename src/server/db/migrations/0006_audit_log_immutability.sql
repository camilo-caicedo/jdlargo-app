-- Migration 0006: Audit Log extension with immutability trigger (ADR-0007 & HU-006)

ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_type" text DEFAULT 'user' NOT NULL;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_details" jsonb;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "entity" text;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "entity_id" text;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "request_origin" jsonb;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "previous_value" jsonb;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "new_value" jsonb;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "reason" text;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "source" text;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "automatic" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "ai_model" jsonb;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "configuration_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "event_hash" text;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_configuration_version_id_configuration_versions_id_fk'
  ) THEN
    ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_configuration_version_id_configuration_versions_id_fk"
      FOREIGN KEY ("configuration_version_id") REFERENCES "public"."configuration_versions"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

-- Immutability trigger: ADR-0007 & HU-006
-- Audit log is append-only. UPDATE and DELETE are strictly forbidden.
CREATE OR REPLACE FUNCTION trg_prevent_audit_log_modification_func()
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
    RAISE EXCEPTION 'Audit log is strictly immutable: DELETE operation is forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Audit log is strictly immutable: UPDATE operation is forbidden';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_prevent_audit_log_tampering ON public.audit_log;
CREATE TRIGGER trg_prevent_audit_log_tampering
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_audit_log_modification_func();
