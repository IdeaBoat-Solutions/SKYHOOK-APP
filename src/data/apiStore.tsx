/**
 * API-backed implementation of the Skyhook store.
 * Drop-in replacement for ./store.tsx — same context interface, server as source of truth.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  CompanySettings, User, UserRole, Employee, Project, AttendanceRecord, AttendanceStatus,
  SalaryAdvance, PayrollRun, ProjectExpense, MachineAsset, MachineEmiLoan, MachineWorkingLog,
  AuditLog, ReminderAlertItem, InAppNotification, PayrollAdjustment, PersonalRecord,
} from '../types';
import { api, getToken, setToken, ApiFailure } from '../api/client';
import {
  mapUser, mapCompany, mapProject, mapEmployee, mapMachine, mapAttendance, mapAdvance,
  mapPayrollRun, mapExpense, mapEmiLoan, mapWorkingLog, mapAudit, mapNotification,
  mapServiceRecord, mapPayrollAdjustment, mapPersonalRecord, rupeesToPaise,
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
  login: (user: User, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
  setCurrentUserRole: (role: UserRole) => void;
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
  updateEmployee: (id: string, e: Partial<Employee>) => Promise<void>;
  deactivateEmployee: (id: string) => Promise<void>;
  renewOperatorLicense: (operatorId: string, newCraneExpiry?: string, newTransportExpiry?: string) => Promise<void>;
  machines: MachineAsset[];
  addMachine: (m: Omit<MachineAsset, 'id'>) => Promise<MachineAsset>;
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
  markOperatorAttendanceQuick: (params: any) => Promise<AttendanceRecord>;
  markAllOperatorsPresent: (params: { date: string; projectId?: string }) => Promise<AttendanceRecord[]>;
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

const Ctx = createContext<SkyhookStoreContextType | null>(null);
const DEMO_DATE = '2026-10-24';
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

/** Ignore permission-denied reads (manager cannot read audit logs or EMI). */
async function safeGet<T>(path: string, fallback: T): Promise<T> {
  try { return await api.get<T>(path); } catch (e) {
    if (e instanceof ApiFailure && (e.status === 403 || e.status === 401)) return fallback;
    throw e;
  }
}

export const SkyhookProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User>(placeholderUser);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => Boolean(getToken()));
  const [companySettings, setCompanySettings] = useState<CompanySettings>(fallbackSettings);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
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

  const loadAll = useCallback(async () => {
    const [company, users, prj, emp, mach, loans, att, adv, runs, exp, logs, aud, notif, adj, personal] = await Promise.all([
      safeGet<any>('/company', null),
      safeGet<{ items: any[] }>('/auth/profiles', { items: [] }),
      safeGet<{ items: any[] }>('/projects', { items: [] }),
      safeGet<{ items: any[] }>('/employees', { items: [] }),
      safeGet<{ items: any[] }>('/machines', { items: [] }),
      safeGet<{ items: any[] }>('/emi-loans', { items: [] }),
      safeGet<{ items: any[] }>('/attendance', { items: [] }),
      safeGet<{ items: any[] }>('/advances', { items: [] }),
      safeGet<{ items: any[] }>('/payroll/runs', { items: [] }),
      safeGet<{ items: any[] }>('/expenses', { items: [] }),
      safeGet<{ items: any[] }>('/machine-working-logs', { items: [] }),
      safeGet<{ items: any[] }>('/audit-logs?limit=200', { items: [] }),
      safeGet<{ items: any[] }>('/notifications', { items: [] }),
      safeGet<{ items: any[] }>('/payroll-adjustments', { items: [] }),
      safeGet<{ items: any[] }>('/personal-records', { items: [] }),
    ]);
    if (company) setCompanySettings(mapCompany(company));
    const mappedUsers = users.items.map(mapUser);
    if (mappedUsers.length) {
      setAvailableUsers(mappedUsers);
      setCurrentUser((prev) => mappedUsers.find((u) => u.id === prev.id) ?? mappedUsers.find((u) => u.role === 'owner') ?? mappedUsers[0]!);
    }
    setProjects(prj.items.map(mapProject));
    setEmployees(emp.items.map(mapEmployee));
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
  }, []);

  useEffect(() => {
    if (getToken()) {
      loadAll().catch((e) => { console.error('Failed to load Skyhook data', e); setToken(null); setIsAuthenticated(false); });
    } else {
      api.get<{ items: any[] }>('/auth/profiles')
        .then((r) => setAvailableUsers(r.items.map(mapUser)))
        .catch(() => undefined);
    }
  }, [loadAll]);

  const refresh = useCallback(async () => { if (getToken()) await loadAll(); }, [loadAll]);

  const value = useMemo<SkyhookStoreContextType>(() => ({
    currentUser, isAuthenticated, availableUsers, companySettings,
    projects, employees, machines, emiLoans, attendance, advances, payrollRuns,
    expenses, machineWorkingLogs, auditLogs, notifications,
    payrollAdjustments, personalRecords, personalPinSet,
    currentDate: DEMO_DATE,

    login: async (user, password) => {
      const r = await api.post<{ token: string }>('/auth/token', {
        tenantSlug: user.tenantSlug ?? 'skyhook', email: user.email, password,
      });
      setToken(r.token);
      setCurrentUser(user);
      setIsAuthenticated(true);
      await loadAll();
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
    logout: () => { setToken(null); setIsAuthenticated(false); setCurrentUser(placeholderUser); },
    setCurrentUserRole: (role) => {
      const match = availableUsers.find((u) => u.role === role);
      if (match) setCurrentUser(match);
    },
    updateUserRole: async (userId, newRole) => {
      await api.post(`/users/${userId}/roles`, { role: newRole });
      await refresh();
    },
    addUser: async (user) => {
      const r = await api.post<any>('/users', {
        name: user.name, email: user.email, password: user.password ?? 'skyhook2026', phone: user.phone, role: user.role,
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
      const r = await api.post<any>('/employees', {
        fullName: e.fullName, mobile: e.mobile, email: e.email, dateOfBirth: e.dateOfBirth,
        joiningDate: e.joiningDate, designation: e.designation, employeeType: e.employeeType,
        address: e.address, salaryType: e.salaryType, dailyRatePaise: rupeesToPaise(e.dailyRate),
        monthlySalaryPaise: rupeesToPaise(e.monthlySalary), standardShiftMinutes: (e.standardShiftHours ?? 10) * 60,
        overtimeEligible: e.overtimeEligible, licenseNumber: e.licenseNumber,
        craneLicenseExpiry: e.craneLicenseExpiry, transportLicenseExpiry: e.transportLicenseExpiry,
      });
      await refresh();
      return mapEmployee(r);
    },
    updateEmployee: async (id, e) => {
      const payload: any = { ...e };
      if (e.dailyRate !== undefined) { payload.dailyRatePaise = rupeesToPaise(e.dailyRate); delete payload.dailyRate; }
      if (e.monthlySalary !== undefined) { payload.monthlySalaryPaise = rupeesToPaise(e.monthlySalary); delete payload.monthlySalary; }
      await api.patch(`/employees/${id}`, payload);
      await refresh();
    },
    deactivateEmployee: async (id) => { await api.patch(`/employees/${id}`, { status: 'inactive' }); await refresh(); },
    renewOperatorLicense: async (operatorId, newCraneExpiry, newTransportExpiry) => {
      await api.post(`/employees/${operatorId}/license-renewal`, {
        craneLicenseExpiry: newCraneExpiry, transportLicenseExpiry: newTransportExpiry,
        renewalDate: newCraneExpiry ?? undefined,
      });
      await refresh();
    },

    addMachine: async (m) => {
      const r = await api.post<any>('/machines', {
        assetCode: m.assetId, machineType: m.machineType, make: m.make, model: m.model,
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
        status: m.status,
      });
      await refresh();
      return mapMachine(r);
    },
    updateMachine: async (id, m) => {
      const payload: any = {};
      if (m.status) payload.status = m.status;
      if (m.currentProjectId) payload.currentProjectId = m.currentProjectId;
      if (m.assignedOperatorId) payload.assignedOperatorId = m.assignedOperatorId;
      // Service interval — including 'hours' — is now persisted server-side.
      if (m.serviceFrequencyUnit) payload.serviceFrequencyUnit = m.serviceFrequencyUnit;
      if (m.serviceFrequencyValue !== undefined) payload.serviceFrequencyValue = m.serviceFrequencyValue;
      if (m.serviceReminderLeadHours !== undefined) payload.serviceReminderLeadHours = m.serviceReminderLeadHours;
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
        category: 'insurance', newExpiry, provider, referenceNumber: policyNo, renewalDate: renewalDate ?? DEMO_DATE,
      });
      await refresh();
    },
    renewMachinePuc: async (machineId, newExpiry, pucNo, renewalDate) => {
      await api.post(`/machines/${machineId}/renewals`, {
        category: 'puc', newExpiry, referenceNumber: pucNo, renewalDate: renewalDate ?? DEMO_DATE,
      });
      await refresh();
    },
    renewMachineFitness: async (machineId, newExpiry, fitNo, testPassedDate) => {
      await api.post(`/machines/${machineId}/renewals`, {
        category: 'fitness', newExpiry, referenceNumber: fitNo, renewalDate: testPassedDate ?? DEMO_DATE,
      });
      await refresh();
    },

    addEmiLoan: async (loan) => {
      const r = await api.post<any>('/emi-loans', {
        assetId: loan.assetId ?? (loan as any).assetCode, loanProvider: loan.loanProvider,
        loanRefNumber: loan.loanRefNumber, loanStartDate: loan.loanStartDate,
        monthlyDueDay: loan.monthlyDueDay, principalPaise: rupeesToPaise((loan as any).principal ?? loan.emiAmount * loan.totalInstallments),
        annualInterestPct: (loan as any).annualInterestPct ?? 0,
        tenureMonths: loan.totalInstallments, reminderLeadDays: loan.reminderLeadDays,
      });
      await refresh();
      return mapEmiLoan(r);
    },
    recordEmiPayment: async (loanId, installmentNumber, paymentMode, reference) => {
      await api.post(`/emi-loans/${loanId}/payments`, {
        installmentNumber, paymentMode: paymentMode.toLowerCase().replace('_', '_') as any,
        paymentReference: reference,
      });
      await refresh();
    },

    addAttendanceRecord: async (record) => {
      const r = await api.post<any>('/attendance', {
        operatorId: record.operatorId, date: record.date, projectId: record.projectId,
        machineId: record.machineId, startTime: record.startTime, endTime: record.endTime,
        unpaidBreakMinutes: record.unpaidBreakMinutes, status: record.status, remarks: record.remarks,
      });
      await refresh();
      return mapAttendance(r);
    },
    bulkAddAttendance: async (records) => {
      for (const r of records) {
        await api.post('/attendance', {
          operatorId: r.operatorId, date: r.date, projectId: r.projectId, machineId: r.machineId,
          startTime: r.startTime || '08:00', endTime: r.endTime || '18:00',
          unpaidBreakMinutes: r.unpaidBreakMinutes, status: r.status, remarks: r.remarks,
        });
      }
      await refresh();
    },
    approveAttendanceRecord: async (id) => { await api.post(`/attendance/${id}/approve`, {}); await refresh(); },
    rejectAttendanceRecord: async (id, reason) => { await api.post(`/attendance/${id}/reject`, { reason: reason ?? 'Discrepancy in shift hours' }); await refresh(); },
    markOperatorAttendanceQuick: async (params) => {
      const emp = employees.find((e) => e.id === params.operatorId || e.employeeId === params.operatorId);
      const projectId = params.projectId ?? emp?.currentProjectId ?? projects[0]?.id ?? '';
      const hours = params.status === 'present' ? companySettings.standardShiftHours : params.status === 'half_day' ? 5 : 0;
      const overtime = params.overtimeHours ?? 0;
      const r = await api.post<any>('/attendance', {
        operatorId: emp?.id ?? params.operatorId, date: params.date, projectId,
        machineId: params.machineId ?? emp?.currentMachineId,
        startTime: '08:00',
        endTime: params.status === 'present' ? withExtraHours('18:00', overtime) : params.status === 'half_day' ? withExtraHours('13:00', overtime) : '08:00',
        status: params.status, remarks: params.remarks ?? (overtime ? `${overtime}h OT` : 'Quick attendance'),
      });
      void hours;
      await refresh();
      return mapAttendance(r);
    },
    markAllOperatorsPresent: async (params) => {
      const ops = employees.filter((e) => e.employeeType === 'operator' && e.status === 'active');
      const created: AttendanceRecord[] = [];
      for (const op of ops) {
        const r = await api.post<any>('/attendance', {
          operatorId: op.id, date: params.date, projectId: params.projectId ?? op.currentProjectId ?? projects[0]?.id ?? '',
          machineId: op.currentMachineId, startTime: '08:00', endTime: '18:00', status: 'present',
          remarks: 'Marked present via Quick Attendance bulk action',
        });
        created.push(mapAttendance(r));
      }
      await refresh();
      return created;
    },
    addOrUpdateOvertimeHours: async (params) => {
      const emp = employees.find((e) => e.id === params.operatorId || e.employeeId === params.operatorId);
      const existing = attendance.find((a) => (a.operatorId === emp?.id || a.operatorId === params.operatorId) && a.date === params.date);
      const r = await api.post<any>('/attendance', {
        operatorId: emp?.id ?? params.operatorId, date: params.date,
        projectId: params.projectId ?? existing?.projectId ?? emp?.currentProjectId ?? projects[0]?.id ?? '',
        machineId: existing?.machineId ?? emp?.currentMachineId,
        startTime: existing?.startTime || '08:00',
        // Overtime is encoded in the end time — the server is the only authority on OT hours.
        endTime: withExtraHours(existing?.status === 'half_day' ? '13:00' : '18:00', params.overtimeHours),
        status: existing?.status === 'absent' ? 'present' : existing?.status ?? 'present',
        remarks: params.remarks ?? `${params.overtimeHours}h OT logged`,
      });
      void params.appliedOtRate;
      await refresh();
      return mapAttendance(r);
    },

    addAdvance: async (adv) => {
      const emp = employees.find((e) => e.id === adv.employeeId || e.employeeId === adv.employeeId);
      const r = await api.post<any>('/advances', {
        employeeId: emp?.id ?? adv.employeeId, date: adv.date, amountPaise: rupeesToPaise(adv.amount),
        paymentMode: adv.paymentMode, paymentReference: adv.paymentReference,
        projectId: adv.projectId, remarks: adv.remarks,
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
      const r = await api.post<any>('/machine-working-logs', {
        date: log.date, machineId: log.machineId, projectId: log.projectId, operatorId: log.operatorId,
        startTime: log.startTime, endTime: log.endTime, idleMinutes: log.idleMinutes, remarks: log.remarks,
      });
      await refresh();
      return mapWorkingLog(r);
    },
    importMachineWorkingLogs: async (logs) => {
      let created = 0;
      for (const log of logs) {
        await api.post('/machine-working-logs', {
          date: log.date, machineId: log.machineId, projectId: log.projectId,
          operatorId: log.operatorId, startTime: log.startTime, endTime: log.endTime,
          idleMinutes: log.idleMinutes, remarks: log.remarks,
        });
        created += 1;
      }
      await refresh();
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
        if (type === 'pay') set.pay = [...set.pay, item];
        else set.deductions = [...set.deductions, item];
        return { ...prev, [key]: set };
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
  }), [currentUser, isAuthenticated, availableUsers, companySettings, projects, employees, machines, emiLoans,
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
    const ev = evaluateReminderStatus(s.dueDate ?? '', s.lead || defaultLead, DEMO_DATE);
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
