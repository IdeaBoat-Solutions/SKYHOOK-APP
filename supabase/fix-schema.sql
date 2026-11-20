-- Recovery for: ERROR 3F000: schema "skyhook" does not exist
-- Run this in the Supabase SQL Editor first, then apply the migrations in order:
--   1) server/db/migrations/0001_init.sql   (creates the schema and every table)
--   2) server/db/migrations/0002_supabase.sql
-- This file alone only creates the schema — it does NOT create the tables.

CREATE SCHEMA IF NOT EXISTS skyhook;

-- Let the service role and PostgREST see the schema after the tables exist.
GRANT USAGE ON SCHEMA skyhook TO service_role;
NOTIFY pgrst, 'reload schema';

-- Verify: should list the schema and its tables once 0001 has been applied.
SELECT table_schema, count(*) AS tables
FROM information_schema.tables
WHERE table_schema = 'skyhook'
GROUP BY table_schema;
