-- Migration 0015: Invitations table, RLS policies, permissions and immutability triggers (HU-056)

CREATE TABLE IF NOT EXISTS "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"invited_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk"
    FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "invitations" ADD CONSTRAINT "invitations_revoked_by_users_id_fk"
    FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "invitations_token_hash_unique" ON "invitations" USING btree ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_org_email_pending_unique" ON "invitations" USING btree ("organization_id", "email") WHERE state = 'pending';
--> statement-breakpoint

-- Grants
GRANT SELECT, INSERT, UPDATE ON TABLE "invitations" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "invitations" TO service_role;
--> statement-breakpoint

-- RLS Policies
DROP POLICY IF EXISTS "invitations_select_policy" ON "invitations";
--> statement-breakpoint
CREATE POLICY "invitations_select_policy" ON "invitations"
  AS PERMISSIVE FOR SELECT
  TO authenticated
  USING (is_current_org(organization_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "invitations_insert_policy" ON "invitations";
--> statement-breakpoint
CREATE POLICY "invitations_insert_policy" ON "invitations"
  AS PERMISSIVE FOR INSERT
  TO authenticated
  WITH CHECK (is_current_org(organization_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "invitations_update_policy" ON "invitations";
--> statement-breakpoint
CREATE POLICY "invitations_update_policy" ON "invitations"
  AS PERMISSIVE FOR UPDATE
  TO authenticated
  USING (is_current_org(organization_id))
  WITH CHECK (is_current_org(organization_id));
--> statement-breakpoint

-- Immutability Trigger
-- DELETE strictly forbidden
-- UPDATE only allowed on state, accepted_at, revoked_by, revoked_at, and ONLY if previous state was 'pending'
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
  IF v_allow_cleanup = 'true' THEN
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

    -- Core identity fields must remain strictly immutable
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

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$func$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_prevent_invitations_tampering ON public.invitations;
--> statement-breakpoint
CREATE TRIGGER trg_prevent_invitations_tampering
  BEFORE UPDATE OR DELETE ON public.invitations
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_invitations_tampering_func();