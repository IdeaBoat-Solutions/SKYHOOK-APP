import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Copy, Check, RotateCcw } from 'lucide-react';
import { ShiftToggle, shiftTimes, detectShift, type Shift } from '../common/ShiftToggle';
import { useSkyhook } from '../../data/apiStore';
import { calculateWorkingAndOt, formatINR, formatDateDDMMYYYY } from '../../utils/calculations';

import { DateInput } from '../common/DateInput';
interface Row {
  id: string;
  date: string;
  shift: Shift;
  start: string;
  end: string;
}

interface Saved {
  title: string;
  rate: string;
  rows: Row[];
}

const STORAGE_KEY = 'skyhook:logsheet-calculator';

const newId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const hoursLabel = (h: number) => {
  const mins = Math.round(h * 60);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
};

/**
 * Logsheet calculator: enter the date and start/end of each working session (day or night
 * shift) and get total hours per row, grand total, and an optional amount at an hourly rate.
 * Night shifts that cross midnight (20:00 to 06:00) are counted correctly. Kept in this
 * browser only; it does not touch the machine working register.
 */
export const LogsheetCalculator: React.FC = () => {
  const { currentDate, companySettings } = useSkyhook();
  const shiftHours = companySettings.standardShiftHours || 10;

  const presetTimes = (kind: Exclude<Shift, 'custom'>) => shiftTimes(kind, shiftHours);

  const blankRow = (date = currentDate, shift: Shift = 'day'): Row => {
    const t = presetTimes(shift === 'custom' ? 'day' : shift);
    return { id: newId(), date, shift, start: t.start, end: t.end };
  };

  const [state, setState] = useState<Saved>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Saved;
        if (Array.isArray(parsed.rows) && parsed.rows.length) return parsed;
      }
    } catch {
      /* ignore */
    }
    return { title: '', rate: '', rows: [] };
  });
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);

  // Seed the first row once the shift length is known.
  useEffect(() => {
    if (state.rows.length === 0) setState((s) => ({ ...s, rows: [blankRow()] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const patchRow = (id: string, patch: Partial<Row>) =>
    setState((s) => ({ ...s, rows: s.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

  const setRowTime = (id: string, field: 'start' | 'end', value: string) =>
    setState((s) => ({
      ...s,
      rows: s.rows.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, [field]: value };
        return { ...next, shift: detectShift(next.start, next.end, shiftHours) };
      }),
    }));

  const setRowShift = (id: string, shift: Shift) => {
    if (shift === 'custom') return patchRow(id, { shift });
    patchRow(id, { shift, ...presetTimes(shift) });
  };

  const addRow = () =>
    setState((s) => {
      // Continue from the last row: same shift, next day.
      const last = s.rows[s.rows.length - 1];
      let date = currentDate;
      if (last?.date) {
        const d = new Date(`${last.date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        date = d.toISOString().slice(0, 10);
      }
      const base = blankRow(date, last?.shift ?? 'day');
      if (last?.shift === 'custom') Object.assign(base, { start: last.start, end: last.end, shift: 'custom' as Shift });
      return { ...s, rows: [...s.rows, base] };
    });

  const removeRow = (id: string) =>
    setState((s) => ({ ...s, rows: s.rows.length > 1 ? s.rows.filter((r) => r.id !== id) : s.rows }));

  const reset = () => {
    if (!window.confirm('Clear this logsheet and start again?')) return;
    setState({ title: '', rate: '', rows: [blankRow()] });
  };

  const computed = useMemo(
    () => state.rows.map((r) => ({ ...r, hours: calculateWorkingAndOt(r.start, r.end, 0, 1440).netWorkingHours })),
    [state.rows],
  );
  const totalHours = Math.round(computed.reduce((sum, r) => sum + r.hours, 0) * 100) / 100;
  const dayHours = Math.round(computed.filter((r) => r.shift === 'day').reduce((a, r) => a + r.hours, 0) * 100) / 100;
  const nightHours = Math.round(computed.filter((r) => r.shift === 'night').reduce((a, r) => a + r.hours, 0) * 100) / 100;
  const rate = Number(state.rate) || 0;
  const amount = Math.round(totalHours * rate);

  const copySummary = async () => {
    const lines = [
      state.title || 'Logsheet',
      ...computed.map(
        (r) => `${formatDateDDMMYYYY(r.date)}  ${r.shift === 'night' ? 'Night' : r.shift === 'day' ? 'Day' : 'Custom'}  ${r.start}-${r.end}  ${hoursLabel(r.hours)}`,
      ),
      `Total: ${hoursLabel(totalHours)} (${totalHours} hrs)`,
      ...(rate ? [`Amount @ ${formatINR(rate)}/hr: ${formatINR(amount)}`] : []),
    ];
    const text = lines.join('\n');
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Clipboard API blocked (insecure origin or permissions): fall back to a hidden textarea.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    setCopied(ok ? 'ok' : 'failed');
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <div className="stat-card stat-card-accent">
          <span className="stat-label">Total hours</span>
          <div className="stat-value">{totalHours} hrs</div>
          <span className="stat-hint">{hoursLabel(totalHours)} across {computed.length} {computed.length === 1 ? 'entry' : 'entries'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Day / night split</span>
          <div className="stat-value text-lg">
            {dayHours}h <span className="text-ink-400">day</span> · {nightHours}h <span className="text-ink-400">night</span>
          </div>
          <span className="stat-hint">Custom-timed rows are in the total only</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Amount</span>
          <div className="stat-value">{rate ? formatINR(amount) : '-'}</div>
          <span className="stat-hint">{rate ? `${totalHours} hrs × ${formatINR(rate)}/hr` : 'Enter an hourly rate to see the amount'}</span>
        </div>
      </div>

      <div className="card card-pad grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="form-label" htmlFor="logsheet-title">Logsheet name (optional)</label>
          <input
            id="logsheet-title"
            className="form-input"
            placeholder="e.g. ACE F150 – Kolat site, November"
            value={state.title}
            onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="logsheet-rate">Rate per hour (₹, optional)</label>
          <input
            id="logsheet-rate"
            type="number"
            min={0}
            inputMode="decimal"
            className="form-input"
            placeholder="0"
            value={state.rate}
            onChange={(e) => setState((s) => ({ ...s, rate: e.target.value }))}
          />
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {computed.map((r, i) => (
          <div key={r.id} className="card card-pad space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-ink-500">Day {i + 1}</span>
              <button
                type="button"
                className="icon-btn h-11 w-11"
                onClick={() => removeRow(r.id)}
                disabled={computed.length === 1}
                aria-label="Remove row"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className="form-label">Date</label>
              <DateInput className="form-input" value={r.date} onChange={(e) => patchRow(r.id, { date: e.target.value })} aria-label="Date" />
            </div>
            <ShiftToggle value={r.shift} onChange={(k) => setRowShift(r.id, k)} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Start</label>
                <input type="time" className="form-input" value={r.start} onChange={(e) => setRowTime(r.id, 'start', e.target.value)} aria-label="Start time" />
              </div>
              <div>
                <label className="form-label">End</label>
                <input type="time" className="form-input" value={r.end} onChange={(e) => setRowTime(r.id, 'end', e.target.value)} aria-label="End time" />
              </div>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-2.5">
              <span className="text-xs font-semibold text-ink-500">Total hours</span>
              <span className="text-base font-extrabold text-ink-900">{r.hours} hrs <span className="text-[11px] font-medium text-ink-500">({hoursLabel(r.hours)})</span></span>
            </div>
          </div>
        ))}
        <div className="flex items-baseline justify-between rounded-lg border border-line bg-surface-muted px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Grand total</span>
          <span className="text-lg font-extrabold text-ink-900">{totalHours} hrs</span>
        </div>
      </div>

      <div className="table-card hidden md:block">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Shift</th>
                <th>Start</th>
                <th>End</th>
                <th className="text-right">Total hours</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {computed.map((r) => (
                <tr key={r.id}>
                  <td>
                    <DateInput className="form-input"
                      value={r.date}
                      onChange={(e) => patchRow(r.id, { date: e.target.value })}
                      aria-label="Date"
                    />
                  </td>
                  <td>
                    <ShiftToggle size="sm" value={r.shift} onChange={(k) => setRowShift(r.id, k)} />
                  </td>
                  <td>
                    <input
                      type="time"
                      className="form-input"
                      value={r.start}
                      onChange={(e) => setRowTime(r.id, 'start', e.target.value)}
                      aria-label="Start time"
                    />
                  </td>
                  <td>
                    <input
                      type="time"
                      className="form-input"
                      value={r.end}
                      onChange={(e) => setRowTime(r.id, 'end', e.target.value)}
                      aria-label="End time"
                    />
                  </td>
                  <td className="text-right">
                    <div className="text-sm font-bold text-ink-900">{r.hours} hrs</div>
                    <div className="text-[10px] text-ink-500">{hoursLabel(r.hours)}</div>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => removeRow(r.id)}
                      disabled={computed.length === 1}
                      aria-label="Remove row"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-right text-xs font-semibold uppercase tracking-wide text-ink-500">Grand total</td>
                <td className="text-right text-base font-extrabold text-ink-900">{totalHours} hrs</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary flex-1 sm:flex-none" onClick={addRow}>
          <Plus className="h-4 w-4" /> Add day
        </button>
        <button type="button" className="btn btn-secondary" onClick={copySummary}>
          {copied === 'ok' ? <Check className="h-4 w-4 text-success-600" /> : <Copy className="h-4 w-4" />}
          {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy summary'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={reset}>
          <RotateCcw className="h-4 w-4" /> Clear
        </button>
        <span className="w-full text-[11px] text-ink-500 sm:ml-auto sm:w-auto">Saved in this browser. Night shifts crossing midnight are counted correctly.</span>
      </div>
    </div>
  );
};
