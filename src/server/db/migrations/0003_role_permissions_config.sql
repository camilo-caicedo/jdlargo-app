CREATE TABLE "configuration_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"version_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "configuration_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"configuration_version_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"configuration_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "configuration_versions" ADD CONSTRAINT "configuration_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_versions" ADD CONSTRAINT "configuration_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_configuration_version_id_configuration_versions_id_fk" FOREIGN KEY ("configuration_version_id") REFERENCES "public"."configuration_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_configuration_version_id_configuration_versions_id_fk" FOREIGN KEY ("configuration_version_id") REFERENCES "public"."configuration_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "config_versions_org_num_unique" ON "configuration_versions" USING btree ("organization_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_unique" ON "role_permissions" USING btree ("role_id","permission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_version_code_unique" ON "roles" USING btree ("organization_id","configuration_version_id","code");--> statement-breakpoint

-- Grants for authenticated role
GRANT ALL ON TABLE public.configuration_versions TO authenticated;--> statement-breakpoint
GRANT ALL ON TABLE public.roles TO authenticated;--> statement-breakpoint
GRANT ALL ON TABLE public.role_permissions TO authenticated;--> statement-breakpoint

-- Force RLS on all 3 tables
ALTER TABLE public.configuration_versions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.roles FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.role_permissions FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- RLS Policies: configuration_versions
DROP POLICY IF EXISTS config_versions_select_policy ON public.configuration_versions;--> statement-breakpoint
CREATE POLICY config_versions_select_policy ON public.configuration_versions
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );--> statement-breakpoint

DROP POLICY IF EXISTS config_versions_insert_policy ON public.configuration_versions;--> statement-breakpoint
CREATE POLICY config_versions_insert_policy ON public.configuration_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );--> statement-breakpoint

DROP POLICY IF EXISTS config_versions_update_policy ON public.configuration_versions;--> statement-breakpoint
CREATE POLICY config_versions_update_policy ON public.configuration_versions
  FOR UPDATE TO authenticated
  USING (
    is_current_org(organization_id)
  );--> statement-breakpoint

-- RLS Policies: roles
DROP POLICY IF EXISTS roles_select_policy ON public.roles;--> statement-breakpoint
CREATE POLICY roles_select_policy ON public.roles
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );--> statement-breakpoint

DROP POLICY IF EXISTS roles_insert_policy ON public.roles;--> statement-breakpoint
CREATE POLICY roles_insert_policy ON public.roles
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );--> statement-breakpoint

DROP POLICY IF EXISTS roles_update_policy ON public.roles;--> statement-breakpoint
CREATE POLICY roles_update_policy ON public.roles
  FOR UPDATE TO authenticated
  USING (
    is_current_org(organization_id)
  );--> statement-breakpoint

DROP POLICY IF EXISTS roles_delete_policy ON public.roles;--> statement-breakpoint
CREATE POLICY roles_delete_policy ON public.roles
  FOR DELETE TO authenticated
  USING (
    is_current_org(organization_id)
  );--> statement-breakpoint

-- RLS Policies: role_permissions
DROP POLICY IF EXISTS role_permissions_select_policy ON public.role_permissions;--> statement-breakpoint
CREATE POLICY role_permissions_select_policy ON public.role_permissions
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );--> statement-breakpoint

DROP POLICY IF EXISTS role_permissions_insert_policy ON public.role_permissions;--> statement-breakpoint
CREATE POLICY role_permissions_insert_policy ON public.role_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );--> statement-breakpoint

DROP POLICY IF EXISTS role_permissions_delete_policy ON public.role_permissions;--> statement-breakpoint
CREATE POLICY role_permissions_delete_policy ON public.role_permissions
  FOR DELETE TO authenticated
  USING (
    is_current_org(organization_id)
  );--> statement-breakpoint

-- Immutability trigger: ADR-0004 & HU-004
-- Published and replaced configuration versions cannot be edited or deleted
CREATE OR REPLACE FUNCTION trg_prevent_published_config_modification_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_version_id uuid;
  v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  IF v_allow_cleanup = 'true' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'configuration_versions' THEN
    v_status := OLD.status;
    IF TG_OP = 'DELETE' AND (v_status = 'published' OR v_status = 'replaced') THEN
      RAISE EXCEPTION 'Cannot delete published or replaced configuration version';
    END IF;
    -- Updating status from published to replaced is allowed; modifying published content is forbidden
    IF TG_OP = 'UPDATE' AND OLD.status = 'published' AND NEW.status = 'published' THEN
      RAISE EXCEPTION 'Cannot modify published configuration version';
    END IF;
    RETURN NEW;
  END IF;

  -- For roles and role_permissions, check parent configuration_version status
  v_version_id := OLD.configuration_version_id;
  SELECT status INTO v_status FROM public.configuration_versions WHERE id = v_version_id;
  
  IF v_status = 'published' OR v_status = 'replaced' THEN
    RAISE EXCEPTION 'Cannot modify or delete items in published or replaced configuration version';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_prevent_config_version_edit ON public.configuration_versions;--> statement-breakpoint
CREATE TRIGGER trg_prevent_config_version_edit
  BEFORE UPDATE OR DELETE ON public.configuration_versions
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_published_config_modification_func();--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_prevent_roles_edit ON public.roles;--> statement-breakpoint
CREATE TRIGGER trg_prevent_roles_edit
  BEFORE UPDATE OR DELETE ON public.roles
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_published_config_modification_func();--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_prevent_role_perms_edit ON public.role_permissions;--> statement-breakpoint
CREATE TRIGGER trg_prevent_role_perms_edit
  BEFORE UPDATE OR DELETE ON public.role_permissions
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_published_config_modification_func();