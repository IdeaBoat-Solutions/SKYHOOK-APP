import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateWorkingAndOt,
  allocateDailyMultiProjectWork,
  calculatePayrollEntry,
  evaluateReminderStatus,
  calculateNextServiceDate,
  calculateExpiryFromInterval,
  formatINR,
  formatDateDDMMYYYY,
} from './calculations.ts';

test('Operator working standard 10 net hours has 0 overtime', () => {
  const result = calculateWorkingAndOt('08:00', '18:00', 0, 600);
  assert.equal(result.netWorkingHours, 10);
  assert.equal(result.potentialOtHours, 0);
  assert.equal(result.potentialOtMinutes, 0);
});

test('Operator working 12 net hours has 2 overtime hours', () => {
  const result = calculateWorkingAndOt('08:00', '20:00', 0, 600);
  assert.equal(result.netWorkingHours, 12);
  assert.equal(result.potentialOtHours, 2);
  assert.equal(result.potentialOtMinutes, 120);
});

test('Operator working 12 hours with 60 min unpaid break has 1 overtime hour', () => {
  const result = calculateWorkingAndOt('08:00', '20:00', 60, 600);
  assert.equal(result.netWorkingMinutes, 660);
  assert.equal(result.netWorkingHours, 11);
  assert.equal(result.potentialOtHours, 1);
});

test('Handles overnight machine / work sessions spanning midnight', () => {
  // 21:00 to 05:00 = 8 hours span, 60 min idle -> 7 hours
  const result = calculateWorkingAndOt('21:00', '05:00', 60, 600);
  assert.equal(result.totalSpanMinutes, 480);
  assert.equal(result.netWorkingMinutes, 420);
  assert.equal(result.netWorkingHours, 7);
});

test('Multi-project daily work applies standard 10-hour allowance only once', () => {
  // Operator works 6 hours on Project A (OT rate ₹150) then 6 hours on Project B (OT rate ₹200)
  // Total 12 hours. First 10 hours should absorb the standard shift (6h Project A + 4h Project B).
  // Remaining 2 hours on Project B are overtime at Project B rate (2h x ₹200 = ₹400).
  const segments = [
    {
      projectId: 'PRJ-001',
      projectName: 'Project A',
      otRate: 150,
      startTime: '08:00',
      endTime: '14:00',
      unpaidBreakMinutes: 0,
    },
    {
      projectId: 'PRJ-002',
      projectName: 'Project B',
      otRate: 200,
      startTime: '14:00',
      endTime: '20:00',
      unpaidBreakMinutes: 0,
    },
  ];

  const result = allocateDailyMultiProjectWork(segments, 600);
  assert.equal(result.totalNetMinutes, 720); // 12 hours total
  assert.equal(result.totalOtMinutes, 120); // 2 hours OT total
  assert.equal(result.totalOtHours, 2);

  // Segment 1: all 360 min standard, 0 OT
  assert.equal(result.allocatedSegments[0].standardMinutesAllocated, 360);
  assert.equal(result.allocatedSegments[0].otMinutes, 0);
  assert.equal(result.allocatedSegments[0].otAmount, 0);

  // Segment 2: 240 min standard, 120 min OT at ₹200/hr = ₹400
  assert.equal(result.allocatedSegments[1].standardMinutesAllocated, 240);
  assert.equal(result.allocatedSegments[1].otMinutes, 120);
  assert.equal(result.allocatedSegments[1].otHours, 2);
  assert.equal(result.allocatedSegments[1].otAmount, 400);

  assert.equal(result.totalOtAmount, 400);
});

test('Ramesh Patel exact specification payroll test case reproduces accurately', () => {
  // Operator: Ramesh Patel
  // Daily Rate: ₹900
  // Payable Days: 24
  // Base Salary: 24 x ₹900 = ₹21,600
  // Overtime: Project A: 4 Hours x ₹150 = ₹600; Project B: 6 Hours x ₹200 = ₹1,200; Total Overtime: ₹1,800
  // Gross Salary: ₹23,400
  // Advance Deduction: ₹2,500
  // NET SALARY: ₹20,900
  // Outstanding Advance before recovery: ₹5,000 -> Remaining balance: ₹2,500
  const input = {
    salaryType: 'daily' as const,
    dailyRate: 900,
    monthlySalary: 0,
    totalDaysInMonth: 31,
    payableDays: 24,
    otProjectBreakdown: [
      { projectId: 'PRJ-A', projectName: 'Project A', otHours: 4, otRate: 150 },
      { projectId: 'PRJ-B', projectName: 'Project B', otHours: 6, otRate: 200 },
    ],
    allowances: 0,
    approvedOutstandingAdvance: 5000,
    maxAdvanceRecoveryRequested: 2500,
    otherDeductions: 0,
  };

  const output = calculatePayrollEntry(input);

  assert.equal(output.baseSalary, 21600);
  assert.equal(output.totalOtHours, 10);
  assert.equal(output.totalOtAmount, 1800);
  assert.equal(output.grossSalary, 23400);
  assert.equal(output.advanceRecovery, 2500);
  assert.equal(output.remainingAdvanceBalance, 2500);
  assert.equal(output.totalDeductions, 2500);
  assert.equal(output.netSalary, 20900);
});

test('Evaluate reminder statuses for overdue, due today, upcoming and outside lead time', () => {
  const currentDate = '2026-10-24';

  // 1. Overdue: due on 2026-10-20 (4 days ago)
  const overdue = evaluateReminderStatus('2026-10-20', 15, currentDate);
  assert.equal(overdue.status, 'overdue');
  assert.equal(overdue.daysRemaining, -4);
  assert.equal(overdue.label, 'Overdue by 4 Days');

  // 2. Due Today: due on 2026-10-24
  const dueToday = evaluateReminderStatus('2026-10-24', 15, currentDate);
  assert.equal(dueToday.status, 'due_today');
  assert.equal(dueToday.daysRemaining, 0);
  assert.equal(dueToday.label, 'Due Today');

  // 3. Upcoming within 15-day lead: due on 2026-10-30 (6 days)
  const upcoming = evaluateReminderStatus('2026-10-30', 15, currentDate);
  assert.equal(upcoming.status, 'upcoming');
  assert.equal(upcoming.daysRemaining, 6);
  assert.equal(upcoming.label, 'Due in 6 Days');

  // 4. Beyond lead time: due on 2026-11-20 (27 days > 15)
  const farAway = evaluateReminderStatus('2026-11-20', 15, currentDate);
  assert.equal(farAway.status, 'none');
  assert.equal(farAway.daysRemaining, 27);
});

test('Next service date calculates from last service date and frequency', () => {
  const nextInDays = calculateNextServiceDate('2026-10-01', 60, 'days');
  assert.equal(nextInDays, '2026-11-30');

  const nextInMonths = calculateNextServiceDate('2026-08-15', 3, 'months');
  assert.equal(nextInMonths, '2026-11-15');
});

test('calculateExpiryFromInterval accurately computes statutory renewal dates', () => {
  // 365 days from 2026-10-24 -> 2027-10-24
  const oneYear = calculateExpiryFromInterval('2026-10-24', 365);
  assert.equal(oneYear, '2027-10-24');

  // 180 days from 2026-10-24 -> 2027-04-22
  const sixMonths = calculateExpiryFromInterval('2026-10-24', 180);
  assert.equal(sixMonths, '2027-04-22');

  // 90 days from 2026-10-24 -> 2027-01-22
  const ninetyDays = calculateExpiryFromInterval('2026-10-24', 90);
  assert.equal(ninetyDays, '2027-01-22');

  // Handles empty or invalid date gracefully
  assert.equal(calculateExpiryFromInterval('', 365), '');
});

test('Formatters for Indian Rupees and dates', () => {
  assert.equal(formatINR(20900), '₹20,900');
  assert.equal(formatINR(45000), '₹45,000');
  assert.equal(formatDateDDMMYYYY('2026-10-24'), '24/10/2026');
});

test('Day-wise overtime accumulation calculates accurate itemized payslip breakdown', () => {
  // Operator logs 3 days of overtime in a month:
  // Day 1: 3 hours on Metro Project (₹150/hr)
  // Day 2: 2.5 hours on Metro Project (₹150/hr)
  // Day 3: 4 hours on Coastal Bridge (₹200/hr)
  // Total Metro: 5.5h x ₹150 = ₹825
  // Total Coastal: 4h x ₹200 = ₹800
  // Total OT: 9.5 hours, ₹1,625
  const otProjectBreakdown = [
    { projectId: 'PRJ-001', projectName: 'Metro Rail Line 4', otHours: 5.5, otRate: 150 },
    { projectId: 'PRJ-002', projectName: 'Coastal Road Marine Drive', otHours: 4, otRate: 200 },
  ];

  const calc = calculatePayrollEntry({
    salaryType: 'daily',
    dailyRate: 1000,
    monthlySalary: 0,
    totalDaysInMonth: 31,
    payableDays: 25,
    otProjectBreakdown,
    allowances: 500,
    approvedOutstandingAdvance: 3000,
    maxAdvanceRecoveryRequested: 1500,
    otherDeductions: 200,
  });

  // Base: 25 days x ₹1,000 = ₹25,000
  assert.equal(calc.baseSalary, 25000);
  assert.equal(calc.totalOtHours, 9.5);
  assert.equal(calc.totalOtAmount, 1625);
  // Gross: 25000 base + 1625 OT + 500 allowance = ₹27,125
  assert.equal(calc.grossSalary, 27125);
  // Deductions: 1500 advance + 200 other = 1700
  assert.equal(calc.advanceRecovery, 1500);
  assert.equal(calc.totalDeductions, 1700);
  // Net: 27125 - 1700 = ₹25,425
  assert.equal(calc.netSalary, 25425);
  // Remaining advance: 3000 - 1500 = 1500
  assert.equal(calc.remainingAdvanceBalance, 1500);
});

test('Quick attendance absent marking properly zeroes out base pay for unworked days', () => {
  // Operator marked 18 present days, 2 half days (1 day eq), 5 absent days
  // Payable days = 18 + (2 x 0.5) = 19 days
  const payableDays = 18 + 2 * 0.5;
  const calc = calculatePayrollEntry({
    salaryType: 'daily',
    dailyRate: 900,
    monthlySalary: 0,
    totalDaysInMonth: 31,
    payableDays,
    otProjectBreakdown: [],
  });

  assert.equal(calc.baseSalary, 19 * 900); // 17,100
  assert.equal(calc.grossSalary, 17100);
  assert.equal(calc.netSalary, 17100);
});


