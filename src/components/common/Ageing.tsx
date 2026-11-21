import React from 'react';
import { useSkyhook } from '../../data/apiStore';

const DAY = 86_400_000;

const toUtc = (iso?: string) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
};

/** Whole years / months / days between two UTC dates, e.g. "5 yrs 2 mths". */
function spanLabel(from: number, to: number): string {
  const a = new Date(from);
  const b = new Date(to);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0 && m === 0) return `${Math.max(0, Math.round((to - from) / DAY))} days`;
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mth${m > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ');
}

export interface Ageing {
  /** Total validity, e.g. "5 yrs". */
  validity: string;
  totalDays: number;
  elapsedDays: number;
  /** Negative once expired. */
  remainingDays: number;
  /** 0..100, how much of the validity has been used. */
  percentUsed: number;
  expired: boolean;
}

/** Ageing of a document from its issue date to its expiry, measured at `today`. */
export function computeAgeing(issue: string | undefined, expiry: string | undefined, today: string): Ageing | null {
  const from = toUtc(issue);
  const to = toUtc(expiry);
  const now = toUtc(today);
  if (from === null || to === null || now === null || to < from) return null;
  const totalDays = Math.round((to - from) / DAY);
  const elapsedDays = Math.min(totalDays, Math.max(0, Math.round((now - from) / DAY)));
  const remainingDays = Math.round((to - now) / DAY);
  return {
    validity: spanLabel(from, to),
    totalDays,
    elapsedDays,
    remainingDays,
    percentUsed: totalDays > 0 ? Math.min(100, Math.round((elapsedDays / totalDays) * 100)) : 100,
    expired: remainingDays < 0,
  };
}

interface Props {
  issue?: string;
  expiry?: string;
  className?: string;
}

/**
 * Ageing strip for a dated document: how long it is valid for (issue to expiry),
 * how much of that is used, and what is left. Turns amber under 30 days, red once expired.
 */
export const AgeingBar: React.FC<Props> = ({ issue, expiry, className = '' }) => {
  const { currentDate } = useSkyhook();
  const a = computeAgeing(issue, expiry, currentDate);
  if (!a) return null;

  const tone = a.expired ? 'danger' : a.remainingDays <= 30 ? 'warning' : 'ok';
  const bar = { danger: 'bg-danger-500', warning: 'bg-warning-600', ok: 'bg-success-600' }[tone];
  const text = { danger: 'text-danger-700', warning: 'text-warning-800', ok: 'text-success-700' }[tone];

  return (
    <div className={`rounded-lg border border-line bg-surface-muted px-3 py-2 ${className}`} role="status">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="font-semibold text-ink-700">Validity {a.validity}</span>
        <span className={`font-bold ${text}`}>
          {a.expired
            ? `Expired ${Math.abs(a.remainingDays)} day${Math.abs(a.remainingDays) === 1 ? '' : 's'} ago`
            : a.remainingDays === 0
              ? 'Expires today'
              : `${a.remainingDays} day${a.remainingDays === 1 ? '' : 's'} left`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${a.percentUsed}%` }} />
      </div>
      <div className="mt-1 text-[10px] text-ink-500">
        {a.elapsedDays} of {a.totalDays} days used ({a.percentUsed}%)
      </div>
    </div>
  );
};
