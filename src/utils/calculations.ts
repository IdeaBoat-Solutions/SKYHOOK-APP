/**
 * Pure calculation utilities for Skyhook Crane Business Management ERP.
 * Strictly tested and decoupled from UI.
 */

export interface TimeDurationResult {
  totalSpanMinutes: number;
  netWorkingMinutes: number;
  netWorkingHours: number;
  potentialOtMinutes: number;
  potentialOtHours: number;
}

/**
 * Parses time string (e.g., "08:00", "08:00:00", or "2026-10-24T08:00:00") into minutes from midnight.
 */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  if (timeStr.includes('T')) {
    const timePart = timeStr.split('T')[1];
    return parseTimeToMinutes(timePart);
  }
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;
  return hours * 60 + minutes;
}

/**
 * Calculates net working minutes, net hours, and potential overtime.
 * Standard shift is 10 hours (600 minutes) by default.
 * Handles overnight shifts where end time is on next day (e.g. 20:00 to 06:00).
 */
export function calculateWorkingAndOt(
  startTime: string,
  endTime: string,
  unpaidBreakMinutes: number = 0,
  standardShiftMinutes: number = 600
): TimeDurationResult {
  const startMin = parseTimeToMinutes(startTime);
  let endMin = parseTimeToMinutes(endTime);

  // If end time is earlier than start time, assume overnight shift (add 24h = 1440m)
  if (endMin < startMin) {
    endMin += 1440;
  }

  const totalSpanMinutes = Math.max(0, endMin - startMin);
  const netWorkingMinutes = Math.max(0, totalSpanMinutes - Math.max(0, unpaidBreakMinutes));
  const netWorkingHours = Math.round((netWorkingMinutes / 60) * 100) / 100;

  const potentialOtMinutes = Math.max(0, netWorkingMinutes - standardShiftMinutes);
  const potentialOtHours = Math.round((potentialOtMinutes / 60) * 100) / 100;

  return {
    totalSpanMinutes,
    netWorkingMinutes,
    netWorkingHours,
    potentialOtMinutes,
    potentialOtHours,
  };
}

/**
 * Distributes single standard allowance across multi-project segments in a day.
 * Prevents double-counting of the standard 10h (600m) shift.
 */
export interface WorkSegmentInput {
  projectId: string;
  projectName: string;
  otRate: number;
  startTime: string;
  endTime: string;
  unpaidBreakMinutes?: number;
}

export interface AllocatedProjectSegment {
  projectId: string;
  projectName: string;
  netMinutes: number;
  standardMinutesAllocated: number;
  otMinutes: number;
  otHours: number;
  otRate: number;
  otAmount: number;
}

export function allocateDailyMultiProjectWork(
  segments: WorkSegmentInput[],
  standardDailyMinutes: number = 600
): {
  totalNetMinutes: number;
  totalOtMinutes: number;
  totalOtHours: number;
  totalOtAmount: number;
  allocatedSegments: AllocatedProjectSegment[];
} {
  let remainingStandardMin = standardDailyMinutes;
  let totalNetMinutes = 0;
  let totalOtMinutes = 0;
  let totalOtAmount = 0;

  const allocatedSegments: AllocatedProjectSegment[] = [];

  for (const seg of segments) {
    const res = calculateWorkingAndOt(seg.startTime, seg.endTime, seg.unpaidBreakMinutes || 0, remainingStandardMin);
    const netMin = res.netWorkingMinutes;
    totalNetMinutes += netMin;

    const stdAllocated = Math.min(remainingStandardMin, netMin);
    remainingStandardMin -= stdAllocated;

    const otMin = netMin - stdAllocated;
    const otHours = Math.round((otMin / 60) * 100) / 100;
    const otAmount = Math.round(otHours * seg.otRate);

    totalOtMinutes += otMin;
    totalOtAmount += otAmount;

    allocatedSegments.push({
      projectId: seg.projectId,
      projectName: seg.projectName,
      netMinutes: netMin,
      standardMinutesAllocated: stdAllocated,
      otMinutes: otMin,
      otHours,
      otRate: seg.otRate,
      otAmount,
    });
  }

  const totalOtHours = Math.round((totalOtMinutes / 60) * 100) / 100;

  return {
    totalNetMinutes,
    totalOtMinutes,
    totalOtHours,
    totalOtAmount,
    allocatedSegments,
  };
}

/**
 * Calculates payroll entry for an employee for a given period.
 * Accurately reproduces business rules including:
 * - Base Salary = Payable Days * Daily Rate (or monthly proration)
 * - Project Overtime = SUM(OT Hours * Project OT Rate)
 * - Gross = Base + Overtime + Allowances
 * - Advance Recovery = deducted without exceeding remaining balance or gross
 * - Net = Gross - Advance Recovery - Other Deductions
 */
export interface PayrollCalcInput {
  salaryType: 'daily' | 'monthly';
  dailyRate: number;
  monthlySalary: number;
  totalDaysInMonth: number;
  payableDays: number;
  otProjectBreakdown: {
    projectId: string;
    projectName: string;
    otHours: number;
    otRate: number;
  }[];
  allowances?: number;
  approvedOutstandingAdvance?: number;
  maxAdvanceRecoveryRequested?: number;
  otherDeductions?: number;
}

export interface PayrollCalcOutput {
  baseSalary: number;
  totalOtHours: number;
  totalOtAmount: number;
  projectOtBreakdown: {
    projectId: string;
    projectName: string;
    otHours: number;
    otRate: number;
    amount: number;
  }[];
  grossSalary: number;
  advanceRecovery: number;
  remainingAdvanceBalance: number;
  otherDeductions: number;
  totalDeductions: number;
  netSalary: number;
}

export function calculatePayrollEntry(input: PayrollCalcInput): PayrollCalcOutput {
  let baseSalary = 0;
  if (input.salaryType === 'daily') {
    baseSalary = Math.round(input.payableDays * input.dailyRate);
  } else {
    // Fixed monthly salary prorated by payable days / total days in month
    const totalDays = Math.max(1, input.totalDaysInMonth);
    // Multiply before dividing so paise are rounded once, at the end.
    baseSalary = Math.round((input.monthlySalary * input.payableDays) / totalDays);
  }

  let totalOtHours = 0;
  let totalOtAmount = 0;

  const projectOtBreakdown = input.otProjectBreakdown.map((item) => {
    const hours = Math.round(item.otHours * 100) / 100;
    const amount = Math.round(hours * item.otRate);
    totalOtHours += hours;
    totalOtAmount += amount;
    return {
      projectId: item.projectId,
      projectName: item.projectName,
      otHours: hours,
      otRate: item.otRate,
      amount,
    };
  });

  totalOtHours = Math.round(totalOtHours * 100) / 100;

  const allowances = Math.max(0, input.allowances || 0);
  const grossSalary = baseSalary + totalOtAmount + allowances;

  // Advance recovery: cannot exceed outstanding advance balance or gross pay
  const outstandingAdvance = Math.max(0, input.approvedOutstandingAdvance || 0);
  const targetRecovery = Math.max(0, input.maxAdvanceRecoveryRequested ?? outstandingAdvance);
  const advanceRecovery = Math.min(outstandingAdvance, targetRecovery, grossSalary);
  const remainingAdvanceBalance = outstandingAdvance - advanceRecovery;

  const otherDeductions = Math.max(0, input.otherDeductions || 0);
  const totalDeductions = advanceRecovery + otherDeductions;
  const netSalary = Math.max(0, grossSalary - totalDeductions);

  return {
    baseSalary,
    totalOtHours,
    totalOtAmount,
    projectOtBreakdown,
    grossSalary,
    advanceRecovery,
    remainingAdvanceBalance,
    otherDeductions,
    totalDeductions,
    netSalary,
  };
}

/** Today in the user's own timezone as yyyy-mm-dd (never UTC, which is a day behind in India early morning). */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Add whole days to a yyyy-mm-dd date using UTC arithmetic (no timezone / DST drift). */
export function addDaysISO(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split('T')[0];
}

/** Add calendar months to a yyyy-mm-dd date; a day past the end of the target month clamps (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsISO(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(ny).padStart(4, '0')}-${pad(nm + 1)}-${pad(Math.min(d, lastDay))}`;
}

/**
 * Calculates reminder status and days remaining relative to an evaluation date.
 */
export function evaluateReminderStatus(
  dueDateStr: string,
  leadDays: number,
  currentDateStr: string = localToday()
): {
  daysRemaining: number;
  status: 'overdue' | 'due_today' | 'upcoming' | 'none';
  label: string;
} {
  if (!dueDateStr) {
    return { daysRemaining: 9999, status: 'none', label: 'No Due Date' };
  }

  const due = new Date(dueDateStr);
  const curr = new Date(currentDateStr);

  // Normalize to UTC midnight
  const dueTime = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const currTime = Date.UTC(curr.getUTCFullYear(), curr.getUTCMonth(), curr.getUTCDate());

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysRemaining = Math.round((dueTime - currTime) / msPerDay);

  if (daysRemaining < 0) {
    const overdueDays = Math.abs(daysRemaining);
    return {
      daysRemaining,
      status: 'overdue',
      label: `Overdue by ${overdueDays} Day${overdueDays === 1 ? '' : 's'}`,
    };
  }

  if (daysRemaining === 0) {
    return {
      daysRemaining: 0,
      status: 'due_today',
      label: 'Due Today',
    };
  }

  if (daysRemaining <= leadDays) {
    return {
      daysRemaining,
      status: 'upcoming',
      label: `Due in ${daysRemaining} Day${daysRemaining === 1 ? '' : 's'}`,
    };
  }

  return {
    daysRemaining,
    status: 'none',
    label: `Scheduled (${daysRemaining} days away)`,
  };
}

/**
 * Calculates next service due date given last service date and frequency.
 */
export function calculateNextServiceDate(
  lastServiceDateStr: string,
  frequencyValue: number,
  frequencyUnit: 'days' | 'months' | 'hours'
): string {
  // Hours-based servicing has no calendar due date - the due point is an
  // operating-hour reading, handled by evaluateServiceHours() below.
  if (frequencyUnit === 'hours') return '';
  if (isNaN(new Date(lastServiceDateStr).getTime())) return lastServiceDateStr;
  return frequencyUnit === 'days'
    ? addDaysISO(lastServiceDateStr, frequencyValue)
    : addMonthsISO(lastServiceDateStr, frequencyValue);
}

/**
 * Service sections show intervals in months instead of raw day counts.
 * 365 days -> "12 months", 180 -> "6 months", 60 -> "2 months".
 * Sub-month intervals stay in days so the label never reads "0 months".
 */
export function daysToMonthsLabel(days: number): string {
  const value = Number(days) || 0;
  const months = Math.round(value / 30);
  if (months >= 1) return `${months} month${months === 1 ? '' : 's'}`;
  return `${value} day${value === 1 ? '' : 's'}`;
}

/** Consistent interval label for every service surface (assets + reminders). */
export function formatServiceInterval(
  value: number,
  unit: 'days' | 'months' | 'hours',
): string {
  if (unit === 'hours') return `${value} operating hours`;
  if (unit === 'days') return daysToMonthsLabel(value);
  return `${value} month${value === 1 ? '' : 's'}`;
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
    return {
      hoursSinceService: used,
      dueAfterHours: dueAfter,
      hoursRemaining: remaining,
      status: 'overdue',
      label: `Overdue by ${overdue} h`,
    };
  }
  if (remaining === 0) {
    return {
      hoursSinceService: used,
      dueAfterHours: dueAfter,
      hoursRemaining: 0,
      status: 'due_today',
      label: 'Service due now',
    };
  }
  if (remaining <= lead) {
    return {
      hoursSinceService: used,
      dueAfterHours: dueAfter,
      hoursRemaining: remaining,
      status: 'upcoming',
      label: `Due in ${Math.round(remaining)} h`,
    };
  }
  return {
    hoursSinceService: used,
    dueAfterHours: dueAfter,
    hoursRemaining: remaining,
    status: 'none',
    label: `${Math.round(remaining)} h remaining`,
  };
}

/** Sum approved operating hours logged for a machine after its last service. */
export function sumOperatingHours(
  logs: Array<{ machineId: string; date: string; workingHours: number; approvalStatus?: string }>,
  machineId: string,
  sinceDate?: string,
): number {
  return logs
    .filter(
      (log) =>
        log.machineId === machineId &&
        (!sinceDate || log.date > sinceDate) &&
        log.approvalStatus !== 'rejected',
    )
    .reduce((total, log) => total + (Number(log.workingHours) || 0), 0);
}

/**
 * Calculates next expiry / due date given a start / renewal date and interval days.
 * E.g., renewalDate + intervalDays => YYYY-MM-DD
 */
export function calculateExpiryFromInterval(
  startDateStr: string,
  intervalDays: number
): string {
  if (!startDateStr) return '';
  const d = new Date(startDateStr);
  if (isNaN(d.getTime())) return startDateStr;
  d.setDate(d.getDate() + (Number(intervalDays) || 0));
  return d.toISOString().split('T')[0];
}

/**
 * Currency formatter for Indian Rupees (₹) with comma separators.
 */
export function formatINR(amount: number): string {
  if (isNaN(amount) || amount === null || amount === undefined) return '₹0';
  return '₹' + amount.toLocaleString('en-IN');
}

/**
 * Format date string (YYYY-MM-DD) into Indian standard DD/MM/YYYY.
 */
export function formatDateDDMMYYYY(dateStr?: string): string {
  if (!dateStr) return '-';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

