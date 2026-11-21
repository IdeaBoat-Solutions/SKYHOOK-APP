import React, { useMemo, useState } from 'react';
import {
  Search,
  UsersRound,
  Phone,
  Mail,
  IdCard,
  MapPin,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  X,
  HardHat,
  Truck,
  CalendarDays,
  Wallet,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { Employee } from '../../types';
import { formatDateDDMMYYYY, formatINR } from '../../utils/calculations';
import { Currency } from '../common/Currency';
import { formatPerDay } from '../../lib/wage';

type StatusFilter = 'all' | 'active' | 'inactive';

/** Read-only, searchable contact + compliance directory for crane operators. */
export const OperatorDirectoryView: React.FC = () => {
  const { employees, projects, machines, getLicenseAlerts, currentDate } = useSkyhook();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Employee | null>(null);

  const operators = useMemo(
    () => employees.filter((e) => e.employeeType === 'operator'),
    [employees],
  );
  const licenseAlerts = getLicenseAlerts();
  const alertedIds = new Set(licenseAlerts.map((a) => a.targetId));

  const activeCount = operators.filter((o) => o.status === 'active').length;
  const deployedCount = operators.filter((o) => o.currentProjectId).length;
  const alertCount = operators.filter((o) => alertedIds.has(o.id)).length;

  const filtered = operators.filter((op) => {
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' ? op.status === 'active' : op.status !== 'active');
    const term = search.trim().toLowerCase();
    const matchesSearch =
      !term ||
      op.fullName.toLowerCase().includes(term) ||
      op.employeeId.toLowerCase().includes(term) ||
      op.mobile.includes(term) ||
      op.licenseNumber?.toLowerCase().includes(term) ||
      op.designation.toLowerCase().includes(term);
    return matchesStatus && matchesSearch;
  });

  const projectName = (id?: string) => projects.find((p) => p.id === id)?.name;
  const machineName = (id?: string) => {
    const m = machines.find((machine) => machine.id === id);
    return m ? `${m.assetId} · ${m.make} ${m.model}` : undefined;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="min-w-0">
          <h2 className="page-title">Operator Directory</h2>
          <p className="page-subtitle">
            Searchable contact book for every crane operator — licences, deployment and pay at a glance.
          </p>
        </div>
        <span className="badge badge-neutral self-start">
          <UsersRound className="h-3.5 w-3.5" />
          {operators.length} operators on roll
        </span>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Total operators</span>
          <div className="stat-value">{operators.length}</div>
          <span className="stat-hint">Registered crane operators</span>
        </div>
        <div className="notice notice--success max-sm:flex-col max-sm:items-start max-sm:gap-0">
          <span className="stat-label text-success-800">Currently active</span>
          <div className="stat-value text-success-900">{activeCount}</div>
          <span className="stat-hint text-success-700">Available for deployment</span>
        </div>
        <div className="notice notice--warning max-sm:flex-col max-sm:items-start max-sm:gap-0">
          <span className="stat-label text-warning-800">Deployed on site</span>
          <div className="stat-value text-warning-900">{deployedCount}</div>
          <span className="stat-hint text-warning-700">Assigned to a project</span>
        </div>
        <div className={`${alertCount ? "notice notice--danger max-sm:flex-col max-sm:items-start max-sm:gap-0" : "stat-card"}`}>
          <span className="stat-label">Licence alerts</span>
          <div className="stat-value">{alertCount}</div>
          <span className="stat-hint">Expiring or already overdue</span>
        </div>
      </div>

      <div className="table-card">
        <div className="card-header filter-bar--split">
          <div className="tab-bar">
            {(
              [
                ['all', `All (${operators.length})`],
                ['active', `Active (${activeCount})`],
                ['inactive', `Inactive (${operators.length - activeCount})`],
              ] as Array<[StatusFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`tab ${statusFilter === key ? 'tab-active' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="search-box w-full sm:w-72">
            <Search className="w-4 h-4 text-ink-400" />
            <input
              type="text"
              placeholder="Search name, code, mobile, licence…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input pl-9"
              aria-label="Search operators"
            />
          </div>
        </div>

        {/* Phones: one card per operator */}
        <div className="divide-y divide-line md:hidden">
          {filtered.map((op) => {
            const hasAlert = alertedIds.has(op.id);
            return (
              <div key={op.id} className="space-y-3 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-logo-700 text-sm font-bold text-white">
                      {op.fullName.charAt(0)}
                    </span>
                    <div className="min-w-0">
                      <div className="break-words text-sm font-bold text-ink-900">{op.fullName}</div>
                      <div className="text-[11px] text-ink-500">{op.employeeId} · {op.designation}</div>
                    </div>
                  </div>
                  <span className={`badge shrink-0 ${op.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>
                    {op.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="min-w-0">
                    <span className="stat-label block">Licence</span>
                    <span className="block break-all font-semibold text-ink-800">{op.licenseNumber || '—'}</span>
                    <span className={`flex items-center gap-1 text-[11px] ${hasAlert ? 'text-danger-700' : 'text-ink-500'}`}>
                      {hasAlert ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3 text-success-600" />}
                      {op.craneLicenseExpiry ? `Exp. ${formatDateDDMMYYYY(op.craneLicenseExpiry)}` : 'Expiry not recorded'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="stat-label block">{op.salaryType === 'daily' ? 'Daily wage' : 'Monthly salary'}</span>
                    <Currency value={op.salaryType === 'daily' ? op.dailyRate : op.monthlySalary} size="xs" className="font-semibold text-ink-900" />
                    {op.salaryType === 'monthly' && op.monthlySalary > 0 && (
                      <span className="block text-[10px] text-ink-500">{formatPerDay(op.monthlySalary, currentDate)}</span>
                    )}
                  </div>
                  <div className="col-span-2 min-w-0">
                    <span className="stat-label block">Deployment</span>
                    <span className="font-semibold text-ink-800">{projectName(op.currentProjectId) || 'Depot pool'}</span>
                    <span className="text-ink-500"> · {machineName(op.currentMachineId) || 'No machine assigned'}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <a href={`tel:${op.mobile.replace(/\s/g, '')}`} className="btn btn-primary flex-1">
                    <Phone className="h-4 w-4" /> Call
                  </a>
                  <button onClick={() => setSelected(op)} className="btn btn-secondary flex-1">
                    Profile <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="table-wrap hidden md:block">
          <table className="data-table">
            <thead>
              <tr>
                <th className="px-3.5 py-3">Code</th>
                <th className="px-3.5 py-3">Operator</th>
                <th className="px-3.5 py-3">Contact</th>
                <th className="px-3.5 py-3">Licence</th>
                <th className="px-3.5 py-3">Current deployment</th>
                <th className="px-3.5 py-3">Wage</th>
                <th className="px-3.5 py-3 text-center">Status</th>
                <th className="px-3.5 py-3 text-right">Profile</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-700">
              {filtered.map((op) => {
                const hasAlert = alertedIds.has(op.id);
                return (
                  <tr key={op.id} className="transition-colors">
                    <td className="px-3.5 py-3">
                      <span className="chip">{op.employeeId}</span>
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-logo-700 text-[11px] font-bold text-white">
                          {op.fullName.charAt(0)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-ink-900">{op.fullName}</div>
                          <div className="truncate text-[11px] text-ink-500">{op.designation}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3.5 py-3 text-xs">
                      <a href={`tel:${op.mobile}`} className="flex items-center gap-1.5 text-ink-700 hover:text-brand-700">
                        <Phone className="h-3 w-3 text-ink-400" />
                        {op.mobile}
                      </a>
                      {op.email && (
                        <a href={`mailto:${op.email}`} className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-500 hover:text-brand-700">
                          <Mail className="h-3 w-3 text-ink-400" />
                          <span className="truncate">{op.email}</span>
                        </a>
                      )}
                    </td>
                    <td className="px-3.5 py-3 text-xs">
                      <span className="font-semibold text-ink-800">{op.licenseNumber || '—'}</span>
                      <span className={`mt-0.5 flex items-center gap-1 text-[11px] ${hasAlert ? 'text-danger-700' : 'text-ink-500'}`}>
                        {hasAlert ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3 text-success-600" />}
                        {op.craneLicenseExpiry ? `Exp. ${formatDateDDMMYYYY(op.craneLicenseExpiry)}` : 'Expiry not recorded'}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-xs">
                      <div className="font-semibold text-ink-800">{projectName(op.currentProjectId) || 'Depot pool'}</div>
                      <div className="text-[11px] text-ink-500">{machineName(op.currentMachineId) || 'No machine assigned'}</div>
                    </td>
                    <td className="px-3.5 py-3">
                      <Currency value={op.salaryType === 'daily' ? op.dailyRate : op.monthlySalary} size="xs" />
                      <span className="text-[10px] text-ink-400 block">
                        {op.salaryType === 'daily' ? 'per day' : op.monthlySalary > 0 ? `per month · ${formatPerDay(op.monthlySalary, currentDate)}` : 'per month'}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-center">
                      <span className={`badge ${op.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>
                        {op.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <button onClick={() => setSelected(op)} className="btn btn-secondary btn-sm">
                        Profile
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
            <div className="empty-state">
              <Search className="h-7 w-7 text-ink-400" />
              <span className="text-sm font-semibold text-ink-700">No operators found</span>
              <span className="text-xs text-ink-500">Try a different search or status filter.</span>
            </div>
          )}
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-panel modal-panel-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-logo-700 text-sm font-bold text-white">
                  {selected.fullName.charAt(0)}
                </span>
                <div className="min-w-0">
                  <span className="stat-label block">Operator {selected.employeeId}</span>
                  <h3 className="modal-title mt-0.5 truncate">{selected.fullName}</h3>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="icon-btn" aria-label="Close profile">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="modal-body space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Designation', selected.designation, HardHat],
                  ['Date of birth', selected.dateOfBirth ? formatDateDDMMYYYY(selected.dateOfBirth) : 'Not recorded', CalendarDays],
                  ['Joined on', selected.joiningDate ? formatDateDDMMYYYY(selected.joiningDate) : 'Not recorded', CalendarDays],
                  ['Wage', `${formatINR(selected.salaryType === 'daily' ? selected.dailyRate : selected.monthlySalary)}/${selected.salaryType === 'daily' ? 'day' : 'mo'}`, Wallet],
                ].map(([label, value, Icon]) => {
                  const IconComponent = Icon as React.ElementType;
                  return (
                    <div key={label as string} className="rounded-lg border border-line bg-surface-muted p-3">
                      <span className="stat-label flex items-center gap-1.5">
                        <IconComponent className="h-3 w-3" />
                        {label as string}
                      </span>
                      <span className="mt-1 block break-words text-xs font-bold text-ink-900">{value as string}</span>
                    </div>
                  );
                })}
              </div>

              {selected.salaryType === 'monthly' && selected.monthlySalary > 0 && (
                <p className="-mt-2 text-[11px] font-medium text-ink-600">Wage: {formatPerDay(selected.monthlySalary, currentDate)}</p>
              )}

              <section className="space-y-2">
                <h4 className="section-heading">Licence &amp; compliance</h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-line p-3">
                    <span className="stat-label flex items-center gap-1.5"><IdCard className="h-3 w-3" /> Crane licence</span>
                    <p className="mt-1 text-xs font-bold text-ink-900">{selected.licenseNumber || 'Not on file'}</p>
                    <p className="text-[11px] text-ink-500">Expiry: {selected.craneLicenseExpiry ? formatDateDDMMYYYY(selected.craneLicenseExpiry) : 'Not recorded'}</p>
                  </div>
                  <div className="rounded-lg border border-line p-3">
                    <span className="stat-label flex items-center gap-1.5"><ShieldCheck className="h-3 w-3" /> Transport licence</span>
                    <p className="mt-1 text-[11px] text-ink-500">Expiry: {selected.transportLicenseExpiry ? formatDateDDMMYYYY(selected.transportLicenseExpiry) : 'Not recorded'}</p>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <h4 className="section-heading">Current deployment</h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-2 rounded-lg border border-line p-3 text-xs">
                    <MapPin className="h-4 w-4 shrink-0 text-brand-700" />
                    <span className="font-semibold text-ink-800">{projectName(selected.currentProjectId) || 'Depot pool'}</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-line p-3 text-xs">
                    <Truck className="h-4 w-4 shrink-0 text-brand-700" />
                    <span className="font-semibold text-ink-800">{machineName(selected.currentMachineId) || 'No machine assigned'}</span>
                  </div>
                </div>
              </section>

              {selected.emergencyContacts?.length ? (
                <section className="space-y-2">
                  <h4 className="section-heading">Emergency contact</h4>
                  <div className="rounded-lg border border-line p-3 text-xs text-ink-700">
                    <span className="font-bold text-ink-900">{selected.emergencyContacts[0].name}</span>
                    <span className="text-ink-500"> · {selected.emergencyContacts[0].relation}</span>
                    <a href={`tel:${selected.emergencyContacts[0].mobile}`} className="ml-2 text-brand-700 hover:underline">
                      {selected.emergencyContacts[0].mobile}
                    </a>
                  </div>
                </section>
              ) : null}
            </div>

            <div className="modal-footer flex flex-wrap gap-2">
              <a href={`tel:${selected.mobile.replace(/\s/g, '')}`} className="btn btn-primary">
                <Phone className="h-4 w-4" />
                Call operator
              </a>
              {selected.email && (
                <a href={`mailto:${selected.email}`} className="btn btn-secondary">
                  <Mail className="h-4 w-4" />
                  Email
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
