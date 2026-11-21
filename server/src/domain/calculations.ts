/**
 * Pure business calculations — server-side port of src/utils/calculations.ts.
 * Money is integer paise; hours are rounded to 2 decimals.
 * No I/O, deterministic, fully unit-tested.
 */

export interface TimeDurationResult {
  totalSpanMinutes: number;
  netWorkingMinutes: number;
  netWorkingHours: number;
  potentialOtMinutes: number;
  potentialOtHours: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseTimeToMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  const str = time.includes('T') ? (time.split('T')[1] ?? '') : time;
  const [h = '0', m = '0'] = str.split(':');
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}

export function calculateWorkingAndOt(
  startTime: string,
  endTime: string,
  unpaidBreakMinutes = 0,
  standardShiftMinutes = 600,
): TimeDurationResult {
  const start = parseTimeToMinutes(startTime);
  let end = parseTimeToMinutes(endTime);
  if (end < start) end += 1440; // overnight shift
  const totalSpanMinutes = Math.max(0, end - start);
  const netWorkingMinutes = Math.max(0, totalSpanMinutes - Math.max(0, unpaidBreakMinutes));
  const netWorkingHours = round2(netWorkingMinutes / 60);
  const potentialOtMinutes = Math.max(0, netWorkingMinutes - standardShiftMinutes);
  return {
    totalSpanMinutes,
    netWorkingMinutes,
    netWorkingHours,
    potentialOtMinutes,
    potentialOtHours: round2(potentialOtMinutes / 60),
  };
}

export interface WorkSegmentInput {
  projectId: string;
  projectName: string;
  otRatePaisePerHour: number;
  startTime: string;
  endTime: string;
  unpaidBreakMinutes?: number;
}

export interface AllocatedSegment {
  projectId: string;
  projectName: string;
  netMinutes: number;
  standardMinutesAllocated: number;
  otMinutes: number;
  otHours: number;
  otRatePaisePerHour: number;
  otAmountPaise: number;
}

/** Allocate a single standard shift across multi-project segments without double counting. */
export function allocateDailyMultiProjectWork(
  segments: WorkSegmentInput[],
  standardDailyMinutes = 600,
): { totalNetMinutes: number; totalOtHours: number; totalOtPaise: number; allocatedSegments: AllocatedSegment[] } {
  let remaining = standardDailyMinutes;
  let totalNetMinutes = 0;
  let totalOtPaise = 0;
  const allocatedSegments: AllocatedSegment[] = [];

  for (const seg of segments) {
    const res = calculateWorkingAndOt(seg.startTime, seg.endTime, seg.unpaidBreakMinutes ?? 0, remaining);
    totalNetMinutes += res.netWorkingMinutes;
    const std = Math.min(remaining, res.netWorkingMinutes);
    remaining -= std;
    const otMinutes = res.netWorkingMinutes - std;
    const otHours = round2(otMinutes / 60);
    const otAmountPaise = Math.round(otHours * seg.otRatePaisePerHour);
    totalOtPaise += otAmountPaise;
    allocatedSegments.push({
      projectId: seg.projectId,
      projectName: seg.projectName,
      netMinutes: res.netWorkingMinutes,
      standardMinutesAllocated: std,
      otMinutes,
      otHours,
      otRatePaisePerHour: seg.otRatePaisePerHour,
      otAmountPaise,
    });
  }
  return { totalNetMinutes, totalOtHours: round2((totalNetMinutes - (standardDailyMinutes - remaining)) / 60), totalOtPaise, allocatedSegments };
}

export interface PayrollCalcInput {
  salaryType: 'daily' | 'monthly';
  dailyRatePaise: number;
  monthlySalaryPaise: number;
  totalDaysInMonth: number;
  payableDays: number;
  otProjectBreakdown: Array<{ projectId: string; projectName: string; otHours: number; otRatePaisePerHour: number }>;
  allowancesPaise?: number;
  approvedOutstandingAdvancePaise?: number;
  maxAdvanceRecoveryRequestedPaise?: number;
  otherDeductionsPaise?: number;
}

export interface PayrollCalcOutput {
  basePaise: number;
  totalOtHours: number;
  totalOtPaise: number;
  projectOtBreakdown: Array<{ projectId: string; projectName: string; otHours: number; otRatePaisePerHour: number; amountPaise: number }>;
  grossPaise: number;
  advanceRecoveryPaise: number;
  remainingAdvanceBalancePaise: number;
  otherDeductionsPaise: number;
  totalDeductionsPaise: number;
  netPaise: number;
}

export function calculatePayrollEntry(input: PayrollCalcInput): PayrollCalcOutput {
  const basePaise = input.salaryType === 'daily'
    ? Math.round(input.payableDays * input.dailyRatePaise)
    : Math.round((input.monthlySalaryPaise * input.payableDays) / Math.max(1, input.totalDaysInMonth));

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
    basePaise,
    totalOtHours,
    totalOtPaise,
    projectOtBreakdown,
    grossPaise,
    advanceRecoveryPaise,
    remainingAdvanceBalancePaise: outstanding - advanceRecoveryPaise,
    otherDeductionsPaise,
    totalDeductionsPaise,
    netPaise: Math.max(0, grossPaise - totalDeductionsPaise),
  };
}

export function evaluateReminderStatus(
  dueDateStr: string | null | undefined,
  leadDays: number,
  currentDateStr: string,
): { daysRemaining: number; status: 'overdue' | 'due_today' | 'upcoming' | 'none'; label: string } {
  if (!dueDateStr) return { daysRemaining: 9999, status: 'none', label: 'No Due Date' };
  const due = new Date(dueDateStr);
  const curr = new Date(currentDateStr);
  const utc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const daysRemaining = Math.round((utc(due) - utc(curr)) / 86_400_000);
  if (daysRemaining < 0) {
    const n = Math.abs(daysRemaining);
    return { daysRemaining, status: 'overdue', label: `Overdue by ${n} Day${n === 1 ? '' : 's'}` };
  }
  if (daysRemaining === 0) return { daysRemaining, status: 'due_today', label: 'Due Today' };
  if (daysRemaining <= leadDays) {
    return { daysRemaining, status: 'upcoming', label: `Due in ${daysRemaining} Day${daysRemaining === 1 ? '' : 's'}` };
  }
  return { daysRemaining, status: 'none', label: `Scheduled (${daysRemaining} days away)` };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Add whole days to a yyyy-mm-dd date using UTC arithmetic (no timezone / DST drift). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().split('T')[0]!;
}

/** Add calendar months; a day past the end of the target month clamps to its last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const total = y! * 12 + (m! - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${pad2(nm + 1)}-${pad2(Math.min(d!, lastDay))}`;
}

export function nextServiceDate(
  lastService: string, value: number, unit: 'days' | 'months' | 'hours',
): string {
  // Hour-based servicing has no calendar due date — the due point is a running
  // operating-hour reading (see evaluateServiceHours).
  if (unit === 'hours') return '';
  return unit === 'days' ? addDays(lastService, value) : addMonths(lastService, value);
}

export interface ServiceHoursStatus {
  hoursSinceService: number;
  dueAfterHours: number;
  hoursRemaining: number;
  status: 'overdue' | 'due_today' | 'upcoming' | 'none';
  label: string;
}

/** Evaluate a service due point measured in crane operating hours. */
export function evaluateServiceHours(
  loggedHoursSinceService: number,
  frequencyHours: number,
  leadHours: number,
): ServiceHoursStatus {
  const used = Math.max(0, Number(loggedHoursSinceService) || 0);
  const dueAfter = Math.max(0, Number(frequencyHours) || 0);
  const remaining = dueAfter - used;
  const lead = Math.max(0, Number(leadHours) || 0);

  if (remaining < 0) {
    const overdue = Math.abs(Math.round(remaining));
    return { hoursSinceService: used, dueAfterHours: dueAfter, hoursRemaining: remaining,
      status: 'overdue', label: `Overdue by ${overdue} h` };
  }
  if (remaining === 0) {
    return { hoursSinceService: used, dueAfterHours: dueAfter, hoursRemaining: 0,
      status: 'due_today', label: 'Service due now' };
  }
  if (remaining <= lead) {
    return { hoursSinceService: used, dueAfterHours: dueAfter, hoursRemaining: remaining,
      status: 'upcoming', label: `${Math.round(remaining)} h remaining` };
  }
  return { hoursSinceService: used, dueAfterHours: dueAfter, hoursRemaining: remaining,
    status: 'none', label: `Scheduled (${Math.round(remaining)} h away)` };
}

export interface EmiInstallmentPlan {
  number: number;
  dueDate: string;
  principalPaise: number;
  interestPaise: number;
  amountPaise: number;
  balancePaise: number;
}

/** Standard reducing-balance amortization: EMI = P·r·(1+r)^n / ((1+r)^n − 1). */
export function calculateEmi(principalPaise: number, annualRatePct: number, months: number, startDate: string, dueDay: number) {
  const p = principalPaise;
  const r = annualRatePct / 12 / 100;
  const n = months;
  const emiPaise = r === 0 ? Math.round(p / n) : Math.round((p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
  const schedule: EmiInstallmentPlan[] = [];
  let balance = p;
  for (let i = 1; i <= n; i++) {
    const interestPaise = Math.round(balance * r);
    // The last instalment absorbs rounding so the loan closes at exactly zero.
    const principalPart = i === n ? balance : Math.min(balance, emiPaise - interestPaise);
    balance -= principalPart;
    // i-th month after the loan start, on the due day (1-28, so it always exists).
    const first = addMonths(startDate, i);
    schedule.push({
      number: i,
      dueDate: `${first.slice(0, 8)}${pad2(dueDay)}`,
      principalPaise: principalPart,
      interestPaise,
      amountPaise: principalPart + interestPaise,
      balancePaise: Math.max(0, balance),
    });
  }
  return {
    emiPaise,
    totalInterestPaise: schedule.reduce((s, x) => s + x.interestPaise, 0),
    totalPayablePaise: schedule.reduce((s, x) => s + x.amountPaise, 0),
    schedule,
  };
}
