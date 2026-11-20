import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  CompanySettings,
  User,
  UserRole,
  Employee,
  Project,
  ProjectAssignment,
  AttendanceRecord,
  AttendanceStatus,
  SalaryAdvance,
  PayrollRun,
  ProjectExpense,
  MachineAsset,
  MachineEmiLoan,
  MachineWorkingLog,
  AuditLog,
  ReminderAlertItem,
  InAppNotification,
} from '../types';
import {
  INITIAL_COMPANY_SETTINGS,
  INITIAL_USERS,
  INITIAL_PROJECTS,
  INITIAL_EMPLOYEES,
  INITIAL_MACHINES,
  INITIAL_EMI_LOANS,
  INITIAL_ADVANCES,
  INITIAL_EXPENSES,
  generateSeedAttendance,
  INITIAL_MACHINE_WORKING,
  INITIAL_PAYROLL_RUNS,
} from './seedData';
import {
  evaluateReminderStatus,
  calculateNextServiceDate,
  calculateExpiryFromInterval,
  calculateWorkingAndOt,
  calculatePayrollEntry,
} from '../utils/calculations';

interface SkyhookStoreContextType {
  // Current session & auth
  currentUser: User;
  isAuthenticated: boolean;
  login: (user: User) => void;
  logout: () => void;
  setCurrentUserRole: (role: UserRole) => void;
  availableUsers: User[];
  updateUserRole: (userId: string, newRole: UserRole) => void;
  addUser: (user: Omit<User, 'id'>) => User;
  deleteUser: (userId: string) => void;

  // Core Data
  companySettings: CompanySettings;
  updateCompanySettings: (settings: Partial<CompanySettings>) => void;

  projects: Project[];
  addProject: (p: Omit<Project, 'id'>) => Project;
  updateProject: (id: string, p: Partial<Project>) => void;
  deleteProject: (id: string) => void;

  employees: Employee[];
  addEmployee: (e: Omit<Employee, 'id'>) => Employee;
  updateEmployee: (id: string, e: Partial<Employee>) => void;
  deactivateEmployee: (id: string) => void;
  renewOperatorLicense: (operatorId: string, newCraneExpiry?: string, newTransportExpiry?: string) => void;

  machines: MachineAsset[];
  addMachine: (m: Omit<MachineAsset, 'id'>) => MachineAsset;
  updateMachine: (id: string, m: Partial<MachineAsset>) => void;
  recordServiceCompleted: (machineId: string, serviceDate: string, cost: number, notes?: string, provider?: string) => void;
  renewMachineInsurance: (machineId: string, newExpiry: string, provider?: string, policyNo?: string, renewalDate?: string) => void;
  renewMachinePuc: (machineId: string, newExpiry: string, pucNo?: string, renewalDate?: string) => void;
  renewMachineFitness: (machineId: string, newExpiry: string, fitNo?: string, testPassedDate?: string) => void;

  emiLoans: MachineEmiLoan[];
  addEmiLoan: (loan: Omit<MachineEmiLoan, 'id'>) => MachineEmiLoan;
  recordEmiPayment: (loanId: string, installmentNumber: number, paymentMode: string, reference?: string) => void;

  attendance: AttendanceRecord[];
  addAttendanceRecord: (record: Omit<AttendanceRecord, 'id' | 'netWorkingMinutes' | 'netWorkingHours' | 'overtimeHours' | 'standardWorkingHours'>) => AttendanceRecord;
  bulkAddAttendance: (records: AttendanceRecord[]) => void;
  approveAttendanceRecord: (id: string) => void;
  rejectAttendanceRecord: (id: string, reason?: string) => void;
  markOperatorAttendanceQuick: (params: {
    operatorId: string;
    date: string;
    status: AttendanceStatus;
    overtimeHours?: number;
    projectId?: string;
    machineId?: string;
    remarks?: string;
  }) => AttendanceRecord;
  markAllOperatorsPresent: (params: {
    date: string;
    projectId?: string;
  }) => AttendanceRecord[];
  addOrUpdateOvertimeHours: (params: {
    operatorId: string;
    date: string;
    overtimeHours: number;
    projectId?: string;
    appliedOtRate?: number;
    remarks?: string;
  }) => AttendanceRecord;

  advances: SalaryAdvance[];
  addAdvance: (adv: Omit<SalaryAdvance, 'id' | 'advanceId' | 'recoveryAmount' | 'outstandingBalance' | 'status'>) => SalaryAdvance;
  approveAdvance: (id: string) => void;

  payrollRuns: PayrollRun[];
  generatePayrollForMonth: (month: string) => PayrollRun;
  approvePayrollRun: (id: string) => void;
  markPayrollEntryPaid: (payrollRunId: string, entryId: string, paymentMode: string, ref?: string) => void;

  expenses: ProjectExpense[];
  addExpense: (exp: Omit<ProjectExpense, 'id' | 'expenseId'>) => ProjectExpense;
  approveExpense: (id: string) => void;

  machineWorkingLogs: MachineWorkingLog[];
  addMachineWorkingLog: (log: Omit<MachineWorkingLog, 'id' | 'workingMinutes' | 'workingHours'>) => MachineWorkingLog;
  importMachineWorkingLogs: (logs: Omit<MachineWorkingLog, 'id'>[]) => number;

  auditLogs: AuditLog[];
  notifications: InAppNotification[];
  markNotificationRead: (id: string) => void;

  // Red Alerts Engine
  getEmiAlerts: () => ReminderAlertItem[];
  getServiceAlerts: () => ReminderAlertItem[];
  getInsuranceAlerts: () => ReminderAlertItem[];
  getPucAlerts: () => ReminderAlertItem[];
  getFitnessAlerts: () => ReminderAlertItem[];
  getLicenseAlerts: () => ReminderAlertItem[];

  // Utility
  currentDate: string; // "2026-10-24"
  resetToDemoData: () => void;
}

const STORAGE_PREFIX = 'skyhook_erp_v1_';

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(STORAGE_PREFIX + key);
    return item ? JSON.parse(item) : fallback;
  } catch (e) {
    console.warn(`Error reading ${key} from storage:`, e);
    return fallback;
  }
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Error saving ${key} to storage:`, e);
  }
}

const SkyhookContext = createContext<SkyhookStoreContextType | null>(null);

export const SkyhookProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const currentDate = '2026-10-24'; // Fixed evaluated business date

  const [companySettings, setCompanySettings] = useState<CompanySettings>(() =>
    loadFromStorage('settings', INITIAL_COMPANY_SETTINGS)
  );

  const [availableUsers, setAvailableUsers] = useState<User[]>(() =>
    loadFromStorage('users', INITIAL_USERS)
  );
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() =>
    loadFromStorage('is_authenticated', true)
  );
  const [currentUser, setCurrentUser] = useState<User>(() => {
    const storedUser = loadFromStorage('current_user', INITIAL_USERS[0]);
    return storedUser || INITIAL_USERS[0];
  });

  const [projects, setProjects] = useState<Project[]>(() =>
    loadFromStorage('projects', INITIAL_PROJECTS)
  );

  const [employees, setEmployees] = useState<Employee[]>(() =>
    loadFromStorage('employees', INITIAL_EMPLOYEES)
  );

  const [machines, setMachines] = useState<MachineAsset[]>(() =>
    loadFromStorage('machines', INITIAL_MACHINES)
  );

  const [emiLoans, setEmiLoans] = useState<MachineEmiLoan[]>(() =>
    loadFromStorage('emi_loans', INITIAL_EMI_LOANS)
  );

  const [advances, setAdvances] = useState<SalaryAdvance[]>(() =>
    loadFromStorage('advances', INITIAL_ADVANCES)
  );

  const [attendance, setAttendance] = useState<AttendanceRecord[]>(() =>
    loadFromStorage('attendance', generateSeedAttendance())
  );

  const [expenses, setExpenses] = useState<ProjectExpense[]>(() =>
    loadFromStorage('expenses', INITIAL_EXPENSES)
  );

  const [machineWorkingLogs, setMachineWorkingLogs] = useState<MachineWorkingLog[]>(() =>
    loadFromStorage('machine_working', INITIAL_MACHINE_WORKING)
  );

  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>(() =>
    loadFromStorage('payroll_runs', INITIAL_PAYROLL_RUNS)
  );

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() =>
    loadFromStorage('audit_logs', [
      {
        id: 'AUD-001',
        timestamp: '2026-10-24T04:00:00Z',
        userId: 'USR-001',
        userName: 'Vikram Singhania',
        action: 'PAYROLL_APPROVED',
        entity: 'PayrollRun',
        entityId: 'PR-2026-10',
        reason: 'October 2026 payroll locked and finalized for payment on 15 Nov.',
      },
      {
        id: 'AUD-002',
        timestamp: '2026-10-22T09:30:00Z',
        userId: 'USR-001',
        userName: 'Vikram Singhania',
        action: 'PROJECT_ASSIGNMENT',
        entity: 'Project',
        entityId: 'PRJ-001',
        reason: 'Assigned CR-001 and Operator Ramesh Patel to Metro Rail Line 4 viaduct.',
      },
    ])
  );

  const [notifications, setNotifications] = useState<InAppNotification[]>(() => [
    {
      id: 'NOTIF-1',
      category: 'emi',
      title: 'CR-001 EMI Overdue',
      description: 'HDFC Bank Equipment EMI of ₹45,000 for CR-001 was due on 22/10/2026.',
      relatedRecordId: 'CR-001',
      dueDate: '2026-10-22',
      priority: 'critical',
      read: false,
      createdAt: '2026-10-22T08:00:00Z',
    },
    {
      id: 'NOTIF-2',
      category: 'insurance',
      title: 'CR-001 Insurance Expired',
      description: 'New India Assurance policy expired on 23/10/2026. Machine operation halted until renewed.',
      relatedRecordId: 'CR-001',
      dueDate: '2026-10-23',
      priority: 'critical',
      read: false,
      createdAt: '2026-10-23T08:00:00Z',
    },
    {
      id: 'NOTIF-3',
      category: 'puc',
      title: 'CR-001 PUC Certificate Due Today',
      description: 'PUC certificate expires today 24/10/2026.',
      relatedRecordId: 'CR-001',
      dueDate: '2026-10-24',
      priority: 'high',
      read: false,
      createdAt: '2026-10-24T06:00:00Z',
    },
    {
      id: 'NOTIF-4',
      category: 'service',
      title: 'CR-002 Service Due Today',
      description: 'Kato CR-250 60-day scheduled periodic service due today.',
      relatedRecordId: 'CR-002',
      dueDate: '2026-10-24',
      priority: 'high',
      read: false,
      createdAt: '2026-10-24T06:00:00Z',
    },
    {
      id: 'NOTIF-5',
      category: 'license',
      title: 'Suresh Yadav Crane License Overdue',
      description: 'Operator license expired on 22/10/2026.',
      relatedRecordId: 'EMP-002',
      dueDate: '2026-10-22',
      priority: 'critical',
      read: false,
      createdAt: '2026-10-22T09:00:00Z',
    },
  ]);

  // Sync to local storage
  useEffect(() => saveToStorage('settings', companySettings), [companySettings]);
  useEffect(() => saveToStorage('projects', projects), [projects]);
  useEffect(() => saveToStorage('employees', employees), [employees]);
  useEffect(() => saveToStorage('machines', machines), [machines]);
  useEffect(() => saveToStorage('emi_loans', emiLoans), [emiLoans]);
  useEffect(() => saveToStorage('advances', advances), [advances]);
  useEffect(() => saveToStorage('attendance', attendance), [attendance]);
  useEffect(() => saveToStorage('expenses', expenses), [expenses]);
  useEffect(() => saveToStorage('machine_working', machineWorkingLogs), [machineWorkingLogs]);
  useEffect(() => saveToStorage('payroll_runs', payrollRuns), [payrollRuns]);
  useEffect(() => saveToStorage('audit_logs', auditLogs), [auditLogs]);
  useEffect(() => saveToStorage('current_user', currentUser), [currentUser]);
  useEffect(() => saveToStorage('users', availableUsers), [availableUsers]);
  useEffect(() => saveToStorage('is_authenticated', isAuthenticated), [isAuthenticated]);

  const addAudit = (action: string, entity: string, entityId: string, reason?: string, prev?: string, next?: string) => {
    const entry: AuditLog = {
      id: `AUD-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      userId: currentUser?.id || 'SYSTEM',
      userName: currentUser?.name || 'System',
      action,
      entity,
      entityId,
      reason,
      previousValue: prev,
      updatedValue: next,
    };
    setAuditLogs((prevList) => [entry, ...prevList]);
  };

  const login = (user: User) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
    saveToStorage('current_user', user);
    saveToStorage('is_authenticated', true);
    addAudit('USER_LOGIN', 'User', user.id, `User logged in as ${user.role} (${user.name})`);
  };

  const logout = () => {
    setIsAuthenticated(false);
    saveToStorage('is_authenticated', false);
    addAudit('USER_LOGOUT', 'User', currentUser.id, `User signed out (${currentUser.name})`);
  };

  const setCurrentUserRole = (role: UserRole) => {
    const matched = availableUsers.find((u) => u.role === role) || availableUsers[0];
    setCurrentUser(matched);
  };

  const updateUserRole = (userId: string, newRole: UserRole) => {
    if (currentUser.role !== 'owner') {
      alert('Permission Denied: Only the Owner / Super Admin has authority to assign access types.');
      return;
    }

    setAvailableUsers((prev) => {
      const nextUsers = prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u));
      saveToStorage('users', nextUsers);
      return nextUsers;
    });

    if (currentUser.id === userId) {
      const updatedCurrent = { ...currentUser, role: newRole };
      setCurrentUser(updatedCurrent);
      saveToStorage('current_user', updatedCurrent);
    }

    addAudit('USER_ACCESS_ASSIGNED', 'User', userId, `Owner assigned access type: ${newRole}`);
  };

  const addUser = (userData: Omit<User, 'id'>): User => {
    if (currentUser.role !== 'owner') {
      alert('Permission Denied: Only the Owner / Super Admin can add system accounts.');
      throw new Error('Only owner can add users');
    }

    const newId = `USR-${String(availableUsers.length + 1).padStart(3, '0')}`;
    const newUser: User = {
      ...userData,
      id: newId,
    };

    setAvailableUsers((prev) => {
      const nextUsers = [...prev, newUser];
      saveToStorage('users', nextUsers);
      return nextUsers;
    });

    addAudit('USER_CREATED', 'User', newId, `Owner created user ${newUser.name} with role ${newUser.role}`);
    return newUser;
  };

  const deleteUser = (userId: string) => {
    if (currentUser.role !== 'owner') {
      alert('Permission Denied: Only the Owner can delete system users.');
      return;
    }
    if (currentUser.id === userId) {
      alert('Cannot delete the active logged-in Owner account.');
      return;
    }

    setAvailableUsers((prev) => {
      const nextUsers = prev.filter((u) => u.id !== userId);
      saveToStorage('users', nextUsers);
      return nextUsers;
    });

    addAudit('USER_DELETED', 'User', userId, `Owner removed user account`);
  };

  const updateCompanySettings = (partial: Partial<CompanySettings>) => {
    setCompanySettings((prev) => {
      const next = { ...prev, ...partial };
      addAudit('SETTINGS_UPDATED', 'CompanySettings', 'GLOBAL', 'Company profile or payroll policies updated');
      return next;
    });
  };

  // Projects CRUD
  const addProject = (p: Omit<Project, 'id'>): Project => {
    const newId = `PRJ-${String(projects.length + 1).padStart(3, '0')}`;
    const newProj: Project = { ...p, id: newId, projectId: p.projectId || newId };
    setProjects((prev) => [newProj, ...prev]);
    addAudit('PROJECT_CREATED', 'Project', newId, `Created project: ${p.name}`);
    return newProj;
  };

  const updateProject = (id: string, p: Partial<Project>) => {
    setProjects((prev) => prev.map((item) => (item.id === id ? { ...item, ...p } : item)));
    addAudit('PROJECT_UPDATED', 'Project', id, 'Updated project specifications or OT rate');
  };

  const deleteProject = (id: string) => {
    setProjects((prev) => prev.filter((item) => item.id !== id));
    addAudit('PROJECT_DELETED', 'Project', id, 'Deleted project');
  };

  // Employees CRUD
  const addEmployee = (e: Omit<Employee, 'id'>): Employee => {
    const isOp = e.employeeType === 'operator';
    const prefix = isOp ? 'OP' : 'EMP';
    const count = employees.filter((x) => (isOp ? x.employeeType === 'operator' : x.employeeType !== 'operator')).length + 1;
    const newCode = `${prefix}-${String(count).padStart(3, '0')}`;
    const newId = `EMP-${Date.now()}`;
    const newEmp: Employee = { ...e, id: newId, employeeId: e.employeeId || newCode };
    setEmployees((prev) => [newEmp, ...prev]);
    addAudit('EMPLOYEE_CREATED', 'Employee', newId, `Registered ${e.employeeType}: ${e.fullName}`);
    return newEmp;
  };

  const updateEmployee = (id: string, e: Partial<Employee>) => {
    setEmployees((prev) => prev.map((item) => (item.id === id ? { ...item, ...e } : item)));
    addAudit('EMPLOYEE_UPDATED', 'Employee', id, 'Updated employee or operator profile');
  };

  const deactivateEmployee = (id: string) => {
    setEmployees((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: 'inactive' } : item))
    );
    addAudit('EMPLOYEE_DEACTIVATED', 'Employee', id, 'Marked employee status as inactive');
  };

  const renewOperatorLicense = (operatorId: string, newCraneExpiry?: string, newTransportExpiry?: string) => {
    setEmployees((prev) =>
      prev.map((emp) => {
        if (emp.id !== operatorId && emp.employeeId !== operatorId) return emp;
        return {
          ...emp,
          craneLicenseExpiry: newCraneExpiry || emp.craneLicenseExpiry,
          transportLicenseExpiry: newTransportExpiry || emp.transportLicenseExpiry,
        };
      })
    );
    addAudit('LICENSE_RENEWED', 'Employee', operatorId, `Renewed license expiry dates to Crane: ${newCraneExpiry || 'N/A'}`);
  };

  // Machines CRUD
  const addMachine = (m: Omit<MachineAsset, 'id'>): MachineAsset => {
    const newId = m.assetId || `CR-${String(machines.length + 1).padStart(3, '0')}`;
    const newMachine: MachineAsset = { ...m, id: newId, assetId: newId };
    setMachines((prev) => [newMachine, ...prev]);
    addAudit('ASSET_CREATED', 'MachineAsset', newId, `Registered crane asset: ${m.make} ${m.model}`);
    return newMachine;
  };

  const updateMachine = (id: string, m: Partial<MachineAsset>) => {
    setMachines((prev) => prev.map((item) => (item.id === id ? { ...item, ...m } : item)));
    addAudit('ASSET_UPDATED', 'MachineAsset', id, 'Updated machine parameters');
  };

  const recordServiceCompleted = (
    machineId: string,
    serviceDate: string,
    cost: number,
    notes?: string,
    provider?: string
  ) => {
    setMachines((prev) =>
      prev.map((m) => {
        if (m.id !== machineId && m.assetId !== machineId) return m;
        const nextDue = calculateNextServiceDate(serviceDate, m.serviceFrequencyValue, m.serviceFrequencyUnit);
        const newRecord = {
          id: `SRV-${Date.now()}`,
          serviceDate,
          serviceType: 'Completed Periodic Maintenance',
          serviceProvider: provider || 'Authorized Service Agency',
          cost,
          notes: notes || 'Periodic preventive servicing completed.',
          completedBy: currentUser.name,
        };
        return {
          ...m,
          lastServiceDate: serviceDate,
          nextServiceDueDate: nextDue,
          serviceHistory: [newRecord, ...m.serviceHistory],
        };
      })
    );
    addAudit('SERVICE_COMPLETED', 'MachineAsset', machineId, `Completed service. Next due date: ${calculateNextServiceDate(serviceDate, 60, 'days')}`);
  };

  const renewMachineInsurance = (
    machineId: string,
    newExpiry: string,
    provider?: string,
    policyNo?: string,
    renewalDate?: string
  ) => {
    setMachines((prev) =>
      prev.map((m) => {
        if (m.id !== machineId && m.assetId !== machineId) return m;
        const effectiveRenewalDate = renewalDate || currentDate;
        const finalExpiry =
          newExpiry || calculateExpiryFromInterval(effectiveRenewalDate, m.insuranceIntervalDays || 365);
        return {
          ...m,
          insuranceStartDate: effectiveRenewalDate,
          insuranceExpiryDate: finalExpiry,
          insuranceProvider: provider || m.insuranceProvider,
          insurancePolicyNumber: policyNo || m.insurancePolicyNumber,
        };
      })
    );
    addAudit('INSURANCE_RENEWED', 'MachineAsset', machineId, `Insurance policy renewed until ${newExpiry}`);
  };

  const renewMachinePuc = (
    machineId: string,
    newExpiry: string,
    pucNo?: string,
    renewalDate?: string
  ) => {
    setMachines((prev) =>
      prev.map((m) => {
        if (m.id !== machineId && m.assetId !== machineId) return m;
        const effectiveRenewalDate = renewalDate || currentDate;
        const finalExpiry =
          newExpiry || calculateExpiryFromInterval(effectiveRenewalDate, m.pucIntervalDays || 180);
        return {
          ...m,
          pucIssueDate: effectiveRenewalDate,
          pucExpiryDate: finalExpiry,
          pucNumber: pucNo || m.pucNumber,
        };
      })
    );
    addAudit('PUC_RENEWED', 'MachineAsset', machineId, `PUC renewed until ${newExpiry}`);
  };

  const renewMachineFitness = (
    machineId: string,
    newExpiry: string,
    fitNo?: string,
    testPassedDate?: string
  ) => {
    setMachines((prev) =>
      prev.map((m) => {
        if (m.id !== machineId && m.assetId !== machineId) return m;
        const effectiveTestDate = testPassedDate || currentDate;
        const finalExpiry =
          newExpiry || calculateExpiryFromInterval(effectiveTestDate, m.fitnessIntervalDays || 365);
        return {
          ...m,
          lastFitnessDate: effectiveTestDate,
          nextFitnessDueDate: finalExpiry,
          fitnessCertificateNumber: fitNo || m.fitnessCertificateNumber,
        };
      })
    );
    addAudit('FITNESS_RENEWED', 'MachineAsset', machineId, `Fitness certificate renewed until ${newExpiry}`);
  };

  // EMI CRUD
  const addEmiLoan = (loan: Omit<MachineEmiLoan, 'id'>): MachineEmiLoan => {
    const newId = `LOAN-${Date.now()}`;
    const newLoan: MachineEmiLoan = { ...loan, id: newId };
    setEmiLoans((prev) => [newLoan, ...prev]);
    addAudit('EMI_LOAN_CREATED', 'MachineEmiLoan', newId, `Added loan for asset ${loan.assetId}`);
    return newLoan;
  };

  const recordEmiPayment = (
    loanId: string,
    installmentNumber: number,
    paymentMode: string,
    reference?: string
  ) => {
    setEmiLoans((prev) =>
      prev.map((loan) => {
        if (loan.id !== loanId && loan.loanId !== loanId) return loan;

        let paidCount = loan.installmentsPaid;
        const updatedInstallments = loan.installments.map((inst) => {
          if (inst.installmentNumber === installmentNumber) {
            paidCount += 1;
            return {
              ...inst,
              status: 'paid' as const,
              amountPaid: inst.amountDue,
              paymentDate: currentDate,
              paymentMode,
              paymentReference: reference || 'DIRECT_TRANSFER',
            };
          }
          return inst;
        });

        // Compute next unpaid installment due date
        const nextPending = updatedInstallments.find((i) => i.status !== 'paid');
        const nextEmiDate = nextPending ? nextPending.dueDate : loan.loanEndDate;

        return {
          ...loan,
          installmentsPaid: paidCount,
          remainingInstallments: Math.max(0, loan.totalInstallments - paidCount),
          nextEmiDate,
          installments: updatedInstallments,
        };
      })
    );
    addAudit('EMI_PAID', 'MachineEmiLoan', loanId, `Recorded payment for installment #${installmentNumber}`);
  };

  // Attendance
  const addAttendanceRecord = (
    record: Omit<AttendanceRecord, 'id' | 'netWorkingMinutes' | 'netWorkingHours' | 'overtimeHours' | 'standardWorkingHours'>
  ): AttendanceRecord => {
    const { netWorkingMinutes, netWorkingHours, potentialOtHours } = calculateWorkingAndOt(
      record.startTime,
      record.endTime,
      record.unpaidBreakMinutes || 0,
      companySettings.standardShiftHours * 60
    );

    const project = projects.find((p) => p.id === record.projectId);
    const otRate = project?.overtimeRate || 0;

    const newRecord: AttendanceRecord = {
      ...record,
      id: `ATT-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      netWorkingMinutes,
      netWorkingHours,
      standardWorkingHours: companySettings.standardShiftHours,
      overtimeHours: potentialOtHours,
      appliedOtRate: otRate,
    };

    setAttendance((prev) => [newRecord, ...prev]);
    addAudit('ATTENDANCE_RECORDED', 'AttendanceRecord', newRecord.id, `Recorded attendance for ${record.operatorId} on ${record.date}`);
    return newRecord;
  };

  const bulkAddAttendance = (records: AttendanceRecord[]) => {
    setAttendance((prev) => [...records, ...prev]);
    addAudit('BULK_ATTENDANCE_ADDED', 'AttendanceRecord', 'BULK', `Bulk imported ${records.length} attendance rows`);
  };

  const approveAttendanceRecord = (id: string) => {
    setAttendance((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              approvalStatus: 'approved',
              approvedBy: currentUser.name,
              approvalDate: currentDate,
            }
          : item
      )
    );
    addAudit('ATTENDANCE_APPROVED', 'AttendanceRecord', id, 'Approved operator attendance');
  };

  const rejectAttendanceRecord = (id: string, reason?: string) => {
    setAttendance((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              approvalStatus: 'rejected',
              approvedBy: currentUser.name,
              remarks: (item.remarks ? item.remarks + ' | ' : '') + `Rejected: ${reason || 'Invalid log'}`,
            }
          : item
      )
    );
    addAudit('ATTENDANCE_REJECTED', 'AttendanceRecord', id, `Rejected attendance: ${reason}`);
  };

  const markOperatorAttendanceQuick = (params: {
    operatorId: string;
    date: string;
    status: AttendanceStatus;
    overtimeHours?: number;
    projectId?: string;
    machineId?: string;
    remarks?: string;
  }): AttendanceRecord => {
    const existingIndex = attendance.findIndex(
      (a) => (a.operatorId === params.operatorId || a.operatorId === params.operatorId) && a.date === params.date
    );

    const emp = employees.find((e) => e.id === params.operatorId || e.employeeId === params.operatorId);
    const targetProjectId = params.projectId || emp?.currentProjectId || projects[0]?.id || 'PRJ-001';
    const targetMachineId = params.machineId || emp?.currentMachineId || 'CR-001';
    const prj = projects.find((p) => p.id === targetProjectId);
    const otRate = prj?.overtimeRate || 150;

    const existingOt = existingIndex >= 0 ? attendance[existingIndex].overtimeHours : 0;
    const otHours = params.overtimeHours !== undefined ? Math.max(0, params.overtimeHours) : existingOt;

    let netHours = 0;
    if (params.status === 'present') {
      netHours = companySettings.standardShiftHours + otHours;
    } else if (params.status === 'half_day') {
      netHours = 5 + otHours;
    } else {
      netHours = 0;
    }

    let finalRecord: AttendanceRecord;

    if (existingIndex >= 0) {
      finalRecord = {
        ...attendance[existingIndex],
        status: params.status,
        projectId: targetProjectId,
        machineId: targetMachineId,
        overtimeHours: otHours,
        netWorkingHours: netHours,
        netWorkingMinutes: netHours * 60,
        appliedOtRate: otRate,
        approvalStatus: 'approved',
        approvedBy: currentUser.name,
        approvalDate: currentDate,
        remarks: params.remarks !== undefined ? params.remarks : attendance[existingIndex].remarks,
      };
      setAttendance((prev) => {
        const next = [...prev];
        next[existingIndex] = finalRecord;
        return next;
      });
    } else {
      finalRecord = {
        id: `ATT-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        date: params.date,
        operatorId: params.operatorId,
        projectId: targetProjectId,
        machineId: targetMachineId,
        startTime: '08:00',
        endTime: params.status === 'present' ? '18:00' : params.status === 'half_day' ? '13:00' : '08:00',
        unpaidBreakMinutes: 0,
        netWorkingMinutes: netHours * 60,
        netWorkingHours: netHours,
        standardWorkingHours: companySettings.standardShiftHours,
        overtimeHours: otHours,
        appliedOtRate: otRate,
        status: params.status,
        approvalStatus: 'approved',
        approvedBy: currentUser.name,
        approvalDate: currentDate,
        remarks: params.remarks || (otHours > 0 ? `Logged ${otHours}h OT` : 'Quick attendance marked'),
        enteredBy: currentUser.name,
      };
      setAttendance((prev) => [finalRecord, ...prev]);
    }

    addAudit(
      'ATTENDANCE_RECORDED',
      'AttendanceRecord',
      finalRecord.id,
      `Quick marked ${params.status} (${otHours}h OT) for ${emp?.fullName || params.operatorId} on ${params.date}`
    );

    return finalRecord;
  };

  const markAllOperatorsPresent = (params: { date: string; projectId?: string }): AttendanceRecord[] => {
    const activeOps = employees.filter((e) => e.employeeType === 'operator' && e.status === 'active');
    const createdOrUpdated: AttendanceRecord[] = [];

    setAttendance((prev) => {
      let nextList = [...prev];
      for (const op of activeOps) {
        const existingIdx = nextList.findIndex(
          (a) => (a.operatorId === op.id || a.operatorId === op.employeeId) && a.date === params.date
        );
        const prjId = params.projectId || op.currentProjectId || projects[0]?.id || 'PRJ-001';
        const prj = projects.find((p) => p.id === prjId);
        const otRate = prj?.overtimeRate || 150;

        if (existingIdx >= 0) {
          const rec = {
            ...nextList[existingIdx],
            status: 'present' as AttendanceStatus,
            approvalStatus: 'approved' as const,
            approvedBy: currentUser.name,
            approvalDate: currentDate,
          };
          nextList[existingIdx] = rec;
          createdOrUpdated.push(rec);
        } else {
          const newRecord: AttendanceRecord = {
            id: `ATT-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
            date: params.date,
            operatorId: op.id,
            projectId: prjId,
            machineId: op.currentMachineId || 'CR-001',
            startTime: '08:00',
            endTime: '18:00',
            unpaidBreakMinutes: 0,
            netWorkingMinutes: companySettings.standardShiftHours * 60,
            netWorkingHours: companySettings.standardShiftHours,
            standardWorkingHours: companySettings.standardShiftHours,
            overtimeHours: 0,
            appliedOtRate: otRate,
            status: 'present',
            approvalStatus: 'approved',
            approvedBy: currentUser.name,
            approvalDate: currentDate,
            remarks: 'Marked present via Quick Attendance bulk action',
            enteredBy: currentUser.name,
          };
          nextList = [newRecord, ...nextList];
          createdOrUpdated.push(newRecord);
        }
      }
      return nextList;
    });

    addAudit(
      'BULK_ATTENDANCE_ADDED',
      'AttendanceRecord',
      'ALL_OPERATORS',
      `Marked all ${activeOps.length} operators present on ${params.date}`
    );

    return createdOrUpdated;
  };

  const addOrUpdateOvertimeHours = (params: {
    operatorId: string;
    date: string;
    overtimeHours: number;
    projectId?: string;
    appliedOtRate?: number;
    remarks?: string;
  }): AttendanceRecord => {
    const existingIndex = attendance.findIndex(
      (a) => (a.operatorId === params.operatorId || a.operatorId === params.operatorId) && a.date === params.date
    );

    const emp = employees.find((e) => e.id === params.operatorId || e.employeeId === params.operatorId);
    const targetProjectId =
      params.projectId ||
      (existingIndex >= 0 ? attendance[existingIndex].projectId : emp?.currentProjectId) ||
      projects[0]?.id ||
      'PRJ-001';
    const prj = projects.find((p) => p.id === targetProjectId);
    const otRate = params.appliedOtRate !== undefined ? params.appliedOtRate : prj?.overtimeRate || 150;
    const validOtHours = Math.max(0, Number(params.overtimeHours) || 0);

    let finalRecord: AttendanceRecord;

    if (existingIndex >= 0) {
      const prevRec = attendance[existingIndex];
      const baseHours = prevRec.status === 'half_day' ? 5 : 10;
      const netHours = baseHours + validOtHours;
      finalRecord = {
        ...prevRec,
        status: prevRec.status === 'absent' ? 'present' : prevRec.status,
        projectId: targetProjectId,
        appliedOtRate: otRate,
        overtimeHours: validOtHours,
        netWorkingHours: netHours,
        netWorkingMinutes: netHours * 60,
        approvalStatus: 'approved',
        approvedBy: currentUser.name,
        approvalDate: currentDate,
        remarks: params.remarks || prevRec.remarks || `Day-wise overtime ${validOtHours}h logged`,
      };
      setAttendance((prev) => {
        const next = [...prev];
        next[existingIndex] = finalRecord;
        return next;
      });
    } else {
      const netHours = companySettings.standardShiftHours + validOtHours;
      finalRecord = {
        id: `ATT-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        date: params.date,
        operatorId: params.operatorId,
        projectId: targetProjectId,
        machineId: emp?.currentMachineId || 'CR-001',
        startTime: '08:00',
        endTime: '18:00',
        unpaidBreakMinutes: 0,
        netWorkingMinutes: netHours * 60,
        netWorkingHours: netHours,
        standardWorkingHours: companySettings.standardShiftHours,
        overtimeHours: validOtHours,
        appliedOtRate: otRate,
        status: 'present',
        approvalStatus: 'approved',
        approvedBy: currentUser.name,
        approvalDate: currentDate,
        remarks: params.remarks || `Day-wise overtime ${validOtHours}h logged`,
        enteredBy: currentUser.name,
      };
      setAttendance((prev) => [finalRecord, ...prev]);
    }

    addAudit(
      'OVERTIME_LOGGED',
      'AttendanceRecord',
      finalRecord.id,
      `Day-wise overtime: ${validOtHours}h @ ₹${otRate}/h for ${emp?.fullName || params.operatorId} on ${params.date}`
    );

    return finalRecord;
  };

  // Salary Advances
  const addAdvance = (
    adv: Omit<SalaryAdvance, 'id' | 'advanceId' | 'recoveryAmount' | 'outstandingBalance' | 'status'>
  ): SalaryAdvance => {
    const advId = `ADV-${String(advances.length + 1).padStart(3, '0')}`;
    const newAdv: SalaryAdvance = {
      ...adv,
      id: `ADV-${Date.now()}`,
      advanceId: advId,
      recoveryAmount: 0,
      outstandingBalance: adv.amount,
      status: 'approved',
    };
    setAdvances((prev) => [newAdv, ...prev]);
    addAudit('ADVANCE_GIVEN', 'SalaryAdvance', newAdv.id, `Disbursed advance ₹${adv.amount} to ${adv.employeeId}`);
    return newAdv;
  };

  const approveAdvance = (id: string) => {
    setAdvances((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: 'approved' } : item))
    );
    addAudit('ADVANCE_APPROVED', 'SalaryAdvance', id, 'Approved advance request');
  };

  // Payroll Engine
  const generatePayrollForMonth = (month: string): PayrollRun => {
    // E.g. month: "2026-10"
    const periodStart = `${month}-01`;
    const [yearStr, mStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const m = parseInt(mStr, 10);
    const daysInMonth = new Date(year, m, 0).getDate();
    const periodEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`;

    // Payment due date: 15th of next month
    const nextMonthYear = m === 12 ? year + 1 : year;
    const nextMonth = m === 12 ? 1 : m + 1;
    const paymentDueDate = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-${String(companySettings.payrollPaymentDay).padStart(2, '0')}`;

    // Get all approved attendance records in this month
    const relevantAttendance = attendance.filter(
      (a) => a.date.startsWith(month) && a.approvalStatus === 'approved'
    );

    // Compute entries for each active employee
    const activeEmployees = employees.filter((e) => e.status === 'active');
    const entries = activeEmployees.map((emp) => {
      const empAtt = relevantAttendance.filter(
        (a) => a.operatorId === emp.id || a.operatorId === emp.employeeId
      );

      let presentDays = 0;
      let halfDays = 0;
      let paidLeaveDays = 0;
      let unpaidLeaveDays = 0;
      let weeklyOffDays = 0;
      let holidayDays = 0;

      // Group overtime by project
      const otByProjectMap = new Map<string, { otHours: number; otRate: number; projectName: string }>();

      empAtt.forEach((rec) => {
        if (rec.status === 'present') presentDays++;
        else if (rec.status === 'half_day') halfDays++;
        else if (rec.status === 'paid_leave') paidLeaveDays++;
        else if (rec.status === 'unpaid_leave') unpaidLeaveDays++;
        else if (rec.status === 'weekly_off') weeklyOffDays++;
        else if (rec.status === 'holiday') holidayDays++;

        if (rec.overtimeHours > 0) {
          const prj = projects.find((p) => p.id === rec.projectId);
          const currentOt = otByProjectMap.get(rec.projectId) || {
            otHours: 0,
            otRate: rec.appliedOtRate || prj?.overtimeRate || 0,
            projectName: prj?.name || rec.projectId,
          };
          currentOt.otHours += rec.overtimeHours;
          otByProjectMap.set(rec.projectId, currentOt);
        }
      });

      // Calculate payable days: present + (halfDay * 0.5) + paidLeave + weeklyOff (if paid) + holidays
      // In Indian enterprise practice, daily-rated operators earn base for worked days, or worked + holidays if stipulated.
      // Here: presentDays + halfDays * 0.5. For monthly employees: daysInMonth - unpaidLeaveDays.
      const payableDays =
        emp.salaryType === 'daily'
          ? Math.max(0, presentDays + halfDays * 0.5)
          : Math.max(0, daysInMonth - unpaidLeaveDays);

      const effectivePayableDays =
        empAtt.length > 0 ? payableDays : (emp.salaryType === 'daily' ? 24 : daysInMonth);
      const effectivePresentDays = empAtt.length > 0 ? presentDays : 24;

      const otProjectBreakdown = Array.from(otByProjectMap.entries()).map(([projectId, data]) => ({
        projectId,
        projectName: data.projectName,
        otHours: data.otHours,
        otRate: data.otRate,
      }));

      // Find outstanding advance for this employee
      const activeAdvance = advances.find(
        (adv) =>
          (adv.employeeId === emp.id || adv.employeeId === emp.employeeId) &&
          adv.outstandingBalance > 0 &&
          adv.status !== 'cancelled'
      );
      const outstandingAdvance = activeAdvance ? activeAdvance.outstandingBalance : 0;

      const calc = calculatePayrollEntry({
        salaryType: emp.salaryType,
        dailyRate: emp.dailyRate,
        monthlySalary: emp.monthlySalary,
        totalDaysInMonth: daysInMonth,
        payableDays: effectivePayableDays,
        otProjectBreakdown,
        allowances: 0,
        approvedOutstandingAdvance: outstandingAdvance,
        maxAdvanceRecoveryRequested: Math.min(outstandingAdvance, 2500),
      });

      return {
        id: `PE-${emp.employeeId}-${Date.now()}`,
        payrollRunId: '',
        employeeId: emp.id,
        employeeName: emp.fullName,
        employeeCode: emp.employeeId,
        designation: emp.designation,
        salaryType: emp.salaryType,
        appliedDailyRate: emp.dailyRate,
        appliedMonthlyRate: emp.monthlySalary,
        standardShiftHours: emp.standardShiftHours || 10,
        totalDaysInMonth: daysInMonth,
        presentDays: effectivePresentDays,
        halfDays,
        paidLeaveDays,
        unpaidLeaveDays,
        weeklyOffDays: weeklyOffDays || 4,
        holidayDays: holidayDays || 2,
        payableDays: effectivePayableDays,
        baseSalary: calc.baseSalary,
        totalOtHours: calc.totalOtHours,
        otAmount: calc.totalOtAmount,
        projectOtBreakdown: calc.projectOtBreakdown,
        allowances: 0,
        grossSalary: calc.grossSalary,
        advanceRecovery: calc.advanceRecovery,
        otherDeductions: calc.otherDeductions,
        totalDeductions: calc.totalDeductions,
        netSalary: calc.netSalary,
        paymentStatus: 'unpaid' as const,
      };
    });

    const runId = `PR-${month}`;
    const newRun: PayrollRun = {
      id: runId,
      month,
      periodStart,
      periodEnd,
      paymentDueDate,
      status: 'draft',
      locked: false,
      employeeCount: entries.length,
      totalBaseSalary: entries.reduce((s, e) => s + e.baseSalary, 0),
      totalOvertimeSalary: entries.reduce((s, e) => s + e.otAmount, 0),
      totalAllowances: entries.reduce((s, e) => s + e.allowances, 0),
      totalGrossSalary: entries.reduce((s, e) => s + e.grossSalary, 0),
      totalAdvancesRecovered: entries.reduce((s, e) => s + e.advanceRecovery, 0),
      totalOtherDeductions: entries.reduce((s, e) => s + e.otherDeductions, 0),
      totalNetSalary: entries.reduce((s, e) => s + e.netSalary, 0),
      totalPaidAmount: 0,
      entries: entries.map((e) => ({ ...e, payrollRunId: runId })),
    };

    setPayrollRuns((prev) => [newRun, ...prev.filter((r) => r.id !== runId)]);
    addAudit('PAYROLL_GENERATED', 'PayrollRun', runId, `Generated draft payroll for ${month}`);
    return newRun;
  };

  const approvePayrollRun = (id: string) => {
    setPayrollRuns((prev) =>
      prev.map((run) => {
        if (run.id !== id) return run;

        // Apply advance recoveries to the advances database table!
        run.entries.forEach((entry) => {
          if (entry.advanceRecovery > 0) {
            setAdvances((prevAdv) =>
              prevAdv.map((adv) => {
                if (
                  (adv.employeeId === entry.employeeId || adv.employeeId === entry.employeeCode) &&
                  adv.outstandingBalance > 0
                ) {
                  const newRec = adv.recoveryAmount + entry.advanceRecovery;
                  const newBal = Math.max(0, adv.amount - newRec);
                  return {
                    ...adv,
                    recoveryAmount: newRec,
                    outstandingBalance: newBal,
                    status: newBal === 0 ? 'fully_recovered' : 'partially_recovered',
                  };
                }
                return adv;
              })
            );
          }
        });

        return {
          ...run,
          status: 'approved',
          locked: true,
          approvedAt: new Date().toISOString(),
          approvedBy: currentUser.name,
        };
      })
    );
    addAudit('PAYROLL_APPROVED', 'PayrollRun', id, 'Owner approved and locked payroll run. Advance balances updated.');
  };

  const markPayrollEntryPaid = (payrollRunId: string, entryId: string, paymentMode: string, ref?: string) => {
    setPayrollRuns((prev) =>
      prev.map((run) => {
        if (run.id !== payrollRunId) return run;
        let totalPaid = 0;
        const updatedEntries = run.entries.map((entry) => {
          if (entry.id === entryId) {
            totalPaid += entry.netSalary;
            return {
              ...entry,
              paymentStatus: 'paid' as const,
              paymentDate: currentDate,
              paymentMode,
              paymentReference: ref || 'NEFT-PROCESSED',
            };
          }
          if (entry.paymentStatus === 'paid') {
            totalPaid += entry.netSalary;
          }
          return entry;
        });

        const allPaid = updatedEntries.every((e) => e.paymentStatus === 'paid');
        return {
          ...run,
          totalPaidAmount: totalPaid,
          status: allPaid ? 'paid' : 'partially_paid',
          entries: updatedEntries,
        };
      })
    );
    addAudit('PAYROLL_PAYMENT_RECORDED', 'PayrollEntry', entryId, `Recorded salary payment via ${paymentMode}`);
  };

  // Expenses CRUD
  const addExpense = (exp: Omit<ProjectExpense, 'id' | 'expenseId'>): ProjectExpense => {
    const newId = `EXP-${Date.now()}`;
    const code = `EXP-${String(expenses.length + 1).padStart(3, '0')}`;
    const newExp: ProjectExpense = {
      ...exp,
      id: newId,
      expenseId: code,
      approvalStatus: currentUser.role === 'owner' ? 'approved' : 'pending',
      approvedBy: currentUser.role === 'owner' ? currentUser.name : undefined,
    };
    setExpenses((prev) => [newExp, ...prev]);
    addAudit('EXPENSE_CREATED', 'ProjectExpense', newId, `Added expense ₹${exp.amount} (${exp.category}) for ${exp.projectId}`);
    return newExp;
  };

  const approveExpense = (id: string) => {
    setExpenses((prev) =>
      prev.map((e) => (e.id === id ? { ...e, approvalStatus: 'approved', approvedBy: currentUser.name } : e))
    );
    addAudit('EXPENSE_APPROVED', 'ProjectExpense', id, 'Approved project expense voucher');
  };

  // Machine Working Hours
  const addMachineWorkingLog = (
    log: Omit<MachineWorkingLog, 'id' | 'workingMinutes' | 'workingHours'>
  ): MachineWorkingLog => {
    const { netWorkingMinutes, netWorkingHours } = calculateWorkingAndOt(
      log.startTime,
      log.endTime,
      log.idleMinutes || 0,
      1440 // whole span for machine
    );

    const newLog: MachineWorkingLog = {
      ...log,
      id: `MWL-${Date.now()}`,
      workingMinutes: netWorkingMinutes,
      workingHours: netWorkingHours,
      approvalStatus: 'approved',
    };

    setMachineWorkingLogs((prev) => [newLog, ...prev]);
    addAudit('MACHINE_HOURS_LOGGED', 'MachineWorkingLog', newLog.id, `Logged ${netWorkingHours}h for machine ${log.machineId}`);
    return newLog;
  };

  const importMachineWorkingLogs = (logs: Omit<MachineWorkingLog, 'id'>[]): number => {
    const formatted = logs.map((log) => ({
      ...log,
      id: `MWL-IMP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    }));
    setMachineWorkingLogs((prev) => [...formatted, ...prev]);
    addAudit('MACHINE_HOURS_EXCEL_IMPORTED', 'MachineWorkingLog', 'IMPORT_BATCH', `Imported ${logs.length} machine operational hours`);
    return logs.length;
  };

  const markNotificationRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  // ==========================================
  // DYNAMIC RED ALERT ENGINE
  // Categorizes Overdue, Due Today, Upcoming
  // ==========================================

  // 1. MACHINE EMI
  const getEmiAlerts = (): ReminderAlertItem[] => {
    const alerts: ReminderAlertItem[] = [];
    emiLoans.forEach((loan) => {
      loan.installments.forEach((inst) => {
        if (inst.status === 'paid') return;
        const lead = loan.reminderLeadDays || companySettings.emiReminderLeadDays || 15;
        const evalRes = evaluateReminderStatus(inst.dueDate, lead, currentDate);
        if (evalRes.status !== 'none') {
          alerts.push({
            id: `EMI-ALERT-${loan.id}-${inst.installmentNumber}`,
            category: 'emi',
            categoryHeading: 'MACHINE EMI REMINDERS',
            title: `${loan.assetId} – EMI Payment #${inst.installmentNumber}`,
            subtitle: `${loan.loanProvider} | Installment ₹${loan.emiAmount.toLocaleString('en-IN')}`,
            targetId: loan.assetId,
            targetType: 'loan',
            dueDate: inst.dueDate,
            amount: inst.amountDue,
            daysRemaining: evalRes.daysRemaining,
            status: evalRes.status,
            urgencyLabel: evalRes.label,
            actionLabel: 'Pay EMI',
          });
        }
      });
    });
    // Sort: Overdue first, then Due Today, then Upcoming
    return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
  };

  // 2. MACHINE SERVICE
  const getServiceAlerts = (): ReminderAlertItem[] => {
    const alerts: ReminderAlertItem[] = [];
    machines.forEach((m) => {
      const lead = m.serviceReminderLeadDays || companySettings.serviceReminderLeadDays || 15;
      const evalRes = evaluateReminderStatus(m.nextServiceDueDate, lead, currentDate);
      if (evalRes.status !== 'none') {
        alerts.push({
          id: `SRV-ALERT-${m.id}`,
          category: 'service',
          categoryHeading: 'MACHINE SERVICE REMINDERS',
          title: `${m.assetId} – ${m.make} ${m.model} (${m.machineType})`,
          subtitle: `Last Serviced: ${m.lastServiceDate || 'N/A'} (Every ${m.serviceFrequencyValue} ${m.serviceFrequencyUnit})`,
          targetId: m.id,
          targetType: 'machine',
          dueDate: m.nextServiceDueDate,
          daysRemaining: evalRes.daysRemaining,
          status: evalRes.status,
          urgencyLabel: evalRes.label,
          actionLabel: 'Record Service',
        });
      }
    });
    return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
  };

  // 3. INSURANCE RENEWAL
  const getInsuranceAlerts = (): ReminderAlertItem[] => {
    const alerts: ReminderAlertItem[] = [];
    machines.forEach((m) => {
      const lead = m.insuranceReminderLeadDays || companySettings.insuranceReminderLeadDays || 15;
      const evalRes = evaluateReminderStatus(m.insuranceExpiryDate, lead, currentDate);
      if (evalRes.status !== 'none') {
        alerts.push({
          id: `INS-ALERT-${m.id}`,
          category: 'insurance',
          categoryHeading: 'INSURANCE RENEWAL REMINDERS',
          title: `${m.assetId} – ${m.insuranceProvider}`,
          subtitle: `Policy #${m.insurancePolicyNumber || 'N/A'} | Reg: ${m.registrationNumber}`,
          targetId: m.id,
          targetType: 'machine',
          dueDate: m.insuranceExpiryDate,
          daysRemaining: evalRes.daysRemaining,
          status: evalRes.status,
          urgencyLabel: evalRes.label,
          actionLabel: 'Renew Insurance',
        });
      }
    });
    return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
  };

  // 4. PUC RENEWAL
  const getPucAlerts = (): ReminderAlertItem[] => {
    const alerts: ReminderAlertItem[] = [];
    machines.forEach((m) => {
      const lead = m.pucReminderLeadDays || companySettings.pucReminderLeadDays || 15;
      const evalRes = evaluateReminderStatus(m.pucExpiryDate, lead, currentDate);
      if (evalRes.status !== 'none') {
        alerts.push({
          id: `PUC-ALERT-${m.id}`,
          category: 'puc',
          categoryHeading: 'PUC RENEWAL REMINDERS',
          title: `${m.assetId} – Pollution Under Control Certificate`,
          subtitle: `Cert #${m.pucNumber || 'N/A'} | Reg: ${m.registrationNumber}`,
          targetId: m.id,
          targetType: 'machine',
          dueDate: m.pucExpiryDate,
          daysRemaining: evalRes.daysRemaining,
          status: evalRes.status,
          urgencyLabel: evalRes.label,
          actionLabel: 'Renew PUC',
        });
      }
    });
    return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
  };

  // 5. FITNESS TEST
  const getFitnessAlerts = (): ReminderAlertItem[] => {
    const alerts: ReminderAlertItem[] = [];
    machines.forEach((m) => {
      const lead = m.fitnessReminderLeadDays || companySettings.fitnessReminderLeadDays || 15;
      const evalRes = evaluateReminderStatus(m.nextFitnessDueDate, lead, currentDate);
      if (evalRes.status !== 'none') {
        alerts.push({
          id: `FIT-ALERT-${m.id}`,
          category: 'fitness',
          categoryHeading: 'FITNESS TEST REMINDERS',
          title: `${m.assetId} – RTO Road Fitness Certificate`,
          subtitle: `Fitness Cert #${m.fitnessCertificateNumber || 'N/A'} | Reg: ${m.registrationNumber}`,
          targetId: m.id,
          targetType: 'machine',
          dueDate: m.nextFitnessDueDate,
          daysRemaining: evalRes.daysRemaining,
          status: evalRes.status,
          urgencyLabel: evalRes.label,
          actionLabel: 'Renew Fitness',
        });
      }
    });
    return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
  };

  // 6. OPERATOR LICENSE RENEWAL
  const getLicenseAlerts = (): ReminderAlertItem[] => {
    const alerts: ReminderAlertItem[] = [];
    employees.forEach((emp) => {
      if (emp.employeeType !== 'operator') return;
      const lead = companySettings.licenseReminderLeadDays || 15;

      // Crane License Check
      if (emp.craneLicenseExpiry) {
        const evalRes = evaluateReminderStatus(emp.craneLicenseExpiry, lead, currentDate);
        if (evalRes.status !== 'none') {
          alerts.push({
            id: `LIC-CRANE-${emp.id}`,
            category: 'license',
            categoryHeading: 'OPERATOR LICENSE RENEWAL REMINDERS',
            title: `${emp.fullName} (${emp.employeeId}) – Crane License`,
            subtitle: `Lic #${emp.licenseNumber || 'N/A'} | Mobile: ${emp.mobile}`,
            targetId: emp.id,
            targetType: 'operator',
            dueDate: emp.craneLicenseExpiry,
            daysRemaining: evalRes.daysRemaining,
            status: evalRes.status,
            urgencyLabel: evalRes.label,
            actionLabel: 'Update License',
          });
        }
      }

      // Transport License Check
      if (emp.transportLicenseExpiry) {
        const evalRes = evaluateReminderStatus(emp.transportLicenseExpiry, lead, currentDate);
        if (evalRes.status !== 'none') {
          alerts.push({
            id: `LIC-TR-${emp.id}`,
            category: 'license',
            categoryHeading: 'OPERATOR LICENSE RENEWAL REMINDERS',
            title: `${emp.fullName} (${emp.employeeId}) – Transport License`,
            subtitle: `Heavy Vehicle Commercial Transport License`,
            targetId: emp.id,
            targetType: 'operator',
            dueDate: emp.transportLicenseExpiry,
            daysRemaining: evalRes.daysRemaining,
            status: evalRes.status,
            urgencyLabel: evalRes.label,
            actionLabel: 'Update License',
          });
        }
      }
    });
    return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
  };

  const resetToDemoData = () => {
    localStorage.clear();
    setCompanySettings(INITIAL_COMPANY_SETTINGS);
    setCurrentUser(INITIAL_USERS[0]);
    setProjects(INITIAL_PROJECTS);
    setEmployees(INITIAL_EMPLOYEES);
    setMachines(INITIAL_MACHINES);
    setEmiLoans(INITIAL_EMI_LOANS);
    setAdvances(INITIAL_ADVANCES);
    setAttendance(generateSeedAttendance());
    setExpenses(INITIAL_EXPENSES);
    setMachineWorkingLogs(INITIAL_MACHINE_WORKING);
    setPayrollRuns(INITIAL_PAYROLL_RUNS);
    setAuditLogs([]);
    addAudit('DATABASE_RESET', 'System', 'ALL', 'Reset all records back to seed demo dataset.');
  };

  return (
    <SkyhookContext.Provider
      value={{
        currentUser,
        isAuthenticated,
        login,
        logout,
        setCurrentUserRole,
        availableUsers,
        updateUserRole,
        addUser,
        deleteUser,
        companySettings,
        updateCompanySettings,
        projects,
        addProject,
        updateProject,
        deleteProject,
        employees,
        addEmployee,
        updateEmployee,
        deactivateEmployee,
        renewOperatorLicense,
        machines,
        addMachine,
        updateMachine,
        recordServiceCompleted,
        renewMachineInsurance,
        renewMachinePuc,
        renewMachineFitness,
        emiLoans,
        addEmiLoan,
        recordEmiPayment,
        attendance,
        addAttendanceRecord,
        bulkAddAttendance,
        approveAttendanceRecord,
        rejectAttendanceRecord,
        markOperatorAttendanceQuick,
        markAllOperatorsPresent,
        addOrUpdateOvertimeHours,
        advances,
        addAdvance,
        approveAdvance,
        payrollRuns,
        generatePayrollForMonth,
        approvePayrollRun,
        markPayrollEntryPaid,
        expenses,
        addExpense,
        approveExpense,
        machineWorkingLogs,
        addMachineWorkingLog,
        importMachineWorkingLogs,
        auditLogs,
        notifications,
        markNotificationRead,
        getEmiAlerts,
        getServiceAlerts,
        getInsuranceAlerts,
        getPucAlerts,
        getFitnessAlerts,
        getLicenseAlerts,
        currentDate,
        resetToDemoData,
      }}
    >
      {children}
    </SkyhookContext.Provider>
  );
};

export const useSkyhook = (): SkyhookStoreContextType => {
  const context = useContext(SkyhookContext);
  if (!context) {
    throw new Error('useSkyhook must be used within a SkyhookProvider');
  }
  return context;
};
