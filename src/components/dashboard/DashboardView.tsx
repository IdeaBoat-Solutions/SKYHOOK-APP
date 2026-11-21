import React, { useState } from 'react';
import {
  FolderKanban,
  Users,
  UserCheck,
  Truck,
  TrendingUp,
  ReceiptIndianRupee,
  CalendarCheck,
  CircleAlert,
  Clock,
  ShieldAlert,
  Wrench,
  FileCheck2,
  FileBadge,
  CreditCard,
  Plus,
  ArrowRight,
  ChevronRight,
  ExternalLink,
  DollarSign,
  Activity,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { formatINR, formatDateDDMMYYYY } from '../../utils/calculations';
import { NavTab } from '../layout/Sidebar';
import { ReminderAlertItem } from '../../types';
import { Currency } from '../common/Currency';

interface DashboardViewProps {
  onNavigateTab: (tab: NavTab) => void;
  onOpenQuickAction?: (actionName: string) => void;
  onOpenAlertModal?: (alert: ReminderAlertItem) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigateTab,
  onOpenQuickAction,
  onOpenAlertModal,
}) => {
  const {
    currentUser,
    currentDate,
    projects,
    employees,
    machines,
    attendance,
    expenses,
    payrollRuns,
    advances,
    machineWorkingLogs,
    getEmiAlerts,
    getServiceAlerts,
    getInsuranceAlerts,
    getPucAlerts,
    getFitnessAlerts,
    getLicenseAlerts,
  } = useSkyhook();

  const isManager = currentUser.role === 'manager';
  // Everything on this page is for the current month; it follows the real date.
  const month = currentDate.slice(0, 7);
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const weekStart = (() => {
    const d = new Date(`${currentDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  })();

  // 1. KPI Calculations
  const activeProjects = projects.filter((p) => p.status === 'active');
  const totalOperators = employees.filter((e) => e.employeeType === 'operator' && e.status === 'active');
  const todayAttendance = attendance.filter((a) => a.date === currentDate);
  // A half day is a person who came to work, so they count as present.
  const operatorsPresentToday = todayAttendance.filter((a) => a.status === 'present' || a.status === 'half_day').length;
  const totalMachines = machines.length;
  const machinesDeployed = machines.filter((m) => m.status === 'assigned').length;

  // This month's run if there is one, otherwise the most recent run.
  const latestPayroll =
    payrollRuns.find((r) => r.month === month) ??
    [...payrollRuns].sort((a, b) => b.month.localeCompare(a.month))[0];
  const pendingPayrollAmount = latestPayroll ? latestPayroll.totalNetSalary - latestPayroll.totalPaidAmount : 0;

  const monthlyExpenses = expenses
    .filter((e) => e.date.startsWith(month) && e.approvalStatus === 'approved')
    .reduce((sum, e) => sum + e.amount, 0);

  const pendingAttendanceCount = attendance.filter((a) => a.approvalStatus === 'submitted').length;

  // 2. Red Alerts
  const emiAlerts = getEmiAlerts();
  const serviceAlerts = getServiceAlerts();
  const insuranceAlerts = getInsuranceAlerts();
  const pucAlerts = getPucAlerts();
  const fitnessAlerts = getFitnessAlerts();
  const licenseAlerts = getLicenseAlerts();

  // 3. Attendance snapshot
  const presentCount = operatorsPresentToday;
  const absentCount = todayAttendance.filter((a) => a.status === 'absent').length;
  const leaveCount = todayAttendance.filter(
    (a) => a.status === 'paid_leave' || a.status === 'unpaid_leave'
  ).length;
  const todayOtHours = todayAttendance
    .filter((a) => a.approvalStatus === 'approved')
    .reduce((sum, a) => sum + a.overtimeHours, 0);

  // 4. Machine Working Summary
  const todayMachineHours = machineWorkingLogs
    .filter((m) => m.date === currentDate)
    .reduce((s, m) => s + m.workingHours, 0);

  const weekMachineHours = machineWorkingLogs
    .filter((m) => m.date >= weekStart && m.date <= currentDate)
    .reduce((s, m) => s + m.workingHours, 0);

  const monthMachineHours = machineWorkingLogs
    .filter((m) => m.date.startsWith(month))
    .reduce((s, m) => s + m.workingHours, 0);

  // Machine utilization calculation
  const machineUtilization = machines.map((m) => {
    const hours = machineWorkingLogs
      .filter((log) => log.machineId === m.id || log.machineId === m.assetId)
      .reduce((sum, log) => sum + log.workingHours, 0);
    return {
      id: m.assetId,
      name: `${m.assetId} (${m.model})`,
      hours,
    };
  }).sort((a, b) => b.hours - a.hours);

  const maxMachineHours = machineUtilization.reduce((m, i) => Math.max(m, i.hours), 0);

  const alertSections: Array<{
    key: string;
    title: string;
    icon: React.ElementType;
    alerts: ReminderAlertItem[];
    clear: string;
    fallback: NavTab;
  }> = [
    ...(!isManager
      ? [{ key: 'emi', title: 'MACHINE EMI REMINDERS', icon: CreditCard, alerts: emiAlerts, clear: 'machine EMI items', fallback: 'emi' as NavTab }]
      : []),
    { key: 'service', title: 'MACHINE SERVICE REMINDERS', icon: Wrench, alerts: serviceAlerts, clear: 'machine services', fallback: 'assets' },
    { key: 'insurance', title: 'INSURANCE RENEWAL REMINDERS', icon: ShieldAlert, alerts: insuranceAlerts, clear: 'insurance renewals', fallback: 'reminders' },
    { key: 'puc', title: 'PUC RENEWAL REMINDERS', icon: FileCheck2, alerts: pucAlerts, clear: 'PUC renewals', fallback: 'reminders' },
    { key: 'fitness', title: 'FITNESS TEST REMINDERS', icon: FileBadge, alerts: fitnessAlerts, clear: 'fitness tests', fallback: 'reminders' },
    { key: 'license', title: 'OPERATOR LICENSE RENEWAL REMINDERS', icon: Users, alerts: licenseAlerts, clear: 'operator licences', fallback: 'employees' },
  ];

  const renderAlertCard = (
    alert: ReminderAlertItem,
    onClickAction: () => void
  ) => {
    const isOverdue = alert.status === 'overdue';
    const isToday = alert.status === 'due_today';

    const iconTone = isOverdue
      ? 'border-danger-200 bg-danger-50 text-danger-600'
      : isToday
        ? 'border-warning-100 bg-warning-50 text-warning-700'
        : 'border-line bg-surface-muted text-ink-500';

    const details = [
      alert.subtitle.split('|')[0].trim(),
      formatDateDDMMYYYY(alert.dueDate),
      alert.amount ? formatINR(alert.amount) : null,
    ].filter(Boolean);

    return (
      <div key={alert.id} className="alert-row">
        <span className={`alert-row__icon ${iconTone}`}>
          <CircleAlert className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-semibold text-ink-900 sm:truncate">{alert.title}</div>
          <div className="mt-0.5 break-words text-xs text-ink-500 sm:truncate">{details.join(' | ')}</div>
        </div>
        <button onClick={onClickAction} className="btn btn-primary btn-sm shrink-0 max-sm:w-full">
          <span>{alert.actionLabel}</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  const renderSectionHeader = (title: string, icon: React.ElementType) => {
    const Icon = icon;
    return (
      <div className="section-heading">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="section-icon">
            <Icon className="h-4 w-4" />
          </span>
          <h3 className="truncate text-sm font-semibold tracking-tight text-ink-900 sm:text-base">
            {title}
          </h3>
        </div>
      </div>
    );
  };

  // Reusable KPI card used across the company overview grid. Shares the same
  // tokens, radius and padding as the rest of the design system.
  type KpiAccent = 'brand' | 'success' | 'warning' | 'danger';

  const kpiAccentStyles: Record<KpiAccent, { icon: string; bar: string }> = {
    brand: { icon: 'tone-brand', bar: 'bg-brand-600' },
    success: { icon: 'tone-success', bar: 'bg-success-600' },
    warning: { icon: 'tone-warning', bar: 'bg-warning-500' },
    danger: { icon: 'tone-danger', bar: 'bg-danger-600' },
  };

  interface KpiCardProps {
    label: string;
    value: React.ReactNode;
    hint: string;
    icon: React.ElementType;
    accent: KpiAccent;
    onClick: () => void;
  }

  const KpiCard: React.FC<KpiCardProps> = ({ label, value, hint, icon: Icon, accent, onClick }) => {
    const styles = kpiAccentStyles[accent];
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onClick();
        }}
        className="kpi-card group relative cursor-pointer overflow-hidden transition-colors hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span className={`absolute inset-x-0 top-0 h-0.5 ${styles.bar}`} aria-hidden="true" />

        <div className="flex items-start justify-between gap-3">
          <span className="stat-label">{label}</span>
          <span className={`kpi-card__icon ${styles.icon}`}>
            <Icon className="h-4 w-4" strokeWidth={2} />
          </span>
        </div>

        <div className="kpi-card__value">{value}</div>

        <div className="kpi-card__foot">
          <span className="min-w-0 break-words text-[11px] font-medium leading-snug text-ink-500">{hint}</span>
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${styles.icon}`}
          >
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      {/* Dashboard Top Header & Controls */}
      <div className="page-header">
        <div>
          <h2 className="page-title !mt-0">
            Skyhook Business Overview
          </h2>
          <p className="page-subtitle mt-0.5">
            Monitor your crane operations, workforce, projects and financial activities.
          </p>
        </div>

        <div className="page-header-actions">
          <span className="badge badge-neutral self-center px-3 py-1.5 text-xs font-semibold">
            {monthLabel}
          </span>

          <button onClick={() => onNavigateTab('payroll')} className="btn btn-primary">
            <ReceiptIndianRupee className="h-3.5 w-3.5" />
            <span>Payroll Portal</span>
          </button>
        </div>
      </div>

      {/* SECTION A: COMPANY KPI CARDS */}
      <div className="kpi-grid">
        <KpiCard
          label="Active Projects"
          value={activeProjects.length}
          hint={`${projects.length} total registered`}
          icon={FolderKanban}
          accent="brand"
          onClick={() => onNavigateTab('projects')}
        />
        <KpiCard
          label="Total Operators"
          value={totalOperators.length}
          hint={`${employees.length} in total workforce`}
          icon={Users}
          accent="success"
          onClick={() => onNavigateTab('employees')}
        />
        <KpiCard
          label="Present Today"
          value={<span className="text-success-600">{operatorsPresentToday}</span>}
          hint={`${Math.max(0, totalOperators.length - operatorsPresentToday)} not present yet`}
          icon={UserCheck}
          accent="success"
          onClick={() => onNavigateTab('attendance')}
        />
        <KpiCard
          label="Machines Deployed"
          value={
            <>
              {machinesDeployed}{' '}
              <span className="text-base font-normal text-ink-400">/ {totalMachines}</span>
            </>
          }
          hint={`${totalMachines - machinesDeployed} not deployed`}
          icon={Truck}
          accent="warning"
          onClick={() => onNavigateTab('assets')}
        />
        <KpiCard
          label="Pending Payroll"
          value={<Currency value={pendingPayrollAmount} size="xl" />}
          hint={latestPayroll?.paymentDueDate ? `Due ${formatDateDDMMYYYY(latestPayroll.paymentDueDate)}` : 'No payroll run yet'}
          icon={ReceiptIndianRupee}
          accent="brand"
          onClick={() => onNavigateTab('payroll')}
        />
        <KpiCard
          label="Monthly Expenses"
          value={<Currency value={monthlyExpenses} size="xl" />}
          hint="Approved this month"
          icon={TrendingUp}
          accent="brand"
          onClick={() => onNavigateTab('expenses')}
        />
        <KpiCard
          label="Pending Approvals"
          value={<span className="text-warning-600">{pendingAttendanceCount}</span>}
          hint="Logs awaiting sign-off"
          icon={CalendarCheck}
          accent="warning"
          onClick={() => onNavigateTab('attendance')}
        />
        <KpiCard
          label="Advances Outstanding"
          value={
            <Currency value={advances.reduce((s, a) => s + a.outstandingBalance, 0)} size="xl" />
          }
          hint={`${advances.filter((a) => a.outstandingBalance > 0).length} with open advances`}
          icon={CreditCard}
          accent="brand"
          onClick={() => onNavigateTab('advances')}
        />
      </div>

      {/* SECTION B: CRITICAL RED ALERT DASHBOARD */}
      {/* MANDATORY: EVERY EMI AND RENEWAL CATEGORY HAS ITS OWN INDIVIDUAL HEADING AND RED ALERT DIRECTLY BELOW THAT HEADING */}
      <div className="space-y-4">
        <div className="card card-pad">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-ink-900 sm:text-xl">
                Critical Statutory & EMI Red Alerts
              </h2>
              <p className="mt-1 text-xs text-ink-500 sm:text-sm">
                Strict individual category tracking. Resolving or paying immediately clears the pending alert.
              </p>
            </div>
            <button onClick={() => onNavigateTab('reminders')} className="btn btn-primary self-start sm:self-auto">
              Manage All Renewals
            </button>
          </div>
        </div>

        {alertSections
          .filter((sec) => sec.alerts.length > 0)
          .map((sec) => (
            <div key={sec.key} className="card card-pad">
              <div className="space-y-3">
                {renderSectionHeader(sec.title, sec.icon)}
                <div className="space-y-2.5">
                  {sec.alerts.slice(0, 3).map((alert) =>
                    renderAlertCard(alert, () => {
                      if (onOpenAlertModal) onOpenAlertModal(alert);
                      else onNavigateTab(sec.fallback);
                    })
                  )}
                </div>
                {sec.alerts.length > 3 && (
                  <button onClick={() => onNavigateTab('reminders')} className="btn btn-ghost btn-sm w-full">
                    View all {sec.alerts.length} <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}

        {alertSections.some((sec) => sec.alerts.length === 0) && (
          <div className="card card-pad space-y-2">
            {alertSections
              .filter((sec) => sec.alerts.length === 0)
              .map((sec) => (
                <div key={sec.key} className="notice notice--success">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" />
                  <span>All clear: no pending {sec.clear}.</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* SECTION C & E: ATTENDANCE SNAPSHOT & MACHINE WORKING SUMMARY */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* SECTION C: ATTENDANCE SNAPSHOT */}
        <div className="card card-pad flex h-full flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <CalendarCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-ink-900">
                  Today's Attendance Snapshot
                </h3>
                <p className="text-xs text-ink-500">{formatDateDDMMYYYY(currentDate)}</p>
              </div>
            </div>
            <button onClick={() => onNavigateTab('attendance')} className="btn btn-primary btn-sm">
              Mark Attendance
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="stat-tile border-success-100 bg-success-50">
              <span className="stat-tile__label text-success-700">Present</span>
              <span className="stat-tile__value text-success-800">{presentCount}</span>
            </div>
            <div className="stat-tile border-brand-100 bg-brand-50">
              <span className="stat-tile__label text-brand-700">Absent</span>
              <span className="stat-tile__value text-brand-800">{absentCount}</span>
            </div>
            <div className="stat-tile border-warning-100 bg-warning-50">
              <span className="stat-tile__label text-warning-700">On Leave</span>
              <span className="stat-tile__value text-warning-800">{leaveCount}</span>
            </div>
            <div className="stat-tile border-brand-100 bg-brand-50">
              <span className="stat-tile__label text-brand-700">Approved OT</span>
              <span className="stat-tile__value text-brand-800">{todayOtHours} hrs</span>
            </div>
          </div>

          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-500">
            <span>
              Pending Manager Approvals:{' '}
              <strong className="font-semibold text-ink-700">{pendingAttendanceCount} records</strong>
            </span>
            <button
              onClick={() => onNavigateTab('attendance')}
              className="font-bold text-brand-700 hover:text-brand-900"
            >
              Review Queue <ArrowRight className="inline-block h-3.5 w-3.5 align-[-2px]" />
            </button>
          </div>
        </div>

        {/* SECTION E: MACHINE WORKING SUMMARY */}
        <div className="card card-pad flex h-full flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning-50 text-warning-700">
                <Activity className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-ink-900">
                  Machine Working Summary
                </h3>
                <p className="text-xs text-ink-500">Fleet crane operating hours</p>
              </div>
            </div>
            <button
              onClick={() => onNavigateTab('machine_working')}
              className="btn btn-secondary btn-sm"
            >
              Enter Working Hours
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="stat-tile">
              <span className="stat-tile__label">Hours Today</span>
              <span className="stat-tile__value">{todayMachineHours}h</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile__label">Hours This Week</span>
              <span className="stat-tile__value">{weekMachineHours}h</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile__label">Hours This Month</span>
              <span className="stat-tile__value">{monthMachineHours}h</span>
            </div>
          </div>

          {/* Top Utilized Machines Bars */}
          <div className="mt-auto space-y-2 pt-1">
            <div className="text-xs font-semibold text-ink-700">Top Utilized Fleet Equipment</div>
            {machineUtilization.slice(0, 3).map((item) => (
              <div key={item.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs text-ink-600">
                  <span className="truncate font-medium">{item.name}</span>
                  <span className="shrink-0 font-semibold text-ink-900">{item.hours} hrs</span>
                </div>
                <div className="progress">
                  <span
                    className="bg-warning-500"
                    style={{ width: `${maxMachineHours > 0 ? Math.min(100, (item.hours / maxMachineHours) * 100) : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION D: ACTIVE PROJECTS TABLE */}
      <div className="card overflow-hidden">
        <div className="card-header">
          <div className="flex items-center gap-3">
            <span className="section-icon">
              <FolderKanban className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink-900 sm:text-base">
                Active Crane Projects &amp; Job Sites
              </h3>
              <p className="mt-0.5 text-xs text-ink-500">
                Live deployment sites and site overtime rates
              </p>
            </div>
          </div>
          <button onClick={() => onNavigateTab('projects')} className="btn btn-ghost btn-sm">
            All Projects <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="card-pad">
          {/* Phones: stacked cards */}
          <div className="space-y-2 md:hidden">
            {activeProjects.length === 0 && <div className="empty-state py-4 text-xs">No active projects.</div>}
            {activeProjects.map((p) => {
              const assignedCranes = machines.filter((m) => m.currentProjectId === p.id);
              return (
                <div key={p.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-semibold text-ink-900">{p.name}</div>
                      <div className="text-[11px] text-ink-500">{p.clientName}{p.location ? ` · ${p.location}` : ''}</div>
                    </div>
                    <span className="badge badge-success shrink-0">₹{p.overtimeRate} / hr</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                    {assignedCranes.length > 0 ? (
                      assignedCranes.map((c) => (
                        <span key={c.id} className="chip">{c.assetId}</span>
                      ))
                    ) : (
                      <span className="text-ink-400">No crane deployed</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden overflow-hidden rounded-lg border border-line md:block">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Project &amp; Client</th>
                    <th>Location</th>
                    <th>Site OT Rate</th>
                    <th>Cranes Deployed</th>
                    <th>Status</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeProjects.map((p) => {
                    const assignedCranes = machines.filter((m) => m.currentProjectId === p.id);
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="font-semibold text-ink-900">{p.name}</div>
                          <div className="mt-0.5 text-[11px] text-ink-500">{p.clientName}</div>
                        </td>
                        <td className="text-ink-600">{p.location}</td>
                        <td>
                          <span className="badge badge-success">₹{p.overtimeRate} / hr</span>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1.5">
                            {assignedCranes.length > 0 ? (
                              assignedCranes.map((c) => (
                                <span key={c.id} className="chip">
                                  {c.assetId}
                                </span>
                              ))
                            ) : (
                              <span className="text-ink-400">No crane deployed</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="badge badge-success uppercase">{p.status}</span>
                        </td>
                        <td className="text-right">
                          <button
                            onClick={() => onNavigateTab('projects')}
                            className="btn btn-ghost btn-sm"
                          >
                            Details <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION F & G: QUICK ACTIONS & PAYROLL OVERVIEW */}
      <div className="space-y-5">
        {/* SECTION G: QUICK ACTIONS */}
        <div className="card card-pad flex h-full flex-col gap-4">
          <div>
            <h3 className="text-base font-semibold text-ink-900">Enterprise Quick Actions</h3>
            <p className="mt-0.5 text-xs text-ink-500">Jump straight into common tasks</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              {
                label: 'Add Operator',
                description: 'Onboard a new operator',
                tab: 'employees' as NavTab,
                icon: Users,
              },
              {
                label: 'Create Project',
                description: 'Set up a new job site',
                tab: 'projects' as NavTab,
                icon: FolderKanban,
              },
              {
                label: 'Add Crane Asset',
                description: 'Register a new crane',
                tab: 'assets' as NavTab,
                icon: Truck,
              },
              {
                label: 'Mark Attendance',
                description: 'Log operator attendance',
                tab: 'attendance' as NavTab,
                icon: CalendarCheck,
              },
              {
                label: 'Enter Crane Hours',
                description: 'Record operating hours',
                tab: 'machine_working' as NavTab,
                icon: Activity,
              },
              {
                label: 'Add Expense',
                description: 'Capture a site expense',
                tab: 'expenses' as NavTab,
                icon: ReceiptIndianRupee,
              },
              {
                label: 'Record Advance',
                description: 'Issue a salary advance',
                tab: 'advances' as NavTab,
                icon: CreditCard,
              },
              {
                label: 'Process Payroll',
                description: 'Run the monthly payroll',
                tab: 'payroll' as NavTab,
                icon: DollarSign,
              },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  onClick={() => onNavigateTab(action.tab)}
                  className="group flex min-h-12 items-center gap-2.5 rounded-lg border border-line bg-surface p-2.5 text-left transition-colors hover:bg-surface-muted sm:gap-3 sm:p-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 transition-colors group-hover:bg-logo-700 group-hover:text-white">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-tight text-ink-900 sm:truncate">
                      {action.label}
                    </span>
                    <span className="hidden truncate text-[11px] text-ink-500 sm:block">
                      {action.description}
                    </span>
                  </span>
                  <ArrowRight className="hidden h-4 w-4 shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5 sm:block" />
                </button>
              );
            })}
          </div>
        </div>

        {/* SECTION F: PAYROLL OVERVIEW */}
        <div className="card card-pad">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-700">
                <DollarSign className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-ink-900">
                  {latestPayroll ? new Date(`${latestPayroll.month}-01T00:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' }) : monthLabel} Payroll
                </h3>
                <p className="text-xs text-ink-500">Monthly salary summary</p>
              </div>
            </div>
            <button
              onClick={() => onNavigateTab('payroll')}
              className="btn btn-primary"
            >
              <span>Open Payroll Dashboard</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-y-4 border-t border-line pt-4 sm:flex sm:items-center sm:divide-x sm:divide-line sm:border-t-0 sm:pt-0">
            <div className="sm:flex-1 sm:px-6 sm:first:pl-0">
              <span className="stat-label block">Gross Payroll</span>
              <strong className="mt-1 block text-lg font-bold text-ink-900">
                {formatINR(latestPayroll?.totalGrossSalary ?? 0)}
              </strong>
            </div>
            <div className="sm:flex-1 sm:px-6">
              <span className="stat-label block">Advances Recovered</span>
              <strong className="mt-1 block text-lg font-bold text-warning-700">
                {formatINR(latestPayroll?.totalAdvancesRecovered ?? 0)}
              </strong>
            </div>
            <div className="sm:flex-1 sm:px-6">
              <span className="stat-label block">Net Payable</span>
              <strong className="mt-1 block text-lg font-bold text-success-700">
                {formatINR(latestPayroll?.totalNetSalary ?? 0)}
              </strong>
            </div>
            <div className="sm:flex-1 sm:px-6">
              <span className="stat-label block">Status</span>
              <span className={`badge mt-1 uppercase ${latestPayroll ? 'badge-success' : 'badge-neutral'}`}>
                {latestPayroll?.status ?? 'Not generated'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
