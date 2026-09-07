CREATE TABLE IF NOT EXISTS "counterparty_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"configuration_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"nature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "counterparty_types" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"configuration_version_id" uuid NOT NULL,
	"counterparty_type_id" uuid NOT NULL,
	"standard" text NOT NULL,
	"type" text NOT NULL,
	"key" text NOT NULL,
	"mandatory" text NOT NULL,
	"condition" jsonb,
	"validation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requirements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'counterparty_types_organization_id_organizations_id_fk'
  ) THEN
    ALTER TABLE "counterparty_types" ADD CONSTRAINT "counterparty_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'counterparty_types_configuration_version_id_configuration_versions_id_fk'
  ) THEN
    ALTER TABLE "counterparty_types" ADD CONSTRAINT "counterparty_types_configuration_version_id_configuration_versions_id_fk" FOREIGN KEY ("configuration_version_id") REFERENCES "public"."configuration_versions"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'requirements_organization_id_organizations_id_fk'
  ) THEN
    ALTER TABLE "requirements" ADD CONSTRAINT "requirements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'requirements_configuration_version_id_configuration_versions_id_fk'
  ) THEN
    ALTER TABLE "requirements" ADD CONSTRAINT "requirements_configuration_version_id_configuration_versions_id_fk" FOREIGN KEY ("configuration_version_id") REFERENCES "public"."configuration_versions"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'requirements_counterparty_type_id_counterparty_types_id_fk'
  ) THEN
    ALTER TABLE "requirements" ADD CONSTRAINT "requirements_counterparty_type_id_counterparty_types_id_fk" FOREIGN KEY ("counterparty_type_id") REFERENCES "public"."counterparty_types"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "counterparty_types_org_ver_name_unique" ON "counterparty_types" USING btree ("organization_id","configuration_version_id","name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "requirements_org_ver_type_std_key_unique" ON "requirements" USING btree ("organization_id","configuration_version_id","counterparty_type_id","standard","type","key");
--> statement-breakpoint

-- Grants for authenticated role
GRANT ALL ON TABLE public.counterparty_types TO authenticated;
--> statement-breakpoint
GRANT ALL ON TABLE public.requirements TO authenticated;
--> statement-breakpoint

-- Force RLS on both tables
ALTER TABLE public.counterparty_types FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.requirements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- RLS Policies: counterparty_types (select, insert, delete)
DROP POLICY IF EXISTS counterparty_types_select_policy ON public.counterparty_types;
--> statement-breakpoint
CREATE POLICY counterparty_types_select_policy ON public.counterparty_types
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );
--> statement-breakpoint

DROP POLICY IF EXISTS counterparty_types_insert_policy ON public.counterparty_types;
--> statement-breakpoint
CREATE POLICY counterparty_types_insert_policy ON public.counterparty_types
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );
--> statement-breakpoint

DROP POLICY IF EXISTS counterparty_types_delete_policy ON public.counterparty_types;
--> statement-breakpoint
CREATE POLICY counterparty_types_delete_policy ON public.counterparty_types
  FOR DELETE TO authenticated
  USING (
    is_current_org(organization_id)
  );
--> statement-breakpoint

-- RLS Policies: requirements (select, insert, delete)
DROP POLICY IF EXISTS requirements_select_policy ON public.requirements;
--> statement-breakpoint
CREATE POLICY requirements_select_policy ON public.requirements
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );
--> statement-breakpoint

DROP POLICY IF EXISTS requirements_insert_policy ON public.requirements;
--> statement-breakpoint
CREATE POLICY requirements_insert_policy ON public.requirements
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );
--> statement-breakpoint

DROP POLICY IF EXISTS requirements_delete_policy ON public.requirements;
--> statement-breakpoint
CREATE POLICY requirements_delete_policy ON public.requirements
  FOR DELETE TO authenticated
  USING (
    is_current_org(organization_id)
  );
--> statement-breakpoint

-- Immutability triggers: ADR-0004 & HU-004 & HU-007
DROP TRIGGER IF EXISTS trg_prevent_counterparty_types_edit ON public.counterparty_types;
--> statement-breakpoint
CREATE TRIGGER trg_prevent_counterparty_types_edit
  BEFORE UPDATE OR DELETE ON public.counterparty_types
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_published_config_modification_func();
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_prevent_requirements_edit ON public.requirements;
--> statement-breakpoint
CREATE TRIGGER trg_prevent_requirements_edit
  BEFORE UPDATE OR DELETE ON public.requirements
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_published_config_modification_func();