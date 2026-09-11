-- Migration 0025: requirement blocking flag (HU-015 / PA-029 override)

ALTER TABLE public.requirements ADD COLUMN IF NOT EXISTS blocking boolean NOT NULL DEFAULT true;
