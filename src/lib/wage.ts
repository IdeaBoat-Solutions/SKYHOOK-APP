/** Days in the calendar month that contains the given ISO date (yyyy-mm-dd). */
export function daysInMonthOf(iso: string): number {
  const m = iso.match(/^(\d{4})-(\d{2})/);
  const y = m ? Number(m[1]) : new Date().getFullYear();
  const mo = m ? Number(m[2]) : new Date().getMonth() + 1;
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/**
 * Per-day equivalent of a fixed monthly salary. Payroll prorates a monthly wage as
 * monthly / days-in-month x payable days, so this is the same figure shown to the user.
 */
export function perDayFromMonthly(monthly: number, iso: string): { days: number; perDay: number } {
  const days = daysInMonthOf(iso);
  return { days, perDay: days > 0 ? monthly / days : 0 };
}

export const formatPerDay = (monthly: number, iso: string): string => {
  const { days, perDay } = perDayFromMonthly(monthly, iso);
  return `≈ ₹${perDay.toLocaleString('en-IN', { maximumFractionDigits: 2 })} / day (monthly ÷ ${days} days)`;
};
