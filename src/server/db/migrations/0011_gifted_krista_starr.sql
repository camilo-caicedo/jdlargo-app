CREATE TABLE "dossier_states" (
	"key" text PRIMARY KEY NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dossier_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dossier_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"dossier_id" uuid NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"configuration_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dossier_transitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dossiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"state" text DEFAULT 'borrador' NOT NULL,
	"configuration_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dossiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "valid_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"target" text NOT NULL,
	"permission" text NOT NULL,
	"requires_reason" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "valid_transitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dossier_transitions" ADD CONSTRAINT "dossier_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_transitions" ADD CONSTRAINT "dossier_transitions_dossier_id_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_transitions" ADD CONSTRAINT "dossier_transitions_from_state_dossier_states_key_fk" FOREIGN KEY ("from_state") REFERENCES "public"."dossier_states"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_transitions" ADD CONSTRAINT "dossier_transitions_to_state_dossier_states_key_fk" FOREIGN KEY ("to_state") REFERENCES "public"."dossier_states"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_transitions" ADD CONSTRAINT "dossier_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossier_transitions" ADD CONSTRAINT "dossier_transitions_configuration_version_id_configuration_versions_id_fk" FOREIGN KEY ("configuration_version_id") REFERENCES "public"."configuration_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_state_dossier_states_key_fk" FOREIGN KEY ("state") REFERENCES "public"."dossier_states"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_configuration_version_id_configuration_versions_id_fk" FOREIGN KEY ("configuration_version_id") REFERENCES "public"."configuration_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valid_transitions" ADD CONSTRAINT "valid_transitions_source_dossier_states_key_fk" FOREIGN KEY ("source") REFERENCES "public"."dossier_states"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valid_transitions" ADD CONSTRAINT "valid_transitions_target_dossier_states_key_fk" FOREIGN KEY ("target") REFERENCES "public"."dossier_states"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valid_transitions" ADD CONSTRAINT "valid_transitions_source_target_unique" UNIQUE ("source", "target");
--> statement-breakpoint
ALTER TABLE "valid_transitions" ADD CONSTRAINT "valid_transitions_target_not_source_check" CHECK ("target" <> "source");
--> statement-breakpoint

-- Grants for authenticated role
GRANT ALL ON TABLE public.dossiers TO authenticated;
--> statement-breakpoint
GRANT ALL ON TABLE public.dossier_transitions TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.dossier_states TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.valid_transitions TO authenticated;
--> statement-breakpoint

-- Force RLS on organization domain tables
ALTER TABLE public.dossiers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.dossier_transitions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- RLS Policies: dossier_states (read-only for all authenticated)
DROP POLICY IF EXISTS dossier_states_select_policy ON public.dossier_states;
--> statement-breakpoint
CREATE POLICY dossier_states_select_policy ON public.dossier_states
  FOR SELECT TO authenticated
  USING (true);
--> statement-breakpoint

-- RLS Policies: valid_transitions (read-only for all authenticated)
DROP POLICY IF EXISTS valid_transitions_select_policy ON public.valid_transitions;
--> statement-breakpoint
CREATE POLICY valid_transitions_select_policy ON public.valid_transitions
  FOR SELECT TO authenticated
  USING (true);
--> statement-breakpoint

-- RLS Policies: dossiers (select, insert, update)
DROP POLICY IF EXISTS dossiers_select_policy ON public.dossiers;
--> statement-breakpoint
CREATE POLICY dossiers_select_policy ON public.dossiers
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );
--> statement-breakpoint

DROP POLICY IF EXISTS dossiers_insert_policy ON public.dossiers;
--> statement-breakpoint
CREATE POLICY dossiers_insert_policy ON public.dossiers
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );
--> statement-breakpoint

DROP POLICY IF EXISTS dossiers_update_policy ON public.dossiers;
--> statement-breakpoint
CREATE POLICY dossiers_update_policy ON public.dossiers
  FOR UPDATE TO authenticated
  USING (
    is_current_org(organization_id)
  )
  WITH CHECK (
    is_current_org(organization_id)
  );
--> statement-breakpoint

-- RLS Policies: dossier_transitions (select, insert only - append only)
DROP POLICY IF EXISTS dossier_transitions_select_policy ON public.dossier_transitions;
--> statement-breakpoint
CREATE POLICY dossier_transitions_select_policy ON public.dossier_transitions
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );
--> statement-breakpoint

DROP POLICY IF EXISTS dossier_transitions_insert_policy ON public.dossier_transitions;
--> statement-breakpoint
CREATE POLICY dossier_transitions_insert_policy ON public.dossier_transitions
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );
--> statement-breakpoint

-- Trigger function: Validate dossier state transition
CREATE OR REPLACE FUNCTION trg_validate_dossier_transition_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in_progress text;
  v_is_final boolean;
  v_transition_exists boolean;
BEGIN
  -- If state is not changing, allow update of other columns
  IF OLD.state = NEW.state THEN
    RETURN NEW;
  END IF;

  -- 1. Check if transition in progress session flag is set
  v_in_progress := current_setting('app.dossier_transition_in_progress', true);
  IF v_in_progress IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Direct update of dossier state is forbidden. Use state machine transition.';
  END IF;

  -- 2. Check if current state is final
  SELECT is_final INTO v_is_final FROM public.dossier_states WHERE key = OLD.state;
  IF v_is_final = true THEN
    RAISE EXCEPTION 'Cannot transition from a final state: %', OLD.state;
  END IF;

  -- 3. Check if transition is defined in valid_transitions
  SELECT EXISTS (
    SELECT 1 FROM public.valid_transitions WHERE source = OLD.state AND target = NEW.state
  ) INTO v_transition_exists;

  IF NOT v_transition_exists THEN
    RAISE EXCEPTION 'Invalid transition from % to %', OLD.state, NEW.state;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_validate_dossier_transition ON public.dossiers;
--> statement-breakpoint
CREATE TRIGGER trg_validate_dossier_transition
  BEFORE UPDATE OF state ON public.dossiers
  FOR EACH ROW
  EXECUTE FUNCTION trg_validate_dossier_transition_func();
--> statement-breakpoint

-- Trigger function: Immutability of dossier_transitions
CREATE OR REPLACE FUNCTION trg_prevent_dossier_transitions_modification_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  IF v_allow_cleanup = 'true' AND current_user IN ('postgres', 'service_role', 'supabase_admin') AND current_user NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Dossier transitions are strictly immutable: DELETE operation is forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Dossier transitions are strictly immutable: UPDATE operation is forbidden';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_prevent_dossier_transitions_tampering ON public.dossier_transitions;
--> statement-breakpoint
CREATE TRIGGER trg_prevent_dossier_transitions_tampering
  BEFORE UPDATE OR DELETE ON public.dossier_transitions
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_dossier_transitions_modification_func();
--> statement-breakpoint

-- Seed dossier_states (14 states declared for Phase 1 and future phases)
INSERT INTO public.dossier_states ("key", "is_final") VALUES
  ('borrador', false),
  ('enviada', false),
  ('en_diligenciamiento', false),
  ('documentos_recibidos', false),
  ('en_revision', false),
  ('pendiente_de_decision', false),
  ('aprobada', false),
  ('aprobada_con_condiciones', false),
  ('rechazada', false),
  ('cerrada', true),
  ('verificacion', false),
  ('screening', false),
  ('analisis_de_riesgo', false),
  ('debida_diligencia_intensificada', false)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Seed valid_transitions (11 transitions for Phase 1 main path)
INSERT INTO public.valid_transitions ("source", "target", "permission", "requires_reason") VALUES
  ('borrador', 'enviada', 'dossier:edit', false),
  ('enviada', 'en_diligenciamiento', 'dossier:edit', false),
  ('en_diligenciamiento', 'documentos_recibidos', 'dossier:edit', false),
  ('documentos_recibidos', 'en_revision', 'dossier:edit', false),
  ('en_revision', 'pendiente_de_decision', 'dossier:edit', false),
  ('pendiente_de_decision', 'aprobada', 'dossier:approve', false),
  ('pendiente_de_decision', 'aprobada_con_condiciones', 'dossier:approve', true),
  ('pendiente_de_decision', 'rechazada', 'dossier:approve', true),
  ('aprobada', 'cerrada', 'dossier:edit', false),
  ('aprobada_con_condiciones', 'cerrada', 'dossier:edit', false),
  ('rechazada', 'cerrada', 'dossier:edit', false)
ON CONFLICT ("source", "target") DO NOTHING;