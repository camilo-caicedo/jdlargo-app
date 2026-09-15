-- Migration 0034: firma electrónica niveles 1 y 2 (HU-022)

-- 1. Nivel de firma exigido, versionado junto con el resto de la configuración (ADR-0004)
ALTER TABLE public.configuration_versions
  ADD COLUMN IF NOT EXISTS signature_level_required integer NOT NULL DEFAULT 1
  CHECK (signature_level_required IN (1, 2));

-- 2. Reutilizar dossier_access_otp_codes para el OTP de firma (HU-010 ya lo construyó para acceso)
ALTER TABLE public.dossier_access_otp_codes
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'access'
  CHECK (purpose IN ('access', 'signature'));

-- 3. Tabla signatures — append-only salvo status (active -> invalid)
CREATE TABLE IF NOT EXISTS public.signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  dossier_id uuid NOT NULL REFERENCES public.dossiers(id),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  level integer NOT NULL CHECK (level IN (1, 2)),
  content_hash text NOT NULL,
  content_version text NOT NULL,
  ip_address text NOT NULL,
  additional_factor jsonb,
  signed_at timestamp with time zone DEFAULT now() NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invalid')),
  invalidated_at timestamp with time zone,
  invalidated_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS signatures_org_dossier_idx ON public.signatures (organization_id, dossier_id);

ALTER TABLE public.signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signatures FORCE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.signatures TO authenticated;

DROP POLICY IF EXISTS signatures_select_policy ON public.signatures;
CREATE POLICY signatures_select_policy ON public.signatures
  FOR SELECT TO authenticated USING (is_current_org(organization_id));

DROP POLICY IF EXISTS signatures_insert_policy ON public.signatures;
CREATE POLICY signatures_insert_policy ON public.signatures
  FOR INSERT TO authenticated WITH CHECK (is_current_org(organization_id));

DROP POLICY IF EXISTS signatures_update_policy ON public.signatures;
CREATE POLICY signatures_update_policy ON public.signatures
  FOR UPDATE TO authenticated USING (is_current_org(organization_id)) WITH CHECK (is_current_org(organization_id));

-- 4. Trigger de inmutabilidad: todo es append-only salvo status/invalidated_at/invalidated_reason,
--    y la única transición de status permitida es active -> invalid (nunca invalid -> active).
CREATE OR REPLACE FUNCTION trg_prevent_signature_tampering_func()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE v_allow_cleanup text;
BEGIN
  v_allow_cleanup := current_setting('app.allow_config_cleanup', true);
  IF v_allow_cleanup = 'true' AND COALESCE(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las firmas son inmutables: no se pueden eliminar';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.organization_id <> NEW.organization_id OR OLD.dossier_id <> NEW.dossier_id OR
       OLD.party_id <> NEW.party_id OR OLD.level <> NEW.level OR
       OLD.content_hash <> NEW.content_hash OR OLD.content_version <> NEW.content_version OR
       OLD.ip_address <> NEW.ip_address OR
       COALESCE(OLD.additional_factor::text, '') <> COALESCE(NEW.additional_factor::text, '') OR
       OLD.signed_at <> NEW.signed_at OR OLD.created_at <> NEW.created_at THEN
      RAISE EXCEPTION 'No se puede modificar el contenido de una firma: las firmas son append-only';
    END IF;
    IF OLD.status = 'invalid' AND NEW.status = 'active' THEN
      RAISE EXCEPTION 'Una firma invalidada no puede reactivarse';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END; $func$;

DROP TRIGGER IF EXISTS trg_prevent_signature_tampering ON public.signatures;
CREATE TRIGGER trg_prevent_signature_tampering
  BEFORE UPDATE OR DELETE ON public.signatures
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_signature_tampering_func();
