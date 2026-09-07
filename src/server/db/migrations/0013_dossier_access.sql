CREATE TABLE "dossier_access_otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dossier_id" uuid NOT NULL,
	"access_token_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dossier_access_otp_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dossier_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dossier_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"requires_second_factor" boolean DEFAULT false NOT NULL,
	"issued_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "dossier_access_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dossier_access_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dossier_id" uuid NOT NULL,
	"access_token_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text NOT NULL,
	"user_agent" text NOT NULL,
	"result" text NOT NULL,
	"denial_reason" text
);
--> statement-breakpoint
ALTER TABLE "dossier_access_uses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dossier_access_otp_codes" ADD CONSTRAINT "dossier_access_otp_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_access_otp_codes" ADD CONSTRAINT "dossier_access_otp_codes_dossier_id_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_access_otp_codes" ADD CONSTRAINT "dossier_access_otp_codes_access_token_id_dossier_access_tokens_id_fk" FOREIGN KEY ("access_token_id") REFERENCES "public"."dossier_access_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_access_tokens" ADD CONSTRAINT "dossier_access_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_access_tokens" ADD CONSTRAINT "dossier_access_tokens_dossier_id_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_access_tokens" ADD CONSTRAINT "dossier_access_tokens_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_access_tokens" ADD CONSTRAINT "dossier_access_tokens_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_access_uses" ADD CONSTRAINT "dossier_access_uses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_access_uses" ADD CONSTRAINT "dossier_access_uses_dossier_id_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_access_uses" ADD CONSTRAINT "dossier_access_uses_access_token_id_dossier_access_tokens_id_fk" FOREIGN KEY ("access_token_id") REFERENCES "public"."dossier_access_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dossier_access_tokens_hash_unique" ON "dossier_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "dossier_access_tokens_dossier_active_unique" ON "dossier_access_tokens" USING btree ("dossier_id") WHERE state = 'active';--> statement-breakpoint

ALTER TABLE "dossier_access_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dossier_access_uses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dossier_access_otp_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Grants for authenticated role
GRANT ALL ON TABLE public.dossier_access_tokens TO authenticated;--> statement-breakpoint
GRANT ALL ON TABLE public.dossier_access_uses TO authenticated;--> statement-breakpoint
GRANT ALL ON TABLE public.dossier_access_otp_codes TO authenticated;--> statement-breakpoint

-- RLS Policies: dossier_access_tokens (select, insert, update)
DROP POLICY IF EXISTS dossier_access_tokens_select_policy ON public.dossier_access_tokens;--> statement-breakpoint
CREATE POLICY dossier_access_tokens_select_policy ON public.dossier_access_tokens
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );--> statement-breakpoint

DROP POLICY IF EXISTS dossier_access_tokens_insert_policy ON public.dossier_access_tokens;--> statement-breakpoint
CREATE POLICY dossier_access_tokens_insert_policy ON public.dossier_access_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );--> statement-breakpoint

DROP POLICY IF EXISTS dossier_access_tokens_update_policy ON public.dossier_access_tokens;--> statement-breakpoint
CREATE POLICY dossier_access_tokens_update_policy ON public.dossier_access_tokens
  FOR UPDATE TO authenticated
  USING (
    is_current_org(organization_id)
  )
  WITH CHECK (
    is_current_org(organization_id)
  );--> statement-breakpoint

-- RLS Policies: dossier_access_uses (select, insert)
DROP POLICY IF EXISTS dossier_access_uses_select_policy ON public.dossier_access_uses;--> statement-breakpoint
CREATE POLICY dossier_access_uses_select_policy ON public.dossier_access_uses
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );--> statement-breakpoint

DROP POLICY IF EXISTS dossier_access_uses_insert_policy ON public.dossier_access_uses;--> statement-breakpoint
CREATE POLICY dossier_access_uses_insert_policy ON public.dossier_access_uses
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );--> statement-breakpoint

-- RLS Policies: dossier_access_otp_codes (select, insert)
DROP POLICY IF EXISTS dossier_access_otp_codes_select_policy ON public.dossier_access_otp_codes;--> statement-breakpoint
CREATE POLICY dossier_access_otp_codes_select_policy ON public.dossier_access_otp_codes
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );--> statement-breakpoint

DROP POLICY IF EXISTS dossier_access_otp_codes_insert_policy ON public.dossier_access_otp_codes;--> statement-breakpoint
CREATE POLICY dossier_access_otp_codes_insert_policy ON public.dossier_access_otp_codes
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );