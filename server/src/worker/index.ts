import { pool } from '../db/pool.js';
import { withTenant } from '../db/tenant.js';
import { config } from '../config.js';
import { businessDate } from '../common/date.js';
import { evaluateReminderStatus, evaluateServiceHours } from '../domain/calculations.js';
import { buildExport, type ExportKind } from '../modules/reports/export.service.js';
import { saveObject, exportKey } from '../common/storage.js';

let running = true;

async function tenants(): Promise<string[]> {
  const r = await pool.query('SELECT id FROM tenants');
  return r.rows.map((x: any) => x.id as string);
}

/** Publish pending outbox events into the in-app notification centre (idempotent per event). */
async function drainOutbox(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (c) => {
    const events = await c.query(
      `SELECT * FROM outbox WHERE tenant_id=$1 AND published_at IS NULL
       ORDER BY occurred_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
      [tenantId],
    );
    let count = 0;
    for (const e of events.rows as any[]) {
      const title = e.event_type.replace(/_/g, ' ').toLowerCase().replace(/^./, (x: string) => x.toUpperCase());
      await c.query(
        `INSERT INTO notifications (tenant_id,category,title,description,related_entity,related_id,due_date,priority,status)
         SELECT $1,
           CASE WHEN $2 LIKE 'EMI%' THEN 'emi' WHEN $2 LIKE 'PAYROLL%' THEN 'payroll'
                WHEN $2 LIKE 'ATTENDANCE%' THEN 'attendance' ELSE 'service' END::reminder_category,
           $3, $4, $5, $6, NULL,
           CASE WHEN $2 LIKE '%APPROVED%' OR $2 LIKE '%PAID%' THEN 'medium' ELSE 'low' END::priority,
           'open'
         WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.tenant_id=$1 AND n.related_entity=$5 AND n.related_id=$6 AND n.title=$3)`,
        [tenantId, e.event_type, title, e.payload?.reason ?? 'System event', e.aggregate_type, e.aggregate_id],
      );
      await c.query('UPDATE outbox SET published_at=now(), attempts=attempts+1 WHERE id=$1', [e.id]);
      count++;
    }
    return count;
  });
}

/** Evaluate all due dates and raise alerts that enter their reminder window. */
async function evaluateReminders(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (c) => {
    const rules = await c.query('SELECT category, lead_days FROM reminder_rules WHERE tenant_id=$1 AND enabled', [tenantId]);
    const lead = (cat: string) => rules.rows.find((r: any) => r.category === cat)?.lead_days ?? 15;
    const today = businessDate();
    let raised = 0;

    const renewals = await c.query('SELECT * FROM v_upcoming_renewals WHERE tenant_id=$1 AND due_date IS NOT NULL', [tenantId]);
    for (const r of renewals.rows as any[]) {
      const ev = evaluateReminderStatus(r.due_date, lead(r.category), today);
      if (ev.status === 'none') continue;
      const inserted = await c.query(
        `INSERT INTO notifications (tenant_id,category,title,description,related_entity,related_id,due_date,priority,status)
         SELECT $1,$2::reminder_category,$3,$4,$5,$6,$7::date,$8::priority,'open'
         WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.tenant_id=$1 AND n.related_entity=$5 AND n.related_id=$6 AND n.due_date=$7::date AND n.category=$2::reminder_category)`,
        [tenantId, r.category, `${r.reference} — ${r.category}`, ev.label, r.target_type, r.target_id, r.due_date,
          ev.status === 'overdue' ? 'critical' : ev.status === 'due_today' ? 'high' : 'medium'],
      );
      raised += inserted.rowCount ?? 0;
    }

    const emi = await c.query(
      `SELECT i.id, i.due_date, i.installment_number, l.reminder_lead_days, m.asset_code
       FROM emi_installments i JOIN emi_loans l ON l.id=i.loan_id JOIN machines m ON m.id=l.machine_id
       WHERE i.tenant_id=$1 AND i.status<>'paid'`,
      [tenantId],
    );
    for (const e of emi.rows as any[]) {
      const ev = evaluateReminderStatus(e.due_date, lead('emi'), today);
      if (ev.status === 'none') continue;
      const inserted = await c.query(
        `INSERT INTO notifications (tenant_id,category,title,description,related_entity,related_id,due_date,priority,status)
         SELECT $1,'emi'::reminder_category,$2,$3,'emi_installment',$4,$5::date,$6::priority,'open'
         WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.tenant_id=$1 AND n.category='emi' AND n.related_id=$4 AND n.due_date=$5::date)`,
        [tenantId, `${e.asset_code} — EMI #${e.installment_number}`, ev.label, e.id, e.due_date,
          ev.status === 'overdue' ? 'critical' : 'high'],
      );
      raised += inserted.rowCount ?? 0;
    }
    return raised;
  });
}

/** Claim and process queued XLSX export jobs durably (survives API restarts). */
async function processExports(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (c) => {
    const jobs = await c.query(
      `SELECT * FROM export_jobs WHERE tenant_id=$1 AND status='queued'
       ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED`,
      [tenantId],
    );
    let done = 0;
    for (const job of jobs.rows as any[]) {
      try {
        await c.query("UPDATE export_jobs SET status='running' WHERE id=$1 AND tenant_id=$2", [job.id, tenantId]);
        const buffer = await buildExport(c, tenantId, job.kind as ExportKind, job.parameters ?? {});
        const key = exportKey(tenantId, job.id);
        await saveObject(key, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        await c.query(
          "UPDATE export_jobs SET status='completed', result_key=$3, completed_at=now() WHERE id=$1 AND tenant_id=$2",
          [job.id, tenantId, key],
        );
        done++;
      } catch (err) {
        await c.query(
          "UPDATE export_jobs SET status='failed', error=$3 WHERE id=$1 AND tenant_id=$2",
          [job.id, tenantId, String(err)],
        );
      }
    }
    return done;
  });
}

/** Hour-based service reminders: due point = hours logged since last service. */
async function serviceHoursTick(tenantId: string): Promise<number> {
  const machines = await pool.query(
    `SELECT id, tenant_id, asset_code, service_frequency_value, service_reminder_lead_hours, last_service_date
     FROM machines WHERE tenant_id=$1 AND service_frequency_unit='hours' AND deleted_at IS NULL
       AND last_service_date IS NOT NULL`,
    [tenantId],
  );
  let raised = 0;
  for (const m of machines.rows as any[]) {
    const logged = await pool.query(
      `SELECT COALESCE(sum(working_hours),0)::numeric AS h FROM machine_working_logs
       WHERE tenant_id=$1 AND machine_id=$2 AND log_date > $3::date AND approval_status <> 'rejected'`,
      [m.tenant_id, m.id, m.last_service_date],
    );
    const ev = evaluateServiceHours(
      Number(logged.rows[0]?.h ?? 0), m.service_frequency_value, m.service_reminder_lead_hours ?? 50,
    );
    if (ev.status === 'none') continue;
    await withTenant(m.tenant_id, async (c) => {
      const r = await c.query(
        `INSERT INTO notifications (tenant_id,category,title,description,related_entity,related_id,due_date,priority,status)
         SELECT $1,'service'::reminder_category,$2,$3,'machine',$4,$5::date,$6::priority,'open'
         WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.tenant_id=$1 AND n.category='service'
                           AND n.related_id=$4 AND n.due_date=$5::date AND n.title=$2)`,
        [m.tenant_id, `${m.asset_code} — service`, ev.label, m.id, m.last_service_date,
          ev.status === 'overdue' ? 'critical' : ev.status === 'due_today' ? 'high' : 'medium'],
      );
      raised += r.rowCount ?? 0;
    });
  }
  return raised;
}

async function tick() {
  for (const t of await tenants()) {
    try {
      const published = await drainOutbox(t);
      const raised = await evaluateReminders(t);
      const serviceHours = await serviceHoursTick(t);
      if (published || raised || serviceHours) {
        console.log(`[worker] tenant ${t}: ${published} events, ${raised} reminders, ${serviceHours} service-hours alerts`);
      }
    } catch (err) {
      console.error(`[worker] tenant ${t} failed:`, err);
    }
  }
}

async function exportTick() {
  for (const t of await tenants()) {
    try {
      const done = await processExports(t);
      if (done) console.log(`[worker] tenant ${t}: ${done} exports completed`);
    } catch (err) {
      console.error(`[worker] tenant ${t} export failed:`, err);
    }
  }
}

async function main() {
  console.log(`[worker] started (${config.APP_TIMEZONE})`);
  await tick();
  await exportTick();
  const timer = setInterval(() => { if (running) void tick(); }, 6 * 60 * 60 * 1000);
  const exportTimer = setInterval(() => { if (running) void exportTick(); }, 5_000);
  const shutdown = async () => {
    running = false;
    clearInterval(timer);
    clearInterval(exportTimer);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error(err); process.exit(1); });
