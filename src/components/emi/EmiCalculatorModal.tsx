import React, { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { X, Calculator, Plus } from 'lucide-react';
import { MachineAsset, MachineEmiLoan, EmiInstallment } from '../../types';
import { Currency } from '../common/Currency';
import { useSkyhook } from '../../data/apiStore';

import { DateInput } from '../common/DateInput';
import { formatDateDDMMYYYY } from '../../utils/calculations';
interface EmiCalculatorModalProps {
  machines: MachineAsset[];
  onClose: () => void;
  onSaveLoan: (loan: Omit<MachineEmiLoan, 'id'>) => void | Promise<void>;
}

const ordinal = (n: number) => {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

export const EmiCalculatorModal: React.FC<EmiCalculatorModalProps> = ({
  machines,
  onClose,
  onSaveLoan,
}) => {
  const { currentDate } = useSkyhook();
  // The API needs the machine's UUID, not the display code (CR-001) shown to users.
  const [selectedMachineId, setSelectedMachineId] = useState(machines[0]?.id ?? '');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [lenderName, setLenderName] = useState('');
  const [loanAccountNumber, setLoanAccountNumber] = useState('');
  // Kept as text so the fields can be cleared and accept any realistic figure (4525000, 8.75).
  const [principalText, setPrincipalText] = useState('');
  const [rateText, setRateText] = useState('');
  const principalAmount = Number(principalText) || 0;
  const annualInterestRate = Number(rateText) || 0;
  const [tenureMonths, setTenureMonths] = useState<number>(48);
  const [disbursalDate, setDisbursalDate] = useState(currentDate);
  const [dueDayOfMonth, setDueDayOfMonth] = useState<number>(10);
  const [leadReminderDays, setLeadReminderDays] = useState<number>(15);

  const selectedMachine = machines.find((m) => m.id === selectedMachineId) || machines[0];

  // Mathematical EMI Formula:
  // EMI = [P x r x (1+r)^n] / [(1+r)^n - 1]
  const monthlyRate = annualInterestRate / 12 / 100;
  let calculatedEmi = 0;
  if (monthlyRate > 0 && tenureMonths > 0 && principalAmount > 0) {
    const factor = Math.pow(1 + monthlyRate, tenureMonths);
    calculatedEmi = Math.round((principalAmount * monthlyRate * factor) / (factor - 1));
  } else if (tenureMonths > 0) {
    calculatedEmi = Math.round(principalAmount / tenureMonths);
  }

  const totalAmountPayable = calculatedEmi * tenureMonths;
  const totalInterestPayable = Math.max(0, totalAmountPayable - principalAmount);

  // Generate preview installments schedule
  const generateSchedule = (loanId: string): EmiInstallment[] => {
    const installments: EmiInstallment[] = [];
    const [startYear, startMonth] = disbursalDate.split('-').map(Number) as [number, number];

    for (let i = 1; i <= tenureMonths; i++) {
      // i-th calendar month after the disbursal month, on the due day (1-28, so it always exists).
      const monthIndex = (startMonth ?? 1) - 1 + i;
      const year = (startYear ?? 0) + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dueDayOfMonth).padStart(2, '0')}`;

      // Relative to today's business date
      const isPast = dateStr < currentDate;
      const isToday = dateStr === currentDate;

      installments.push({
        id: `INST-${loanId}-${i}`,
        loanId,
        installmentNumber: i,
        dueDate: dateStr,
        amountDue: calculatedEmi,
        amountPaid: isPast ? calculatedEmi : 0,
        status: isPast ? 'paid' : isToday ? 'due_today' : 'upcoming',
        paymentDate: isPast ? dateStr : undefined,
      });
    }

    return installments;
  };

  const tempLoanId = `LOAN-${Date.now().toString().slice(-6)}`;
  const previewSchedule = generateSchedule(tempLoanId);
  const paidCount = previewSchedule.filter((i) => i.status === 'paid').length;
  const remainingCount = tenureMonths - paidCount;

  // Calculate loan end date & next EMI date
  const lastInstallment = previewSchedule[previewSchedule.length - 1];
  const loanEndDate = lastInstallment ? lastInstallment.dueDate : disbursalDate;
  const nextPending = previewSchedule.find((i) => i.status !== 'paid');
  const nextEmiDate = nextPending ? nextPending.dueDate : loanEndDate;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!selectedMachine?.id) return setSaveError('Choose a machine from the list.');
    if (!lenderName.trim()) return setSaveError('Enter the financier / lender name.');
    if (!loanAccountNumber.trim()) return setSaveError('Enter the loan account number.');
    if (principalAmount <= 0 || tenureMonths <= 0) return setSaveError('Enter the loan principal amount.');
    if (rateText.trim() === '') return setSaveError('Enter the annual interest rate (0 if interest-free).');
    if (annualInterestRate < 0 || annualInterestRate > 60) return setSaveError('Enter an annual interest rate between 0 and 60%.');

    setSaving(true);
    setSaveError('');
    const actualLoanId = `LOAN-${Date.now().toString().slice(-6)}`;
    const finalSchedule = generateSchedule(actualLoanId);

    const newLoan: Omit<MachineEmiLoan, 'id'> = {
      loanId: actualLoanId,
      assetId: selectedMachine.id,
      loanProvider: lenderName.trim(),
      // The store sends these to the API, which builds the real schedule from them.
      ...({ principal: principalAmount, annualInterestPct: annualInterestRate } as object),
      loanRefNumber: loanAccountNumber.trim(),
      loanStartDate: disbursalDate,
      loanEndDate,
      emiAmount: calculatedEmi,
      monthlyDueDay: dueDayOfMonth,
      totalInstallments: tenureMonths,
      installmentsPaid: paidCount,
      remainingInstallments: remainingCount,
      nextEmiDate,
      reminderLeadDays: leadReminderDays,
      installments: finalSchedule,
    };

    try {
      await onSaveLoan(newLoan);
      onClose();
    } catch (err) {
      // Keep the form open with the reason: closing it here made a rejected
      // save look exactly like a successful one.
      setSaveError(err instanceof Error ? err.message : 'Could not save the loan. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-panel modal-panel-wide">
        <div className="modal-header">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <Calculator className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="modal-title">EMI Loan Calculator &amp; Setup</h2>
                <span className="badge badge-neutral">Owner only</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-500">
                Estimate repayments, preview the schedule and save it to your fleet loans.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn"
            aria-label="Close calculator"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
          {saveError && (
            <div className="notice notice--danger mx-5 mt-4 text-xs" role="alert">{saveError}</div>
          )}
          <div className="modal-body space-y-5">
            {/* Target machine & lender */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="form-label">Target crane / machine asset</label>
                <Select value={selectedMachineId} required onValueChange={setSelectedMachineId}>
                  <SelectTrigger className="form-input">
                    <SelectValue placeholder="Select machine asset" />
                  </SelectTrigger>
                  <SelectContent>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.assetId} – {m.make} {m.model} ({m.tonnageCapacity}T {m.machineType})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedMachine && (
                  <p className="mt-1 text-[11px] text-ink-500">
                    Plate: {selectedMachine.registrationNumber} · Type: {selectedMachine.machineType}
                  </p>
                )}
              </div>

              <div>
                <label className="form-label">Financier / lender institution</label>
                <input
                  type="text"
                  required
                  value={lenderName}
                  onChange={(e) => setLenderName(e.target.value)}
                  placeholder="e.g. HDFC Bank Equipment Finance, Tata Capital, SREI"
                  className="form-input"
                />
              </div>
            </div>

            {/* Account & dates */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="form-label">Loan account / agreement no.</label>
                <input
                  type="text"
                  required
                  value={loanAccountNumber}
                  onChange={(e) => setLoanAccountNumber(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">Disbursal / start date</label>
                <DateInput required
                  value={disbursalDate}
                  onChange={(e) => setDisbursalDate(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">Monthly EMI due day</label>
                <Select
                  value={String(dueDayOfMonth)}
                  onValueChange={(v) => setDueDayOfMonth(parseInt(v, 10))}
                >
                  <SelectTrigger className="form-input">
                    <SelectValue placeholder="Select due day" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {ordinal(day)} of each month
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Financial parameters */}
            <div className="space-y-4 rounded-lg border border-line bg-surface-muted p-4">
              <span className="stat-label block">Financial parameters</span>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="form-label">Principal amount (₹)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="any"
                    required
                    placeholder="e.g. 4525000"
                    value={principalText}
                    onChange={(e) => setPrincipalText(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">Annual interest rate (% p.a.)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="60"
                    step="any"
                    required
                    placeholder="e.g. 8.75"
                    value={rateText}
                    onChange={(e) => setRateText(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">Loan tenure (months)</label>
                  <Select
                    value={String(tenureMonths)}
                    onValueChange={(v) => setTenureMonths(parseInt(v, 10))}
                  >
                    <SelectTrigger className="form-input">
                      <SelectValue placeholder="Select tenure" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="6">6 months</SelectItem>
                      <SelectItem value="9">9 months</SelectItem>
                      <SelectItem value="12">12 months (1 year)</SelectItem>
                      <SelectItem value="18">18 months</SelectItem>
                      <SelectItem value="24">24 months (2 years)</SelectItem>
                      <SelectItem value="36">36 months (3 years)</SelectItem>
                      <SelectItem value="48">48 months (4 years)</SelectItem>
                      <SelectItem value="60">60 months (5 years)</SelectItem>
                      <SelectItem value="72">72 months (6 years)</SelectItem>
                      <SelectItem value="84">84 months (7 years)</SelectItem>
                      <SelectItem value="96">96 months (8 years)</SelectItem>
                      <SelectItem value="120">120 months (10 years)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {paidCount > 0 && (
              <div className="notice notice--warning text-xs" role="status">
                <strong>{paidCount} instalment{paidCount > 1 ? 's' : ''} fall before today ({formatDateDDMMYYYY(currentDate)}).</strong>{' '}
                Because the disbursal date is in the past, the system records {paidCount > 1 ? 'them' : 'it'} as already paid
                and the next EMI is due on {formatDateDDMMYYYY(nextEmiDate)}. If that is not right, correct the disbursal date.
              </div>
            )}

            {/* Live calculation results */}
            <div className="stat-grid sm:grid-cols-3">
              <div className="stat-card border-logo-700">
                <span className="stat-label">Monthly EMI payout</span>
                <div className="stat-value">
                  <Currency value={calculatedEmi} size="xl" />
                </div>
                <p className="stat-hint">Due on the {ordinal(dueDayOfMonth)} of each month</p>
              </div>

              <div className="stat-card">
                <span className="stat-label">Total interest payable</span>
                <div className="stat-value">
                  <Currency value={totalInterestPayable} size="xl" />
                </div>
                <p className="stat-hint">Over {tenureMonths} monthly cycles</p>
              </div>

              <div className="stat-card stat-card-accent">
                <span className="stat-label">Total repayment amount</span>
                <div className="stat-value">
                  <Currency value={totalAmountPayable} size="xl" />
                </div>
                <p className="stat-hint">Principal + interest aggregated</p>
              </div>
            </div>

            {/* Schedule preview */}
            <div className="card overflow-hidden">
              <div className="card-header">
                <span className="text-xs font-semibold text-ink-900">
                  Installment schedule preview · {paidCount > 0 ? `Next 5 of ${tenureMonths}` : `First 5 of ${tenureMonths}`}
                </span>
                <span className="text-[11px] font-medium text-ink-500">
                  {paidCount} paid · {remainingCount} pending
                </span>
              </div>
              <div className="divide-y divide-line">
                {previewSchedule.slice(Math.max(0, paidCount - 1), Math.max(0, paidCount - 1) + 5).map((inst) => (
                  <div
                    key={inst.installmentNumber}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs transition-colors hover:bg-surface-muted/60"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="badge badge-neutral">{inst.installmentNumber}</span>
                      <span className="truncate font-semibold text-ink-900">{formatDateDDMMYYYY(inst.dueDate)}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Currency value={inst.amountDue} size="sm" className="font-semibold text-ink-900" />
                      <span className={`badge ${inst.status === 'paid' ? 'badge-success' : 'badge-warning'}`}>
                        {inst.status === 'paid' ? 'paid (past)' : inst.status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Plus className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save Loan & Generate Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
