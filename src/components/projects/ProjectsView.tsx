import React, { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  X,
  FolderKanban,
  Plus,
  Search,
  Users,
  Truck,
  Clock,
  ReceiptIndianRupee,
  FileSpreadsheet,
  CheckCircle2,
  Calendar,
  MapPin,
  ExternalLink,
  ChevronRight,
  ArrowRight,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { formatINR, formatDateDDMMYYYY } from '../../utils/calculations';
import { Project, ProjectStatus } from '../../types';

import { DateInput } from '../common/DateInput';
export const ProjectsView: React.FC = () => {
  const {
    currentUser,
    currentDate,
    projects,
    machines,
    employees,
    attendance,
    expenses,
    machineWorkingLogs,
    addProject,
    updateProject,
  } = useSkyhook();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  // Add/Edit Project Modal
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [location, setLocation] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const oneYearAfter = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  const [startDate, setStartDate] = useState(currentDate);
  const [expectedEndDate, setExpectedEndDate] = useState(oneYearAfter(currentDate));
  const [overtimeRate, setOvertimeRate] = useState('');
  const [contractValue, setContractValue] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('active');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleOpenAdd = () => {
    setFormError('');
    setEditingProject(null);
    setName('');
    setClientName('');
    setClientPhone('');
    setLocation('');
    setSiteAddress('');
    setStartDate(currentDate);
    setExpectedEndDate(oneYearAfter(currentDate));
    setOvertimeRate('');
    setContractValue('');
    setStatus('active');
    setDescription('');
    setShowModal(true);
  };

  const handleOpenEdit = (p: Project) => {
    setFormError('');
    setEditingProject(p);
    setName(p.name);
    setClientName(p.clientName);
    setClientPhone(p.clientPhone);
    setLocation(p.location);
    setSiteAddress(p.siteAddress);
    setStartDate(p.startDate);
    setExpectedEndDate(p.expectedEndDate);
    setOvertimeRate(String(p.overtimeRate));
    setContractValue(String(p.contractValue || 0));
    setStatus(p.status);
    setDescription(p.description || '');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (startDate && expectedEndDate && expectedEndDate < startDate) {
      setFormError('Expected end date cannot be before the start date.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (editingProject) {
        await updateProject(editingProject.id, {
          name,
          clientName,
          clientPhone,
          location,
          siteAddress,
          startDate,
          expectedEndDate,
          overtimeRate: parseFloat(overtimeRate) || 0,
          contractValue: parseFloat(contractValue) || 0,
          status,
          description,
        });
      } else {
        await addProject({
          // The server assigns the real project code; this display-only field is ignored.
          projectId: '',
          name,
          clientName,
          clientPhone,
          location,
          siteAddress,
          city: '',
          state: '',
          startDate,
          expectedEndDate,
          managerId: currentUser.id,
          overtimeRate: parseFloat(overtimeRate) || 0,
          contractValue: parseFloat(contractValue) || 0,
          status,
          description,
        });
      }
      setShowModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the project. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const filteredProjects = projects.filter((p) => {
    const matchStatus = filterStatus === 'all' || p.status === filterStatus;
    const matchSearch =
      !searchTerm ||
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.location.toLowerCase().includes(searchTerm.toLowerCase());
    return matchStatus && matchSearch;
  });

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">
            Project Master &amp; Site Assignments
          </h2>
          <p className="page-subtitle mt-0.5">
            Configure client contracts, site overtime hourly rates (e.g. Project A ₹150 vs Project B ₹200), and crane deployments.
          </p>
        </div>

        <button onClick={handleOpenAdd} className="btn btn-primary shrink-0">
          <Plus className="h-4 w-4" />
          <span>Create Project</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="filter-bar filter-bar--split">
        <div className="flex items-center gap-2 text-xs max-sm:[&>*]:w-full">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="form-input w-full font-medium sm:w-auto">
              <SelectValue placeholder="All Project Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Project Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="on_hold">On Hold</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="search-box">
          <Search className="h-4 w-4" />
          <input
            type="text"
            placeholder="Search project name, client, site..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-input pl-9"
          />
        </div>
      </div>

      {/* Projects Grid Cards */}
      <div className="stat-grid">
        {filteredProjects.map((p) => {
          const assignedCranes = machines.filter((m) => m.currentProjectId === p.id);
          const prjExpenses = expenses
            .filter((e) => e.projectId === p.id)
            .reduce((s, e) => s + e.amount, 0);
          const prjMachineHours = machineWorkingLogs
            .filter((m) => m.projectId === p.id)
            .reduce((s, m) => s + m.workingHours, 0);

          return (
            <div key={p.id} className="card flex flex-col justify-between overflow-hidden transition-colors hover:border-line-strong">
              <div className="card-pad space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="stat-label block">{p.projectId}</span>
                    <h3 className="mt-0.5 text-base font-semibold leading-tight text-ink-900">
                      {p.name}
                    </h3>
                    <p className="text-xs text-ink-500">{p.clientName}</p>
                  </div>
                  <span
                    className={`shrink-0 ${
                      p.status === 'active'
                        ? 'badge badge-success'
                        : p.status === 'upcoming'
                        ? 'badge badge-brand'
                        : 'badge badge-neutral'
                    } uppercase`}
                  >
                    {p.status}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-ink-600">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                  <span className="truncate">{p.location}</span>
                </div>

                {/* Overtime Rate Highlight */}
                <div className="notice notice--success justify-between">
                  <div>
                    <span className="block font-semibold text-success-800">Site Overtime Rate</span>
                    <span className="text-[10px] text-success-700">Applied to operator OT hours</span>
                  </div>
                  <div className="text-lg font-semibold text-success-800">
                    ₹{p.overtimeRate} <span className="text-xs font-normal">/ hr</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                  <div className="rounded-lg border border-line bg-surface-muted p-2">
                    <span className="stat-label block !text-[10px]">Cranes Deployed</span>
                    <strong className="text-ink-800">
                      {assignedCranes.length > 0
                        ? assignedCranes.map((c) => c.assetId).join(', ')
                        : 'Pool'}
                    </strong>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-muted p-2">
                    <span className="stat-label block !text-[10px]">Crane Operating</span>
                    <strong className="text-ink-800">{prjMachineHours} hrs</strong>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-muted p-2">
                    <span className="stat-label block !text-[10px]">Site Expenses</span>
                    <strong className="text-ink-800">{formatINR(prjExpenses)}</strong>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-muted p-2">
                    <span className="stat-label block !text-[10px]">Contract Value</span>
                    <strong className="text-ink-800">{formatINR(p.contractValue || 0)}</strong>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-muted px-4 py-3 sm:px-5">
                <span className="text-[11px] text-ink-500">
                  {formatDateDDMMYYYY(p.startDate)}{' '}
                  <ArrowRight
                    size={12}
                    className="inline-block align-middle text-ink-400"
                    aria-hidden="true"
                  />{' '}
                  {formatDateDDMMYYYY(p.expectedEndDate)}
                </span>
                <div className="flex items-center gap-1 max-sm:w-full max-sm:[&>button]:flex-1">
                  <button onClick={() => handleOpenEdit(p)} className="btn btn-ghost btn-sm">
                    Edit / Rates
                  </button>
                  <button onClick={() => setSelectedProject(p)} className="btn btn-ghost btn-sm">
                    Details <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Project Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <h3 className="font-bold text-sm">
                {editingProject ? 'Edit Project & Overtime Rate' : 'Create New Heavy Lift Project'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="icon-btn"
                aria-label="Close"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col text-xs">
             <div className="modal-body space-y-4">
              {formError && (
                <div className="notice notice--danger text-xs" role="alert">{formError}</div>
              )}
              <div>
                <label className="form-label">Project Name:</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Metro Rail Line 4 Viaduct Erection"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-grid">
                <div>
                  <label className="form-label">Client Name:</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. L&T Heavy Civil / MMRDA"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">Client Contact:</label>
                  <input
                    type="text"
                    required
                    placeholder="+91 22 2405 8900"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div className="form-grid">
                <div>
                  <label className="form-label">Location / Site:</label>
                  <input
                    type="text"
                    required
                    placeholder="Ghatkopar East Junction"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">Status:</label>
                  <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                    <SelectTrigger className="form-input">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="upcoming">Upcoming</SelectItem>
                      <SelectItem value="on_hold">On Hold</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* OVERTIME HOURLY RATE CONFIGURATION */}
              <div className="notice notice--success flex-col items-stretch !gap-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-xs font-semibold text-success-800">
                    Project-Specific Overtime Rate (₹ / hour):
                  </label>
                  <span className="text-[10px] font-bold text-success-700">CRITICAL FOR PAYROLL</span>
                </div>
                <input
                  type="number"
                  required
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="e.g. 150 or 200"
                  value={overtimeRate}
                  onChange={(e) => setOvertimeRate(e.target.value)}
                  className="form-input font-semibold text-success-800"
                />
                <p className="text-[10px] text-success-700">
                  Operators working on this site receive this exact hourly rate for approved hours over 10h.
                </p>
              </div>

              <div className="form-grid">
                <div>
                  <label className="form-label">Start Date:</label>
                  <DateInput required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Expected End Date:</label>
                  <DateInput required
                    value={expectedEndDate}
                    onChange={(e) => setExpectedEndDate(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div>
                <label className="form-label">Contract Value (₹):</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={contractValue}
                  onChange={(e) => setContractValue(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">Site Address (optional):</label>
                <input
                  type="text"
                  value={siteAddress}
                  onChange={(e) => setSiteAddress(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">Description (optional):</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="form-input"
                />
              </div>
             </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : editingProject ? 'Save Changes' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Project Details Modal */}
      {selectedProject && (
        <div className="modal-overlay">
          <div className="modal-panel modal-panel-wide text-xs">
            <div className="modal-header">
              <div className="min-w-0">
                <span className="stat-label block">{selectedProject.projectId}</span>
                <h3 className="truncate text-base font-semibold text-ink-900">{selectedProject.name}</h3>
              </div>
              <button
                onClick={() => setSelectedProject(null)}
                className="icon-btn"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="modal-body space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <span className="stat-label block">Client</span>
                  <strong className="mt-1 block text-sm text-ink-900">{selectedProject.clientName}</strong>
                  <p className="text-ink-500">{selectedProject.clientPhone}</p>
                </div>
                <div>
                  <span className="stat-label block">Location</span>
                  <strong className="mt-1 block text-ink-900">{selectedProject.location}</strong>
                  <p className="text-ink-500">{selectedProject.siteAddress}</p>
                </div>
              </div>

              <div className="notice notice--success justify-between">
                <div>
                  <span className="block font-semibold text-success-800">Site Overtime Rate</span>
                  <span className="text-success-700">Fixed rate applied to all operator overtime on this job site</span>
                </div>
                <div className="text-xl font-semibold text-success-800">
                  ₹{selectedProject.overtimeRate} / hr
                </div>
              </div>

              <div>
                <span className="stat-label mb-1 block">Project Description</span>
                <p className="rounded-lg border border-line bg-surface-muted p-3 text-ink-700">
                  {selectedProject.description || 'No specific operational description entered.'}
                </p>
              </div>

              <div>
                <span className="mb-2 block text-sm font-semibold text-ink-900">Assigned Crane Fleet</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {machines
                    .filter((m) => m.currentProjectId === selectedProject.id)
                    .map((m) => (
                      <div key={m.id} className="flex items-center gap-2 rounded-lg border border-line p-2.5">
                        <Truck className="h-4 w-4 shrink-0 text-warning-500" />
                        <div className="min-w-0">
                          <strong className="text-ink-900">{m.assetId}</strong>
                          <span className="block truncate text-[11px] text-ink-500">{m.make} {m.model} ({m.tonnageCapacity}T)</span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setSelectedProject(null)} className="btn btn-primary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
