import React from 'react';
import { DateInput } from './DateInput';

export type Period = 'today' | 'month' | 'last_month' | 'upcoming' | 'past' | 'all' | 'custom';

export interface PeriodState {
  period: Period;
  /** Custom range, ISO yyyy-mm-dd (either end may be empty). */
  from: string;
  to: string;
}

export const defaultPeriod = (period: Period = 'month'): PeriodState => ({ period, from: '', to: '' });

const monthOf = (iso: string) => iso.slice(0, 7);

const previousMonth = (today: string) => {
  const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Does `date` (ISO) fall in the chosen period, judged against `today` (ISO)? */
export function inPeriod(date: string | undefined, state: PeriodState, today: string): boolean {
  if (state.period === 'all') return true;
  if (!date) return false;
  const d = date.slice(0, 10);
  switch (state.period) {
    case 'today':
      return d === today;
    case 'month':
      return monthOf(d) === monthOf(today);
    case 'last_month':
      return monthOf(d) === previousMonth(today);
    case 'upcoming':
      return d > today;
    case 'past':
      return d < today;
    case 'custom':
      return (!state.from || d >= state.from) && (!state.to || d <= state.to);
    default:
      return true;
  }
}

const LABELS: Record<Period, string> = {
  today: 'Today',
  month: 'This month',
  last_month: 'Last month',
  upcoming: 'Upcoming',
  past: 'Past',
  all: 'All',
  custom: 'Custom',
};

interface Props {
  value: PeriodState;
  onChange: (next: PeriodState) => void;
  options?: Period[];
  className?: string;
}

/** Scrollable period chips (thumb-friendly on a phone) with a from/to range for Custom. */
export const PeriodFilter: React.FC<Props> = ({
  value,
  onChange,
  options = ['today', 'month', 'last_month', 'upcoming', 'past', 'all', 'custom'],
  className = '',
}) => (
  <div className={`space-y-2 ${className}`}>
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Period">
      {options.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={value.period === p}
          onClick={() => onChange({ ...value, period: p })}
          className={`shrink-0 rounded-full border px-3.5 py-2.5 text-xs sm:px-3 sm:py-1.5 font-semibold transition-colors ${
            value.period === p
              ? 'border-logo-700 bg-logo-700 text-white'
              : 'border-line bg-surface text-ink-600 hover:border-line-strong hover:text-ink-900'
          }`}
        >
          {LABELS[p]}
        </button>
      ))}
    </div>
    {value.period === 'custom' && (
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <div>
          <label className="form-label">From</label>
          <DateInput className="form-input" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
        </div>
        <div>
          <label className="form-label">To</label>
          <DateInput className="form-input" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </div>
      </div>
    )}
  </div>
);
