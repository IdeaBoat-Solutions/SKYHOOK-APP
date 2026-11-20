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

export const MachineWorkingView: React.FC = () => {
  const {
    currentUser,
    currentDate,
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

  // Manual Log Entry Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [date, setDate] = useState(currentDate);
  const [machineId, setMachineId] = useState(machines[0]?.assetId || 'CR-001');
  const [projectId, setProjectId] = useState(projects[0]?.id || 'PRJ-001');
  const [operatorId, setOperatorId] = useState('OP-001');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('18:00');
  const [idleMinutes, setIdleMinutes] = useState(60);
  const [remarks, setRemarks] = useState('');

  // Excel Import Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedImportRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<ParsedImportRow[]>([]);
  const [importSuccessCount, setImportSuccessCount] = useState<number | null>(null);

  const durationPreview = calculateWorkingAndOt(startTime, endTime, idleMinutes, 1440);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addMachineWorkingLog({
      date,
      machineId,
      projectId,
      operatorId,
      startTime,
      endTime,
      idleMinutes: Number(idleMinutes) || 0,
      remarks,
      enteredBy: currentUser.name,
      approvalStatus: 'approved',
    });
    setShowAddModal(false);
    setRemarks('');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportSuccessCount(null);
    try {
      const result = await parseMachineWorkingExcel(file, machines, projects, employees);
      setParsedRows(result.validRows);
      setInvalidRows(result.invalidRows);
    } catch (err) {
      alert('Error reading Excel spreadsheet: ' + (err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const handleConfirmImport = async () => {
    if (parsedRows.length === 0) return;
    const formatted: Omit<MachineWorkingLog, 'id'>[] = parsedRows.map((r) => {
      const { netWorkingMinutes, netWorkingHours } = calculateWorkingAndOt(
        r.startTime,
        r.endTime,
        r.idleMinutes,
        1440
      );
      return {
        date: r.date,
        machineId: r.machineId,
        projectId: r.projectId,
        operatorId: r.operatorId,
        startTime: r.startTime,
        endTime: r.endTime,
        idleMinutes: r.idleMinutes,
        workingMinutes: netWorkingMinutes,
        workingHours: netWorkingHours,
        remarks: r.remarks,
        enteredBy: currentUser.name,
        approvalStatus: 'approved',
      };
    });

    const count = await importMachineWorkingLogs(formatted);
    setImportSuccessCount(count);
    setParsedRows([]);
    setInvalidRows([]);
    setTimeout(() => {
      setShowImportModal(false);
      setImportSuccessCount(null);
    }, 1500);
  };

  const filteredLogs = machineWorkingLogs.filter((log) => {
    const matchMachine = filterMachine === 'all' || log.machineId === filterMachine;
    const matchProject = filterProject === 'all' || log.projectId === filterProject;
    const matchSearch =
      !searchTerm ||
      log.machineId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.operatorId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.remarks && log.remarks.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchMachine && matchProject && matchSearch;
  });

  const totalWorkingHours = filteredLogs.reduce((s, l) => s + l.workingHours, 0);

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">
            Machine Operating Hours Register
          </h2>
          <p className="text-xs sm:text-sm text-ink-500 mt-0.5">
            Log machine engine sessions, deduct idle hours, analyze crane fleet utilization, and import Excel sheets.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setShowImportModal(true)}
            className="btn btn-secondary"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Import Excel</span>
          </button>

          <button
            onClick={() => exportMachineWorkingLogs(filteredLogs, machines, projects)}
            className="btn btn-secondary"
          >
            <Download className="w-4 h-4 text-ink-600" />
            <span>Export XLSX</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="btn btn-primary"
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

      {/* Filters Bar */}
      <div className="filter-bar filter-bar--split">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <Select value={filterMachine} onValueChange={setFilterMachine}>
              <SelectTrigger className="form-input w-auto">
                <SelectValue placeholder="All Machines" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Machines</SelectItem>
                {machines.map((m) => (
                  <SelectItem key={m.id} value={m.assetId}>
                    {m.assetId} – {m.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger className="form-input w-auto">
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
            placeholder="Search crane or remarks..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-input pl-9"
          />
        </div>
      </div>

      {/* Logs Table */}
      <div className="table-card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Machine / Crane</th>
                <th>Project Site</th>
                <th>Operator</th>
                <th>Operating Timing</th>
                <th className="text-center">Idle Duration</th>
                <th className="text-center">Net Working Hours</th>
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
                      <div>{log.machineId}</div>
                      <div className="text-[10px] text-ink-500 font-normal">
                        {mac?.make} {mac?.model}
                      </div>
                    </td>
                    <td className="font-medium text-ink-700">
                      {prj?.name || log.projectId}
                    </td>
                    <td className="text-ink-700">
                      {log.operatorId}
                    </td>
                    <td className="text-ink-600">
                      {log.startTime}{' '}
                      <ArrowRight
                        size={12}
                        className="inline-block align-middle text-ink-400"
                        aria-hidden="true"
                      />{' '}
                      {log.endTime}
                    </td>
                    <td className="text-center text-warning-700">
                      {log.idleMinutes} mins
                    </td>
                    <td className="text-center font-bold text-ink-900 text-sm">
                      {log.workingHours} hrs
                    </td>
                    <td className="text-ink-600 max-w-xs truncate">
                      {log.remarks || '-'}
                    </td>
                    <td className="text-right">
                      <span className="badge badge-success">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approved</span>
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
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="p-6 space-y-4 text-xs">
              <div className="stat-grid">
                <div>
                  <label className="form-label">Date:</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">Machine / Crane:</label>
                  <Select value={machineId} onValueChange={setMachineId}>
                    <SelectTrigger className="form-input">
                      <SelectValue placeholder="Select machine" />
                    </SelectTrigger>
                    <SelectContent>
                      {machines.map((m) => (
                        <SelectItem key={m.id} value={m.assetId}>
                          {m.assetId} – {m.model} ({m.tonnageCapacity}T)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="stat-grid">
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
                  <label className="form-label">Operator ID:</label>
                  <input
                    type="text"
                    required
                    value={operatorId}
                    onChange={(e) => setOperatorId(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="form-label">Start Time:</label>
                  <input
                    type="time"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">End Time:</label>
                  <input
                    type="time"
                    required
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">Idle Minutes:</label>
                  <input
                    type="number"
                    value={idleMinutes}
                    onChange={(e) => setIdleMinutes(parseInt(e.target.value, 10) || 0)}
                    className="form-input"
                  />
                </div>
              </div>

              {/* Calculation Preview */}
              <div className="notice notice--warning justify-between">
                <span>Calculated Net Operating Hours:</span>
                <strong className="text-base">{durationPreview.netWorkingHours} Hours</strong>
              </div>

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

              <div className="form-actions">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Save Log
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

            <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Step 1: Download Official Template */}
              <div className="card card-pad flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-ink-900">Step 1: Download Standard Template</h4>
                  <p className="text-ink-500 text-[11px] mt-0.5">
                    Pre-formatted XLSX sheet with Date, Machine ID, Project ID, Operator ID, Start/End times.
                  </p>
                </div>
                <button
                  onClick={downloadMachineWorkingTemplate}
                  className="btn btn-secondary shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-success-600" />
                  <span>Download XLSX Template</span>
                </button>
              </div>

              {/* Step 2: Upload Excel File */}
              <div className="border-2 border-dashed border-line-strong rounded-lg p-6 text-center hover:border-ink-400 transition-colors bg-surface">
                <UploadCloud className="w-8 h-8 text-ink-500 mx-auto mb-2" />
                <span className="font-semibold text-ink-900 block">Upload Machine Operating Excel (.xlsx)</span>
                <p className="text-[11px] text-ink-500 mt-1">
                  System validates machine existence, project codes, shift times, and duplicate records.
                </p>
                <label className="btn btn-primary cursor-pointer mt-3">
                  Browse Excel File
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
              </div>

              {importing && (
                <div className="p-4 text-center font-semibold text-ink-700">
                  Validating records across database...
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
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink-900">Validation Results:</span>
                    <div className="flex items-center gap-3">
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
                      <div className="max-h-28 overflow-y-auto space-y-1 pl-5 list-disc">
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
                    <div className="card overflow-hidden max-h-48 overflow-y-auto">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Row</th>
                            <th>Date</th>
                            <th>Machine</th>
                            <th>Project</th>
                            <th>Hours</th>
                            <th>Remarks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedRows.map((row) => (
                            <tr key={row.rowNumber}>
                              <td>#{row.rowNumber}</td>
                              <td>{row.date}</td>
                              <td className="font-bold text-ink-900">{row.machineId}</td>
                              <td>{row.projectId}</td>
                              <td className="font-bold text-success-700">
                                {calculateWorkingAndOt(row.startTime, row.endTime, row.idleMinutes, 1440).netWorkingHours}h
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

            <div className="px-6 py-3.5 bg-surface-muted border-t border-line flex items-center justify-between shrink-0">
              <span className="text-xs text-ink-500">
                {parsedRows.length > 0 ? `Ready to import ${parsedRows.length} logs` : 'Upload file to proceed'}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="btn btn-ghost"
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
        </div>
      )}
    </div>
  );
};
