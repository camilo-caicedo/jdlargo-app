-- Migration 0008: Restrict app.allow_config_cleanup bypass to privileged service roles
-- Fix HU-006 & HU-003/HU-005 (Auditoría Claude Code)

-- 1. Trigger de inmutabilidad de configuration_versions, roles y role_permissions
CREATE OR REPLACE FUNCTION trg_prevent_published_config_modification_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_version_id uuid;
  v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  -- Solo se permite el bypass si se invoca desde roles administrativos/servicio
  IF v_allow_cleanup = 'true' AND (
    session_user IN ('postgres', 'service_role', 'supabase_admin') OR
    current_user IN ('postgres', 'service_role', 'supabase_admin')
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'configuration_versions' THEN
    v_status := OLD.status;
    IF TG_OP = 'DELETE' AND (v_status = 'published' OR v_status = 'replaced') THEN
      RAISE EXCEPTION 'Cannot delete published or replaced configuration version';
    END IF;

    -- Versión replaced es 100% inmutable, no admite UPDATE de ningún tipo
    IF TG_OP = 'UPDATE' AND v_status = 'replaced' THEN
      RAISE EXCEPTION 'Cannot modify replaced configuration version';
    END IF;

    -- Versión published: solo se permite transición a 'replaced', ningún otro cambio de contenido
    IF TG_OP = 'UPDATE' AND v_status = 'published' THEN
      IF NEW.status = 'replaced' THEN
        RETURN NEW;
      ELSE
        RAISE EXCEPTION 'Cannot modify published configuration version';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- Para roles y role_permissions, chequear versión padre
  v_version_id := OLD.configuration_version_id;
  SELECT status INTO v_status FROM public.configuration_versions WHERE id = v_version_id;
  
  IF v_status = 'published' OR v_status = 'replaced' THEN
    RAISE EXCEPTION 'Cannot modify or delete items in published or replaced configuration version';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- 2. Trigger de inmutabilidad de assertions
CREATE OR REPLACE FUNCTION trg_prevent_assertion_tampering_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  -- Solo se permite el bypass si se invoca desde roles administrativos/servicio
  IF v_allow_cleanup = 'true' AND (
    session_user IN ('postgres', 'service_role', 'supabase_admin') OR
    current_user IN ('postgres', 'service_role', 'supabase_admin')
  ) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assertions are immutable: deleting an assertion is strictly forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.field <> NEW.field OR
       OLD.value::text <> NEW.value::text OR
       OLD.origin <> NEW.origin OR
       OLD.produced_by <> NEW.produced_by OR
       OLD.produced_at <> NEW.produced_at OR
       COALESCE(OLD.evidence_id, '') <> COALESCE(NEW.evidence_id, '') OR
       COALESCE(OLD.confidence, '') <> COALESCE(NEW.confidence, '') OR
       OLD.organization_id <> NEW.organization_id OR
       OLD.dossier_id <> NEW.dossier_id OR
       OLD.party_id <> NEW.party_id OR
       OLD.configuration_version_id <> NEW.configuration_version_id THEN
      RAISE EXCEPTION 'Cannot modify assertion provenance or value: assertions are append-only';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- 3. Trigger de inmutabilidad de audit_log
CREATE OR REPLACE FUNCTION trg_prevent_audit_log_modification_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  -- Solo se permite el bypass si se invoca desde roles administrativos/servicio
  IF v_allow_cleanup = 'true' AND (
    session_user IN ('postgres', 'service_role', 'supabase_admin') OR
    current_user IN ('postgres', 'service_role', 'supabase_admin')
  ) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Audit log is strictly immutable: DELETE operation is forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Audit log is strictly immutable: UPDATE operation is forbidden';
  END IF;

  RETURN NEW;
END;
$$;
