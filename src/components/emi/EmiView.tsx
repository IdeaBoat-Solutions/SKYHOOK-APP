import React, { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  X,
  CreditCard,
  CheckCircle2,
  Calendar,
  ArrowRight,
  Calculator,
  ShieldAlert,
  Landmark,
  ReceiptText,
  AlertTriangle,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { formatDateDDMMYYYY } from '../../utils/calculations';
import { EmiStatus, MachineEmiLoan } from '../../types';
import { Currency } from '../common/Currency';
import { EmiCalculatorModal } from './EmiCalculatorModal';

type StatusFilter = 'all' | EmiStatus;

/** Shared visual language for every EMI status - red is reserved for overdue only. */
const statusStyles: Record<EmiStatus, { label: string; badge: string; row: string }> = {
  paid: {
    label: 'Paid',
    badge: 'badge-success',
    row: '',
  },
  overdue: {
    label: 'Overdue',
    badge: 'badge-danger',
    row: 'bg-danger-50/60',
  },
  due_today: {
    label: 'Due today',
    badge: 'badge-warning',
    row: 'bg-warning-50/50',
  },
  upcoming: {
    label: 'Upcoming',
    badge: 'badge-neutral',
    row: '',
  },
  partially_paid: {
    label: 'Partial',
    badge: 'badge-warning',
    row: '',
  },
};

const StatusBadge: React.FC<{ status: EmiStatus }> = ({ status }) => {
  const style = statusStyles[status] ?? statusStyles.upcoming;
  return (
    <span className={`badge ${style.badge}`}>
      {style.label}
    </span>
  );
};

export const EmiView: React.FC = () => {
  const {
    currentUser,
    emiLoans,
    machines,
    recordEmiPayment,
    addEmiLoan,
    getEmiAlerts,
  } = useSkyhook();

  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const selectedLoan: MachineEmiLoan | null =
    emiLoans.find((l) => l.id === selectedLoanId) ?? emiLoans[0] ?? null;
  const setSelectedLoan = (loan: MachineEmiLoan) => setSelectedLoanId(loan.id);
  const [showCalculator, setShowCalculator] = useState(false);
  const [payModalData, setPayModalData] = useState<{
    loan: MachineEmiLoan;
    installmentNumber: number;
    amount: number;
  } | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [historyLoanFilter, setHistoryLoanFilter] = useState('all');
  const [showAllCards, setShowAllCards] = useState(false);

  const [paymentMode, setPaymentMode] = useState('Net Banking NEFT');
  /** The machine's asset code (CR-003); the loan itself only carries the machine's database id. */
  const loanLabel = (loan: MachineEmiLoan) =>
    (loan as MachineEmiLoan & { assetCode?: string }).assetCode ||
    machines.find((m) => m.id === loan.assetId)?.assetId ||
    'Machine';
  const modeLabel = (m?: string) =>
    !m ? '-' : m.includes('_') || m === m.toLowerCase() ? m.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : m;
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  const emiAlerts = getEmiAlerts();

  // Access check: manager does not have access to Machine EMI
  if (currentUser.role === 'manager') {
    return (
      <div className="card card-pad mx-auto my-12 max-w-2xl space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-surface-muted text-ink-700">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Access Restricted</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-ink-500 sm:text-sm">
            Machine EMI loan records and financial installments are restricted to{' '}
            <strong className="font-semibold text-ink-700">Owner / Super Admin</strong> access only.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface-muted p-3 text-left text-xs text-ink-600">
          <p className="font-semibold text-ink-900">Active User: {currentUser.name}</p>
          <p className="mt-0.5 text-ink-500">Role: Manager ({currentUser.email})</p>
        </div>
      </div>
    );
  }

  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModalData || savingPayment) return;
    setSavingPayment(true);
    setPaymentError('');
    try {
      await recordEmiPayment(
        payModalData.loan.id,
        payModalData.installmentNumber,
        paymentMode,
        paymentRef
      );
      setPayModalData(null);
      setPaymentRef('');
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Could not record the payment. Please try again.');
    } finally {
      setSavingPayment(false);
    }
  };

  const openPay = (loan: MachineEmiLoan, installmentNumber: number, amount: number) => {
    setPaymentError('');
    setPaymentRef('');
    setPayModalData({ loan, installmentNumber, amount });
  };

  const handleSaveCalculatedLoan = async (loan: Omit<MachineEmiLoan, 'id'>) => {
    const created = await addEmiLoan(loan);
    setSelectedLoan(created);
  };

  // Presentation-only aggregates derived from existing loan records.
  const totalOutstandingEmi = emiLoans.reduce(
    (sum, l) => sum + l.emiAmount * l.remainingInstallments,
    0
  );
  const totalPaid = emiLoans.reduce(
    (sum, l) => sum + l.installments.reduce((s, inst) => s + inst.amountPaid, 0),
    0
  );
  const paidInstallments = emiLoans.reduce(
    (sum, l) => sum + l.installments.filter((i) => i.status === 'paid').length,
    0
  );
  const overdueCount = emiLoans.reduce(
    (sum, l) => sum + l.installments.filter((i) => i.status === 'overdue').length,
    0
  );

  const visibleInstallments = selectedLoan
    ? statusFilter === 'all'
      ? selectedLoan.installments
      : selectedLoan.installments.filter((i) => i.status === statusFilter)
    : [];

  // Phones show a window starting at the last settled instalment, so the next dues are in view.
  const firstUnpaid = visibleInstallments.findIndex((i) => i.status !== 'paid');
  const firstCardIdx = Math.max(0, firstUnpaid - 1);

  const paymentHistory = emiLoans
    .flatMap((loan) =>
      loan.installments
        .filter((inst) => inst.status === 'paid')
        .map((inst) => ({ loan, inst }))
    )
    .filter(({ loan }) => historyLoanFilter === 'all' || loan.id === historyLoanFilter)
    .sort((a, b) => (b.inst.paymentDate || '').localeCompare(a.inst.paymentDate || ''));

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const renderSectionHeader = (
    title: string,
    icon: React.ElementType,
    action?: React.ReactNode
  ) => {
    const Icon = icon;
    return (
      <div className="-mx-[1.125rem] mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line px-[1.125rem] pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="section-icon shrink-0">
            <Icon className="h-4 w-4" />
          </span>
          <h3 className="section-title truncate text-sm sm:text-base">
            {title}
          </h3>
        </div>
        {action}
      </div>
    );
  };

  type KpiAccent = 'brand' | 'success' | 'danger';

  const kpiAccentStyles: Record<
    KpiAccent,
    { icon: string; arrow: string; bar: string }
  > = {
    brand: {
      icon: 'tone-brand',
      arrow: 'tone-brand',
      bar: 'bg-brand-600',
    },
    success: {
      icon: 'tone-success',
      arrow: 'tone-success',
      bar: 'bg-success-600',
    },
    danger: {
      icon: 'tone-danger',
      arrow: 'tone-danger',
      bar: 'bg-danger-600',
    },
  };

  interface KpiCardProps {
    label: string;
    value: React.ReactNode;
    hint: string;
    icon: React.ElementType;
    accent: KpiAccent;
    onClick: () => void;
  }

  const KpiCard: React.FC<KpiCardProps> = ({
    label,
    value,
    hint,
    icon: Icon,
    accent,
    onClick,
  }) => {
    const styles = kpiAccentStyles[accent];
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onClick();
        }}
        className="kpi-card relative min-w-0 cursor-pointer overflow-hidden transition-colors hover:bg-surface-muted focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span
          className={`absolute inset-x-0 top-0 h-0.5 ${styles.bar}`}
          aria-hidden="true"
        />
        <div className="flex items-start justify-between gap-3">
          <span className="stat-label">{label}</span>
          <span className={`kpi-card__icon shrink-0 ${styles.icon}`}>
            <Icon className="h-4 w-4" strokeWidth={2} />
          </span>
        </div>
        <div className="kpi-card__value min-w-0 truncate">{value}</div>
        <div className="kpi-card__foot">
          <span className="stat-hint truncate">{hint}</span>
          <span className={`kpi-card__icon shrink-0 ${styles.arrow}`}>
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title !mt-0">Machine EMI Loans &amp; Installments</h2>
          <p className="page-subtitle">
            Track equipment loans, repayment schedules, payment history and upcoming dues.
          </p>
        </div>

        <button onClick={() => setShowCalculator(true)} className="btn btn-primary w-full sm:w-auto">
          <Calculator className="h-4 w-4" />
          <span>Calculate &amp; Add Loan</span>
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Active Loans"
          value={emiLoans.length}
          hint={`${emiLoans.reduce((s, l) => s + l.totalInstallments, 0)} total installments`}
          icon={Landmark}
          accent="brand"
          onClick={() => scrollTo('emi-loans')}
        />
        <KpiCard
          label="Outstanding Balance"
          value={<Currency value={totalOutstandingEmi} size="xl" />}
          hint="Across remaining installments"
          icon={CreditCard}
          accent="brand"
          onClick={() => scrollTo('emi-loans')}
        />
        <KpiCard
          label="Paid to Date"
          value={<Currency value={totalPaid} size="xl" />}
          hint={`${paidInstallments} installments cleared`}
          icon={CheckCircle2}
          accent="success"
          onClick={() => scrollTo('emi-history')}
        />
        <KpiCard
          label="Overdue EMIs"
          value={
            <span className={overdueCount > 0 ? 'text-danger-600' : 'text-success-600'}>
              {overdueCount}
            </span>
          }
          hint={`${emiAlerts.length} items in reminder window`}
          icon={AlertTriangle}
          accent="danger"
          onClick={() => {
            const overdueLoan = emiLoans.find((l) =>
              l.installments.some((i) => i.status === 'overdue')
            );
            if (overdueLoan) setSelectedLoan(overdueLoan);
            setStatusFilter('overdue');
            scrollTo('emi-schedule');
          }}
        />
      </div>

      {/* Loan accounts and installment schedule */}
      <div id="emi-loans" className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Loan accounts */}
        <div className="card card-pad">
          {renderSectionHeader(
            'Equipment Loan Accounts',
            Landmark,
            <span className="shrink-0 text-xs text-ink-500">{emiLoans.length} loans</span>
          )}

          <div className="space-y-3">
            {emiLoans.length === 0 && (
              <div className="empty-state rounded-lg border border-line bg-surface-muted py-8">
                <Landmark className="h-6 w-6 text-ink-400" />
                <p className="text-sm">No loans yet. Use "Calculate &amp; Add Loan" to add one.</p>
              </div>
            )}
            {emiLoans.map((loan) => {
              const isSelected = selectedLoan?.id === loan.id;
              const hasAlert = emiAlerts.some((a) => a.targetId === loan.assetId);
              const isOverdueLoan = loan.installments.some((i) => i.status === 'overdue');
              const progress = loan.totalInstallments
                ? Math.min(100, (loan.installmentsPaid / loan.totalInstallments) * 100)
                : 0;

              return (
                <div
                  key={loan.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedLoan(loan)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSelectedLoan(loan);
                  }}
                  className={`rounded-lg border p-4 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    isSelected
                      ? 'border-logo-700 bg-surface-muted'
                      : 'border-line bg-surface hover:border-line-strong hover:bg-surface-muted'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-ink-900">{loanLabel(loan)}</span>
                        {hasAlert && (
                          <span className={`badge ${isOverdueLoan ? 'badge-danger' : 'badge-warning'}`}>
                            {isOverdueLoan ? 'Overdue' : 'Due soon'}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-ink-500">{loan.loanProvider}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Currency
                        value={loan.emiAmount}
                        size="sm"
                        className="font-bold text-ink-900"
                      />
                      <span className="block text-[10px] text-ink-400">per month</span>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3">
                    <div>
                      <span className="stat-label block">Outstanding</span>
                      <Currency
                        value={loan.emiAmount * loan.remainingInstallments}
                        size="xs"
                        className="mt-0.5 font-bold text-ink-900"
                      />
                    </div>
                    <div className="text-right">
                      <span className="stat-label block">Next EMI</span>
                      <span className="mt-0.5 block text-xs font-bold text-ink-900">
                        {formatDateDDMMYYYY(loan.nextEmiDate)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] text-ink-500">
                      <span>Repayment progress</span>
                      <span className="font-semibold text-ink-700">
                        {loan.installmentsPaid} / {loan.totalInstallments}
                      </span>
                    </div>
                    <div className="progress mt-1.5">
                      <span style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected loan schedule */}
        <div id="emi-schedule" className="card card-pad lg:col-span-2">
          {renderSectionHeader(
            'Installment Schedule',
            Calendar,
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="form-input w-auto px-3 py-1.5 text-xs font-semibold text-ink-700">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="due_today">Due today</SelectItem>
                <SelectItem value="upcoming">Upcoming</SelectItem>
                <SelectItem value="partially_paid">Partial</SelectItem>
              </SelectContent>
            </Select>
          )}

          {selectedLoan ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="badge badge-neutral">{selectedLoan.loanRefNumber}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-500">Monthly EMI</span>
                  <Currency
                    value={selectedLoan.emiAmount}
                    size="sm"
                    className="font-bold text-ink-900"
                  />
                </div>
              </div>

              {/* Loan summary strip */}
              <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg border border-line bg-surface-muted p-3.5 sm:grid-cols-4 sm:gap-3">
                <div className="min-w-0">
                  <span className="stat-label block">Loan value</span>
                  <Currency
                    value={selectedLoan.emiAmount * selectedLoan.totalInstallments}
                    size="sm"
                    className="mt-1 font-bold text-ink-900"
                  />
                </div>
                <div className="min-w-0">
                  <span className="stat-label block">Paid to date</span>
                  <Currency
                    value={selectedLoan.emiAmount * selectedLoan.installmentsPaid}
                    size="sm"
                    className="mt-1 font-bold text-success-700"
                  />
                </div>
                <div className="min-w-0">
                  <span className="stat-label block">Outstanding</span>
                  <Currency
                    value={selectedLoan.emiAmount * selectedLoan.remainingInstallments}
                    size="sm"
                    className="mt-1 font-bold text-ink-900"
                  />
                </div>
                <div className="min-w-0">
                  <span className="stat-label block">Next due</span>
                  <span className="mt-1 block text-xs font-bold text-ink-900">
                    {formatDateDDMMYYYY(selectedLoan.nextEmiDate)}
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-2 md:hidden">
                {visibleInstallments.length === 0 && (
                  <div className="rounded-lg border border-line py-6 text-center text-xs text-ink-500">
                    No installments match this status filter.
                  </div>
                )}
                {(showAllCards ? visibleInstallments : visibleInstallments.slice(firstCardIdx, firstCardIdx + 12)).map((inst) => {
                  const style = statusStyles[inst.status] ?? statusStyles.upcoming;
                  return (
                    <div key={inst.id} className={`flex items-center justify-between gap-3 rounded-lg border border-line px-3.5 py-3 ${style.row}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-ink-500">#{inst.installmentNumber}</span>
                          <StatusBadge status={inst.status} />
                        </div>
                        <div className={`mt-1 text-sm ${inst.status === 'overdue' ? 'font-bold text-danger-700' : 'font-semibold text-ink-900'}`}>
                          {formatDateDDMMYYYY(inst.dueDate)}
                        </div>
                        <Currency value={inst.amountDue} size="xs" className="font-bold text-ink-900" />
                        {inst.status === 'paid' && inst.paymentDate && (
                          <p className="mt-0.5 text-[11px] text-ink-500">
                            Paid {formatDateDDMMYYYY(inst.paymentDate)}
                            {inst.paymentReference ? ` · ${inst.paymentReference}` : ''}
                          </p>
                        )}
                      </div>
                      {inst.status !== 'paid' && (
                        <button
                          type="button"
                          onClick={() => openPay(selectedLoan, inst.installmentNumber, inst.amountDue)}
                          className="btn btn-primary shrink-0"
                        >
                          Record Pay
                        </button>
                      )}
                    </div>
                  );
                })}
                {visibleInstallments.length > 12 && (
                  <button type="button" className="btn btn-secondary w-full" onClick={() => setShowAllCards((v) => !v)}>
                    {showAllCards ? 'Show fewer' : `Show all ${visibleInstallments.length} installments`}
                  </button>
                )}
              </div>

              <div className="card mt-4 hidden overflow-hidden md:block">
                <div className="table-wrap">
                  <table className="data-table text-xs">
                    <thead>
                      <tr>
                        <th className="px-3 py-3">#</th>
                        <th className="px-3 py-3">Due Date</th>
                        <th className="px-3 py-3">Amount Due</th>
                        <th className="px-3 py-3">Payment Date &amp; Ref</th>
                        <th className="px-3 py-3 text-center">Status</th>
                        <th className="px-3 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleInstallments.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-xs text-ink-500">
                            No installments match this status filter.
                          </td>
                        </tr>
                      )}
                      {visibleInstallments.map((inst) => {
                        const style = statusStyles[inst.status] ?? statusStyles.upcoming;
                        return (
                          <tr
                            key={inst.id}
                            className={`transition-colors hover:bg-surface-muted/70 ${style.row}`}
                          >
                            <td className="px-3 py-3 font-bold text-ink-900">
                              #{inst.installmentNumber}
                            </td>
                            <td className="px-3 py-3">
                              <span
                                className={
                                  inst.status === 'overdue'
                                    ? 'font-bold text-danger-700'
                                    : 'font-semibold text-ink-900'
                                }
                              >
                                {formatDateDDMMYYYY(inst.dueDate)}
                              </span>
                            </td>
                            <td className="px-3 py-3 font-bold text-ink-900">
                              <Currency value={inst.amountDue} size="xs" />
                            </td>
                            <td className="px-3 py-3 text-ink-600">
                              {inst.paymentDate ? (
                                <div>
                                  <span className="font-semibold text-ink-900">
                                    {formatDateDDMMYYYY(inst.paymentDate)}
                                  </span>
                                  <span className="mt-0.5 block text-[10px] text-ink-400">
                                    {inst.paymentReference || '-'}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-ink-400">-</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <StatusBadge status={inst.status} />
                            </td>
                            <td className="px-3 py-3 text-right">
                              {inst.status === 'paid' ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-success-700">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Settled
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    openPay(selectedLoan, inst.installmentNumber, inst.amountDue);
                                  }}
                                  className="btn btn-primary btn-sm"
                                >
                                  Record Pay
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="mt-3 text-[11px] text-ink-500">
                Showing {visibleInstallments.length} of {selectedLoan.installments.length}{' '}
                installments for {loanLabel(selectedLoan)}.
              </p>
            </>
          ) : (
            <div className="empty-state">
              <Calendar className="h-6 w-6 text-ink-400" />
              <p className="text-sm">Select a loan to view its installment schedule.</p>
            </div>
          )}
        </div>
      </div>

      {/* Payment history */}
      <div id="emi-history" className="card card-pad">
        {renderSectionHeader(
          'Payment History',
          ReceiptText,
          <Select value={historyLoanFilter} onValueChange={setHistoryLoanFilter}>
            <SelectTrigger className="form-input w-auto px-3 py-1.5 text-xs font-semibold text-ink-700">
              <SelectValue placeholder="All loans" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All loans</SelectItem>
              {emiLoans.map((loan) => (
                <SelectItem key={loan.id} value={loan.id}>
                  {loanLabel(loan)} · {loan.loanProvider}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {paymentHistory.length > 0 ? (
          <>
          <ul className="space-y-2.5 md:hidden">
            {paymentHistory.map(({ loan, inst }) => (
              <li key={inst.id} className="rounded-lg border border-line p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ink-900">{loanLabel(loan)} · #{inst.installmentNumber}</div>
                    <div className="text-[11px] text-ink-500">
                      {inst.paymentDate ? formatDateDDMMYYYY(inst.paymentDate) : 'Past instalment'} · {inst.paymentMode ? modeLabel(inst.paymentMode) : 'recorded at loan setup'}
                    </div>
                    {inst.paymentReference && (
                      <div className="mt-0.5 break-all font-mono text-[11px] text-ink-500">{inst.paymentReference}</div>
                    )}
                  </div>
                  <Currency value={inst.amountPaid} size="sm" className="shrink-0 font-bold text-success-700" />
                </div>
              </li>
            ))}
          </ul>
          <div className="card hidden overflow-hidden md:block">
            <div className="table-wrap">
              <table className="data-table text-xs">
                <thead>
                  <tr>
                    <th className="px-4 py-3">Machine</th>
                    <th className="px-3.5 py-3">Installment</th>
                    <th className="px-3.5 py-3">Paid On</th>
                    <th className="px-3.5 py-3">Mode</th>
                    <th className="px-3.5 py-3">Reference</th>
                    <th className="px-3.5 py-3 text-right">Amount Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentHistory.map(({ loan, inst }) => (
                    <tr key={inst.id} className="transition-colors hover:bg-surface-muted/70">
                      <td className="px-4 py-3 font-bold text-ink-900">{loanLabel(loan)}</td>
                      <td className="px-3.5 py-3 font-semibold text-ink-700">
                        #{inst.installmentNumber}
                      </td>
                      <td className="px-3.5 py-3 text-ink-600">
                        {inst.paymentDate ? formatDateDDMMYYYY(inst.paymentDate) : 'Past instalment'}
                      </td>
                      <td className="px-3.5 py-3 text-ink-600">{inst.paymentMode ? modeLabel(inst.paymentMode) : 'Recorded at loan setup'}</td>
                      <td className="px-3.5 py-3 font-mono text-[11px] text-ink-500">
                        {inst.paymentReference || '-'}
                      </td>
                      <td className="px-3.5 py-3 text-right font-bold text-success-700">
                        <Currency value={inst.amountPaid} size="xs" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </>
        ) : (
          <div className="empty-state rounded-lg border border-line bg-surface-muted">
            <ReceiptText className="h-6 w-6 text-ink-400" />
            <p className="text-sm">No payments recorded for this selection yet.</p>
          </div>
        )}
      </div>

      {/* Record Payment Dialog */}
      {payModalData && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="section-icon shrink-0">
                  <CreditCard className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="modal-title truncate">Record EMI Payment</h3>
                  <p className="mt-0.5 truncate text-xs text-ink-500">
                    {loanLabel(payModalData.loan)} · Installment #{payModalData.installmentNumber}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPayModalData(null)}
                className="icon-btn"
                aria-label="Close payment dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmPayment} className="flex min-h-0 flex-1 flex-col">
              {paymentError && (
                <div className="notice notice--danger mx-5 mt-4 text-xs" role="alert">{paymentError}</div>
              )}
              <div className="modal-body space-y-4">
                <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-muted p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="stat-label block">Amount due</span>
                    <Currency
                      value={payModalData.amount}
                      size="xl"
                      className="mt-1 font-bold text-ink-900"
                    />
                  </div>
                  <div className="sm:text-right">
                    <span className="stat-label block">Lender</span>
                    <span className="mt-1 block text-xs font-semibold text-ink-700">
                      {payModalData.loan.loanProvider}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="form-label">Payment mode</label>
                  <Select value={paymentMode} onValueChange={setPaymentMode}>
                    <SelectTrigger className="form-input">
                      <SelectValue placeholder="Select payment mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Net Banking NEFT">Net Banking NEFT</SelectItem>
                      <SelectItem value="Auto-Debit ECS">Auto-Debit ECS</SelectItem>
                      <SelectItem value="RTGS Transfer">RTGS Transfer</SelectItem>
                      <SelectItem value="Company Cheque">Company Cheque</SelectItem>
                      <SelectItem value="UPI">UPI</SelectItem>
                      <SelectItem value="Cash">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="form-label">Bank reference / UTR / cheque number (optional)</label>
                  <input
                    type="text"
                    placeholder="Transaction or cheque reference"
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setPayModalData(null)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingPayment}>
                  <CheckCircle2 className="h-4 w-4" />
                  {savingPayment ? 'Saving…' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EMI Calculator & Setup Modal */}
      {showCalculator && (
        <EmiCalculatorModal
          machines={machines}
          onClose={() => setShowCalculator(false)}
          onSaveLoan={handleSaveCalculatedLoan}
        />
      )}
    </div>
  );
};
