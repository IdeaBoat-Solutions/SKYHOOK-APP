import React, { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { X, Plus, Search } from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { formatINR, formatDateDDMMYYYY } from '../../utils/calculations';

import { DateInput } from '../common/DateInput';
import { PeriodFilter, inPeriod, defaultPeriod, type PeriodState } from '../common/PeriodFilter';

const titleCase = (s: string) => s.replace(/_/g, ' ');

export const AdvancesView: React.FC = () => {
  const {
    advances,
    employees,
    addAdvance,
    currentDate,
    currentUser,
  } = useSkyhook();

  const [searchTerm, setSearchTerm] = useState('');
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod('month'));
  const [showAddModal, setShowAddModal] = useState(false);

  // Form Fields
  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(currentDate);
  const [paymentMode, setPaymentMode] = useState<'cash' | 'bank_transfer' | 'upi' | 'cheque'>('bank_transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [remarks, setRemarks] = useState('');

  // Only the owner can disburse advances (advance:write is an owner permission).
  const canRecord = currentUser.role === 'owner';
  const operators = employees.filter((e) => e.employeeType === 'operator' && e.status === 'active');

  const openAddModal = () => {
    setEmployeeId(operators[0]?.id ?? '');
    setAmount('');
    setDate(currentDate);
    setPaymentMode('bank_transfer');
    setRemarks('');
    setPaymentReference('');
    setFormError('');
    setShowAddModal(true);
  };

  const handleCreateAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const value = parseFloat(amount);
    if (!employeeId) return setFormError('Choose an operator.');
    if (!Number.isFinite(value) || value <= 0) return setFormError('Enter the advance amount.');
    setSaving(true);
    setFormError('');
    try {
      await addAdvance({
        employeeId,
        date,
        amount: value,
        paymentMode,
        paymentReference: paymentReference.trim() || undefined,
        remarks,
        approvedBy: currentUser.name,
      });
      setShowAddModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the advance.');
    } finally {
      setSaving(false);
    }
  };

  const totalDisbursed = advances.reduce((s, a) => s + a.amount, 0);
  const totalRecovered = advances.reduce((s, a) => s + a.recoveryAmount, 0);
  const totalOutstanding = advances.reduce((s, a) => s + a.outstandingBalance, 0);

  const filteredAdvances = advances.filter((adv) => {
    const emp = employees.find((e) => e.id === adv.employeeId || e.employeeId === adv.employeeId);
    if (!inPeriod(adv.date, period, currentDate)) return false;
    const q = searchTerm.toLowerCase();
    return (
      !q ||
      emp?.fullName.toLowerCase().includes(q) ||
      adv.advanceId.toLowerCase().includes(q) ||
      (adv.remarks && adv.remarks.toLowerCase().includes(q))
    );
  });

  const statusBadge = (status: string) => (
    <span className={`badge ${status === 'fully_recovered' ? 'badge-success' : 'badge-warning'}`}>
      {titleCase(status)}
    </span>
  );

  return (
    <div className="space-y-4 sm:space-y-6 pb-12">
      {/* Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Salary Advance Management</h2>
          <p className="page-subtitle">
            Disburse advances to operators, manage partial recoveries in monthly payroll, and carry forward outstanding balances.
          </p>
        </div>

        {canRecord && (
          <button onClick={openAddModal} className="btn btn-primary">
            <Plus className="w-4 h-4" />
            <span>Record New Advance</span>
          </button>
        )}
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="stat-card">
          <span className="stat-label">Total Advances Disbursed</span>
          <div className="stat-value">{formatINR(totalDisbursed)}</div>
          <span className="stat-hint">Total historical disbursements</span>
        </div>

        <div className="stat-card !bg-success-50 !border-success-200">
          <span className="stat-label text-success-800">Total Recovered via Payroll</span>
          <div className="stat-value text-success-900">{formatINR(totalRecovered)}</div>
          <span className="stat-hint text-success-700">Deducted from approved payrolls</span>
        </div>

        <div className="stat-card !bg-warning-50 !border-warning-200">
          <span className="stat-label text-warning-800">Outstanding Balance</span>
          <div className="stat-value text-warning-900">{formatINR(totalOutstanding)}</div>
          <span className="stat-hint text-warning-700">To be recovered in future payouts</span>
        </div>
      </div>

      <PeriodFilter value={period} onChange={setPeriod} />

      {/* Advance Records */}
      <div className="table-card">
        <div className="card-header">
          <div className="search-box w-full">
            <Search className="w-4 h-4 text-ink-400" />
            <input
              type="text"
              placeholder="Search by operator or advance ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-input pl-9"
            />
          </div>
        </div>

        {filteredAdvances.length === 0 && (
          <p className="p-6 text-center text-xs text-ink-500">No advances in this period.</p>
        )}

        {/* Phones: cards */}
        <div className="md:hidden divide-y divide-line">
          {filteredAdvances.map((adv) => {
            const op = employees.find((e) => e.id === adv.employeeId || e.employeeId === adv.employeeId);
            return (
              <div key={adv.id} className="p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-ink-900">{op?.fullName || adv.employeeId}</div>
                    <div className="text-[11px] text-ink-500">
                      {adv.advanceId} • {op?.employeeId} • {formatDateDDMMYYYY(adv.date)}
                    </div>
                  </div>
                  {statusBadge(adv.status)}
                </div>
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-ink-500">Disbursed</dt>
                    <dd className="font-bold text-ink-900">{formatINR(adv.amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Recovered</dt>
                    <dd className="font-semibold text-success-700">{formatINR(adv.recoveryAmount)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Outstanding</dt>
                    <dd className="font-bold text-warning-900">{formatINR(adv.outstandingBalance)}</dd>
                  </div>
                </dl>
                <div className="text-xs text-ink-600 break-words">
                  <span className="capitalize">{titleCase(adv.paymentMode)}</span>
                  {adv.paymentReference && <span className="text-ink-400"> • {adv.paymentReference}</span>}
                  {adv.remarks && <span className="block text-ink-500">{adv.remarks}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Larger screens: table */}
        <div className="table-wrap hidden md:block">
          <table className="data-table">
            <thead>
              <tr>
                <th className="px-3.5 py-3">Advance ID</th>
                <th className="px-3.5 py-3">Date</th>
                <th className="px-3.5 py-3">Operator</th>
                <th className="px-3.5 py-3">Disbursed Amount</th>
                <th className="px-3.5 py-3">Recovered So Far</th>
                <th className="px-3.5 py-3">Outstanding Balance</th>
                <th className="px-3.5 py-3">Payment Mode & Ref</th>
                <th className="px-3.5 py-3">Remarks / Reason</th>
                <th className="px-3.5 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-700">
              {filteredAdvances.map((adv) => {
                const op = employees.find((e) => e.id === adv.employeeId || e.employeeId === adv.employeeId);
                return (
                  <tr key={adv.id} className="transition-colors">
                    <td className="px-3.5 py-3 font-bold text-ink-900">{adv.advanceId}</td>
                    <td className="px-3.5 py-3 text-ink-600">{formatDateDDMMYYYY(adv.date)}</td>
                    <td className="px-3.5 py-3 font-semibold">
                      <div className="text-ink-900 font-bold">{op?.fullName || adv.employeeId}</div>
                      <span className="text-[10px] text-ink-500">{op?.employeeId}</span>
                    </td>
                    <td className="px-3.5 py-3 font-bold text-ink-900">{formatINR(adv.amount)}</td>
                    <td className="px-3.5 py-3 font-semibold text-success-700">{formatINR(adv.recoveryAmount)}</td>
                    <td className="px-3.5 py-3 font-bold text-warning-900 bg-warning-50/40">
                      {formatINR(adv.outstandingBalance)}
                    </td>
                    <td className="px-3.5 py-3 text-ink-600">
                      <span className="capitalize">{titleCase(adv.paymentMode)}</span>
                      {adv.paymentReference && (
                        <span className="text-[10px] text-ink-400 block">{adv.paymentReference}</span>
                      )}
                    </td>
                    <td className="px-3.5 py-3 text-ink-600 max-w-xs truncate">{adv.remarks || '-'}</td>
                    <td className="px-3.5 py-3 text-center">{statusBadge(adv.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Advance Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <h3 className="modal-title">Disburse Salary Advance</h3>
              <button onClick={() => setShowAddModal(false)} className="icon-btn" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form id="advance-form" onSubmit={handleCreateAdvance} className="modal-body space-y-4 text-xs">
              {formError && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800" role="alert">
                  <span className="font-semibold">{formError}</span>
                </div>
              )}
              <div>
                <label className="form-label">Select Operator:</label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger className="form-input">
                    <SelectValue placeholder="Select operator" />
                  </SelectTrigger>
                  <SelectContent>
                    {operators.map((op) => (
                      <SelectItem key={op.id} value={op.id}>
                        {op.fullName} ({op.employeeId}) – Daily: ₹{op.dailyRate}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="form-grid">
                <div>
                  <label className="form-label">Advance Amount (₹):</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    required
                    min="1"
                    placeholder="Amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">Disbursal Date:</label>
                  <DateInput required value={date} onChange={(e) => setDate(e.target.value)} className="form-input" />
                </div>
              </div>

              <div className="form-grid">
                <div>
                  <label className="form-label">Payment Mode:</label>
                  <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as typeof paymentMode)}>
                    <SelectTrigger className="form-input">
                      <SelectValue placeholder="Select payment mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank Transfer / IMPS</SelectItem>
                      <SelectItem value="upi">Company UPI</SelectItem>
                      <SelectItem value="cash">Cash Handover</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="form-label">Ref / UTR Number:</label>
                  <input
                    type="text"
                    placeholder="Optional"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div>
                <label className="form-label">Reason / Purpose of Advance:</label>
                <textarea
                  rows={2}
                  required
                  placeholder="Why is this advance being given?"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="form-input"
                />
              </div>
            </form>

            <div className="modal-footer">
              <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" form="advance-form" disabled={saving} className="btn btn-primary">
                {saving ? 'Saving…' : 'Disburse Advance'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
