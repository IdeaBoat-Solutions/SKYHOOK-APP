import type { PoolClient } from 'pg';
import * as XLSX from 'xlsx';
import { formatDateDDMMYYYY } from '../../domain/format.js';

export type ExportKind = 'payroll' | 'expenses' | 'attendance' | 'assets' | 'workforce' | 'machine_hours';

const money = (paise: number | null | undefined) => `₹${((paise ?? 0) / 100).toLocaleString('en-IN')}`;

export async function buildExport(
  c: PoolClient,
  tenantId: string,
  kind: ExportKind,
  params: Record<string, unknown>,
): Promise<Buffer> {
  let rows: Record<string, unknown>[] = [];
  let sheet = 'Report';

  if (kind === 'payroll') {
    const month = String(params.month ?? '');
    const r = await c.query(
      `SELECT e.employee_code, e.employee_name, e.designation, e.payable_days, e.base_paise, e.ot_paise,
              e.gross_paise, e.advance_recovery_paise, e.net_paise, e.payment_status
       FROM payroll_entries e JOIN payroll_runs r ON r.id=e.payroll_run_id
       WHERE e.tenant_id=$1 AND to_char(r.month,'YYYY-MM')=$2 ORDER BY e.employee_code`,
      [tenantId, month],
    );
    rows = r.rows.map((x: any) => ({
      'Employee Code': x.employee_code, 'Name': x.employee_name, 'Designation': x.designation,
      'Payable Days': x.payable_days, 'Base': money(x.base_paise), 'Overtime': money(x.ot_paise),
      'Gross': money(x.gross_paise), 'Advance Recovered': money(x.advance_recovery_paise),
      'Net Payable': money(x.net_paise), 'Status': x.payment_status,
    }));
    sheet = 'Payroll';
  } else if (kind === 'expenses') {
    const r = await c.query(
      `SELECT e.expense_code, e.expense_date, p.name AS project, e.category, e.description, e.amount_paise,
              e.payment_mode, e.vendor, e.approval_status
       FROM project_expenses e JOIN projects p ON p.id=e.project_id
       WHERE e.tenant_id=$1 ORDER BY e.expense_date DESC`, [tenantId],
    );
    rows = r.rows.map((x: any) => ({
      'Expense ID': x.expense_code, 'Date': formatDateDDMMYYYY(x.expense_date), 'Project': x.project,
      'Category': x.category, 'Description': x.description, 'Amount': money(x.amount_paise),
      'Mode': x.payment_mode, 'Vendor': x.vendor ?? '-', 'Status': x.approval_status,
    }));
    sheet = 'Expenses';
  } else if (kind === 'attendance') {
    const r = await c.query(
      `SELECT a.attendance_date, e.employee_code, e.full_name, p.name AS project, a.status,
              a.net_working_hours, a.overtime_hours, a.ot_rate_paise_per_hour, a.approval_status
       FROM attendance_records a JOIN employees e ON e.id=a.operator_id JOIN projects p ON p.id=a.project_id
       WHERE a.tenant_id=$1 ORDER BY a.attendance_date DESC`, [tenantId],
    );
    rows = r.rows.map((x: any) => ({
      'Date': formatDateDDMMYYYY(x.attendance_date), 'Code': x.employee_code, 'Name': x.full_name,
      'Project': x.project, 'Status': x.status, 'Hours': x.net_working_hours, 'OT Hours': x.overtime_hours,
      'OT Rate': money(x.ot_rate_paise_per_hour), 'Approval': x.approval_status,
    }));
    sheet = 'Attendance';
  } else if (kind === 'assets') {
    const r = await c.query('SELECT * FROM machines WHERE tenant_id=$1 ORDER BY asset_code', [tenantId]);
    rows = r.rows.map((x: any) => ({
      'Asset ID': x.asset_code, 'Type': x.machine_type, 'Make': x.make, 'Model': x.model,
      'Registration': x.registration_number, 'Capacity (T)': x.tonnage_capacity, 'Status': x.status,
      'Service Due': x.service_frequency_unit === 'hours'
        ? `Every ${x.service_frequency_value} operating hours`
        : formatDateDDMMYYYY(x.next_service_due_date),
      'Insurance Expiry': formatDateDDMMYYYY(x.insurance_expiry_date),
      'PUC Expiry': formatDateDDMMYYYY(x.puc_expiry_date),
      'Fitness Due': formatDateDDMMYYYY(x.next_fitness_due_date),
    }));
    sheet = 'Assets';
  } else if (kind === 'workforce') {
    const r = await c.query('SELECT * FROM employees WHERE tenant_id=$1 ORDER BY employee_code', [tenantId]);
    rows = r.rows.map((x: any) => ({
      'Code': x.employee_code, 'Name': x.full_name, 'Type': x.employee_type, 'Designation': x.designation,
      'Salary Type': x.salary_type, 'Daily Rate': money(x.daily_rate_paise),
      'Monthly Salary': money(x.monthly_salary_paise), 'Status': x.status,
      'Licence Expiry': formatDateDDMMYYYY(x.crane_license_expiry),
    }));
    sheet = 'Workforce';
  } else if (kind === 'machine_hours') {
    const r = await c.query(
      `SELECT l.log_date, m.asset_code, p.name AS project, l.operator_id, l.start_time, l.end_time,
              l.idle_minutes, l.working_hours
       FROM machine_working_logs l JOIN machines m ON m.id=l.machine_id JOIN projects p ON p.id=l.project_id
       WHERE l.tenant_id=$1 ORDER BY l.log_date DESC`, [tenantId],
    );
    rows = r.rows.map((x: any) => ({
      'Date': formatDateDDMMYYYY(x.log_date), 'Machine': x.asset_code, 'Project': x.project,
      'Operator': x.operator_id, 'Start': x.start_time, 'End': x.end_time,
      'Idle (min)': x.idle_minutes, 'Working Hours': x.working_hours,
    }));
    sheet = 'Machine Hours';
  }

  if (rows.length === 0) rows = [{ 'Info': 'No records found' }];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
