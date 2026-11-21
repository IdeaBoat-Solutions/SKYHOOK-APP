import React, { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  X,
  Calculator,
  Lock,
  Unlock,
  CheckCircle2,
  Download,
  Printer,
  FileSpreadsheet,
  AlertCircle,
  ReceiptIndianRupee,
  Calendar,
  CreditCard,
  UserCheck,
  Search,
  ArrowRight,
  UsersRound,
  Banknote,
  Clock3,
  Wallet,
  TrendingDown,
  Landmark,
  BadgeIndianRupee,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { formatINR, formatDateDDMMYYYY } from '../../utils/calculations';
import { exportPayrollSummary } from '../../utils/excelAndPdf';
import { PayrollEntry, PayrollRun } from '../../types';
import { SalarySlipModal } from './SalarySlipModal';
import { CustomPayDeductionModal } from './CustomPayDeductionModal';
import { Currency } from '../common/Currency';
import { withPayrollAdjustments } from '../../data/localExtras';

export const PayrollView: React.FC = () => {
  const {
    currentUser,
    currentDate,
    companySettings,
    payrollRuns,
    payrollAdjustments,
    generatePayrollForMonth,
    approvePayrollRun,
    markPayrollEntryPaid,
  } = useSkyhook();

  const [selectedMonth, setSelectedMonth] = useState(currentDate.slice(0, 7));
  // Last 12 months, newest first, plus any month that already has a run.
  const monthOptions = Array.from(
    new Set([
      ...Array.from({ length: 12 }, (_, i) => {
        const d = new Date(Number(currentDate.slice(0, 4)), Number(currentDate.slice(5, 7)) - 1 - i, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }),
      ...payrollRuns.map((r) => r.month),
    ]),
  )
    .sort((a, b) => b.localeCompare(a))
    .map((value) => ({
      value,
      label: new Date(`${value}-01T00:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
    }));
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEntryForSlip, setSelectedEntryForSlip] = useState<PayrollEntry | null>(null);
  const [adjustmentEntryCode, setAdjustmentEntryCode] = useState<string | null>(null);

  // Payment Recording Modal State
  const [paymentModalEntry, setPaymentModalEntry] = useState<PayrollEntry | null>(null);
  const [payMode, setPayMode] = useState('NEFT Bank Transfer');
  const [payRef, setPayRef] = useState('');

  // Only the selected month's run: showing another month's figures under this month's title misleads.
  const currentRun = payrollRuns.find((r) => r.month === selectedMonth);
  // Server totals stay authoritative; custom lines are layered on for display,
  // salary slips, KPIs and exports.
  const adjustedRun = currentRun ? withPayrollAdjustments(currentRun, payrollAdjustments) : undefined;
  const rawAdjustmentEntry = currentRun?.entries.find(
    (e) => e.employeeCode === adjustmentEntryCode,
  );
  const adjustedAdjustmentEntry = adjustedRun?.entries.find(
    (e) => e.employeeCode === adjustmentEntryCode,
  );
  // Custom lines are owner-managed and cannot change an approved/locked run.
  const canAdjust = currentUser.role === 'owner' && !currentRun?.locked;

  const isOwner = currentUser.role === 'owner';
  const monthLabel = (ym: string) =>
    new Date(`${ym}-01T00:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  // Every payroll action reports what really happened instead of failing silently.
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, okText: string) => {
    if (busy) return false;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ text: okText, kind: 'ok' });
      return true;
    } catch (e) {
      setNotice({ text: e instanceof Error && e.message ? e.message : 'Could not complete that. Please try again.', kind: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = () =>
    run(() => generatePayrollForMonth(selectedMonth), `Payroll for ${monthLabel(selectedMonth)} recalculated from approved attendance.`);

  const handleApprove = () => {
    if (!currentRun || !isOwner) return;
    if (
      window.confirm(
        `Approve and lock the ${monthLabel(currentRun.month)} payroll? This freezes wage rates and attendance for the month and deducts advance recoveries from operator balances.`
      )
    ) {
      void run(() => approvePayrollRun(currentRun.id), `${monthLabel(currentRun.month)} payroll approved and locked.`);
    }
  };

  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalEntry || !currentRun) return;
    const serverMode = (
      {
        'NEFT Bank Transfer': 'bank_transfer',
        'IMPS Instant Transfer': 'bank_transfer',
        'Company UPI Account': 'upi',
        'Account Payee Cheque': 'cheque',
        'Cash Voucher': 'cash',
      } as Record<string, string>
    )[payMode] ?? 'bank_transfer';
    const entry = paymentModalEntry;
    const ok = await run(
      () => markPayrollEntryPaid(currentRun.id, entry.id, serverMode, payRef.trim()),
      `Recorded salary payment of ${formatINR(entry.netSalary)} for ${entry.employeeName}.`,
    );
    if (ok) {
      setPaymentModalEntry(null);
      setPayRef('');
    }
  };

  // Polished KPI card shared by the payroll summary grid. Uses the same
  // tokens, radius and icon treatment as the dashboard KPI cards.
  type PayrollCardAccent = 'neutral' | 'brand' | 'warning' | 'success';

  const payrollCardAccents: Record<PayrollCardAccent, { icon: string; bar: string }> = {
    neutral: { icon: 'tone-neutral', bar: 'bg-ink-400' },
    brand: { icon: 'tone-brand', bar: 'bg-brand-600' },
    warning: { icon: 'tone-warning', bar: 'bg-warning-500' },
    success: { icon: 'tone-success', bar: 'bg-success-600' },
  };

  interface PayrollStatCardProps {
    label: string;
    value: React.ReactNode;
    hint: string;
    icon: React.ElementType;
    accent: PayrollCardAccent;
    featured?: boolean;
  }

  const PayrollStatCard: React.FC<PayrollStatCardProps> = ({
    label,
    value,
    hint,
    icon: Icon,
    accent,
    featured = false,
  }) => {
    const tone = payrollCardAccents[accent];
    const valueTone = featured
      ? 'text-success-900'
      : accent === 'warning'
        ? 'text-warning-600'
        : '';
    return (
      <div
        className={`kpi-card group relative overflow-hidden transition-colors ${
          featured
            ? 'border-success-200 bg-success-50 hover:border-success-300'
            : 'hover:border-line-strong'
        }`}
      >
        <span className={`absolute inset-x-0 top-0 h-0.5 ${tone.bar}`} aria-hidden="true" />

        <div className="flex items-start justify-between gap-3">
          <span className={`stat-label ${featured ? 'text-success-800' : ''}`}>{label}</span>
          <span className={`kpi-card__icon ${tone.icon}`}>
            <Icon className="h-4 w-4" strokeWidth={2} />
          </span>
        </div>

        <div className={`kpi-card__value ${valueTone}`}>{value}</div>

        <div className={`kpi-card__foot ${featured ? '!border-success-200' : ''}`}>
          <span
            className={`truncate text-[11px] font-medium ${
              featured ? 'text-success-700' : 'text-ink-500'
            }`}
          >
            {hint}
          </span>
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone.icon}`}
          >
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
        </div>
      </div>
    );
  };

  const filteredEntries = (adjustedRun?.entries || []).filter((entry) => {
    const matchSearch =
      entry.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.employeeCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.designation.toLowerCase().includes(searchTerm.toLowerCase());
    return matchSearch;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header & Payroll Actions */}
      <div className="page-header">
        <div>
          <h2 className="page-title">
            Automated Payroll & Salary Calculations
          </h2>
          <p className="page-subtitle">
            Formula-driven payroll using approved attendance, site-specific overtime rates, and advance deductions.
          </p>
        </div>

        <div className="page-header-actions">
          <div className="flex w-full sm:w-auto items-center gap-2">
            <label className="form-label mb-0 shrink-0">Month:</label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="form-input w-full sm:w-auto">
                <SelectValue placeholder="Select month" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isOwner && !currentRun?.locked && (
            <button onClick={handleGenerate} disabled={busy} className="btn btn-secondary">
              {currentRun ? 'Recalculate' : 'Generate Payroll'}
            </button>
          )}

          {currentRun && !currentRun.locked && isOwner && (
            <button onClick={handleApprove} disabled={busy} className="btn btn-primary">
              <Lock className="w-3.5 h-3.5" />
              <span>Approve & Lock Payroll</span>
            </button>
          )}
          {currentRun?.locked && (
            <div className="badge badge-success">
              <CheckCircle2 className="w-4 h-4 text-success-600" />
              <span>Approved & Locked by Owner</span>
            </div>
          )}
          {currentRun && !currentRun.locked && !isOwner && (
            <div className="badge badge-warning">
              <span>Draft &ndash; awaiting owner approval</span>
            </div>
          )}

          {currentRun && (
            <button
              onClick={() => exportPayrollSummary(adjustedRun ?? currentRun)}
              className="btn btn-secondary"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel Export</span>
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`notice ${notice.kind === 'error' ? 'notice--danger' : 'notice--success'} flex items-start justify-between gap-3 text-xs font-semibold`}
        >
          <span className="break-words min-w-0">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="shrink-0" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {currentRun && !currentRun.locked && (
        <div className="notice text-xs text-ink-700">
          <span>
            <strong>Draft payroll.</strong> Only approved attendance counts. Daily-wage pay is present days x daily rate (half day = 0.5);
            monthly pay is salary x payable days / days in the month, with absent, unpaid-leave and half days deducted and mid-month
            joiners prorated. Overtime is paid to OT-eligible staff only. Salaries can be marked paid once the owner approves and locks the run.
          </span>
        </div>
      )}

      {!currentRun && (
        <div className="card card-pad text-sm text-ink-600">
          No payroll has been generated for <strong>{monthLabel(selectedMonth)}</strong> yet.
          {isOwner
            ? ' Approve the attendance for the month, then press Generate Payroll.'
            : ' The owner generates and approves payroll once attendance is approved.'}
        </div>
      )}

      {/* Summary KPI Cards */}
      {currentRun && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <PayrollStatCard
            label="Employees"
            value={currentRun.employeeCount}
            hint="Total processed"
            icon={UsersRound}
            accent="neutral"
          />

          <PayrollStatCard
            label="Total Base"
            value={<Currency value={currentRun.totalBaseSalary} size="lg" />}
            hint="Working days payout"
            icon={Banknote}
            accent="neutral"
          />

          <PayrollStatCard
            label="Project Overtime"
            value={<Currency value={currentRun.totalOvertimeSalary} size="lg" />}
            hint="Approved OT hours"
            icon={Clock3}
            accent="brand"
          />

          <PayrollStatCard
            label="Gross Payroll"
            value={<Currency value={adjustedRun?.totalGrossSalary ?? currentRun.totalGrossSalary} size="lg" />}
            hint="Base + OT + custom pay"
            icon={Wallet}
            accent="brand"
          />

          <PayrollStatCard
            label="Advance Deductions"
            value={<Currency value={currentRun.totalAdvancesRecovered} size="lg" />}
            hint="Recovered to company"
            icon={TrendingDown}
            accent="warning"
          />

          <PayrollStatCard
            label="Net Disbursal"
            value={<Currency value={adjustedRun?.totalNetSalary ?? currentRun.totalNetSalary} size="lg" />}
            hint={currentRun.paymentDueDate ? `Due ${formatDateDDMMYYYY(currentRun.paymentDueDate)}` : 'Net payable'}
            icon={Landmark}
            accent="success"
            featured
          />
        </div>
      )}

      {/* Payroll Table */}
      <div className="table-card">
        <div className="card-header">
          <div className="search-box w-full">
            <Search className="w-4 h-4 text-ink-400" />
            <input
              type="text"
              placeholder="Search operator, ID or designation..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-input pl-9"
            />
          </div>
        </div>

        {filteredEntries.length === 0 && (
          <p className="p-6 text-center text-xs text-ink-500">
            {currentRun ? 'No employees match your search.' : 'Nothing to show until payroll is generated.'}
          </p>
        )}

        {/* Phones: one card per employee */}
        <div className="lg:hidden divide-y divide-line">
          {filteredEntries.map((entry) => {
            const customPayTotal = (entry.customPay ?? []).reduce((t, a) => t + a.amount, 0);
            const customDedTotal = (entry.customDeductions ?? []).reduce((t, a) => t + a.amount, 0);
            return (
              <div key={entry.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-ink-900">{entry.employeeName}</div>
                    <div className="text-[11px] text-ink-500">{entry.employeeCode} • {entry.designation}</div>
                  </div>
                  <span className={`badge shrink-0 ${entry.paymentStatus === 'paid' ? 'badge-success' : 'badge-warning'}`}>
                    {entry.paymentStatus}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <dt className="text-ink-500">Rate ({entry.salaryType})</dt>
                    <dd className="font-semibold text-ink-800"><Currency value={entry.appliedDailyRate || entry.appliedMonthlyRate} size="xs" /></dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Payable days</dt>
                    <dd className="font-semibold text-ink-800">{entry.payableDays}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Base pay</dt>
                    <dd className="font-semibold text-ink-800"><Currency value={entry.baseSalary} size="sm" /></dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Overtime ({entry.totalOtHours} h)</dt>
                    <dd className="font-semibold text-brand-700"><Currency value={entry.otAmount} size="sm" /></dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Gross pay</dt>
                    <dd className="font-bold text-ink-900"><Currency value={entry.grossSalary} size="sm" /></dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Advance recovery</dt>
                    <dd className="font-semibold text-warning-700">
                      {entry.advanceRecovery > 0 ? '- ' : ''}<Currency value={entry.advanceRecovery} size="sm" />
                    </dd>
                  </div>
                  {customPayTotal > 0 && (
                    <div>
                      <dt className="text-ink-500">Custom pay</dt>
                      <dd className="font-semibold text-success-700">+ <Currency value={customPayTotal} size="sm" /></dd>
                    </div>
                  )}
                  {customDedTotal > 0 && (
                    <div>
                      <dt className="text-ink-500">Custom deduction</dt>
                      <dd className="font-semibold text-danger-700">- <Currency value={customDedTotal} size="sm" /></dd>
                    </div>
                  )}
                </dl>
                <div className="flex items-center justify-between rounded-lg bg-success-50 px-3 py-2">
                  <span className="text-xs font-semibold text-success-800">Net payable</span>
                  <Currency value={entry.netSalary} size="lg" className="text-success-800 font-bold" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setSelectedEntryForSlip(entry)} className="btn btn-secondary">
                    <Printer className="w-4 h-4 text-brand-700" />
                    <span>Salary slip</span>
                  </button>
                  {isOwner && entry.paymentStatus !== 'paid' && (
                    <button
                      onClick={() => setPaymentModalEntry(entry)}
                      disabled={!currentRun?.locked}
                      title={currentRun?.locked ? 'Record payment' : 'Approve and lock the payroll first'}
                      className="btn btn-primary"
                    >
                      Disburse
                    </button>
                  )}
                  {canAdjust && (
                    <button
                      onClick={() => setAdjustmentEntryCode(entry.employeeCode)}
                      className="btn btn-secondary col-span-2"
                    >
                      <BadgeIndianRupee className="w-4 h-4 text-warning-600" />
                      Custom pay / deduction
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="table-wrap hidden lg:block">
          <table className="data-table">
            <thead>
              <tr>
                <th className="px-3.5 py-3">Employee</th>
                <th className="px-3.5 py-3">Rate</th>
                <th className="px-3.5 py-3 text-center">Payable Days</th>
                <th className="px-3.5 py-3">Base Pay</th>
                <th className="px-3.5 py-3">Overtime (hrs / amt)</th>
                <th className="px-3.5 py-3">Gross Pay</th>
                <th className="px-3.5 py-3">Custom Pay</th>
                <th className="px-3.5 py-3">Custom Deduction</th>
                <th className="px-3.5 py-3">Advance Deduction</th>
                <th className="px-3.5 py-3">Net Payable</th>
                <th className="px-3.5 py-3 text-center">Status</th>
                <th className="px-3.5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-700">
              {filteredEntries.map((entry) => (
                <tr key={entry.id} className="transition-colors">
                  <td className="px-3.5 py-3 font-semibold">
                    <div className="text-ink-900 font-bold">{entry.employeeName}</div>
                    <div className="text-[11px] text-ink-500">
                      {entry.employeeCode} • {entry.designation}
                    </div>
                  </td>
                  <td className="px-3.5 py-3">
                    <span className="text-ink-700">
                      <Currency value={entry.appliedDailyRate || entry.appliedMonthlyRate} size="xs" />
                      <span className="text-[10px] text-ink-400 block">{entry.salaryType}</span>
                    </span>
                  </td>
                  <td className="px-3.5 py-3 text-center font-bold text-ink-900">
                    {entry.payableDays}
                  </td>
                  <td className="px-3.5 py-3 font-semibold text-ink-800">
                    <Currency value={entry.baseSalary} />
                  </td>
                  <td className="px-3.5 py-3">
                    <div className="font-semibold text-brand-700 flex items-center gap-1">
                      <span>
                        {entry.totalOtHours} hrs
                        <ArrowRight
                          size={12}
                          className="inline-block align-middle ml-1"
                          aria-hidden="true"
                        />
                      </span>
                      <Currency value={entry.otAmount} size="xs" />
                    </div>
                    {entry.projectOtBreakdown && entry.projectOtBreakdown.length > 0 && (
                      <div className="text-[10px] text-ink-500 space-y-0.5 mt-0.5">
                        {entry.projectOtBreakdown.map((ot, idx) => (
                          <div key={idx}>
                            {ot.projectName.slice(0, 16)}..: {ot.otHours}h @ ₹{ot.otRate}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3.5 py-3 font-bold text-ink-900">
                    <Currency value={entry.grossSalary} />
                  </td>
                  <td className="px-3.5 py-3 text-success-700 font-bold">
                    {entry.customPay?.length ? (
                      <span title={entry.customPay.map((a) => a.label).join(', ')}>
                        + <Currency value={entry.customPay.reduce((s, a) => s + a.amount, 0)} />
                      </span>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </td>
                  <td className="px-3.5 py-3 text-danger-700 font-bold">
                    {entry.customDeductions?.length ? (
                      <span title={entry.customDeductions.map((a) => a.label).join(', ')}>
                        − <Currency value={entry.customDeductions.reduce((s, a) => s + a.amount, 0)} />
                      </span>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </td>
                  <td className="px-3.5 py-3 text-warning-700 font-bold">
                    {entry.advanceRecovery > 0 ? (
                      <span className="inline-flex items-center">
                        <span>-</span>
                        <Currency value={entry.advanceRecovery} />
                      </span>
                    ) : (
                      <Currency value={0} />
                    )}
                  </td>
                  <td className="px-3.5 py-3 font-bold text-success-800 text-sm bg-success-50/40">
                    <Currency value={entry.netSalary} size="lg" className="text-success-800 font-bold" />
                  </td>
                  <td className="px-3.5 py-3 text-center">
                    <span
                      className={`badge ${
                        entry.paymentStatus === 'paid'
                          ? 'badge-success'
                          : 'badge-warning'
                      }`}
                    >
                      {entry.paymentStatus}
                    </span>
                  </td>
                  <td className="px-3.5 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {canAdjust && (
                        <button
                          onClick={() => setAdjustmentEntryCode(entry.employeeCode)}
                          className="btn btn-secondary btn-sm"
                          title="Add custom pay or deduction"
                        >
                          <BadgeIndianRupee className="w-3.5 h-3.5 text-warning-600" />
                          Custom
                        </button>
                      )}

                      <button
                        onClick={() => setSelectedEntryForSlip(entry)}
                        className="btn btn-secondary btn-sm"
                        title="Download official PDF Salary Slip"
                      >
                        <Printer className="w-3.5 h-3.5 text-brand-700" />
                        <span>Slip</span>
                      </button>

                      {isOwner && entry.paymentStatus !== 'paid' && (
                        <button
                          onClick={() => setPaymentModalEntry(entry)}
                          disabled={!currentRun?.locked}
                          className="btn btn-secondary btn-sm"
                          title={currentRun?.locked ? 'Record payment disbursal' : 'Approve and lock the payroll first'}
                        >
                          Disburse
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Salary Slip Modal */}
      {selectedEntryForSlip && (
        <SalarySlipModal
          entry={selectedEntryForSlip}
          settings={companySettings}
          payrollMonth={selectedMonth}
          paymentDueDate={currentRun?.paymentDueDate || ''}
          onClose={() => setSelectedEntryForSlip(null)}
        />
      )}

      {/* Custom Pay & Deductions Modal */}
      {rawAdjustmentEntry && adjustedAdjustmentEntry && currentRun && (
        <CustomPayDeductionModal
          month={currentRun.month}
          entry={rawAdjustmentEntry}
          adjustedEntry={adjustedAdjustmentEntry}
          onClose={() => setAdjustmentEntryCode(null)}
        />
      )}

      {/* Record Payment Disbursal Modal */}
      {paymentModalEntry && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <h3 className="modal-title">Record Salary Disbursal</h3>
              <button
                onClick={() => setPaymentModalEntry(null)}
                className="icon-btn"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form id="pay-form" onSubmit={handleConfirmPayment} className="modal-body space-y-4">
              <div>
                <span className="text-xs text-ink-500">Employee:</span>
                <p className="font-semibold text-sm text-ink-900">
                  {paymentModalEntry.employeeName} ({paymentModalEntry.employeeCode})
                </p>
                <div className="text-xs font-semibold text-success-700 mt-1">
                  Net Disbursal Amount: <strong>{formatINR(paymentModalEntry.netSalary)}</strong>
                </div>
              </div>

              <div>
                <label className="form-label">
                  Payment Mode:
                </label>
                <Select value={payMode} onValueChange={setPayMode}>
                  <SelectTrigger className="form-input">
                    <SelectValue placeholder="Select payment mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEFT Bank Transfer">NEFT Bank Transfer</SelectItem>
                    <SelectItem value="IMPS Instant Transfer">IMPS Instant Transfer</SelectItem>
                    <SelectItem value="Company UPI Account">Company UPI Account</SelectItem>
                    <SelectItem value="Account Payee Cheque">Account Payee Cheque</SelectItem>
                    <SelectItem value="Cash Voucher">Cash Voucher</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="form-label">
                  Bank Reference / UTR Number:
                </label>
                <input
                  type="text"
                  required
                  placeholder="UTR / cheque / voucher number"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  className="form-input"
                />
              </div>

            </form>
            <div className="modal-footer">
              <button type="button" onClick={() => setPaymentModalEntry(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" form="pay-form" disabled={busy} className="btn btn-primary">
                {busy ? 'Saving...' : 'Confirm Disbursal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
