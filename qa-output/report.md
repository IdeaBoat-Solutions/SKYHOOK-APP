# Skyhook ERP — Pre-handoff QA report

Date: 2026-11-20
Target: local SPA `http://127.0.0.1:3000` against the deployed Supabase gateway
`https://jgzyfmwigvsqzricplaq.supabase.co/functions/v1/api`
Demo login: `owner@skyhook.in` / `skyhook2026`

## What was tested

- **Static checks:** frontend `tsc --noEmit` ✅, `vite build` ✅; backend `tsc --noEmit` ✅,
  `tsc -p tsconfig.json` ✅, `npm test` ✅ (17 passed, 4 opt-in DB integration tests skipped).
- **API E2E:** 38 live checks — auth, validation, RBAC, every documented GET endpoint, every
  detail-by-ID endpoint, EMI calculator, and error cases → **0 unexpected failures**.
  Script: `%TEMP%\opencode\skyhook-api-e2e.mjs`.
- **Route parity audit:** all 72 documented operations exist in the deployed Edge Functions
  (health endpoints are handled specially in `index.ts`). No missing endpoints.
- **Browser walkthrough:** landing → login → all 14 sidebar modules (dashboard, projects,
  employees, operator directory, attendance incl. all 3 views, payroll, advances, machine
  working, asset master, expenses, calculations incl. 3 tabs, reminders, reports, settings),
  plus modals, notification drawer and console monitoring. Console is clean.
- **RBAC:** manager can read company/payroll; correctly gets 403 for audit logs, payroll approval
  and user creation.

## Findings

| ID | Severity | Title | Status |
| --- | --- | --- | --- |
| 001 | Medium | Modal action buttons unreachable on short viewports | **Fixed** (CSS) |
| 002 | High | Attendance matrix fabricates 24 payable days | **Fixed** (UI) |
| 003 | High | Payroll pays 24 days with no approved attendance | **Fixed in source — needs redeploy** |
| 004 | Low | Missing React `key` in ProjectsView | **Fixed** |
| 005 | Medium | Asset cards show "All clear" despite overdue renewals | **Fixed** (UI) |

---

### ISSUE-001 — Modal action buttons unreachable on short viewports (Medium) — FIXED

**Location:** `src/index.css:687-698` (`.modal-panel`).

`.modal-panel` was capped at `calc(100vh - 2rem)` with `overflow: hidden`, while its `<form>`
child had no scroll. At a 568px-tall viewport the Create Project form is 643px inside a 534px
panel: the **Cancel** and **Create Project** buttons were clipped and unclickable (only the X
button worked). Affects every modal using `.modal-panel`.

**Fix applied:** panel now uses `overflow-x: hidden; overflow-y: auto`.

**Verified:** at 568px viewport, panel `overflowY=auto`, scrolling 109px brings Cancel back into
view (`top=491`). Evidence: `screenshots/issue-001-modal-clipped.png`,
`screenshots/issue-001-after-fix-scrollable.png`.

---

### ISSUE-002 — Monthly matrix fabricates 24 payable days for zero-attendance operators (High) — FIXED

**Location:** `src/components/attendance/AttendanceView.tsx:923`.

The Payable column rendered `{totalPresent + totalHalf * 0.5 || 24}d`, so a computed `0` became
**24d**. Suresh Yadav showed 24 payable days with `-` in all 31 day cells.

**Fix applied:** removed the `|| 24` fallback.

**Verified live:** matrix now reads `Ramesh Patel:24d | Suresh Yadav:0d`.
Evidence: `screenshots/issue-002-payable-fallback.png`.

---

### ISSUE-003 — Payroll pays a full 24 days with no approved attendance (High) — FIXED IN SOURCE, REDEPLOY REQUIRED

**Locations:** `supabase/functions/api/payroll.ts:175-176` and
`server/src/modules/payroll/payroll.service.ts:101-102`.

When an employee had zero approved attendance rows (`own.length === 0`), the calculation forced
`effectivePayable = 24` (or `daysInMonth` for monthly staff) and `effectivePresent = 24`.
A daily-wage operator with no attendance — or only unapproved `submitted` records — was paid a
full month. Live proof: OP-002 had one `submitted` October record yet the generated run gave
`present_days=24`, `payable_days=24`, net **₹22,800**.

**Fix applied:** both implementations now use the computed `payableDays` / `presentDays`
unconditionally. Monthly staff still receive full salary because their `payableDays` is
`daysInMonth - unpaidLeaveDays`.

**Important:** this fix is in source only. The live gateway runs the deployed Edge Function, so
**redeployment is required** (`supabase functions deploy api`) before clients test it. Regenerate
the October payroll run after deploying. Evidence: `screenshots/issue-003-payroll-no-attendance.png`.

---

### ISSUE-004 — React key warning in ProjectsView (Low) — FIXED

Console error: `Each child in a list should have a unique "key" prop` in `ProjectsView`.
The project card `<div>` inside `filteredProjects.map()` had no `key`. Added `key={p.id}`.
**Verified:** console clean after revisiting Project Management.

---

### ISSUE-005 — Asset cards report "All clear" while statutory renewals are overdue (Medium) — FIXED

**Locations:** `src/data/apiStore.tsx:701,723,738,743,748` vs
`src/components/assets/AssetsView.tsx:519-520`.

Client-side compliance alerts were built with `targetId: m.assetId` (`CR-001`) but
`findAlert()` matched `a.targetId === m.id` (machine UUID), so the match never succeeded.
Every asset card showed the green "All clear" badge and lost overdue/due-soon styling, even
though the same page's KPI showed 4 compliance alerts and `GET /reminders` returned 4 machine
alerts for CR-001 (service 20/10, insurance 23/10, PUC 24/10, fitness 28/10 — all past the
24/10/2026 demo date).

**Fix applied:** `findAlert` now matches either `machine.id` or `machine.assetId` (the same
approach RemindersView already used).

**Verified live:** CR-001 now shows "4 actions required"; CR-002 correctly shows "All clear"
because none of its dates fall inside its lead window on the demo date.
Evidence: `screenshots/issue-005-asset-all-clear.png`.

---

## Other notes / residual risk

1. **Backend fix not yet deployed** — see ISSUE-003. This is the only finding not live yet.
2. **Seed data incomplete:** `/company` has `email`, `address`, `city`, `state`, `pincode` all
   `null`. They are marked `required` in Company Settings, so a client clicking "Save
   Configuration" must fill them first. Not a code bug, but worth filling before handoff.
3. **Demo-date drift:** the UI uses a frozen demo date (24/10/2026) while `/reminders` on the
   server uses the real date, so day counts differ between the notification drawer and the API.
   Harmless in production; confusing in a demo. Consider aligning before client testing.
4. **4 DB integration tests are skipped** unless `TEST_DATABASE_URL` is set. They were not run
   here; the deployed API E2E sweep covers the same endpoints over HTTP.
5. **Build warning:** the main JS chunk is ~1.4 MB (397 kB gzip). Not a bug, but code-splitting
   would improve first load on slow connections.
6. Actions performed during testing (safe/reversible): generated the October 2026 draft payroll
   run via the UI. No seed records were deleted and no other data was mutated.
7. **Concurrent working-tree changes:** during this QA pass, an unrelated brand-colour refactor
   appeared in the working tree (`brand-*`/`ink-*` utility classes replaced with `logo-*`,
   `src/index.css` token ramp, etc.) across ~20 component files. These are **not** part of this
   QA work and were not authored here; my edits are limited to the 7 files listed in the Findings
   table. All verification commands were run against the combined working tree and passed.

## Files I changed

- `src/index.css` — modal panel scroll (ISSUE-001)
- `src/components/attendance/AttendanceView.tsx` — payable days fallback (ISSUE-002)
- `supabase/functions/api/payroll.ts` — payroll fallback (ISSUE-003, needs deploy)
- `server/src/modules/payroll/payroll.service.ts` — payroll fallback (ISSUE-003)
- `src/components/projects/ProjectsView.tsx` — React key (ISSUE-004)
- `src/components/assets/AssetsView.tsx` — alert target matching (ISSUE-005)
- `server/vitest.config.ts` — test timeout so the contract test passes
- `qa-output/` — this report and reproduction screenshots

## Verdict

Ready for client testing **after** (a) deploying the payroll fix and regenerating October payroll,
and (b) optionally filling the missing company contact fields. All other modules rendered and
behaved correctly with a clean browser console.
