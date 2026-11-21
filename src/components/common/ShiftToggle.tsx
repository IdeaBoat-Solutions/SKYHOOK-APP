import React from 'react';
import { Sun, Moon, Clock } from 'lucide-react';

export type Shift = 'day' | 'night' | 'custom';

/** Day shift starts 08:00 and night shift 20:00; both run for the company's shift length. */
export function shiftTimes(kind: Exclude<Shift, 'custom'>, shiftHours: number) {
  const startH = kind === 'day' ? 8 : 20;
  const endMin = (startH * 60 + Math.round(shiftHours * 60)) % 1440;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${pad(startH)}:00`, end: `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}` };
}

/** Which preset a pair of times matches, so an existing record shows the right button. */
export function detectShift(start: string, end: string, shiftHours: number): Shift {
  for (const kind of ['day', 'night'] as const) {
    const t = shiftTimes(kind, shiftHours);
    if (t.start === start.slice(0, 5) && t.end === end.slice(0, 5)) return kind;
  }
  return 'custom';
}

const OPTIONS = [
  ['day', 'Day', Sun],
  ['night', 'Night', Moon],
  ['custom', 'Custom', Clock],
] as const;

interface Props {
  value: Shift;
  onChange: (shift: Shift) => void;
  size?: 'sm' | 'md';
}

/** Day / Night / Custom segmented buttons. Custom means "I will type the times". */
export const ShiftToggle: React.FC<Props> = ({ value, onChange, size = 'md' }) => (
  <div className="inline-flex rounded-lg border border-line bg-surface-muted p-0.5" role="group" aria-label="Shift">
    {OPTIONS.map(([id, label, Icon]) => (
      <button
        key={id}
        type="button"
        aria-pressed={value === id}
        onClick={() => onChange(id)}
        className={`inline-flex items-center gap-1.5 rounded-md font-semibold transition-colors ${
          size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
        } ${value === id ? 'bg-logo-700 text-white' : 'text-ink-600 hover:bg-surface'}`}
      >
        <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        {label}
      </button>
    ))}
  </div>
);
