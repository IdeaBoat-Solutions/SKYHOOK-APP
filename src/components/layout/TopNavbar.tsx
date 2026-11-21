import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Calendar,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  X,
  ExternalLink,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowRight,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { formatDateDDMMYYYY } from '../../utils/calculations';
import { NavTab } from './Sidebar';

interface TopNavbarProps {
  onToggleSidebar: () => void;
  currentTab: NavTab;
  onNavigateTab: (tab: NavTab) => void;
  isOpen: boolean;
  isCollapsed: boolean;
}

const TAB_TITLES: Record<NavTab, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'Business Overview',
    subtitle: 'Monitor your crane operations, workforce, projects and financial activities.',
  },
  projects: {
    title: 'Project Management',
    subtitle: 'Manage client job sites, heavy equipment assignments, and site-specific overtime rates.',
  },
  employees: {
    title: 'Employee & Operator Master',
    subtitle: 'Centralized workforce records, operator licenses, emergency contacts and document uploads.',
  },
  operator_directory: {
    title: 'Operator Directory',
    subtitle: 'Searchable contact book for crane operators, licences, deployment and pay details.',
  },
  contractor_directory: {
    title: 'Contractor & Freelancer Directory',
    subtitle: 'External operators and contractors you can call or message on WhatsApp when your own crew is unavailable.',
  },
  attendance: {
    title: 'Operator Attendance & Overtime',
    subtitle: 'Standard 10-hour daily shift tracking, multi-project overtime allocation and approvals.',
  },
  machine_working: {
    title: 'Machine Operating Hours Register',
    subtitle: 'Crane working hours, idle time tracking, equipment utilization and Excel import/export.',
  },
  payroll: {
    title: 'Automated Operator & Staff Payroll',
    subtitle: 'Formula-based monthly wage processing, project overtime, advance deductions and salary slips.',
  },
  advances: {
    title: 'Salary Advance Management',
    subtitle: 'Track cash advances, disbursements, payroll recoveries and carry-forward balances.',
  },
  expenses: {
    title: 'Project-Wise Expense Management',
    subtitle: 'Record diesel, crane maintenance, spare parts, transit tolls and site expense vouchers.',
  },
  assets: {
    title: 'Asset Master (Cranes & Equipment)',
    subtitle: 'Fleet inventory, tonnage capacity, maintenance history and statutory compliance.',
  },
  emi: {
    title: 'Machine EMI Loans & Installments',
    subtitle: 'Equipment finance repayment schedules, monthly installment reminders and payment proofs.',
  },
  calculations: {
    title: 'Calculations',
    subtitle: 'Machine EMI, fleet totals and your own custom calculators in one place.',
  },
  personal: {
    title: 'Personal',
    subtitle: 'Private records, dues and reminders. Owner only, locked behind your PIN.',
  },
  reminders: {
    title: 'Statutory Compliance & Renewal Alerts',
    subtitle: 'Actionable deadline tracking for Service, Insurance, PUC, Fitness and Operator Licenses.',
  },
  reports: {
    title: 'Reports & Export Centre',
    subtitle: 'Download consolidated Excel spreadsheets and official PDF documents across all modules.',
  },
  settings: {
    title: 'Company & System Settings',
    subtitle: 'Configure company profile, official logo, payroll cutoff rules and reminder lead times.',
  },
};

interface NotificationRowProps {
  iconColor: string;
  label: string;
  labelColor: string;
  title?: string;
  urgency?: string;
  hoverColor: string;
  onClick: () => void;
}

const NotificationRow: React.FC<NotificationRowProps> = ({
  iconColor,
  label,
  labelColor,
  title,
  urgency,
  hoverColor,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors ${hoverColor}`}
  >
    <span className="flex items-center justify-between gap-2">
      <span className={`flex items-center gap-1.5 text-xs font-semibold ${labelColor}`}>
        <AlertCircle className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
        {label}
      </span>
      <span className="flex items-center text-[10px] font-semibold text-accent-700">
        View <ExternalLink className="ml-1 h-3 w-3" />
      </span>
    </span>
    {title && (
      <span className="truncate text-xs text-ink-500">
        {title} - {urgency}
      </span>
    )}
  </button>
);

export const TopNavbar: React.FC<TopNavbarProps> = ({
  onToggleSidebar,
  currentTab,
  onNavigateTab,
  isOpen,
  isCollapsed,
}) => {
  const {
    currentUser,
    logout,
    currentDate,
    resetToDemoData,
    getEmiAlerts,
    getServiceAlerts,
    getInsuranceAlerts,
    getPucAlerts,
    getFitnessAlerts,
    getLicenseAlerts,
  } = useSkyhook();

  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Click outside / Escape closes the alerts panel.
  useEffect(() => {
    if (!showNotifications) return;
    const onDown = (e: Event) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNotifications(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showNotifications]);

  const isManager = currentUser.role === 'manager';

  const emiAlerts = isManager ? [] : getEmiAlerts();
  const srvAlerts = getServiceAlerts();
  const insAlerts = getInsuranceAlerts();
  const pucAlerts = getPucAlerts();
  const fitAlerts = getFitnessAlerts();
  const licAlerts = getLicenseAlerts();

  const totalUrgent =
    emiAlerts.filter((a) => a.status === 'overdue' || a.status === 'due_today').length +
    srvAlerts.filter((a) => a.status === 'overdue' || a.status === 'due_today').length +
    insAlerts.filter((a) => a.status === 'overdue' || a.status === 'due_today').length +
    pucAlerts.filter((a) => a.status === 'overdue' || a.status === 'due_today').length +
    fitAlerts.filter((a) => a.status === 'overdue' || a.status === 'due_today').length +
    licAlerts.filter((a) => a.status === 'overdue' || a.status === 'due_today').length;

  const currentMeta = TAB_TITLES[currentTab] || {
    title: 'Skyhook ERP',
    subtitle: 'Crane Business Management ERP',
  };

  // Re-reads everything from the server (it never wipes data).
  const [refreshing, setRefreshing] = useState(false);
  const handleRefreshData = async () => {
    setRefreshing(true);
    try {
      await resetToDemoData();
    } finally {
      setRefreshing(false);
    }
  };

  const navigate = (tab: NavTab) => {
    setShowNotifications(false);
    onNavigateTab(tab);
  };

  return (
    <header className="topbar-accent sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur-md">
      <div className="flex min-h-14 items-center justify-between gap-1 px-2 pt-[env(safe-area-inset-top)] sm:gap-2">
        {/* Left: page context */}
        <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="icon-btn h-8 w-8 shrink-0 lg:hidden"
            aria-label={isOpen ? 'Close navigation sidebar' : 'Open navigation sidebar'}
          >
            {isOpen ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onToggleSidebar}
            className="icon-btn h-8 w-8 hidden shrink-0 lg:inline-flex"
            aria-label="Toggle navigation sidebar"
            title="Toggle sidebar"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
          </button>
          <span className="hidden h-5 w-px shrink-0 bg-line sm:block" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-ink-900 sm:text-base">
              {currentMeta.title}
            </h1>
            <p className="flex items-center gap-1 text-[11px] leading-tight text-ink-500 md:hidden">
              <Calendar className="h-3 w-3 text-ink-400" aria-hidden="true" />
              {formatDateDDMMYYYY(currentDate)}
            </p>
          </div>
        </div>

        {/* Right: compact utilities */}
        <div className="flex shrink-0 items-center gap-1">
          <span className="hidden items-center gap-1.5 border-r border-line pr-3 text-xs text-ink-500 md:flex">
            <Calendar className="h-3.5 w-3.5 text-ink-400" />
            {formatDateDDMMYYYY(currentDate)}
          </span>

          <button
            type="button"
            onClick={() => void handleRefreshData()}
            disabled={refreshing}
            title="Refresh data from the server"
            className="icon-btn hidden h-8 w-8 sm:inline-flex"
            aria-label="Refresh data"
          >
            <RotateCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          {/* Notifications */}
          <div className="sm:relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setShowNotifications(!showNotifications)}
              className="icon-btn relative h-8 w-8 shrink-0"
              aria-label="View notifications"
            >
              <Bell className="h-4 w-4" />
              {totalUrgent > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-surface bg-accent-700 px-0.5 text-[8px] font-bold text-white">
                  {totalUrgent}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="fixed inset-x-2 top-[calc(3.5rem+env(safe-area-inset-top))] z-50 overflow-hidden rounded-lg border border-line bg-surface shadow-popover sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[22rem]">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink-900">Actionable Alerts</span>
                    {totalUrgent > 0 && (
                      <span className="badge badge-danger">{totalUrgent} Urgent</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowNotifications(false)}
                    className="icon-btn"
                    aria-label="Close notifications"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="max-h-[70dvh] space-y-0.5 overflow-y-auto p-2 sm:max-h-96">
                  {!isManager && emiAlerts.length > 0 && (
                    <NotificationRow
                      iconColor="text-accent-600"
                      labelColor="text-brand-700"
                      label={`Machine EMI (${emiAlerts.length})`}
                      title={emiAlerts[0]?.title}
                      urgency={emiAlerts[0]?.urgencyLabel}
                      hoverColor="hover:bg-brand-50"
                      onClick={() => navigate('emi')}
                    />
                  )}
                  {srvAlerts.length > 0 && (
                    <NotificationRow
                      iconColor="text-accent-600"
                      labelColor="text-ink-800"
                      label={`Machine Service (${srvAlerts.length})`}
                      title={srvAlerts[0]?.title}
                      urgency={srvAlerts[0]?.urgencyLabel}
                      hoverColor="hover:bg-surface-muted"
                      onClick={() => navigate('assets')}
                    />
                  )}
                  {insAlerts.length > 0 && (
                    <NotificationRow
                      iconColor="text-accent-600"
                      labelColor="text-brand-700"
                      label={`Insurance Renewals (${insAlerts.length})`}
                      title={insAlerts[0]?.title}
                      urgency={insAlerts[0]?.urgencyLabel}
                      hoverColor="hover:bg-brand-50"
                      onClick={() => navigate('reminders')}
                    />
                  )}
                  {pucAlerts.length > 0 && (
                    <NotificationRow
                      iconColor="text-accent-600"
                      labelColor="text-ink-800"
                      label={`PUC Renewals (${pucAlerts.length})`}
                      title={pucAlerts[0]?.title}
                      urgency={pucAlerts[0]?.urgencyLabel}
                      hoverColor="hover:bg-surface-muted"
                      onClick={() => navigate('reminders')}
                    />
                  )}
                  {fitAlerts.length > 0 && (
                    <NotificationRow
                      iconColor="text-accent-600"
                      labelColor="text-ink-800"
                      label={`Fitness Renewals (${fitAlerts.length})`}
                      title={fitAlerts[0]?.title}
                      urgency={fitAlerts[0]?.urgencyLabel}
                      hoverColor="hover:bg-surface-muted"
                      onClick={() => navigate('reminders')}
                    />
                  )}
                  {licAlerts.length > 0 && (
                    <NotificationRow
                      iconColor="text-accent-600"
                      labelColor="text-brand-700"
                      label={`Operator Licenses (${licAlerts.length})`}
                      title={licAlerts[0]?.title}
                      urgency={licAlerts[0]?.urgencyLabel}
                      hoverColor="hover:bg-brand-50"
                      onClick={() => navigate('employees')}
                    />
                  )}

                  {totalUrgent === 0 && (
                    <div className="empty-state py-8">
                      <CheckCircle2 className="h-7 w-7 text-success-600" />
                      <span className="text-xs">All clear - no urgent items.</span>
                    </div>
                  )}
                </div>

                <div className="border-t border-line px-4 py-2.5 text-center">
                  <button
                    type="button"
                    onClick={() => navigate('reminders')}
                    className="text-xs font-semibold text-accent-700 hover:text-accent-800"
                  >
                    Open Compliance &amp; Renewals
                    <ArrowRight
                      size={12}
                      className="inline-block align-middle ml-1"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
            )}
          </div>

          <span className="mx-0.5 hidden h-4 w-px bg-line sm:mx-1 sm:block" aria-hidden="true" />

          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-logo-700 text-[10px] font-bold text-white"
            title={`${currentUser.name} · ${currentUser.role === 'owner' ? 'Owner / Admin' : 'Manager'}`}
          >
            {currentUser.name.charAt(0)}
          </div>
          <button
            type="button"
            onClick={logout}
            title="Sign Out / Switch Account"
            className="icon-btn h-8 w-8 shrink-0"
            aria-label="Sign Out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
