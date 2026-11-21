import React from 'react';
import { X, Printer, Download, CheckCircle2 } from 'lucide-react';
import { PayrollEntry, CompanySettings } from '../../types';
import { formatINR, formatDateDDMMYYYY } from '../../utils/calculations';
import { Currency } from '../common/Currency';

interface SalarySlipModalProps {
  entry: PayrollEntry;
  settings: CompanySettings;
  payrollMonth: string;
  paymentDueDate: string;
  onClose: () => void;
}

export const SalarySlipModal: React.FC<SalarySlipModalProps> = ({
  entry,
  settings,
  payrollMonth,
  paymentDueDate,
  onClose,
}) => {
  const periodLabel = /^\d{4}-\d{2}$/.test(payrollMonth)
    ? new Date(`${payrollMonth}-01T00:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' })
    : payrollMonth;
  const prettyMode = (entry.paymentMode ?? '').replace(/_/g, ' ');
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="modal-overlay overflow-y-auto">
      <div className="modal-panel modal-panel-wide">
        {/* Top Modal Bar (Excluded from print) */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 bg-logo-700 text-white no-print">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm">Salary Slip Preview</span>
            <span className="badge badge-neutral">
              {periodLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="btn btn-secondary btn-sm"
            >
              <Printer className="w-4 h-4 text-brand-600" />
              <span>Print / Save PDF</span>
            </button>
            <button
              onClick={onClose}
              className="icon-btn text-white"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Official Salary Slip (A4 Portrait format) */}
        <div className="p-4 sm:p-10 space-y-5 sm:space-y-6 text-ink-800 bg-surface print-page font-sans">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-line pb-5">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-lg border border-line p-1 flex items-center justify-center bg-surface">
                <img
                  src={settings.logoUrl || '/assets/image.png'}
                  alt="Skyhook Logo"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-ink-900 tracking-tight">
                  {settings.name || 'SKYHOOK'}
                </h1>
                <p className="text-xs font-bold text-brand-600 uppercase tracking-widest">
                  {settings.tagline || 'Elevating Crane Operations.'}
                </p>
                <p className="text-xs text-ink-600 mt-1 max-w-sm">
                  {settings.address}, {settings.city}, {settings.state} - {settings.pincode}
                </p>
                <p className="text-[11px] text-ink-500">
                  GSTIN: {settings.gstNumber} | Phone: {settings.phone}
                </p>
              </div>
            </div>

            <div className="sm:text-right">
              <div className="inline-block px-3 py-1 rounded-full bg-logo-700 text-white text-xs font-bold tracking-wider uppercase mb-1">
                SALARY SLIP
              </div>
              <p className="text-xs font-semibold text-ink-600">Pay Period: {periodLabel}</p>
              <p className="text-xs text-ink-500">Payment Date: {formatDateDDMMYYYY(paymentDueDate)}</p>
            </div>
          </div>

          {/* Employee & Attendance Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs border border-line rounded-lg p-4 bg-surface-muted">
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-ink-500">Employee Code:</span>
                <strong className="text-ink-900">{entry.employeeCode}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Employee Name:</span>
                <strong className="text-ink-900">{entry.employeeName}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Designation:</span>
                <span className="font-semibold text-ink-800">{entry.designation}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Salary Model:</span>
                <span className="font-semibold text-ink-800 capitalize inline-flex items-center gap-1">
                  {entry.salaryType} Rate (<Currency value={entry.appliedDailyRate || entry.appliedMonthlyRate} size="xs" />)
                </span>
              </div>
            </div>

            <div className="space-y-1.5 border-t sm:border-t-0 sm:border-l border-line pt-4 sm:pt-0 sm:pl-4">
              <div className="flex justify-between">
                <span className="text-ink-500">Standard Daily Shift:</span>
                <strong className="text-ink-900">{entry.standardShiftHours} Hours</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Days in Month:</span>
                <span className="font-semibold text-ink-800">{entry.totalDaysInMonth} Days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Payable Working Days:</span>
                <strong className="text-success-700">{entry.payableDays} Days</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Approved Overtime:</span>
                <strong className="text-brand-700">{entry.totalOtHours} Hours</strong>
              </div>
            </div>
          </div>

          {/* Earnings & Deductions Breakdown Table */}
          <div className="border border-line rounded-lg overflow-hidden">
            <div className="grid grid-cols-2 bg-logo-700 text-white text-xs font-bold uppercase tracking-wider py-2.5 px-4 sm:grid">
              <div>Earnings</div>
              <div className="text-right">Deductions</div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x divide-line text-xs">
              {/* Earnings Column */}
              <div className="p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="inline-flex flex-wrap items-center gap-1">
                    Base Salary ({entry.payableDays} Days @ <Currency value={entry.appliedDailyRate} size="xs" />/day)
                  </span>
                  <Currency value={entry.baseSalary} />
                </div>

                {entry.projectOtBreakdown && entry.projectOtBreakdown.length > 0 ? (
                  entry.projectOtBreakdown.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-ink-600 pl-2 text-[11px]">
                      <span className="inline-flex items-center gap-1">
                        OT ({item.projectName.slice(0, 20)}...): {item.otHours}h @ <Currency value={item.otRate} size="xs" />/h
                      </span>
                      <Currency value={item.amount} size="xs" />
                    </div>
                  ))
                ) : (
                  <div className="flex justify-between items-center text-ink-500">
                    <span>Approved Overtime</span>
                    <Currency value={entry.otAmount} />
                  </div>
                )}

                {entry.allowances > 0 && (
                  <div className="flex justify-between items-center">
                    <span>Special Allowances</span>
                    <Currency value={entry.allowances} />
                  </div>
                )}

                {entry.customPay?.map((item) => (
                  <div key={item.id} className="flex justify-between items-center pl-2 text-[11px] text-success-800">
                    <span>{item.label}</span>
                    <Currency value={item.amount} size="xs" />
                  </div>
                ))}

                <div className="pt-4 border-t border-line flex justify-between items-center font-bold text-ink-900">
                  <span>Gross Earnings:</span>
                  <Currency value={entry.grossSalary} size="lg" className="text-ink-900 font-bold" />
                </div>
              </div>

              {/* Deductions Column */}
              <div className="p-4 space-y-2 bg-surface-muted border-t border-line sm:border-t-0">
                <div className="flex justify-between items-center">
                  <span>Salary Advance Recovery</span>
                  <Currency value={entry.advanceRecovery} className="text-warning-700 font-bold" />
                </div>

                {entry.otherDeductions > 0 && (
                  <div className="flex justify-between items-center">
                    <span>Other Deductions (TDS / Penalty)</span>
                    <Currency value={entry.otherDeductions} />
                  </div>
                )}

                {entry.customDeductions?.map((item) => (
                  <div key={item.id} className="flex justify-between items-center pl-2 text-[11px] text-danger-700">
                    <span>{item.label}</span>
                    <Currency value={item.amount} size="xs" />
                  </div>
                ))}

                <div className="pt-4 border-t border-line flex justify-between items-center font-bold text-ink-900">
                  <span>Total Deductions:</span>
                  <Currency value={entry.totalDeductions} size="lg" className="text-brand-600 font-bold" />
                </div>
              </div>
            </div>

            {/* Net Salary Highlight Footer */}
            <div className="bg-success-50 border-t-2 border-success-600 p-4 flex items-center justify-between">
              <div>
                <span className="text-xs uppercase font-bold tracking-wider text-success-900">
                  NET PAYABLE SALARY
                </span>
                <p className="text-[11px] text-success-700">Bank transfer / UPI disbursal amount</p>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-success-800">
                <Currency value={entry.netSalary} size="2xl" className="text-success-800 font-bold" />
              </div>
            </div>
          </div>

          {/* Payment Status & Signatures */}
          <div className="pt-6 border-t border-line grid grid-cols-1 sm:grid-cols-2 gap-6 items-end">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                <CheckCircle2 className="w-4 h-4 text-success-600" />
                <span>
                  Disbursal Status: <strong className="uppercase">{entry.paymentStatus}</strong>
                </span>
              </div>
              {entry.paymentDate && (
                <p className="text-[11px] text-ink-500 mt-0.5">
                  Paid on {formatDateDDMMYYYY(entry.paymentDate)} via {prettyMode}{entry.paymentReference ? ` (${entry.paymentReference})` : ''}
                </p>
              )}
              <p className="text-[10px] text-ink-400 mt-2">
                System generated computer payslip • Skyhook Crane Business Management ERP
              </p>
            </div>

            <div className="sm:text-right space-y-1">
              <div className="h-10 border-b border-dashed border-line w-48 sm:ml-auto" />
              <p className="text-xs font-bold text-ink-800">{settings.authorizedSignatory}</p>
              <p className="text-[11px] text-ink-500">{settings.signatoryTitle}</p>
              <p className="text-[10px] text-ink-400 font-semibold uppercase tracking-wider">
                Authorized Signatory
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
