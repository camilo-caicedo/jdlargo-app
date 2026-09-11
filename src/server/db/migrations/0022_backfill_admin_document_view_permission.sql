-- Migration 0022: Backfill 'document:view' permission for admin role (HU-013 audit finding, §2.9)
--
-- base-roles.json was updated to grant 'document:view' to admin, but that template is only
-- applied when a NEW configuration version is created/published. Existing published
-- configurations lack this permission for the admin role, preventing administrators from
-- viewing the documents card in the dossier detail.
-- Backfill the missing row for every existing role of code 'admin', across all configuration
-- versions, idempotently.

INSERT INTO public.role_permissions (organization_id, configuration_version_id, role_id, permission_key)
SELECT r.organization_id, r.configuration_version_id, r.id, 'document:view'
FROM public.roles r
WHERE r.code = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'document:view'
  )
ON CONFLICT DO NOTHING;
