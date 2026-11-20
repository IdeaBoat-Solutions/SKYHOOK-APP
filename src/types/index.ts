export type UserRole = 'owner' | 'manager';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  avatarUrl?: string;
  department?: string;
  /** Tenant slug from the public profile list; used by the login endpoint. */
  tenantSlug?: string;
  password?: string;
  assignedProjectIds?: string[];
}

export interface CompanySettings {
  name: string;
  tagline: string;
  logoUrl: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  gstNumber: string;
  authorizedSignatory: string;
  signatoryTitle: string;
  standardShiftHours: number; // 10
  payrollPaymentDay: number; // 15
  payrollCycleType: 'calendar_month' | 'custom_26_to_25';
  shortShiftPolicy: 'half_day_under_5' | 'proportional' | 'manual';
  // Lead times in days
  emiReminderLeadDays: number;
  serviceReminderLeadDays: number;
  insuranceReminderLeadDays: number;
  pucReminderLeadDays: number;
  fitnessReminderLeadDays: number;
  licenseReminderLeadDays: number;
}

export type EmployeeType = 'operator' | 'manager' | 'supervisor' | 'accounts' | 'office' | 'other';
export type SalaryType = 'daily' | 'monthly';
export type EmploymentStatus = 'active' | 'inactive' | 'on_leave' | 'terminated';

export interface EmergencyContact {
  id: string;
  name: string;
  mobile: string;
  relation: string;
}

export interface DocumentRecord {
  id: string;
  type: string;
  name: string;
  fileUrl: string;
  uploadDate: string;
  expiryDate?: string;
  sizeKb?: number;
}

export interface Employee {
  id: string;
  employeeId: string; // e.g. EMP-001 or OP-001
  fullName: string;
  mobile: string;
  email?: string;
  dateOfBirth: string;
  joiningDate: string;
  designation: string;
  employeeType: EmployeeType;
  address: string;
  status: EmploymentStatus;
  profilePhoto?: string;
  remarks?: string;

  // Salary Configuration
  salaryType: SalaryType;
  dailyRate: number; // e.g. 900
  monthlySalary: number; // e.g. 25000
  standardShiftHours: number; // 10
  overtimeEligible: boolean;
  salaryEffectiveDate: string;

  // Operator-Specific Fields
  licenseNumber?: string;
  craneLicenseDate?: string; // issue date
  craneLicenseExpiry?: string; // expiry date
  transportLicenseDate?: string; // issue date
  transportLicenseExpiry?: string; // expiry date
  currentProjectId?: string;
  currentMachineId?: string;

  emergencyContacts: EmergencyContact[];
  documents: DocumentRecord[];
}

export type ProjectStatus = 'upcoming' | 'active' | 'on_hold' | 'completed' | 'cancelled';

export interface Project {
  id: string;
  projectId: string; // PRJ-001
  name: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  location: string;
  siteAddress: string;
  city: string;
  state: string;
  startDate: string;
  expectedEndDate: string;
  actualEndDate?: string;
  managerId: string; // linked user
  description?: string;
  overtimeRate: number; // ₹ per hour for this project
  contractValue?: number;
  status: ProjectStatus;
}

export interface ProjectAssignment {
  id: string;
  projectId: string;
  operatorId: string;
  machineId?: string;
  startDate: string;
  endDate?: string;
  notes?: string;
  isActive: boolean;
}

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'half_day'
  | 'paid_leave'
  | 'unpaid_leave'
  | 'weekly_off'
  | 'holiday';

export type ApprovalStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface AttendanceRecord {
  id: string;
  date: string; // YYYY-MM-DD
  operatorId: string;
  projectId: string;
  machineId?: string;
  startTime: string; // HH:mm or full ISO
  endTime: string; // HH:mm or full ISO
  unpaidBreakMinutes: number;
  netWorkingMinutes: number;
  netWorkingHours: number;
  standardWorkingHours: number; // 10
  overtimeHours: number;
  appliedOtRate: number;
  status: AttendanceStatus;
  approvalStatus: ApprovalStatus;
  remarks?: string;
  enteredBy: string;
  approvedBy?: string;
  approvalDate?: string;
}

export type AdvanceStatus =
  | 'pending'
  | 'approved'
  | 'partially_recovered'
  | 'fully_recovered'
  | 'cancelled';

export interface SalaryAdvance {
  id: string;
  advanceId: string; // ADV-001
  employeeId: string;
  date: string;
  amount: number;
  paymentMode: 'cash' | 'bank_transfer' | 'upi' | 'cheque';
  paymentReference?: string;
  projectId?: string;
  remarks?: string;
  approvedBy: string;
  recoveryAmount: number; // total recovered so far
  outstandingBalance: number; // amount - recoveryAmount
  status: AdvanceStatus;
}

export interface SalaryAdvanceRecovery {
  id: string;
  advanceId: string;
  payrollRunId: string;
  payrollEntryId: string;
  recoveryAmount: number;
  recoveryDate: string;
}

export type PayrollStatus = 'draft' | 'under_review' | 'approved' | 'partially_paid' | 'paid';

export interface ProjectOtBreakdown {
  projectId: string;
  projectName: string;
  otHours: number;
  otRate: number;
  amount: number;
}

export interface PayrollEntry {
  id: string;
  payrollRunId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  salaryType: SalaryType;
  appliedDailyRate: number;
  appliedMonthlyRate: number;
  standardShiftHours: number;

  totalDaysInMonth: number;
  presentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  weeklyOffDays: number;
  holidayDays: number;
  payableDays: number;

  baseSalary: number;
  totalOtHours: number;
  otAmount: number;
  projectOtBreakdown: ProjectOtBreakdown[];
  allowances: number;
  grossSalary: number;

  advanceRecovery: number;
  otherDeductions: number;
  totalDeductions: number;
  netSalary: number;

  paymentStatus: 'unpaid' | 'paid';
  paymentDate?: string;
  paymentMode?: string;
  paymentReference?: string;
}

export interface PayrollRun {
  id: string;
  month: string; // YYYY-MM (e.g. 2026-10)
  periodStart: string; // 2026-10-01
  periodEnd: string; // 2026-10-31
  paymentDueDate: string; // 2026-11-15
  status: PayrollStatus;
  approvedAt?: string;
  approvedBy?: string;
  locked: boolean;

  employeeCount: number;
  totalBaseSalary: number;
  totalOvertimeSalary: number;
  totalAllowances: number;
  totalGrossSalary: number;
  totalAdvancesRecovered: number;
  totalOtherDeductions: number;
  totalNetSalary: number;
  totalPaidAmount: number;

  entries: PayrollEntry[];
}

export interface ProjectExpense {
  id: string;
  expenseId: string; // EXP-001
  projectId: string;
  date: string;
  category: string; // 'Diesel' | 'Fuel' | 'Machine Repair' | 'Spare Parts' | ...
  description: string;
  amount: number;
  paymentMode: 'cash' | 'company_card' | 'bank_transfer' | 'upi';
  paidBy: string;
  vendor?: string;
  receiptNumber?: string;
  receiptUrl?: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  remarks?: string;
}

export type MachineType =
  | 'Hydraulic Crane'
  | 'Mobile Crane'
  | 'Crawler Crane'
  | 'Tower Crane'
  | 'Hydra'
  | 'All Terrain Crane'
  | 'Rough Terrain Crane'
  | 'Other';

export type AssetStatus = 'available' | 'assigned' | 'under_maintenance' | 'inactive' | 'sold';

export interface ServiceRecord {
  id: string;
  serviceDate: string;
  serviceType: string;
  serviceProvider: string;
  cost: number;
  odometerOrHours?: number;
  notes?: string;
  invoiceUrl?: string;
  completedBy: string;
}

export interface MachineAsset {
  id: string;
  assetId: string; // CR-001
  machineType: MachineType;
  make: string; // e.g. Liebherr, Kato, ACE, Sany, Zoomlion, Escorts
  model: string; // e.g. LTM 1100, F-150, 14XW
  registrationNumber: string; // e.g. MH-12-AB-1234
  serialNumber: string;
  tonnageCapacity: number; // in Tonnes
  purchaseDate: string;
  purchaseCost: number;
  currentProjectId?: string;
  assignedOperatorId?: string;
  status: AssetStatus;
  photoUrl?: string;

  // Servicing Details
  lastServiceDate: string;
  serviceFrequencyValue: number; // e.g. 60
  serviceFrequencyUnit: 'days' | 'months';
  nextServiceDueDate: string;
  serviceReminderLeadDays: number; // default 7 or 15

  // Insurance Details
  insuranceProvider: string;
  insurancePolicyNumber: string;
  insuranceStartDate: string;
  insuranceExpiryDate: string;
  insuranceIntervalDays?: number; // e.g. 365 days
  insuranceReminderLeadDays: number;

  // PUC Details
  pucNumber?: string;
  pucIssueDate: string;
  pucExpiryDate: string;
  pucIntervalDays?: number; // e.g. 180 or 365 days
  pucReminderLeadDays: number;

  // Fitness Certificate Details
  fitnessCertificateNumber?: string;
  lastFitnessDate: string;
  nextFitnessDueDate: string;
  fitnessIntervalDays?: number; // e.g. 365 days
  fitnessReminderLeadDays: number;

  serviceHistory: ServiceRecord[];
  documents: DocumentRecord[];
}

export type EmiStatus = 'upcoming' | 'due_today' | 'overdue' | 'paid' | 'partially_paid';

export interface EmiInstallment {
  id: string;
  loanId: string;
  installmentNumber: number;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  paymentDate?: string;
  paymentMode?: string;
  paymentReference?: string;
  status: EmiStatus;
  proofUrl?: string;
  remarks?: string;
}

export interface MachineEmiLoan {
  id: string;
  loanId: string; // LOAN-001
  assetId: string; // Machine ID
  loanProvider: string; // e.g. HDFC Bank Equipment Finance, Tata Capital
  loanRefNumber: string;
  loanStartDate: string;
  loanEndDate: string;
  emiAmount: number;
  monthlyDueDay: number; // e.g. 10th of every month
  totalInstallments: number;
  installmentsPaid: number;
  remainingInstallments: number;
  nextEmiDate: string;
  reminderLeadDays: number;
  installments: EmiInstallment[];
}

export interface MachineWorkingLog {
  id: string;
  date: string;
  machineId: string;
  projectId: string;
  operatorId: string;
  startTime: string; // e.g. 09:00
  endTime: string; // e.g. 18:00
  idleMinutes: number;
  workingMinutes: number;
  workingHours: number;
  remarks?: string;
  enteredBy: string;
  approvalStatus: 'draft' | 'approved';
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  previousValue?: string;
  updatedValue?: string;
  reason?: string;
}

export type ReminderCategory =
  | 'emi'
  | 'service'
  | 'insurance'
  | 'puc'
  | 'fitness'
  | 'license'
  | 'payroll'
  | 'attendance';

export interface ReminderAlertItem {
  id: string;
  category: ReminderCategory;
  categoryHeading: string;
  title: string;
  subtitle: string;
  targetId: string; // Machine ID, Loan ID, Operator ID, etc.
  targetType: 'machine' | 'loan' | 'operator' | 'payroll' | 'attendance';
  dueDate: string;
  amount?: number;
  daysRemaining: number; // < 0 is overdue, 0 is due today, > 0 is upcoming
  status: 'overdue' | 'due_today' | 'upcoming';
  urgencyLabel: string;
  actionLabel: string;
}

export interface InAppNotification {
  id: string;
  category: ReminderCategory;
  title: string;
  description: string;
  relatedRecordId: string;
  dueDate: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  read: boolean;
  createdAt: string;
}
