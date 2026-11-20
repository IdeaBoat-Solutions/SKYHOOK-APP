import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Opt-in integration tests against a REAL migrated + seeded PostgreSQL database.
 * Run with: TEST_DATABASE_URL=postgres://... npm test
 * The suite resets the October payroll run first so it is repeatable.
 */
const hasDb = Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!hasDb)('API integration (real PostgreSQL)', () => {
  let app: Awaited<ReturnType<typeof import('../app.js')['buildApp']>>;
  let headers: Record<string, string>;
  let tenantId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
    process.env.NODE_ENV = 'test';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { buildApp } = await import('../app.js');
    const { pool } = await import('../db/pool.js');
    app = await buildApp();
    await app.ready();

    const tenant = await pool.query("SELECT id FROM tenants WHERE slug='skyhook'");
    if (!tenant.rows[0]) throw new Error('TEST_DATABASE_URL must point to a migrated + seeded database');
    tenantId = tenant.rows[0].id;

    await pool.query(
      `DELETE FROM payroll_ot_breakdowns WHERE tenant_id=$1 AND payroll_entry_id IN (SELECT id FROM payroll_entries WHERE tenant_id=$1 AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE tenant_id=$1 AND run_code='PR-2026-10'))`,
      [tenantId],
    );
    await pool.query(`DELETE FROM advance_recoveries WHERE tenant_id=$1 AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE tenant_id=$1 AND run_code='PR-2026-10')`, [tenantId]);
    await pool.query(`DELETE FROM payroll_entries WHERE tenant_id=$1 AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE tenant_id=$1 AND run_code='PR-2026-10')`, [tenantId]);
    await pool.query(`DELETE FROM payroll_runs WHERE tenant_id=$1 AND run_code='PR-2026-10'`, [tenantId]);
    await pool.query(`UPDATE salary_advances SET recovery_paise=250000, outstanding_paise=250000, status='partially_recovered' WHERE tenant_id=$1 AND advance_code='ADV-001'`, [tenantId]);

    const login = await app.inject({
      method: 'POST', url: '/auth/token',
      payload: { tenantSlug: 'skyhook', email: 'owner@skyhook.in', password: 'skyhook2026' },
    });
    expect(login.statusCode).toBe(200);
    headers = { authorization: `Bearer ${login.json().token}`, 'idempotency-key': `it-${randomUUID()}` };
  });

  it('health endpoints respond', async () => {
    expect((await app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
  });

  it('reads the seeded employee master', async () => {
    const res = await app.inject({ method: 'GET', url: '/employees', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBeGreaterThanOrEqual(3);
  });

  it('generates, approves and pays a payroll run with the spec-accurate net', async () => {
    const runRes = await app.inject({
      method: 'POST', url: '/payroll/runs/generate', headers,
      payload: { month: '2026-10' },
    });
    expect(runRes.statusCode).toBe(201);
    const run = runRes.json();
    const ramesh = run.entries.find((e: any) => e.employee_code === 'OP-001');
    expect(ramesh.present_days).toBe(24);
    expect(ramesh.base_paise).toBe(2160000);
    expect(ramesh.ot_paise).toBe(180000);
    expect(ramesh.net_paise).toBe(2090000);

    const approve = await app.inject({
      method: 'POST', url: `/payroll/runs/${run.id}/approve`,
      headers: { ...headers, 'idempotency-key': randomUUID() }, payload: {},
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().locked).toBe(true);

    const paid = await app.inject({
      method: 'POST', url: `/payroll/runs/${run.id}/entries/${ramesh.id}/payment`,
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: { paymentMode: 'bank_transfer', paymentReference: 'IT-TEST' },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().payment_status).toBe('paid');
  });

  it('enforces RBAC for managers on payroll generation', async () => {
    const login = await app.inject({
      method: 'POST', url: '/auth/token',
      payload: { tenantSlug: 'skyhook', email: 'manager@skyhook.in', password: 'skyhook2026' },
    });
    const mgrHeaders = { authorization: `Bearer ${login.json().token}`, 'idempotency-key': randomUUID() };
    const res = await app.inject({
      method: 'POST', url: '/payroll/runs/generate', headers: mgrHeaders, payload: { month: '2026-10' },
    });
    expect(res.statusCode).toBe(403);
  });
});
