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
  onSaveLoan: (loan: Omit<MachineEmiLoan, 'id'>) => void;
}

export const EmiCalculatorModal: React.FC<EmiCalculatorModalProps> = ({
  machines,
  onClose,
  onSaveLoan,
}) => {
  const { currentDate } = useSkyhook();
  const [selectedAssetId, setSelectedAssetId] = useState(machines[0]?.assetId ?? '');
  const [lenderName, setLenderName] = useState('');
  const [loanAccountNumber, setLoanAccountNumber] = useState('');
  const [principalAmount, setPrincipalAmount] = useState<number>(0);
  const [annualInterestRate, setAnnualInterestRate] = useState<number>(9.5);
  const [tenureMonths, setTenureMonths] = useState<number>(48);
  const [disbursalDate, setDisbursalDate] = useState(currentDate);
  const [dueDayOfMonth, setDueDayOfMonth] = useState<number>(10);
  const [leadReminderDays, setLeadReminderDays] = useState<number>(15);

  const selectedMachine = machines.find((m) => m.assetId === selectedAssetId) || machines[0];

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
    const startDate = new Date(disbursalDate);

    for (let i = 1; i <= tenureMonths; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(startDate.getMonth() + i);
      dueDate.setDate(dueDayOfMonth);
      const dateStr = dueDate.toISOString().split('T')[0];

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
        paymentMode: isPast ? 'NACH Auto-Debit' : undefined,
        paymentReference: isPast ? `ACH-${Math.floor(100000 + Math.random() * 900000)}` : undefined,
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

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssetId || principalAmount <= 0 || tenureMonths <= 0) return;

    const actualLoanId = `LOAN-${Date.now().toString().slice(-6)}`;
    const finalSchedule = generateSchedule(actualLoanId);

    const newLoan: Omit<MachineEmiLoan, 'id'> = {
      loanId: actualLoanId,
      assetId: selectedAssetId,
      loanProvider: lenderName,
      loanRefNumber: loanAccountNumber,
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

    onSaveLoan(newLoan);
    onClose();
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
          <div className="modal-body space-y-5">
            {/* Target machine & lender */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="form-label">Target crane / machine asset</label>
                <Select value={selectedAssetId} required onValueChange={setSelectedAssetId}>
                  <SelectTrigger className="form-input">
                    <SelectValue placeholder="Select machine asset" />
                  </SelectTrigger>
                  <SelectContent>
                    {machines.map((m) => (
                      <SelectItem key={m.assetId} value={m.assetId}>
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
                    {[1, 5, 7, 10, 15, 20, 25, 28].map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {day}th of each month
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
                    min="50000"
                    step="50000"
                    required
                    value={principalAmount}
                    onChange={(e) => setPrincipalAmount(parseFloat(e.target.value) || 0)}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">Annual interest rate (% p.a.)</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    step="0.1"
                    required
                    value={annualInterestRate}
                    onChange={(e) => setAnnualInterestRate(parseFloat(e.target.value) || 0)}
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
                      <SelectItem value="12">12 months (1 year)</SelectItem>
                      <SelectItem value="24">24 months (2 years)</SelectItem>
                      <SelectItem value="36">36 months (3 years)</SelectItem>
                      <SelectItem value="48">48 months (4 years)</SelectItem>
                      <SelectItem value="60">60 months (5 years)</SelectItem>
                      <SelectItem value="72">72 months (6 years)</SelectItem>
                      <SelectItem value="84">84 months (7 years)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Live calculation results */}
            <div className="stat-grid sm:grid-cols-3">
              <div className="stat-card border-logo-700">
                <span className="stat-label">Monthly EMI payout</span>
                <div className="stat-value">
                  <Currency value={calculatedEmi} size="xl" />
                </div>
                <p className="stat-hint">Due on {dueDayOfMonth}th each month</p>
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
                  Installment schedule preview · First 5 of {tenureMonths}
                </span>
                <span className="text-[11px] font-medium text-ink-500">
                  {paidCount} paid · {remainingCount} pending
                </span>
              </div>
              <div className="divide-y divide-line">
                {previewSchedule.slice(0, 5).map((inst) => (
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
                        {inst.status.replace('_', ' ')}
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
            <button type="submit" className="btn btn-primary">
              <Plus className="h-4 w-4" />
              Save Loan &amp; Generate Schedule
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
