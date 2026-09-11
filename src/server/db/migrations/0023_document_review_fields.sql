-- Migration 0023: document review fields and transition (HU-014)

-- 1. Add review columns to documents
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid REFERENCES public.users(id);
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 2. Update tampering trigger function to allow updating review fields alongside state
CREATE OR REPLACE FUNCTION trg_prevent_documents_tampering_func()
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
    RAISE EXCEPTION 'documents entries are immutable evidence: deleting is strictly forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Only state, reviewed_by_user_id, reviewed_at, and rejection_reason can be updated
    IF OLD.id <> NEW.id OR
       OLD.organization_id <> NEW.organization_id OR
       OLD.dossier_id <> NEW.dossier_id OR
       OLD.document_type <> NEW.document_type OR
       OLD.version <> NEW.version OR
       OLD.storage_path <> NEW.storage_path OR
       OLD.hash <> NEW.hash OR
       OLD.size <> NEW.size OR
       OLD.format <> NEW.format OR
       OLD.uploaded_by_type <> NEW.uploaded_by_type OR
       COALESCE(OLD.uploaded_by_user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(NEW.uploaded_by_user_id, '00000000-0000-0000-0000-000000000000'::uuid) OR
       OLD.created_at <> NEW.created_at THEN
      RAISE EXCEPTION 'Cannot modify document evidence fields: documents are append-only (only state and review metadata may be modified)';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$func$;

-- 3. Seed valid_transition: en_revision -> en_diligenciamiento (dossier:review, requires reason)
INSERT INTO public.valid_transitions ("source", "target", "permission", "requires_reason") VALUES
  ('en_revision', 'en_diligenciamiento', 'dossier:review', true)
ON CONFLICT ("source", "target") DO NOTHING;
