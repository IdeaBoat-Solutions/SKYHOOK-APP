import React, { useState } from 'react';
import { X, Plus, Trash2, BadgeIndianRupee, TrendingDown, Info } from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { PayrollEntry } from '../../types';
import { formatINR } from '../../utils/calculations';

interface Props {
  month: string;
  entry: PayrollEntry;
  adjustedEntry: PayrollEntry;
  onClose: () => void;
}

/** Add labelled pay/allowance and deduction lines to one payroll entry. */
export const CustomPayDeductionModal: React.FC<Props> = ({
  month,
  entry,
  adjustedEntry,
  onClose,
}) => {
  const { payrollAdjustments, addPayrollAdjustment, removePayrollAdjustment } = useSkyhook();
  const [type, setType] = useState<'pay' | 'deduction'>('pay');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = `${month}:${entry.employeeCode}`;
  const stored = payrollAdjustments[key] ?? { pay: [], deductions: [] };
  const items = type === 'pay' ? stored.pay : stored.deductions;
  const customPayTotal = stored.pay.reduce((s, a) => s + a.amount, 0);
  const customDeductionTotal = stored.deductions.reduce((s, a) => s + a.amount, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!label.trim() || !value || value <= 0) return;
    setSaving(true);
    setError(null);
    try {
      await addPayrollAdjustment(month, entry.employeeCode, type, label.trim(), value, remarks.trim() || undefined);
      setLabel('');
      setAmount('');
      setRemarks('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the line.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="min-w-0">
            <span className="stat-label block">
              {entry.employeeCode} · {month}
            </span>
            <h3 className="modal-title mt-0.5">Custom Pay &amp; Deductions</h3>
            <p className="text-xs text-ink-500">{entry.employeeName} · {entry.designation}</p>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-line bg-surface-muted p-2.5">
              <span className="stat-label">Original net</span>
              <span className="mt-1 block text-xs font-bold text-ink-900">{formatINR(entry.netSalary)}</span>
            </div>
            <div className="rounded-lg border border-line bg-success-50 p-2.5">
              <span className="stat-label text-success-800">Custom pay</span>
              <span className="mt-1 block text-xs font-bold text-success-800">+ {formatINR(customPayTotal)}</span>
            </div>
            <div className="rounded-lg border border-line bg-danger-50 p-2.5">
              <span className="stat-label text-danger-800">Deductions</span>
              <span className="mt-1 block text-xs font-bold text-danger-800">− {formatINR(customDeductionTotal)}</span>
            </div>
          </div>

          <div className="notice">
            <span className="flex items-start gap-2 text-xs text-ink-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Adjusted net payable: <strong className="text-ink-900">{formatINR(adjustedEntry.netSalary)}</strong>. Lines are stored on the server against this employee and month, so they survive a payroll recalculation.
            </span>
          </div>

          {error && (
            <div className="notice notice--error text-xs text-danger-700" role="alert">{error}</div>
          )}

          <div className="tab-bar">
            <button type="button" className={`tab ${type === 'pay' ? 'tab-active' : ''}`} onClick={() => setType('pay')}>
              Custom Pay / Allowance
            </button>
            <button type="button" className={`tab ${type === 'deduction' ? 'tab-active' : ''}`} onClick={() => setType('deduction')}>
              Custom Deduction
            </button>
          </div>

          <div className="space-y-2">
            {items.length ? (
              items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-ink-900">{item.label}</p>
                    {item.remarks && <p className="truncate text-[11px] text-ink-500">{item.remarks}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`text-xs font-bold ${type === 'pay' ? 'text-success-700' : 'text-danger-700'}`}>
                      {type === 'pay' ? '+' : '−'} {formatINR(item.amount)}
                    </span>
                    <button
                      type="button"
                      className="icon-btn hover:text-danger-700"
                      onClick={async () => {
                        setError(null);
                        try {
                          await removePayrollAdjustment(month, entry.employeeCode, type, item.id);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Could not remove the line.');
                        }
                      }}
                      title="Remove line"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state py-5 text-xs text-ink-500">
                No {type === 'pay' ? 'custom pay' : 'custom deduction'} lines added yet.
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3 border-t border-line pt-4">
            <div>
              <label className="form-label">{type === 'pay' ? 'Pay / allowance name' : 'Deduction name'}</label>
              <input
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={type === 'pay' ? 'e.g. Site allowance, Bonus' : 'e.g. TDS, Canteen, Penalty'}
                className="form-input"
              />
            </div>
            <div className="form-grid">
              <div>
                <label className="form-label">Amount (₹)</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 1500"
                  className="form-input"
                />
              </div>
              <div>
                <label className="form-label">Remarks (optional)</label>
                <input
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Reason or reference"
                  className="form-input"
                />
              </div>
            </div>
            <button type="submit" disabled={saving} className="btn btn-primary w-full">
              {type === 'pay' ? <BadgeIndianRupee className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              <Plus className="h-3.5 w-3.5" />
              Add {type === 'pay' ? 'pay' : 'deduction'} line
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
