import React, { useState } from 'react';
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
import { Currency } from '../common/Currency';

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
    getLicenseAlerts,
    currentDate,
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
  const [dob, setDob] = useState('1990-01-01');
  const [joiningDate, setJoiningDate] = useState('2023-01-01');
  const [designation, setDesignation] = useState('Hydraulic Crane Operator');
  const [employeeType, setEmployeeType] = useState<EmployeeType>('operator');
  const [address, setAddress] = useState('');
  const [salaryType, setSalaryType] = useState<SalaryType>('daily');
  const [dailyRate, setDailyRate] = useState('900');
  const [monthlySalary, setMonthlySalary] = useState('25000');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [craneLicenseDate, setCraneLicenseDate] = useState('');
  const [craneLicenseExpiry, setCraneLicenseExpiry] = useState('');
  const [transportLicenseDate, setTransportLicenseDate] = useState('');
  const [transportLicenseExpiry, setTransportLicenseExpiry] = useState('');
  const [licenceExtras, setLicenceExtras] = useState<LicenceExtras>({ licenseVehicleClasses: [] });
  const [showScan, setShowScan] = useState(false);
  const [scannedLicence, setScannedLicence] = useState(false);
  const [scanFiles, setScanFiles] = useState<{ front?: File; back?: File }>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyMobile, setEmergencyMobile] = useState('');
  const [emergencyRelation, setEmergencyRelation] = useState('Wife');

  // Pre-save Document Upload State
  const [stagedDocuments, setStagedDocuments] = useState<DocumentRecord[]>([]);
  const [uploadDocType, setUploadDocType] = useState(STANDARD_DOCUMENT_TYPES[0]);
  const [uploadDocTitle, setUploadDocTitle] = useState('');
  const [uploadDocExpiry, setUploadDocExpiry] = useState('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadFileSize, setUploadFileSize] = useState<number>(0);
  const [uploadFileDataUrl, setUploadFileDataUrl] = useState<string>('');

  // License Quick Renewal Modal
  const [licenseRenewalEmp, setLicenseRenewalEmp] = useState<Employee | null>(null);
  const [newCraneExpiry, setNewCraneExpiry] = useState('2027-10-24');
  const [newTransportExpiry, setNewTransportExpiry] = useState('2028-10-24');

  const licenseAlerts = getLicenseAlerts();

  const handleOpenAdd = () => {
    setEditingEmployee(null);
    setFullName('');
    setMobile('');
    setEmail('');
    setDob('1992-05-15');
    setJoiningDate(currentDate);
    setDesignation(employeeType === 'operator' ? 'Crane Operator Grade I' : 'Site Supervisor');
    setEmployeeType('operator');
    setAddress('Navi Mumbai, Maharashtra');
    setSalaryType('daily');
    setDailyRate('900');
    setMonthlySalary('0');
    setLicenseNumber('');
    setCraneLicenseDate('');
    setCraneLicenseExpiry('');
    setTransportLicenseDate('');
    setTransportLicenseExpiry('');
    setLicenceExtras({ licenseVehicleClasses: [] });
    setScannedLicence(false);
    setScanFiles({});
    setSaveError('');
    setEmergencyName('');
    setEmergencyMobile('');
    setEmergencyRelation('Wife');

    // Reset staged documents
    setStagedDocuments([]);
    setUploadDocType(STANDARD_DOCUMENT_TYPES[0]);
    setUploadDocTitle('');
    setUploadDocExpiry('');
    setUploadFileName('');
    setUploadFileSize(0);
    setUploadFileDataUrl('');

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
    setSaveError('');
    if (emp.emergencyContacts && emp.emergencyContacts[0]) {
      setEmergencyName(emp.emergencyContacts[0].name);
      setEmergencyMobile(emp.emergencyContacts[0].mobile);
      setEmergencyRelation(emp.emergencyContacts[0].relation);
    } else {
      setEmergencyName('');
      setEmergencyMobile('');
      setEmergencyRelation('');
    }

    // Populate existing documents
    setStagedDocuments(emp.documents || []);
    setUploadDocType(STANDARD_DOCUMENT_TYPES[0]);
    setUploadDocTitle('');
    setUploadDocExpiry('');
    setUploadFileName('');
    setUploadFileSize(0);
    setUploadFileDataUrl('');

    setShowModal(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFileName(file.name);
      setUploadFileSize(Math.round(file.size / 1024));
      const reader = new FileReader();
      reader.onload = () => {
        setUploadFileDataUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
      if (!uploadDocTitle) {
        setUploadDocTitle(file.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleStageDocument = () => {
    if (!uploadFileName && !uploadDocTitle) return;

    const newDoc: DocumentRecord = {
      id: `DOC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: uploadDocType,
      name: uploadDocTitle.trim() || uploadFileName || `${uploadDocType} Document`,
      fileUrl: uploadFileDataUrl || '/assets/image.png',
      uploadDate: currentDate,
      expiryDate: uploadDocExpiry || undefined,
      sizeKb: uploadFileSize || Math.floor(Math.random() * 500) + 150,
    };

    setStagedDocuments((prev) => [newDoc, ...prev]);

    // Reset single upload inputs
    setUploadDocTitle('');
    setUploadDocExpiry('');
    setUploadFileName('');
    setUploadFileSize(0);
    setUploadFileDataUrl('');
  };

  const handleRemoveStagedDoc = (docId: string) => {
    setStagedDocuments((prev) => prev.filter((d) => d.id !== docId));
  };

  /** Copy reviewed scan results into the form; the user can still edit before saving. */
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
    const emergencyContacts = emergencyName
      ? [{ id: `EC-${Date.now()}`, name: emergencyName, mobile: emergencyMobile, relation: emergencyRelation }]
      : [];

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
      emergencyContacts,
      documents: stagedDocuments,
    };

    setSaving(true);
    try {
      let employeeId: string;
      if (editingEmployee) {
        await updateEmployee(editingEmployee.id, common);
        employeeId = editingEmployee.id;
      } else {
        const created = await addEmployee({
          ...common,
          employeeId: '',
          status: 'active',
          standardShiftHours: 10,
          overtimeEligible: true,
          salaryEffectiveDate: currentDate,
        });
        employeeId = created.id;
      }

      // Keep the scanned photos with the record. The details are already saved,
      // so a failed upload is reported without losing them.
      const expiry = transportLicenseExpiry || craneLicenseExpiry || undefined;
      const uploads: Array<[File | undefined, string]> = [
        [scanFiles.front, 'Driving Licence – Front'],
        [scanFiles.back, 'Driving Licence – Back'],
      ];
      const failed: string[] = [];
      for (const [file, label] of uploads) {
        if (!file) continue;
        try {
          await attachEmployeeDocument(employeeId, file, label, expiry);
        } catch {
          failed.push(label);
        }
      }
      if (failed.length) {
        setSaveError(
          `Saved, but could not upload: ${failed.join(', ')}. Open the profile and attach the photo again.`,
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

  const handleConfirmLicenseRenewal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseRenewalEmp) return;
    renewOperatorLicense(licenseRenewalEmp.id, newCraneExpiry, newTransportExpiry);
    setLicenseRenewalEmp(null);
  };

  const filteredEmployees = employees.filter((emp) => {
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
        <div>
          <h2 className="page-title">
            Employee & Operator Master
          </h2>
          <p className="page-subtitle">
            Operator licenses, daily wage rates, emergency contacts, and statutory document storage.
          </p>
        </div>

        <button
          onClick={handleOpenAdd}
          className="btn btn-primary self-start sm:self-auto shrink-0"
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
            className={`tab ${activeTab === 'operators' ? 'tab-active' : ''}`}
          >
            Crane Operators ({employees.filter((e) => e.employeeType === 'operator').length})
          </button>
          <button
            onClick={() => setActiveTab('staff')}
            className={`tab ${activeTab === 'staff' ? 'tab-active' : ''}`}
          >
            Management & Staff ({employees.filter((e) => e.employeeType !== 'operator').length})
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`tab ${activeTab === 'all' ? 'tab-active' : ''}`}
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
      </div>

      {/* Operator List Table */}
      <div className="table-card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="px-3.5 py-3">Code</th>
                <th className="px-3.5 py-3">Name & Role</th>
                <th className="px-3.5 py-3">Contact</th>
                <th className="px-3.5 py-3">Wage / Salary</th>
                <th className="px-3.5 py-3">Licenses & Expiries</th>
                <th className="px-3.5 py-3 text-center">Docs</th>
                <th className="px-3.5 py-3 text-center">Status</th>
                <th className="px-3.5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-800">
              {filteredEmployees.map((emp) => {
                const hasAlert = licenseAlerts.some((a) => a.targetId === emp.id);
                const docCount = emp.documents?.length || 0;

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
                      <span className="text-[10px] text-ink-500 block">10h Standard</span>
                    </td>
                    <td className="px-3.5 py-3">
                      {emp.employeeType === 'operator' ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-ink-500">Crane Lic:</span>
                            <span
                              className={`font-semibold ${
                                hasAlert ? 'text-danger-600 font-semibold' : 'text-ink-800'
                              }`}
                            >
                              {formatDateDDMMYYYY(emp.craneLicenseExpiry)}
                            </span>
                            {hasAlert && (
                              <span className="badge badge-danger">
                                Overdue
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
                      {docCount > 0 ? (
                        <span className="badge badge-neutral">
                          <FileText className="w-3 h-3" />
                          <span>{docCount}</span>
                        </span>
                      ) : (
                        <span className="text-ink-300 text-[11px]">-</span>
                      )}
                    </td>

                    <td className="px-3.5 py-3 text-center">
                      <span
                        className={`badge ${
                          emp.status === 'active' ? 'badge-success' : 'badge-neutral'
                        }`}
                      >
                        {emp.status}
                      </span>
                    </td>

                    <td className="px-3.5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {emp.employeeType === 'operator' && hasAlert && (
                          <button
                            onClick={() => {
                              setLicenseRenewalEmp(emp);
                              setNewCraneExpiry(emp.craneLicenseExpiry || '2027-10-24');
                            }}
                            className="btn btn-primary btn-sm"
                          >
                            Renew License
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenEdit(emp)}
                          className="btn btn-ghost btn-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setSelectedEmployee(emp)}
                          className="btn btn-ghost btn-sm"
                        >
                          Profile
                          <ArrowRight
                            size={12}
                            className="inline-block align-middle ml-1"
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showScan && <LicenceScanModal onClose={() => setShowScan(false)} onApply={handleApplyScan} />}

      {/* License Quick Renewal Modal */}
      {licenseRenewalEmp && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <h3 className="modal-title">Renew Operator Commercial License</h3>
              <button
                onClick={() => setLicenseRenewalEmp(null)}
                className="icon-btn"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmLicenseRenewal} className="modal-body space-y-4 text-xs">
              <div className="notice notice--warning">
                <span className="font-semibold block text-sm">
                  {licenseRenewalEmp.fullName} ({licenseRenewalEmp.employeeId})
                </span>
                <span className="text-ink-600 block mt-0.5">
                  License #: {licenseRenewalEmp.licenseNumber}
                </span>
              </div>

              <div>
                <label className="form-label">
                  New Crane Heavy Machine License Expiry:
                </label>
                <input
                  type="date"
                  required
                  value={newCraneExpiry}
                  onChange={(e) => setNewCraneExpiry(e.target.value)}
                  className="form-input font-semibold"
                />
              </div>

              <div>
                <label className="form-label">
                  New Transport Vehicle License Expiry:
                </label>
                <input
                  type="date"
                  required
                  value={newTransportExpiry}
                  onChange={(e) => setNewTransportExpiry(e.target.value)}
                  className="form-input font-semibold"
                />
              </div>

              <div className="form-actions">
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
                onClick={() => setShowModal(false)}
                className="icon-btn"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="modal-body space-y-5">
              {/* Basic Information */}
              <div className="space-y-3">
                <span className="stat-label block">
                  1. Personal & Contact Details
                </span>
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
                    <input
                      type="date"
                      required
                      value={joiningDate}
                      onChange={(e) => setJoiningDate(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>
              </div>

              {/* Salary Configuration */}
              <div className="rounded-lg border border-line bg-surface-muted p-4 space-y-3">
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
                      required
                      value={salaryType === 'daily' ? dailyRate : monthlySalary}
                      onChange={(e) =>
                        salaryType === 'daily' ? setDailyRate(e.target.value) : setMonthlySalary(e.target.value)
                      }
                      className="form-input"
                    />
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
                <div className="rounded-lg border border-line bg-surface-muted p-4 space-y-3">
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
                      <input
                        type="date"
                        value={craneLicenseDate}
                        onChange={(e) => setCraneLicenseDate(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">
                        Crane License Expiry Date:
                      </label>
                      <input
                        type="date"
                        value={craneLicenseExpiry}
                        onChange={(e) => setCraneLicenseExpiry(e.target.value)}
                        className="form-input font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">
                        Transport License Issue Date:
                      </label>
                      <input
                        type="date"
                        value={transportLicenseDate}
                        onChange={(e) => setTransportLicenseDate(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">
                        Transport License Expiry Date:
                      </label>
                      <input
                        type="date"
                        value={transportLicenseExpiry}
                        onChange={(e) => setTransportLicenseExpiry(e.target.value)}
                        className="form-input font-bold"
                      />
                    </div>
                  </div>

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

              {/* Emergency Contact */}
              <div className="rounded-lg border border-line bg-surface-muted p-4 space-y-2">
                <span className="stat-label block">
                  4. Emergency Contact
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="form-label">Contact Name:</label>
                    <input
                      type="text"
                      placeholder="e.g. Sangeeta Patel"
                      value={emergencyName}
                      onChange={(e) => setEmergencyName(e.target.value)}
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="form-label">Contact Mobile:</label>
                    <input
                      type="text"
                      placeholder="+91 98201 12233"
                      value={emergencyMobile}
                      onChange={(e) => setEmergencyMobile(e.target.value)}
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="form-label">Relation:</label>
                    <input
                      type="text"
                      placeholder="Wife / Father / Brother"
                      value={emergencyRelation}
                      onChange={(e) => setEmergencyRelation(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>
              </div>

              {/* Dedicated Operator & Employee Documents Upload Section (Before Saving) */}
              <div className="rounded-lg border border-ink-800 bg-ink-900 p-4 space-y-4 text-white">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-ink-800 pb-3">
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
                    {stagedDocuments.length} Document{stagedDocuments.length === 1 ? '' : 's'} Attached
                  </span>
                </div>

                {/* Upload Inputs Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-lg border border-ink-800 bg-ink-950 p-3">
                  <div>
                    <label className="form-label mb-1 !text-ink-300">
                      Document Type:
                    </label>
                    <Select value={uploadDocType} onValueChange={setUploadDocType}>
                      <SelectTrigger className="form-input !border-line-strong !bg-ink-900 !text-white">
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
                      className="form-input !border-line-strong !bg-ink-900 !text-white"
                    />
                  </div>

                  <div>
                    <label className="form-label mb-1 !text-ink-300">
                      Expiry Date (If Applicable):
                    </label>
                    <input
                      type="date"
                      value={uploadDocExpiry}
                      onChange={(e) => setUploadDocExpiry(e.target.value)}
                      className="form-input !border-line-strong !bg-ink-900 !text-white"
                    />
                  </div>
                </div>

                {/* File Selector & Stage Button */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-lg border border-ink-800 bg-ink-900 p-3">
                  <div className="flex items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-ink-800 px-3 py-2 text-xs font-semibold text-white hover:bg-ink-700">
                      <Upload className="w-3.5 h-3.5 text-ink-300" />
                      <span>Choose File (PDF/Image)</span>
                      <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </label>
                    <div className="truncate">
                      {uploadFileName ? (
                        <span className="font-semibold text-white text-xs truncate block max-w-xs">
                          {uploadFileName} ({uploadFileSize} KB)
                        </span>
                      ) : (
                        <span className="text-ink-400 text-xs">No file chosen yet</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleStageDocument}
                    disabled={!uploadFileName && !uploadDocTitle}
                    className="btn btn-primary"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Attach Document</span>
                  </button>
                </div>

                {/* Staged Documents List (Ready to save) */}
                {stagedDocuments.length > 0 ? (
                  <div className="space-y-2 pt-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                      Documents Ready to be Saved ({stagedDocuments.length}):
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {stagedDocuments.map((doc) => (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between rounded-lg border border-ink-800 bg-ink-900 p-2.5"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="section-icon w-7 h-7">
                              <FileCheck className="w-4 h-4" />
                            </span>
                            <div className="truncate">
                              <p className="font-semibold text-white text-xs truncate">{doc.name}</p>
                              <div className="flex items-center gap-1.5 text-[10px] text-ink-400">
                                <span className="text-ink-300 font-medium">{doc.type}</span>
                                <span>•</span>
                                <span>{doc.sizeKb} KB</span>
                                {doc.expiryDate && (
                                  <>
                                    <span>•</span>
                                    <span className="text-warning-400">
                                      Exp: {formatDateDDMMYYYY(doc.expiryDate)}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveStagedDoc(doc.id)}
                            className="icon-btn shrink-0 ml-2"
                            title="Remove document"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-2 text-ink-400 text-xs italic">
                    Attach documents above to store driving licenses, fitness proofs or identity verification.
                  </div>
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

              {/* Submit / Cancel Buttons */}
              <div className="form-actions">
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
                        ? `Save Profile (${stagedDocuments.length} Docs)`
                        : `Register Operator (${stagedDocuments.length} Docs)`}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Operator Detailed Profile Modal (Showing Attached Documents) */}
      {selectedEmployee && (
        <div className="modal-overlay">
          <div className="modal-panel modal-panel-wide text-xs">
            <div className="modal-header">
              <div>
                <span className="chip">
                  {selectedEmployee.employeeId}
                </span>
                <h3 className="modal-title">{selectedEmployee.fullName}</h3>
              </div>
              <button
                onClick={() => setSelectedEmployee(null)}
                className="icon-btn"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="modal-body space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="stat-label block">Designation:</span>
                  <strong className="text-ink-900 text-sm">{selectedEmployee.designation}</strong>
                  <p className="text-ink-500 mt-0.5">{selectedEmployee.mobile}</p>
                </div>
                <div>
                  <span className="stat-label block">Wage Model:</span>
                  <strong className="text-ink-900 text-sm block">
                    {selectedEmployee.salaryType === 'daily' ? (
                      <span className="inline-flex items-center gap-1">
                        <Currency value={selectedEmployee.dailyRate} size="sm" /> / day
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Currency value={selectedEmployee.monthlySalary} size="sm" /> / mo
                      </span>
                    )}
                  </strong>
                  <p className="text-ink-500">Standard 10h working shift</p>
                </div>
              </div>

              {selectedEmployee.employeeType === 'operator' && (
                <div className="rounded-lg border border-line bg-surface-muted p-4 space-y-2">
                  <span className="font-semibold text-ink-900 block text-xs">Operator License Profile</span>
                  <div className="grid grid-cols-2 gap-2 text-ink-700">
                    <div>
                      <span className="stat-label block">License Number:</span>
                      <strong className="font-mono">{selectedEmployee.licenseNumber || 'MH-LIC-PENDING'}</strong>
                    </div>
                    <div>
                      <span className="stat-label block">Joining Date:</span>
                      <strong>{formatDateDDMMYYYY(selectedEmployee.joiningDate)}</strong>
                    </div>
                    <div>
                      <span className="stat-label block">Crane License Expiry:</span>
                      <strong className="text-ink-900">
                        {formatDateDDMMYYYY(selectedEmployee.craneLicenseExpiry)}
                      </strong>
                    </div>
                    <div>
                      <span className="stat-label block">Transport License Expiry:</span>
                      <strong className="text-ink-900">
                        {formatDateDDMMYYYY(selectedEmployee.transportLicenseExpiry)}
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              {/* Uploaded Documents Showcase */}
              <div className="rounded-lg border border-line bg-surface-muted p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-ink-900 block text-xs">
                    Uploaded Operator Documents ({selectedEmployee.documents?.length || 0})
                  </span>
                  <button
                    onClick={() => {
                      const emp = selectedEmployee;
                      setSelectedEmployee(null);
                      handleOpenEdit(emp);
                    }}
                    className="btn btn-ghost btn-sm"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Upload More</span>
                  </button>
                </div>

                {selectedEmployee.documents && selectedEmployee.documents.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedEmployee.documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between rounded-lg border border-line bg-surface p-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="section-icon">
                            <FileCheck className="w-4 h-4" />
                          </span>
                          <div className="truncate">
                            <p className="font-semibold text-ink-900 text-xs truncate">{doc.name}</p>
                            <span className="text-[10px] text-ink-500 block truncate">
                              {doc.type} • {doc.sizeKb || 240} KB
                            </span>
                          </div>
                        </div>
                        <a
                          href={doc.fileUrl || '#'}
                          download={doc.name}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-secondary btn-sm ml-2 shrink-0"
                        >
                          <Eye className="w-3 h-3" />
                          <span>View</span>
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state py-3 text-xs italic">
                    No documents uploaded yet for this employee. Click &quot;Edit&quot; to attach statutory documents.
                  </div>
                )}
              </div>

              {selectedEmployee.emergencyContacts && selectedEmployee.emergencyContacts.length > 0 && (
                <div className="rounded-lg border border-line bg-surface-muted p-4">
                  <span className="font-semibold text-ink-900 block text-xs mb-1">Emergency Contact</span>
                  <p className="text-ink-900 font-semibold">
                    {selectedEmployee.emergencyContacts[0].name} ({selectedEmployee.emergencyContacts[0].relation})
                  </p>
                  <p className="text-ink-500">{selectedEmployee.emergencyContacts[0].mobile}</p>
                </div>
              )}

              <div>
                <span className="stat-label block mb-0.5">Residential Address:</span>
                <p className="rounded-lg border border-line bg-surface-muted p-2.5 text-ink-700">
                  {selectedEmployee.address || 'Address not recorded.'}
                </p>
              </div>
            </div>

            <div className="modal-footer">
              <button
                onClick={() => setSelectedEmployee(null)}
                className="btn btn-primary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
