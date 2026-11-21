import React from 'react';
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  ContactRound,
  CalendarCheck,
  Cpu,
  Calculator,
  Sigma,
  LockKeyhole,
  ReceiptIndianRupee,
  Truck,
  BellRing,
  FileSpreadsheet,
  Settings,
  AlertTriangle,
  FileText,
  LogOut,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { BrandLogo } from '../common/BrandLogo';

export type NavTab =
  | 'dashboard'
  | 'projects'
  | 'employees'
  | 'operator_directory'
  | 'attendance'
  | 'machine_working'
  | 'payroll'
  | 'advances'
  | 'expenses'
  | 'assets'
  | 'emi'
  | 'calculations'
  | 'personal'
  | 'reminders'
  | 'reports'
  | 'settings';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isOpen: boolean;
  isCollapsed?: boolean;
  onCloseMobile?: () => void;
}

const NAV_BADGE = {
  alert: 'bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/20',
  info: 'bg-white/[0.08] text-ink-300 ring-1 ring-inset ring-white/[0.06]',
};

/* Critical is reserved for the one place that owns the alerts. Every other
   count is informational, so the red signal is said once, not on five rows. */
type BadgeSource = 'total' | 'license' | 'attendance' | 'asset' | 'emi';
type NavDef = {
  id: NavTab;
  label: string;
  icon: LucideIcon;
  badge?: BadgeSource;
  critical?: boolean;
  ownerOnly?: boolean;
};

const NAV_SECTIONS: { label: string; items: NavDef[] }[] = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard', label: 'Business Overview', icon: LayoutDashboard, badge: 'total' },
      { id: 'projects', label: 'Project Management', icon: FolderKanban },
    ],
  },
  {
    label: 'Workforce',
    items: [
      { id: 'employees', label: 'Employee & Operators', icon: Users, badge: 'license' },
      { id: 'operator_directory', label: 'Operator Directory', icon: ContactRound },
      { id: 'attendance', label: 'Operator Attendance', icon: CalendarCheck, badge: 'attendance' },
      { id: 'payroll', label: 'Automated Payroll', icon: Calculator },
      { id: 'advances', label: 'Salary Advances', icon: ReceiptIndianRupee },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'machine_working', label: 'Machine Working (Crane)', icon: Cpu },
      { id: 'assets', label: 'Asset Master (Cranes)', icon: Truck, badge: 'asset' },
      { id: 'expenses', label: 'Project Expenses', icon: FileSpreadsheet },
    ],
  },
  {
    label: 'Calculations',
    items: [
      { id: 'calculations', label: 'Calculations', icon: Sigma, badge: 'emi' },
      // Owner-only; the page itself is also protected by a 4-digit PIN.
      { id: 'personal', label: 'Personal', icon: LockKeyhole, ownerOnly: true },
    ],
  },
  {
    label: 'Alerts & reports',
    items: [
      {
        id: 'reminders',
        label: 'Reminders & Renewals',
        icon: BellRing,
        badge: 'total',
        critical: true,
      },
      { id: 'reports', label: 'Reports & Downloads', icon: FileSpreadsheet },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'settings', label: 'Company Settings', icon: Settings },
    ],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isOpen,
  isCollapsed = false,
  onCloseMobile,
}) => {
  const {
    currentUser,
    logout,
    companySettings,
    getEmiAlerts,
    getServiceAlerts,
    getInsuranceAlerts,
    getPucAlerts,
    getFitnessAlerts,
    getLicenseAlerts,
    attendance,
  } = useSkyhook();

  const isManager = currentUser.role === 'manager';

  const emiCount = isManager ? 0 : getEmiAlerts().length;
  const serviceCount = getServiceAlerts().length;
  const insCount = getInsuranceAlerts().length;
  const pucCount = getPucAlerts().length;
  const fitCount = getFitnessAlerts().length;
  const licCount = getLicenseAlerts().length;
  const totalRemindersCount = emiCount + serviceCount + insCount + pucCount + fitCount + licCount;

  const pendingAttendanceCount = attendance.filter((a) => a.approvalStatus === 'submitted').length;
  const assetAlertCount = serviceCount + insCount + pucCount + fitCount;

  const badgeCount = (source?: BadgeSource): number | undefined => {
    switch (source) {
      case 'total':
        return totalRemindersCount > 0 ? totalRemindersCount : undefined;
      case 'license':
        return licCount > 0 ? licCount : undefined;
      case 'attendance':
        return pendingAttendanceCount > 0 ? pendingAttendanceCount : undefined;
      case 'asset':
        return assetAlertCount > 0 ? assetAlertCount : undefined;
      case 'emi':
        return emiCount > 0 ? emiCount : undefined;
      default:
        return undefined;
    }
  };

  const handleNavClick = (tab: NavTab) => {
    onSelectTab(tab);
    if (onCloseMobile) onCloseMobile();
  };

  const renderNavItem = (item: NavDef) => {
    const Icon = item.icon;
    const isActive = currentTab === item.id;
    const count = badgeCount(item.badge);
    const critical = Boolean(item.critical && count !== undefined);

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => handleNavClick(item.id)}
        aria-current={isActive ? 'page' : undefined}
        className={`group relative flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors ${
          isActive
            ? 'bg-white/10 text-white ring-1 ring-inset ring-white/[0.06]'
            : 'text-ink-400 hover:bg-white/5 hover:text-white'
        }`}
      >
        {isActive && (
          <span
            className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-white"
            aria-hidden="true"
          />
        )}
        <span className="flex min-w-0 items-center gap-3">
          <Icon
            className={`h-[18px] w-[18px] shrink-0 transition-colors ${
              isActive ? 'text-white' : 'text-ink-500 group-hover:text-ink-300'
            }`}
          />
          <span className="truncate">{item.label}</span>
        </span>
        {count !== undefined && (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold leading-4 ${
              critical ? NAV_BADGE.alert : NAV_BADGE.info
            }`}
          >
            {critical && <span className="h-1 w-1 rounded-full bg-current" aria-hidden="true" />}
            {count}
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-logo-950/70 backdrop-blur-[2px] lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-white/5 bg-logo-700 text-ink-200 transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } ${isCollapsed ? 'lg:-translate-x-full' : 'lg:translate-x-0'}`}
      >
        {/* Brand */}
        <div className="relative border-b border-white/[0.06] px-5 pb-3 pt-4">
          <span
            className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-white/20 via-white/5 to-transparent"
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => { onSelectTab('dashboard'); onCloseMobile?.(); }}
            className="-m-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label="Skyhook ERP, go to dashboard"
          >
            {/* The logo already carries the SKYHOOK name, so it is shown as a
                wordmark tile rather than a square icon with the name repeated. */}
            <div className="flex h-[4.25rem] w-[6.75rem] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1 ring-1 ring-white/20">
              <BrandLogo
                src={companySettings.logoUrl}
                className="h-full w-full scale-[1.18]"
              />
            </div>
            <div className="min-w-0 flex-1">
              <span className="inline-flex items-center rounded bg-white/10 px-1.5 py-[3px] text-[9px] font-bold uppercase leading-none tracking-[0.12em] text-ink-300 ring-1 ring-inset ring-white/10">
                ERP
              </span>
              <p className="mt-1.5 line-clamp-3 whitespace-normal break-words text-[11px] leading-tight text-ink-300">
                {companySettings.tagline || 'Elevating Crane Operations.'}
              </p>
            </div>
          </button>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav flex-1 overflow-y-auto px-2 pb-4 pt-2">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => !(isManager && item.ownerOnly));
            if (items.length === 0) return null;
            return (
              <div className="mb-2 last:mb-0" key={section.label}>
                <div className="space-y-0.5">{items.map(renderNavItem)}</div>
              </div>
            );
          })}
        </nav>

        {/* Footer: one consolidated alert summary, the role switch and user */}
        <div className="border-t border-white/[0.06] px-5 py-3">
          {totalRemindersCount > 0 && (
            <button
              type="button"
              onClick={() => handleNavClick('reminders')}
              className="group mb-3 flex w-full items-center gap-3 rounded-xl border border-red-500/20 bg-gradient-to-r from-red-500/[0.12] to-red-500/[0.03] px-3 py-2.5 text-left transition-colors hover:border-red-500/40 hover:from-red-500/[0.18] hover:to-red-500/[0.06]"
            >
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-400">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-red-100">
                  {totalRemindersCount} Critical alerts
                </span>
                <span className="block truncate text-[10px] text-red-300/70">
                  Needs your attention
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide text-red-300 transition-transform group-hover:translate-x-0.5">
                View <ChevronRight className="h-3 w-3" />
              </span>
            </button>
          )}

          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-xs font-bold text-ink-200 ring-1 ring-inset ring-white/10">
                {currentUser.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white">{currentUser.name}</p>
                <p className="truncate text-[10px] capitalize text-ink-500">
                  {currentUser.role === 'owner' ? 'Super Admin' : 'Site Manager'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={logout}
                title="Sign Out / Return to Login"
                className="icon-btn hover:bg-white/10 hover:text-red-300"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
