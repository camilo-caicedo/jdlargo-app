-- Migración 0026: Backfill dossier:view para rol admin (HU-016)
-- Agrega el permiso 'dossier:view' al rol 'admin' en todas las configuraciones ya publicadas
-- para asegurar que el gate de lectura no bloquee a administradores legítimos.

INSERT INTO public.role_permissions (organization_id, configuration_version_id, role_id, permission_key)
SELECT r.organization_id, r.configuration_version_id, r.id, 'dossier:view'
FROM public.roles r
WHERE r.code = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'dossier:view'
  )
ON CONFLICT DO NOTHING;
