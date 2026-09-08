-- Migration 0019: Backfill 'dossier:edit' permission for existing roles (HU-011 audit finding, §6.1)
--
-- base-roles.json was fixed to grant 'dossier:edit' to admin, compliance_analyst and
-- operational_user, but that template is only applied when a NEW configuration version is
-- created/published. Organizations whose configuration version was already published before
-- the fix (e.g. Hexavis S.A.S.) keep the old role_permissions rows and never see the
-- "Generar enlace de acceso" button (HU-010) even after the code fix. Backfill the missing
-- row for every existing role of those three codes, across every configuration version
-- (draft or published), idempotently.

INSERT INTO public.role_permissions (organization_id, configuration_version_id, role_id, permission_key)
SELECT r.organization_id, r.configuration_version_id, r.id, 'dossier:edit'
FROM public.roles r
WHERE r.code IN ('admin', 'compliance_analyst', 'operational_user')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'dossier:edit'
  )
ON CONFLICT DO NOTHING;
