-- Migration 0033: vigencia de documentos (HU-021)

-- 1. Agregar 'expired' al CHECK constraint de documents.state.
--    El constraint es inline sin nombre explícito (ver 0021_documents.sql) -> Postgres lo
--    nombra por default <tabla>_<columna>_check. Verificar con
--    `SELECT conname FROM pg_constraint WHERE conrelid = 'public.documents'::regclass;`
--    si este DROP falla por nombre distinto.
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_state_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_state_check
  CHECK (state IN ('received', 'under_review', 'valid', 'requires_review', 'rejected', 'expired'));

-- 2. Columna nueva de vigencia en requirements. Nullable: solo aplica a type='document_type',
--    y solo cuando el admin la configura (default implícito = sin vigencia / no_expiration).
ALTER TABLE public.requirements ADD COLUMN IF NOT EXISTS validity jsonb;
