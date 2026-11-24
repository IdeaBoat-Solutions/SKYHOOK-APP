# Supabase migrations

Canonical, forward-only migration set for Skyhook ERP on Supabase. Apply with the Supabase CLI
(`supabase db push --remote`) or via `server/src/scripts/migrate.ts` (`npm run migrate`).
Files are named `NNNN_name.sql` and run in order.

## `migrations/` (canonical set)

- `0001_init.sql` — full domain schema (skyhook + public), RLS (FORCE), triggers, views
- `0002_supabase.sql` — auth_user_id link, Storage bucket + tenant policy
- `0003_service_hours.sql` — hour-based service intervals on machines
- `0004_local_extras.sql` — payroll adjustments, personal records
- `0005_licence_details.sql`
- `0006_machine_rc_details.sql`
- `0007_contractor_directory.sql`
- `0008_extracted_document_details.sql` — `extracted_documents` table + seeded OCR document data (from PR #1)

`0001`–`0007` were moved here from `server/db/migrations/`; `0008` was moved from the root of
`supabase/` when PR #1 was merged.

## Applied state (verified 2026-11-24, linked production project)

- `0001`–`0007`: schema already existed in the remote database (previously applied via the SQL
  Editor), so their entries were marked applied with
  `supabase migration repair --status applied ... --remote` instead of re-running DDL on production.
- `0008`: applied with `supabase db push --remote`; four documents seeded.

## Other SQL files in this directory

The older single-file/incremental set (`0001_complete_setup.sql`, `0001_complete_setup.local.sql`,
`0002_payroll_adjustments.sql`, `0003`–`0006`, `fix-schema.sql`, `roles.sql`) is kept for reference
and SQL Editor installs. It is not the canonical CLI migration set.

## Edge functions

`functions/api/` (router + 16 modules), `functions/worker/`, `functions/_shared/`. Deployed with
`supabase functions deploy api worker --no-verify-jwt`.
