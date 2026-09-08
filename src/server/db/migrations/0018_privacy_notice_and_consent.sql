-- Migration 0018: Privacy Notice and Consent (HU-011)

-- 1. Create privacy_notices table
CREATE TABLE IF NOT EXISTS "privacy_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"configuration_version_id" uuid NOT NULL,
	"text" text NOT NULL,
	"purposes" jsonb NOT NULL,
	"data_controller" text NOT NULL,
	"data_processor" text NOT NULL,
	"rights_channels" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "privacy_notices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD CONSTRAINT "privacy_notices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD CONSTRAINT "privacy_notices_configuration_version_id_configuration_versions_id_fk" FOREIGN KEY ("configuration_version_id") REFERENCES "public"."configuration_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "privacy_notices_org_version_unique" ON "privacy_notices" USING btree ("organization_id", "configuration_version_id");
--> statement-breakpoint
ALTER TABLE "privacy_notices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2. Create consents table
CREATE TABLE IF NOT EXISTS "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dossier_id" uuid NOT NULL,
	"privacy_notice_id" uuid NOT NULL,
	"privacy_notice_text_snapshot" text NOT NULL,
	"result" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text DEFAULT 'portal' NOT NULL,
	"ip_address" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_dossier_id_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossiers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_privacy_notice_id_privacy_notices_id_fk" FOREIGN KEY ("privacy_notice_id") REFERENCES "public"."privacy_notices"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "consents_dossier_unique" ON "consents" USING btree ("dossier_id");
--> statement-breakpoint
ALTER TABLE "consents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 3. Grants for authenticated role
GRANT ALL ON TABLE public.privacy_notices TO authenticated;
--> statement-breakpoint
GRANT ALL ON TABLE public.consents TO authenticated;
--> statement-breakpoint

-- 4. RLS Policies: privacy_notices
DROP POLICY IF EXISTS privacy_notices_select_policy ON public.privacy_notices;
--> statement-breakpoint
CREATE POLICY privacy_notices_select_policy ON public.privacy_notices
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );
--> statement-breakpoint
DROP POLICY IF EXISTS privacy_notices_insert_policy ON public.privacy_notices;
--> statement-breakpoint
CREATE POLICY privacy_notices_insert_policy ON public.privacy_notices
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );
--> statement-breakpoint
DROP POLICY IF EXISTS privacy_notices_update_policy ON public.privacy_notices;
--> statement-breakpoint
CREATE POLICY privacy_notices_update_policy ON public.privacy_notices
  FOR UPDATE TO authenticated
  USING (
    is_current_org(organization_id)
  )
  WITH CHECK (
    is_current_org(organization_id)
  );
--> statement-breakpoint

-- 5. RLS Policies: consents (select, insert, update, delete protected by trigger)
DROP POLICY IF EXISTS consents_select_policy ON public.consents;
--> statement-breakpoint
CREATE POLICY consents_select_policy ON public.consents
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );
--> statement-breakpoint
DROP POLICY IF EXISTS consents_insert_policy ON public.consents;
--> statement-breakpoint
CREATE POLICY consents_insert_policy ON public.consents
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );
--> statement-breakpoint
DROP POLICY IF EXISTS consents_update_policy ON public.consents;
--> statement-breakpoint
CREATE POLICY consents_update_policy ON public.consents
  FOR UPDATE TO authenticated
  USING (
    is_current_org(organization_id)
  )
  WITH CHECK (
    is_current_org(organization_id)
  );
--> statement-breakpoint
DROP POLICY IF EXISTS consents_delete_policy ON public.consents;
--> statement-breakpoint
CREATE POLICY consents_delete_policy ON public.consents
  FOR DELETE TO authenticated
  USING (
    is_current_org(organization_id)
  );
--> statement-breakpoint

-- 6. Add dossier state 'rechazada_por_contraparte' and valid transitions
INSERT INTO public.dossier_states ("key", "is_final") VALUES
  ('rechazada_por_contraparte', false)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

INSERT INTO public.valid_transitions ("source", "target", "permission", "requires_reason") VALUES
  ('en_diligenciamiento', 'rechazada_por_contraparte', 'dossier:edit', false),
  ('rechazada_por_contraparte', 'cerrada', 'dossier:edit', false)
ON CONFLICT ("source", "target") DO NOTHING;
--> statement-breakpoint

-- 7. Immutability trigger for consents table (only INSERT allowed, UPDATE and DELETE strictly forbidden)
CREATE OR REPLACE FUNCTION trg_prevent_consents_tampering_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $func$
DECLARE
  v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  IF v_allow_cleanup = 'true' AND current_user IN ('postgres', 'service_role', 'supabase_admin') AND current_user NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consents entries are immutable evidence: deleting is strictly forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'consents entries are append-only evidence: updates are strictly forbidden';
  END IF;

  RETURN NEW;
END;
$func$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_prevent_consents_tampering ON public.consents;
--> statement-breakpoint
CREATE TRIGGER trg_prevent_consents_tampering
  BEFORE UPDATE OR DELETE ON public.consents
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_consents_tampering_func();