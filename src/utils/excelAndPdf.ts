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

/** Local calendar date as yyyy-mm-dd (never the UTC date, which is yesterday for part of every IST morning). */
const localISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Generates and downloads the Machine Working Log import template. The example rows
 * use today's date and, when given, the first real machines / projects / operators so
 * the sheet imports as-is; otherwise they carry obvious placeholder codes.
 */
export function downloadMachineWorkingTemplate(
  machines: MachineAsset[] = [],
  projects: Project[] = [],
  employees: Employee[] = [],
) {
  const today = formatDateDDMMYYYY(localISO());
  const operators = employees.filter((e) => e.employeeType === 'operator');
  const examples = [
    { start: '08:00', end: '18:00', remarks: 'Example: day shift' },
    { start: '20:00', end: '06:00', remarks: 'Example: night shift' },
    { start: '09:00', end: '13:30', remarks: 'Example: part-day duty' },
  ];
  const templateRows = examples.map((ex, i) => ({
    'Date (DD/MM/YYYY)': today,
    'Machine ID': machines[i % Math.max(1, machines.length)]?.assetId ?? 'CR-001',
    'Project ID': projects[0]?.projectId ?? 'PRJ-001',
    'Operator ID': operators[i % Math.max(1, operators.length)]?.employeeId ?? '',
    'Start Time (HH:mm)': ex.start,
    'End Time (HH:mm)': ex.end,
    'Remarks': ex.remarks,
  }));

  exportToXLSX(templateRows, 'Skyhook_Machine_Working_Import_Template', 'WorkingLogsTemplate');
}

export interface ParsedImportRow {
  rowNumber: number;
  /** yyyy-mm-dd */
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
  /** Database ids the readable codes above resolved to. */
  resolved?: { machineId: string; projectId: string; operatorId: string };
}

export interface ImportValidationResult {
  totalRows: number;
  validRows: ParsedImportRow[];
  invalidRows: ParsedImportRow[];
}

/** Excel date cell (serial number), dd/mm/yyyy, dd-mm-yyyy or yyyy-mm-dd -> yyyy-mm-dd, or '' if it is not a real date. */
function normaliseSheetDate(value: unknown): string {
  const valid = (y: number, m: number, d: number) => {
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return '';
    if (new Date(Date.UTC(y, m - 1, d)).getUTCMonth() !== m - 1) return '';
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  if (value instanceof Date) return valid(value.getFullYear(), value.getMonth() + 1, value.getDate());
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const text = String(value ?? '').trim();
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return valid(Number(m[3]), Number(m[2]), Number(m[1]));
  return '';
}

/** Time cell: "8:30", "08:30:00" or an Excel time fraction (0.354166) -> "HH:mm", or '' if invalid. */
function normaliseSheetTime(value: unknown): string {
  const fmt = (h: number, min: number) =>
    h >= 0 && h < 24 && min >= 0 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : '';
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
    const total = Math.round(value * 1440) % 1440;
    return fmt(Math.floor(total / 60), total % 60);
  }
  const m = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*$/);
  return m ? fmt(Number(m[1]), Number(m[2])) : '';
}

/**
 * Parses and validates an uploaded XLSX file for Machine Working logs.
 * Machines, projects and operators are given by readable code (CR-001, PRJ-001, OP-001;
 * a machine may also be given by registration number and an operator by full name) and
 * are resolved to database ids here. Rows that duplicate an existing log are rejected.
 */
export async function parseMachineWorkingExcel(
  file: File,
  validMachines: MachineAsset[],
  validProjects: Project[],
  validEmployees: Employee[],
  existingLogs: MachineWorkingLog[] = [],
): Promise<ImportValidationResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
  if (!worksheet) throw new Error('The workbook has no sheets');

  // Convert raw sheet to JSON objects
  const rawData: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();
  const machineByCode = new Map<string, MachineAsset>();
  for (const m of validMachines) {
    machineByCode.set(norm(m.assetId), m);
    machineByCode.set(norm(m.registrationNumber), m);
  }
  const projectByCode = new Map<string, Project>();
  for (const p of validProjects) {
    projectByCode.set(norm(p.projectId || p.id), p);
    projectByCode.set(norm(p.name), p);
  }
  // Operators can be given by code (OP-001) or by name.
  const employeeByCode = new Map<string, Employee>();
  for (const e of validEmployees) {
    employeeByCode.set(norm(e.employeeId || e.id), e);
    employeeByCode.set(norm(e.fullName), e);
  }

  const seen = new Set(existingLogs.map((l) => `${l.machineId}|${l.date}|${(l.startTime || '').slice(0, 5)}|${(l.endTime || '').slice(0, 5)}`));

  const validRows: ParsedImportRow[] = [];
  const invalidRows: ParsedImportRow[] = [];

  rawData.forEach((row, index) => {
    const rowNum = index + 2; // considering 1-indexed row with header
    const errors: string[] = [];
    const cell = (...names: string[]) => {
      for (const n of names) if (row[n] !== undefined && row[n] !== '') return row[n];
      return '';
    };

    // Map column aliases (the template header first, then older / hand-made variants)
    const rawDate = cell('Date (DD/MM/YYYY)', 'Date (YYYY-MM-DD)', 'Date');
    const date = normaliseSheetDate(rawDate);
    const machineId = norm(cell('Machine ID', 'Machine'));
    const projectId = norm(cell('Project ID', 'Project'));
    const operatorId = norm(cell('Operator ID', 'Operator'));
    const rawStart = cell('Start Time (HH:mm)', 'Start Time', 'Start');
    const rawEnd = cell('End Time (HH:mm)', 'End Time', 'End');
    const startTime = normaliseSheetTime(rawStart);
    const endTime = normaliseSheetTime(rawEnd);
    const idleMinutes = parseInt(String(cell('Idle Minutes', 'Idle') || '0'), 10) || 0;
    const remarks = String(cell('Remarks', 'Description')).trim();

    // A completely blank spreadsheet row is not an error.
    if (!rawDate && !machineId && !projectId && !rawStart && !rawEnd) return;

    // Validation
    if (!date) errors.push('Date must be a real date, e.g. 21/11/2026');

    const machine = machineId ? machineByCode.get(machineId) : undefined;
    if (!machineId) errors.push('Machine ID is required');
    else if (!machine) errors.push(`Machine '${machineId}' does not exist in Asset Master`);

    const project = projectId ? projectByCode.get(projectId) : undefined;
    if (!projectId) errors.push('Project ID is required');
    else if (!project) errors.push(`Project '${projectId}' does not exist in Project Master`);

    const operator = operatorId ? employeeByCode.get(operatorId) : undefined;
    if (operatorId && !operator) errors.push(`Operator '${operatorId}' not recognized`);

    if (!startTime) errors.push('Start Time must be HH:mm (24-hour)');
    if (!endTime) errors.push('End Time must be HH:mm (24-hour)');
    if (startTime && endTime && startTime === endTime) errors.push('Start and end time are the same');

    if (idleMinutes < 0) {
      errors.push('Idle duration cannot be negative');
    }

    if (errors.length === 0 && machine) {
      const key = `${machine.id}|${date}|${startTime}|${endTime}`;
      if (seen.has(key)) errors.push('Duplicate: this machine already has a log for that date and time');
      else seen.add(key);
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
      resolved: machine && project ? { machineId: machine.id, projectId: project.id, operatorId: operator?.id ?? '' } : undefined,
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
export function exportMachineWorkingLogs(
  logs: MachineWorkingLog[],
  machines: MachineAsset[],
  projects: Project[],
  employees: Employee[] = [],
) {
  const operatorMap = new Map(employees.map((e) => [e.id, e.fullName]));
  const machineMap = new Map(machines.map((m) => [m.id, `${m.assetId} (${m.make} ${m.model})`]));
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  const rows = logs.map((log) => ({
    'Log ID': log.id,
    'Date': formatDateDDMMYYYY(log.date),
    'Machine': machineMap.get(log.machineId) || log.machineId,
    'Project': projectMap.get(log.projectId) || log.projectId,
    'Operator': operatorMap.get(log.operatorId) || '',
    'Start Time': log.startTime,
    'End Time': log.endTime,
    'Total Hours': log.workingHours,
    'Approval Status': log.approvalStatus,
    'Remarks': log.remarks || '',
  }));

  const totalHours = logs.reduce((sum, l) => sum + l.workingHours, 0);
  rows.push({
    'Log ID': 'TOTAL',
    'Date': '',
    'Machine': '',
    'Project': '',
    'Operator': '',
    'Start Time': '',
    'End Time': '',
    'Total Hours': totalHours,
    'Approval Status': '-' as any,
    'Remarks': `Total Hours Recorded: ${totalHours} hrs`,
  });

  exportToXLSX(rows, `Skyhook_Machine_Working_Report_${localISO()}`);
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

  exportToXLSX(rows, `Skyhook_Expenses_Report_${localISO()}`);
}
