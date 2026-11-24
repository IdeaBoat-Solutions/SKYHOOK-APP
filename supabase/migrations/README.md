# Supabase migrations

Canonical, forward-only migration set for Skyhook ERP on Supabase, applied with the
Supabase CLI (`supabase migrations`) or via `server/src/scripts/migrate.ts`
(`npm run migrate`). Names follow the `NNNN_name.sql` convention; run in order.

Files moved here from `server/db/migrations/`:

- `0001_init.sql` — full domain schema (skyhook + public), RLS (FORCE), triggers, views
- `0002_supabase.sql` — auth_user_id link, Storage bucket + tenant policy
- `0003_service_hours.sql` — hour-based service intervals on machines
- `0004_local_extras.sql` — payroll adjustments, personal records
- `0005_licence_details.sql`
- `0006_machine_rc_details.sql`
- `0007_contractor_directory.sql`

Note: `../0001_complete_setup.sql` (and `../0002_payroll_adjustments.sql`) are the older
"single file / incremental" set kept in the `supabase/` root; the `migrations/` set above
is the canonical forward-only set the migrate script applies.

The Supabase Edge Functions live in `supabase/functions/` (`api/`, `worker/`, `_shared/`).
