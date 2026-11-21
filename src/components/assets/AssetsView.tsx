import React, { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  X,
  Truck,
  Plus,
  Search,
  Wrench,
  ShieldCheck,
  FileCheck2,
  FileBadge,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  FileText,
  Gauge,
  MapPin,
  ChevronRight,
  IdCard,
  ScanLine,
  Paperclip,
  AlertCircle,
} from "lucide-react";
import { useSkyhook } from "../../data/apiStore";
import {
  formatINR,
  formatDateDDMMYYYY,
  calculateExpiryFromInterval,
  formatServiceInterval,
  sumOperatingHours,
} from "../../utils/calculations";
import {
  MachineAsset,
  MachineType,
  AssetStatus,
  ReminderAlertItem,
  RcDetails,
} from "../../types";
import { Currency } from "../common/Currency";
import { RcDetailsFields, RcScanModal, RcScanOutcome } from "./RcScan";
import { MachineDocumentsList, RcDetailsSummary } from "./MachineRcPanels";
import { AgeingBar } from "../common/Ageing";

import { DateInput } from '../common/DateInput';
const RC_DOC_TYPE = "Registration Certificate (RC)";

/** Consistent visual language for every asset status. Red stays reserved for critical alerts. */
const ASSET_STATUS_META: Record<
  AssetStatus,
  { label: string; className: string }
> = {
  assigned: { label: "Assigned to site", className: "badge badge-success" },
  available: { label: "Available in depot", className: "badge badge-neutral" },
  under_maintenance: {
    label: "Under maintenance",
    className: "badge badge-warning",
  },
  inactive: {
    label: "Inactive",
    className: "badge border border-line bg-surface text-ink-500",
  },
  sold: {
    label: "Sold",
    className: "badge border border-ink-300 bg-surface text-ink-600",
  },
};

const AssetStatusBadge: React.FC<{ status: AssetStatus }> = ({ status }) => {
  const meta = ASSET_STATUS_META[status] || ASSET_STATUS_META.available;
  return <span className={`${meta.className} shrink-0`}>{meta.label}</span>;
};

/** Reusable label/value pair for equipment specifications and ownership details. */
const DetailItem: React.FC<{
  label: string;
  value: React.ReactNode;
  icon?: React.ElementType;
}> = ({ label, value, icon: Icon }) => (
  <div className="min-w-0">
    <span className="stat-label block">{label}</span>
    <span className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-ink-800">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-ink-400" />}
      <span className="truncate">{value || "—"}</span>
    </span>
  </div>
);

/** Small section heading used inside the profile dialog. */
const ProfileSection: React.FC<{ title: string; icon: React.ElementType }> = ({
  title,
  icon: Icon,
}) => (
  <div className="flex items-center gap-2.5 border-b border-line pb-3">
    <span className="rounded-md bg-brand-50 p-1.5 text-brand-700">
      <Icon className="h-4 w-4" />
    </span>
    <h4 className="text-sm font-bold tracking-tight text-ink-900">{title}</h4>
  </div>
);

export const AssetsView: React.FC = () => {
  const {
    machines,
    projects,
    employees,
    machineWorkingLogs,
    addMachine,
    updateMachine,
    attachMachineDocument,
    recordServiceCompleted,
    renewMachineInsurance,
    renewMachinePuc,
    renewMachineFitness,
    getServiceAlerts,
    getInsuranceAlerts,
    getPucAlerts,
    getFitnessAlerts,
    currentDate,
  } = useSkyhook();

  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [selectedMachine, setSelectedMachine] = useState<MachineAsset | null>(
    null,
  );

  // Add / Edit Machine Modal
  const [showModal, setShowModal] = useState(false);
  const [editingMachine, setEditingMachine] = useState<MachineAsset | null>(
    null,
  );

  const [machineType, setMachineType] =
    useState<MachineType>("Hydraulic Crane");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [regNo, setRegNo] = useState("");
  const [serialNo, setSerialNo] = useState("");
  const [tonnage, setTonnage] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [status, setStatus] = useState<AssetStatus>("assigned");
  const [currentProject, setCurrentProject] = useState("PRJ-001");

  // Service details — intervals may be calendar months or crane operating hours
  const [lastServiceDate, setLastServiceDate] = useState("2026-08-20");
  const [serviceFreqValue, setServiceFreqValue] = useState(500);
  const [serviceFreqUnit, setServiceFreqUnit] = useState<"days" | "months" | "hours">("hours");
  const [lastServiceHours, setLastServiceHours] = useState(0);
  const [nextServiceDueDate, setNextServiceDueDate] = useState("2026-10-20");

  // Compliance & Interval Settings (Insurance, PUC, Fitness)
  const [insuranceStartDate, setInsuranceStartDate] = useState("2026-10-24");
  const [insuranceIntervalDays, setInsuranceIntervalDays] = useState(365);
  const [insuranceProvider, setInsuranceProvider] = useState(
    "New India Assurance",
  );
  const [insurancePolicyNumber, setInsurancePolicyNumber] =
    useState("POL-COMM-8812");
  const [insuranceExpiry, setInsuranceExpiry] = useState("2027-10-24");

  const [pucIssueDate, setPucIssueDate] = useState("2026-10-24");
  const [pucIntervalDays, setPucIntervalDays] = useState(180);
  const [pucNumber, setPucNumber] = useState("PUC-MH04-881290");
  const [pucExpiry, setPucExpiry] = useState("2027-04-22");

  const [lastFitnessDate, setLastFitnessDate] = useState("2026-10-24");
  const [fitnessIntervalDays, setFitnessIntervalDays] = useState(365);
  const [fitnessCertNumber, setFitnessCertNumber] = useState(
    "FIT-THANE-2026-8812",
  );
  const [fitnessDueDate, setFitnessDueDate] = useState("2027-10-24");

  // Service Completion Quick Action
  const [serviceModalMachine, setServiceModalMachine] =
    useState<MachineAsset | null>(null);
  const [completedServiceCost, setCompletedServiceCost] = useState("45000");
  const [completedServiceProvider, setCompletedServiceProvider] = useState(
    "Authorized Liebherr Service",
  );
  const [completedServiceNotes, setCompletedServiceNotes] = useState(
    "Full hydraulic fluid flush & filter change",
  );
  const [completedServiceHours, setCompletedServiceHours] = useState("");

  // Registration certificate (RC): OCR scan + details + files to attach on save
  const [rcDetails, setRcDetails] = useState<RcDetails>({});
  const [rcFiles, setRcFiles] = useState<File[]>([]);
  const [showRcScan, setShowRcScan] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Quick Statutory Renew Modal in Fleet View
  const [renewModalMachine, setRenewModalMachine] =
    useState<MachineAsset | null>(null);
  const [renewCategory, setRenewCategory] = useState<
    "insurance" | "puc" | "fitness"
  >("insurance");
  const [renewDate, setRenewDate] = useState(currentDate);
  const [renewIntervalDays, setRenewIntervalDays] = useState(365);
  const [renewCalculatedExpiry, setRenewCalculatedExpiry] = useState("");
  const [renewDocNo, setRenewDocNo] = useState("");
  const [renewProviderName, setRenewProviderName] = useState("");

  const srvAlerts = getServiceAlerts();
  const insAlerts = getInsuranceAlerts();
  const pucAlerts = getPucAlerts();
  const fitAlerts = getFitnessAlerts();

  // Handlers for dynamic interval auto-calculation
  const handleInsuranceIntervalChange = (days: number) => {
    setInsuranceIntervalDays(days);
    setInsuranceExpiry(calculateExpiryFromInterval(insuranceStartDate, days));
  };
  const handleInsuranceStartDateChange = (date: string) => {
    setInsuranceStartDate(date);
    setInsuranceExpiry(
      calculateExpiryFromInterval(date, insuranceIntervalDays),
    );
  };

  const handlePucIntervalChange = (days: number) => {
    setPucIntervalDays(days);
    setPucExpiry(calculateExpiryFromInterval(pucIssueDate, days));
  };
  const handlePucIssueDateChange = (date: string) => {
    setPucIssueDate(date);
    setPucExpiry(calculateExpiryFromInterval(date, pucIntervalDays));
  };

  const handleFitnessIntervalChange = (days: number) => {
    setFitnessIntervalDays(days);
    setFitnessDueDate(calculateExpiryFromInterval(lastFitnessDate, days));
  };
  const handleFitnessDateChange = (date: string) => {
    setLastFitnessDate(date);
    setFitnessDueDate(calculateExpiryFromInterval(date, fitnessIntervalDays));
  };

  /** Open the add form; `scanRc` jumps straight into the RC upload. */
  const handleOpenAdd = (scanRc = false) => {
    setEditingMachine(null);
    setRcDetails({});
    setRcFiles([]);
    setSaveError("");
    setShowRcScan(scanRc);
    setMachineType("Hydraulic Crane");
    // A new asset starts empty: nothing here is invented, so nothing fake can be saved.
    setMake("");
    setModel("");
    setRegNo("");
    setSerialNo("");
    setTonnage("");
    setPurchaseCost("");
    setStatus("available");
    setCurrentProject("");
    setLastServiceDate(currentDate);
    // New machines are serviced by operating hours by default.
    setServiceFreqValue(500);
    setServiceFreqUnit("hours");
    setLastServiceHours(0);
    setNextServiceDueDate(currentDate);

    // Auto-calculate statutory renewal dates from intervals
    setInsuranceStartDate(currentDate);
    setInsuranceIntervalDays(365);
    setInsuranceExpiry(calculateExpiryFromInterval(currentDate, 365));
    setInsuranceProvider("");
    setInsurancePolicyNumber("");

    setPucIssueDate(currentDate);
    setPucIntervalDays(180);
    setPucExpiry(calculateExpiryFromInterval(currentDate, 180));
    setPucNumber("");

    setLastFitnessDate(currentDate);
    setFitnessIntervalDays(730); // fitness certificate: 2 years
    setFitnessDueDate(calculateExpiryFromInterval(currentDate, 730));
    setFitnessCertNumber("");

    setShowModal(true);
  };

  const handleOpenEdit = (m: MachineAsset) => {
    setEditingMachine(m);
    setMachineType(m.machineType);
    setMake(m.make);
    setModel(m.model);
    setRegNo(m.registrationNumber);
    setSerialNo(m.serialNumber);
    setTonnage(String(m.tonnageCapacity));
    setPurchaseCost(String(m.purchaseCost));
    setStatus(m.status);
    setCurrentProject(m.currentProjectId || "");
    setLastServiceDate(m.lastServiceDate);
    setServiceFreqValue(m.serviceFrequencyValue);
    setServiceFreqUnit(m.serviceFrequencyUnit ?? "days");
    setLastServiceHours(m.lastServiceHours ?? 0);
    setNextServiceDueDate(m.nextServiceDueDate);

    // Populate statutory dates and configured interval days
    setInsuranceStartDate(m.insuranceStartDate || currentDate);
    setInsuranceIntervalDays(m.insuranceIntervalDays || 365);
    setInsuranceExpiry(m.insuranceExpiryDate);
    setInsuranceProvider(m.insuranceProvider || "");
    setInsurancePolicyNumber(m.insurancePolicyNumber || "");

    setPucIssueDate(m.pucIssueDate || currentDate);
    setPucIntervalDays(m.pucIntervalDays || 180);
    setPucExpiry(m.pucExpiryDate);
    setPucNumber(m.pucNumber || "");

    setLastFitnessDate(m.lastFitnessDate || currentDate);
    setFitnessIntervalDays(m.fitnessIntervalDays || 730);
    setFitnessDueDate(m.nextFitnessDueDate);
    setFitnessCertNumber(m.fitnessCertificateNumber || "");

    setRcDetails(m.rcDetails ?? {});
    setRcFiles([]);
    setSaveError("");
    setShowRcScan(false);
    setShowModal(true);
  };

  /** Fill the asset form from a reviewed RC scan. */
  const handleApplyRc = (rc: RcScanOutcome) => {
    if (rc.registrationNumber) setRegNo(rc.registrationNumber);
    if (rc.make) setMake(rc.make);
    if (rc.model) setModel(rc.model);
    if (rc.machineType) setMachineType(rc.machineType);
    // The chassis number is the machine's permanent serial on Indian RCs.
    if (rc.details.chassisNumber) setSerialNo(rc.details.chassisNumber);
    setRcDetails((prev) => ({ ...prev, ...rc.details }));
    if (rc.files.length) setRcFiles(rc.files);
    setShowRcScan(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveError("");

    const fields = {
      machineType,
      make,
      model,
      registrationNumber: regNo,
      serialNumber: serialNo,
      tonnageCapacity: parseFloat(tonnage) || 0,
      purchaseCost: parseFloat(purchaseCost) || 0,
      status,
      currentProjectId: currentProject || undefined,
      lastServiceDate,
      serviceFrequencyValue: serviceFreqValue,
      serviceFrequencyUnit: serviceFreqUnit,
      lastServiceHours: Number(lastServiceHours) || 0,
      nextServiceDueDate,
      insuranceProvider,
      insurancePolicyNumber,
      insuranceStartDate,
      insuranceExpiryDate: insuranceExpiry,
      insuranceIntervalDays,
      pucNumber,
      pucIssueDate,
      pucExpiryDate: pucExpiry,
      pucIntervalDays,
      fitnessCertificateNumber: fitnessCertNumber,
      lastFitnessDate,
      nextFitnessDueDate: fitnessDueDate,
      fitnessIntervalDays,
      rcDetails: Object.keys(rcDetails).length ? rcDetails : undefined,
    };

    let saved: MachineAsset;
    try {
      if (editingMachine) {
        await updateMachine(editingMachine.id, fields);
        saved = editingMachine;
      } else {
        saved = await addMachine({
          ...fields,
          assetId: `CR-${String(machines.length + 1).padStart(3, "0")}`,
          purchaseDate: currentDate,
          serviceReminderLeadDays: 15,
          insuranceReminderLeadDays: 15,
          pucReminderLeadDays: 15,
          fitnessReminderLeadDays: 15,
          serviceHistory: [],
          documents: [],
        });
      }
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? `Could not save the asset: ${err.message}`
          : "Could not save the asset.",
      );
      setSaving(false);
      return;
    }

    // The asset is saved; now store the RC file(s) against it.
    const failed: File[] = [];
    for (const [i, file] of rcFiles.entries()) {
      const label =
        rcFiles.length > 1 ? `${RC_DOC_TYPE} – ${i + 1}` : RC_DOC_TYPE;
      try {
        await attachMachineDocument(
          saved.id,
          file,
          label,
          rcDetails.registrationValidUpto,
        );
      } catch {
        failed.push(file);
      }
    }
    setSaving(false);
    if (failed.length) {
      // Stay open in edit mode so "Save" retries only the upload — never a duplicate asset.
      setEditingMachine(saved);
      setRcFiles(failed);
      setSaveError(
        `Asset saved, but the RC file could not be uploaded (${failed
          .map((f) => f.name)
          .join(", ")}). Press Save to retry.`,
      );
      return;
    }
    setRcFiles([]);
    setShowModal(false);
  };

  // Open Quick Compliance Renewal Modal
  const handleOpenRenewModal = (
    m: MachineAsset,
    cat: "insurance" | "puc" | "fitness",
  ) => {
    setRenewModalMachine(m);
    setRenewCategory(cat);
    setRenewDate(currentDate);

    let interval = 365;
    if (cat === "insurance") {
      interval = m.insuranceIntervalDays || 365;
      setRenewProviderName(m.insuranceProvider || "New India Assurance");
      setRenewDocNo(
        m.insurancePolicyNumber ||
          "POL-" + Math.floor(1000 + Math.random() * 9000),
      );
    } else if (cat === "puc") {
      interval = m.pucIntervalDays || 180;
      setRenewDocNo(
        m.pucNumber ||
          "PUC-MH04-" + Math.floor(100000 + Math.random() * 900000),
      );
    } else if (cat === "fitness") {
      interval = m.fitnessIntervalDays || 730;
      setRenewDocNo(
        m.fitnessCertificateNumber ||
          "FIT-THANE-" +
            new Date(currentDate).getFullYear() +
            "-" +
            Math.floor(1000 + Math.random() * 9000),
      );
    }

    setRenewIntervalDays(interval);
    setRenewCalculatedExpiry(
      calculateExpiryFromInterval(currentDate, interval),
    );
  };

  const handleRenewDateChange = (val: string) => {
    setRenewDate(val);
    setRenewCalculatedExpiry(
      calculateExpiryFromInterval(val, renewIntervalDays),
    );
  };

  const handleRenewIntervalChange = (days: number) => {
    setRenewIntervalDays(days);
    setRenewCalculatedExpiry(calculateExpiryFromInterval(renewDate, days));
  };

  const handleRenewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renewModalMachine) return;

    if (renewCategory === "insurance") {
      renewMachineInsurance(
        renewModalMachine.id,
        renewCalculatedExpiry,
        renewProviderName,
        renewDocNo,
        renewDate,
      );
    } else if (renewCategory === "puc") {
      renewMachinePuc(
        renewModalMachine.id,
        renewCalculatedExpiry,
        renewDocNo,
        renewDate,
      );
    } else if (renewCategory === "fitness") {
      renewMachineFitness(
        renewModalMachine.id,
        renewCalculatedExpiry,
        renewDocNo,
        renewDate,
      );
    }

    setRenewModalMachine(null);
  };

  const handleRecordServiceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceModalMachine) return;
    const reading =
      completedServiceHours !== ""
        ? parseFloat(completedServiceHours)
        : serviceModalMachine.serviceFrequencyUnit === "hours"
          ? (serviceModalMachine.lastServiceHours || 0) +
            sumOperatingHours(
              machineWorkingLogs,
              serviceModalMachine.id,
              serviceModalMachine.lastServiceDate,
            )
          : undefined;
    recordServiceCompleted(
      serviceModalMachine.id,
      currentDate,
      parseFloat(completedServiceCost) || 0,
      completedServiceNotes,
      completedServiceProvider,
      reading,
    );
    setCompletedServiceHours("");
    setServiceModalMachine(null);
  };

  const filteredMachines = machines.filter((m) => {
    const matchType = filterType === "all" || m.machineType === filterType;
    const matchSearch =
      !searchTerm ||
      m.assetId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.make.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.registrationNumber.toLowerCase().includes(searchTerm.toLowerCase());
    return matchType && matchSearch;
  });

  // Fleet roll-up for the summary cards
  const deployedCount = machines.filter((m) => m.status === "assigned").length;
  const availableCount = machines.filter(
    (m) => m.status === "available",
  ).length;
  const maintenanceCount = machines.filter(
    (m) => m.status === "under_maintenance",
  ).length;
  const fleetValue = machines.reduce(
    (sum, m) => sum + (m.purchaseCost || 0),
    0,
  );
  const totalComplianceAlerts =
    srvAlerts.length + insAlerts.length + pucAlerts.length + fitAlerts.length;

  const findAlert = (list: ReminderAlertItem[], machine: MachineAsset) =>
    list.find((a) => a.targetId === machine.id || a.targetId === machine.assetId);

  const renderSectionHeader = (
    title: string,
    icon: React.ElementType,
    action?: React.ReactNode,
  ) => {
    const Icon = icon;
    return (
      <div className="section-heading -mx-[1.125rem] px-[1.125rem]">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="shrink-0 rounded-md bg-brand-50 p-1.5 text-brand-700">
            <Icon className="h-4 w-4" />
          </div>
          <h3 className="truncate text-sm font-bold tracking-tight text-ink-900 sm:text-base">
            {title}
          </h3>
        </div>
        {action}
      </div>
    );
  };

  const renderComplianceCell = (
    label: string,
    date: string,
    meta: string,
    alert?: ReminderAlertItem,
  ) => {
    const isOverdue = alert?.status === "overdue";
    const isDueSoon = alert?.status === "due_today";
    const tone = isOverdue
      ? "border-danger-200 bg-danger-50"
      : isDueSoon
        ? "border-warning-200 bg-warning-50"
        : "border-line bg-surface";

    return (
      <div className={`rounded-lg border p-2.5 ${tone}`}>
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
            {label}
          </span>
          <span className="text-[10px] font-medium text-ink-500">{meta}</span>
        </div>
        <div
          className={`mt-1 flex items-center gap-1.5 text-xs font-bold ${
            isOverdue
              ? "text-danger-700"
              : isDueSoon
                ? "text-warning-700"
                : "text-ink-800"
          }`}
        >
          {alert ? (
            <AlertTriangle
              className={`h-3.5 w-3.5 shrink-0 ${
                !isOverdue && !isDueSoon ? "text-ink-400" : ""
              }`}
            />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success-600" />
          )}
          <span className="truncate">{formatDateDDMMYYYY(date)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="page-header">
        <div className="min-w-0">
          <h2 className="page-title !mt-0">
            Asset Master (Cranes &amp; Equipment)
          </h2>
          <p className="page-subtitle mt-0.5">
            Heavy crane fleet database, tonnage capacity, service history, RTO
            fitness, insurance and PUC renewal deadlines.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => handleOpenAdd(true)} className="btn btn-secondary">
            <ScanLine className="h-4 w-4" />
            <span>Add from RC (OCR)</span>
          </button>
          <button onClick={() => handleOpenAdd()} className="btn btn-primary">
            <Plus className="h-4 w-4" />
            <span>Add Machine Asset</span>
          </button>
        </div>
      </div>

      {/* Fleet overview cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="stat-card">
          <div className="flex items-start justify-between gap-3">
            <span className="stat-label">Total Assets</span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <Truck className="h-4 w-4" />
            </span>
          </div>
          <div className="stat-value">{machines.length}</div>
          <div className="stat-hint">Registered cranes &amp; equipment</div>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between gap-3">
            <span className="stat-label">Deployed on Site</span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-700">
              <MapPin className="h-4 w-4" />
            </span>
          </div>
          <div className="stat-value">{deployedCount}</div>
          <div className="stat-hint">
            {availableCount} in depot · {maintenanceCount} in service
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between gap-3">
            <span className="stat-label">Fleet Book Value</span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <DollarSign className="h-4 w-4" />
            </span>
          </div>
          <div className="stat-value">
            <Currency value={fleetValue} size="xl" />
          </div>
          <div className="stat-hint">Across all registered assets</div>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between gap-3">
            <span className="stat-label">Compliance Alerts</span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-danger-50 text-danger-600">
              <AlertTriangle className="h-4 w-4" />
            </span>
          </div>
          <div
            className={`stat-value ${totalComplianceAlerts > 0 ? "text-danger-600" : "text-success-600"}`}
          >
            {totalComplianceAlerts}
          </div>
          <div className="stat-hint">Service, insurance, PUC &amp; fitness</div>
        </div>
      </div>

      {/* Search and filters */}
      <div className="filter-bar filter-bar--split">
        <div className="search-box">
          <Search className="h-4 w-4" />
          <input
            type="text"
            placeholder="Search crane ID, make, registration..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-input pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="form-input w-auto min-w-[180px]">
              <SelectValue placeholder="All crane types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Crane Types</SelectItem>
              <SelectItem value="Hydraulic Crane">Hydraulic Crane</SelectItem>
              <SelectItem value="Mobile Crane">Mobile Crane</SelectItem>
              <SelectItem value="Crawler Crane">Crawler Crane</SelectItem>
              <SelectItem value="Hydra">Hydra</SelectItem>
              <SelectItem value="Tower Crane">Tower Crane</SelectItem>
              <SelectItem value="Rough Terrain Crane">
                Rough Terrain Crane
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Fleet register */}
      <div className="card card-pad">
        {renderSectionHeader(
          "Fleet Register",
          Truck,
          <span className="shrink-0 text-xs text-ink-500">
            {filteredMachines.length} of {machines.length} assets
          </span>,
        )}

        {filteredMachines.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredMachines.map((m) => {
              const currentPrj = projects.find(
                (p) => p.id === m.currentProjectId,
              );
              const serviceAlert = findAlert(srvAlerts, m);
              const insuranceAlert = findAlert(insAlerts, m);
              const pucAlert = findAlert(pucAlerts, m);
              const fitnessAlert = findAlert(fitAlerts, m);
              const totalAlertsOnMachine =
                (serviceAlert ? 1 : 0) +
                (insuranceAlert ? 1 : 0) +
                (pucAlert ? 1 : 0) +
                (fitnessAlert ? 1 : 0);

              return (
                <div
                  key={m.id}
                  className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:border-line-strong hover:bg-surface-muted/40"
                >
                  <div className="flex-1 space-y-4 p-4 sm:p-5">
                    {/* Asset identity */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                          <Truck className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <span className="block text-sm font-bold tracking-tight text-ink-900">
                            {m.assetId}
                          </span>
                          <h3 className="mt-1 truncate text-sm font-semibold text-ink-800">
                            {m.make} {m.model}
                          </h3>
                          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-500">
                            <IdCard className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                            {m.registrationNumber}
                          </p>
                        </div>
                      </div>
                      <AssetStatusBadge status={m.status} />
                    </div>

                    {/* Equipment type & deployment */}
                    <div className="rounded-lg border border-line bg-surface-muted p-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="min-w-0">
                          <span className="stat-label block">
                            Equipment type
                          </span>
                          <span className="mt-1 block truncate text-xs font-semibold text-ink-800">
                            {m.machineType}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <span className="stat-label block">
                            Deployed site
                          </span>
                          <span className="mt-1 flex items-center gap-1.5 truncate text-xs font-semibold text-ink-800">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                            {currentPrj ? currentPrj.name : "Depot pool"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Compliance & renewals */}
                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="stat-label">
                          Compliance &amp; renewals
                        </span>
                        {totalAlertsOnMachine > 0 ? (
                          <span className="badge badge-danger">
                            <AlertTriangle className="h-3 w-3" />
                            {totalAlertsOnMachine} action
                            {totalAlertsOnMachine > 1 ? "s" : ""} required
                          </span>
                        ) : (
                          <span className="badge badge-success">
                            <CheckCircle2 className="h-3 w-3" />
                            All clear
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {renderComplianceCell(
                          "Service due",
                          m.serviceFrequencyUnit === "hours"
                            ? formatDateDDMMYYYY(m.lastServiceDate)
                            : m.nextServiceDueDate,
                          `Every ${formatServiceInterval(m.serviceFrequencyValue || 60, m.serviceFrequencyUnit ?? "days")}`,
                          serviceAlert,
                        )}
                        {renderComplianceCell(
                          "Insurance exp.",
                          m.insuranceExpiryDate,
                          `${m.insuranceIntervalDays || 365}d`,
                          insuranceAlert,
                        )}
                        {renderComplianceCell(
                          "PUC exp.",
                          m.pucExpiryDate,
                          `${m.pucIntervalDays || 180}d`,
                          pucAlert,
                        )}
                        {renderComplianceCell(
                          "Fitness due",
                          m.nextFitnessDueDate,
                          `${m.fitnessIntervalDays || 730}d`,
                          fitnessAlert,
                        )}
                      </div>
                      {m.serviceFrequencyUnit === "hours" && (
                        <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50/60 p-2.5 text-[11px] text-brand-900">
                          <span className="font-bold">Operating-hour service:</span>{" "}
                          {Math.round(
                            sumOperatingHours(machineWorkingLogs, m.id, m.lastServiceDate),
                          )}{" "}
                          h logged since service · due every {m.serviceFrequencyValue} h
                        </div>
                      )}
                    </div>

                    {/* Specifications & ownership */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3">
                      <DetailItem
                        label="Serial number"
                        value={m.serialNumber || "—"}
                        icon={FileText}
                      />
                      <DetailItem
                        label="Capacity"
                        value={`${m.tonnageCapacity} Tonnes`}
                        icon={Gauge}
                      />
                      <DetailItem
                        label="Purchase date"
                        value={formatDateDDMMYYYY(m.purchaseDate)}
                        icon={Calendar}
                      />
                      <DetailItem
                        label="Purchase value"
                        value={formatINR(m.purchaseCost)}
                        icon={DollarSign}
                      />
                    </div>
                  </div>

                  {/* Card actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-muted px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => setServiceModalMachine(m)}
                        className="btn btn-ghost btn-sm"
                      >
                        <Wrench className="h-3.5 w-3.5 text-warning-600" />
                        Log Service
                      </button>
                      <button
                        onClick={() =>
                          handleOpenRenewModal(
                            m,
                            insuranceAlert
                              ? "insurance"
                              : pucAlert
                                ? "puc"
                                : fitnessAlert
                                  ? "fitness"
                                  : "insurance",
                          )
                        }
                        className="btn btn-ghost btn-sm"
                      >
                        <ShieldCheck className="h-3.5 w-3.5 text-brand-600" />
                        Renew
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => handleOpenEdit(m)}
                        className="btn btn-secondary btn-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setSelectedMachine(m)}
                        className="btn btn-secondary btn-sm"
                      >
                        Profile
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <Search className="h-7 w-7 text-ink-400" />
            <span className="text-sm font-semibold text-ink-700">
              No assets match your filters
            </span>
            <span className="text-xs text-ink-500">
              Try a different crane type or search term.
            </span>
          </div>
        )}
      </div>

      {/* Record Service Modal */}
      {serviceModalMachine && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <div className="min-w-0">
                <span className="stat-label block">
                  Asset {serviceModalMachine.assetId}
                </span>
                <h3 className="modal-title mt-0.5">Record completed service</h3>
              </div>
              <button
                onClick={() => setServiceModalMachine(null)}
                className="icon-btn"
                aria-label="Close service dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRecordServiceSubmit}>
              <div className="modal-body space-y-4">
                <div className="rounded-lg border border-line bg-surface-muted p-3.5">
                  <div className="text-sm font-bold text-ink-900">
                    {serviceModalMachine.assetId} – {serviceModalMachine.make}{" "}
                    {serviceModalMachine.model}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">
                    Service interval: Every{" "}
                    {formatServiceInterval(
                      serviceModalMachine.serviceFrequencyValue,
                      serviceModalMachine.serviceFrequencyUnit ?? "days",
                    )}
                    {serviceModalMachine.serviceFrequencyUnit === "hours" && (
                      <>
                        {" · "}
                        {Math.round(
                          sumOperatingHours(
                            machineWorkingLogs,
                            serviceModalMachine.id,
                            serviceModalMachine.lastServiceDate,
                          ),
                        )}{" "}
                        h logged so far
                      </>
                    )}
                  </p>
                </div>

                <div>
                  <label className="form-label">
                    Service workshop / agency
                  </label>
                  <input
                    type="text"
                    required
                    value={completedServiceProvider}
                    onChange={(e) =>
                      setCompletedServiceProvider(e.target.value)
                    }
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">Invoice cost (₹)</label>
                  <input
                    type="number"
                    required
                    value={completedServiceCost}
                    onChange={(e) => setCompletedServiceCost(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">
                    Maintenance scope / work done
                  </label>
                  <textarea
                    rows={2}
                    value={completedServiceNotes}
                    onChange={(e) => setCompletedServiceNotes(e.target.value)}
                    className="form-input"
                  />
                </div>

                {serviceModalMachine.serviceFrequencyUnit === "hours" && (
                  <div>
                    <label className="form-label">
                      Operating hours reading at this service
                    </label>
                    <input
                      type="number"
                      value={completedServiceHours}
                      onChange={(e) => setCompletedServiceHours(e.target.value)}
                      placeholder={`${Math.round((serviceModalMachine.lastServiceHours || 0) + sumOperatingHours(machineWorkingLogs, serviceModalMachine.id, serviceModalMachine.lastServiceDate))} h`}
                      className="form-input"
                    />
                    <p className="mt-1 text-[11px] text-ink-500">
                      The next service will be due after another{" "}
                      {serviceModalMachine.serviceFrequencyValue} operating hours.
                    </p>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setServiceModalMachine(null)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  Save &amp; update next service date
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Machine Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-panel modal-panel-wide">
            <div className="modal-header">
              <div className="min-w-0">
                <span className="stat-label block">Fleet master</span>
                <h3 className="modal-title mt-0.5">
                  {editingMachine
                    ? `Edit asset: ${editingMachine.assetId}`
                    : "Register new heavy equipment asset"}
                </h3>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="icon-btn"
                aria-label="Close asset dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="modal-body space-y-5">
                {/* RC OCR upload */}
                <div className="flex flex-col gap-3 rounded-lg border border-dashed border-line-strong bg-surface-muted p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2.5">
                    <span className="section-icon"><ScanLine className="h-4 w-4" /></span>
                    <div className="text-xs">
                      <div className="font-semibold text-ink-800">
                        Fill from registration certificate (RC)
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-500">
                        {rcFiles.length
                          ? `${rcFiles.map((f) => f.name).join(", ")} will be saved with this asset.`
                          : "Upload the RC as a PDF or photos — registration no., chassis, engine, make, model and more are read automatically."}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRcScan(true)}
                    className="btn btn-secondary shrink-0"
                  >
                    {rcFiles.length ? <Paperclip className="h-4 w-4" /> : <ScanLine className="h-4 w-4" />}
                    {rcFiles.length || rcDetails.scannedAt ? "Rescan RC" : "Scan RC document"}
                  </button>
                </div>

                {/* Equipment identity */}
                <section className="space-y-4">
                  <ProfileSection title="Equipment identity" icon={Truck} />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className="form-label">Crane type</label>
                      <Select
                        value={machineType}
                        onValueChange={(v) => setMachineType(v as MachineType)}
                      >
                        <SelectTrigger className="form-input">
                          <SelectValue placeholder="Select crane type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Hydraulic Crane">
                            Hydraulic Crane
                          </SelectItem>
                          <SelectItem value="Mobile Crane">
                            Mobile Crane
                          </SelectItem>
                          <SelectItem value="Crawler Crane">
                            Crawler Crane
                          </SelectItem>
                          <SelectItem value="Hydra">Hydra</SelectItem>
                          <SelectItem value="Tower Crane">
                            Tower Crane
                          </SelectItem>
                          <SelectItem value="Rough Terrain Crane">
                            Rough Terrain Crane
                          </SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="form-label">Manufacturer / make</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Liebherr, Kato, ACE, Sany"
                        value={make}
                        onChange={(e) => setMake(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">Model name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. LTM 1100-4.2"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">RTO registration no.</label>
                      <input
                        type="text"
                        required
                        placeholder="MH-04-AZ-4512"
                        value={regNo}
                        onChange={(e) => setRegNo(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">Capacity (tonnes)</label>
                      <input
                        type="number"
                        required
                        value={tonnage}
                        onChange={(e) => setTonnage(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">Deployment status</label>
                      <Select
                        value={status}
                        onValueChange={(v) => setStatus(v as AssetStatus)}
                      >
                        <SelectTrigger className="form-input">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="assigned">
                            Assigned to Site
                          </SelectItem>
                          <SelectItem value="available">
                            Available in Depot
                          </SelectItem>
                          <SelectItem value="under_maintenance">
                            Under Maintenance
                          </SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="form-label">
                        Assigned project site
                      </label>
                      <Select
                        value={currentProject || "__none__"}
                        onValueChange={(v) =>
                          setCurrentProject(v === "__none__" ? "" : v)
                        }
                      >
                        <SelectTrigger className="form-input">
                          <SelectValue placeholder="Select project site" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">
                            None (In Depot Pool)
                          </SelectItem>
                          {projects.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} ({p.location})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </section>

                {/* Preventive servicing */}
                <section className="space-y-4">
                  <ProfileSection
                    title="Preventive servicing schedule"
                    icon={Wrench}
                  />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className="form-label">Last service date</label>
                      <DateInput value={lastServiceDate}
                        onChange={(e) => setLastServiceDate(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">Service interval</label>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          value={serviceFreqValue}
                          onChange={(e) =>
                            setServiceFreqValue(
                              parseInt(e.target.value, 10) ||
                                (serviceFreqUnit === "hours" ? 500 : 60),
                            )
                          }
                          className="form-input min-w-0 flex-1"
                        />
                        <Select
                          value={serviceFreqUnit}
                          onValueChange={(v) =>
                            setServiceFreqUnit(v as "days" | "months" | "hours")
                          }
                        >
                          <SelectTrigger className="form-input w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="months">Months</SelectItem>
                            <SelectItem value="days">Days</SelectItem>
                            <SelectItem value="hours">Hours</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="mt-1 text-[11px] text-ink-500">
                        Shown as {formatServiceInterval(serviceFreqValue, serviceFreqUnit)}
                      </p>
                    </div>
                    <div>
                      <label className="form-label">
                        {serviceFreqUnit === "hours"
                          ? "Last service hour reading"
                          : "Next service due"}
                      </label>
                      {serviceFreqUnit === "hours" ? (
                        <input
                          type="number"
                          value={lastServiceHours}
                          onChange={(e) =>
                            setLastServiceHours(parseFloat(e.target.value) || 0)
                          }
                          className="form-input"
                        />
                      ) : (
                        <DateInput value={nextServiceDueDate}
                          onChange={(e) => setNextServiceDueDate(e.target.value)}
                          className="form-input font-semibold"
                        />
                      )}
                    </div>
                    {serviceFreqUnit === "hours" && (
                      <div className="notice notice--warning flex flex-col justify-center">
                        <span className="stat-label text-warning-800">
                          Hours-based due
                        </span>
                        <span className="mt-1 text-xs font-semibold text-warning-900">
                          Due after {serviceFreqValue} operating hours
                        </span>
                        <span className="text-[11px] text-warning-700">
                          Tracked from crane working logs
                        </span>
                      </div>
                    )}
                  </div>
                </section>

                {/* Statutory compliance */}
                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="rounded-md bg-brand-50 p-1.5 text-brand-700">
                        <ShieldCheck className="h-4 w-4" />
                      </span>
                      <div>
                        <h4 className="text-sm font-bold tracking-tight text-ink-900">
                          Statutory compliance &amp; renewal intervals
                        </h4>
                        <p className="mt-0.5 text-xs text-ink-500">
                          Expiry dates are calculated automatically from the
                          renewal date and interval.
                        </p>
                      </div>
                    </div>
                    <span className="badge badge-success">
                      Auto-calculation active
                    </span>
                  </div>

                  {/* Insurance */}
                  <div className="rounded-lg border border-line bg-surface-muted p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-xs font-semibold text-ink-900">
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-brand-700" />
                        1. Machine insurance policy
                      </span>
                      <span className="text-[11px] text-ink-500">
                        Expiry = {formatDateDDMMYYYY(insuranceStartDate)} + {insuranceIntervalDays}{" "}
                        days
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label className="form-label">Insurance provider</label>
                        <input
                          type="text"
                          required
                          value={insuranceProvider}
                          onChange={(e) => setInsuranceProvider(e.target.value)}
                          className="form-input"
                        />
                      </div>
                      <div>
                        <label className="form-label">Policy number</label>
                        <input
                          type="text"
                          required
                          value={insurancePolicyNumber}
                          onChange={(e) =>
                            setInsurancePolicyNumber(e.target.value)
                          }
                          className="form-input"
                        />
                      </div>
                      <div>
                        <label className="form-label">Policy start date</label>
                        <DateInput required
                          value={insuranceStartDate}
                          onChange={(e) =>
                            handleInsuranceStartDateChange(e.target.value)
                          }
                          className="form-input"
                        />
                      </div>
                      <div>
                        <label className="form-label">Interval (days)</label>
                        <input
                          type="number"
                          required
                          value={insuranceIntervalDays}
                          onChange={(e) =>
                            handleInsuranceIntervalChange(
                              parseInt(e.target.value, 10) || 0,
                            )
                          }
                          className="form-input font-semibold"
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-medium text-ink-500">
                          Quick presets
                        </span>
                        {[
                          { label: "6M (180d)", days: 180 },
                          { label: "1Y (365d)", days: 365 },
                          { label: "2Y (730d)", days: 730 },
                        ].map((preset) => (
                          <button
                            key={preset.days}
                            type="button"
                            onClick={() =>
                              handleInsuranceIntervalChange(preset.days)
                            }
                            className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                              insuranceIntervalDays === preset.days
                                ? "border-logo-700 bg-logo-700 text-white"
                                : "border-line bg-surface text-ink-600 hover:bg-surface-muted"
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div className="w-full min-w-[200px] sm:w-auto">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label className="form-label !mb-0">
                            Calculated expiry date
                          </label>
                          <span className="badge badge-success">Auto</span>
                        </div>
                        <DateInput required
                          value={insuranceExpiry}
                          onChange={(e) => setInsuranceExpiry(e.target.value)}
                          className="form-input font-semibold"
                        />
                      </div>
                    </div>
                    <AgeingBar issue={insuranceStartDate} expiry={insuranceExpiry} className="mt-3" />
                  </div>

                  {/* PUC */}
                  <div className="rounded-lg border border-line bg-surface-muted p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-xs font-semibold text-ink-900">
                        <FileCheck2 className="h-3.5 w-3.5 shrink-0 text-brand-700" />
                        2. Pollution Under Control (PUC)
                      </span>
                      <span className="text-[11px] text-ink-500">
                        Expiry = {formatDateDDMMYYYY(pucIssueDate)} + {pucIntervalDays} days
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="form-label">
                          PUC certificate no.
                        </label>
                        <input
                          type="text"
                          required
                          value={pucNumber}
                          onChange={(e) => setPucNumber(e.target.value)}
                          className="form-input"
                        />
                      </div>
                      <div>
                        <label className="form-label">Issue / test date</label>
                        <DateInput required
                          value={pucIssueDate}
                          onChange={(e) =>
                            handlePucIssueDateChange(e.target.value)
                          }
                          className="form-input"
                        />
                      </div>
                      <div>
                        <label className="form-label">Interval (days)</label>
                        <input
                          type="number"
                          required
                          value={pucIntervalDays}
                          onChange={(e) =>
                            handlePucIntervalChange(
                              parseInt(e.target.value, 10) || 0,
                            )
                          }
                          className="form-input font-semibold"
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-medium text-ink-500">
                          Quick presets
                        </span>
                        {[
                          { label: "3M (90d)", days: 90 },
                          { label: "6M (180d)", days: 180 },
                          { label: "1Y (365d)", days: 365 },
                        ].map((preset) => (
                          <button
                            key={preset.days}
                            type="button"
                            onClick={() => handlePucIntervalChange(preset.days)}
                            className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                              pucIntervalDays === preset.days
                                ? "border-logo-700 bg-logo-700 text-white"
                                : "border-line bg-surface text-ink-600 hover:bg-surface-muted"
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div className="w-full min-w-[200px] sm:w-auto">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label className="form-label !mb-0">
                            Calculated expiry date
                          </label>
                          <span className="badge badge-success">Auto</span>
                        </div>
                        <DateInput required
                          value={pucExpiry}
                          onChange={(e) => setPucExpiry(e.target.value)}
                          className="form-input font-semibold"
                        />
                      </div>
                    </div>
                    <AgeingBar issue={pucIssueDate} expiry={pucExpiry} className="mt-3" />
                  </div>

                  {/* Fitness */}
                  <div className="rounded-lg border border-line bg-surface-muted p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-xs font-semibold text-ink-900">
                        <FileBadge className="h-3.5 w-3.5 shrink-0 text-brand-700" />
                        3. RTO fitness certificate &amp; test passed
                      </span>
                      <span className="text-[11px] text-ink-500">
                        Due = {formatDateDDMMYYYY(lastFitnessDate)} + {fitnessIntervalDays} days
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="form-label">
                          Fitness certificate no.
                        </label>
                        <input
                          type="text"
                          required
                          value={fitnessCertNumber}
                          onChange={(e) => setFitnessCertNumber(e.target.value)}
                          className="form-input"
                        />
                      </div>
                      <div>
                        <label className="form-label">
                          Last test passed date
                        </label>
                        <DateInput required
                          value={lastFitnessDate}
                          onChange={(e) =>
                            handleFitnessDateChange(e.target.value)
                          }
                          className="form-input"
                        />
                      </div>
                      <div>
                        <label className="form-label">Interval (days)</label>
                        <input
                          type="number"
                          required
                          value={fitnessIntervalDays}
                          onChange={(e) =>
                            handleFitnessIntervalChange(
                              parseInt(e.target.value, 10) || 0,
                            )
                          }
                          className="form-input font-semibold"
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-medium text-ink-500">
                          Quick presets
                        </span>
                        {[
                          { label: "6M (180d)", days: 180 },
                          { label: "1Y (365d)", days: 365 },
                          { label: "2Y (730d)", days: 730 },
                        ].map((preset) => (
                          <button
                            key={preset.days}
                            type="button"
                            onClick={() =>
                              handleFitnessIntervalChange(preset.days)
                            }
                            className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                              fitnessIntervalDays === preset.days
                                ? "border-logo-700 bg-logo-700 text-white"
                                : "border-line bg-surface text-ink-600 hover:bg-surface-muted"
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div className="w-full min-w-[200px] sm:w-auto">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label className="form-label !mb-0">
                            Next fitness due date
                          </label>
                          <span className="badge badge-success">Auto</span>
                        </div>
                        <DateInput required
                          value={fitnessDueDate}
                          onChange={(e) => setFitnessDueDate(e.target.value)}
                          className="form-input font-semibold"
                        />
                      </div>
                    </div>
                    <AgeingBar issue={lastFitnessDate} expiry={fitnessDueDate} className="mt-3" />
                  </div>
                </section>

                {/* Registration certificate */}
                <section className="space-y-4">
                  <ProfileSection
                    title="Registration certificate (RC)"
                    icon={FileBadge}
                  />
                  <RcDetailsFields
                    value={rcDetails}
                    onChange={(patch) => setRcDetails((prev) => ({ ...prev, ...patch }))}
                  />
                </section>
              </div>

              {saveError && (
                <div className="alert-banner mx-4 mb-2" role="alert">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="text-xs">{saveError}</span>
                </div>
              )}
              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn btn-secondary"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving
                    ? "Saving…"
                    : editingMachine
                      ? "Save asset"
                      : "Add to fleet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showModal && showRcScan && (
        <RcScanModal
          onClose={() => setShowRcScan(false)}
          onApply={handleApplyRc}
        />
      )}

      {/* Machine Profile Modal */}
      {selectedMachine && (
        <div className="modal-overlay">
          <div className="modal-panel modal-panel-wide">
            <div className="modal-header">
              <div className="min-w-0">
                <span className="stat-label block">
                  {selectedMachine.assetId} · {selectedMachine.machineType}
                </span>
                <h3 className="modal-title mt-0.5 truncate">
                  {selectedMachine.make} {selectedMachine.model}
                </h3>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <AssetStatusBadge status={selectedMachine.status} />
                <button
                  onClick={() => setSelectedMachine(null)}
                  className="icon-btn"
                  aria-label="Close asset profile"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="modal-body space-y-5">
              {/* Identity banner */}
              <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-muted p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface text-brand-700 ring-1 ring-line">
                    <Truck className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ink-900">
                      {selectedMachine.make} {selectedMachine.model}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-500">
                      {selectedMachine.assetId} ·{" "}
                      {selectedMachine.tonnageCapacity} T capacity
                    </div>
                  </div>
                </div>
                <div className="sm:text-right">
                  <span className="stat-label block">Registration number</span>
                  <span className="mt-1 block text-xs font-semibold text-ink-800">
                    {selectedMachine.registrationNumber}
                  </span>
                </div>
              </div>

              {/* Equipment & ownership */}
              <section className="space-y-4">
                <ProfileSection
                  title="Equipment &amp; ownership details"
                  icon={IdCard}
                />
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
                  <DetailItem
                    label="Equipment type"
                    value={selectedMachine.machineType}
                    icon={Truck}
                  />
                  <DetailItem
                    label="Serial number"
                    value={selectedMachine.serialNumber}
                    icon={FileText}
                  />
                  <DetailItem
                    label="Capacity"
                    value={`${selectedMachine.tonnageCapacity} Tonnes`}
                    icon={Gauge}
                  />
                  <DetailItem
                    label="Deployed site"
                    value={
                      projects.find(
                        (p) => p.id === selectedMachine.currentProjectId,
                      )?.name || "Depot pool"
                    }
                    icon={MapPin}
                  />
                  <DetailItem
                    label="Purchase date"
                    value={formatDateDDMMYYYY(selectedMachine.purchaseDate)}
                    icon={Calendar}
                  />
                  <DetailItem
                    label="Purchase value"
                    value={formatINR(selectedMachine.purchaseCost)}
                    icon={DollarSign}
                  />
                  <DetailItem
                    label="Insurance provider"
                    value={selectedMachine.insuranceProvider}
                    icon={ShieldCheck}
                  />
                  <DetailItem
                    label="Policy number"
                    value={selectedMachine.insurancePolicyNumber}
                    icon={FileText}
                  />
                </div>
              </section>

              {/* Compliance & renewals */}
              <section className="space-y-4">
                <ProfileSection
                  title="Compliance &amp; renewal dates"
                  icon={ShieldCheck}
                />
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
                  <DetailItem
                    label="Service due"
                    value={
                      selectedMachine.serviceFrequencyUnit === "hours"
                        ? `After ${selectedMachine.serviceFrequencyValue} h · ${formatServiceInterval(selectedMachine.serviceFrequencyValue, "hours")}`
                        : formatDateDDMMYYYY(selectedMachine.nextServiceDueDate)
                    }
                    icon={Wrench}
                  />
                  <DetailItem
                    label="Insurance expiry"
                    value={formatDateDDMMYYYY(
                      selectedMachine.insuranceExpiryDate,
                    )}
                    icon={ShieldCheck}
                  />
                  <DetailItem
                    label="PUC expiry"
                    value={formatDateDDMMYYYY(selectedMachine.pucExpiryDate)}
                    icon={FileCheck2}
                  />
                  <DetailItem
                    label="Fitness due"
                    value={formatDateDDMMYYYY(
                      selectedMachine.nextFitnessDueDate,
                    )}
                    icon={FileBadge}
                  />
                </div>
              </section>

              {/* Registration certificate */}
              <section className="space-y-4">
                <ProfileSection
                  title="Registration certificate (RC)"
                  icon={FileBadge}
                />
                <RcDetailsSummary details={selectedMachine.rcDetails} />
              </section>

              {/* Documents */}
              <section className="space-y-3">
                <ProfileSection title="Documents" icon={Paperclip} />
                <MachineDocumentsList machineId={selectedMachine.id} />
              </section>

              {/* Service history */}
              <section className="space-y-3">
                <ProfileSection
                  title="Completed servicing history"
                  icon={Wrench}
                />
                {selectedMachine.serviceHistory &&
                selectedMachine.serviceHistory.length > 0 ? (
                  <div className="space-y-2">
                    {selectedMachine.serviceHistory.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-lg border border-line p-3.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-bold text-ink-900">
                            {s.serviceType}
                          </span>
                          <span className="text-xs font-bold text-success-700">
                            {formatINR(s.cost)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-ink-600">{s.notes}</p>
                        <p className="mt-1.5 text-[11px] text-ink-500">
                          Completed on {formatDateDDMMYYYY(s.serviceDate)} by{" "}
                          {s.serviceProvider}
                          {s.odometerOrHours != null &&
                            ` · ${s.odometerOrHours} h reading`}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state py-8">
                    <Wrench className="h-6 w-6 text-ink-400" />
                    <span className="text-xs">
                      No service history records attached yet.
                    </span>
                  </div>
                )}
              </section>
            </div>

            <div className="modal-footer">
              <button
                onClick={() => setSelectedMachine(null)}
                className="btn btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Compliance Renewal Modal */}
      {renewModalMachine && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="rounded-md bg-brand-50 p-1.5 text-brand-700">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <span className="stat-label block">Statutory compliance</span>
                  <h3 className="modal-title mt-0.5 truncate">
                    Renew · {renewModalMachine.assetId}
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setRenewModalMachine(null)}
                className="icon-btn"
                aria-label="Close renewal dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRenewSubmit}>
              <div className="modal-body space-y-4">
                <div className="tab-bar">
                  {(["insurance", "puc", "fitness"] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() =>
                        handleOpenRenewModal(renewModalMachine, cat)
                      }
                      className={`tab ${renewCategory === cat ? "tab-active" : ""}`}
                    >
                      {cat === "fitness" ? "Fitness test" : cat.toUpperCase()}
                    </button>
                  ))}
                </div>

                <div className="rounded-lg border border-line bg-surface-muted p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs font-semibold text-ink-900">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                      {renewCategory === "insurance" &&
                        "Machine insurance policy renewal"}
                      {renewCategory === "puc" && "PUC emission test renewal"}
                      {renewCategory === "fitness" &&
                        "RTO fitness test certification"}
                    </span>
                    <span className="badge badge-neutral">
                      {renewIntervalDays} day interval
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                    The new expiry date is calculated from the renewal / test
                    date ({formatDateDDMMYYYY(renewDate)}) plus the configured interval (
                    {renewIntervalDays} days).
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="form-label">
                      {renewCategory === "fitness"
                        ? "Test passed date"
                        : "Renewal date"}
                    </label>
                    <DateInput required
                      value={renewDate}
                      onChange={(e) => handleRenewDateChange(e.target.value)}
                      className="form-input font-semibold"
                    />
                  </div>
                  <div>
                    <label className="form-label">Interval days</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        required
                        value={renewIntervalDays}
                        onChange={(e) =>
                          handleRenewIntervalChange(
                            parseInt(e.target.value, 10) || 0,
                          )
                        }
                        className="form-input font-semibold"
                      />
                      <span className="shrink-0 text-xs font-medium text-ink-500">
                        Days
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[
                        { label: "6M (180d)", days: 180 },
                        { label: "1Y (365d)", days: 365 },
                        { label: "2Y (730d)", days: 730 },
                      ].map((preset) => (
                        <button
                          key={preset.days}
                          type="button"
                          onClick={() => handleRenewIntervalChange(preset.days)}
                          className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                            renewIntervalDays === preset.days
                              ? "border-logo-700 bg-logo-700 text-white"
                              : "border-line bg-surface text-ink-600 hover:bg-surface-muted"
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <label className="form-label !mb-0">
                      Auto-set new expiry / next due date
                    </label>
                    <span className="badge badge-success">
                      {formatDateDDMMYYYY(renewDate)} + {renewIntervalDays}d
                    </span>
                  </div>
                  <DateInput required
                    value={renewCalculatedExpiry}
                    onChange={(e) => setRenewCalculatedExpiry(e.target.value)}
                    className="form-input font-semibold"
                  />
                </div>

                <div>
                  <label className="form-label">
                    {renewCategory === "insurance" && "Renewed policy number"}
                    {renewCategory === "puc" && "New PUC certificate number"}
                    {renewCategory === "fitness" &&
                      "Passed fitness certificate number"}
                  </label>
                  <input
                    type="text"
                    required
                    value={renewDocNo}
                    onChange={(e) => setRenewDocNo(e.target.value)}
                    className="form-input"
                  />
                </div>

                {renewCategory === "insurance" && (
                  <div>
                    <label className="form-label">
                      Insurance provider / underwriter
                    </label>
                    <input
                      type="text"
                      required
                      value={renewProviderName}
                      onChange={(e) => setRenewProviderName(e.target.value)}
                      className="form-input"
                    />
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setRenewModalMachine(null)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  Renew &amp; auto-set expiry date
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
