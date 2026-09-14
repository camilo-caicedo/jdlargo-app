-- Migration 0029: ai_executions table with RLS, immutability trigger, and permission backfill (HU-018, §32)
--
-- 1. Create ai_executions table
CREATE TABLE IF NOT EXISTS public.ai_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  dossier_id uuid NOT NULL REFERENCES public.dossiers(id),
  document_id uuid REFERENCES public.documents(id),
  provider text NOT NULL,
  model text NOT NULL,
  model_version text NOT NULL,
  instruction_template_id text NOT NULL,
  instruction_template_version text NOT NULL,
  data_destination text NOT NULL,
  sent_fragment_hash text NOT NULL,
  sent_fragment_reference text,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  result jsonb,
  confidence text,
  failure_reason text,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL,
  validated_by uuid REFERENCES public.users(id),
  validated_at timestamp with time zone,
  final_result jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_executions_dossier_idx ON public.ai_executions(dossier_id);
CREATE INDEX IF NOT EXISTS ai_executions_org_dossier_idx ON public.ai_executions(organization_id, dossier_id);

--> statement-breakpoint
ALTER TABLE public.ai_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_executions FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
GRANT ALL ON TABLE public.ai_executions TO authenticated;

--> statement-breakpoint
DROP POLICY IF EXISTS ai_executions_select_policy ON public.ai_executions;
CREATE POLICY ai_executions_select_policy ON public.ai_executions
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );

--> statement-breakpoint
DROP POLICY IF EXISTS ai_executions_insert_policy ON public.ai_executions;
CREATE POLICY ai_executions_insert_policy ON public.ai_executions
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );

--> statement-breakpoint
DROP POLICY IF EXISTS ai_executions_update_policy ON public.ai_executions;
CREATE POLICY ai_executions_update_policy ON public.ai_executions
  FOR UPDATE TO authenticated
  USING (
    is_current_org(organization_id)
  )
  WITH CHECK (
    is_current_org(organization_id)
  );

--> statement-breakpoint
-- Immutability trigger: ADR-0005 & HU-018
-- ai_executions is append-only. Only validated_by, validated_at, and final_result can be updated (HU-020).
-- Core execution fields are strictly immutable. DELETE is strictly forbidden.
CREATE OR REPLACE FUNCTION trg_prevent_ai_execution_tampering_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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
    RAISE EXCEPTION 'ai_executions are immutable: deleting an AI execution record is strictly forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Only human validation fields (validated_by, validated_at, final_result) can be modified.
    -- Core execution provenance and output fields cannot be altered.
    IF OLD.id <> NEW.id OR
       OLD.organization_id <> NEW.organization_id OR
       OLD.dossier_id <> NEW.dossier_id OR
       COALESCE(OLD.document_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(NEW.document_id, '00000000-0000-0000-0000-000000000000'::uuid) OR
       OLD.provider <> NEW.provider OR
       OLD.model <> NEW.model OR
       OLD.model_version <> NEW.model_version OR
       OLD.instruction_template_id <> NEW.instruction_template_id OR
       OLD.instruction_template_version <> NEW.instruction_template_version OR
       OLD.data_destination <> NEW.data_destination OR
       OLD.sent_fragment_hash <> NEW.sent_fragment_hash OR
       COALESCE(OLD.sent_fragment_reference, '') <> COALESCE(NEW.sent_fragment_reference, '') OR
       OLD.status <> NEW.status OR
       COALESCE(OLD.result::text, '') <> COALESCE(NEW.result::text, '') OR
       COALESCE(OLD.confidence, '') <> COALESCE(NEW.confidence, '') OR
       COALESCE(OLD.failure_reason, '') <> COALESCE(NEW.failure_reason, '') OR
       OLD.occurred_at <> NEW.occurred_at OR
       OLD.created_at <> NEW.created_at THEN
      RAISE EXCEPTION 'Cannot modify AI execution core fields: executions are append-only (only human validation metadata may be updated)';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$func$;

--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_prevent_ai_execution_tampering ON public.ai_executions;
CREATE TRIGGER trg_prevent_ai_execution_tampering
  BEFORE UPDATE OR DELETE ON public.ai_executions
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_ai_execution_tampering_func();

--> statement-breakpoint
-- Backfill ai_execution:view permission for existing published roles (admin, compliance_officer, compliance_analyst, auditor)
INSERT INTO public.role_permissions (organization_id, configuration_version_id, role_id, permission_key)
SELECT r.organization_id, r.configuration_version_id, r.id, 'ai_execution:view'
FROM public.roles r
WHERE r.code IN ('admin', 'compliance_officer', 'compliance_analyst', 'auditor')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'ai_execution:view'
  )
ON CONFLICT DO NOTHING;
