-- Backfill de slug para organizaciones creadas antes de que la columna existiera.
-- Usa los primeros 8 caracteres del id (siempre único) como slug provisional.
ALTER TABLE "organizations" ADD COLUMN "slug" text;--> statement-breakpoint

UPDATE "organizations"
SET "slug" = 'org-' || substr("id"::text, 1, 8)
WHERE "slug" IS NULL;--> statement-breakpoint

ALTER TABLE "organizations" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_unique" ON "organizations" USING btree ("slug");--> statement-breakpoint

CREATE OR REPLACE FUNCTION create_organization_with_admin(
  p_name text,
  p_slug text,
  p_tax_id text,
  p_origin jsonb
) RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org public.organizations;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'create_organization_with_admin requires an authenticated caller';
  END IF;

  INSERT INTO public.organizations (name, slug, tax_id)
  VALUES (p_name, p_slug, p_tax_id)
  RETURNING * INTO v_org;

  INSERT INTO public.memberships (organization_id, user_id, role, status)
  VALUES (v_org.id, v_user_id, 'admin', 'active');

  INSERT INTO public.audit_log (organization_id, actor_user_id, action, metadata, origin)
  VALUES (v_org.id, v_user_id, 'organization.created', jsonb_build_object('name', p_name, 'slug', p_slug), p_origin);

  RETURN v_org;
END;
$$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION create_organization_with_admin(text, text, text, jsonb) TO authenticated;--> statement-breakpoint

DROP FUNCTION IF EXISTS create_organization_with_admin(text, text, jsonb);
