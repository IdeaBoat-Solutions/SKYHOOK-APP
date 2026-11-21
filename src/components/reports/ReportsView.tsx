import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Download,
  Users,
  Truck,
  Calculator,
  ReceiptIndianRupee,
  Cpu,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { formatINR, formatDateDDMMYYYY } from '../../utils/calculations';
import {
  exportToXLSX,
  exportMachineWorkingLogs,
  exportPayrollSummary,
  exportProjectExpenses,
} from '../../utils/excelAndPdf';

type ReportCategory = 'all' | 'payroll' | 'attendance' | 'machines' | 'expenses' | 'assets' | 'employees';

export const ReportsView: React.FC = () => {
  const {
    employees,
    projects,
    machines,
    attendance,
    payrollRuns,
    expenses,
    machineWorkingLogs,
    currentDate,
  } = useSkyhook();

  const [activeReportCategory, setActiveReportCategory] = useState<ReportCategory>('all');

  // Export handlers
  const handleExportEmployees = () => {
    const rows = employees.map((e) => ({
      'Employee Code': e.employeeId,
      'Full Name': e.fullName,
      'Designation': e.designation,
      'Workforce Type': e.employeeType.toUpperCase(),
      'Mobile': e.mobile,
      'Joining Date': formatDateDDMMYYYY(e.joiningDate),
      'Salary Type': e.salaryType.toUpperCase(),
      'Daily / Monthly Rate': formatINR(e.dailyRate || e.monthlySalary),
      'License Number': e.licenseNumber || 'N/A',
      'Crane License Expiry': formatDateDDMMYYYY(e.craneLicenseExpiry),
      'Transport License Expiry': formatDateDDMMYYYY(e.transportLicenseExpiry),
      'Status': e.status.toUpperCase(),
    }));
    exportToXLSX(rows, `Skyhook_Workforce_Master_${currentDate}`);
  };

  const handleExportAssets = () => {
    const rows = machines.map((m) => ({
      'Asset ID': m.assetId,
      'Type': m.machineType,
      'Make & Model': `${m.make} ${m.model}`,
      'Registration': m.registrationNumber,
      'Tonnage': `${m.tonnageCapacity}T`,
      'Purchase Date': formatDateDDMMYYYY(m.purchaseDate),
      'Purchase Cost': formatINR(m.purchaseCost),
      'Status': m.status.toUpperCase(),
      'Next Service Due': m.serviceFrequencyUnit === 'hours'
        ? `Every ${m.serviceFrequencyValue} operating hours`
        : formatDateDDMMYYYY(m.nextServiceDueDate),
      'Insurance Expiry': formatDateDDMMYYYY(m.insuranceExpiryDate),
      'PUC Expiry': formatDateDDMMYYYY(m.pucExpiryDate),
      'Fitness Expiry': formatDateDDMMYYYY(m.nextFitnessDueDate),
    }));
    exportToXLSX(rows, `Skyhook_Asset_Master_${currentDate}`);
  };

  const handleExportAttendance = () => {
    const rows = attendance.map((a) => {
      const op = employees.find((e) => e.id === a.operatorId || e.employeeId === a.operatorId);
      const prj = projects.find((p) => p.id === a.projectId);
      return {
        'Attendance ID': a.id,
        'Date': formatDateDDMMYYYY(a.date),
        'Operator': op?.fullName || a.operatorId,
        'Project': prj?.name || a.projectId,
        'Machine': a.machineId || 'Site Duty',
        'Shift Start': a.startTime,
        'Shift End': a.endTime,
        'Break (Min)': a.unpaidBreakMinutes,
        'Net Hours': a.netWorkingHours,
        'Standard Hours': a.standardWorkingHours,
        'Overtime (Hours)': a.overtimeHours,
        'OT Rate Applied': `₹${a.appliedOtRate}/h`,
        'Status': a.status.toUpperCase(),
        'Approval': a.approvalStatus.toUpperCase(),
      };
    });
    exportToXLSX(rows, `Skyhook_Attendance_Register_${currentDate}`);
  };

  const latestPayroll = payrollRuns[0];

  const categories: { id: ReportCategory; label: string }[] = [
    { id: 'all', label: 'All Reports' },
    { id: 'payroll', label: 'Payroll' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'machines', label: 'Machines' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'assets', label: 'Assets' },
    { id: 'employees', label: 'Employees' },
  ];

  const reports: {
    id: ReportCategory;
    title: string;
    subtitle: string;
    description: string;
    summary: React.ReactNode;
    icon: React.ElementType;
    accent: string;
    buttonLabel: string;
    onExport: () => void;
  }[] = [
    {
      id: 'payroll',
      title: 'Monthly Payroll & Wage Master',
      subtitle: `${new Date(`${currentDate.slice(0, 7)}-01T00:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' })} Payout Period`,
      description:
        'Complete breakdown of payable working days, base pay, site overtime rates, advance recoveries, and net payable.',
      summary: (
        <>
          Employees: <strong className="font-semibold text-ink-900">{latestPayroll?.employeeCount || 4}</strong>
          <span className="mx-1.5 text-ink-300">•</span>
          Net Disbursal:{' '}
          <strong className="font-semibold text-success-700">
            {formatINR(latestPayroll?.totalNetSalary || 86850)}
          </strong>
        </>
      ),
      icon: Calculator,
      accent: 'bg-success-50 text-success-700',
      buttonLabel: 'Download Payroll XLSX',
      onExport: () => {
        if (latestPayroll) exportPayrollSummary(latestPayroll);
      },
    },
    {
      id: 'machines',
      title: 'Machine Operating Register',
      subtitle: 'Fleet engine operating sessions',
      description:
        'Consolidated crane operational hours, start/end shift logs, idle duration subtractions, and site summaries.',
      summary: (
        <>
          Total Logs: <strong className="font-semibold text-ink-900">{machineWorkingLogs.length}</strong>
          <span className="mx-1.5 text-ink-300">•</span>
          Total Operating Hours:{' '}
          <strong className="font-semibold text-warning-700">
            {machineWorkingLogs.reduce((s, m) => s + m.workingHours, 0)} hrs
          </strong>
        </>
      ),
      icon: Cpu,
      accent: 'bg-warning-50 text-warning-700',
      buttonLabel: 'Download Machine Operating XLSX',
      onExport: () => exportMachineWorkingLogs(machineWorkingLogs, machines, projects, employees),
    },
    {
      id: 'attendance',
      title: 'Daily & Monthly Attendance',
      subtitle: 'Standard 10h shift tracking',
      description:
        'Full monthly attendance matrix, presents, absents, weekly offs, paid holidays, and approved site overtime.',
      summary: (
        <>
          Total Log Entries: <strong className="font-semibold text-ink-900">{attendance.length}</strong>
          <span className="mx-1.5 text-ink-300">•</span>
          Approved Attendance Records
        </>
      ),
      icon: Users,
      accent: 'bg-brand-50 text-brand-700',
      buttonLabel: 'Download Attendance XLSX',
      onExport: handleExportAttendance,
    },
    {
      id: 'expenses',
      title: 'Project Operational Expenses',
      subtitle: 'Diesel, repair, and transport tolls',
      description:
        'Itemized project-wise expenditures, fuel receipts, supplier invoices, payment modes, and approvals.',
      summary: (
        <>
          Total Vouchers: <strong className="font-semibold text-ink-900">{expenses.length}</strong>
          <span className="mx-1.5 text-ink-300">•</span>
          Outflow:{' '}
          <strong className="font-semibold text-brand-700">
            {formatINR(expenses.reduce((s, e) => s + e.amount, 0))}
          </strong>
        </>
      ),
      icon: ReceiptIndianRupee,
      accent: 'bg-brand-50 text-brand-700',
      buttonLabel: 'Download Expenses XLSX',
      onExport: () => exportProjectExpenses(expenses, projects),
    },
    {
      id: 'assets',
      title: 'Asset & Statutory Compliance',
      subtitle: 'Crane fleet & RTO renewals',
      description:
        'Complete fleet registration numbers, capacities, service schedules, insurance policies, and fitness validity dates.',
      summary: (
        <>
          Registered Cranes: <strong className="font-semibold text-ink-900">{machines.length}</strong>
          <span className="mx-1.5 text-ink-300">•</span>
          Deployed on Sites:{' '}
          <strong className="font-semibold text-brand-700">
            {machines.filter((m) => m.status === 'assigned').length}
          </strong>
        </>
      ),
      icon: Truck,
      accent: 'bg-brand-50 text-brand-700',
      buttonLabel: 'Download Asset Master XLSX',
      onExport: handleExportAssets,
    },
    {
      id: 'employees',
      title: 'Workforce & Operator Master',
      subtitle: 'Employee database & wage master',
      description:
        'Employee codes, designation, phone numbers, wage structures, crane licenses, and emergency contacts.',
      summary: (
        <>
          Total Workforce: <strong className="font-semibold text-ink-900">{employees.length}</strong>
          <span className="mx-1.5 text-ink-300">•</span>
          Active Operators:{' '}
          <strong className="font-semibold text-ink-900">
            {employees.filter((e) => e.employeeType === 'operator').length}
          </strong>
        </>
      ),
      icon: Users,
      accent: 'bg-surface-muted text-ink-700',
      buttonLabel: 'Download Workforce XLSX',
      onExport: handleExportEmployees,
    },
  ];

  const visibleReports =
    activeReportCategory === 'all'
      ? reports
      : reports.filter((report) => report.id === activeReportCategory);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="page-header">
        <div className="min-w-0">
          <h2 className="page-title !mt-0">Reports &amp; Export Centre</h2>
          <p className="mt-0.5 text-xs text-ink-500 sm:text-sm">
            Download operational spreadsheets, compliance schedules, and audit-ready accounting files.
          </p>
        </div>
      </div>

      {/* Category filter */}
      <div className="filter-bar">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <FileSpreadsheet className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <span className="stat-label block">Report Categories</span>
            <span className="text-[11px] text-ink-500">
              Showing {visibleReports.length} of {reports.length} export datasets
            </span>
          </div>
        </div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:pb-0">
          {categories.map((category) => {
            const isActive = activeReportCategory === category.id;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveReportCategory(category.id)}
                className={`btn btn-sm shrink-0 ${
                  isActive ? 'btn-primary' : 'btn-ghost'
                }`}
              >
                {category.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleReports.map((report) => {
          const Icon = report.icon;
          return (
            <div
              key={report.id}
              className="card card-pad flex h-full flex-col gap-3 transition-colors hover:border-line-strong"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold tracking-tight text-ink-900">{report.title}</h3>
                  <p className="mt-0.5 text-[11px] text-ink-500">{report.subtitle}</p>
                </div>
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${report.accent}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </div>
              </div>

              <p className="text-xs leading-relaxed text-ink-600">{report.description}</p>

              <div className="rounded-lg border border-line bg-surface-muted p-3">
                <span className="stat-label block">Export Summary</span>
                <p className="mt-1 text-xs leading-relaxed text-ink-700">{report.summary}</p>
              </div>

              <button
                type="button"
                onClick={report.onExport}
                className="btn btn-secondary btn-sm mt-auto w-full"
              >
                <Download className="h-3.5 w-3.5 shrink-0 text-brand-700" />
                <span>{report.buttonLabel}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
