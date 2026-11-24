/**
 * API-backed implementation of the Skyhook store.
 * Drop-in replacement for ./store.tsx — same context interface, server as source of truth.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CompanySettings, User, UserRole, Employee, Project, AttendanceRecord, AttendanceStatus,
  SalaryAdvance, PayrollRun, ProjectExpense, MachineAsset, MachineEmiLoan, MachineWorkingLog,
  AuditLog, ReminderAlertItem, InAppNotification, PayrollAdjustment, PersonalRecord, DocumentRecord,
  ContractorRecord, ExtractedDocument,
} from '../types';
import { api, getToken, setToken, ApiFailure } from '../api/client';
import {
  mapUser, mapCompany, mapProject, mapEmployee, mapMachine, mapAttendance, mapAdvance,
  mapPayrollRun, mapExpense, mapEmiLoan, mapWorkingLog, mapAudit, mapNotification,
  mapServiceRecord, mapPayrollAdjustment, mapPersonalRecord, rupeesToPaise,
  mapDocument, machineTypeToApi, mapContractor, mapExtractedDocument,
} from '../api/mappers';
import { evaluateReminderStatus, evaluateServiceHours, sumOperatingHours, formatServiceInterval } from '../utils/calculations';
import {
  getPinHash,
  setPinHash,
  verifyPin,
  payrollAdjustmentKey,
  withPayrollAdjustments,
} from './localExtras';
import type { PayrollAdjustmentSet } from './localExtras';

export { withPayrollAdjustments };

type StoredAdjustment = PayrollAdjustment & {
  month: string;
  employeeCode: string;
  type: 'pay' | 'deduction';
};

/** Map an API row to the shape the UI's adjustment helpers consume. */
function toStoredAdjustment(r: any): StoredAdjustment {
  return {
    ...mapPayrollAdjustment(r),
    month: r.month,
    employeeCode: r.employeeCode ?? r.employee_code,
    type: r.kind ?? r.type,
  };
}

/** Group API adjustments into the month:employeeCode shape the UI consumes. */
function groupAdjustments(items: any[]): Record<string, PayrollAdjustmentSet> {
  const out: Record<string, PayrollAdjustmentSet> = {};
  for (const raw of items) {
    const item = toStoredAdjustment(raw);
    const key = payrollAdjustmentKey(item.month, item.employeeCode);
    const set = out[key] ?? { pay: [], deductions: [] };
    if (item.type === 'pay') set.pay.push(item);
    else set.deductions.push(item);
    out[key] = set;
  }
  return out;
}

export interface RegisterInput {
  companyName: string;
  name: string;
  email: string;
  phone?: string;
  password: string;
}

interface SkyhookStoreContextType {
  currentUser: User;
  isAuthenticated: boolean;
  /** The server resolves the account and tenant; the client only sends credentials. */
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
  availableUsers: User[];
  updateUserRole: (userId: string, newRole: UserRole) => Promise<void>;
  addUser: (user: Omit<User, 'id'>) => Promise<User>;
  deleteUser: (userId: string) => Promise<void>;
  companySettings: CompanySettings;
  updateCompanySettings: (settings: Partial<CompanySettings>) => Promise<void>;
  projects: Project[];
  addProject: (p: Omit<Project, 'id'>) => Promise<Project>;
  updateProject: (id: string, p: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  employees: Employee[];
  addEmployee: (e: Omit<Employee, 'id'>) => Promise<Employee>;
  /** Upload a file to storage and register it as an employee document. */
  attachEmployeeDocument: (employeeId: string, file: File, docType: string, expiryDate?: string) => Promise<void>;
  updateEmployee: (id: string, e: Partial<Employee>) => Promise<void>;
  deactivateEmployee: (id: string) => Promise<void>;
  renewOperatorLicense: (operatorId: string, newCraneExpiry?: string, newTransportExpiry?: string) => Promise<void>;
  /** External/freelancer contacts for backup staffing — not workforce employees. */
  contractors: ContractorRecord[];
  addContractor: (c: Omit<ContractorRecord, 'id' | 'contractorCode' | 'createdAt'>) => Promise<ContractorRecord>;
  updateContractor: (id: string, patch: Partial<ContractorRecord>) => Promise<void>;
  deleteContractor: (id: string) => Promise<void>;
  machines: MachineAsset[];
  addMachine: (m: Omit<MachineAsset, 'id'>) => Promise<MachineAsset>;
  /** Upload a file to storage and register it as a machine document (e.g. the RC). */
  attachMachineDocument: (machineId: string, file: File, docType: string, expiryDate?: string) => Promise<void>;
  listMachineDocuments: (machineId: string) => Promise<DocumentRecord[]>;
  /** Download a stored document by its object key. */
  downloadDocument: (objectKey: string) => Promise<Blob>;
  /** Structured data extracted from the scanned PDFs, loaded from Supabase. */
  extractedDocuments: ExtractedDocument[];
  updateMachine: (id: string, m: Partial<MachineAsset>) => Promise<void>;
  recordServiceCompleted: (machineId: string, serviceDate: string, cost: number, notes?: string, provider?: string, operatingHours?: number) => Promise<void>;
  updateMachineServiceConfig: (machineId: string, patch: {
    serviceFrequencyUnit?: 'days' | 'months' | 'hours';
    serviceFrequencyValue?: number;
    lastServiceHours?: number;
    serviceReminderLeadHours?: number;
  }) => Promise<void>;
  renewMachineInsurance: (machineId: string, newExpiry: string, provider?: string, policyNo?: string, renewalDate?: string) => Promise<void>;
  renewMachinePuc: (machineId: string, newExpiry: string, pucNo?: string, renewalDate?: string) => Promise<void>;
  renewMachineFitness: (machineId: string, newExpiry: string, fitNo?: string, testPassedDate?: string) => Promise<void>;
  emiLoans: MachineEmiLoan[];
  addEmiLoan: (loan: Omit<MachineEmiLoan, 'id'>) => Promise<MachineEmiLoan>;
  recordEmiPayment: (loanId: string, installmentNumber: number, paymentMode: string, reference?: string) => Promise<void>;
  attendance: AttendanceRecord[];
  addAttendanceRecord: (record: any) => Promise<AttendanceRecord>;
  bulkAddAttendance: (records: AttendanceRecord[]) => Promise<void>;
  approveAttendanceRecord: (id: string) => Promise<void>;
  rejectAttendanceRecord: (id: string, reason?: string) => Promise<void>;
  /** params: operatorId, date, status, projectId?, machineId?, overtimeHours?, remarks?, and optional
   *  startTime / endTime (HH:mm, e.g. from the system clock) and unpaidBreakMinutes. */
  markOperatorAttendanceQuick: (params: any) => Promise<AttendanceRecord>;
  /** Optional startTime/endTime (HH:mm) override the default 08:00 shift layout. */
  markAllOperatorsPresent: (params: { date: string; projectId?: string; startTime?: string; endTime?: string }) => Promise<BulkMarkResult>;
  addOrUpdateOvertimeHours: (params: any) => Promise<AttendanceRecord>;
  advances: SalaryAdvance[];
  addAdvance: (adv: any) => Promise<SalaryAdvance>;
  approveAdvance: (id: string) => Promise<void>;
  payrollRuns: PayrollRun[];
  generatePayrollForMonth: (month: string) => Promise<PayrollRun>;
  approvePayrollRun: (id: string) => Promise<void>;
  markPayrollEntryPaid: (payrollRunId: string, entryId: string, paymentMode: string, ref?: string) => Promise<void>;
  expenses: ProjectExpense[];
  addExpense: (exp: any) => Promise<ProjectExpense>;
  approveExpense: (id: string) => Promise<void>;
  machineWorkingLogs: MachineWorkingLog[];
  addMachineWorkingLog: (log: any) => Promise<MachineWorkingLog>;
  importMachineWorkingLogs: (logs: any[]) => Promise<number>;
  auditLogs: AuditLog[];
  notifications: InAppNotification[];
  markNotificationRead: (id: string) => Promise<void>;
  getEmiAlerts: () => ReminderAlertItem[];
  getServiceAlerts: () => ReminderAlertItem[];
  getInsuranceAlerts: () => ReminderAlertItem[];
  getPucAlerts: () => ReminderAlertItem[];
  getFitnessAlerts: () => ReminderAlertItem[];
  getLicenseAlerts: () => ReminderAlertItem[];

  /** Custom payroll lines, keyed by `${month}:${employeeCode}`. */
  payrollAdjustments: Record<string, { pay: PayrollAdjustment[]; deductions: PayrollAdjustment[] }>;
  addPayrollAdjustment: (month: string, employeeCode: string, type: 'pay' | 'deduction', label: string, amount: number, remarks?: string) => Promise<void>;
  removePayrollAdjustment: (month: string, employeeCode: string, type: 'pay' | 'deduction', id: string) => Promise<void>;

  /** Owner-only Personal vault (PIN + private records). */
  personalPinSet: boolean;
  setPersonalPin: (pin: string) => Promise<void>;
  verifyPersonalPin: (pin: string) => boolean;
  personalRecords: PersonalRecord[];
  addPersonalRecord: (record: Omit<PersonalRecord, 'id' | 'createdAt'>) => Promise<PersonalRecord>;
  updatePersonalRecord: (id: string, patch: Partial<PersonalRecord>) => Promise<void>;
  deletePersonalRecord: (id: string) => Promise<void>;

  currentDate: string;
  resetToDemoData: () => Promise<void>;
}

/** Outcome of "mark all present": operators already marked that day are left alone. */
export interface BulkMarkResult {
  created: number;
  skipped: number;
  failed: { name: string; reason: string }[];
}

const Ctx = createContext<SkyhookStoreContextType | null>(null);

/** Today in the user's own timezone as yyyy-mm-dd (never UTC, which is a day behind in India early morning). */
export function todayISO(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The API only accepts real UUIDs; anything else (e.g. a display code like CR-001) must be dropped, not sent. */
const asUuid = (v?: string | null): string | undefined => (v && UUID_RE.test(v) ? v : undefined);
const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Request failed');

/** Resolve the operator / project / machine ids for an attendance write, or explain what is missing. */
function resolveAttendanceTarget(
  employees: Employee[], projects: Project[], operatorRef: string, projectId?: string, machineId?: string,
) {
  const emp = employees.find((e) => e.id === operatorRef || e.employeeId === operatorRef);
  const operatorId = asUuid(emp?.id ?? operatorRef);
  if (!operatorId) throw new Error('Operator not found. Reload the page and try again.');
  const project = asUuid(projectId) ?? asUuid(emp?.currentProjectId) ?? asUuid(projects[0]?.id);
  if (!project) {
    throw new Error(`No project to book attendance against for ${emp?.fullName ?? 'this operator'}. Create a project first.`);
  }
  return { emp, operatorId, projectId: project, machineId: asUuid(machineId) ?? asUuid(emp?.currentMachineId) };
}

/** Request body for a machine working log. The API needs real ids, never display codes like CR-001. */
function workingLogBody(log: any) {
  const machineId = asUuid(log.machineId);
  const projectId = asUuid(log.projectId);
  if (!machineId) throw new Error('Choose a machine from the list.');
  if (!projectId) throw new Error('Choose a project from the list.');
  return {
    date: log.date, machineId, projectId, operatorId: asUuid(log.operatorId),
    startTime: log.startTime, endTime: log.endTime,
    idleMinutes: Math.max(0, Math.round(Number(log.idleMinutes) || 0)), remarks: log.remarks || undefined,
  };
}

function assertNotLocked(attendance: AttendanceRecord[], operatorId: string, date: string, name?: string) {
  const existing = attendance.find((a) => a.operatorId === operatorId && a.date === date);
  if (existing?.approvalStatus === 'approved') {
    throw new Error(`${name ?? 'This operator'}'s attendance for ${date} is already approved and locked.`);
  }
}
const fallbackSettings: CompanySettings = {
  name: 'SKYHOOK', tagline: '', logoUrl: '', address: '', city: '', state: '', pincode: '',
  phone: '', email: '', gstNumber: '', authorizedSignatory: '', signatoryTitle: '',
  standardShiftHours: 10, payrollPaymentDay: 15, payrollCycleType: 'calendar_month', shortShiftPolicy: 'half_day_under_5',
  emiReminderLeadDays: 15, serviceReminderLeadDays: 15, insuranceReminderLeadDays: 15,
  pucReminderLeadDays: 15, fitnessReminderLeadDays: 15, licenseReminderLeadDays: 15,
};
const placeholderUser: User = { id: '', name: 'Loading…', email: '', role: 'owner' };

/** Add hours to an HH:mm time so the server can derive overtime from shift times. */
function withExtraHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (h ?? 8) * 60 + (m ?? 0) + Math.round(hours * 60);
  const hh = Math.floor(total / 60) % 24;
  const mm = ((total % 60) + 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Trim a Postgres time ('08:00:00') or an HH:mm string to HH:mm; empty when absent. */
function hhmm(t?: string | null): string {
  const m = typeof t === 'string' ? t.match(/^(\d{1,2}):(\d{2})/) : null;
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : '';
}

/** Ignore permission-denied reads (manager cannot read audit logs or EMI). */
async function safeGet<T>(path: string, fallback: T): Promise<T> {
  try { return await api.get<T>(path); } catch (e) {
    if (e instanceof ApiFailure && (e.status === 403 || e.status === 401)) return fallback;
    throw e;
  }
}

/** Secondary data (audit trail, notifications, adjustments...): a failure here must not block the whole app. */
async function softGet<T>(path: string, fallback: T): Promise<T> {
  try { return await safeGet<T>(path, fallback); } catch (e) {
    console.warn(`Could not load ${path}`, e);
    return fallback;
  }
}

export const SkyhookProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User>(placeholderUser);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => Boolean(getToken()));
  const [companySettings, setCompanySettings] = useState<CompanySettings>(fallbackSettings);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [contractors, setContractors] = useState<ContractorRecord[]>([]);
  const [machines, setMachines] = useState<MachineAsset[]>([]);
  const [emiLoans, setEmiLoans] = useState<MachineEmiLoan[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [advances, setAdvances] = useState<SalaryAdvance[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [expenses, setExpenses] = useState<ProjectExpense[]>([]);
  const [machineWorkingLogs, setMachineWorkingLogs] = useState<MachineWorkingLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [payrollAdjustments, setPayrollAdjustments] = useState<Record<string, PayrollAdjustmentSet>>({});
  const [personalRecords, setPersonalRecords] = useState<PersonalRecord[]>([]);
  const [personalPinSet, setPersonalPinSet] = useState(() => Boolean(getPinHash()));
  const [extractedDocuments, setExtractedDocuments] = useState<ExtractedDocument[]>([]);

  const loadAll = useCallback(async () => {
    // Identity comes from the token via /auth/me — never from a client-side list.
    const me = await api.get<any>('/auth/me');
    setCurrentUser(mapUser(me));

    const [company, users, prj, emp, contractorsRaw, mach, loans, att, adv, runs, exp, logs, aud, notif, adj, personal, extracted] = await Promise.all([
      safeGet<any>('/company', null),
      // Staff directory for Settings; needs user:read, so managers get an empty list.
      safeGet<{ items: any[] }>('/users', { items: [] }),
      safeGet<{ items: any[] }>('/projects', { items: [] }),
      safeGet<{ items: any[] }>('/employees', { items: [] }),
      safeGet<{ items: any[] }>('/contractors', { items: [] }),
      safeGet<{ items: any[] }>('/machines', { items: [] }),
      safeGet<{ items: any[] }>('/emi-loans', { items: [] }),
      safeGet<{ items: any[] }>('/attendance?limit=1000', { items: [] }),
      safeGet<{ items: any[] }>('/advances', { items: [] }),
      safeGet<{ items: any[] }>('/payroll/runs', { items: [] }),
      safeGet<{ items: any[] }>('/expenses', { items: [] }),
      safeGet<{ items: any[] }>('/machine-working-logs', { items: [] }),
      softGet<{ items: any[] }>('/audit-logs?limit=200', { items: [] }),
      softGet<{ items: any[] }>('/notifications', { items: [] }),
      softGet<{ items: any[] }>('/payroll-adjustments', { items: [] }),
      softGet<{ items: any[] }>('/personal-records', { items: [] }),
      softGet<{ items: any[] }>('/extracted-documents', { items: [] }),
    ]);
    if (company) setCompanySettings(mapCompany(company));
    setAvailableUsers(users.items.map(mapUser));
    setProjects(prj.items.map(mapProject));
    setEmployees(emp.items.map(mapEmployee));
    setContractors(contractorsRaw.items.map(mapContractor));
    // Service history lives on its own endpoint; keep a machine usable if that
    // endpoint is unavailable. lastServiceHours comes from the machine mapper.
    setMachines(await Promise.all(mach.items.map(async (m) => {
      const machine = mapMachine(m);
      const history = await safeGet<{ items: any[] }>(
        `/machines/${encodeURIComponent(m.id)}/service-history`,
        { items: [] },
      ).catch(() => ({ items: [] as any[] }));
      return { ...machine, serviceHistory: history.items.map(mapServiceRecord) };
    })));
    setEmiLoans(loans.items.map(mapEmiLoan));
    setAttendance(att.items.map(mapAttendance));
    setAdvances(adv.items.map(mapAdvance));
    // The list endpoint returns runs without their entries — fetch each detail
    // so payroll rows (and custom pay/deductions) are actually visible.
    setPayrollRuns(await Promise.all(runs.items.map(async (r) => {
      try {
        return mapPayrollRun(await api.get<any>(`/payroll/runs/${r.id}`));
      } catch {
        return mapPayrollRun(r);
      }
    })));
    setExpenses(exp.items.map(mapExpense));
    setMachineWorkingLogs(logs.items.map(mapWorkingLog));
    setAuditLogs(aud.items.map(mapAudit));
    setNotifications(notif.items.map(mapNotification));
    setPayrollAdjustments(groupAdjustments(adj.items));
    setPersonalRecords(personal.items.map(mapPersonalRecord));
    setExtractedDocuments(extracted.items.map(mapExtractedDocument));
  }, []);

  useEffect(() => {
    if (getToken()) {
      loadAll().catch((e) => {
        console.error('Failed to load Skyhook data', e);
        // Only an invalid/expired token should end the session. A 429, a network
        // blip or a 5xx must not silently sign the user out mid-save.
        if (e instanceof ApiFailure && e.status === 401) {
          setToken(null);
          setIsAuthenticated(false);
        }
      });
    }
  }, [loadAll]);

  // Several actions refresh at once (e.g. an attendance write plus a payroll run). Running
  // them in parallel lets an older response overwrite newer data, so overlapping calls are
  // coalesced: one load at a time, plus one more load if anything asked while it was running.
  const loading = useRef<Promise<void> | null>(null);
  const rerun = useRef(false);
  const refresh = useCallback(async () => {
    if (!getToken()) return;
    if (loading.current) {
      rerun.current = true;
      return loading.current;
    }
    const run = (async () => {
      try {
        do {
          rerun.current = false;
          try {
            await loadAll();
          } catch (e) {
            // The write itself already succeeded. A failed follow-up read must not
            // reject the save and make it look like the user's edit was lost.
            console.warn('Refresh after save failed', e);
          }
        } while (rerun.current);
      } finally {
        loading.current = null;
      }
    })();
    loading.current = run;
    return run;
  }, [loadAll]);

  const value = useMemo<SkyhookStoreContextType>(() => ({
    currentUser, isAuthenticated, availableUsers, companySettings,
    projects, employees, contractors, machines, emiLoans, attendance, advances, payrollRuns,
    expenses, machineWorkingLogs, auditLogs, notifications,
    payrollAdjustments, personalRecords, personalPinSet, extractedDocuments,
    currentDate: todayISO(),

    login: async (email, password) => {
      const r = await api.post<{ token: string }>('/auth/token', {
        email: email.trim().toLowerCase(), password,
      });
      setToken(r.token);
      try {
        await loadAll();
      } catch (e) {
        setToken(null);
        throw e;
      }
      setIsAuthenticated(true);
    },
    register: async (input) => {
      const r = await api.post<{ token: string; user: any }>('/auth/register', input);
      setToken(r.token);
      const user = mapUser(r.user);
      setCurrentUser(user);
      setAvailableUsers((prev) => [...prev.filter((u) => u.id !== user.id), user]);
      setIsAuthenticated(true);
      await loadAll();
    },
    logout: () => {
      setToken(null);
      setIsAuthenticated(false);
      setCurrentUser(placeholderUser);
      setAvailableUsers([]);
    },
    updateUserRole: async (userId, newRole) => {
      await api.post(`/users/${userId}/roles`, { role: newRole });
      await refresh();
    },
    addUser: async (user) => {
      const r = await api.post<any>('/users', {
        name: user.name, email: user.email, password: user.password, phone: user.phone, role: user.role,
      });
      await refresh();
      return mapUser(r);
    },
    deleteUser: async (userId) => { await api.delete(`/users/${userId}`); await refresh(); },

    updateCompanySettings: async (settings) => {
      const payload: any = {};
      const map: Record<string, string> = {
        standardShiftHours: 'standardShiftMinutes', payrollPaymentDay: 'payrollPaymentDay',
      };
      for (const [k, v] of Object.entries(settings)) {
        let key = map[k] ?? k;
        if (key === 'standardShiftMinutes' && typeof v === 'number') {
          payload[key] = Math.round(v * 60);
        } else if (key.includes('ReminderLeadDays') || key === 'payrollPaymentDay') {
          payload[key] = v;
        } else {
          payload[key] = v;
        }
      }
      if (payload.standardShiftHours) { payload.standardShiftMinutes = payload.standardShiftHours * 60; delete payload.standardShiftHours; }
      await api.patch('/company', payload);
      await refresh();
    },

    addProject: async (p) => {
      const r = await api.post<any>('/projects', {
        name: p.name, clientName: p.clientName, clientPhone: p.clientPhone, clientEmail: p.clientEmail,
        location: p.location, siteAddress: p.siteAddress, city: p.city, state: p.state,
        startDate: p.startDate, expectedEndDate: p.expectedEndDate, actualEndDate: p.actualEndDate,
        otRatePaisePerHour: rupeesToPaise(p.overtimeRate), contractValuePaise: p.contractValue != null ? rupeesToPaise(p.contractValue) : undefined,
        description: p.description, status: p.status,
      });
      await refresh();
      return mapProject(r);
    },
    updateProject: async (id, p) => {
      const payload: any = { ...p };
      if (p.overtimeRate !== undefined) { payload.otRatePaisePerHour = rupeesToPaise(p.overtimeRate); delete payload.overtimeRate; }
      if (p.contractValue !== undefined) { payload.contractValuePaise = rupeesToPaise(p.contractValue); delete payload.contractValue; }
      await api.patch(`/projects/${id}`, payload);
      await refresh();
    },
    deleteProject: async (id) => { await api.patch(`/projects/${id}`, { status: 'cancelled' }); await refresh(); },

    addEmployee: async (e) => {
      // Blank form fields mean "not provided"; the API rejects '' for dates and emails.
      const blank = <T,>(v: T | '' | undefined | null): T | undefined => (v === '' || v == null ? undefined : v);
      const r = await api.post<any>('/employees', {
        fullName: e.fullName, mobile: e.mobile, email: blank(e.email), dateOfBirth: blank(e.dateOfBirth),
        joiningDate: e.joiningDate, designation: e.designation, employeeType: e.employeeType,
        address: blank(e.address), salaryType: e.salaryType, dailyRatePaise: rupeesToPaise(e.dailyRate),
        monthlySalaryPaise: rupeesToPaise(e.monthlySalary), standardShiftMinutes: (e.standardShiftHours ?? 10) * 60,
        overtimeEligible: e.overtimeEligible, licenseNumber: blank(e.licenseNumber),
        craneLicenseDate: blank(e.craneLicenseDate), craneLicenseExpiry: blank(e.craneLicenseExpiry),
        transportLicenseDate: blank(e.transportLicenseDate), transportLicenseExpiry: blank(e.transportLicenseExpiry),
        guardianName: blank(e.guardianName), bloodGroup: blank(e.bloodGroup),
        licenseIssueDate: blank(e.licenseIssueDate), licenseValidNt: blank(e.licenseValidNt),
        licenseValidTr: blank(e.licenseValidTr), licenseFirstIssueDate: blank(e.licenseFirstIssueDate),
        licenseIssuingState: blank(e.licenseIssuingState), licenseIssuingAuthority: blank(e.licenseIssuingAuthority),
        licenseVehicleClasses: e.licenseVehicleClasses ?? [], organDonor: e.organDonor ?? null,
        licenseScanned: Boolean(e.licenseScanned),
      });
      await refresh();
      return mapEmployee(r);
    },
    attachEmployeeDocument: async (employeeId, file, docType, expiryDate) => {
      const signed = await api.post<{ objectKey: string }>('/files/sign-upload', {
        kind: 'employee', ownerId: employeeId, name: file.name,
      });
      await api.putBinary(`/files/${signed.objectKey}`, await file.arrayBuffer());
      await api.post('/documents', {
        ownerType: 'employee', ownerId: employeeId, docType, name: file.name,
        objectKey: signed.objectKey, sizeKb: Math.ceil(file.size / 1024),
        mimeType: file.type || undefined, expiryDate: expiryDate || undefined,
      });
    },
    updateEmployee: async (id, e) => {
      const payload: any = { ...e };
      if (payload.email === '') payload.email = null;
      delete payload.emergencyContacts; delete payload.documents;
      if (e.dailyRate !== undefined) { payload.dailyRatePaise = rupeesToPaise(e.dailyRate); delete payload.dailyRate; }
      if (e.monthlySalary !== undefined) { payload.monthlySalaryPaise = rupeesToPaise(e.monthlySalary); delete payload.monthlySalary; }
      await api.patch(`/employees/${id}`, payload);
      await refresh();
    },
    deactivateEmployee: async (id) => { await api.patch(`/employees/${id}`, { status: 'inactive' }); await refresh(); },
    addContractor: async (c) => {
      const r = await api.post<any>('/contractors', {
        fullName: c.fullName, mobile: c.mobile, skill: c.skill,
        agencyName: c.agencyName || undefined, dailyRatePaise: rupeesToPaise(c.dailyRate),
        city: c.city || undefined, availability: c.availability, notes: c.notes || undefined,
      });
      await refresh();
      return mapContractor(r);
    },
    updateContractor: async (id, patch) => {
      const payload: any = { ...patch };
      delete payload.id; delete payload.contractorCode; delete payload.createdAt;
      if (patch.dailyRate !== undefined) {
        payload.dailyRatePaise = rupeesToPaise(patch.dailyRate);
        delete payload.dailyRate;
      }
      await api.patch(`/contractors/${encodeURIComponent(id)}`, payload);
      await refresh();
    },
    deleteContractor: async (id) => {
      await api.delete(`/contractors/${encodeURIComponent(id)}`);
      await refresh();
    },
    renewOperatorLicense: async (operatorId, newCraneExpiry, newTransportExpiry) => {
      await api.post(`/employees/${operatorId}/license-renewal`, {
        craneLicenseExpiry: newCraneExpiry, transportLicenseExpiry: newTransportExpiry,
        renewalDate: newCraneExpiry ?? undefined,
      });
      await refresh();
    },

    addMachine: async (m) => {
      const r = await api.post<any>('/machines', {
        assetCode: m.assetId, machineType: machineTypeToApi(m.machineType), make: m.make, model: m.model,
        registrationNumber: m.registrationNumber, serialNumber: m.serialNumber,
        tonnageCapacity: m.tonnageCapacity, purchaseDate: m.purchaseDate,
        purchaseCostPaise: rupeesToPaise(m.purchaseCost),
        serviceFrequencyValue: m.serviceFrequencyValue,
        serviceFrequencyUnit: m.serviceFrequencyUnit,
        serviceReminderLeadHours: m.serviceReminderLeadHours ?? 50,
        lastServiceDate: m.lastServiceDate, insuranceProvider: m.insuranceProvider,
        insurancePolicyNumber: m.insurancePolicyNumber, insuranceExpiryDate: m.insuranceExpiryDate,
        insuranceIntervalDays: m.insuranceIntervalDays, pucNumber: m.pucNumber,
        pucIssueDate: m.pucIssueDate, pucExpiryDate: m.pucExpiryDate, pucIntervalDays: m.pucIntervalDays,
        fitnessCertificateNumber: m.fitnessCertificateNumber, lastFitnessDate: m.lastFitnessDate,
        nextFitnessDueDate: m.nextFitnessDueDate, fitnessIntervalDays: m.fitnessIntervalDays,
        status: m.status, rcDetails: m.rcDetails, insuranceStartDate: m.insuranceStartDate || undefined,
      });
      await refresh();
      return mapMachine(r);
    },
    attachMachineDocument: async (machineId, file, docType, expiryDate) => {
      const signed = await api.post<{ objectKey: string }>('/files/sign-upload', {
        kind: 'machine', ownerId: machineId, name: file.name,
      });
      await api.putBinary(`/files/${signed.objectKey}`, await file.arrayBuffer());
      await api.post('/documents', {
        ownerType: 'machine', ownerId: machineId, docType, name: file.name,
        objectKey: signed.objectKey, sizeKb: Math.ceil(file.size / 1024),
        mimeType: file.type || undefined, expiryDate: expiryDate || undefined,
      });
    },
    listMachineDocuments: async (machineId) => {
      const r = await api.get<{ items: any[] }>(`/machines/${machineId}/documents`);
      return (r.items ?? []).map(mapDocument);
    },
    downloadDocument: (objectKey) => api.getBlob(`/files/${objectKey}`),
    updateMachine: async (id, m) => {
      const payload: any = {};
      if (m.status) payload.status = m.status;
      // An explicit empty value means "unassign" (it used to be ignored, so a machine could never leave a site).
      if ('currentProjectId' in m) payload.currentProjectId = m.currentProjectId || null;
      if ('assignedOperatorId' in m) payload.assignedOperatorId = m.assignedOperatorId || null;
      // Service interval — including 'hours' — is now persisted server-side.
      if (m.serviceFrequencyUnit) payload.serviceFrequencyUnit = m.serviceFrequencyUnit;
      if (m.serviceFrequencyValue !== undefined) payload.serviceFrequencyValue = m.serviceFrequencyValue;
      if (m.serviceReminderLeadHours !== undefined) payload.serviceReminderLeadHours = m.serviceReminderLeadHours;
      // Identity + RC details (editable, e.g. after scanning the RC).
      if (m.machineType) payload.machineType = machineTypeToApi(m.machineType);
      if (m.make) payload.make = m.make;
      if (m.model) payload.model = m.model;
      if (m.registrationNumber) payload.registrationNumber = m.registrationNumber;
      if (m.serialNumber !== undefined) payload.serialNumber = m.serialNumber || null;
      if (m.tonnageCapacity !== undefined) payload.tonnageCapacity = m.tonnageCapacity;
      if (m.rcDetails) payload.rcDetails = m.rcDetails;
      // Servicing and statutory details shown in the Edit form.
      if (m.purchaseCost !== undefined) payload.purchaseCostPaise = rupeesToPaise(m.purchaseCost);
      for (const key of [
        'lastServiceDate', 'nextServiceDueDate', 'insuranceProvider', 'insurancePolicyNumber', 'insuranceStartDate',
        'insuranceExpiryDate', 'insuranceIntervalDays', 'pucNumber', 'pucIssueDate', 'pucExpiryDate', 'pucIntervalDays',
        'fitnessCertificateNumber', 'lastFitnessDate', 'nextFitnessDueDate', 'fitnessIntervalDays',
      ] as const) {
        if (m[key] !== undefined) payload[key] = m[key] === '' ? null : m[key];
      }
      await api.patch(`/machines/${id}`, payload);
      await refresh();
    },
    updateMachineServiceConfig: async (machineId, patch) => {
      const serverPatch: any = {};
      if (patch.serviceFrequencyUnit) serverPatch.serviceFrequencyUnit = patch.serviceFrequencyUnit;
      if (patch.serviceFrequencyValue !== undefined) serverPatch.serviceFrequencyValue = patch.serviceFrequencyValue;
      if (patch.serviceReminderLeadHours !== undefined) serverPatch.serviceReminderLeadHours = patch.serviceReminderLeadHours;
      if (Object.keys(serverPatch).length) await api.patch(`/machines/${machineId}`, serverPatch);
      await refresh();
    },
    recordServiceCompleted: async (machineId, serviceDate, cost, notes, provider, operatingHours) => {
      await api.post(`/machines/${machineId}/service`, {
        serviceDate, costPaise: rupeesToPaise(cost), notes, serviceProvider: provider,
        odometerOrHours: operatingHours,
      });
      await refresh();
    },
    renewMachineInsurance: async (machineId, newExpiry, provider, policyNo, renewalDate) => {
      await api.post(`/machines/${machineId}/renewals`, {
        category: 'insurance', newExpiry, provider, referenceNumber: policyNo, renewalDate: renewalDate ?? todayISO(),
      });
      await refresh();
    },
    renewMachinePuc: async (machineId, newExpiry, pucNo, renewalDate) => {
      await api.post(`/machines/${machineId}/renewals`, {
        category: 'puc', newExpiry, referenceNumber: pucNo, renewalDate: renewalDate ?? todayISO(),
      });
      await refresh();
    },
    renewMachineFitness: async (machineId, newExpiry, fitNo, testPassedDate) => {
      await api.post(`/machines/${machineId}/renewals`, {
        category: 'fitness', newExpiry, referenceNumber: fitNo, renewalDate: testPassedDate ?? todayISO(),
      });
      await refresh();
    },

    addEmiLoan: async (loan) => {
      // The API only accepts a real machine UUID; a display code like CR-001 is
      // rejected, which used to make the whole "Save loan" action look like a no-op.
      const assetId = asUuid(loan.assetId ?? (loan as any).assetCode);
      if (!assetId) throw new Error('Choose a machine from the list.');
      if (!String(loan.loanProvider ?? '').trim()) throw new Error('Enter the loan provider.');
      if (!String(loan.loanRefNumber ?? '').trim()) throw new Error('Enter the loan account number.');
      const r = await api.post<any>('/emi-loans', {
        assetId, loanProvider: loan.loanProvider,
        loanRefNumber: loan.loanRefNumber, loanStartDate: loan.loanStartDate,
        monthlyDueDay: loan.monthlyDueDay, principalPaise: rupeesToPaise((loan as any).principal ?? loan.emiAmount * loan.totalInstallments),
        annualInterestPct: (loan as any).annualInterestPct ?? 0,
        tenureMonths: loan.totalInstallments, reminderLeadDays: loan.reminderLeadDays,
      });
      await refresh();
      return mapEmiLoan(r);
    },
    recordEmiPayment: async (loanId, installmentNumber, paymentMode, reference) => {
      // The API only accepts its own payment-mode enum. Callers pass human labels
      // like "Net Banking NEFT" / "NEFT Bank Transfer" / "Company Cheque", which
      // used to be sent verbatim and rejected with a 422.
      const raw = String(paymentMode ?? '').toLowerCase().replace(/[\s-]+/g, '_');
      const serverMode =
        raw.includes('cheque') || raw.includes('check') ? 'cheque'
        : raw.includes('upi') ? 'upi'
        : raw.includes('cash') ? 'cash'
        : raw.includes('card') ? 'company_card'
        : 'bank_transfer';
      await api.post(`/emi-loans/${loanId}/payments`, {
        installmentNumber, paymentMode: serverMode,
        paymentReference: reference,
      });
      await refresh();
    },

    addAttendanceRecord: async (record) => {
      const t = resolveAttendanceTarget(employees, projects, record.operatorId, record.projectId, record.machineId);
      assertNotLocked(attendance, t.operatorId, record.date, t.emp?.fullName);
      const r = await api.post<any>('/attendance', {
        operatorId: t.operatorId, date: record.date, projectId: t.projectId, machineId: t.machineId,
        startTime: record.startTime, endTime: record.endTime,
        unpaidBreakMinutes: Math.max(0, Math.round(Number(record.unpaidBreakMinutes) || 0)),
        status: record.status, remarks: record.remarks || undefined,
      });
      await refresh();
      return mapAttendance(r);
    },
    bulkAddAttendance: async (records) => {
      try {
        for (const rec of records) {
          const t = resolveAttendanceTarget(employees, projects, rec.operatorId, rec.projectId, rec.machineId);
          await api.post('/attendance', {
            operatorId: t.operatorId, date: rec.date, projectId: t.projectId, machineId: t.machineId,
            startTime: rec.startTime || '08:00', endTime: rec.endTime || '18:00',
            unpaidBreakMinutes: Math.max(0, Math.round(Number(rec.unpaidBreakMinutes) || 0)),
            status: rec.status, remarks: rec.remarks || undefined,
          });
        }
      } finally {
        await refresh();
      }
    },
    approveAttendanceRecord: async (id) => { await api.post(`/attendance/${id}/approve`, {}); await refresh(); },
    rejectAttendanceRecord: async (id, reason) => { await api.post(`/attendance/${id}/reject`, { reason: reason ?? 'Discrepancy in shift hours' }); await refresh(); },
    markOperatorAttendanceQuick: async (params) => {
      const t = resolveAttendanceTarget(employees, projects, params.operatorId, params.projectId, params.machineId);
      assertNotLocked(attendance, t.operatorId, params.date, t.emp?.fullName);
      const shift = companySettings.standardShiftHours || 10;
      const overtime = Math.max(0, Number(params.overtimeHours) || 0);
      // The server derives hours and overtime from the shift times, so encode them here.
      const worked = params.status === 'present' ? shift + overtime : params.status === 'half_day' ? shift / 2 + overtime : 0;
      // Optional real clock times from the caller (system clock). Without them the shift is
      // laid out from 08:00, as before. A start with no end derives the end from the shift.
      const startTime = hhmm(params.startTime) || '08:00';
      const endTime = hhmm(params.endTime) || withExtraHours(startTime, worked);
      const r = await api.post<any>('/attendance', {
        operatorId: t.operatorId, date: params.date, projectId: t.projectId, machineId: t.machineId,
        startTime, endTime,
        unpaidBreakMinutes: Math.max(0, Math.round(Number(params.unpaidBreakMinutes) || 0)),
        status: params.status, remarks: params.remarks ?? (overtime ? `${overtime}h OT` : 'Quick attendance'),
      });
      await refresh();
      return mapAttendance(r);
    },
    markAllOperatorsPresent: async (params) => {
      const ops = employees.filter((e) => e.employeeType === 'operator' && e.status === 'active');
      const shift = companySettings.standardShiftHours || 10;
      const result: BulkMarkResult = { created: 0, skipped: 0, failed: [] };
      try {
        for (const op of ops) {
          // Never overwrite a day that is already marked (absent, half day, approved...).
          if (attendance.some((a) => a.operatorId === op.id && a.date === params.date)) {
            result.skipped += 1;
            continue;
          }
          try {
            const t = resolveAttendanceTarget(employees, projects, op.id, params.projectId, undefined);
            const startTime = hhmm(params.startTime) || '08:00';
            await api.post('/attendance', {
              operatorId: t.operatorId, date: params.date, projectId: t.projectId, machineId: t.machineId,
              startTime, endTime: hhmm(params.endTime) || withExtraHours(startTime, shift), status: 'present',
              remarks: 'Marked present via Quick Attendance bulk action',
            });
            result.created += 1;
          } catch (e) {
            result.failed.push({ name: op.fullName, reason: errorText(e) });
          }
        }
      } finally {
        await refresh();
      }
      return result;
    },
    addOrUpdateOvertimeHours: async (params) => {
      const operator = employees.find((e) => e.id === params.operatorId || e.employeeId === params.operatorId);
      const existingRow = attendance.find((a) => a.operatorId === (operator?.id ?? params.operatorId) && a.date === params.date);
      // Adding overtime to a day that is already booked keeps that day's project, not the operator's current one.
      const t = resolveAttendanceTarget(employees, projects, params.operatorId, params.projectId ?? existingRow?.projectId, undefined);
      assertNotLocked(attendance, t.operatorId, params.date, t.emp?.fullName);
      const existing = existingRow ?? attendance.find((a) => a.operatorId === t.operatorId && a.date === params.date);
      const shift = companySettings.standardShiftHours || 10;
      const overtime = Math.max(0, Number(params.overtimeHours) || 0);
      const keep = existing && (existing.status === 'present' || existing.status === 'half_day');
      const status = keep ? existing.status : overtime > 0 || !existing ? 'present' : existing.status;
      const base = status === 'present' ? shift : status === 'half_day' ? shift / 2 : 0;
      const breakMin = existing?.unpaidBreakMinutes ?? 0;
      // Keep the start time already on the record (the server returns HH:mm:ss, the API wants HH:mm).
      const startTime = hhmm(existing?.startTime) || hhmm(params.startTime) || '08:00';
      const r = await api.post<any>('/attendance', {
        operatorId: t.operatorId, date: params.date, projectId: t.projectId,
        machineId: asUuid(existing?.machineId) ?? t.machineId,
        startTime,
        // Overtime is encoded in the end time — the server is the only authority on OT hours.
        endTime: withExtraHours(startTime, base + overtime + breakMin / 60),
        unpaidBreakMinutes: breakMin,
        status,
        remarks: params.remarks ?? `${overtime}h OT logged`,
      });
      await refresh();
      return mapAttendance(r);
    },

    addAdvance: async (adv) => {
      const emp = employees.find((e) => e.id === adv.employeeId || e.employeeId === adv.employeeId);
      const r = await api.post<any>('/advances', {
        employeeId: emp?.id ?? adv.employeeId, date: adv.date, amountPaise: rupeesToPaise(adv.amount),
        paymentMode: adv.paymentMode, paymentReference: adv.paymentReference || undefined,
        projectId: asUuid(adv.projectId), remarks: adv.remarks || undefined,
      });
      await refresh();
      return mapAdvance(r);
    },
    approveAdvance: async (id) => { await api.post(`/advances/${id}/approve`, {}); await refresh(); },

    generatePayrollForMonth: async (month) => {
      const r = await api.post<any>('/payroll/runs/generate', { month });
      await refresh();
      return mapPayrollRun(r);
    },
    approvePayrollRun: async (id) => { await api.post(`/payroll/runs/${id}/approve`, {}); await refresh(); },
    markPayrollEntryPaid: async (runId, entryId, paymentMode, ref) => {
      await api.post(`/payroll/runs/${runId}/entries/${entryId}/payment`, { paymentMode, paymentReference: ref });
      await refresh();
    },

    addExpense: async (exp) => {
      const r = await api.post<any>('/expenses', {
        projectId: exp.projectId, date: exp.date, category: exp.category, description: exp.description,
        amountPaise: rupeesToPaise(exp.amount), paymentMode: exp.paymentMode, paidBy: exp.paidBy,
        vendor: exp.vendor, receiptNumber: exp.receiptNumber, remarks: exp.remarks,
      });
      await refresh();
      return mapExpense(r);
    },
    approveExpense: async (id) => { await api.post(`/expenses/${id}/approve`, {}); await refresh(); },

    addMachineWorkingLog: async (log) => {
      const r = await api.post<any>('/machine-working-logs', workingLogBody(log));
      await refresh();
      return mapWorkingLog(r);
    },
    importMachineWorkingLogs: async (logs) => {
      let created = 0;
      const failed: string[] = [];
      try {
        for (const [i, log] of logs.entries()) {
          try {
            await api.post('/machine-working-logs', workingLogBody(log));
            created += 1;
          } catch (e) {
            failed.push(`row ${i + 1}: ${errorText(e)}`);
          }
        }
      } finally {
        await refresh();
      }
      if (failed.length) {
        throw new Error(
          `${created} imported, ${failed.length} failed (${failed.slice(0, 3).join('; ')}${failed.length > 3 ? '; ...' : ''})`,
        );
      }
      return created;
    },

    markNotificationRead: async (id) => { await api.patch(`/notifications/${id}`, { read: true }); await refresh(); },
    resetToDemoData: async () => {
      // Server data is authoritative; a full reset is an ops action. Re-fetch current state.
      await refresh();
    },

    addPayrollAdjustment: async (month, employeeCode, type, label, amount, remarks) => {
      const created = await api.post<any>('/payroll-adjustments', {
        month, employeeCode, kind: type, label, amountPaise: rupeesToPaise(amount), remarks,
      });
      const item: StoredAdjustment = {
        ...mapPayrollAdjustment(created),
        month, employeeCode, type,
      };
      setPayrollAdjustments((prev) => {
        const key = payrollAdjustmentKey(month, employeeCode);
        const set = prev[key] ?? { pay: [], deductions: [] };
        // New object (never mutate the previous state) so memoised consumers re-render.
        const next = type === 'pay'
          ? { ...set, pay: [...set.pay, item] }
          : { ...set, deductions: [...set.deductions, item] };
        return { ...prev, [key]: next };
      });
    },
    removePayrollAdjustment: async (_month, _employeeCode, _type, id) => {
      await api.delete(`/payroll-adjustments/${encodeURIComponent(id)}`);
      setPayrollAdjustments((prev) => {
        const next: Record<string, PayrollAdjustmentSet> = {};
        for (const [key, set] of Object.entries(prev)) {
          next[key] = {
            pay: set.pay.filter((a) => a.id !== id),
            deductions: set.deductions.filter((a) => a.id !== id),
          };
        }
        return next;
      });
    },

    setPersonalPin: async (pin) => {
      setPinHash(pin);
      setPersonalPinSet(true);
    },
    verifyPersonalPin: (pin) => verifyPin(pin),
    addPersonalRecord: async (record) => {
      const created = await api.post<any>('/personal-records', {
        kind: record.kind, title: record.title, provider: record.provider,
        referenceNumber: record.referenceNumber,
        amountPaise: rupeesToPaise(record.amount),
        periodicAmountPaise: rupeesToPaise(record.periodicAmount),
        startDate: record.startDate, dueDate: record.dueDate, notes: record.notes,
      });
      const mapped = mapPersonalRecord(created);
      setPersonalRecords((prev) => [...prev, mapped]);
      return mapped;
    },
    updatePersonalRecord: async (id, patch) => {
      const payload: any = { ...patch };
      delete payload.id;
      delete payload.createdAt;
      if (patch.amount !== undefined) {
        payload.amountPaise = rupeesToPaise(patch.amount);
        delete payload.amount;
      }
      if (patch.periodicAmount !== undefined) {
        payload.periodicAmountPaise = rupeesToPaise(patch.periodicAmount);
        delete payload.periodicAmount;
      }
      const updated = await api.patch<any>(`/personal-records/${encodeURIComponent(id)}`, payload);
      const mapped = mapPersonalRecord(updated);
      setPersonalRecords((prev) => prev.map((r) => (r.id === id ? mapped : r)));
    },
    deletePersonalRecord: async (id) => {
      await api.delete(`/personal-records/${encodeURIComponent(id)}`);
      setPersonalRecords((prev) => prev.filter((r) => r.id !== id));
    },

    getEmiAlerts: () => buildReminderAlerts(emiLoans.flatMap((l) => l.installments.filter((i) => i.status !== 'paid').map((i) => ({
      category: 'emi' as const, id: `EMI-${l.id}-${i.installmentNumber}`, targetId: l.assetId ?? (l as any).assetCode ?? l.id,
      targetType: 'loan' as const, title: `${(l as any).assetCode ?? l.assetId} – EMI #${i.installmentNumber}`,
      subtitle: `${l.loanProvider} | ₹${l.emiAmount.toLocaleString('en-IN')}`, dueDate: i.dueDate,
      amount: i.amountDue, lead: l.reminderLeadDays, actionLabel: 'Pay EMI', heading: 'MACHINE EMI REMINDERS',
    }))), companySettings.emiReminderLeadDays),
    getServiceAlerts: () => {
      const calendarAlerts = buildReminderAlerts(machines
        .filter((m) => m.serviceFrequencyUnit !== 'hours')
        .map((m) => ({
          category: 'service' as const, id: `SRV-${m.id}`, targetId: m.assetId, targetType: 'machine' as const,
          title: `${m.assetId} – ${m.make} ${m.model}`,
          subtitle: `Every ${formatServiceInterval(m.serviceFrequencyValue, m.serviceFrequencyUnit)}`,
          dueDate: m.nextServiceDueDate, lead: m.serviceReminderLeadDays, actionLabel: 'Record Service', heading: 'MACHINE SERVICE REMINDERS',
        })), companySettings.serviceReminderLeadDays);

      const hourAlerts: ReminderAlertItem[] = machines
        .filter((m) => m.serviceFrequencyUnit === 'hours')
        .flatMap((m) => {
          const logged = sumOperatingHours(machineWorkingLogs, m.id, m.lastServiceDate);
          const status = evaluateServiceHours(
            logged,
            m.serviceFrequencyValue,
            m.serviceReminderLeadHours ?? 50,
          );
          if (status.status === 'none') return [];
          return [{
            id: `SRV-${m.id}`,
            category: 'service' as const,
            categoryHeading: 'MACHINE SERVICE REMINDERS',
            title: `${m.assetId} – ${m.make} ${m.model}`,
            subtitle: `Every ${formatServiceInterval(m.serviceFrequencyValue, 'hours')} · ${Math.round(status.hoursSinceService)} h used`,
            targetId: m.assetId,
            targetType: 'machine' as const,
            dueDate: m.lastServiceDate,
            daysRemaining: Math.round(status.hoursRemaining),
            status: status.status,
            urgencyLabel: status.label,
            actionLabel: 'Record Service',
            metricUnit: 'hours' as const,
            hoursRemaining: status.hoursRemaining,
          }];
        });

      return [...calendarAlerts, ...hourAlerts].sort((a, b) => a.daysRemaining - b.daysRemaining);
    },
    getInsuranceAlerts: () => buildReminderAlerts(machines.map((m) => ({
      category: 'insurance' as const, id: `INS-${m.id}`, targetId: m.assetId, targetType: 'machine' as const,
      title: `${m.assetId} – ${m.insuranceProvider}`, subtitle: `Policy #${m.insurancePolicyNumber}`,
      dueDate: m.insuranceExpiryDate, lead: m.insuranceReminderLeadDays, actionLabel: 'Renew Insurance', heading: 'INSURANCE RENEWAL REMINDERS',
    })), companySettings.insuranceReminderLeadDays),
    getPucAlerts: () => buildReminderAlerts(machines.map((m) => ({
      category: 'puc' as const, id: `PUC-${m.id}`, targetId: m.assetId, targetType: 'machine' as const,
      title: `${m.assetId} – PUC Certificate`, subtitle: `Cert #${m.pucNumber ?? 'N/A'}`,
      dueDate: m.pucExpiryDate, lead: m.pucReminderLeadDays, actionLabel: 'Renew PUC', heading: 'PUC RENEWAL REMINDERS',
    })), companySettings.pucReminderLeadDays),
    getFitnessAlerts: () => buildReminderAlerts(machines.map((m) => ({
      category: 'fitness' as const, id: `FIT-${m.id}`, targetId: m.assetId, targetType: 'machine' as const,
      title: `${m.assetId} – Fitness Certificate`, subtitle: `Cert #${m.fitnessCertificateNumber ?? 'N/A'}`,
      dueDate: m.nextFitnessDueDate, lead: m.fitnessReminderLeadDays, actionLabel: 'Renew Fitness', heading: 'FITNESS TEST REMINDERS',
    })), companySettings.fitnessReminderLeadDays),
    getLicenseAlerts: () => buildReminderAlerts(employees.filter((e) => e.employeeType === 'operator').flatMap((e) => [
      { category: 'license' as const, id: `LIC-CRANE-${e.id}`, targetId: e.id, targetType: 'operator' as const,
        title: `${e.fullName} (${e.employeeId}) – Crane License`, subtitle: `Lic #${e.licenseNumber ?? 'N/A'}`,
        dueDate: e.craneLicenseExpiry, lead: companySettings.licenseReminderLeadDays, actionLabel: 'Update License', heading: 'OPERATOR LICENSE RENEWAL REMINDERS' },
      { category: 'license' as const, id: `LIC-TR-${e.id}`, targetId: e.id, targetType: 'operator' as const,
        title: `${e.fullName} (${e.employeeId}) – Transport License`, subtitle: 'Heavy Vehicle Commercial Transport License',
        dueDate: e.transportLicenseExpiry, lead: companySettings.licenseReminderLeadDays, actionLabel: 'Update License', heading: 'OPERATOR LICENSE RENEWAL REMINDERS' },
    ]), companySettings.licenseReminderLeadDays),
  }), [currentUser, isAuthenticated, availableUsers, companySettings, projects, employees, contractors, machines, emiLoans,
    attendance, advances, payrollRuns, expenses, machineWorkingLogs, auditLogs, notifications,
    payrollAdjustments, personalRecords, personalPinSet, loadAll, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

type AlertSeed = {
  category: ReminderAlertItem['category']; id: string; targetId: string; targetType: ReminderAlertItem['targetType'];
  title: string; subtitle: string; dueDate?: string; amount?: number; lead: number; actionLabel: string; heading: string;
};

function buildReminderAlerts(seeds: AlertSeed[], defaultLead: number): ReminderAlertItem[] {
  const alerts: ReminderAlertItem[] = [];
  for (const s of seeds) {
    const ev = evaluateReminderStatus(s.dueDate ?? '', s.lead || defaultLead, todayISO());
    if (ev.status === 'none') continue;
    alerts.push({
      id: s.id, category: s.category, categoryHeading: s.heading, title: s.title, subtitle: s.subtitle,
      targetId: s.targetId, targetType: s.targetType, dueDate: s.dueDate ?? '', amount: s.amount,
      daysRemaining: ev.daysRemaining, status: ev.status,
      urgencyLabel: ev.label, actionLabel: s.actionLabel,
    } as ReminderAlertItem);
  }
  return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export const useSkyhook = (): SkyhookStoreContextType => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSkyhook must be used within a SkyhookProvider');
  return ctx;
};
