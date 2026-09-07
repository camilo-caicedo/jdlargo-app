-- Migration 0007: Audit and Configuration Hardening (Auditoría Claude Code)
-- Fix HU-004: Índice único parcial para evitar múltiples versiones published concurrentes
CREATE UNIQUE INDEX IF NOT EXISTS "config_versions_org_published_unique" 
ON "configuration_versions" ("organization_id") 
WHERE status = 'published';
--> statement-breakpoint

-- Fix HU-004: Restricción check para asegurar motivo no vacío al publicar
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'config_versions_reason_published_check'
  ) THEN
    ALTER TABLE "configuration_versions" 
    ADD CONSTRAINT "config_versions_reason_published_check" 
    CHECK (status != 'published' OR (reason IS NOT NULL AND length(trim(reason)) > 0));
  END IF;
END $$;
--> statement-breakpoint

-- Fix HU-003 & HU-004: Trigger de inmutabilidad reforzado
-- Protege versiones en estado 'replaced' de UPDATE
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
  IF v_allow_cleanup = 'true' THEN
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
