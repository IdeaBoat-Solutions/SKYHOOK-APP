/**
 * Browser-persisted extensions for features that the current API does not model:
 * machine servicing in operating hours, custom payroll pay/deductions and the
 * owner's private Personal vault. Kept in one place so every view reads the
 * same values and data survives reloads without a backend migration.
 */
import type {
  MachineAsset,
  PayrollRun,
  PayrollAdjustment,
  PersonalRecord,
  ServiceRecord,
} from '../types';

const PREFIX = 'skyhook:extras:';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable — keep running with in-memory values */
  }
}

/* -------------------------------------------------------------------------- */
/* Machine servicing (operating hours)                                         */
/* -------------------------------------------------------------------------- */

export interface MachineServiceConfig {
  serviceFrequencyUnit: 'days' | 'months' | 'hours';
  serviceFrequencyValue: number;
  /** Cumulative operating-hour reading at the last service. */
  lastServiceHours: number;
  serviceReminderLeadHours: number;
  serviceHistory: ServiceRecord[];
}

const SERVICE_KEY = 'machine_service_configs';

export function getMachineServiceConfigs(): Record<string, MachineServiceConfig> {
  return read<Record<string, MachineServiceConfig>>(SERVICE_KEY, {});
}

export function getMachineServiceConfig(
  machineId: string,
  machine?: MachineAsset,
): MachineServiceConfig {
  const defaults: MachineServiceConfig = {
    serviceFrequencyUnit: machine?.serviceFrequencyUnit ?? 'days',
    serviceFrequencyValue: machine?.serviceFrequencyValue ?? 60,
    lastServiceHours: machine?.lastServiceHours ?? 0,
    serviceReminderLeadHours: machine?.serviceReminderLeadHours ?? 50,
    serviceHistory: machine?.serviceHistory ?? [],
  };
  return { ...defaults, ...(getMachineServiceConfigs()[machineId] ?? {}) };
}

export function saveMachineServiceConfig(
  machineId: string,
  patch: Partial<MachineServiceConfig>,
): void {
  const all = getMachineServiceConfigs();
  all[machineId] = { ...(all[machineId] ?? {}), ...patch } as MachineServiceConfig;
  write(SERVICE_KEY, all);
}

/** Merge locally saved servicing settings onto an API-mapped machine. */
export function applyMachineServiceConfig(machine: MachineAsset): MachineAsset {
  const cfg = getMachineServiceConfig(machine.id, machine);
  return {
    ...machine,
    serviceFrequencyUnit: cfg.serviceFrequencyUnit,
    serviceFrequencyValue: cfg.serviceFrequencyValue,
    lastServiceHours: cfg.lastServiceHours,
    serviceReminderLeadHours: cfg.serviceReminderLeadHours,
    serviceHistory: cfg.serviceHistory,
  };
}

/* -------------------------------------------------------------------------- */
/* Custom pay & deductions                                                     */
/* -------------------------------------------------------------------------- */

export interface PayrollAdjustmentSet {
  pay: PayrollAdjustment[];
  deductions: PayrollAdjustment[];
}

const ADJUSTMENTS_KEY = 'payroll_adjustments';

/** Keyed by month + employee code so edits survive a payroll recalculation. */
export function payrollAdjustmentKey(month: string, employeeCode: string): string {
  return `${month}:${employeeCode}`;
}

export function getPayrollAdjustments(): Record<string, PayrollAdjustmentSet> {
  return read<Record<string, PayrollAdjustmentSet>>(ADJUSTMENTS_KEY, {});
}

export function savePayrollAdjustment(
  key: string,
  type: 'pay' | 'deduction',
  adjustment: PayrollAdjustment,
): void {
  const all = getPayrollAdjustments();
  const set = all[key] ?? { pay: [], deductions: [] };
  if (type === 'pay') set.pay = [...set.pay, adjustment];
  else set.deductions = [...set.deductions, adjustment];
  all[key] = set;
  write(ADJUSTMENTS_KEY, all);
}

export function removePayrollAdjustment(
  key: string,
  type: 'pay' | 'deduction',
  id: string,
): void {
  const all = getPayrollAdjustments();
  const set = all[key] ?? { pay: [], deductions: [] };
  if (type === 'pay') set.pay = set.pay.filter((a) => a.id !== id);
  else set.deductions = set.deductions.filter((a) => a.id !== id);
  all[key] = set;
  write(ADJUSTMENTS_KEY, all);
}

const sum = (items: PayrollAdjustment[]) =>
  items.reduce((total, item) => total + (Number(item.amount) || 0), 0);

/** Apply custom lines to a server-generated run for display, slips and export. */
export function withPayrollAdjustments(run: PayrollRun): PayrollRun {
  const all = getPayrollAdjustments();
  const entries = run.entries.map((entry) => {
    const set = all[payrollAdjustmentKey(run.month, entry.employeeCode)] ?? {
      pay: [],
      deductions: [],
    };
    const customPayTotal = sum(set.pay);
    const customDeductionTotal = sum(set.deductions);
    const allowances = (entry.allowances || 0) + customPayTotal;
    const grossSalary = entry.baseSalary + entry.otAmount + allowances;
    const otherDeductions = (entry.otherDeductions || 0) + customDeductionTotal;
    const totalDeductions = (entry.advanceRecovery || 0) + otherDeductions;
    const netSalary = Math.max(0, grossSalary - totalDeductions);
    return {
      ...entry,
      allowances,
      grossSalary,
      otherDeductions,
      totalDeductions,
      netSalary,
      customPay: set.pay,
      customDeductions: set.deductions,
    };
  });

  const totalCustomPay = entries.reduce((t, e) => t + sum(e.customPay ?? []), 0);
  const totalCustomDeductions = entries.reduce(
    (t, e) => t + sum(e.customDeductions ?? []),
    0,
  );

  return {
    ...run,
    entries,
    totalAllowances: run.totalAllowances + totalCustomPay,
    totalGrossSalary: run.totalGrossSalary + totalCustomPay,
    totalOtherDeductions: run.totalOtherDeductions + totalCustomDeductions,
    totalNetSalary: run.totalNetSalary + totalCustomPay - totalCustomDeductions,
  };
}

/* -------------------------------------------------------------------------- */
/* Owner Personal vault                                                        */
/* -------------------------------------------------------------------------- */

const PIN_KEY = 'personal_pin_hash';
const PERSONAL_KEY = 'personal_records';

/** Small non-cryptographic digest — this lock protects the local browser view,
 *  it is not a substitute for the account password or server-side RBAC. */
export function hashPin(pin: string): string {
  let hash = 5381;
  const input = `skyhook-personal-v1:${pin}`;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function getPinHash(): string | null {
  try {
    return localStorage.getItem(PREFIX + PIN_KEY);
  } catch {
    return null;
  }
}

export function setPinHash(pin: string): void {
  try {
    localStorage.setItem(PREFIX + PIN_KEY, hashPin(pin));
  } catch {
    /* ignore */
  }
}

export function verifyPin(pin: string): boolean {
  const stored = getPinHash();
  return Boolean(stored && stored === hashPin(pin));
}

export function getPersonalRecords(): PersonalRecord[] {
  return read<PersonalRecord[]>(PERSONAL_KEY, []);
}

export function savePersonalRecords(records: PersonalRecord[]): void {
  write(PERSONAL_KEY, records);
}
