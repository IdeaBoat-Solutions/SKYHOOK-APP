import { describe, expect, it } from 'vitest';
import {
  addDays,
  allocateDailyMultiProjectWork,
  calculateEmi,
  calculatePayrollEntry,
  calculateWorkingAndOt,
  evaluateReminderStatus,
  evaluateServiceHours,
  nextServiceDate,
} from './calculations.js';

const INR = (rupees: number) => rupees * 100;

describe('calculateWorkingAndOt', () => {
  it('computes net hours and overtime after unpaid break', () => {
    const r = calculateWorkingAndOt('08:00', '20:00', 60, 600);
    expect(r.totalSpanMinutes).toBe(720);
    expect(r.netWorkingMinutes).toBe(660);
    expect(r.netWorkingHours).toBe(11);
    expect(r.potentialOtHours).toBe(1);
  });

  it('handles overnight shifts', () => {
    const r = calculateWorkingAndOt('20:00', '06:00', 0, 600);
    expect(r.totalSpanMinutes).toBe(600);
    expect(r.potentialOtHours).toBe(0);
  });

  it('never returns negative values', () => {
    const r = calculateWorkingAndOt('18:00', '08:00', 9999, 600);
    expect(r.netWorkingMinutes).toBe(0);
    expect(r.potentialOtHours).toBe(0);
  });
});

describe('allocateDailyMultiProjectWork', () => {
  it('allocates one standard shift across projects and pays OT at the second rate', () => {
    const r = allocateDailyMultiProjectWork([
      { projectId: 'A', projectName: 'A', otRatePaisePerHour: INR(150), startTime: '08:00', endTime: '13:00' },
      { projectId: 'B', projectName: 'B', otRatePaisePerHour: INR(200), startTime: '14:00', endTime: '20:00' },
    ]);
    expect(r.allocatedSegments[0]!.standardMinutesAllocated).toBe(300);
    expect(r.allocatedSegments[1]!.standardMinutesAllocated).toBe(300);
    expect(r.allocatedSegments[1]!.otHours).toBe(1);
    expect(r.totalOtPaise).toBe(INR(200));
  });
});

describe('calculatePayrollEntry — canonical spec example', () => {
  it('matches Ramesh Patel: 24 x 900 + 1800 OT - 2500 advance = 20900 net', () => {
    const out = calculatePayrollEntry({
      salaryType: 'daily',
      dailyRatePaise: INR(900),
      monthlySalaryPaise: 0,
      totalDaysInMonth: 31,
      payableDays: 24,
      otProjectBreakdown: [
        { projectId: 'PRJ-001', projectName: 'Metro Rail', otHours: 4, otRatePaisePerHour: INR(150) },
        { projectId: 'PRJ-002', projectName: 'Coastal Road', otHours: 6, otRatePaisePerHour: INR(200) },
      ],
      approvedOutstandingAdvancePaise: INR(2500),
      maxAdvanceRecoveryRequestedPaise: INR(2500),
    });
    expect(out.basePaise).toBe(INR(21600));
    expect(out.totalOtHours).toBe(10);
    expect(out.totalOtPaise).toBe(INR(1800));
    expect(out.grossPaise).toBe(INR(23400));
    expect(out.advanceRecoveryPaise).toBe(INR(2500));
    expect(out.netPaise).toBe(INR(20900));
  });

  it('caps recovery at outstanding balance and at gross pay', () => {
    const out = calculatePayrollEntry({
      salaryType: 'monthly',
      dailyRatePaise: 0,
      monthlySalaryPaise: INR(25000),
      totalDaysInMonth: 31,
      payableDays: 31,
      otProjectBreakdown: [],
      approvedOutstandingAdvancePaise: INR(4000),
      maxAdvanceRecoveryRequestedPaise: INR(100000),
    });
    expect(out.advanceRecoveryPaise).toBe(INR(4000));
    expect(out.netPaise).toBe(INR(21000));
  });
});

describe('reminders', () => {
  it('classifies overdue, due today, upcoming and none', () => {
    const today = '2026-10-24';
    expect(evaluateReminderStatus('2026-10-22', 15, today).status).toBe('overdue');
    expect(evaluateReminderStatus('2026-10-24', 15, today).status).toBe('due_today');
    expect(evaluateReminderStatus('2026-10-29', 15, today).status).toBe('upcoming');
    expect(evaluateReminderStatus('2026-12-31', 15, today).status).toBe('none');
    expect(evaluateReminderStatus('', 15, today).status).toBe('none');
  });

  it('computes next service and expiry dates', () => {
    expect(nextServiceDate('2026-10-20', 60, 'days')).toBe('2026-12-19');
    expect(addDays('2026-10-24', 365)).toBe('2027-10-24');
    // Hour-based servicing has no calendar due date.
    expect(nextServiceDate('2026-10-20', 500, 'hours')).toBe('');
  });

  it('evaluates hour-based service due points', () => {
    expect(evaluateServiceHours(480, 500, 50).status).toBe('upcoming');
    expect(evaluateServiceHours(500, 500, 50).status).toBe('due_today');
    expect(evaluateServiceHours(620, 500, 50).status).toBe('overdue');
    expect(evaluateServiceHours(100, 500, 50).status).toBe('none');
  });
});

describe('EMI amortization', () => {
  it('uses simple division at zero interest', () => {
    const r = calculateEmi(INR(120000), 0, 12, '2026-01-10', 10);
    expect(r.emiPaise).toBe(INR(10000));
    expect(r.totalInterestPaise).toBe(0);
    expect(r.schedule).toHaveLength(12);
    expect(r.schedule[11]!.balancePaise).toBe(0);
  });

  it('amortizes a reducing balance with interest', () => {
    const r = calculateEmi(INR(100000), 12, 12, '2026-01-10', 10);
    expect(r.emiPaise).toBeGreaterThan(INR(8000));
    expect(r.emiPaise).toBeLessThan(INR(10000));
    expect(r.totalInterestPaise).toBeGreaterThan(0);
    expect(r.schedule[0]!.interestPaise).toBe(INR(1000));
    expect(r.schedule[11]!.balancePaise).toBe(0);
  });
});
