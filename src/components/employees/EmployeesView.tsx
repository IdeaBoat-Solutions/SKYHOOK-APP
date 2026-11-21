import React, { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  X,
  Users,
  Plus,
  Search,
  Filter,
  UserCheck,
  ShieldAlert,
  Calendar,
  Phone,
  FileText,
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  ReceiptIndianRupee,
  Clock,
  Layers,
  Upload,
  Trash2,
  FileCheck,
  Eye,
  Download,
  Paperclip,
  ArrowRight,
  ScanLine,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { formatDateDDMMYYYY } from '../../utils/calculations';
import { Employee, EmployeeType, SalaryType, DocumentRecord, LicenceExtras } from '../../types';
import { LicenceDetailsFields, LicenceScanModal, ScanOutcome } from './LicenceScan';
import { AgeingBar } from '../common/Ageing';
import { AadhaarScanModal, AadhaarOutcome } from './AadhaarScan';
import { Currency } from '../common/Currency';
import { mapDocument } from '../../api/mappers';
import { api } from '../../api/client';
import { formatPerDay } from '../../lib/wage';

import { DateInput } from '../common/DateInput';
/** A document picked in the form that is uploaded when the record is saved. */
interface StagedDoc {
  key: string;
  file: File;
  type: string;
  expiry?: string;
}

/** Documents from the API arrive as raw rows; accept both raw rows and already-mapped records. */
const normDoc = (d: any): DocumentRecord => (d && 'doc_type' in d ? mapDocument(d) : d);

const withTitle = (file: File, title: string): File => {
  const t = title.trim();
  if (!t || t === file.name.replace(/\.[^/.]+$/, '')) return file;
  const ext = file.name.match(/\.[^/.]+$/)?.[0] ?? '';
  return new File([file], t.endsWith(ext) ? t : `${t}${ext}`, { type: file.type });
};

const STANDARD_DOCUMENT_TYPES = [
  'Heavy Crane Driving License',
  'Commercial Transport Vehicle License',
  'Aadhaar Card (UIDAI)',
  'PAN Card',
  'Medical Fitness Certificate',
  'Safety Induction & Crane Competency Card',
  'Bank Passbook / Cancelled Cheque',
  'Police Verification Certificate',
  'Operator Passport / Photo ID',
  'Other Document',
];

export const EmployeesView: React.FC = () => {
  const {
    employees,
    projects,
    machines,
    addEmployee,
    attachEmployeeDocument,
    updateEmployee,
    deactivateEmployee,
    renewOperatorLicense,
    downloadDocument,
    getLicenseAlerts,
    currentDate,
    companySettings,
  } = useSkyhook();

  const [activeTab, setActiveTab] = useState<'all' | 'operators' | 'staff'>('operators');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // Add / Edit Modal
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [joiningDate, setJoiningDate] = useState(currentDate);
  const [designation, setDesignation] = useState('');
  const [employeeType, setEmployeeType] = useState<EmployeeType>('operator');
  const [address, setAddress] = useState('');
  const [salaryType, setSalaryType] = useState<SalaryType>('daily');
  const [dailyRate, setDailyRate] = useState('');
  const [monthlySalary, setMonthlySalary] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [craneLicenseDate, setCraneLicenseDate] = useState('');
  const [craneLicenseExpiry, setCraneLicenseExpiry] = useState('');
  const [transportLicenseDate, setTransportLicenseDate] = useState('');
  const [transportLicenseExpiry, setTransportLicenseExpiry] = useState('');
  const [licenceExtras, setLicenceExtras] = useState<LicenceExtras>({ licenseVehicleClasses: [] });
  const [showScan, setShowScan] = useState(false);
  const [scannedLicence, setScannedLicence] = useState(false);
  const [scanFiles, setScanFiles] = useState<{ front?: File; back?: File }>({});
  const [showAadhaar, setShowAadhaar] = useState(false);
  const [aadhaarFiles, setAadhaarFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [docError, setDocError] = useState('');

  // Documents picked in the form; they are uploaded to storage when the record is saved.
  const [stagedDocs, setStagedDocs] = useState<StagedDoc[]>([]);
  const [uploadDocType, setUploadDocType] = useState(STANDARD_DOCUMENT_TYPES[0]);
  const [uploadDocTitle, setUploadDocTitle] = useState('');
  const [uploadDocExpiry, setUploadDocExpiry] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  // License Quick Renewal Modal
  const [licenseRenewalEmp, setLicenseRenewalEmp] = useState<Employee | null>(null);
  const [newCraneExpiry, setNewCraneExpiry] = useState('');
  const [newTransportExpiry, setNewTransportExpiry] = useState('');

  // Latest copy of the employee being edited / viewed (the list refreshes after every save).
  const liveEditing = editingEmployee ? employees.find((e) => e.id === editingEmployee.id) ?? editingEmployee : null;
  const liveSelected = selectedEmployee ? employees.find((e) => e.id === selectedEmployee.id) ?? selectedEmployee : null;

  // The employee list does not carry documents; they are fetched when a record is opened.
  const [fetchedDocs, setFetchedDocs] = useState<Record<string, DocumentRecord[]>>({});
  const loadDocs = async (id: string) => {
    try {
      const r = await api.get<{ items: any[] }>(`/employees/${id}/documents`);
      setFetchedDocs((prev) => ({ ...prev, [id]: (r.items ?? []).map(mapDocument) }));
    } catch {
      /* the profile still opens; it just shows no documents */
    }
  };
  useEffect(() => {
    if (selectedEmployee) void loadDocs(selectedEmployee.id);
  }, [selectedEmployee?.id]);
  useEffect(() => {
    if (showModal && editingEmployee) void loadDocs(editingEmployee.id);
  }, [showModal, editingEmployee?.id]);
  const docsOf = (emp: Employee | null): DocumentRecord[] =>
    emp ? fetchedDocs[emp.id] ?? (emp.documents ?? []).map(normDoc) : [];
  const savedDocs = docsOf(liveEditing);

  const licenseAlerts = getLicenseAlerts();

  const handleOpenAdd = () => {
    setEditingEmployee(null);
    setFullName('');
    setMobile('');
    setEmail('');
    setDob('');
    setJoiningDate(currentDate);
    setDesignation('');
    setEmployeeType('operator');
    setAddress('');
    setSalaryType('daily');
    setDailyRate('');
    setMonthlySalary('');
    setLicenseNumber('');
    setCraneLicenseDate('');
    setCraneLicenseExpiry('');
    setTransportLicenseDate('');
    setTransportLicenseExpiry('');
    setLicenceExtras({ licenseVehicleClasses: [] });
    setScannedLicence(false);
    setScanFiles({});
    setAadhaarFiles([]);
    setSaveError('');
    setDocError('');

    // Reset staged documents
    setStagedDocs([]);
    setUploadDocType(STANDARD_DOCUMENT_TYPES[0]);
    setUploadDocTitle('');
    setUploadDocExpiry('');
    setUploadFile(null);
    setFileInputKey((k) => k + 1);

    setShowModal(true);
  };

  const handleOpenEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    setFullName(emp.fullName);
    setMobile(emp.mobile);
    setEmail(emp.email || '');
    setDob(emp.dateOfBirth);
    setJoiningDate(emp.joiningDate);
    setDesignation(emp.designation);
    setEmployeeType(emp.employeeType);
    setAddress(emp.address);
    setSalaryType(emp.salaryType);
    setDailyRate(String(emp.dailyRate));
    setMonthlySalary(String(emp.monthlySalary));
    setLicenseNumber(emp.licenseNumber || '');
    setCraneLicenseDate(emp.craneLicenseDate || '');
    setCraneLicenseExpiry(emp.craneLicenseExpiry || '');
    setTransportLicenseDate(emp.transportLicenseDate || '');
    setTransportLicenseExpiry(emp.transportLicenseExpiry || '');
    setLicenceExtras({
      guardianName: emp.guardianName,
      bloodGroup: emp.bloodGroup,
      licenseIssueDate: emp.licenseIssueDate,
      licenseValidNt: emp.licenseValidNt,
      licenseValidTr: emp.licenseValidTr,
      licenseFirstIssueDate: emp.licenseFirstIssueDate,
      licenseIssuingState: emp.licenseIssuingState,
      licenseIssuingAuthority: emp.licenseIssuingAuthority,
      licenseVehicleClasses: emp.licenseVehicleClasses ?? [],
      organDonor: emp.organDonor,
    });
    setScannedLicence(Boolean(emp.licenseScanned));
    setScanFiles({});
    setAadhaarFiles([]);
    setSaveError('');
    setDocError('');

    // Already-saved documents are listed from the record; only new picks are staged.
    setStagedDocs([]);
    setUploadDocType(STANDARD_DOCUMENT_TYPES[0]);
    setUploadDocTitle('');
    setUploadDocExpiry('');
    setUploadFile(null);
    setFileInputKey((k) => k + 1);

    setShowModal(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setDocError('');
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setDocError('That file is larger than 10 MB. Choose a smaller PDF or photo.');
      setUploadFile(null);
      setFileInputKey((k) => k + 1);
      return;
    }
    setUploadFile(file);
    if (!uploadDocTitle) setUploadDocTitle(file.name.replace(/\.[^/.]+$/, ''));
  };

  const handleStageDocument = () => {
    if (!uploadFile) {
      setDocError('Choose a file first.');
      return;
    }
    setDocError('');
    setStagedDocs((prev) => [
      {
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file: withTitle(uploadFile, uploadDocTitle),
        type: uploadDocType,
        expiry: uploadDocExpiry || undefined,
      },
      ...prev,
    ]);
    setUploadDocTitle('');
    setUploadDocExpiry('');
    setUploadFile(null);
    setFileInputKey((k) => k + 1);
  };

  const handleRemoveStagedDoc = (key: string) => {
    setStagedDocs((prev) => prev.filter((d) => d.key !== key));
  };

  /** Open a stored document in a new tab (falls back to a download if pop-ups are blocked). */
  const openDocument = async (doc: DocumentRecord) => {
    setStatusError('');
    const win = window.open('', '_blank');
    try {
      const raw = await downloadDocument(doc.fileUrl);
      // The API serves bytes as octet-stream; tag the real type so images and PDFs open in the tab.
      const ext = (doc.name.split('.').pop() || doc.fileUrl.split('.').pop() || '').toLowerCase();
      const mime =
        ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[ext];
      const blob = mime ? new Blob([raw], { type: mime }) : raw;
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else {
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.name;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      win?.close();
      setStatusError(err instanceof Error ? err.message : 'Could not open that document.');
    }
  };

  /** Copy reviewed scan results into the form; the user can still edit before saving. */
  const handleApplyAadhaar = (r: AadhaarOutcome) => {
    if (r.name) setFullName(r.name);
    if (r.dateOfBirth) setDob(r.dateOfBirth);
    if (r.address) setAddress(r.address);
    setAadhaarFiles(r.files);
    setShowAadhaar(false);
  };

  const handleApplyScan = ({ parsed, files }: ScanOutcome) => {
    if (parsed.licenceNumber) setLicenseNumber(parsed.licenceNumber);
    if (parsed.name) setFullName(parsed.name);
    if (parsed.dateOfBirth) setDob(parsed.dateOfBirth);
    if (parsed.address) setAddress(parsed.address);
    // One card carries both validities: non-transport maps to the crane licence
    // fields, transport to the transport licence fields (the two reminder tracks).
    if (parsed.issueDate) {
      setCraneLicenseDate(parsed.issueDate);
      setTransportLicenseDate(parsed.issueDate);
    }
    if (parsed.validNt) setCraneLicenseExpiry(parsed.validNt);
    if (parsed.validTr) setTransportLicenseExpiry(parsed.validTr);
    setLicenceExtras({
      guardianName: parsed.guardianName,
      bloodGroup: parsed.bloodGroup,
      licenseIssueDate: parsed.issueDate,
      licenseValidNt: parsed.validNt,
      licenseValidTr: parsed.validTr,
      licenseFirstIssueDate: parsed.firstIssueDate,
      licenseIssuingState: parsed.issuingState,
      licenseIssuingAuthority: parsed.issuingAuthority,
      licenseVehicleClasses: parsed.vehicleClasses ?? [],
      organDonor: parsed.organDonor,
    });
    setScannedLicence(true);
    setScanFiles(files);
    setShowScan(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaveError('');
    const common = {
      fullName,
      mobile,
      email,
      dateOfBirth: dob,
      joiningDate,
      designation,
      employeeType,
      address,
      salaryType,
      dailyRate: parseFloat(dailyRate) || 0,
      monthlySalary: parseFloat(monthlySalary) || 0,
      licenseNumber,
      craneLicenseDate,
      craneLicenseExpiry,
      transportLicenseDate,
      transportLicenseExpiry,
      ...licenceExtras,
      licenseScanned: scannedLicence,
    };

    if (salaryType === 'daily' && !(parseFloat(dailyRate) > 0)) {
      setSaveError('Enter the daily payout amount.');
      return;
    }
    if (salaryType === 'monthly' && !(parseFloat(monthlySalary) > 0)) {
      setSaveError('Enter the monthly salary.');
      return;
    }

    setSaving(true);
    try {
      let employeeId: string;
      if (editingEmployee) {
        await updateEmployee(editingEmployee.id, common);
        employeeId = editingEmployee.id;
      } else {
        const created = await addEmployee({
          ...common,
          emergencyContacts: [],
          documents: [],
          employeeId: '',
          status: 'active',
          standardShiftHours: companySettings.standardShiftHours || 10,
          overtimeEligible: true,
          salaryEffectiveDate: currentDate,
        });
        employeeId = created.id;
        // From here on this is an edit: a retry after a failed upload must not create a duplicate.
        setEditingEmployee(created);
      }

      // Keep the scanned photos with the record. The details are already saved,
      // so a failed upload is reported without losing them.
      const expiry = transportLicenseExpiry || craneLicenseExpiry || undefined;
      const uploads: Array<{ key: string; file: File; type: string; expiry?: string }> = [];
      if (scanFiles.front) uploads.push({ key: 'lic-front', file: scanFiles.front, type: 'Driving Licence – Front', expiry });
      if (scanFiles.back) uploads.push({ key: 'lic-back', file: scanFiles.back, type: 'Driving Licence – Back', expiry });
      aadhaarFiles.forEach((file, i) =>
        uploads.push({
          key: `aadhaar-${i}`,
          file,
          type: aadhaarFiles.length > 1 ? `Aadhaar Card (UIDAI) – ${i + 1}` : 'Aadhaar Card (UIDAI)',
          expiry: undefined,
        }),
      );
      stagedDocs.forEach((d) => uploads.push({ key: d.key, file: d.file, type: d.type, expiry: d.expiry }));

      const failed: typeof uploads = [];
      for (const u of uploads) {
        try {
          await attachEmployeeDocument(employeeId, u.file, u.type, u.expiry);
        } catch {
          failed.push(u);
        }
      }
      if (uploads.length) await loadDocs(employeeId);
      if (failed.length) {
        // Keep only what still needs uploading so a retry does not duplicate the rest.
        setScanFiles({});
        setAadhaarFiles([]);
        setStagedDocs(failed.map((u) => ({ key: u.key, file: u.file, type: u.type, expiry: u.expiry })));
        setSaveError(
          `Saved, but could not upload: ${failed.map((u) => u.type).join(', ')}. Press save again to retry the upload.`,
        );
        return;
      }
      setShowModal(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmLicenseRenewal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseRenewalEmp) return;
    if (!newCraneExpiry) {
      setSaveError('Enter the new crane licence expiry date.');
      return;
    }
    setSaveError('');
    try {
      await renewOperatorLicense(licenseRenewalEmp.id, newCraneExpiry, newTransportExpiry || undefined);
      setLicenseRenewalEmp(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the licence renewal. Please try again.');
    }
  };

  const changeStatus = async (emp: Employee, next: 'active' | 'inactive') => {
    setStatusBusy(true);
    setStatusError('');
    try {
      if (next === 'inactive') await deactivateEmployee(emp.id);
      else await updateEmployee(emp.id, { status: 'active' });
      setConfirmDeactivate(false);
      if (next === 'inactive' && !showInactive) setSelectedEmployee(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Could not change the status. Please try again.');
    } finally {
      setStatusBusy(false);
    }
  };

  const licenceAlertFor = (emp: Employee) => licenseAlerts.find((a) => a.targetId === emp.id);

  const filteredEmployees = employees.filter((emp) => {
    if (!showInactive && emp.status !== 'active') return false;
    const matchTab =
      activeTab === 'all'
        ? true
        : activeTab === 'operators'
        ? emp.employeeType === 'operator'
        : emp.employeeType !== 'operator';

    const matchSearch =
      !searchTerm ||
      emp.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.employeeId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.mobile.includes(searchTerm) ||
      emp.designation.toLowerCase().includes(searchTerm.toLowerCase());

    return matchTab && matchSearch;
  });

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div className="min-w-0">
          <h2 className="page-title">
            Employee & Operator Master
          </h2>
          <p className="page-subtitle">
            Operator licenses, daily wage rates, emergency contacts, and statutory document storage.
          </p>
        </div>

        <button
          onClick={handleOpenAdd}
          className="btn btn-primary shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Operator / Staff</span>
        </button>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="filter-bar filter-bar--split">
        <div className="tab-bar">
          <button
            onClick={() => setActiveTab('operators')}
            className={`tab shrink-0 ${activeTab === 'operators' ? 'tab-active' : ''}`}
          >
            Crane Operators ({employees.filter((e) => e.employeeType === 'operator').length})
          </button>
          <button
            onClick={() => setActiveTab('staff')}
            className={`tab shrink-0 ${activeTab === 'staff' ? 'tab-active' : ''}`}
          >
            Management & Staff ({employees.filter((e) => e.employeeType !== 'operator').length})
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`tab shrink-0 ${activeTab === 'all' ? 'tab-active' : ''}`}
          >
            All Workforce ({employees.length})
          </button>
        </div>

        <div className="search-box">
          <Search className="w-4 h-4" />
          <input
            type="text"
            placeholder="Search operator, code, designation..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-input pl-9"
          />
        </div>

        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium text-ink-700 md:min-h-0">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
      </div>

      {/* Phones: one card per person */}
      <div className="space-y-3 md:hidden">
        {filteredEmployees.map((emp) => {
          const alert = licenceAlertFor(emp);
          return (
            <div key={emp.id} className="card card-pad space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="chip">{emp.employeeId}</span>
                  <h3 className="mt-1 break-words text-base font-semibold text-ink-900">{emp.fullName}</h3>
                  <p className="text-xs text-ink-500">{emp.designation}</p>
                </div>
                <span className={`badge shrink-0 ${emp.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>
                  {emp.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="min-w-0">
                  <span className="stat-label block">Contact</span>
                  <a href={`tel:${emp.mobile.replace(/\s/g, '')}`} className="font-semibold text-logo-700">{emp.mobile}</a>
                </div>
                <div className="min-w-0">
                  <span className="stat-label block">{emp.salaryType === 'daily' ? 'Daily wage' : 'Monthly salary'}</span>
                  <span className="font-semibold text-ink-900">
                    <Currency value={emp.salaryType === 'daily' ? emp.dailyRate : emp.monthlySalary} size="xs" />
                    <span className="ml-1 text-[10px] font-normal text-ink-500">
                      {emp.salaryType === 'daily' ? '/day' : '/mo'}
                    </span>
                  </span>
                  {emp.salaryType === 'monthly' && emp.monthlySalary > 0 && (
                    <span className="block text-[10px] text-ink-500">{formatPerDay(emp.monthlySalary, currentDate)}</span>
                  )}
                </div>
                {emp.employeeType === 'operator' && (
                  <div className="col-span-2 min-w-0">
                    <span className="stat-label block">Crane licence</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className={`font-semibold ${alert ? 'text-danger-600' : 'text-ink-800'}`}>
                        {emp.craneLicenseExpiry ? formatDateDDMMYYYY(emp.craneLicenseExpiry) : 'Not recorded'}
                      </span>
                      {alert && (
                        <span className={`badge ${alert.status === 'upcoming' ? 'badge-warning' : 'badge-danger'}`}>
                          {alert.urgencyLabel}
                        </span>
                      )}
                      <span className="text-[11px] text-ink-500">No: {emp.licenseNumber || '-'}</span>
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {emp.employeeType === 'operator' && alert && (
                  <button
                    onClick={() => {
                      setSaveError('');
                      setLicenseRenewalEmp(emp);
                      setNewCraneExpiry('');
                      setNewTransportExpiry('');
                    }}
                    className="btn btn-primary flex-1"
                  >
                    Renew Licence
                  </button>
                )}
                <button onClick={() => handleOpenEdit(emp)} className="btn btn-secondary flex-1">
                  Edit
                </button>
                <button onClick={() => { setConfirmDeactivate(false); setStatusError(''); setSelectedEmployee(emp); }} className="btn btn-secondary flex-1">
                  Profile
                </button>
              </div>
            </div>
          );
        })}
        {filteredEmployees.length === 0 && (
          <div className="card empty-state">
            <Users className="h-6 w-6 text-ink-300" />
            <span>No {showInactive ? '' : 'active '}employees match your search.</span>
          </div>
        )}
      </div>

      {/* md and up: table */}
      <div className="table-card hidden md:block">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="px-3.5 py-3">Code</th>
                <th className="px-3.5 py-3">Name & Role</th>
                <th className="px-3.5 py-3">Contact</th>
                <th className="px-3.5 py-3">Wage / Salary</th>
                <th className="px-3.5 py-3">Licenses & Expiries</th>
                <th className="px-3.5 py-3 text-center">Status</th>
                <th className="px-3.5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-800">
              {filteredEmployees.map((emp) => {
                const alert = licenceAlertFor(emp);

                return (
                  <tr key={emp.id} className="hover:bg-surface-muted transition-colors">
                    <td className="px-3.5 py-3 font-bold text-ink-900">{emp.employeeId}</td>
                    <td className="px-3.5 py-3">
                      <div className="font-bold text-ink-900">{emp.fullName}</div>
                      <span className="text-[11px] text-ink-500">{emp.designation}</span>
                    </td>
                    <td className="px-3.5 py-3">
                      <div>{emp.mobile}</div>
                      <span className="text-[10px] text-ink-400">{emp.email || 'No email'}</span>
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="font-bold text-ink-900">
                        {emp.salaryType === 'daily' ? (
                          <span className="inline-flex items-center gap-1">
                            <Currency value={emp.dailyRate} size="xs" />
                            <span className="text-[10px] text-ink-500 font-sans">/day</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Currency value={emp.monthlySalary} size="xs" />
                            <span className="text-[10px] text-ink-500 font-sans">/mo</span>
                          </span>
                        )}
                      </div>
                      {emp.salaryType === 'monthly' && emp.monthlySalary > 0 ? (
                        <span className="text-[10px] text-ink-500 block">{formatPerDay(emp.monthlySalary, currentDate)}</span>
                      ) : (
                        <span className="text-[10px] text-ink-500 block">{emp.standardShiftHours || 10}h Standard</span>
                      )}
                    </td>
                    <td className="px-3.5 py-3">
                      {emp.employeeType === 'operator' ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-ink-500">Crane Lic:</span>
                            <span className={`font-semibold ${alert ? 'text-danger-600' : 'text-ink-800'}`}>
                              {emp.craneLicenseExpiry ? formatDateDDMMYYYY(emp.craneLicenseExpiry) : 'Not recorded'}
                            </span>
                            {alert && (
                              <span className={`badge ${alert.status === 'upcoming' ? 'badge-warning' : 'badge-danger'}`}>
                                {alert.urgencyLabel}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-ink-500 text-[10px]">
                            <span>No: {emp.licenseNumber || '-'}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-ink-400">N/A (Staff)</span>
                      )}
                    </td>

                    <td className="px-3.5 py-3 text-center">
                      <span className={`badge ${emp.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>
                        {emp.status}
                      </span>
                    </td>

                    <td className="px-3.5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {emp.employeeType === 'operator' && alert && (
                          <button
                            onClick={() => {
                              setSaveError('');
                              setLicenseRenewalEmp(emp);
                              setNewCraneExpiry('');
                              setNewTransportExpiry('');
                            }}
                            className="btn btn-primary btn-sm"
                          >
                            Renew License
                          </button>
                        )}
                        <button onClick={() => handleOpenEdit(emp)} className="btn btn-ghost btn-sm">
                          Edit
                        </button>
                        <button
                          onClick={() => { setConfirmDeactivate(false); setStatusError(''); setSelectedEmployee(emp); }}
                          className="btn btn-ghost btn-sm"
                        >
                          Profile
                          <ArrowRight size={12} className="inline-block align-middle ml-1" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredEmployees.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink-500">
                    No {showInactive ? '' : 'active '}employees match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>


      {/* License Quick Renewal Modal */}
      {licenseRenewalEmp && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <h3 className="modal-title">Renew Operator Commercial License</h3>
              <button
                onClick={() => setLicenseRenewalEmp(null)}
                className="icon-btn"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmLicenseRenewal} className="flex min-h-0 flex-1 flex-col text-xs">
             <div className="modal-body space-y-4">
              {saveError && (
                <div className="alert-banner" role="alert">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="text-xs">{saveError}</span>
                </div>
              )}
              <div className="notice notice--warning">
                <span className="font-semibold block text-sm">
                  {licenseRenewalEmp.fullName} ({licenseRenewalEmp.employeeId})
                </span>
                <span className="text-ink-600 block mt-0.5">
                  License #: {licenseRenewalEmp.licenseNumber || 'not recorded'}
                  {licenseRenewalEmp.craneLicenseExpiry && (
                    <> · current expiry {formatDateDDMMYYYY(licenseRenewalEmp.craneLicenseExpiry)}</>
                  )}
                </span>
              </div>

              <div>
                <label className="form-label">
                  New Crane Heavy Machine License Expiry:
                </label>
                <DateInput required
                  value={newCraneExpiry}
                  onChange={(e) => setNewCraneExpiry(e.target.value)}
                  className="form-input font-semibold"
                />
              </div>

              <div>
                <label className="form-label">
                  New Transport Vehicle License Expiry (optional):
                </label>
                <DateInput
                  value={newTransportExpiry}
                  onChange={(e) => setNewTransportExpiry(e.target.value)}
                  className="form-input font-semibold"
                />
              </div>

             </div>
              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setLicenseRenewalEmp(null)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Save & Clear Alert
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Employee Modal with Upload Section */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-panel modal-panel-wide text-xs">
            <div className="modal-header">
              <div className="flex items-center gap-2.5">
                <span className="section-icon">
                  <Users className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="modal-title">
                    {editingEmployee ? `Edit Profile: ${editingEmployee.fullName}` : 'Register New Operator / Employee'}
                  </h3>
                  <p className="text-[11px] text-ink-500">
                    Enter personal, salary, licensing and upload verified documents before saving
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="icon-btn"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
             <div className="modal-body space-y-5">
              {/* Basic Information */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="stat-label block">
                    1. Personal & Contact Details
                  </span>
                  <button type="button" onClick={() => setShowAadhaar(true)} className="btn btn-secondary btn-sm">
                    <ScanLine className="h-3.5 w-3.5" />
                    Scan Aadhaar
                  </button>
                </div>
                {aadhaarFiles.length > 0 && (
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-success-700">
                    <Paperclip className="h-3.5 w-3.5" />
                    Aadhaar ({aadhaarFiles.length} file{aadhaarFiles.length > 1 ? 's' : ''}) will be saved with this record.
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Full Name:</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Ramesh Patel"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="form-label">Mobile Number:</label>
                    <input
                      type="text"
                      required
                      inputMode="tel"
                      placeholder="+91 98200 11223"
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="form-label">Workforce Type:</label>
                    <Select value={employeeType} onValueChange={(v) => setEmployeeType(v as EmployeeType)}>
                      <SelectTrigger className="form-input">
                        <SelectValue placeholder="Select workforce type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="operator">Heavy Crane Operator</SelectItem>
                        <SelectItem value="supervisor">Site Supervisor</SelectItem>
                        <SelectItem value="manager">Project Manager</SelectItem>
                        <SelectItem value="office">Office / Operations Staff</SelectItem>
                        <SelectItem value="other">Supporting Technician / Rigger</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="form-label">Designation:</label>
                    <input
                      type="text"
                      required
                      value={designation}
                      onChange={(e) => setDesignation(e.target.value)}
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="form-label">Joining Date:</label>
                    <DateInput required
                      value={joiningDate}
                      onChange={(e) => setJoiningDate(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>
              </div>

              {/* Salary Configuration */}
              <div className="rounded-lg border border-line bg-surface-muted p-3 sm:p-4 space-y-3">
                <span className="stat-label block">
                  2. Salary & Wage Model
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="form-label">Salary Model:</label>
                    <Select value={salaryType} onValueChange={(v) => setSalaryType(v as SalaryType)}>
                      <SelectTrigger className="form-input font-semibold">
                        <SelectValue placeholder="Select salary model" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily Working Payout</SelectItem>
                        <SelectItem value="monthly">Fixed Monthly Salary</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="form-label">
                      {salaryType === 'daily' ? 'Daily Payout Amount (₹):' : 'Monthly Salary (₹):'}
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      required
                      min="1"
                      value={salaryType === 'daily' ? dailyRate : monthlySalary}
                      onChange={(e) =>
                        salaryType === 'daily' ? setDailyRate(e.target.value) : setMonthlySalary(e.target.value)
                      }
                      className="form-input"
                    />
                    {salaryType === 'monthly' && parseFloat(monthlySalary) > 0 && (
                      <p className="mt-1 text-[11px] font-medium text-ink-600">
                        {formatPerDay(parseFloat(monthlySalary), currentDate)}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="form-label">Standard Shift:</label>
                    <input
                      type="text"
                      disabled
                      value="10 Hours Standard"
                      className="form-input bg-surface-muted text-ink-500"
                    />
                  </div>
                </div>
              </div>

              {/* Operator Specific License Details */}
              {employeeType === 'operator' && (
                <div className="rounded-lg border border-line bg-surface-muted p-3 sm:p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="stat-label block">
                      3. Heavy Crane Operator Licenses
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowScan(true)}
                        className="btn btn-primary btn-sm"
                      >
                        <ScanLine className="h-3.5 w-3.5" />
                        Scan licence
                      </button>
                      <span className="chip">
                        {scannedLicence ? 'SCANNED' : 'RTO STATUTORY'}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-ink-500">
                    Scan the licence photo to fill these in, or type them by hand. Everything stays editable.
                  </p>

                  <div>
                    <label className="form-label">License Number:</label>
                    <input
                      type="text"
                      placeholder="e.g. MH04-2015002910"
                      value={licenseNumber}
                      onChange={(e) => setLicenseNumber(e.target.value)}
                      className="form-input font-semibold"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">
                        Crane License Issue Date:
                      </label>
                      <DateInput value={craneLicenseDate}
                        onChange={(e) => setCraneLicenseDate(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">
                        Crane License Expiry Date:
                      </label>
                      <DateInput value={craneLicenseExpiry}
                        onChange={(e) => setCraneLicenseExpiry(e.target.value)}
                        className="form-input font-bold"
                      />
                    </div>
                  </div>
                  <AgeingBar issue={craneLicenseDate} expiry={craneLicenseExpiry} />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">
                        Transport License Issue Date:
                      </label>
                      <DateInput value={transportLicenseDate}
                        onChange={(e) => setTransportLicenseDate(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">
                        Transport License Expiry Date:
                      </label>
                      <DateInput value={transportLicenseExpiry}
                        onChange={(e) => setTransportLicenseExpiry(e.target.value)}
                        className="form-input font-bold"
                      />
                    </div>
                  </div>
                  <AgeingBar issue={transportLicenseDate} expiry={transportLicenseExpiry} />

                  <LicenceDetailsFields
                    value={licenceExtras}
                    onChange={(patch) => setLicenceExtras((prev) => ({ ...prev, ...patch }))}
                  />
                  {(scanFiles.front || scanFiles.back) && (
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-success-700">
                      <Paperclip className="h-3.5 w-3.5" />
                      {[scanFiles.front && 'Front', scanFiles.back && 'Back'].filter(Boolean).join(' + ')} photo
                      will be saved with this record.
                    </p>
                  )}
                </div>
              )}

              {/* Dedicated Operator & Employee Documents Upload Section (Before Saving) */}
              <div className="rounded-lg border border-logo-700 bg-logo-700 p-4 space-y-4 text-white">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-logo-700 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Paperclip className="w-4 h-4 text-ink-300" />
                      <span className="font-semibold text-sm text-white">
                        Upload Operator & Employee Documents
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-400 mt-0.5">
                      Upload verified documents (Aadhaar, License, Medical, PAN) before saving the employee record
                    </p>
                  </div>
                  <span className="badge bg-brand-600 text-white self-start sm:self-auto">
                    {savedDocs.length + stagedDocs.length} Document{savedDocs.length + stagedDocs.length === 1 ? '' : 's'}
                  </span>
                </div>

                {/* Upload Inputs Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-lg border border-logo-700 bg-logo-800 p-3">
                  <div>
                    <label className="form-label mb-1 !text-ink-300">
                      Document Type:
                    </label>
                    <Select value={uploadDocType} onValueChange={setUploadDocType}>
                      <SelectTrigger className="form-input !border-line-strong !bg-logo-700 !text-white">
                        <SelectValue placeholder="Select document type" />
                      </SelectTrigger>
                      <SelectContent>
                        {STANDARD_DOCUMENT_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="form-label mb-1 !text-ink-300">
                      Document Title / Name:
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Official DL Front & Back"
                      value={uploadDocTitle}
                      onChange={(e) => setUploadDocTitle(e.target.value)}
                      className="form-input !border-line-strong !bg-logo-700 !text-white"
                    />
                  </div>

                  <div>
                    <label className="form-label mb-1 !text-ink-300">
                      Expiry Date (If Applicable):
                    </label>
                    <DateInput value={uploadDocExpiry}
                      onChange={(e) => setUploadDocExpiry(e.target.value)}
                      className="form-input !border-line-strong !bg-logo-700 !text-white"
                    />
                  </div>
                </div>

                {/* File Selector & Stage Button */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-lg border border-logo-700 bg-logo-700 p-3">
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-line-strong bg-logo-800 px-3 py-2 text-xs font-semibold text-white hover:bg-ink-700">
                      <Upload className="w-3.5 h-3.5 text-ink-300" />
                      <span>Choose File (PDF/Image)</span>
                      <input
                        key={fileInputKey}
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </label>
                    <div className="min-w-0">
                      {uploadFile ? (
                        <span className="block truncate text-xs font-semibold text-white">
                          {uploadFile.name} ({Math.max(1, Math.round(uploadFile.size / 1024))} KB)
                        </span>
                      ) : (
                        <span className="text-ink-400 text-xs">No file chosen yet</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleStageDocument}
                    disabled={!uploadFile}
                    className="btn btn-primary"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Attach Document</span>
                  </button>
                </div>
                {docError && <p className="text-xs font-semibold text-danger-200" role="alert">{docError}</p>}

                {/* Already saved + waiting to upload */}
                {savedDocs.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                      Saved documents ({savedDocs.length})
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {savedDocs.map((doc) => (
                        <div key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border border-logo-700 bg-logo-700 p-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-white">{doc.name}</p>
                            <p className="truncate text-[10px] text-ink-300">
                              {doc.type}{doc.sizeKb ? ` • ${doc.sizeKb} KB` : ''}
                              {doc.expiryDate ? ` • Exp ${formatDateDDMMYYYY(doc.expiryDate)}` : ''}
                            </p>
                          </div>
                          <button type="button" onClick={() => void openDocument(doc)} className="btn btn-secondary btn-sm shrink-0">
                            <Eye className="w-3 h-3" /> View
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {stagedDocs.length > 0 ? (
                  <div className="space-y-2 pt-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                      Will be uploaded when you save ({stagedDocs.length}):
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {stagedDocs.map((doc) => (
                        <div
                          key={doc.key}
                          className="flex items-center justify-between rounded-lg border border-logo-700 bg-logo-700 p-2.5"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="section-icon w-7 h-7 shrink-0">
                              <FileCheck className="w-4 h-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="font-semibold text-white text-xs truncate">{doc.file.name}</p>
                              <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-ink-400">
                                <span className="text-ink-300 font-medium">{doc.type}</span>
                                <span>•</span>
                                <span>{Math.max(1, Math.round(doc.file.size / 1024))} KB</span>
                                {doc.expiry && (
                                  <>
                                    <span>•</span>
                                    <span className="text-warning-400">Exp: {formatDateDDMMYYYY(doc.expiry)}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveStagedDoc(doc.key)}
                            className="icon-btn shrink-0 ml-2 !text-white hover:!bg-white/10"
                            title="Remove document"
                            aria-label="Remove document"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  savedDocs.length === 0 && (
                    <div className="text-center py-2 text-ink-400 text-xs italic">
                      Attach documents above to store driving licences, fitness proofs or identity verification.
                    </div>
                  )
                )}
              </div>

              <div>
                <label className="form-label">
                  Permanent Residential Address:
                </label>
                <textarea
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="form-input"
                />
              </div>

              {saveError && (
                <div className="alert-banner" role="alert">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="text-xs">{saveError}</span>
                </div>
              )}
             </div>

              {/* Submit / Cancel Buttons */}
              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {saving
                      ? 'Saving…'
                      : editingEmployee
                        ? 'Save Profile'
                        : 'Register Operator'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Operator Detailed Profile Modal (Showing Attached Documents) */}
      {liveSelected && (
        <div className="modal-overlay">
          <div className="modal-panel modal-panel-wide text-xs">
            <div className="modal-header">
              <div className="min-w-0">
                <span className="chip">{liveSelected.employeeId}</span>
                <h3 className="modal-title break-words">{liveSelected.fullName}</h3>
              </div>
              <button
                onClick={() => setSelectedEmployee(null)}
                className="icon-btn shrink-0"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="modal-body space-y-4">
              {statusError && (
                <div className="alert-banner" role="alert">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="text-xs">{statusError}</span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <span className="stat-label block">Designation:</span>
                  <strong className="text-ink-900 text-sm">{liveSelected.designation}</strong>
                  <p className="mt-0.5">
                    <a href={`tel:${liveSelected.mobile.replace(/\s/g, '')}`} className="text-logo-700 font-semibold">{liveSelected.mobile}</a>
                  </p>
                  <span className={`badge mt-1 ${liveSelected.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>
                    {liveSelected.status}
                  </span>
                </div>
                <div>
                  <span className="stat-label block">Wage Model:</span>
                  <strong className="text-ink-900 text-sm block">
                    {liveSelected.salaryType === 'daily' ? (
                      <span className="inline-flex items-center gap-1">
                        <Currency value={liveSelected.dailyRate} size="sm" /> / day
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Currency value={liveSelected.monthlySalary} size="sm" /> / month
                      </span>
                    )}
                  </strong>
                  {liveSelected.salaryType === 'monthly' && liveSelected.monthlySalary > 0 && (
                    <p className="text-ink-600 font-medium">{formatPerDay(liveSelected.monthlySalary, currentDate)}</p>
                  )}
                  <p className="text-ink-500">Standard {liveSelected.standardShiftHours || 10}h working shift</p>
                </div>
              </div>

              {liveSelected.employeeType === 'operator' && (
                <div className="rounded-lg border border-line bg-surface-muted p-3 sm:p-4 space-y-2">
                  <span className="font-semibold text-ink-900 block text-xs">Operator License Profile</span>
                  <div className="grid grid-cols-2 gap-2 text-ink-700">
                    <div className="min-w-0">
                      <span className="stat-label block">License Number:</span>
                      <strong className="font-mono break-all">{liveSelected.licenseNumber || 'Not recorded'}</strong>
                    </div>
                    <div className="min-w-0">
                      <span className="stat-label block">Joining Date:</span>
                      <strong>{formatDateDDMMYYYY(liveSelected.joiningDate)}</strong>
                    </div>
                    <div className="min-w-0">
                      <span className="stat-label block">Crane License Expiry:</span>
                      <strong className="text-ink-900">
                        {liveSelected.craneLicenseExpiry ? formatDateDDMMYYYY(liveSelected.craneLicenseExpiry) : 'Not recorded'}
                      </strong>
                    </div>
                    <div className="min-w-0">
                      <span className="stat-label block">Transport License Expiry:</span>
                      <strong className="text-ink-900">
                        {liveSelected.transportLicenseExpiry ? formatDateDDMMYYYY(liveSelected.transportLicenseExpiry) : 'Not recorded'}
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              {/* Uploaded Documents Showcase */}
              <div className="rounded-lg border border-line bg-surface-muted p-3 sm:p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink-900 block text-xs">
                    Uploaded Documents ({docsOf(liveSelected).length})
                  </span>
                  <button
                    onClick={() => {
                      const emp = liveSelected;
                      setSelectedEmployee(null);
                      handleOpenEdit(emp);
                    }}
                    className="btn btn-ghost btn-sm"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Upload More</span>
                  </button>
                </div>

                {docsOf(liveSelected).length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {docsOf(liveSelected).map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between rounded-lg border border-line bg-surface p-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="section-icon shrink-0">
                            <FileCheck className="w-4 h-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold text-ink-900 text-xs truncate">{doc.name}</p>
                            <span className="text-[10px] text-ink-500 block truncate">
                              {doc.type}{doc.sizeKb ? ` • ${doc.sizeKb} KB` : ''}
                              {doc.expiryDate ? ` • Exp ${formatDateDDMMYYYY(doc.expiryDate)}` : ''}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void openDocument(doc)}
                          className="btn btn-secondary btn-sm ml-2 shrink-0"
                        >
                          <Eye className="w-3 h-3" />
                          <span>View</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state py-3 text-xs italic">
                    No documents uploaded yet. Use &quot;Upload More&quot; to attach statutory documents.
                  </div>
                )}
              </div>

              <div>
                <span className="stat-label block mb-0.5">Residential Address:</span>
                <p className="rounded-lg border border-line bg-surface-muted p-2.5 text-ink-700 break-words">
                  {liveSelected.address || 'Address not recorded.'}
                </p>
              </div>
            </div>

            <div className="modal-footer">
              {confirmDeactivate ? (
                <>
                  <span className="mr-auto text-xs font-medium text-ink-700">
                    Deactivate {liveSelected.fullName}? They will be hidden from the active list.
                  </span>
                  <button className="btn btn-secondary" onClick={() => setConfirmDeactivate(false)} disabled={statusBusy}>
                    Keep active
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => void changeStatus(liveSelected, 'inactive')}
                    disabled={statusBusy}
                  >
                    {statusBusy ? 'Saving…' : 'Yes, deactivate'}
                  </button>
                </>
              ) : (
                <>
                  {liveSelected.status === 'active' ? (
                    <button className="btn btn-danger mr-auto" onClick={() => setConfirmDeactivate(true)}>
                      Deactivate
                    </button>
                  ) : (
                    <button
                      className="btn btn-secondary mr-auto"
                      onClick={() => void changeStatus(liveSelected, 'active')}
                      disabled={statusBusy}
                    >
                      {statusBusy ? 'Saving…' : 'Reactivate'}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const emp = liveSelected;
                      setSelectedEmployee(null);
                      handleOpenEdit(emp);
                    }}
                    className="btn btn-secondary"
                  >
                    Edit
                  </button>
                  <button onClick={() => setSelectedEmployee(null)} className="btn btn-primary">
                    Close
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scan modals open on top of the add / edit form (which is later in the DOM). */}
      {(showScan || showAadhaar) && (
        <div className="relative z-[60]">
          {showScan && <LicenceScanModal onClose={() => setShowScan(false)} onApply={handleApplyScan} />}
          {showAadhaar && <AadhaarScanModal onClose={() => setShowAadhaar(false)} onApply={handleApplyAadhaar} />}
        </div>
      )}
    </div>
  );
};
