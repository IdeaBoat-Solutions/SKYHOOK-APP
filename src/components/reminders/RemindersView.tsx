import React, { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  X,
  CircleAlert,
  CreditCard,
  Wrench,
  ShieldAlert,
  FileCheck2,
  FileBadge,
  Users,
  CheckCircle2,
  Clock,
  CalendarClock,
  ArrowRight,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { formatINR, formatDateDDMMYYYY, calculateExpiryFromInterval, sumOperatingHours, formatServiceInterval } from '../../utils/calculations';
import { ReminderAlertItem } from '../../types';

type AlertType = 'emi' | 'service' | 'insurance' | 'puc' | 'fitness' | 'license';

interface CategoryGroup {
  key: AlertType;
  title: string;
  alerts: ReminderAlertItem[];
  icon: React.ElementType;
}

// Shared status tones keep overdue / due-today / upcoming visually distinct
// while reserving red strictly for critical (overdue) alerts.
const statusTone = (status: ReminderAlertItem['status']) => {
  switch (status) {
    case 'overdue':
      return {
        icon: 'tone-danger',
        badge: 'badge badge-danger',
      };
    case 'due_today':
      return {
        icon: 'tone-warning',
        badge: 'badge badge-warning',
      };
    case 'upcoming':
    default:
      return {
        icon: 'tone-neutral',
        badge: 'badge badge-neutral',
      };
  }
};

// Category icons are reused in the resolution dialog header so the modal
// speaks the same visual language as the category cards behind it.
const CATEGORY_ICONS: Record<AlertType, React.ElementType> = {
  emi: CreditCard,
  service: Wrench,
  insurance: ShieldAlert,
  puc: FileCheck2,
  fitness: FileBadge,
  license: Users,
};

export const RemindersView: React.FC = () => {
  const {
    currentUser,
    currentDate,
    getEmiAlerts,
    getServiceAlerts,
    getInsuranceAlerts,
    getPucAlerts,
    getFitnessAlerts,
    getLicenseAlerts,
    recordEmiPayment,
    recordServiceCompleted,
    renewMachineInsurance,
    renewMachinePuc,
    renewMachineFitness,
    renewOperatorLicense,
    machines,
    machineWorkingLogs,
    employees,
    emiLoans,
  } = useSkyhook();

  const isManager = currentUser.role === 'manager';

  // Active dialog states
  const [activeDialog, setActiveDialog] = useState<{
    type: AlertType;
    item: ReminderAlertItem;
  } | null>(null);

  const ActiveCategoryIcon = activeDialog ? CATEGORY_ICONS[activeDialog.type] : CircleAlert;

  // Form input states for action dialogs
  const [payMode, setPayMode] = useState('NEFT Bank Transfer');
  const [payRef, setPayRef] = useState('');
  const [serviceDate, setServiceDate] = useState(currentDate);
  const [serviceCost, setServiceCost] = useState('25000');
  const [serviceNotes, setServiceNotes] = useState('');
  const [serviceProvider, setServiceProvider] = useState('Authorized OEM Service');
  const [serviceHours, setServiceHours] = useState('');

  // Statutory renewal states with interval-based auto calculation
  const [renewalDate, setRenewalDate] = useState(currentDate);
  const [renewalIntervalDays, setRenewalIntervalDays] = useState(365);
  const [renewalExpiry, setRenewalExpiry] = useState('');
  const [renewalCertNo, setRenewalCertNo] = useState('');

  const emiAlerts = getEmiAlerts();
  const serviceAlerts = getServiceAlerts();
  const insuranceAlerts = getInsuranceAlerts();
  const pucAlerts = getPucAlerts();
  const fitnessAlerts = getFitnessAlerts();
  const licenseAlerts = getLicenseAlerts();

  // A single source of truth for the visible categories drives both the
  // summary strip and the detailed blocks below.
  const categories: CategoryGroup[] = [
    ...(!isManager
      ? [{ key: 'emi' as AlertType, title: 'MACHINE EMI REMINDERS', alerts: emiAlerts, icon: CreditCard }]
      : []),
    { key: 'service', title: 'MACHINE SERVICE REMINDERS', alerts: serviceAlerts, icon: Wrench },
    { key: 'insurance', title: 'INSURANCE RENEWAL REMINDERS', alerts: insuranceAlerts, icon: ShieldAlert },
    { key: 'puc', title: 'PUC RENEWAL REMINDERS', alerts: pucAlerts, icon: FileCheck2 },
    { key: 'fitness', title: 'FITNESS TEST REMINDERS', alerts: fitnessAlerts, icon: FileBadge },
    { key: 'license', title: 'OPERATOR LICENSE RENEWAL REMINDERS', alerts: licenseAlerts, icon: Users },
  ];

  // Read-only rollups derived from the existing alert arrays.
  const overdueCount = categories.reduce(
    (sum, c) => sum + c.alerts.filter((a) => a.status === 'overdue').length,
    0
  );
  const dueTodayCount = categories.reduce(
    (sum, c) => sum + c.alerts.filter((a) => a.status === 'due_today').length,
    0
  );
  const upcomingCount = categories.reduce(
    (sum, c) => sum + c.alerts.filter((a) => a.status === 'upcoming').length,
    0
  );
  const compliantCount = categories.filter((c) => c.alerts.length === 0).length;

  const openActionDialog = (type: AlertType, item: ReminderAlertItem) => {
    const machine = machines.find((m) => m.id === item.targetId || m.assetId === item.targetId);

    if (type === 'insurance') {
      const interval = machine?.insuranceIntervalDays || 365;
      setRenewalIntervalDays(interval);
      setRenewalDate(currentDate);
      setRenewalExpiry(calculateExpiryFromInterval(currentDate, interval));
      setServiceProvider(machine?.insuranceProvider || 'New India Assurance');
      setRenewalCertNo(machine?.insurancePolicyNumber || 'POL-' + Math.floor(1000 + Math.random() * 9000));
    } else if (type === 'puc') {
      const interval = machine?.pucIntervalDays || 180;
      setRenewalIntervalDays(interval);
      setRenewalDate(currentDate);
      setRenewalExpiry(calculateExpiryFromInterval(currentDate, interval));
      setRenewalCertNo(machine?.pucNumber || 'PUC-MH04-' + Math.floor(100000 + Math.random() * 900000));
    } else if (type === 'fitness') {
      const interval = machine?.fitnessIntervalDays || 365;
      setRenewalIntervalDays(interval);
      setRenewalDate(currentDate);
      setRenewalExpiry(calculateExpiryFromInterval(currentDate, interval));
      setRenewalCertNo(machine?.fitnessCertificateNumber || 'FIT-THANE-2026-' + Math.floor(1000 + Math.random() * 9000));
    } else if (type === 'license') {
      const interval = 365 * 3;
      setRenewalIntervalDays(interval);
      setRenewalDate(currentDate);
      setRenewalExpiry(calculateExpiryFromInterval(currentDate, interval));
      setRenewalCertNo('MH04-2026-RN-99120');
    } else if (type === 'service') {
      setServiceDate(currentDate);
      setServiceProvider('Authorized OEM Service');
      setServiceCost('25000');
      setServiceNotes('');
    } else if (type === 'emi') {
      setPayMode('NEFT Bank Transfer');
      setPayRef('');
    }

    setActiveDialog({ type, item });
  };

  const handleRenewalDateChange = (newDate: string) => {
    setRenewalDate(newDate);
    setRenewalExpiry(calculateExpiryFromInterval(newDate, renewalIntervalDays));
  };

  const handleRenewalIntervalChange = (newDays: number) => {
    setRenewalIntervalDays(newDays);
    setRenewalExpiry(calculateExpiryFromInterval(renewalDate, newDays));
  };

  const handleResolveAlert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDialog) return;

    const { type, item } = activeDialog;

    if (type === 'emi') {
      // Find loan and installment
      const loan = emiLoans.find((l) => l.assetId === item.targetId);
      if (loan) {
        const nextPending = loan.installments.find((i) => i.status !== 'paid');
        if (nextPending) {
          recordEmiPayment(loan.id, nextPending.installmentNumber, payMode, payRef);
        }
      }
    } else if (type === 'service') {
      const machine = machines.find(
        (m) => m.id === item.targetId || m.assetId === item.targetId,
      );
      const reading =
        machine?.serviceFrequencyUnit === 'hours'
          ? serviceHours !== ''
            ? parseFloat(serviceHours)
            : (machine.lastServiceHours || 0) +
              sumOperatingHours(machineWorkingLogs, machine.id, machine.lastServiceDate)
          : undefined;
      recordServiceCompleted(
        machine?.id ?? item.targetId,
        serviceDate,
        parseFloat(serviceCost) || 0,
        serviceNotes,
        serviceProvider,
        reading,
      );
      setServiceHours('');
    } else if (type === 'insurance') {
      renewMachineInsurance(item.targetId, renewalExpiry, serviceProvider, renewalCertNo, renewalDate);
    } else if (type === 'puc') {
      renewMachinePuc(item.targetId, renewalExpiry, renewalCertNo, renewalDate);
    } else if (type === 'fitness') {
      renewMachineFitness(item.targetId, renewalExpiry, renewalCertNo, renewalDate);
    } else if (type === 'license') {
      renewOperatorLicense(item.targetId, renewalExpiry, renewalExpiry);
    }

    setActiveDialog(null);
    setPayRef('');
    setServiceNotes('');
    setRenewalCertNo('');
  };

  const renderAlertItem = (item: ReminderAlertItem, type: AlertType) => {
    const tone = statusTone(item.status);
    const details = [
      item.subtitle.split('|')[0].trim(),
      formatDateDDMMYYYY(item.dueDate),
      item.amount ? formatINR(item.amount) : null,
    ].filter(Boolean);

    return (
      <div key={item.id} className="alert-row flex-col items-stretch sm:flex-row sm:items-center">
        <span className={`alert-row__icon ${tone.icon}`}>
          <CircleAlert className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-semibold text-ink-900">{item.title}</span>
            <span className={`${tone.badge} shrink-0 uppercase`}>{item.urgencyLabel}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-500">{details.join(' | ')}</div>
        </div>

        <button
          onClick={() => openActionDialog(type, item)}
          className="btn btn-primary btn-sm w-full shrink-0 sm:w-auto"
        >
          <span>{item.actionLabel}</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  const renderCategoryBlock = (category: CategoryGroup) => {
    const Icon = category.icon;
    const { title, alerts, key } = category;

    return (
      <section key={category.key} className="card card-pad">
        <div className="section-heading -mx-[1.125rem] px-[1.125rem]">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="section-icon">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <h3 className="truncate text-sm font-semibold tracking-tight text-ink-900 sm:text-base">
              {title}
            </h3>
          </div>
        </div>

        {alerts.length > 0 ? (
          <div className="space-y-2.5">
            {alerts.map((item) => renderAlertItem(item, key))}
          </div>
        ) : (
          <div className="notice notice--success">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" aria-hidden="true" />
            <span>All Clear – No Pending Items</span>
          </div>
        )}
      </section>
    );
  };

  const renderSummaryCard = (
    label: string,
    value: number,
    hint: string,
    icon: React.ElementType,
    tone: { chip: string; value: string; bar: string }
  ) => {
    const Icon = icon;
    return (
      <div className="kpi-card group relative overflow-hidden transition-colors hover:border-line-strong">
        <span className={`absolute inset-x-0 top-0 h-0.5 ${tone.bar}`} aria-hidden="true" />

        <div className="flex items-start justify-between gap-3">
          <span className="stat-label">{label}</span>
          <span className={`kpi-card__icon ${tone.chip}`}>
            <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </span>
        </div>

        <div className="kpi-card__value">
          <span className={tone.value}>{value}</span>
        </div>

        <div className="kpi-card__foot">
          <span className="truncate text-[11px] font-medium text-ink-500">{hint}</span>
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone.chip}`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
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
          <h2 className="page-title !mt-0">Reminders &amp; Renewal Alert Engines</h2>
          <p className="page-subtitle mt-0.5">
            {isManager
              ? 'Five independent statutory categories with live alert tracking, deadline visibility and direct resolution.'
              : 'Six independent renewal categories with live alert tracking, statutory deadline visibility and direct resolution.'}
          </p>
        </div>
      </div>

      {/* Status overview — derived entirely from the existing alert arrays */}
      <div className="kpi-grid">
        {renderSummaryCard('Critical / Overdue', overdueCount, 'Immediate action required', CircleAlert, {
          chip: 'tone-danger',
          value: 'text-danger-600',
          bar: 'bg-danger-500',
        })}
        {renderSummaryCard('Due Today', dueTodayCount, 'Action due today', Clock, {
          chip: 'tone-warning',
          value: 'text-warning-700',
          bar: 'bg-warning-500',
        })}
        {renderSummaryCard('Upcoming', upcomingCount, 'Within reminder window', CalendarClock, {
          chip: 'tone-neutral',
          value: 'text-ink-900',
          bar: 'bg-ink-500',
        })}
        {renderSummaryCard('Fully Compliant', compliantCount, `${categories.length} monitored categories`, CheckCircle2, {
          chip: 'tone-success',
          value: 'text-success-700',
          bar: 'bg-success-500',
        })}
      </div>

      {/* Category monitoring intro — mirrors the dashboard red-alert section */}
      <div className="card card-pad">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink-900 sm:text-xl">
              Critical Statutory &amp; Renewal Alerts
            </h2>
            <p className="mt-1 text-xs text-ink-500 sm:text-sm">
              Strict individual category tracking. Resolving or paying an item immediately clears its pending alert.
            </p>
          </div>
          <span
            className={`badge self-start sm:self-auto ${
              overdueCount > 0
                ? 'badge-danger'
                : dueTodayCount > 0
                  ? 'badge-warning'
                  : 'badge-neutral'
            }`}
          >
            {categories.reduce((sum, c) => sum + c.alerts.length, 0)} active alerts
          </span>
        </div>
      </div>

      {/* Compliance category cards */}
      <div className="space-y-4">
        {categories.map((category) => renderCategoryBlock(category))}
      </div>

      {/* Universal Action Dialog */}
      {activeDialog && (
        <div className="modal-overlay">
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reminder-dialog-title"
          >
            <div className="modal-header">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="section-icon shrink-0">
                  <ActiveCategoryIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <h3 id="reminder-dialog-title" className="modal-title truncate">
                  Resolve {activeDialog.item.categoryHeading}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveDialog(null)}
                className="icon-btn"
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleResolveAlert}>
              <div className="modal-body space-y-4">
                <div className="rounded-lg border border-line bg-surface-muted p-3.5">
                  <div className="text-sm font-semibold text-ink-900">{activeDialog.item.title}</div>
                  <p className="mt-0.5 text-xs text-ink-500">{activeDialog.item.subtitle}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-ink-500">Current status</span>
                    <span className={`${statusTone(activeDialog.item.status).badge} uppercase`}>
                      {activeDialog.item.urgencyLabel}
                    </span>
                    <span className="text-ink-500">
                      · {activeDialog.item.metricUnit === 'hours'
                        ? `${Math.round(activeDialog.item.hoursRemaining ?? 0)} operating hours remaining`
                        : `Due ${formatDateDDMMYYYY(activeDialog.item.dueDate)}`}
                    </span>
                  </div>
                </div>

                {activeDialog.type === 'emi' && (
                  <>
                    <div>
                      <label htmlFor="remit-pay-mode" className="form-label">Payment Mode:</label>
                      <Select value={payMode} onValueChange={setPayMode}>
                        <SelectTrigger id="remit-pay-mode" className="form-input">
                          <SelectValue placeholder="Select payment mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NEFT Bank Transfer">NEFT Bank Transfer</SelectItem>
                          <SelectItem value="Auto-Debit ECS">Auto-Debit ECS</SelectItem>
                          <SelectItem value="RTGS">RTGS</SelectItem>
                          <SelectItem value="Cheque">Cheque</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label htmlFor="remit-pay-ref" className="form-label">Bank UTR / Transaction Reference:</label>
                      <input
                        id="remit-pay-ref"
                        type="text"
                        required
                        placeholder="e.g. UTR-HDFC-991208"
                        value={payRef}
                        onChange={(e) => setPayRef(e.target.value)}
                        className="form-input"
                      />
                    </div>
                  </>
                )}

                {activeDialog.type === 'service' && (
                  <>
                    <div>
                      <label htmlFor="service-date" className="form-label">Completed Service Date:</label>
                      <input
                        id="service-date"
                        type="date"
                        required
                        value={serviceDate}
                        onChange={(e) => setServiceDate(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    {(() => {
                      const machine = machines.find(
                        (m) =>
                          m.id === activeDialog.item.targetId ||
                          m.assetId === activeDialog.item.targetId,
                      );
                      if (!machine || machine.serviceFrequencyUnit !== 'hours') return null;
                      const logged = sumOperatingHours(
                        machineWorkingLogs,
                        machine.id,
                        machine.lastServiceDate,
                      );
                      return (
                        <div className="notice notice--warning">
                          <span className="stat-label text-warning-800">
                            Operating-hour service · interval {formatServiceInterval(machine.serviceFrequencyValue, 'hours')}
                          </span>
                          <p className="mt-1 text-xs text-warning-900">
                            {Math.round(logged)} h logged since the last service. Remaining:{" "}
                            {Math.max(0, Math.round(machine.serviceFrequencyValue - logged))} h.
                          </p>
                          <input
                            type="number"
                            value={serviceHours}
                            onChange={(e) => setServiceHours(e.target.value)}
                            placeholder={`Reading at service (e.g. ${Math.round((machine.lastServiceHours || 0) + logged)} h)`}
                            className="form-input mt-2"
                          />
                        </div>
                      );
                    })()}

                    <div>
                      <label htmlFor="service-provider" className="form-label">Service Vendor / Workshop:</label>
                      <input
                        id="service-provider"
                        type="text"
                        required
                        value={serviceProvider}
                        onChange={(e) => setServiceProvider(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label htmlFor="service-cost" className="form-label">Service &amp; Parts Cost (₹):</label>
                      <input
                        id="service-cost"
                        type="number"
                        required
                        value={serviceCost}
                        onChange={(e) => setServiceCost(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label htmlFor="service-notes" className="form-label">Service Notes / Parts Replaced:</label>
                      <textarea
                        id="service-notes"
                        rows={2}
                        placeholder="Engine oil, hydraulic filters, winch greasing..."
                        value={serviceNotes}
                        onChange={(e) => setServiceNotes(e.target.value)}
                        className="form-input"
                      />
                    </div>
                  </>
                )}

                {(activeDialog.type === 'insurance' ||
                  activeDialog.type === 'puc' ||
                  activeDialog.type === 'fitness' ||
                  activeDialog.type === 'license') && (
                  <>
                    <div className="space-y-2 rounded-lg border border-line bg-surface-muted p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-xs font-semibold text-ink-900">
                          <ActiveCategoryIcon className="h-3.5 w-3.5 shrink-0 text-brand-700" aria-hidden="true" />
                          {activeDialog.type === 'insurance' && 'Insurance Policy Renewal'}
                          {activeDialog.type === 'puc' && 'PUC Emission Test & Renewal'}
                          {activeDialog.type === 'fitness' && 'Fitness Test Passed Certification'}
                          {activeDialog.type === 'license' && 'Operator License Renewal'}
                        </span>
                        <span className="badge badge-neutral">{renewalIntervalDays} Days Interval</span>
                      </div>
                      <p className="text-xs text-ink-500">
                        New expiry date is auto-calculated from the day of renewal / test passed using the configured machine interval ({renewalIntervalDays} days).
                      </p>
                    </div>

                    <div className="form-grid">
                      <div>
                        <label htmlFor="renewal-date" className="form-label">
                          {activeDialog.type === 'fitness' ? 'Fitness Test Passed Date:' : 'Renewal Date:'}
                        </label>
                        <input
                          id="renewal-date"
                          type="date"
                          required
                          value={renewalDate}
                          onChange={(e) => handleRenewalDateChange(e.target.value)}
                          className="form-input font-semibold"
                        />
                      </div>
                      <div>
                        <label htmlFor="renewal-interval" className="form-label">Interval Days (Machine Setting):</label>
                        <div className="flex items-center gap-1.5">
                          <input
                            id="renewal-interval"
                            type="number"
                            required
                            value={renewalIntervalDays}
                            onChange={(e) => handleRenewalIntervalChange(parseInt(e.target.value, 10) || 0)}
                            className="form-input font-semibold"
                          />
                          <span className="shrink-0 text-xs text-ink-500">Days</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {[
                            { label: '6M (180d)', days: 180 },
                            { label: '1Y (365d)', days: 365 },
                            { label: '2Y (730d)', days: 730 },
                          ].map((preset) => (
                            <button
                              key={preset.days}
                              type="button"
                              onClick={() => handleRenewalIntervalChange(preset.days)}
                              className={`btn btn-sm ${renewalIntervalDays === preset.days ? 'btn-primary' : 'btn-secondary'}`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <label htmlFor="renewal-expiry" className="form-label mb-0">Auto-Set New Expiry / Next Due Date:</label>
                        <span className="badge badge-success">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          Auto-calculated ({renewalDate} + {renewalIntervalDays}d)
                        </span>
                      </div>
                      <input
                        id="renewal-expiry"
                        type="date"
                        required
                        value={renewalExpiry}
                        onChange={(e) => setRenewalExpiry(e.target.value)}
                        className="form-input font-semibold"
                      />
                    </div>

                    <div>
                      <label htmlFor="renewal-cert" className="form-label">
                        {activeDialog.type === 'insurance' && 'Renewed Policy Number:'}
                        {activeDialog.type === 'puc' && 'New PUC Certificate Number:'}
                        {activeDialog.type === 'fitness' && 'Passed Fitness Certificate Number:'}
                        {activeDialog.type === 'license' && 'License Number / Ref:'}
                      </label>
                      <input
                        id="renewal-cert"
                        type="text"
                        required
                        placeholder="e.g. MH04-2026-RN-99120"
                        value={renewalCertNo}
                        onChange={(e) => setRenewalCertNo(e.target.value)}
                        className="form-input"
                      />
                    </div>

                    {activeDialog.type === 'insurance' && (
                      <div>
                        <label htmlFor="insurance-provider" className="form-label">Insurance Provider / Underwriter:</label>
                        <input
                          id="insurance-provider"
                          type="text"
                          required
                          value={serviceProvider}
                          onChange={(e) => setServiceProvider(e.target.value)}
                          className="form-input"
                        />
                      </div>
                    )}
                  </>
                )}

              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setActiveDialog(null)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {activeDialog.type === 'emi'
                      ? 'Record EMI Payment'
                      : activeDialog.type === 'service'
                        ? 'Record Service Completion'
                        : 'Save Renewal & Auto-Set Expiry'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
