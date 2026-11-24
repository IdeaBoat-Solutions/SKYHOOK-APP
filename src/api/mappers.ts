/** Map API rows (snake_case, integer paise) to frontend domain types (camelCase, rupees). */
import type {
  User, CompanySettings, Project, Employee, MachineAsset, AttendanceRecord,
  SalaryAdvance, PayrollRun, PayrollEntry, ProjectExpense, MachineEmiLoan,
  EmiInstallment, MachineWorkingLog, AuditLog, InAppNotification,
  ServiceRecord, PayrollAdjustment, PersonalRecord, MachineType, RcDetails, DocumentRecord,
  ContractorRecord, ExtractedDocument,
} from '../types';

const rupees = (paise: number | null | undefined): number => Math.round((paise ?? 0) / 100);
const str = (v: unknown): string => (v == null ? '' : String(v));

/** UI label <-> database enum for machine types ('Hydraulic Crane' <-> 'hydraulic_crane'). */
const MACHINE_TYPE_LABELS: Record<string, MachineType> = {
  hydraulic_crane: 'Hydraulic Crane', mobile_crane: 'Mobile Crane', crawler_crane: 'Crawler Crane',
  tower_crane: 'Tower Crane', hydra: 'Hydra', all_terrain_crane: 'All Terrain Crane',
  rough_terrain_crane: 'Rough Terrain Crane', other: 'Other',
};

export function machineTypeToApi(label: MachineType | string): string {
  const hit = Object.entries(MACHINE_TYPE_LABELS).find(([, l]) => l === label);
  if (hit) return hit[0];
  return label in MACHINE_TYPE_LABELS ? label : 'other';
}

export function machineTypeFromApi(value: unknown): MachineType {
  return MACHINE_TYPE_LABELS[String(value)] ?? (Object.values(MACHINE_TYPE_LABELS).includes(value as MachineType) ? (value as MachineType) : 'Other');
}

function mapRcDetails(v: unknown): RcDetails | undefined {
  const obj = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  return obj && typeof obj === 'object' && Object.keys(obj).length ? (obj as RcDetails) : undefined;
}

export function mapDocument(r: any): DocumentRecord {
  return {
    id: r.id, type: r.doc_type ?? '', name: r.name ?? '', fileUrl: r.object_key ?? '',
    uploadDate: str(r.uploaded_at).slice(0, 10), expiryDate: r.expiry_date ? str(r.expiry_date).slice(0, 10) : undefined,
    sizeKb: r.size_kb ?? undefined,
  };
}

function mapJsonObject(v: unknown): Record<string, any> {
  if (v && typeof v === 'object') return v as Record<string, any>;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as Record<string, any>; } catch { return {}; }
  }
  return {};
}

/** API rows are snake_case with paise; the UI works in camelCase rupees. */
export function mapExtractedDocument(r: any): ExtractedDocument {
  return {
    id: r.id,
    docType: r.doc_type,
    title: str(r.title),
    sourceFile: str(r.source_file),
    naturalKey: str(r.natural_key),
    entityName: str(r.entity_name),
    vehicleNumber: r.vehicle_number ?? undefined,
    issueDate: r.issue_date ? str(r.issue_date).slice(0, 10) : undefined,
    expiryDate: r.expiry_date ? str(r.expiry_date).slice(0, 10) : undefined,
    amount: r.amount_paise == null ? undefined : rupees(r.amount_paise),
    amountLabel: r.amount_label ?? undefined,
    details: mapJsonObject(r.details),
    scannedAt: r.scanned_at ?? undefined,
    createdAt: r.created_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
  };
}

export function mapUser(r: any): User {
  // /users returns a roles array; /auth/me returns roles too. Owner wins.
  const roles: string[] = Array.isArray(r.roles) ? r.roles : r.role ? [r.role] : [];
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: roles.includes('owner') ? 'owner' : 'manager',
    phone: r.phone ?? undefined,
    tenantSlug: r.tenantSlug ?? r.tenant_slug ?? undefined,
  };
}

export function mapCompany(r: any): CompanySettings {
  return {
    name: r.name ?? 'SKYHOOK', tagline: r.tagline ?? '', logoUrl: r.logo_url ?? '',
    address: r.address ?? '', city: r.city ?? '', state: r.state ?? '', pincode: r.pincode ?? '',
    phone: r.phone ?? '', email: r.email ?? '', gstNumber: r.gst_number ?? '',
    authorizedSignatory: r.authorized_signatory ?? '', signatoryTitle: r.signatory_title ?? '',
    standardShiftHours: (r.standard_shift_minutes ?? 600) / 60,
    payrollPaymentDay: r.payroll_payment_day ?? 15,
    payrollCycleType: r.payroll_cycle_type ?? 'calendar_month',
    shortShiftPolicy: r.short_shift_policy ?? 'half_day_under_5',
    emiReminderLeadDays: r.emi_reminder_lead_days ?? 15,
    serviceReminderLeadDays: r.service_reminder_lead_days ?? 15,
    insuranceReminderLeadDays: r.insurance_reminder_lead_days ?? 15,
    pucReminderLeadDays: r.puc_reminder_lead_days ?? 15,
    fitnessReminderLeadDays: r.fitness_reminder_lead_days ?? 15,
    licenseReminderLeadDays: r.license_reminder_lead_days ?? 15,
  };
}

export function mapProject(r: any): Project {
  return {
    id: r.id, projectId: r.project_code ?? r.id, name: r.name,
    clientName: r.client_name, clientPhone: r.client_phone, clientEmail: r.client_email ?? undefined,
    location: r.location ?? '', siteAddress: r.site_address ?? '', city: r.city ?? '', state: r.state ?? '',
    startDate: str(r.start_date), expectedEndDate: str(r.expected_end_date), actualEndDate: r.actual_end_date ?? undefined,
    managerId: r.manager_id ?? '', description: r.description ?? undefined,
    overtimeRate: rupees(r.ot_rate_paise_per_hour), contractValue: r.contract_value_paise != null ? rupees(r.contract_value_paise) : undefined,
    status: r.status ?? 'upcoming',
  };
}

export function mapEmployee(r: any): Employee {
  return {
    id: r.id, employeeId: r.employee_code ?? r.id, fullName: r.full_name, mobile: r.mobile,
    email: r.email ?? undefined, dateOfBirth: str(r.date_of_birth), joiningDate: str(r.joining_date),
    designation: r.designation, employeeType: r.employee_type, address: r.address ?? '', status: r.status,
    profilePhoto: r.profile_photo_key ?? undefined, remarks: r.remarks ?? undefined,
    salaryType: r.salary_type, dailyRate: rupees(r.daily_rate_paise), monthlySalary: rupees(r.monthly_salary_paise),
    standardShiftHours: (r.standard_shift_minutes ?? 600) / 60,
    overtimeEligible: r.overtime_eligible ?? true, salaryEffectiveDate: str(r.salary_effective_date),
    licenseNumber: r.license_number ?? undefined, craneLicenseDate: r.crane_license_issue_date ?? undefined,
    craneLicenseExpiry: r.crane_license_expiry ?? undefined,
    transportLicenseDate: r.transport_license_issue_date ?? undefined,
    transportLicenseExpiry: r.transport_license_expiry ?? undefined,
    guardianName: r.guardian_name ?? undefined, bloodGroup: r.blood_group ?? undefined,
    licenseIssueDate: r.license_issue_date ?? undefined, licenseValidNt: r.license_valid_nt ?? undefined,
    licenseValidTr: r.license_valid_tr ?? undefined, licenseFirstIssueDate: r.license_first_issue_date ?? undefined,
    licenseIssuingState: r.license_issuing_state ?? undefined,
    licenseIssuingAuthority: r.license_issuing_authority ?? undefined,
    licenseVehicleClasses: r.license_vehicle_classes ?? [], organDonor: r.organ_donor ?? undefined,
    licenseScanned: Boolean(r.license_scanned_at),
    currentProjectId: r.current_project_id ?? undefined, currentMachineId: r.current_machine_id ?? undefined,
    emergencyContacts: r.contacts ?? [], documents: r.documents ?? [],
  };
}

export function mapContractor(r: any): ContractorRecord {
  // Both the Fastify API and the Supabase Edge Function return camelCase for
  // this module; accept snake_case too so either backend shape maps correctly.
  return {
    id: r.id,
    contractorCode: r.contractor_code ?? r.contractorCode ?? r.id,
    fullName: r.full_name ?? r.fullName ?? '',
    mobile: r.mobile,
    skill: r.skill ?? 'crane_operator',
    agencyName: r.agency_name ?? r.agencyName ?? undefined,
    dailyRate: rupees(r.daily_rate_paise ?? r.dailyRatePaise),
    city: r.city ?? undefined,
    availability: r.availability ?? 'unknown',
    notes: r.notes ?? undefined,
    createdAt: r.created_at ?? r.createdAt ?? '',
  };
}

export function mapMachine(r: any): MachineAsset {
  return {
    id: r.id, assetId: r.asset_code ?? r.id, machineType: machineTypeFromApi(r.machine_type), make: r.make, model: r.model,
    registrationNumber: r.registration_number, serialNumber: r.serial_number ?? '',
    tonnageCapacity: r.tonnage_capacity ?? 0, purchaseDate: str(r.purchase_date),
    purchaseCost: rupees(r.purchase_cost_paise), currentProjectId: r.current_project_id ?? undefined,
    assignedOperatorId: r.assigned_operator_id ?? undefined, status: r.status ?? 'available',
    photoUrl: r.photo_key ?? undefined,
    lastServiceDate: str(r.last_service_date), serviceFrequencyValue: r.service_frequency_value ?? 60,
    serviceFrequencyUnit: r.service_frequency_unit ?? 'days', nextServiceDueDate: str(r.next_service_due_date),
    serviceReminderLeadDays: r.service_reminder_lead_days ?? 15,
    serviceReminderLeadHours: r.service_reminder_lead_hours ?? 50,
    lastServiceHours: r.last_service_hours ?? r.lastServiceHours ?? 0,
    insuranceProvider: r.insurance_provider ?? '', insurancePolicyNumber: r.insurance_policy_number ?? '',
    insuranceStartDate: str(r.insurance_start_date), insuranceExpiryDate: str(r.insurance_expiry_date),
    insuranceIntervalDays: r.insurance_interval_days ?? undefined,
    insuranceReminderLeadDays: r.insurance_reminder_lead_days ?? 15,
    pucNumber: r.puc_number ?? undefined, pucIssueDate: str(r.puc_issue_date), pucExpiryDate: str(r.puc_expiry_date),
    pucIntervalDays: r.puc_interval_days ?? undefined, pucReminderLeadDays: r.puc_reminder_lead_days ?? 15,
    fitnessCertificateNumber: r.fitness_certificate_number ?? undefined,
    lastFitnessDate: str(r.last_fitness_date), nextFitnessDueDate: str(r.next_fitness_due_date),
    fitnessIntervalDays: r.fitness_interval_days ?? undefined, fitnessReminderLeadDays: r.fitness_reminder_lead_days ?? 15,
    rcDetails: mapRcDetails(r.rc_details),
    serviceHistory: r.serviceHistory ?? [], documents: r.documents ?? [],
  };
}

export function mapAttendance(r: any): AttendanceRecord {
  return {
    id: r.id, date: str(r.attendance_date), operatorId: r.operator_id, projectId: r.project_id,
    machineId: r.machine_id ?? undefined, startTime: r.start_time ?? '', endTime: r.end_time ?? '',
    unpaidBreakMinutes: r.unpaid_break_minutes ?? 0, netWorkingMinutes: r.net_working_minutes ?? 0,
    netWorkingHours: Number(r.net_working_hours ?? 0), standardWorkingHours: (r.standard_working_minutes ?? 600) / 60,
    overtimeHours: Number(r.overtime_hours ?? 0), appliedOtRate: rupees(r.ot_rate_paise_per_hour),
    status: r.status, approvalStatus: r.approval_status, remarks: r.remarks ?? undefined,
    enteredBy: r.entered_by ?? '', approvedBy: r.approved_by ?? undefined, approvalDate: r.approved_at ?? undefined,
    operatorName: r.operator_name, projectName: r.project_name,
  } as AttendanceRecord;
}

export function mapAdvance(r: any): SalaryAdvance {
  return {
    id: r.id, advanceId: r.advance_code ?? r.id, employeeId: r.employee_id, date: str(r.advance_date),
    amount: rupees(r.amount_paise), paymentMode: r.payment_mode, paymentReference: r.payment_reference ?? undefined,
    projectId: r.project_id ?? undefined, remarks: r.remarks ?? undefined, approvedBy: r.approved_by ?? '',
    recoveryAmount: rupees(r.recovery_paise), outstandingBalance: rupees(r.outstanding_paise), status: r.status,
    employeeName: r.employee_name, employeeCode: r.employee_code,
  } as SalaryAdvance;
}

function mapEntry(r: any): PayrollEntry {
  return {
    id: r.id, payrollRunId: r.payroll_run_id, employeeId: r.employee_id, employeeName: r.employee_name,
    employeeCode: r.employee_code, designation: r.designation ?? '', salaryType: r.salary_type,
    appliedDailyRate: rupees(r.applied_daily_rate_paise), appliedMonthlyRate: rupees(r.applied_monthly_rate_paise),
    standardShiftHours: (r.standard_shift_minutes ?? 600) / 60,
    totalDaysInMonth: r.total_days_in_month, presentDays: Number(r.present_days), halfDays: Number(r.half_days),
    paidLeaveDays: Number(r.paid_leave_days), unpaidLeaveDays: Number(r.unpaid_leave_days),
    weeklyOffDays: Number(r.weekly_off_days), holidayDays: Number(r.holiday_days), payableDays: Number(r.payable_days),
    baseSalary: rupees(r.base_paise), totalOtHours: Number(r.total_ot_hours), otAmount: rupees(r.ot_paise),
    projectOtBreakdown: (r.ot_breakdown ?? []).map((b: any) => ({
      projectId: b.project_id, projectName: b.project_name, otHours: Number(b.ot_hours),
      otRate: rupees(b.ot_rate_paise_per_hour), amount: rupees(b.amount_paise),
    })),
    allowances: rupees(r.allowances_paise), grossSalary: rupees(r.gross_paise),
    advanceRecovery: rupees(r.advance_recovery_paise), otherDeductions: rupees(r.other_deductions_paise),
    totalDeductions: rupees(r.total_deductions_paise), netSalary: rupees(r.net_paise),
    paymentStatus: r.payment_status, paymentDate: r.payment_date ?? undefined,
    paymentMode: r.payment_mode ?? undefined, paymentReference: r.payment_reference ?? undefined,
  };
}

export function mapPayrollRun(r: any): PayrollRun {
  return {
    id: r.id, month: str(r.month).slice(0, 7), periodStart: str(r.period_start), periodEnd: str(r.period_end),
    paymentDueDate: str(r.payment_due_date), status: r.status, approvedAt: r.approved_at ?? undefined,
    approvedBy: r.approved_by ?? undefined, locked: r.locked ?? false,
    employeeCount: r.employee_count ?? 0,
    totalBaseSalary: rupees(r.total_base_paise), totalOvertimeSalary: rupees(r.total_ot_paise),
    totalAllowances: rupees(r.total_allowances_paise), totalGrossSalary: rupees(r.total_gross_paise),
    totalAdvancesRecovered: rupees(r.total_advance_recovery_paise), totalOtherDeductions: rupees(r.total_other_deductions_paise),
    totalNetSalary: rupees(r.total_net_paise), totalPaidAmount: rupees(r.total_paid_paise),
    entries: (r.entries ?? []).map(mapEntry),
  };
}

export function mapExpense(r: any): ProjectExpense {
  return {
    id: r.id, expenseId: r.expense_code ?? r.id, projectId: r.project_id, date: str(r.expense_date),
    category: r.category, description: r.description, amount: rupees(r.amount_paise), paymentMode: r.payment_mode,
    paidBy: r.paid_by, vendor: r.vendor ?? undefined, receiptNumber: r.receipt_number ?? undefined,
    receiptUrl: r.receipt_key ?? undefined, approvalStatus: r.approval_status, approvedBy: r.approved_by ?? undefined,
    remarks: r.remarks ?? undefined, projectName: r.project_name,
  } as ProjectExpense;
}

function mapInstallment(r: any): EmiInstallment {
  return {
    id: r.id, loanId: r.loan_id, installmentNumber: r.installment_number, dueDate: str(r.due_date),
    amountDue: rupees(r.amount_due_paise), amountPaid: rupees(r.amount_paid_paise),
    paymentDate: r.paid_at ?? undefined, paymentMode: r.payment_mode ?? undefined,
    paymentReference: r.payment_reference ?? undefined, status: r.status,
    proofUrl: r.proof_key ?? undefined, remarks: r.remarks ?? undefined,
  };
}

export function mapEmiLoan(r: any): MachineEmiLoan {
  return {
    id: r.id, loanId: r.loan_code ?? r.id, assetId: r.machine_id ?? r.assetId ?? '',
    loanProvider: r.loan_provider, loanRefNumber: r.loan_ref_number,
    loanStartDate: str(r.loan_start_date), loanEndDate: str(r.loan_end_date),
    emiAmount: rupees(r.emi_amount_paise), monthlyDueDay: r.monthly_due_day,
    totalInstallments: r.total_installments, installmentsPaid: r.installments_paid,
    remainingInstallments: r.total_installments - r.installments_paid,
    nextEmiDate: str(r.next_emi_date), reminderLeadDays: r.reminder_lead_days ?? 15,
    installments: (r.installments ?? []).map(mapInstallment),
    assetCode: r.asset_code,
  } as MachineEmiLoan;
}

export function mapWorkingLog(r: any): MachineWorkingLog {
  return {
    id: r.id, date: str(r.log_date), machineId: r.machine_id, projectId: r.project_id,
    operatorId: r.operator_id ?? '', startTime: str(r.start_time), endTime: str(r.end_time),
    idleMinutes: r.idle_minutes ?? 0, workingMinutes: r.working_minutes ?? 0,
    workingHours: Number(r.working_hours ?? 0), remarks: r.remarks ?? undefined,
    enteredBy: r.entered_by ?? '', approvalStatus: r.approval_status ?? 'approved',
    machineCode: r.asset_code, projectName: r.project_name,
  } as MachineWorkingLog;
}

export function mapAudit(r: any): AuditLog {
  return {
    id: str(r.id), timestamp: r.occurred_at ?? '', userId: r.actor_id ?? '', userName: r.actor_name ?? '',
    action: r.action, entity: r.entity, entityId: r.entity_id, reason: r.reason ?? undefined,
    previousValue: r.previous_value, updatedValue: r.updated_value,
  };
}

export function mapNotification(r: any): InAppNotification {
  return {
    id: r.id, category: r.category, title: r.title, description: r.description ?? '',
    relatedRecordId: r.related_id, dueDate: str(r.due_date), priority: r.priority,
    read: r.is_read ?? false, createdAt: r.created_at,
  };
}

export function mapServiceRecord(r: any): ServiceRecord {
  return {
    id: r.id,
    serviceDate: str(r.service_date ?? r.serviceDate),
    serviceType: r.service_type ?? r.serviceType ?? '',
    serviceProvider: r.service_provider ?? r.serviceProvider ?? '',
    cost: rupees(r.cost_paise ?? r.costPaise),
    odometerOrHours: r.odometer_or_hours ?? r.odometerOrHours ?? undefined,
    notes: r.notes ?? undefined,
    invoiceUrl: r.invoice_key ?? r.invoice_url ?? r.invoiceUrl ?? undefined,
    completedBy: str(r.completed_by ?? r.completedBy),
  };
}

export function mapPayrollAdjustment(r: any): PayrollAdjustment {
  return {
    id: r.id,
    label: r.label ?? '',
    amount: rupees(r.amount_paise ?? r.amountPaise),
    remarks: r.remarks ?? undefined,
    createdAt: r.created_at ?? r.createdAt ?? '',
  };
}

export function mapPersonalRecord(r: any): PersonalRecord {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title ?? '',
    provider: r.provider ?? '',
    referenceNumber: r.reference_number ?? r.referenceNumber ?? '',
    amount: rupees(r.amount_paise ?? r.amountPaise),
    periodicAmount: rupees(r.periodic_amount_paise ?? r.periodicAmountPaise),
    startDate: str(r.start_date ?? r.startDate),
    dueDate: str(r.due_date ?? r.dueDate),
    notes: r.notes ?? undefined,
    createdAt: r.created_at ?? r.createdAt ?? '',
  };
}

export const rupeesToPaise = (value: number | undefined): number => Math.round((value ?? 0) * 100);
