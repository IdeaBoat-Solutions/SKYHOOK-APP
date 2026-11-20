/**
 * One-shot replacement for server/src/worker/index.ts.
 * No timers — invoke from Supabase Cron (pg_cron + vault) or any external cron
 * with header: x-cron-secret: <CRON_SECRET>.
 * Deploy: supabase functions deploy worker --no-verify-jwt
 */
import { config, requireConfig } from '../_shared/config.ts';
import { query, withTenant } from '../_shared/db.ts';
import { corsHeaders, json, problem, requestId } from '../_shared/http.ts';
import { ApiError } from '../_shared/errors.ts';
import { buildExport, type ExportKind } from '../_shared/export.ts';
import { exportKey, saveObject } from '../_shared/storage.ts';

function businessDate(): string {
  return config.DEMO_DATE ?? new Date().toISOString().split('T')[0]!;
}

function evaluateReminderStatus(dueDateStr: string | null | undefined, leadDays: number, currentDateStr: string) {
  if (!dueDateStr) return { status: 'none' as const, label: 'No Due Date' };
  const due = new Date(dueDateStr);
  const curr = new Date(currentDateStr);
  const utc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const daysRemaining = Math.round((utc(due) - utc(curr)) / 86_400_000);
  if (daysRemaining < 0) {
    const n = Math.abs(daysRemaining);
    return { status: 'overdue' as const, label: `Overdue by ${n} Day${n === 1 ? '' : 's'}` };
  }
  if (daysRemaining === 0) return { status: 'due_today' as const, label: 'Due Today' };
  if (daysRemaining <= leadDays) {
    return { status: 'upcoming' as const, label: `Due in ${daysRemaining} Day${daysRemaining === 1 ? '' : 's'}` };
  }
  return { status: 'none' as const, label: `Scheduled (${daysRemaining} days away)` };
}

function evaluateServiceHours(usedHours: number, dueAfterHours: number, leadHours: number) {
  const used = Math.max(0, Number(usedHours) || 0);
  const dueAfter = Math.max(0, Number(dueAfterHours) || 0);
  const remaining = dueAfter - used;
  const lead = Math.max(0, Number(leadHours) || 0);
  if (remaining < 0) {
    const n = Math.abs(Math.round(remaining));
    return { status: 'overdue' as const, label: `Overdue by ${n} h` };
  }
  if (remaining === 0) return { status: 'due_today' as const, label: 'Service due now' };
  if (remaining <= lead) return { status: 'upcoming' as const, label: `${Math.round(remaining)} h remaining` };
  return { status: 'none' as const, label: `Scheduled (${Math.round(remaining)} h away)` };
}

/** Hour-based service reminders: sum approved operating hours since last service. */
async function serviceHoursTick(tenantId: string): Promise<number> {
  const machines = await query(
    `SELECT id, asset_code, service_frequency_value, service_reminder_lead_hours, last_service_date
     FROM machines WHERE tenant_id=$1 AND service_frequency_unit='hours' AND deleted_at IS NULL
       AND last_service_date IS NOT NULL`,
    [tenantId],
  );
  let raised = 0;
  for (const m of machines.rows) {
    const logged = await query(
      `SELECT COALESCE(sum(working_hours),0)::numeric AS h FROM machine_working_logs
       WHERE tenant_id=$1 AND machine_id=$2 AND log_date > $3::date AND approval_status <> 'rejected'`,
      [tenantId, m.id, m.last_service_date],
    );
    const ev = evaluateServiceHours(
      Number(logged.rows[0]?.h ?? 0), m.service_frequency_value, m.service_reminder_lead_hours ?? 50,
    );
    if (ev.status === 'none') continue;
    await withTenant(tenantId, async (c) => {
      const r = await c.query(
        `INSERT INTO notifications (tenant_id,category,title,description,related_entity,related_id,due_date,priority,status)
         SELECT $1,'service'::reminder_category,$2,$3,'machine',$4,$5::date,$6::priority,'open'
         WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.tenant_id=$1 AND n.category='service'
                           AND n.related_id=$4 AND n.due_date=$5::date AND n.title=$2)`,
        [tenantId, `${m.asset_code} — service`, ev.label, m.id, m.last_service_date,
          ev.status === 'overdue' ? 'critical' : ev.status === 'due_today' ? 'high' : 'medium'],
      );
      raised += r.rowCount ?? 0;
    });
  }
  return raised;
}

async function drainOutbox(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (c) => {
    const events = await c.query(
      `SELECT * FROM outbox WHERE tenant_id=$1 AND published_at IS NULL
       ORDER BY occurred_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
      [tenantId],
    );
    let count = 0;
    for (const e of events.rows) {
      const title = e.event_type.replace(/_/g, ' ').toLowerCase().replace(/^./, (x: string) => x.toUpperCase());
      await c.query(
        `INSERT INTO notifications (tenant_id,category,title,description,related_entity,related_id,due_date,priority,status)
         SELECT $1,
           CASE WHEN $2 LIKE 'EMI%' THEN 'emi' WHEN $2 LIKE 'PAYROLL%' THEN 'payroll'
                WHEN $2 LIKE 'ATTENDANCE%' THEN 'attendance' ELSE 'service' END::reminder_category,
           $3,$4,$5,$6,NULL,
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

async function evaluateReminders(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (c) => {
    const rules = await c.query('SELECT category, lead_days FROM reminder_rules WHERE tenant_id=$1 AND enabled', [tenantId]);
    const lead = (cat: string) => rules.rows.find((r: any) => r.category === cat)?.lead_days ?? 15;
    const today = businessDate();
    let raised = 0;

    const renewals = await c.query('SELECT * FROM v_upcoming_renewals WHERE tenant_id=$1 AND due_date IS NOT NULL', [tenantId]);
    for (const r of renewals.rows) {
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
    for (const e of emi.rows) {
      const ev = evaluateReminderStatus(e.due_date, lead('emi'), today);
      if (ev.status === 'none') continue;
      const inserted = await c.query(
        `INSERT INTO notifications (tenant_id,category,title,description,related_entity,related_id,due_date,priority,status)
         SELECT $1,'emi'::reminder_category,$2,$3,'emi_installment',$4,$5::date,$6::priority,'open'
         WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.tenant_id=$1 AND n.category='emi' AND n.related_id=$4 AND n.due_date=$5::date)`,
        [tenantId, `${e.asset_code} — EMI #${e.installment_number}`, ev.label, e.id, e.due_date,
          ev.status === 'overdue' ? 'critical' : ev.status === 'due_today' ? 'high' : 'medium'],
      );
      raised += inserted.rowCount ?? 0;
    }
    return raised;
  });
}

/** Claim and process queued XLSX export jobs durably (FOR UPDATE SKIP LOCKED). */
async function processExports(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (c) => {
    const jobs = await c.query(
      `SELECT * FROM export_jobs WHERE tenant_id=$1 AND status='queued'
       ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED`,
      [tenantId],
    );
    let done = 0;
    for (const job of jobs.rows) {
      try {
        await c.query("UPDATE export_jobs SET status='running' WHERE id=$1 AND tenant_id=$2", [job.id, tenantId]);
        const bytes = await buildExport(c, tenantId, job.kind as ExportKind, job.parameters ?? {});
        await saveObject(exportKey(tenantId, job.id), bytes,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        await c.query(
          "UPDATE export_jobs SET status='completed', result_key=$3, completed_at=now() WHERE id=$1 AND tenant_id=$2",
          [job.id, tenantId, exportKey(tenantId, job.id)],
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

Deno.serve(async (req) => {
  const rid = requestId(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  try {
    requireConfig();
    if (!config.CRON_SECRET || req.headers.get('x-cron-secret') !== config.CRON_SECRET) {
      throw new ApiError(401, 'unauthorized', 'Unauthorized', 'Invalid cron secret');
    }
    const tenants = await query('SELECT id FROM tenants');
    const results: Array<{ tenantId: string; published: number; raised: number; serviceHours: number; exports: number }> = [];
    for (const t of tenants.rows) {
      const published = await drainOutbox(t.id);
      const raised = await evaluateReminders(t.id);
      const serviceHours = await serviceHoursTick(t.id);
      const exports = await processExports(t.id);
      results.push({ tenantId: t.id, published, raised, serviceHours, exports });
    }
    return json({ ok: true, ranAt: new Date().toISOString(), results });
  } catch (err) {
    return problem(err, rid, '/worker');
  }
});
