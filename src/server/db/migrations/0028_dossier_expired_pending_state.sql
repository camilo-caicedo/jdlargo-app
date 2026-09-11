-- Migración 0028: Estado expirado_pendiente y transiciones válidas (HU-063)
-- Agrega el estado 'expirado_pendiente' y las transiciones desde/hacia enviada y en_diligenciamiento.

INSERT INTO public.dossier_states ("key", "is_final") VALUES
  ('expirado_pendiente', false)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO public.valid_transitions ("source", "target", "permission", "requires_reason") VALUES
  ('enviada', 'expirado_pendiente', 'dossier:edit', false),
  ('en_diligenciamiento', 'expirado_pendiente', 'dossier:edit', false),
  ('expirado_pendiente', 'en_diligenciamiento', 'dossier:edit', false)
ON CONFLICT ("source", "target") DO NOTHING;
