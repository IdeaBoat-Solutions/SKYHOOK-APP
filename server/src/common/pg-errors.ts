/**
 * Translate PostgreSQL errors into readable client errors (409 / 422), so the UI never
 * shows a raw SQL message and a duplicate or bad reference is explained in plain words.
 * Kept byte-for-byte in sync with supabase/functions/_shared/pg-errors.ts.
 */
import { ApiError } from './errors.js';

/** Table -> singular noun used in messages. */
const ENTITY: Record<string, string> = {
  machines: 'machine', employees: 'employee', projects: 'project', users: 'user',
  expenses: 'expense', salary_advances: 'advance', emi_loans: 'EMI loan', emi_installments: 'EMI instalment',
  attendance_records: 'attendance record', payroll_runs: 'payroll run', payroll_entries: 'payroll entry',
  machine_working_logs: 'machine working log', payroll_adjustments: 'payroll adjustment',
  documents: 'document', personal_records: 'personal record', roles: 'role', holidays: 'holiday',
  advance_recoveries: 'advance recovery', payroll_ot_breakdowns: 'payroll overtime line',
};

/** Column -> label used in messages. */
const COLUMN: Record<string, string> = {
  registration_number: 'registration number', asset_code: 'asset code', employee_code: 'employee code',
  project_code: 'project code', expense_code: 'expense code', advance_code: 'advance code', loan_code: 'loan code',
  run_code: 'run code', email: 'email', name: 'name', mobile: 'mobile number', month: 'month',
  holiday_date: 'date', installment_number: 'instalment number', serial_number: 'serial number',
};

const REFERENCE: Record<string, string> = {
  project_id: 'project', operator_id: 'operator', employee_id: 'employee', machine_id: 'machine',
  current_project_id: 'project', assigned_operator_id: 'operator', current_machine_id: 'machine',
  loan_id: 'EMI loan', advance_id: 'advance', payroll_run_id: 'payroll run', manager_id: 'manager',
};

function parseKey(detail: string | undefined): { cols: string[]; vals: string[] } | null {
  const m = detail?.match(/Key \((.+?)\)=\((.*)\)/s);
  if (!m) return null;
  return { cols: m[1]!.split(',').map((s) => s.trim()), vals: m[2]!.split(',').map((s) => s.trim()) };
}

/** Returns an ApiError for a known PostgreSQL error, or null when the error is not a data error. */
export function mapPgError(err: unknown): ApiError | null {
  const e = err as { code?: string; detail?: string; table?: string; column?: string; constraint?: string; message?: string };
  if (!e || typeof e.code !== 'string' || !/^[0-9A-Z]{5}$/.test(e.code)) return null;
  const entity = (e.table && ENTITY[e.table]) || 'record';
  const article = /^[aeiou]/i.test(entity) ? 'An' : 'A';

  switch (e.code) {
    case '23505': { // unique_violation
      const key = parseKey(e.detail);
      const cols = key ? key.cols.filter((c) => c !== 'tenant_id') : [];
      const vals = key ? key.vals.filter((_, i) => key.cols[i] !== 'tenant_id') : [];
      if (cols.includes('operator_id') && cols.includes('attendance_date')) {
        return new ApiError(409, 'conflict', 'Conflict', 'Attendance for this operator on this date already exists');
      }
      if (cols.length === 1 && cols[0] && COLUMN[cols[0]]) {
        return new ApiError(409, 'conflict', 'Conflict',
          `${article} ${entity} with ${COLUMN[cols[0]]} ${vals[0] ?? ''} already exists`.replace(/\s+/g, ' '));
      }
      return new ApiError(409, 'conflict', 'Conflict', `${article} ${entity} with the same ${cols.map((c) => COLUMN[c] ?? c.replace(/_/g, ' ')).join(' and ') || 'details'} already exists`);
    }
    case '23503': { // foreign_key_violation
      const key = parseKey(e.detail);
      if (/is still referenced/i.test(e.detail ?? '')) {
        const from = e.detail?.match(/from table "([^"]+)"/)?.[1];
        const what = (from && ENTITY[from]) || from?.replace(/_/g, ' ') || 'other records';
        return new ApiError(409, 'conflict', 'Conflict', `This ${entity} is in use by ${what} and cannot be removed or changed this way`);
      }
      const col = key?.cols.find((c) => c !== 'tenant_id');
      const ref = (col && REFERENCE[col]) || col?.replace(/_id$/, '').replace(/_/g, ' ') || 'record';
      return new ApiError(422, 'validation-failed', 'Validation failed', `The selected ${ref} does not exist. Reload the page and choose it again`,
        [{ field: col ?? '(root)', message: `The selected ${ref} does not exist` }]);
    }
    case '23502': { // not_null_violation
      const col = e.column ?? 'value';
      return new ApiError(422, 'validation-failed', 'Validation failed', `${col.replace(/_/g, ' ')} is required`, [{ field: col, message: 'Required' }]);
    }
    case '23514': // check_violation
      return new ApiError(422, 'validation-failed', 'Validation failed',
        `A value is outside the allowed range (${(e.constraint ?? 'check').replace(/_check$/, '').replace(/_/g, ' ')})`);
    case '22007': case '22008': // invalid datetime format / field overflow
      return new ApiError(422, 'validation-failed', 'Validation failed', 'A date or time value is not valid. Use dd/mm/yyyy dates and HH:mm times');
    case '22P02': // invalid_text_representation (bad enum/uuid/number)
      return new ApiError(422, 'validation-failed', 'Validation failed', 'One of the values sent is not valid for its field');
    case '22003': // numeric_value_out_of_range
      return new ApiError(422, 'validation-failed', 'Validation failed', 'A number is too large');
    case '22001': // string_data_right_truncation
      return new ApiError(422, 'validation-failed', 'Validation failed', 'A text value is too long');
    case '22012': // division_by_zero
      return new ApiError(422, 'validation-failed', 'Validation failed', 'A value of zero is not allowed here');
    default:
      return null;
  }
}
