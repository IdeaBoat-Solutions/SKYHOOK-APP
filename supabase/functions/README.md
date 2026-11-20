# Skyhook API on Supabase Edge Functions

Status: **Complete.** All 74 Fastify routes across 15 modules are ported to Edge Functions, plus
the worker (outbox drain, reminders, XLSX exports). The full function set typechecks with
`deno check`. The old `server/` Fastify app is kept for reference/local development only.

## What is implemented
- `_shared/config.ts` — env/secrets
- `_shared/errors.ts` — RFC 9457 problem details
- `_shared/db.ts` — `npm:pg` pool with `withTenant` / `withTenantRead` (RLS via `app.tenant_id`)
- `_shared/auth.ts` — Supabase GoTrue sign-in / token verification / admin user provisioning
- `_shared/rbac.ts` — permission codes + `requirePermission`
- `_shared/http.ts` — CORS, JSON, error mapping, path parsing
- `api/` — router + identity module:
  - `GET /health/live`, `GET /health/ready`
  - `GET /auth/profiles`, `POST /auth/token`, `POST /auth/register`, `POST /dev/token`
  - `GET /auth/me`, `GET /audit-logs`
- `worker/` — one-shot outbox drain + reminder evaluation (replaces the long-running worker timers)

All 15 modules are ported: identity, company, workforce, users, projects, attendance,
machine-working, payroll, machines, EMI, expenses, advances, reminders, reports, files. The worker
also processes queued XLSX exports via `_shared/export.ts` + `_shared/storage.ts`. Unknown routes
still return a 404 with an explanatory message.

Two upstream bugs were fixed during the port (both in the original Fastify code):
- `PATCH /machines/:id` and `PATCH /projects/:id` built their dynamic `SET` with `$3`, which was
  also the `id` placeholder in `WHERE`. Values now start at `$4`.

Known behavioural differences:
- Timestamps/CRON: exports are drained on each worker run (default every 6h), not 5-second polling.
- Supabase-mode auth only: the legacy scrypt/HS256 dev-token path is intentionally not ported.

## Setup

1. Apply the DB migration first: `supabase/0001_complete_setup.sql` in the Supabase SQL Editor.
2. Set function secrets (Dashboard → Project Settings → Edge Functions → Secrets, or CLI):
   ```sh
   supabase secrets set \
     DATABASE_URL='postgres://skyhook_app:<password>@<region>.pooler.supabase.com:6543/postgres?sslmode=require' \
     ALLOWED_ORIGIN='https://<your-vercel-project>.vercel.app' \
     CRON_SECRET='<long-random-string>'
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
3. Deploy:
   ```sh
   supabase functions deploy api --no-verify-jwt
   supabase functions deploy worker --no-verify-jwt
   ```
   (`--no-verify-jwt` because the router verifies the token itself via GoTrue and exposes public routes.)
4. Frontend: in Vercel set `VITE_API_URL=https://<ref>.supabase.co/functions/v1/api`, then build.
5. Schedule the worker (every 6h) with `pg_cron` + `pg_net`, or any external cron:
   ```sql
   select cron.schedule('skyhook-worker', '0 */6 * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/worker',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
       body := '{}'::jsonb
     ) as request_id;
   $$);
   ```
   Enable extensions `pg_cron` and `pg_net` first.

## Typecheck locally

```sh
npx -y deno@2.9.6 check --config supabase/functions/deno.json \
  supabase/functions/api/index.ts supabase/functions/worker/index.ts
```

## Project structure
```
supabase/functions/
  api/index.ts          router (GET/POST/PUT/PATCH/DELETE, :params + * wildcards)
  api/<module>.ts       one file per Fastify module, exports `<name>Routes: Route[]`
  worker/index.ts       one-shot cron worker (outbox, reminders, XLSX exports)
  _shared/              config, errors, db, auth, rbac, http, storage, export, types
```
See [docs/12](../docs/12-SUPABASE-EDGE-FUNCTIONS.md) for the full Supabase + Vercel go-live guide.
