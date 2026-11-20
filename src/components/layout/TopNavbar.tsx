import React, { useState } from 'react';
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

  const handleResetData = () => {
    if (window.confirm('Reset all Skyhook ERP demo records back to clean initial state?')) {
      resetToDemoData();
      alert('Demo data successfully restored.');
    }
  };

  const navigate = (tab: NavTab) => {
    setShowNotifications(false);
    onNavigateTab(tab);
  };

  return (
    <header className="topbar-accent sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-2 px-2">
        {/* Left: page context */}
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="icon-btn h-8 w-8 lg:hidden"
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
            className="icon-btn h-8 w-8 hidden lg:inline-flex"
            aria-label="Toggle navigation sidebar"
            title="Toggle sidebar"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
          </button>
          <span className="h-5 w-px shrink-0 bg-line" aria-hidden="true" />
          <h1 className="truncate text-base font-semibold tracking-tight text-ink-900">
            {currentMeta.title}
          </h1>
        </div>

        {/* Right: compact utilities */}
        <div className="flex shrink-0 items-center gap-1">
          <span className="hidden items-center gap-1.5 border-r border-line pr-3 text-xs text-ink-500 md:flex">
            <Calendar className="h-3.5 w-3.5 text-ink-400" />
            {formatDateDDMMYYYY(currentDate)}
          </span>

          <button
            type="button"
            onClick={handleResetData}
            title="Reset database to demo seed data"
            className="icon-btn h-8 w-8"
            aria-label="Reset demo data"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNotifications(!showNotifications)}
              className="icon-btn relative h-8 w-8"
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
              <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface shadow-popover">
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

                <div className="max-h-96 space-y-0.5 overflow-y-auto p-2">
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

          <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />

          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-900 text-[10px] font-bold text-white"
            title={`${currentUser.name} · ${currentUser.role === 'owner' ? 'Owner / Admin' : 'Manager'}`}
          >
            {currentUser.name.charAt(0)}
          </div>
          <button
            type="button"
            onClick={logout}
            title="Sign Out / Switch Account"
            className="icon-btn h-8 w-8"
            aria-label="Sign Out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
