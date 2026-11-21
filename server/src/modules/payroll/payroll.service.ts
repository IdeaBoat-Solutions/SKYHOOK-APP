import type { PoolClient } from 'pg';
import type { AuthContext } from '../../auth/context.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';
import { calculatePayrollEntry } from '../../domain/calculations.js';

const MAX_RECOVERY_PAISE = 250_000; // ₹2,500 — configurable in a later phase

interface OtBucket {
  projectId: string;
  projectName: string;
  otHours: number;
  otRatePaisePerHour: number;
}

function monthBounds(month: string, paymentDay: number) {
  const [y, m] = month.split('-').map(Number);
  const year = y!;
  const mo = m!;
  const daysInMonth = new Date(year, mo, 0).getDate();
  const nextYear = mo === 12 ? year + 1 : year;
  const nextMonth = mo === 12 ? 1 : mo + 1;
  return {
    periodStart: `${month}-01`,
    periodEnd: `${month}-${String(daysInMonth).padStart(2, '0')}`,
    paymentDueDate: `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(paymentDay).padStart(2, '0')}`,
    daysInMonth,
  };
}

/** Generate (or regenerate a draft) payroll run for a month. Pure server-side computation. */
export async function generatePayroll(
  c: PoolClient,
  auth: AuthContext,
  month: string,
  requestId: string,
) {
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

  // Sequential: a pg client can only execute one query at a time.
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

  const rows = [] as Array<Record<string, unknown>>;
  const otBreakdowns: Array<Array<{ projectId: string; projectName: string; otHours: number; otRatePaisePerHour: number; amountPaise: number }>> = [];

  for (const emp of employees.rows as any[]) {
    const own = (attendance.rows as any[]).filter((a) => a.operator_id === emp.id);
    let presentDays = 0, halfDays = 0, absentDays = 0, unpaidLeaveDays = 0, paidLeaveDays = 0, weeklyOffDays = 0, holidayDays = 0;
    const otMap = new Map<string, OtBucket>();

    for (const a of own) {
      if (a.status === 'present') presentDays++;
      else if (a.status === 'half_day') halfDays++;
      else if (a.status === 'paid_leave') paidLeaveDays++;
      else if (a.status === 'unpaid_leave') unpaidLeaveDays++;
      else if (a.status === 'absent') absentDays++;
      else if (a.status === 'weekly_off') weeklyOffDays++;
      else if (a.status === 'holiday') holidayDays++;

      if (Number(a.overtime_hours) > 0) {
        const key = a.project_id as string;
        const bucket = otMap.get(key) ?? {
          projectId: key, projectName: a.project_name ?? key,
          otHours: 0, otRatePaisePerHour: a.ot_rate_paise_per_hour ?? 0,
        };
        bucket.otHours += Number(a.overtime_hours);
        otMap.set(key, bucket);
      }
    }

    const payableDays = emp.salary_type === 'daily'
      ? Math.max(0, presentDays + halfDays * 0.5)
      : Math.max(0, daysInMonth - unpaidLeaveDays - absentDays - halfDays * 0.5);
    // Monthly staff: a fixed salary spread over the days of the month. Each absent or
    // unpaid-leave day (and half of each half-day) is deducted at salary / days-in-month.
    // No approved attendance for a daily-wage employee means no pay. Monthly staff
    // still receive their full salary (payableDays already excludes unpaid leave).
    const effectivePayable = payableDays;
    const effectivePresent = presentDays;

    const advance = (advances.rows as any[]).find((a) => a.employee_id === emp.id);
    const outstanding = advance?.outstanding_paise ?? 0;

    const calc = calculatePayrollEntry({
      salaryType: emp.salary_type,
      dailyRatePaise: emp.daily_rate_paise,
      monthlySalaryPaise: emp.monthly_salary_paise,
      totalDaysInMonth: daysInMonth,
      payableDays: effectivePayable,
      otProjectBreakdown: [...otMap.values()],
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
      payableDays: effectivePayable,
      ...calc,
      advanceId: advance?.id ?? null,
    });
    otBreakdowns.push(calc.projectOtBreakdown);
  }

  const totals = rows.reduce((acc, r: any) => {
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
    const r = rows[i] as any;
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

export async function getRun(c: PoolClient, tenantId: string, runId: string) {
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

/** Approve & lock a draft run, posting advance recoveries to the append-only ledger. */
export async function approvePayroll(c: PoolClient, auth: AuthContext, runId: string, requestId: string) {
  const run = await c.query('SELECT * FROM payroll_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [auth.tenantId, runId]);
  if (!run.rows[0]) throw Errors.notFound('PayrollRun');
  if (run.rows[0].status !== 'draft') throw Errors.conflict('Only draft runs can be approved');

  const entries = await c.query('SELECT * FROM payroll_entries WHERE tenant_id=$1 AND payroll_run_id=$2', [auth.tenantId, runId]);
  for (const e of entries.rows as any[]) {
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
