-- Migration 0021: documents table with RLS, immutability trigger and storage bucket (HU-013)

-- 1. Create documents table
CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  dossier_id uuid NOT NULL REFERENCES public.dossiers(id),
  document_type text NOT NULL,
  version integer NOT NULL,
  storage_path text NOT NULL,
  hash text NOT NULL,
  size integer NOT NULL,
  format text NOT NULL CHECK (format IN ('pdf', 'jpg', 'png')),
  state text NOT NULL DEFAULT 'received' CHECK (state IN ('received', 'under_review', 'valid', 'requires_review', 'rejected')),
  uploaded_by_type text NOT NULL CHECK (uploaded_by_type IN ('user', 'counterparty')),
  uploaded_by_user_id uuid REFERENCES public.users(id),
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 2. Unique index (dossier_id, document_type, hash) for deduplication (RNF-025)
CREATE UNIQUE INDEX IF NOT EXISTS documents_dossier_type_hash_unique
  ON public.documents (dossier_id, document_type, hash);

CREATE INDEX IF NOT EXISTS idx_documents_org_dossier
  ON public.documents (organization_id, dossier_id);

-- 3. Enable and Force RLS
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents FORCE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.documents TO authenticated;

-- 4. RLS Policies
DROP POLICY IF EXISTS documents_select_policy ON public.documents;
CREATE POLICY documents_select_policy ON public.documents
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );

DROP POLICY IF EXISTS documents_insert_policy ON public.documents;
CREATE POLICY documents_insert_policy ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );

DROP POLICY IF EXISTS documents_update_policy ON public.documents;
CREATE POLICY documents_update_policy ON public.documents
  FOR UPDATE TO authenticated
  USING (
    is_current_org(organization_id)
  )
  WITH CHECK (
    is_current_org(organization_id)
  );

DROP POLICY IF EXISTS documents_delete_policy ON public.documents;
CREATE POLICY documents_delete_policy ON public.documents
  FOR DELETE TO authenticated
  USING (
    is_current_org(organization_id)
  );

-- 5. Immutability trigger: only state can be updated; DELETE is forbidden unless allow_config_cleanup
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
    -- Only state can be updated
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
      RAISE EXCEPTION 'Cannot modify document evidence fields: documents are append-only (only state may be transitioned)';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_prevent_documents_tampering ON public.documents;
CREATE TRIGGER trg_prevent_documents_tampering
  BEFORE UPDATE OR DELETE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION trg_prevent_documents_tampering_func();

-- 6. Storage bucket 'dossier-documents' (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('dossier-documents', 'dossier-documents', false)
ON CONFLICT (id) DO NOTHING;
