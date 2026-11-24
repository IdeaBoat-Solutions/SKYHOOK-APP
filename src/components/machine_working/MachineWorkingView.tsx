import React, { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  X,
  Cpu,
  FileSpreadsheet,
  UploadCloud,
  Download,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Activity,
  Layers,
  FileText,
  ArrowRight,
  Sun,
  Moon,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import {
  formatINR,
  formatDateDDMMYYYY,
  calculateWorkingAndOt,
} from '../../utils/calculations';
import {
  downloadMachineWorkingTemplate,
  parseMachineWorkingExcel,
  exportMachineWorkingLogs,
  ParsedImportRow,
} from '../../utils/excelAndPdf';
import { MachineWorkingLog } from '../../types';
import { ShiftToggle, shiftTimes, type Shift } from '../common/ShiftToggle';

import { DateInput } from '../common/DateInput';
import { PeriodFilter, inPeriod, defaultPeriod, type PeriodState } from '../common/PeriodFilter';
export const MachineWorkingView: React.FC = () => {
  const {
    currentUser,
    currentDate,
    companySettings,
    machineWorkingLogs,
    machines,
    projects,
    employees,
    addMachineWorkingLog,
    importMachineWorkingLogs,
  } = useSkyhook();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterMachine, setFilterMachine] = useState('all');
  const [filterProject, setFilterProject] = useState('all');
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod('month'));

  // Manual Log Entry Modal
  const shiftHours = companySettings.standardShiftHours || 10;
  const activeOperators = employees.filter((e) => e.employeeType === 'operator' && e.status === 'active');
  const [showAddModal, setShowAddModal] = useState(false);
  const [date, setDate] = useState(currentDate);
  const [machineId, setMachineId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [shift, setShift] = useState<Shift>('custom');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const shiftTimesFor = (kind: Exclude<Shift, 'custom'>) => shiftTimes(kind, shiftHours);

  const pickShift = (kind: Shift) => {
    setShift(kind);
    if (kind !== 'custom') {
      const t = shiftTimesFor(kind);
      setStartTime(t.start);
      setEndTime(t.end);
    }
  };

  /** Choosing an operator pre-fills their usual machine and project. */
  const pickOperator = (id: string) => {
    setOperatorId(id);
    const op = employees.find((e) => e.id === id);
    if (op?.currentMachineId) setMachineId(op.currentMachineId);
    if (op?.currentProjectId) setProjectId(op.currentProjectId);
  };

  /** Choosing a machine pre-fills the project it is deployed on. */
  const pickMachine = (id: string) => {
    setMachineId(id);
    const m = machines.find((x) => x.id === id);
    if (m?.currentProjectId) setProjectId(m.currentProjectId);
  };

  /** Current time of this device as HH:mm (24-hour). */
  const nowHHMM = () => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  };

  const openAddModal = () => {
    setDate(currentDate);
    // Nothing is chosen for the user: the machine, project and times are entered (or picked) here.
    setMachineId('');
    setProjectId('');
    setOperatorId('');
    setShift('custom');
    setStartTime('');
    setEndTime('');
    setRemarks('');
    setFormError('');
    setShowAddModal(true);
  };

  // Excel Import Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedImportRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<ParsedImportRow[]>([]);
  const [importSuccessCount, setImportSuccessCount] = useState<number | null>(null);
  const [importError, setImportError] = useState('');

  const durationPreview = startTime && endTime ? calculateWorkingAndOt(startTime, endTime, 0, 1440) : null;

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!machineId || !projectId) {
      setFormError('Choose a machine and a project.');
      return;
    }
    if (!startTime || !endTime) {
      setFormError('Enter the start and end time (or pick Day / Night, or tap Now).');
      return;
    }
    if (startTime === endTime) {
      setFormError('Start and end time are the same.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await addMachineWorkingLog({
        date,
        machineId,
        projectId,
        operatorId: operatorId || undefined,
        startTime,
        endTime,
        remarks,
      });
      setShowAddModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the log.');
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportSuccessCount(null);
    try {
      setImportError('');
      const result = await parseMachineWorkingExcel(file, machines, projects, employees, machineWorkingLogs);
      setParsedRows(result.validRows);
      setInvalidRows(result.invalidRows);
      if (result.totalRows === 0) setImportError('The sheet has no rows. Use the template: one row per working session.');
    } catch (err) {
      setParsedRows([]);
      setInvalidRows([]);
      setImportError('Could not read that file as an Excel sheet: ' + (err as Error).message);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (parsedRows.length === 0) return;
    setImportError('');
    // The sheet uses readable codes (CR-001, PRJ-001, OP-001 or an operator's name); the API needs ids.
    const formatted: Omit<MachineWorkingLog, 'id'>[] = parsedRows.map((r) => {
      const { netWorkingMinutes, netWorkingHours } = calculateWorkingAndOt(r.startTime, r.endTime, 0, 1440);
      return {
        date: r.date,
        machineId: r.resolved?.machineId ?? r.machineId,
        projectId: r.resolved?.projectId ?? r.projectId,
        operatorId: r.resolved?.operatorId ?? '',
        startTime: r.startTime,
        endTime: r.endTime,
        idleMinutes: 0,
        workingMinutes: netWorkingMinutes,
        workingHours: netWorkingHours,
        remarks: r.remarks,
        enteredBy: currentUser.name,
        approvalStatus: 'approved',
      };
    });

    try {
      const count = await importMachineWorkingLogs(formatted);
      setImportSuccessCount(count);
      setParsedRows([]);
      setInvalidRows([]);
      setTimeout(() => {
        setShowImportModal(false);
        setImportSuccessCount(null);
      }, 1500);
    } catch (err) {
      setParsedRows([]);
      setImportError(err instanceof Error ? err.message : 'Import failed.');
    }
  };

  const operatorName = (ref: string) =>
    employees.find((e) => e.id === ref || e.employeeId === ref)?.fullName ?? '';

  const filteredLogs = machineWorkingLogs.filter((log) => {
    const matchMachine = filterMachine === 'all' || log.machineId === filterMachine;
    const matchProject = filterProject === 'all' || log.projectId === filterProject;
    const matchPeriod = inPeriod(log.date, period, currentDate);
    const term = searchTerm.toLowerCase();
    const code = machines.find((m) => m.id === log.machineId)?.assetId ?? '';
    const matchSearch =
      !term ||
      code.toLowerCase().includes(term) ||
      operatorName(log.operatorId).toLowerCase().includes(term) ||
      (log.remarks && log.remarks.toLowerCase().includes(term));
    return matchMachine && matchProject && matchPeriod && matchSearch;
  });

  const totalWorkingHours = Math.round(filteredLogs.reduce((s, l) => s + l.workingHours, 0) * 100) / 100;

  // Machine-wise totals: one row per crane across the filtered logs.
  const machineSummary = Array.from(
    filteredLogs.reduce((map, l) => {
      const row = map.get(l.machineId) ?? { hours: 0, days: new Set<string>(), sessions: 0 };
      row.hours += l.workingHours;
      row.days.add(l.date);
      row.sessions += 1;
      map.set(l.machineId, row);
      return map;
    }, new Map<string, { hours: number; days: Set<string>; sessions: number }>()),
  )
    .map(([id, v]) => ({
      id,
      machine: machines.find((m) => m.id === id),
      hours: Math.round(v.hours * 100) / 100,
      days: v.days.size,
      sessions: v.sessions,
    }))
    .sort((a, b) => b.hours - a.hours);

  const shiftOf = (start: string) => {
    const h = parseInt(start.split(':')[0] ?? '8', 10);
    return h >= 18 || h < 5 ? 'night' : 'day';
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="page-header">
        <div className="min-w-0">
          <h2 className="page-title">
            Machine Operating Hours Register
          </h2>
          <p className="text-xs sm:text-sm text-ink-500 mt-0.5">
            Log machine working sessions by day or night shift, see total hours machine-wise, and import Excel sheets.
          </p>
        </div>

        <div className="grid w-full grid-cols-2 gap-2.5 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <button
            onClick={() => { setImportError(''); setShowImportModal(true); }}
            className="btn btn-secondary"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Import Excel</span>
          </button>

          <button
            onClick={() => exportMachineWorkingLogs(filteredLogs, machines, projects, employees)}
            className="btn btn-secondary"
          >
            <Download className="w-4 h-4 text-ink-600" />
            <span>Export XLSX</span>
          </button>

          <button
            onClick={openAddModal}
            className="btn btn-primary col-span-2"
          >
            <Plus className="w-4 h-4" />
            <span>Log Working Hours</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="kpi-grid">
        <div className="stat-card">
          <span className="stat-label">Total Machine Logs</span>
          <div className="stat-value">{filteredLogs.length}</div>
          <span className="stat-hint">Recorded sessions</span>
        </div>

        <div className="stat-card stat-card-accent">
          <span className="stat-label">Total Operating Hours</span>
          <div className="stat-value">{totalWorkingHours} hrs</div>
          <span className="stat-hint">Net operating time</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Active Machines Logged</span>
          <div className="stat-value">
            {new Set(filteredLogs.map((l) => l.machineId)).size}
          </div>
          <span className="stat-hint">Equipment in duty</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Avg Daily Fleet Hours</span>
          <div className="stat-value">
            {Math.round((totalWorkingHours / Math.max(1, new Set(filteredLogs.map((l) => l.date)).size)) * 10) / 10}h
          </div>
          <span className="stat-hint">Fleet daily average</span>
        </div>
      </div>

      {/* Machine-wise totals */}
      {machineSummary.length > 0 && (
        <div className="table-card">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink-900">Machine-wise hours</h3>
            <p className="text-[11px] text-ink-500">Total operating hours per crane for the logs shown below.</p>
          </div>
          <ul className="divide-y divide-line md:hidden">
            {machineSummary.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-ink-900">{m.machine?.assetId ?? 'Unknown machine'}</div>
                  <div className="text-[11px] text-ink-500">{m.machine?.make} {m.machine?.model}</div>
                  <div className="mt-0.5 text-[11px] text-ink-600">{m.days} day{m.days === 1 ? '' : 's'} · {m.sessions} session{m.sessions === 1 ? '' : 's'}</div>
                </div>
                <div className="shrink-0 text-base font-bold text-ink-900">{m.hours} hrs</div>
              </li>
            ))}
          </ul>
          <div className="table-wrap hidden md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Machine / Crane</th>
                  <th className="text-center">Days worked</th>
                  <th className="text-center">Sessions</th>
                  <th className="text-right">Total hours</th>
                </tr>
              </thead>
              <tbody>
                {machineSummary.map((m) => (
                  <tr key={m.id}>
                    <td className="font-bold text-ink-900">
                      <div>{m.machine?.assetId ?? 'Unknown machine'}</div>
                      <div className="text-[10px] font-normal text-ink-500">
                        {m.machine?.make} {m.machine?.model}
                      </div>
                    </td>
                    <td className="text-center">{m.days}</td>
                    <td className="text-center">{m.sessions}</td>
                    <td className="text-right text-sm font-bold text-ink-900">{m.hours} hrs</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PeriodFilter value={period} onChange={setPeriod} />

      {/* Filters Bar */}
      <div className="filter-bar filter-bar--split">
        <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center">
          <div className="flex items-center gap-1.5 text-xs">
            <Select value={filterMachine} onValueChange={setFilterMachine}>
              <SelectTrigger className="form-input w-full sm:w-auto">
                <SelectValue placeholder="All Machines" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Machines</SelectItem>
                {machines.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.assetId} – {m.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger className="form-input w-full sm:w-auto">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="search-box">
          <Search className="w-4 h-4" />
          <input
            type="text"
            placeholder="Search crane, operator or remarks..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-input pl-9"
          />
        </div>
      </div>

      {/* Logs: cards on phones */}
      <div className="space-y-3 md:hidden">
        {filteredLogs.length === 0 && (
          <div className="empty-state rounded-lg border border-line bg-surface py-8 text-xs text-ink-500">
            No working logs for this period and filters.
          </div>
        )}
        {filteredLogs.map((log) => {
          const mac = machines.find((m) => m.assetId === log.machineId || m.id === log.machineId);
          const prj = projects.find((p) => p.id === log.projectId);
          const night = shiftOf(log.startTime) === 'night';
          return (
            <div key={log.id} className="rounded-lg border border-line bg-surface p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-ink-900">{mac?.assetId ?? 'Unknown machine'}</div>
                  <div className="text-[11px] text-ink-500">{mac?.make} {mac?.model}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-base font-bold text-ink-900">{log.workingHours} hrs</div>
                  <div className="text-[11px] font-semibold text-ink-600">{formatDateDDMMYYYY(log.date)}</div>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div className="min-w-0">
                  <dt className="stat-label">Project site</dt>
                  <dd className="mt-0.5 break-words font-medium text-ink-800">{prj?.name || log.projectId}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="stat-label">Operator</dt>
                  <dd className="mt-0.5 break-words font-medium text-ink-800">{operatorName(log.operatorId) || '-'}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="stat-label">Operating timing</dt>
                  <dd className="mt-0.5 flex items-center gap-1.5 font-medium text-ink-800">
                    {night ? <Moon size={13} className="text-ink-400" /> : <Sun size={13} className="text-ink-400" />}
                    {log.startTime.slice(0, 5)} <ArrowRight size={12} className="text-ink-400" aria-hidden="true" /> {log.endTime.slice(0, 5)}
                    <span className="text-ink-500">· {night ? 'Night' : 'Day'} shift</span>
                  </dd>
                </div>
                {log.remarks && (
                  <div className="col-span-2">
                    <dt className="stat-label">Duty remarks</dt>
                    <dd className="mt-0.5 break-words text-ink-700">{log.remarks}</dd>
                  </div>
                )}
              </dl>
            </div>
          );
        })}
      </div>

      {/* Logs table: tablets and desktop */}
      <div className="table-card hidden md:block">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Machine / Crane</th>
                <th>Project Site</th>
                <th>Operator</th>
                <th>Operating Timing</th>
                <th className="text-center">Total Hours</th>
                <th>Duty Remarks</th>
                <th className="text-right">Approval</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => {
                const mac = machines.find((m) => m.assetId === log.machineId || m.id === log.machineId);
                const prj = projects.find((p) => p.id === log.projectId);
                return (
                  <tr key={log.id}>
                    <td className="font-semibold text-ink-900">
                      {formatDateDDMMYYYY(log.date)}
                    </td>
                    <td className="font-bold text-ink-900">
                      <div>{mac?.assetId ?? 'Unknown machine'}</div>
                      <div className="text-[10px] text-ink-500 font-normal">
                        {mac?.make} {mac?.model}
                      </div>
                    </td>
                    <td className="font-medium text-ink-700">
                      {prj?.name || log.projectId}
                    </td>
                    <td className="text-ink-700">
                      {operatorName(log.operatorId) || '-'}
                    </td>
                    <td className="text-ink-600">
                      <span
                        className="mr-1.5 inline-flex align-middle text-ink-400"
                        title={shiftOf(log.startTime) === 'night' ? 'Night shift' : 'Day shift'}
                      >
                        {shiftOf(log.startTime) === 'night' ? <Moon size={13} /> : <Sun size={13} />}
                      </span>
                      {log.startTime.slice(0, 5)}{' '}
                      <ArrowRight
                        size={12}
                        className="inline-block align-middle text-ink-400"
                        aria-hidden="true"
                      />{' '}
                      {log.endTime.slice(0, 5)}
                    </td>
                    <td className="text-center font-bold text-ink-900 text-sm">
                      {log.workingHours} hrs
                    </td>
                    <td className="text-ink-600 max-w-[8rem] truncate" title={log.remarks || undefined}>
                      {log.remarks || '-'}
                    </td>
                    <td className="text-right">
                      <span className="badge badge-success" title="Approved">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span className="hidden 2xl:inline">Approved</span>
                        <span className="sr-only 2xl:hidden">Approved</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Entry Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <h3 className="modal-title">Log Machine Operating Session</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="icon-btn"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} noValidate className="flex min-h-0 flex-1 flex-col text-xs">
              <div className="modal-body space-y-4">
              {formError && (
                <div className="alert-banner" role="alert">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="text-xs">{formError}</span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="form-label">Date:</label>
                  <DateInput required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">Machine / Crane:</label>
                  <Select value={machineId} onValueChange={pickMachine}>
                    <SelectTrigger className="form-input">
                      <SelectValue placeholder="Select machine" />
                    </SelectTrigger>
                    <SelectContent>
                      {machines.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.assetId} – {m.model} ({m.tonnageCapacity}T)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="form-label">Project Site:</label>
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger className="form-input">
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="form-label">Operator:</label>
                  <Select value={operatorId || '__none__'} onValueChange={(v) => pickOperator(v === '__none__' ? '' : v)}>
                    <SelectTrigger className="form-input">
                      <SelectValue placeholder="Select operator" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No operator</SelectItem>
                      {activeOperators.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.fullName} ({o.employeeId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <span className="form-label">Shift:</span>
                <ShiftToggle value={shift} onChange={pickShift} />
                <p className="mt-1 text-[11px] text-ink-500">
                  Day starts 08:00, night starts 20:00, each {shiftHours} hours (set in Company Settings). Or choose Custom, type the times, or tap Now to use this device's clock.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="form-label" htmlFor="mw-start">Start Time:</label>
                  <div className="flex gap-2">
                    <input
                      id="mw-start"
                      type="time"
                      value={startTime}
                      onChange={(e) => { setStartTime(e.target.value); setShift('custom'); }}
                      className="form-input min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => { setStartTime(nowHHMM()); setShift('custom'); }}
                      className="btn btn-secondary shrink-0"
                    >
                      <Clock className="h-3.5 w-3.5" /> Now
                    </button>
                  </div>
                </div>

                <div>
                  <label className="form-label" htmlFor="mw-end">End Time:</label>
                  <div className="flex gap-2">
                    <input
                      id="mw-end"
                      type="time"
                      value={endTime}
                      onChange={(e) => { setEndTime(e.target.value); setShift('custom'); }}
                      className="form-input min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => { setEndTime(nowHHMM()); setShift('custom'); }}
                      className="btn btn-secondary shrink-0"
                    >
                      <Clock className="h-3.5 w-3.5" /> Now
                    </button>
                  </div>
                </div>
              </div>

              {/* Calculation Preview */}
              <div className="notice notice--warning justify-between">
                <span>Total Hours:</span>
                <strong className="text-base">{durationPreview ? `${durationPreview.netWorkingHours} Hours` : '-'}</strong>
              </div>
              {durationPreview && startTime > endTime && (
                <p className="text-[11px] text-ink-500">The end time is earlier than the start, so this is counted as an overnight session ending the next day.</p>
              )}

              <div>
                <label className="form-label">Remarks / Operation:</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Tandem pier girder launch, foundation pile rigging..."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="form-input"
                />
              </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary"
                >
                  {saving ? 'Saving…' : 'Save Log'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FULLY WORKING EXCEL IMPORT MODAL */}
      {showImportModal && (
        <div className="modal-overlay">
          <div className="modal-panel modal-panel-wide">
            <div className="modal-header">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-ink-600" />
                <h3 className="modal-title">Import Machine Working Hours from Excel</h3>
              </div>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setParsedRows([]);
                  setInvalidRows([]);
                }}
                className="icon-btn"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="modal-body space-y-4 text-xs">
              {/* Step 1: Download Official Template */}
              <div className="card card-pad flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="font-semibold text-ink-900">Step 1: Download Standard Template</h4>
                  <p className="text-ink-500 text-[11px] mt-0.5">
                    Pre-formatted XLSX sheet with Date (DD/MM/YYYY), Machine ID, Project ID, Operator (ID or name), Start/End times (24-hour HH:mm).
                  </p>
                </div>
                <button
                  onClick={() => downloadMachineWorkingTemplate(machines, projects, employees)}
                  className="btn btn-secondary shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-success-600" />
                  <span>Download XLSX Template</span>
                </button>
              </div>

              {/* Step 2: Upload Excel File */}
              <div className="border-2 border-dashed border-line-strong rounded-lg p-4 sm:p-6 text-center hover:border-ink-400 transition-colors bg-surface">
                <UploadCloud className="w-8 h-8 text-ink-500 mx-auto mb-2" />
                <span className="font-semibold text-ink-900 block">Upload Machine Operating Excel (.xlsx)</span>
                <p className="text-[11px] text-ink-500 mt-1">
                  System validates machine existence, project codes, shift times, and duplicate records.
                </p>
                <label className="btn btn-primary cursor-pointer mt-3">
                  Browse Excel File
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="sr-only"
                    onChange={handleFileUpload}
                  />
                </label>
              </div>

              {importing && (
                <div className="p-4 text-center font-semibold text-ink-700">
                  Validating records across database...
                </div>
              )}

              {importError && (
                <div className="alert-banner" role="alert">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="text-xs">{importError}</span>
                </div>
              )}

              {importSuccessCount !== null && (
                <div className="notice notice--success gap-2">
                  <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0" />
                  <span className="font-semibold">
                    Successfully imported {importSuccessCount} valid machine working logs!
                  </span>
                </div>
              )}

              {/* Validation Summary & Preview */}
              {(parsedRows.length > 0 || invalidRows.length > 0) && (
                <div className="space-y-3 pt-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink-900">Validation Results:</span>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-success-700 font-semibold">
                        {parsedRows.length} Valid Rows
                      </span>
                      {invalidRows.length > 0 && (
                        <span className="text-ink-700 font-semibold">
                          {invalidRows.length} Invalid Rows
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Invalid errors alert if any */}
                  {invalidRows.length > 0 && (
                    <div className="notice notice--danger flex-col items-start gap-2">
                      <div className="font-semibold flex items-center gap-1.5 text-xs">
                        <AlertTriangle className="w-4 h-4 text-danger-600" />
                        <span>The following rows have errors and will be skipped:</span>
                      </div>
                      <div className="max-h-40 w-full overflow-y-auto space-y-1">
                        {invalidRows.map((inv) => (
                          <div key={inv.rowNumber} className="text-[11px]">
                            <strong>Row {inv.rowNumber} ({inv.machineId || 'Missing ID'}):</strong> {inv.errors.join('; ')}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Valid Rows Preview Table */}
                  {parsedRows.length > 0 && (
                    <div className="card max-h-56 overflow-auto">
                      <table className="data-table min-w-[30rem]">
                        <thead>
                          <tr>
                            <th>Row</th>
                            <th>Date</th>
                            <th>Machine</th>
                            <th>Project</th>
                            <th>Operator</th>
                            <th>Hours</th>
                            <th>Remarks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedRows.map((row) => (
                            <tr key={row.rowNumber}>
                              <td>#{row.rowNumber}</td>
                              <td>{formatDateDDMMYYYY(row.date)}</td>
                              <td className="font-bold text-ink-900">{row.machineId}</td>
                              <td>{row.projectId}</td>
                              <td>{row.operatorId ? employees.find((x) => x.id === row.resolved?.operatorId)?.fullName ?? row.operatorId : '-'}</td>
                              <td className="font-bold text-success-700">
                                {calculateWorkingAndOt(row.startTime, row.endTime, 0, 1440).netWorkingHours}h
                              </td>
                              <td className="text-ink-600 truncate max-w-xs">{row.remarks}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <span className="mr-auto text-xs text-ink-500">
                {parsedRows.length > 0 ? `Ready to import ${parsedRows.length} logs` : 'Upload file to proceed'}
              </span>
              <button
                type="button"
                onClick={() => { setShowImportModal(false); setParsedRows([]); setInvalidRows([]); }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={parsedRows.length === 0}
                onClick={handleConfirmImport}
                className={`btn ${parsedRows.length > 0 ? 'btn-primary' : 'btn-secondary'}`}
              >
                Confirm & Import Valid Rows
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
