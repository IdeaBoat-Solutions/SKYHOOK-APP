# Skyhook API — complete backend

Implementation of the design in [`../docs/06`](../docs/06-TARGET-BACKEND-ARCHITECTURE.md).
TypeScript + Fastify modular monolith on PostgreSQL 16, with **Supabase** as the DB/Auth/Storage
provider when configured — see [`../docs/11-SUPABASE-SETUP.md`](../docs/11-SUPABASE-SETUP.md).

## What works today

| Area | Status |
| --- | --- |
| Schema, enums, RLS (FORCE), triggers, views | ✅ `supabase/migrations/0001_init.sql` |
| Tenant-scoped transactions (`SET LOCAL app.tenant_id`) | ✅ |
| JWT verification (Supabase JWKS / OIDC JWKS / dev HS256) + RBAC | ✅ |
| Password auth: Supabase Auth (when configured) or scrypt locally | ✅ |
| Audit log + transactional outbox | ✅ |
| Idempotency keys on all mutating money endpoints | ✅ |
| Server-side overtime / payroll / EMI calculations (10 unit tests) | ✅ |
| Attendance, payroll, advances, expenses | ✅ |
| Assets, compliance renewals, service history, machine working logs + XLSX import | ✅ |
| EMI loans, amortization calculator, payment capture, alerts | ✅ |
| Reminders, notifications, preferences, user/role administration | ✅ |
| XLSX exports (6 reports) + async job polling + Supabase Storage / local files | ✅ |
| Background worker (outbox drain + reminder evaluation every 6 h) | ✅ `npm run worker` |
| SPA API-client cutover, OIDC integration test, S3 swap, DR drills | ⬜ remaining |

## Run locally

Copy `.env.example` to `.env`, then either use Docker Compose from the repo root:

```powershell
docker compose up --build
```

or run PostgreSQL yourself and use the scripts:

```powershell
npm install
npm run migrate      # applies supabase/migrations/*.sql
npm run seed         # tenant 'skyhook', owner@skyhook.in / skyhook2026
npm run reset        # dev-only: undo a locked payroll run before re-running smoke
npm run dev          # http://127.0.0.1:3001
npm run worker       # separate process: outbox drain + reminders
npm run openapi      # regenerate openapi.json from the route catalogue
npm test             # 20 tests (10 calculations + 4 claims + 2 contract + 4 integration*)
npm run lint         # tsc --noEmit
npm run build
```

\* Integration tests are opt-in: set `TEST_DATABASE_URL` to a migrated + seeded database.
Without it they are skipped and 16 tests run.

### Supabase provider (DB + Auth + Storage)

Leave the Supabase variables in `.env` blank for the local dev stack. To use Supabase instead,
create a project, run the SQL in `supabase/roles.sql` (optional), `supabase/migrations/0001_init.sql` and
`supabase/migrations/0002_supabase.sql`, then set `DATABASE_URL`, `DATABASE_URL_DIRECT`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. The API then verifies Supabase access tokens,
stores passwords in Supabase Auth and uploads files to the `skyhook-documents` bucket. Full steps:
**[docs/11-SUPABASE-SETUP.md](../docs/11-SUPABASE-SETUP.md)**.

## Try the money-critical flow

```powershell
$base = 'http://127.0.0.1:3001'
$login = Invoke-RestMethod -Method POST "$base/auth/token" -ContentType 'application/json' `
  -Body '{"tenantSlug":"skyhook","email":"owner@skyhook.in","password":"skyhook2026"}'
$h = @{ Authorization = "Bearer $($login.token)" }

# generate October payroll (Idempotency-Key makes retries safe)
Invoke-RestMethod -Method POST "$base/payroll/runs/generate" `
  -Headers ($h + @{ 'Idempotency-Key' = 'my-run-1' }) -ContentType 'application/json' `
  -Body '{"month":"2026-10"}'
```

Or run the full assertion suite (includes the ₹20,900 spec check and RBAC denial):

```powershell
npm run reset              # repeatable suite: start from a draft run
./scripts/smoke.ps1        # 12 money-critical assertions
./scripts/smoke-full.ps1   # 33 assertions across every module
```

## Seeded demo accounts

| Email | Role | Password |
| --- | --- | --- |
| `owner@skyhook.in` | owner | `skyhook2026` |
| `manager@skyhook.in` | manager | `skyhook2026` |
| `amit@skyhook.in` | manager | `skyhook2026` |

`POST /auth/token` is the canonical login route; `/dev/token` remains a dev-only alias. In Supabase
mode the returned `token` is a Supabase access token verified via JWKS. In non-Supabase mode,
`/dev/token` is enabled only when `NODE_ENV != production` (or no JWKS URL is configured), and
production tokens come from the OIDC provider configured by `JWT_JWKS_URL`.

## Architecture notes

- **One authority:** hours and money are computed server-side; clients cannot submit amounts.
- **Tenant isolation:** every business table has `tenant_id` and FORCE RLS. Requests derive the
  tenant from the verified JWT, never from input.
- **Money:** integer paise everywhere (`BIGINT`); the API returns paise — divide by 100 for display.
- **Auditability:** writes append an `audit_logs` row and an `outbox` event in the same transaction.
- **Replay safety:** mutating endpoints require `Idempotency-Key`; matching keys return the stored
  original response with no side effects.
- **Locked payroll:** a DB trigger rejects changes to monetary fields once a run is approved.
  Corrections must be new adjustment runs.

## Next steps

1. Run the browser E2E suite against a live API/Supabase project.
2. Add a real OIDC integration test with a JWKS mock.
3. Add integration tests against an ephemeral PostgreSQL container (Testcontainers).
4. Replace the local file-storage shim with S3 + pre-signed URLs; move export jobs to BullMQ.
5. Swap dev token minting for the production IdP; run DR/backup drills from doc 09.
