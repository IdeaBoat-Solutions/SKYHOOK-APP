-- OPTIONAL but recommended on Supabase: a dedicated, non-bypass-RLS DB role.
-- Run in the Supabase SQL Editor (as postgres) BEFORE/AFTER 0001_init.sql.
-- Replace the password placeholder, then keep it only in your secret manager
-- and in DATABASE_URL / DATABASE_URL_DIRECT. Never commit the real value.

DO $$
DECLARE
  db_password TEXT := 'CHANGE_ME_TO_A_STRONG_PASSWORD';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skyhook_app') THEN
    EXECUTE format('CREATE ROLE skyhook_app LOGIN PASSWORD %L', db_password);
  ELSE
    EXECUTE format('ALTER ROLE skyhook_app WITH LOGIN PASSWORD %L', db_password);
  END IF;
END $$;

-- Re-grant (0001_init.sql only grants when the role already exists).
GRANT USAGE ON SCHEMA skyhook TO skyhook_app;
GRANT USAGE ON SCHEMA public TO skyhook_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA skyhook TO skyhook_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA skyhook TO skyhook_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA skyhook
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skyhook_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA skyhook
  GRANT USAGE, SELECT ON SEQUENCES TO skyhook_app;
