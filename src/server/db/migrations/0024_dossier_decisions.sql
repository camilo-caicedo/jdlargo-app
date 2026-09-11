-- Migration 0024: decisions, decision_conditions and compliance_officer permission backfill (HU-015)

CREATE TABLE IF NOT EXISTS public.decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  dossier_id uuid NOT NULL REFERENCES public.dossiers(id),
  type text NOT NULL CHECK (type IN ('approve', 'approve_with_conditions', 'reject')),
  responsible_id uuid NOT NULL REFERENCES public.users(id),
  title text NOT NULL,
  made_at timestamp with time zone NOT NULL DEFAULT now(),
  rationale text NOT NULL,
  evidence jsonb NOT NULL,
  valid_until timestamp with time zone NOT NULL,
  configuration_version_id uuid NOT NULL REFERENCES public.configuration_versions(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS decisions_dossier_idx ON public.decisions(dossier_id);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.decision_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  decision_id uuid NOT NULL REFERENCES public.decisions(id),
  text text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

--> statement-breakpoint
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.decisions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.decision_conditions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.decision_conditions FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.decisions TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.decision_conditions TO authenticated;

--> statement-breakpoint
DROP POLICY IF EXISTS decisions_select_policy ON public.decisions;
--> statement-breakpoint
CREATE POLICY decisions_select_policy ON public.decisions FOR SELECT TO authenticated
  USING (is_current_org(organization_id));

--> statement-breakpoint
DROP POLICY IF EXISTS decisions_insert_policy ON public.decisions;
--> statement-breakpoint
CREATE POLICY decisions_insert_policy ON public.decisions FOR INSERT TO authenticated
  WITH CHECK (is_current_org(organization_id));

--> statement-breakpoint
DROP POLICY IF EXISTS decision_conditions_select_policy ON public.decision_conditions;
--> statement-breakpoint
CREATE POLICY decision_conditions_select_policy ON public.decision_conditions FOR SELECT TO authenticated
  USING (is_current_org(organization_id));

--> statement-breakpoint
DROP POLICY IF EXISTS decision_conditions_insert_policy ON public.decision_conditions;
--> statement-breakpoint
CREATE POLICY decision_conditions_insert_policy ON public.decision_conditions FOR INSERT TO authenticated
  WITH CHECK (is_current_org(organization_id));

--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_prevent_decisions_tampering ON public.decisions;
--> statement-breakpoint
CREATE TRIGGER trg_prevent_decisions_tampering
  BEFORE UPDATE OR DELETE ON public.decisions
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_dossier_transitions_modification_func();

--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_prevent_decision_conditions_tampering ON public.decision_conditions;
--> statement-breakpoint
CREATE TRIGGER trg_prevent_decision_conditions_tampering
  BEFORE UPDATE OR DELETE ON public.decision_conditions
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_dossier_transitions_modification_func();

--> statement-breakpoint
INSERT INTO public.role_permissions (organization_id, configuration_version_id, role_id, permission_key)
SELECT r.organization_id, r.configuration_version_id, r.id, 'dossier:edit'
FROM public.roles r
WHERE r.code = 'compliance_officer'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'dossier:edit'
  )
ON CONFLICT DO NOTHING;
