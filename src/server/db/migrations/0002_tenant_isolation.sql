-- Helper to extract current organization id from session settings
CREATE OR REPLACE FUNCTION current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')::uuid;
$$;

GRANT EXECUTE ON FUNCTION current_org_id() TO authenticated;

-- Helper to check if caller belongs to organization (supports either explicit org setting or membership lookup)
CREATE OR REPLACE FUNCTION is_current_org(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN current_org_id() IS NOT NULL THEN current_org_id() = org_id
    ELSE is_org_member(org_id, auth.uid())
  END;
$$;

GRANT EXECUTE ON FUNCTION is_current_org(uuid) TO authenticated;

-- Update audit_log policies to enforce current_org_id when present or active membership
DROP POLICY IF EXISTS audit_log_select_policy ON public.audit_log;
CREATE POLICY audit_log_select_policy ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    is_current_org(organization_id)
  );

DROP POLICY IF EXISTS audit_log_insert_policy ON public.audit_log;
CREATE POLICY audit_log_insert_policy ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    is_current_org(organization_id)
  );
-- Force RLS on all tables so even table owners (postgres role) abide by RLS when querying without context
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;