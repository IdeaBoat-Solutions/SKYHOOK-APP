import * as XLSX from 'xlsx';
import { MachineWorkingLog, MachineAsset, Project, Employee, AttendanceRecord, PayrollRun, ProjectExpense } from '../types';
import { formatDateDDMMYYYY, formatINR } from './calculations';

/**
 * Downloads a buffer or array of objects as a valid XLSX spreadsheet file.
 */
export function exportToXLSX(data: any[], fileName: string, sheetName: string = 'Sheet1') {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  // Auto-size columns based on maximum cell lengths
  const maxProps = Object.keys(data[0] || {});
  const colWidths = maxProps.map((key) => {
    let maxLen = key.length;
    data.forEach((row) => {
      const valStr = String(row[key] ?? '');
      if (valStr.length > maxLen) maxLen = valStr.length;
    });
    return { wch: Math.min(Math.max(maxLen + 3, 12), 40) };
  });
  worksheet['!cols'] = colWidths;

  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}

/**
 * Generates and downloads the official Machine Working Log import template.
 */
export function downloadMachineWorkingTemplate() {
  const templateRows = [
    {
      'Date (YYYY-MM-DD)': '2026-10-24',
      'Machine ID': 'CR-001',
      'Project ID': 'PRJ-001',
      'Operator ID': 'OP-001',
      'Start Time (HH:mm)': '08:00',
      'End Time (HH:mm)': '18:00',
      'Idle Minutes': 60,
      'Remarks': 'Pier lifting operations',
    },
    {
      'Date (YYYY-MM-DD)': '2026-10-24',
      'Machine ID': 'CR-002',
      'Project ID': 'PRJ-001',
      'Operator ID': 'OP-002',
      'Start Time (HH:mm)': '08:30',
      'End Time (HH:mm)': '17:30',
      'Idle Minutes': 30,
      'Remarks': 'Rebar unloading duty',
    },
    {
      'Date (YYYY-MM-DD)': '2026-10-24',
      'Machine ID': 'CR-004',
      'Project ID': 'PRJ-002',
      'Operator ID': 'OP-004',
      'Start Time (HH:mm)': '07:30',
      'End Time (HH:mm)': '19:30',
      'Idle Minutes': 45,
      'Remarks': 'Breakwater placement',
    },
  ];

  exportToXLSX(templateRows, 'Skyhook_Machine_Working_Import_Template', 'WorkingLogsTemplate');
}

export interface ParsedImportRow {
  rowNumber: number;
  date: string;
  machineId: string;
  projectId: string;
  operatorId: string;
  startTime: string;
  endTime: string;
  idleMinutes: number;
  remarks: string;
  isValid: boolean;
  errors: string[];
}

export interface ImportValidationResult {
  totalRows: number;
  validRows: ParsedImportRow[];
  invalidRows: ParsedImportRow[];
}

/**
 * Parses and validates an uploaded XLSX file for Machine Working logs.
 */
export async function parseMachineWorkingExcel(
  file: File,
  validMachines: MachineAsset[],
  validProjects: Project[],
  validEmployees: Employee[]
): Promise<ImportValidationResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  // Convert raw sheet to JSON objects
  const rawData: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  const validMachineIds = new Set(validMachines.map((m) => m.assetId));
  const validProjectIds = new Set(validProjects.map((p) => p.projectId || p.id));
  const validOperatorIds = new Set(validEmployees.map((e) => e.employeeId || e.id));

  const validRows: ParsedImportRow[] = [];
  const invalidRows: ParsedImportRow[] = [];

  rawData.forEach((row, index) => {
    const rowNum = index + 2; // considering 1-indexed row with header
    const errors: string[] = [];

    // Map column aliases
    const date = String(row['Date (YYYY-MM-DD)'] || row['Date'] || '').trim();
    const machineId = String(row['Machine ID'] || row['Machine'] || '').trim().toUpperCase();
    const projectId = String(row['Project ID'] || row['Project'] || '').trim().toUpperCase();
    const operatorId = String(row['Operator ID'] || row['Operator'] || '').trim().toUpperCase();
    const startTime = String(row['Start Time (HH:mm)'] || row['Start Time'] || row['Start'] || '').trim();
    const endTime = String(row['End Time (HH:mm)'] || row['End Time'] || row['End'] || '').trim();
    const idleMinutes = parseInt(String(row['Idle Minutes'] || row['Idle'] || '0'), 10) || 0;
    const remarks = String(row['Remarks'] || row['Description'] || '').trim();

    // Validation
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push('Date must be in YYYY-MM-DD format');
    }

    if (!machineId) {
      errors.push('Machine ID is required');
    } else if (!validMachineIds.has(machineId)) {
      errors.push(`Machine '${machineId}' does not exist in Asset Master`);
    }

    if (!projectId) {
      errors.push('Project ID is required');
    } else if (!validProjectIds.has(projectId)) {
      errors.push(`Project '${projectId}' does not exist in Project Master`);
    }

    if (operatorId && !validOperatorIds.has(operatorId)) {
      errors.push(`Operator ID '${operatorId}' not recognized`);
    }

    if (!startTime || !/^\d{1,2}:\d{2}$/.test(startTime)) {
      errors.push('Start Time must be HH:mm format');
    }

    if (!endTime || !/^\d{1,2}:\d{2}$/.test(endTime)) {
      errors.push('End Time must be HH:mm format');
    }

    if (idleMinutes < 0) {
      errors.push('Idle duration cannot be negative');
    }

    const parsedRow: ParsedImportRow = {
      rowNumber: rowNum,
      date,
      machineId,
      projectId,
      operatorId,
      startTime,
      endTime,
      idleMinutes,
      remarks,
      isValid: errors.length === 0,
      errors,
    };

    if (errors.length === 0) {
      validRows.push(parsedRow);
    } else {
      invalidRows.push(parsedRow);
    }
  });

  return {
    totalRows: rawData.length,
    validRows,
    invalidRows,
  };
}

/**
 * Export machine working logs with calculated totals
 */
export function exportMachineWorkingLogs(logs: MachineWorkingLog[], machines: MachineAsset[], projects: Project[]) {
  const machineMap = new Map(machines.map((m) => [m.id, `${m.assetId} (${m.make} ${m.model})`]));
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  const rows = logs.map((log) => ({
    'Log ID': log.id,
    'Date': formatDateDDMMYYYY(log.date),
    'Machine': machineMap.get(log.machineId) || log.machineId,
    'Project': projectMap.get(log.projectId) || log.projectId,
    'Operator Code': log.operatorId,
    'Start Time': log.startTime,
    'End Time': log.endTime,
    'Idle (Min)': log.idleMinutes,
    'Net Working Hours': log.workingHours,
    'Approval Status': log.approvalStatus,
    'Remarks': log.remarks || '',
  }));

  const totalHours = logs.reduce((sum, l) => sum + l.workingHours, 0);
  rows.push({
    'Log ID': 'TOTAL',
    'Date': '',
    'Machine': '',
    'Project': '',
    'Operator Code': '',
    'Start Time': '',
    'End Time': '',
    'Idle (Min)': logs.reduce((sum, l) => sum + l.idleMinutes, 0),
    'Net Working Hours': totalHours,
    'Approval Status': '-' as any,
    'Remarks': `Total Hours Recorded: ${totalHours} hrs`,
  });

  exportToXLSX(rows, `Skyhook_Machine_Working_Report_${new Date().toISOString().split('T')[0]}`);
}

/**
 * Export Payroll Summary report to Excel
 */
export function exportPayrollSummary(run: PayrollRun) {
  const rows = run.entries.map((e) => ({
    'Employee Code': e.employeeCode,
    'Employee Name': e.employeeName,
    'Designation': e.designation,
    'Salary Type': e.salaryType.toUpperCase(),
    'Daily / Base Rate': formatINR(e.appliedDailyRate || e.appliedMonthlyRate),
    'Payable Days': e.payableDays,
    'Base Salary': formatINR(e.baseSalary),
    'OT Hours': e.totalOtHours,
    'OT Amount': formatINR(e.otAmount),
    'Custom Pay': formatINR((e.customPay ?? []).reduce((s, a) => s + a.amount, 0)),
    'Custom Deductions': formatINR((e.customDeductions ?? []).reduce((s, a) => s + a.amount, 0)),
    'Gross Salary': formatINR(e.grossSalary),
    'Advance Recovered': formatINR(e.advanceRecovery),
    'Other Deductions': formatINR(e.otherDeductions),
    'Net Payable': formatINR(e.netSalary),
    'Payment Status': e.paymentStatus.toUpperCase(),
  }));

  // Summary Row
  rows.push({
    'Employee Code': 'TOTAL',
    'Employee Name': `${run.employeeCount} Employees`,
    'Designation': '',
    'Salary Type': '',
    'Daily / Base Rate': '',
    'Payable Days': run.entries.reduce((s, e) => s + e.payableDays, 0),
    'Base Salary': formatINR(run.totalBaseSalary),
    'OT Hours': run.entries.reduce((s, e) => s + e.totalOtHours, 0),
    'OT Amount': formatINR(run.totalOvertimeSalary),
    'Custom Pay': formatINR(run.entries.reduce((s, e) => s + (e.customPay ?? []).reduce((t, a) => t + a.amount, 0), 0)),
    'Custom Deductions': formatINR(run.entries.reduce((s, e) => s + (e.customDeductions ?? []).reduce((t, a) => t + a.amount, 0), 0)),
    'Gross Salary': formatINR(run.totalGrossSalary),
    'Advance Recovered': formatINR(run.totalAdvancesRecovered),
    'Other Deductions': formatINR(run.totalOtherDeductions),
    'Net Payable': formatINR(run.totalNetSalary),
    'Payment Status': run.status.toUpperCase(),
  });

  exportToXLSX(rows, `Skyhook_Payroll_${run.month}_Report`);
}

/**
 * Export Project Expenses to Excel
 */
export function exportProjectExpenses(expenses: ProjectExpense[], projects: Project[]) {
  const prjMap = new Map(projects.map((p) => [p.id, p.name]));
  const rows = expenses.map((exp) => ({
    'Expense ID': exp.expenseId || exp.id,
    'Date': formatDateDDMMYYYY(exp.date),
    'Project': prjMap.get(exp.projectId) || exp.projectId,
    'Category': exp.category,
    'Description': exp.description,
    'Amount (₹)': exp.amount,
    'Paid By': exp.paidBy,
    'Payment Mode': exp.paymentMode.replace('_', ' ').toUpperCase(),
    'Vendor': exp.vendor || '-',
    'Receipt No': exp.receiptNumber || '-',
    'Status': exp.approvalStatus.toUpperCase(),
  }));

  const totalAmount = expenses.reduce((s, e) => s + e.amount, 0);
  rows.push({
    'Expense ID': 'TOTAL',
    'Date': '',
    'Project': '',
    'Category': '',
    'Description': 'Total Expenses',
    'Amount (₹)': totalAmount,
    'Paid By': '',
    'Payment Mode': '',
    'Vendor': '',
    'Receipt No': '',
    'Status': '',
  });

  exportToXLSX(rows, `Skyhook_Expenses_Report_${new Date().toISOString().split('T')[0]}`);
}
