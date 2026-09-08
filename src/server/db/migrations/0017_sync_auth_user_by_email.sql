-- 1. Actualizar función sync_auth_user_to_public para que resuelva conflictos por email.
-- Si un usuario fue eliminado de auth.users y luego se vuelve a registrar con el mismo email,
-- se actualiza el id en public.users para que coincida con el nuevo id de auth.users
-- en vez de arrojar "duplicate key value violates unique constraint users_email_unique".
CREATE OR REPLACE FUNCTION public.sync_auth_user_to_public()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email)
  )
  ON CONFLICT (email) DO UPDATE
  SET id = EXCLUDED.id,
      email = EXCLUDED.email,
      name = EXCLUDED.name;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- 2. Sincronizar eliminación: cuando se elimina un usuario de auth.users, eliminarlo también de public.users
CREATE OR REPLACE FUNCTION public.sync_auth_user_deleted_to_public()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.users WHERE id = OLD.id;
  RETURN OLD;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;--> statement-breakpoint
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_auth_user_deleted_to_public();