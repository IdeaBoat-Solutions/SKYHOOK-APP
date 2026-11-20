/** Payroll module ported from server/src/modules/payroll (routes + service). */
import type { Route } from '../_shared/types.ts';
import { withTenant, withTenantRead, type Queryable } from '../_shared/db.ts';
import { json, readJson } from '../_shared/http.ts';
import { Errors } from '../_shared/errors.ts';
import { requirePermission } from '../_shared/rbac.ts';
import type { AuthContext } from '../_shared/auth.ts';

const MAX_RECOVERY_PAISE = 250_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- inlined pure/domain helpers ----------
async function writeAudit(c: Queryable, auth: AuthContext, input: {
  action: string; entity: string; entityId: string; reason?: string; requestId?: string;
}): Promise<void> {
  await c.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_name, action, entity, entity_id,
                             previous_value, updated_value, reason, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [auth.tenantId, auth.userId, auth.name, input.action, input.entity, input.entityId,
      null, null, input.reason ?? null, input.requestId ?? null],
  );
  await c.query(
    `INSERT INTO outbox (tenant_id, event_type, aggregate_type, aggregate_id, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [auth.tenantId, input.action, input.entity, input.entityId,
      JSON.stringify({ reason: input.reason ?? null, actor: auth.name })],
  );
}

async function idempotent<T>(
  tenantId: string, key: string, endpoint: string, requestHash: string,
  handler: (c: Queryable) => Promise<{ statusCode: number; body: T }>,
): Promise<{ statusCode: number; body: T }> {
  return withTenant(tenantId, async (c) => {
    const hit = await c.query(
      `SELECT status_code, response_body FROM idempotency_keys
       WHERE tenant_id = $1 AND key = $2 AND endpoint = $3 AND expires_at > now()`,
      [tenantId, key, endpoint],
    );
    if (hit.rows[0]) {
      return { statusCode: hit.rows[0].status_code as number, body: hit.rows[0].response_body as T };
    }
    const result = await handler(c);
    await c.query(
      `INSERT INTO idempotency_keys
         (tenant_id, key, endpoint, request_hash, status_code, response_body, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + interval '24 hours')
       ON CONFLICT (tenant_id, key, endpoint) DO NOTHING`,
      [tenantId, key, endpoint, requestHash, result.statusCode, JSON.stringify(result.body)],
    );
    return result;
  });
}

function calculatePayrollEntry(input: {
  salaryType: string; dailyRatePaise: number; monthlySalaryPaise: number; totalDaysInMonth: number;
  payableDays: number; otProjectBreakdown: any[]; approvedOutstandingAdvancePaise: number;
  maxAdvanceRecoveryRequestedPaise: number; allowancesPaise?: number; otherDeductionsPaise?: number;
}) {
  const basePaise = input.salaryType === 'daily'
    ? Math.round(input.payableDays * input.dailyRatePaise)
    : Math.round((input.monthlySalaryPaise / Math.max(1, input.totalDaysInMonth)) * input.payableDays);

  let totalOtHours = 0;
  let totalOtPaise = 0;
  const projectOtBreakdown = input.otProjectBreakdown.map((item) => {
    const hours = round2(item.otHours);
    const amountPaise = Math.round(hours * item.otRatePaisePerHour);
    totalOtHours += hours;
    totalOtPaise += amountPaise;
    return { ...item, otHours: hours, amountPaise };
  });
  totalOtHours = round2(totalOtHours);

  const allowancesPaise = Math.max(0, input.allowancesPaise ?? 0);
  const grossPaise = basePaise + totalOtPaise + allowancesPaise;
  const outstanding = Math.max(0, input.approvedOutstandingAdvancePaise ?? 0);
  const requested = Math.max(0, input.maxAdvanceRecoveryRequestedPaise ?? outstanding);
  const advanceRecoveryPaise = Math.min(outstanding, requested, grossPaise);
  const otherDeductionsPaise = Math.max(0, input.otherDeductionsPaise ?? 0);
  const totalDeductionsPaise = advanceRecoveryPaise + otherDeductionsPaise;
  return {
    basePaise, totalOtHours, totalOtPaise, projectOtBreakdown, grossPaise, advanceRecoveryPaise,
    remainingAdvanceBalancePaise: outstanding - advanceRecoveryPaise,
    otherDeductionsPaise, totalDeductionsPaise, netPaise: Math.max(0, grossPaise - totalDeductionsPaise),
  };
}

function monthBounds(month: string, paymentDay: number) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y!, m!, 0).getDate();
  const nextYear = m === 12 ? y! + 1 : y!;
  const nextMonth = m === 12 ? 1 : m! + 1;
  return {
    periodStart: `${month}-01`,
    periodEnd: `${month}-${String(daysInMonth).padStart(2, '0')}`,
    paymentDueDate: `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(paymentDay).padStart(2, '0')}`,
    daysInMonth,
  };
}

async function getRun(c: Queryable, tenantId: string, runId: string) {
  const run = await c.query('SELECT * FROM payroll_runs WHERE tenant_id=$1 AND id=$2', [tenantId, runId]);
  if (!run.rows[0]) throw Errors.notFound('PayrollRun');
  const entries = await c.query(
    `SELECT e.*, COALESCE(json_agg(b) FILTER (WHERE b.id IS NOT NULL),'[]') AS ot_breakdown
     FROM payroll_entries e LEFT JOIN payroll_ot_breakdowns b ON b.payroll_entry_id=e.id
     WHERE e.tenant_id=$1 AND e.payroll_run_id=$2 GROUP BY e.id ORDER BY e.employee_code`,
    [tenantId, runId],
  );
  return { ...run.rows[0], entries: entries.rows };
}

async function generatePayroll(c: Queryable, auth: AuthContext, month: string, requestId: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw Errors.badRequest('month must be YYYY-MM');

  const settings = await c.query(
    'SELECT standard_shift_minutes, payroll_payment_day FROM company_settings WHERE tenant_id=$1',
    [auth.tenantId],
  );
  const { periodStart, periodEnd, paymentDueDate, daysInMonth } = monthBounds(
    month, settings.rows[0]?.payroll_payment_day ?? 15,
  );
  const existing = await c.query(
    'SELECT id, locked, status FROM payroll_runs WHERE tenant_id=$1 AND month=$2::date',
    [auth.tenantId, `${month}-01`],
  );
  if (existing.rows[0]?.locked) throw Errors.locked('Payroll run is approved and locked');

  const employees = await c.query(
    `SELECT * FROM employees WHERE tenant_id=$1 AND status='active' AND deleted_at IS NULL ORDER BY employee_code`,
    [auth.tenantId],
  );
  const attendance = await c.query(
    `SELECT a.*, p.name AS project_name FROM attendance_records a
     LEFT JOIN projects p ON p.id=a.project_id
     WHERE a.tenant_id=$1 AND a.attendance_date BETWEEN $2::date AND $3::date
       AND a.approval_status='approved'`,
    [auth.tenantId, periodStart, periodEnd],
  );
  const advances = await c.query(
    `SELECT * FROM salary_advances WHERE tenant_id=$1 AND outstanding_paise > 0 AND status<>'cancelled'`,
    [auth.tenantId],
  );

  const rows: any[] = [];
  const otBreakdowns: any[][] = [];

  for (const emp of employees.rows) {
    const own = attendance.rows.filter((a: any) => a.operator_id === emp.id);
    let presentDays = 0, halfDays = 0, unpaidLeaveDays = 0, paidLeaveDays = 0, weeklyOffDays = 0, holidayDays = 0;
    const otMap = new Map<string, any>();
    for (const a of own) {
      if (a.status === 'present') presentDays++;
      else if (a.status === 'half_day') halfDays++;
      else if (a.status === 'paid_leave') paidLeaveDays++;
      else if (a.status === 'unpaid_leave') unpaidLeaveDays++;
      else if (a.status === 'weekly_off') weeklyOffDays++;
      else if (a.status === 'holiday') holidayDays++;
      if (Number(a.overtime_hours) > 0) {
        const key = a.project_id as string;
        const bucket = otMap.get(key) ?? {
          projectId: key, projectName: a.project_name ?? key, otHours: 0,
          otRatePaisePerHour: a.ot_rate_paise_per_hour ?? 0,
        };
        bucket.otHours += Number(a.overtime_hours);
        otMap.set(key, bucket);
      }
    }

    const payableDays = emp.salary_type === 'daily'
      ? Math.max(0, presentDays + halfDays * 0.5)
      : Math.max(0, daysInMonth - unpaidLeaveDays);
    // No approved attendance for a daily-wage employee means no pay. Monthly staff
    // still receive their full salary (payableDays already excludes unpaid leave).
    const effectivePayable = payableDays;
    const effectivePresent = presentDays;
    const advance = advances.rows.find((a: any) => a.employee_id === emp.id);
    const outstanding = advance?.outstanding_paise ?? 0;

    const calc = calculatePayrollEntry({
      salaryType: emp.salary_type, dailyRatePaise: emp.daily_rate_paise,
      monthlySalaryPaise: emp.monthly_salary_paise, totalDaysInMonth: daysInMonth,
      payableDays: effectivePayable, otProjectBreakdown: [...otMap.values()],
      approvedOutstandingAdvancePaise: outstanding,
      maxAdvanceRecoveryRequestedPaise: Math.min(outstanding, MAX_RECOVERY_PAISE),
    });

    rows.push({
      employeeId: emp.id, employeeCode: emp.employee_code, employeeName: emp.full_name,
      designation: emp.designation, salaryType: emp.salary_type,
      appliedDailyRatePaise: emp.daily_rate_paise, appliedMonthlyRatePaise: emp.monthly_salary_paise,
      standardShiftMinutes: emp.standard_shift_minutes, totalDaysInMonth: daysInMonth,
      presentDays: effectivePresent, halfDays, paidLeaveDays, unpaidLeaveDays,
      weeklyOffDays: weeklyOffDays || 4, holidayDays: holidayDays || 2,
      payableDays: effectivePayable, ...calc, advanceId: advance?.id ?? null,
    });
    otBreakdowns.push(calc.projectOtBreakdown);
  }

  const totals = rows.reduce((acc, r) => {
    acc.base += r.basePaise; acc.ot += r.totalOtPaise; acc.allowances += r.allowancesPaise ?? 0;
    acc.gross += r.grossPaise; acc.recovery += r.advanceRecoveryPaise;
    acc.other += r.otherDeductionsPaise; acc.net += r.netPaise;
    return acc;
  }, { base: 0, ot: 0, allowances: 0, gross: 0, recovery: 0, other: 0, net: 0 });

  let runId: string;
  if (existing.rows[0]) {
    await c.query('DELETE FROM payroll_entries WHERE tenant_id=$1 AND payroll_run_id=$2', [auth.tenantId, existing.rows[0].id]);
    const updated = await c.query(
      `UPDATE payroll_runs SET period_start=$3::date, period_end=$4::date, payment_due_date=$5::date,
        status='draft', locked=false, employee_count=$6, total_base_paise=$7, total_ot_paise=$8,
        total_allowances_paise=$9, total_gross_paise=$10, total_advance_recovery_paise=$11,
        total_other_deductions_paise=$12, total_net_paise=$13, total_paid_paise=0, updated_at=now()
       WHERE tenant_id=$1 AND id=$2 RETURNING id`,
      [auth.tenantId, existing.rows[0].id, periodStart, periodEnd, paymentDueDate, rows.length,
        totals.base, totals.ot, totals.allowances, totals.gross, totals.recovery, totals.other, totals.net],
    );
    runId = updated.rows[0].id;
  } else {
    const inserted = await c.query(
      `INSERT INTO payroll_runs (tenant_id,run_code,month,period_start,period_end,payment_due_date,
        status,employee_count,total_base_paise,total_ot_paise,total_allowances_paise,total_gross_paise,
        total_advance_recovery_paise,total_other_deductions_paise,total_net_paise,created_by)
       VALUES ($1,$2,$3::date,$4::date,$5::date,$6::date,'draft',$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [auth.tenantId, `PR-${month}`, `${month}-01`, periodStart, periodEnd, paymentDueDate, rows.length,
        totals.base, totals.ot, totals.allowances, totals.gross, totals.recovery, totals.other, totals.net, auth.userId],
    );
    runId = inserted.rows[0].id;
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const e = await c.query(
      `INSERT INTO payroll_entries (tenant_id,payroll_run_id,employee_id,employee_code,employee_name,
        designation,salary_type,applied_daily_rate_paise,applied_monthly_rate_paise,standard_shift_minutes,
        total_days_in_month,present_days,half_days,paid_leave_days,unpaid_leave_days,weekly_off_days,
        holiday_days,payable_days,base_paise,total_ot_hours,ot_paise,allowances_paise,gross_paise,
        advance_recovery_paise,other_deductions_paise,total_deductions_paise,net_paise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       RETURNING id`,
      [auth.tenantId, runId, r.employeeId, r.employeeCode, r.employeeName, r.designation, r.salaryType,
        r.appliedDailyRatePaise, r.appliedMonthlyRatePaise, r.standardShiftMinutes, r.totalDaysInMonth,
        r.presentDays, r.halfDays, r.paidLeaveDays, r.unpaidLeaveDays, r.weeklyOffDays, r.holidayDays,
        r.payableDays, r.basePaise, r.totalOtHours, r.totalOtPaise, 0, r.grossPaise,
        r.advanceRecoveryPaise, r.otherDeductionsPaise, r.totalDeductionsPaise, r.netPaise],
    );
    const entryId = e.rows[0].id;
    for (const b of otBreakdowns[i] ?? []) {
      await c.query(
        `INSERT INTO payroll_ot_breakdowns (tenant_id,payroll_entry_id,project_id,project_name,ot_hours,ot_rate_paise_per_hour,amount_paise)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [auth.tenantId, entryId, b.projectId, b.projectName, b.otHours, b.otRatePaisePerHour, b.amountPaise],
      );
    }
  }

  await writeAudit(c, auth, {
    action: 'PAYROLL_GENERATED', entity: 'PayrollRun', entityId: runId,
    reason: `Generated draft payroll for ${month}`, requestId,
  });
  return getRun(c, auth.tenantId, runId);
}

async function approvePayroll(c: Queryable, auth: AuthContext, runId: string, requestId: string) {
  const run = await c.query('SELECT * FROM payroll_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [auth.tenantId, runId]);
  if (!run.rows[0]) throw Errors.notFound('PayrollRun');
  if (run.rows[0].status !== 'draft') throw Errors.conflict('Only draft runs can be approved');

  const entries = await c.query('SELECT * FROM payroll_entries WHERE tenant_id=$1 AND payroll_run_id=$2', [auth.tenantId, runId]);
  for (const e of entries.rows) {
    if (e.advance_recovery_paise <= 0 || !e.employee_code) continue;
    const adv = await c.query(
      `SELECT * FROM salary_advances WHERE tenant_id=$1 AND employee_id=$2 AND outstanding_paise>0
       ORDER BY created_at LIMIT 1`,
      [auth.tenantId, e.employee_id],
    );
    const a = adv.rows[0];
    if (!a) continue;
    const amount = Math.min(e.advance_recovery_paise, a.outstanding_paise);
    const newRecovery = a.recovery_paise + amount;
    const newOutstanding = a.amount_paise - newRecovery;
    await c.query(
      `INSERT INTO advance_recoveries (tenant_id,advance_id,payroll_run_id,payroll_entry_id,amount_paise,recovery_date)
       VALUES ($1,$2,$3,$4,$5,CURRENT_DATE)
       ON CONFLICT (tenant_id,payroll_run_id,advance_id) DO NOTHING`,
      [auth.tenantId, a.id, runId, e.id, amount],
    );
    await c.query(
      `UPDATE salary_advances SET recovery_paise=$3, outstanding_paise=$4,
        status=(CASE WHEN $4::bigint=0 THEN 'fully_recovered' ELSE 'partially_recovered' END)::advance_status,
        version=version+1
       WHERE tenant_id=$1 AND id=$2`,
      [auth.tenantId, a.id, newRecovery, newOutstanding],
    );
  }

  const updated = await c.query(
    `UPDATE payroll_runs SET status='approved', locked=true, approved_at=now(), approved_by=$3, version=version+1
     WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [auth.tenantId, runId, auth.userId],
  );
  await writeAudit(c, auth, {
    action: 'PAYROLL_APPROVED', entity: 'PayrollRun', entityId: runId,
    reason: 'Owner approved and locked payroll; advance balances updated', requestId,
  });
  return updated.rows[0];
}

// ---------- routes ----------
function idemKey(req: Request): string {
  return req.headers.get('idempotency-key') || crypto.randomUUID();
}
async function hash(body: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body ?? {})));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const PAYMENT_MODES = ['cash', 'bank_transfer', 'upi', 'cheque', 'company_card'];

/** Map a stored adjustment row to the shape the UI works with. */
function toAdjustment(r: any) {
  return {
    id: r.id as string,
    month: r.month as string,
    employeeCode: r.employee_code as string,
    type: r.kind as 'pay' | 'deduction',
    label: r.label as string,
    amount: Number(r.amount_paise) / 100,
    remarks: r.remarks ?? undefined,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

async function assertUnlocked(c: Queryable, tenantId: string, month: string): Promise<void> {
  const locked = await c.query(
    `SELECT 1 FROM payroll_runs
     WHERE tenant_id=$1 AND to_char(month,'YYYY-MM')=$2 AND locked=true`,
    [tenantId, month],
  );
  if (locked.rows[0]) throw Errors.locked('Payroll run is approved and locked');
}

export const payrollRoutes: Route[] = [
  {
    method: 'GET', path: '/payroll/runs',
    handler: async (ctx) => {
      requirePermission(ctx.auth!, 'payroll:read');
      const month = ctx.url.searchParams.get('month');
      if (month && !/^\d{4}-\d{2}$/.test(month)) throw Errors.validation([{ field: 'month', message: 'Must be YYYY-MM' }]);
      return json(await withTenantRead(ctx.auth!.tenantId, async (c) => {
        const r = await c.query(
          `SELECT * FROM payroll_runs WHERE tenant_id=$1 AND ($2::text IS NULL OR to_char(month,'YYYY-MM')=$2)
           ORDER BY month DESC`,
          [ctx.auth!.tenantId, month ?? null],
        );
        return { items: r.rows };
      }));
    },
  },
  {
    method: 'GET', path: '/payroll/runs/:id',
    handler: async (ctx) => {
      requirePermission(ctx.auth!, 'payroll:read');
      return json(await withTenantRead(ctx.auth!.tenantId, (c) => getRun(c, ctx.auth!.tenantId, ctx.params.id)));
    },
  },
  {
    method: 'POST', path: '/payroll/runs/generate',
    handler: async (ctx, req) => {
      requirePermission(ctx.auth!, 'payroll:generate');
      const b = await readJson(req);
      if (typeof b.month !== 'string' || !/^\d{4}-\d{2}$/.test(b.month)) {
        throw Errors.validation([{ field: 'month', message: 'Must be YYYY-MM' }]);
      }
      const result = await idempotent(
        ctx.auth!.tenantId, idemKey(req), 'POST /payroll/runs/generate', await hash(b),
        async (c) => ({ statusCode: 201, body: await generatePayroll(c, ctx.auth!, b.month, ctx.requestId) }),
      );
      return json(result.body, result.statusCode);
    },
  },
  {
    method: 'POST', path: '/payroll/runs/:id/approve',
    handler: async (ctx, req) => {
      requirePermission(ctx.auth!, 'payroll:approve');
      const b = await readJson(req);
      const result = await idempotent(
        ctx.auth!.tenantId, idemKey(req), `POST /payroll/runs/${ctx.params.id}/approve`, await hash(b),
        async (c) => ({ statusCode: 200, body: await approvePayroll(c, ctx.auth!, ctx.params.id, ctx.requestId) }),
      );
      return json(result.body, result.statusCode);
    },
  },
  {
    method: 'POST', path: '/payroll/runs/:id/entries/:entryId/payment',
    handler: async (ctx, req) => {
      requirePermission(ctx.auth!, 'payroll:pay');
      const b = await readJson(req);
      if (!PAYMENT_MODES.includes(b.paymentMode)) {
        throw Errors.validation([{ field: 'paymentMode', message: `Must be one of ${PAYMENT_MODES.join(', ')}` }]);
      }
      const { id, entryId } = ctx.params;
      const result = await idempotent(
        ctx.auth!.tenantId, idemKey(req),
        `POST /payroll/runs/${id}/entries/${entryId}/payment`, await hash(b),
        async (c) => {
          const entry = await c.query(
            `UPDATE payroll_entries SET payment_status='paid', payment_date=CURRENT_DATE,
               payment_mode=$4, payment_reference=$5
             WHERE tenant_id=$1 AND payroll_run_id=$2 AND id=$3 AND payment_status='unpaid' RETURNING *`,
            [ctx.auth!.tenantId, id, entryId, b.paymentMode, b.paymentReference ?? 'NEFT-PROCESSED'],
          );
          if (!entry.rows[0]) throw Errors.notFound('Unpaid payroll entry');
          const totals = await c.query(
            `SELECT COALESCE(sum(net_paise) FILTER (WHERE payment_status='paid'),0)::bigint AS paid,
                    count(*) FILTER (WHERE payment_status='unpaid')::int AS remaining
             FROM payroll_entries WHERE tenant_id=$1 AND payroll_run_id=$2`,
            [ctx.auth!.tenantId, id],
          );
          await c.query(
            `UPDATE payroll_runs SET total_paid_paise=$3,
               status=(CASE WHEN $4::int=0 THEN 'paid' ELSE 'partially_paid' END)::payroll_status,
               version=version+1
             WHERE tenant_id=$1 AND id=$2`,
            [ctx.auth!.tenantId, id, totals.rows[0].paid, totals.rows[0].remaining],
          );
          await writeAudit(c, ctx.auth!, {
            action: 'PAYROLL_PAYMENT_RECORDED', entity: 'PayrollEntry', entityId: entryId,
            reason: `Salary payment via ${b.paymentMode}`, requestId: ctx.requestId,
          });
          return { statusCode: 200, body: entry.rows[0] };
        },
      );
      return json(result.body, result.statusCode);
    },
  },

  /* ---- Custom pay & deduction lines ---- */
  {
    method: 'GET', path: '/payroll/adjustments',
    handler: async (ctx) => {
      requirePermission(ctx.auth!, 'payroll:read');
      const month = ctx.url.searchParams.get('month');
      const employeeCode = ctx.url.searchParams.get('employeeCode');
      if (month && !/^\d{4}-\d{2}$/.test(month)) {
        throw Errors.validation([{ field: 'month', message: 'Must be YYYY-MM' }]);
      }
      return json(await withTenantRead(ctx.auth!.tenantId, async (c) => {
        const r = await c.query(
          `SELECT id, month, employee_code, kind, label, amount_paise, remarks, created_at
           FROM payroll_adjustments
           WHERE tenant_id = $1
             AND ($2::text IS NULL OR month = $2)
             AND ($3::text IS NULL OR employee_code = $3)
           ORDER BY created_at, id`,
          [ctx.auth!.tenantId, month, employeeCode],
        );
        return { items: r.rows.map(toAdjustment) };
      }));
    },
  },
  {
    method: 'POST', path: '/payroll/adjustments',
    handler: async (ctx, req) => {
      requirePermission(ctx.auth!, 'payroll:adjust');
      const b = await readJson(req);
      if (typeof b.month !== 'string' || !/^\d{4}-\d{2}$/.test(b.month)) {
        throw Errors.validation([{ field: 'month', message: 'Must be YYYY-MM' }]);
      }
      if (typeof b.employeeCode !== 'string' || !b.employeeCode.trim()) {
        throw Errors.validation([{ field: 'employeeCode', message: 'Required' }]);
      }
      if (b.type !== 'pay' && b.type !== 'deduction') {
        throw Errors.validation([{ field: 'type', message: "Must be 'pay' or 'deduction'" }]);
      }
      if (typeof b.label !== 'string' || !b.label.trim() || b.label.trim().length > 120) {
        throw Errors.validation([{ field: 'label', message: 'Must be 1 to 120 characters' }]);
      }
      const amount = Number(b.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw Errors.validation([{ field: 'amount', message: 'Must be a positive amount' }]);
      }
      const amountPaise = Math.round(amount * 100);

      return json(await withTenant(ctx.auth!.tenantId, async (c) => {
        await assertUnlocked(c, ctx.auth!.tenantId, b.month);
        const r = await c.query(
          `INSERT INTO payroll_adjustments
             (tenant_id, month, employee_code, kind, label, amount_paise, remarks, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id, month, employee_code, kind, label, amount_paise, remarks, created_at`,
          [ctx.auth!.tenantId, b.month, b.employeeCode.trim(), b.type, b.label.trim(),
            amountPaise, b.remarks?.trim() || null, ctx.auth!.userId],
        );
        await writeAudit(c, ctx.auth!, {
          action: 'PAYROLL_ADJUSTMENT_ADDED',
          entity: 'PayrollAdjustment',
          entityId: r.rows[0].id,
          reason: `${b.type} '${b.label.trim()}' for ${b.employeeCode} · ${b.month}`,
          requestId: ctx.requestId,
        });
        return toAdjustment(r.rows[0]);
      }), 201);
    },
  },
  {
    method: 'DELETE', path: '/payroll/adjustments/:id',
    handler: async (ctx) => {
      requirePermission(ctx.auth!, 'payroll:adjust');
      return json(await withTenant(ctx.auth!.tenantId, async (c) => {
        const existing = await c.query(
          `SELECT month, employee_code, kind, label FROM payroll_adjustments
           WHERE tenant_id=$1 AND id=$2`,
          [ctx.auth!.tenantId, ctx.params.id],
        );
        if (!existing.rows[0]) throw Errors.notFound('Payroll adjustment');
        await assertUnlocked(c, ctx.auth!.tenantId, existing.rows[0].month);
        await c.query('DELETE FROM payroll_adjustments WHERE tenant_id=$1 AND id=$2',
          [ctx.auth!.tenantId, ctx.params.id]);
        await writeAudit(c, ctx.auth!, {
          action: 'PAYROLL_ADJUSTMENT_REMOVED',
          entity: 'PayrollAdjustment',
          entityId: ctx.params.id,
          reason: `Removed ${existing.rows[0].kind} '${existing.rows[0].label}'`,
          requestId: ctx.requestId,
        });
        return undefined;
      }), 204);
    },
  },
];
