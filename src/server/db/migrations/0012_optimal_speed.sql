CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"identification_type" text NOT NULL,
	"identification_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "counterparty_type_id" uuid;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "standard" text;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "internal_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "dossiers" ADD COLUMN "deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parties_org_id_type_num_unique" ON "parties" USING btree ("organization_id","identification_type","identification_number");--> statement-breakpoint
ALTER TABLE "assertions" ADD CONSTRAINT "assertions_dossier_id_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossiers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assertions" ADD CONSTRAINT "assertions_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_counterparty_type_id_counterparty_types_id_fk" FOREIGN KEY ("counterparty_type_id") REFERENCES "public"."counterparty_types"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_internal_owner_id_users_id_fk" FOREIGN KEY ("internal_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "dossiers_org_code_unique" ON "dossiers" USING btree ("organization_id","code");
--> statement-breakpoint
ALTER TABLE "parties" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Grants for authenticated role
GRANT ALL ON TABLE public.parties TO authenticated;
--> statement-breakpoint

-- RLS Policies: parties (select, insert)
DROP POLICY IF EXISTS parties_select_policy ON public.parties;
--> statement-breakpoint
CREATE POLICY parties_select_policy ON public.parties
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );
--> statement-breakpoint

DROP POLICY IF EXISTS parties_insert_policy ON public.parties;
--> statement-breakpoint
CREATE POLICY parties_insert_policy ON public.parties
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );