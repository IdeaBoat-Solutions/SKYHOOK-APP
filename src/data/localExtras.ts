/**
 * Pure helpers that do not persist business data in the browser.
 * Payroll adjustments, personal records and machine servicing now come from
 * the API; only the owner's local PIN lock remains in localStorage.
 */
import type {
  MachineAsset,
  PayrollRun,
  PayrollAdjustment,
  PersonalRecord,
  ServiceRecord,
} from '../types';

const PREFIX = 'skyhook:extras:';

/** Units offered by the calculator UI. */
export type CalcUnit = 'currency' | 'number' | 'percent' | 'hours' | 'litres' | 'km' | 'tonnes';

/* -------------------------------------------------------------------------- */
/* Custom pay & deductions                                                     */
/* -------------------------------------------------------------------------- */

export interface PayrollAdjustmentSet {
  pay: PayrollAdjustment[];
  deductions: PayrollAdjustment[];
}

/** Keyed by month + employee code so edits line up with a payroll entry. */
export function payrollAdjustmentKey(month: string, employeeCode: string): string {
  return `${month}:${employeeCode}`;
}

const sum = (items: PayrollAdjustment[]) =>
  items.reduce((total, item) => total + (Number(item.amount) || 0), 0);

/** Apply API-backed custom lines to a server-generated run for display, slips and export. */
export function withPayrollAdjustments(
  run: PayrollRun,
  adjustments: Record<string, PayrollAdjustmentSet>,
): PayrollRun {
  const entries = run.entries.map((entry) => {
    const set = adjustments[payrollAdjustmentKey(run.month, entry.employeeCode)] ?? {
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
/* Owner Personal vault PIN lock                                               */
/* -------------------------------------------------------------------------- */

const PIN_KEY = 'personal_pin_hash';

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

/* -------------------------------------------------------------------------- */
/* Machine servicing + owner records — still local until their API cutover.    */
/* -------------------------------------------------------------------------- */

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

export interface MachineServiceConfig {
  serviceFrequencyUnit: 'days' | 'months' | 'hours';
  serviceFrequencyValue: number;
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

const PERSONAL_KEY = 'personal_records';

export function getPersonalRecords(): PersonalRecord[] {
  return read<PersonalRecord[]>(PERSONAL_KEY, []);
}

export function savePersonalRecords(records: PersonalRecord[]): void {
  write(PERSONAL_KEY, records);
}
