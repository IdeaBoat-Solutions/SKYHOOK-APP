-- Skyhook ERP — Supabase provider additions.
-- Safe to apply to both local Postgres and Supabase: platform-only objects are
-- guarded by catalog checks. Run after 0001_init.sql.
--
-- On Supabase, a dedicated non-BYPASSRLS app role should be created first
-- (see supabase/roles.sql) so FORCE RLS is actually enforced for API queries.

BEGIN;

SET search_path TO skyhook, public;

-- Link each internal user to their Supabase Auth identity.
ALTER TABLE skyhook.users ADD COLUMN IF NOT EXISTS auth_user_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_auth_user_id
  ON skyhook.users (auth_user_id) WHERE auth_user_id IS NOT NULL;

COMMENT ON COLUMN skyhook.users.auth_user_id IS
  'Supabase auth.users.id; tenant + role claims are embedded in the signed access token.';

-- ---------------------------------------------------------------------------
-- Supabase Storage bucket (private, 10 MB — mirrors the API upload limit)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('skyhook-documents', 'skyhook-documents', false, 10485760)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- Direct client access to the bucket is scoped to the caller's tenant folder.
-- The API itself uses the service-role key, which bypasses these policies.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) THEN
    DROP POLICY IF EXISTS skyhook_tenant_storage ON storage.objects;
    CREATE POLICY skyhook_tenant_storage ON storage.objects
      FOR ALL TO authenticated
      USING (
        bucket_id = 'skyhook-documents'
        AND (storage.foldername(name))[1] = 'tenant'
        AND (storage.foldername(name))[2] =
            coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')
      )
      WITH CHECK (
        bucket_id = 'skyhook-documents'
        AND (storage.foldername(name))[1] = 'tenant'
        AND (storage.foldername(name))[2] =
            coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')
      );
  END IF;
END $$;

COMMIT;
