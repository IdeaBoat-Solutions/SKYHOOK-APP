/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { SkyhookProvider, useSkyhook } from './data/apiStore';
import { Sidebar, NavTab } from './components/layout/Sidebar';
import { TopNavbar } from './components/layout/TopNavbar';
import { DashboardView } from './components/dashboard/DashboardView';
import { ProjectsView } from './components/projects/ProjectsView';
import { EmployeesView } from './components/employees/EmployeesView';
import { AttendanceView } from './components/attendance/AttendanceView';
import { MachineWorkingView } from './components/machine_working/MachineWorkingView';
import { PayrollView } from './components/payroll/PayrollView';
import { AdvancesView } from './components/advances/AdvancesView';
import { ExpensesView } from './components/expenses/ExpensesView';
import { AssetsView } from './components/assets/AssetsView';
import { EmiView } from './components/emi/EmiView';
import { RemindersView } from './components/reminders/RemindersView';
import { ReportsView } from './components/reports/ReportsView';
import { SettingsView } from './components/settings/SettingsView';
import { ReminderAlertItem } from './types';

function MainAppShell() {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { currentUser } = useSkyhook();

  const handleToggleSidebar = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setSidebarCollapsed((c) => !c);
    } else {
      setSidebarOpen((o) => !o);
    }
  };

  const isManager = currentUser.role === 'manager';

  const handleNavigateTab = (tab: NavTab) => {
    // Restrict manager from accessing emi tab directly
    if (isManager && tab === 'emi') {
      setCurrentTab('dashboard');
      return;
    }
    setCurrentTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenAlert = (alert: ReminderAlertItem) => {
    if (alert.category === 'emi') {
      if (!isManager) {
        setCurrentTab('emi');
      }
    } else if (
      alert.category === 'service' ||
      alert.category === 'insurance' ||
      alert.category === 'puc' ||
      alert.category === 'fitness'
    ) {
      setCurrentTab('reminders');
    } else if (alert.category === 'license') {
      setCurrentTab('employees');
    } else {
      setCurrentTab('reminders');
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        currentTab={currentTab}
        onSelectTab={handleNavigateTab}
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onCloseMobile={() => setSidebarOpen(false)}
      />

      <div className={`flex min-w-0 flex-1 flex-col ${sidebarCollapsed ? 'lg:pl-0' : 'lg:pl-72'}`}>
        <TopNavbar
          currentTab={currentTab}
          onToggleSidebar={handleToggleSidebar}
          onNavigateTab={handleNavigateTab}
          isOpen={sidebarOpen}
          isCollapsed={sidebarCollapsed}
        />

        <main className="app-main">
          {currentTab === 'dashboard' && (
            <DashboardView
              onNavigateTab={handleNavigateTab}
              onOpenAlertModal={handleOpenAlert}
            />
          )}

          {currentTab === 'projects' && <ProjectsView />}

          {currentTab === 'employees' && <EmployeesView />}

          {currentTab === 'attendance' && <AttendanceView />}

          {currentTab === 'machine_working' && <MachineWorkingView />}

          {currentTab === 'payroll' && <PayrollView />}

          {currentTab === 'advances' && <AdvancesView />}

          {currentTab === 'expenses' && <ExpensesView />}

          {currentTab === 'assets' && <AssetsView />}

          {currentTab === 'emi' && <EmiView />}

          {currentTab === 'reminders' && <RemindersView />}

          {currentTab === 'reports' && <ReportsView />}

          {currentTab === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  );
}

import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import { navigate, usePath } from './lib/nav';

function AppContent() {
  const { isAuthenticated } = useSkyhook();
  const path = usePath();

  // Keep the URL in step with auth state: signed-in users live at /app,
  // signed-out users at /login (or /register).
  useEffect(() => {
    if (isAuthenticated && path !== '/app' && !path.startsWith('/app/')) navigate('/app', { replace: true });
    if (!isAuthenticated && path !== '/login' && path !== '/register') navigate('/login', { replace: true });
  }, [isAuthenticated, path]);

  if (isAuthenticated) return <MainAppShell />;
  if (path === '/register') return <RegisterPage />;
  return <LoginPage />;
}

export default function App() {
  return (
    <SkyhookProvider>
      <AppContent />
    </SkyhookProvider>
  );
}
