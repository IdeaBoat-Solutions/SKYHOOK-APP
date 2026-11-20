import path from 'node:path';
import { pool } from '../db/pool.js';
import { withTenant } from '../db/tenant.js';

/** Dev-only: undo a generated/approved payroll run so smoke tests can be repeated. */
export async function resetPayroll(month = '2026-10'): Promise<void> {
  const t = await pool.query("SELECT id FROM tenants WHERE slug='skyhook'");
  if (!t.rows[0]) throw new Error('Tenant skyhook not found; run npm run seed first');
  const tenantId = t.rows[0].id as string;

  await withTenant(tenantId, async (c) => {
    const run = await c.query('SELECT id FROM payroll_runs WHERE tenant_id=$1 AND to_char(month,$2)=$3', [tenantId, 'YYYY-MM', month]);
    if (run.rows[0]) {
      const id = run.rows[0].id;
      await c.query('DELETE FROM payroll_ot_breakdowns WHERE tenant_id=$1 AND payroll_entry_id IN (SELECT id FROM payroll_entries WHERE tenant_id=$1 AND payroll_run_id=$2)', [tenantId, id]);
      await c.query('DELETE FROM advance_recoveries WHERE tenant_id=$1 AND payroll_run_id=$2', [tenantId, id]);
      await c.query('DELETE FROM payroll_entries WHERE tenant_id=$1 AND payroll_run_id=$2', [tenantId, id]);
      await c.query('DELETE FROM payroll_runs WHERE tenant_id=$1 AND id=$2', [tenantId, id]);
    }
    await c.query(
      `UPDATE salary_advances SET recovery_paise=250000, outstanding_paise=250000, status='partially_recovered'
       WHERE tenant_id=$1 AND advance_code='ADV-001'`,
      [tenantId],
    );
  });
  console.log(`Reset payroll for ${month}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  resetPayroll(process.argv[2] ?? '2026-10')
    .then(() => pool.end())
    .catch((err) => { console.error(err); process.exitCode = 1; });
}
