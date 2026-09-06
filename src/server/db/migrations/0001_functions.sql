-- Helper functions to prevent recursive RLS evaluation on memberships

CREATE OR REPLACE FUNCTION is_org_member(org_id uuid, u_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE organization_id = org_id
      AND user_id = u_id
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION is_org_admin(org_id uuid, u_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE organization_id = org_id
      AND user_id = u_id
      AND role = 'admin'
      AND status = 'active'
  );
$$;

GRANT EXECUTE ON FUNCTION is_org_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_admin(uuid, uuid) TO authenticated;

-- Update memberships policies to use the SECURITY DEFINER functions
DROP POLICY IF EXISTS memberships_select_policy ON public.memberships;
CREATE POLICY memberships_select_policy ON public.memberships
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR is_org_member(organization_id, auth.uid())
  );

DROP POLICY IF EXISTS memberships_insert_policy ON public.memberships;
CREATE POLICY memberships_insert_policy ON public.memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    is_org_admin(organization_id, auth.uid())
  );

DROP POLICY IF EXISTS memberships_update_policy ON public.memberships;
CREATE POLICY memberships_update_policy ON public.memberships
  FOR UPDATE TO authenticated
  USING (
    is_org_admin(organization_id, auth.uid())
  );

-- Update organizations policies
DROP POLICY IF EXISTS organizations_select_policy ON public.organizations;
CREATE POLICY organizations_select_policy ON public.organizations
  FOR SELECT TO authenticated
  USING (
    is_org_member(id, auth.uid())
  );

DROP POLICY IF EXISTS organizations_update_policy ON public.organizations;
CREATE POLICY organizations_update_policy ON public.organizations
  FOR UPDATE TO authenticated
  USING (
    is_org_admin(id, auth.uid())
  );

-- Update audit_log policies
DROP POLICY IF EXISTS audit_log_select_policy ON public.audit_log;
CREATE POLICY audit_log_select_policy ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    is_org_member(organization_id, auth.uid())
  );

DROP POLICY IF EXISTS audit_log_insert_policy ON public.audit_log;
CREATE POLICY audit_log_insert_policy ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    is_org_member(organization_id, auth.uid())
  );

-- 1. Grants for authenticated role
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.organizations TO authenticated;
GRANT ALL ON TABLE public.memberships TO authenticated;
GRANT ALL ON TABLE public.audit_log TO authenticated;

-- 2. RLS Policies

-- USERS
DROP POLICY IF EXISTS users_select_policy ON public.users;
CREATE POLICY users_select_policy ON public.users
  FOR SELECT TO authenticated
  USING (
    id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.memberships m1
      JOIN public.memberships m2 ON m1.organization_id = m2.organization_id
      WHERE m1.user_id = auth.uid()
        AND m1.status = 'active'
        AND m2.user_id = public.users.id
        AND m2.status = 'active'
    )
  );

-- ORGANIZATIONS
DROP POLICY IF EXISTS organizations_select_policy ON public.organizations;
CREATE POLICY organizations_select_policy ON public.organizations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships
      WHERE memberships.organization_id = public.organizations.id
        AND memberships.user_id = auth.uid()
        AND memberships.status = 'active'
    )
  );

DROP POLICY IF EXISTS organizations_update_policy ON public.organizations;
CREATE POLICY organizations_update_policy ON public.organizations
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships
      WHERE memberships.organization_id = public.organizations.id
        AND memberships.user_id = auth.uid()
        AND memberships.role = 'admin'
        AND memberships.status = 'active'
    )
  );

-- MEMBERSHIPS
DROP POLICY IF EXISTS memberships_select_policy ON public.memberships;
CREATE POLICY memberships_select_policy ON public.memberships
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships my_m
      WHERE my_m.organization_id = public.memberships.organization_id
        AND my_m.user_id = auth.uid()
        AND my_m.status = 'active'
    )
  );

DROP POLICY IF EXISTS memberships_insert_policy ON public.memberships;
CREATE POLICY memberships_insert_policy ON public.memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.memberships my_m
      WHERE my_m.organization_id = public.memberships.organization_id
        AND my_m.user_id = auth.uid()
        AND my_m.role = 'admin'
        AND my_m.status = 'active'
    )
  );

DROP POLICY IF EXISTS memberships_update_policy ON public.memberships;
CREATE POLICY memberships_update_policy ON public.memberships
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships my_m
      WHERE my_m.organization_id = public.memberships.organization_id
        AND my_m.user_id = auth.uid()
        AND my_m.role = 'admin'
        AND my_m.status = 'active'
    )
  );

-- AUDIT LOG
DROP POLICY IF EXISTS audit_log_select_policy ON public.audit_log;
CREATE POLICY audit_log_select_policy ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships
      WHERE memberships.organization_id = public.audit_log.organization_id
        AND memberships.user_id = auth.uid()
        AND memberships.status = 'active'
    )
  );

DROP POLICY IF EXISTS audit_log_insert_policy ON public.audit_log;
CREATE POLICY audit_log_insert_policy ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.memberships
      WHERE memberships.organization_id = public.audit_log.organization_id
        AND memberships.user_id = auth.uid()
        AND memberships.status = 'active'
    )
  );

-- 3. Security Definer Function: create_organization_with_admin
CREATE OR REPLACE FUNCTION create_organization_with_admin(
  p_name text,
  p_tax_id text,
  p_origin jsonb
) RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org public.organizations;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'create_organization_with_admin requires an authenticated caller';
  END IF;

  INSERT INTO public.organizations (name, tax_id)
  VALUES (p_name, p_tax_id)
  RETURNING * INTO v_org;

  INSERT INTO public.memberships (organization_id, user_id, role, status)
  VALUES (v_org.id, v_user_id, 'admin', 'active');

  INSERT INTO public.audit_log (organization_id, actor_user_id, action, metadata, origin)
  VALUES (v_org.id, v_user_id, 'organization.created', jsonb_build_object('name', p_name), p_origin);

  RETURN v_org;
END;
$$;

GRANT EXECUTE ON FUNCTION create_organization_with_admin(text, text, jsonb) TO authenticated;

-- 4. Triggers

-- 4.1 Prevent removing the last admin
CREATE OR REPLACE FUNCTION check_last_admin_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining_admins int;
BEGIN
  IF (OLD.role = 'admin' AND OLD.status = 'active') AND
     (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND (NEW.status <> 'active' OR NEW.role <> 'admin'))) THEN
    
    SELECT COUNT(*) INTO v_remaining_admins
    FROM public.memberships
    WHERE organization_id = OLD.organization_id
      AND role = 'admin'
      AND status = 'active'
      AND id <> OLD.id;

    IF v_remaining_admins = 0 THEN
      RAISE EXCEPTION 'Cannot revoke or delete the last active administrator of the organization';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_removing_last_admin ON public.memberships;
CREATE TRIGGER trg_prevent_removing_last_admin
  BEFORE UPDATE OR DELETE ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION check_last_admin_membership();

-- 4.2 Log membership revocation
CREATE OR REPLACE FUNCTION log_membership_revocation_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status = 'revoked' THEN
    INSERT INTO public.audit_log (organization_id, actor_user_id, action, metadata, origin)
    VALUES (
      NEW.organization_id,
      auth.uid(),
      'membership.revoked',
      jsonb_build_object('user_id', NEW.user_id, 'membership_id', NEW.id, 'role', NEW.role),
      NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_membership_revocation ON public.memberships;
CREATE TRIGGER trg_log_membership_revocation
  AFTER UPDATE ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION log_membership_revocation_func();

-- 4.3 Sync auth.users -> public.users
CREATE OR REPLACE FUNCTION sync_auth_user_to_public()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email)
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      name = EXCLUDED.name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION sync_auth_user_to_public();