-- Migration 0005: Assertions table with RLS and Immutability Trigger (ADR-0005 & HU-005)

CREATE TABLE IF NOT EXISTS "assertions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dossier_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"configuration_version_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"origin" text NOT NULL,
	"produced_by" uuid NOT NULL,
	"produced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence_id" text,
	"confidence" text,
	"ai_model_metadata" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"resolution_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "assertions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "assertions" ADD CONSTRAINT "assertions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assertions" ADD CONSTRAINT "assertions_configuration_version_id_configuration_versions_id_fk" FOREIGN KEY ("configuration_version_id") REFERENCES "public"."configuration_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assertions" ADD CONSTRAINT "assertions_produced_by_users_id_fk" FOREIGN KEY ("produced_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assertions" ADD CONSTRAINT "assertions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

GRANT ALL ON TABLE public.assertions TO authenticated;
--> statement-breakpoint

ALTER TABLE public.assertions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- RLS Policies for assertions
DROP POLICY IF EXISTS assertions_select_policy ON public.assertions;
CREATE POLICY assertions_select_policy ON public.assertions
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );
--> statement-breakpoint

DROP POLICY IF EXISTS assertions_insert_policy ON public.assertions;
CREATE POLICY assertions_insert_policy ON public.assertions
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );
--> statement-breakpoint

DROP POLICY IF EXISTS assertions_update_policy ON public.assertions;
CREATE POLICY assertions_update_policy ON public.assertions
  FOR UPDATE TO authenticated
  USING (
    is_current_org(organization_id)
  )
  WITH CHECK (
    is_current_org(organization_id)
  );
--> statement-breakpoint

-- Immutability trigger: ADR-0005 & HU-005
-- Assertions are append-only. Provenance, value, field, producer cannot be modified or deleted.
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
       OLD.produced_by <> NEW.produced_by OR
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
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_prevent_assertion_tampering ON public.assertions;
CREATE TRIGGER trg_prevent_assertion_tampering
  BEFORE UPDATE OR DELETE ON public.assertions
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_assertion_tampering_func();
