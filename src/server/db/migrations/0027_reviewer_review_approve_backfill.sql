-- Migración 0027: Backfill dossier:edit y dossier:approve para rol reviewer
-- Agrega los permisos 'dossier:edit' y 'dossier:approve' al rol 'reviewer' en todas las configuraciones ya publicadas
-- para que un usuario revisor pueda completar la revisión (dar por revisado) y registrar decisiones según su rol.

INSERT INTO public.role_permissions (organization_id, configuration_version_id, role_id, permission_key)
SELECT r.organization_id, r.configuration_version_id, r.id, missing.permission_key
FROM public.roles r
CROSS JOIN (VALUES ('dossier:edit'), ('dossier:approve')) AS missing(permission_key)
WHERE r.code = 'reviewer'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_key = missing.permission_key
  )
ON CONFLICT DO NOTHING;
