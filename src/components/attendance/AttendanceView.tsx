import React, { useState } from 'react';
import {
  CalendarCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Plus,
  Search,
  Filter,
  FileSpreadsheet,
  Calendar,
  AlertCircle,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  UserX,
  X,
  DollarSign,
  Sparkles,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import {
  formatINR,
  formatDateDDMMYYYY,
  calculateWorkingAndOt,
} from '../../utils/calculations';
import { AttendanceRecord, AttendanceStatus } from '../../types';

export const AttendanceView: React.FC = () => {
  const {
    currentUser,
    currentDate,
    attendance,
    employees,
    projects,
    machines,
    addAttendanceRecord,
    approveAttendanceRecord,
    rejectAttendanceRecord,
    markOperatorAttendanceQuick,
    markAllOperatorsPresent,
    addOrUpdateOvertimeHours,
    generatePayrollForMonth,
  } = useSkyhook();

  const [activeTab, setActiveTab] = useState<'daily' | 'monthly' | 'pending'>('daily');
  const [selectedDate, setSelectedDate] = useState(currentDate);
  const [selectedMonth, setSelectedMonth] = useState('2026-10');
  const [selectedProject, setSelectedProject] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [quickFeedback, setQuickFeedback] = useState<string | null>(null);

  // Day-Wise Overtime Modal State
  const [showOtModal, setShowOtModal] = useState(false);
  const [otOperatorId, setOtOperatorId] = useState(employees.find(e => e.employeeType === 'operator')?.id || '');
  const [otDate, setOtDate] = useState(selectedDate);
  const [otHours, setOtHours] = useState<number>(2);
  const [otProjectId, setOtProjectId] = useState(projects[0]?.id || '');
  const [otRate, setOtRate] = useState<number>(projects[0]?.overtimeRate || 150);
  const [otRemarks, setOtRemarks] = useState('');

  // Detailed Shift Modal (Legacy / Complex)
  const [showAddModal, setShowAddModal] = useState(false);
  const [operatorId, setOperatorId] = useState(employees[0]?.id || '');
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [machineId, setMachineId] = useState(machines[0]?.id || '');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('18:00');
  const [breakMin, setBreakMin] = useState(0);
  const [status, setStatus] = useState<AttendanceStatus>('present');
  const [remarks, setRemarks] = useState('');

  const activeOperators = employees.filter(
    (e) => e.employeeType === 'operator' && e.status === 'active'
  );

  // Dynamic preview for daily modal
  const durationPreview = calculateWorkingAndOt(startTime, endTime, breakMin, 600);
  const currentPrj = projects.find((p) => p.id === projectId);
  const detailedOtRate = currentPrj?.overtimeRate || 150;
  const otEarnings = Math.round(durationPreview.potentialOtHours * detailedOtRate);

  const pendingList = attendance.filter((a) => a.approvalStatus === 'submitted');

  // Trigger feedback helper
  const notifyFeedback = (msg: string) => {
    setQuickFeedback(msg);
    setTimeout(() => setQuickFeedback(null), 3200);
  };

  // Date stepper handlers
  const handleStepDay = (delta: number) => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() + delta);
    const nextDate = current.toISOString().slice(0, 10);
    setSelectedDate(nextDate);
    setOtDate(nextDate);
  };

  const handleSetToday = () => {
    setSelectedDate(currentDate);
    setOtDate(currentDate);
  };

  // Quick Attendance Handler
  const handleQuickStatus = (opId: string, targetStatus: AttendanceStatus, customOt?: number) => {
    const op = employees.find((e) => e.id === opId || e.employeeId === opId);
    const assignedPrjId = op?.currentProjectId || projects[0]?.id || 'PRJ-001';

    markOperatorAttendanceQuick({
      operatorId: opId,
      date: selectedDate,
      status: targetStatus,
      overtimeHours: customOt,
      projectId: assignedPrjId,
      machineId: op?.currentMachineId || 'CR-001',
    });

    // Auto refresh payroll month
    generatePayrollForMonth(selectedDate.slice(0, 7));

    const statusLabel = targetStatus === 'present' ? 'PRESENT' : targetStatus === 'absent' ? 'ABSENT' : 'HALF DAY';
    notifyFeedback(`Marked ${op?.fullName || opId} as ${statusLabel} for ${formatDateDDMMYYYY(selectedDate)}.`);
  };

  // Inline Overtime change
  const handleInlineOtChange = (opId: string, newOtHours: number) => {
    const validHours = Math.max(0, Number(newOtHours) || 0);
    const op = employees.find((e) => e.id === opId || e.employeeId === opId);
    const assignedPrjId = op?.currentProjectId || projects[0]?.id || 'PRJ-001';
    const prj = projects.find((p) => p.id === assignedPrjId);

    addOrUpdateOvertimeHours({
      operatorId: opId,
      date: selectedDate,
      overtimeHours: validHours,
      projectId: assignedPrjId,
      appliedOtRate: prj?.overtimeRate || 150,
      remarks: validHours > 0 ? `Inline logged ${validHours}h OT` : undefined,
    });

    generatePayrollForMonth(selectedDate.slice(0, 7));
    notifyFeedback(`Updated overtime: ${validHours} hrs for ${op?.fullName || opId}. Payslip recalculated.`);
  };

  // Mark all present
  const handleMarkAllPresent = () => {
    markAllOperatorsPresent({ date: selectedDate });
    generatePayrollForMonth(selectedDate.slice(0, 7));
    notifyFeedback(`All ${activeOperators.length} active operators marked PRESENT (10h shift) for ${formatDateDDMMYYYY(selectedDate)}.`);
  };

  // Open Overtime Modal for specific operator
  const handleOpenOtModal = (opId?: string) => {
    const targetOpId = opId || activeOperators[0]?.id || '';
    const op = employees.find((e) => e.id === targetOpId || e.employeeId === targetOpId);
    const prjId = op?.currentProjectId || projects[0]?.id || '';
    const prj = projects.find((p) => p.id === prjId);

    setOtOperatorId(targetOpId);
    setOtDate(selectedDate);
    setOtProjectId(prjId);
    setOtRate(prj?.overtimeRate || 150);
    setOtHours(2);
    setOtRemarks('');
    setShowOtModal(true);
  };

  // Save Day-Wise Overtime Modal
  const handleSaveDayWiseOt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!otOperatorId) return;

    addOrUpdateOvertimeHours({
      operatorId: otOperatorId,
      date: otDate,
      overtimeHours: Number(otHours) || 0,
      projectId: otProjectId,
      appliedOtRate: Number(otRate) || 150,
      remarks: otRemarks.trim() || undefined,
    });

    // Automatically recalculate monthly payroll so payslip immediately gets the new OT!
    generatePayrollForMonth(otDate.slice(0, 7));

    const op = employees.find((x) => x.id === otOperatorId || x.employeeId === otOperatorId);
    notifyFeedback(`Day-wise overtime of ${otHours}h recorded for ${op?.fullName || otOperatorId}. Payslip updated accurately!`);
    setShowOtModal(false);
  };

  const handleSaveDetailedAttendance = (e: React.FormEvent) => {
    e.preventDefault();
    addAttendanceRecord({
      date: selectedDate,
      operatorId,
      projectId,
      machineId,
      startTime,
      endTime,
      unpaidBreakMinutes: Number(breakMin) || 0,
      appliedOtRate: detailedOtRate,
      status,
      approvalStatus: currentUser.role === 'owner' ? 'approved' : 'submitted',
      remarks,
      enteredBy: currentUser.name,
      approvedBy: currentUser.role === 'owner' ? currentUser.name : undefined,
    });
    generatePayrollForMonth(selectedDate.slice(0, 7));
    setShowAddModal(false);
    setRemarks('');
    notifyFeedback(`Saved shift log for ${selectedDate}.`);
  };

  // Filtered daily list
  const filteredDaily = attendance.filter((a) => {
    const matchDate = a.date === selectedDate;
    const matchProject = selectedProject === 'all' || a.projectId === selectedProject;
    const emp = employees.find((e) => e.id === a.operatorId || e.employeeId === a.operatorId);
    const matchSearch =
      !searchTerm ||
      emp?.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp?.employeeId.toLowerCase().includes(searchTerm.toLowerCase());
    return matchDate && matchProject && matchSearch;
  });

  // Calculate day stats
  const dateRecords = attendance.filter((a) => a.date === selectedDate);
  const presentCount = dateRecords.filter((a) => a.status === 'present').length;
  const absentCount = dateRecords.filter((a) => a.status === 'absent').length;
  const halfDayCount = dateRecords.filter((a) => a.status === 'half_day').length;
  const totalDayOtHours = dateRecords.reduce((sum, a) => sum + (a.overtimeHours || 0), 0);
  const totalDayOtPay = dateRecords.reduce((sum, a) => sum + (a.overtimeHours || 0) * (a.appliedOtRate || 0), 0);

  // Monthly spreadsheet matrix
  const daysInMonth = 31;
  const monthDates = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    return `${selectedMonth}-${String(d).padStart(2, '0')}`;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-accent bg-accent/10 px-2 py-0.5 rounded border border-accent/20">
              Workforce Operations
            </span>
            <span className="text-xs text-zinc-500 font-medium">Standard 10h Daily Shift</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-black mt-1 tracking-tight">
            Operator Attendance & Overtime Register
          </h2>
          <p className="text-xs sm:text-sm text-zinc-500 mt-0.5">
            Quick one-click Present / Absent marking, day-wise overtime allocation, and instant payslip synchronisation.
          </p>
        </div>

        {/* Top Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => handleOpenOtModal()}
            className="px-4 py-2.5 rounded-xl bg-black hover:bg-zinc-800 text-accent font-bold text-xs transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Clock className="w-4 h-4 text-accent" />
            <span>+ Add Day-Wise Overtime</span>
          </button>

          <button
            onClick={handleMarkAllPresent}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors shadow-xs flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Mark All Present</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="px-3.5 py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-bold text-xs transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5 text-zinc-500" />
            <span>Detailed Shift</span>
          </button>
        </div>
      </div>

      {/* Floating Action Feedback Pill */}
      {quickFeedback && (
        <div className="p-3 rounded-xl bg-black text-white text-xs font-bold flex items-center justify-between shadow-lg border border-zinc-800 animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-accent" />
            <span>{quickFeedback}</span>
          </div>
          <button onClick={() => setQuickFeedback(null)} className="text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 rounded-2xl shadow-xs">
        <div className="flex space-x-6">
          <button
            onClick={() => setActiveTab('daily')}
            className={`py-3.5 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'daily'
                ? 'border-accent text-black'
                : 'border-transparent text-zinc-500 hover:text-black'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>Quick Attendance Sheet</span>
          </button>

          <button
            onClick={() => setActiveTab('monthly')}
            className={`py-3.5 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'monthly'
                ? 'border-accent text-black'
                : 'border-transparent text-zinc-500 hover:text-black'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Monthly Spreadsheet Matrix</span>
          </button>

          <button
            onClick={() => setActiveTab('pending')}
            className={`py-3.5 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'pending'
                ? 'border-accent text-black'
                : 'border-transparent text-zinc-500 hover:text-black'
            }`}
          >
            <span>Pending Approvals</span>
            {pendingList.length > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-black rounded-full bg-accent text-white">
                {pendingList.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* TAB 1: QUICK ATTENDANCE SHEET */}
      {activeTab === 'daily' && (
        <div className="space-y-4">
          {/* Controls Bar with Date Stepper */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Date Stepper */}
              <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-200 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => handleStepDay(-1)}
                  title="Previous Day"
                  className="p-1.5 rounded-lg hover:bg-zinc-200 text-zinc-600 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1.5 px-2 text-xs font-bold text-black font-mono">
                  <Calendar className="w-3.5 h-3.5 text-accent" />
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      setSelectedDate(e.target.value);
                      setOtDate(e.target.value);
                    }}
                    className="bg-transparent font-bold text-black focus:outline-none cursor-pointer"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleStepDay(1)}
                  title="Next Day"
                  className="p-1.5 rounded-lg hover:bg-zinc-200 text-zinc-600 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleSetToday}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors border ${
                  selectedDate === currentDate
                    ? 'bg-black text-accent border-zinc-800'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 border-zinc-200'
                }`}
              >
                Today
              </button>

              {/* Project Filter */}
              <div className="flex items-center gap-1.5 text-xs">
                <Filter className="w-4 h-4 text-zinc-400" />
                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-zinc-50 border border-zinc-200 rounded-xl font-medium focus:ring-2 focus:ring-accent"
                >
                  <option value="all">All Projects</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-400" />
              <input
                type="text"
                placeholder="Search operator..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          {/* Quick Summary KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white p-3.5 rounded-xl border border-zinc-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-zinc-500 uppercase">Active Operators</span>
                <p className="text-lg font-black text-black">{activeOperators.length}</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-700 font-bold text-xs">
                {activeOperators.length}
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-zinc-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-emerald-700 uppercase">Marked Present</span>
                <p className="text-lg font-black text-emerald-700">{presentCount}</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-zinc-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-rose-700 uppercase">Marked Absent</span>
                <p className="text-lg font-black text-rose-700">{absentCount}</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-rose-50 text-rose-700 flex items-center justify-center">
                <XCircle className="w-4 h-4" />
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-zinc-200 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-accent uppercase">Today's OT Hours</span>
                <p className="text-lg font-black text-black font-mono">
                  {totalDayOtHours}h <span className="text-xs text-zinc-400 font-normal">({formatINR(totalDayOtPay)})</span>
                </p>
              </div>
              <div className="w-8 h-8 rounded-full bg-accent/15 text-accent flex items-center justify-center">
                <Clock className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* Quick Attendance Sheet List */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xs overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-zinc-50/50">
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-sm text-black">
                  Daily Operator Attendance & Day-Wise Overtime Entry
                </h3>
                <span className="text-xs font-bold text-accent bg-white px-2.5 py-0.5 rounded-full border border-zinc-200">
                  {formatDateDDMMYYYY(selectedDate)}
                </span>
              </div>
              <span className="text-xs text-zinc-500 font-normal">
                Click <strong>Present</strong> or <strong>Absent</strong> to mark attendance instantly. Enter overtime to reflect directly in payslips.
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-black text-white font-semibold uppercase text-[11px] tracking-wider">
                  <tr>
                    <th className="px-4 py-3.5">Operator</th>
                    <th className="px-4 py-3.5">Assigned Project & Crane</th>
                    <th className="px-4 py-3.5 text-center">Quick Attendance</th>
                    <th className="px-4 py-3.5 text-center">Day-Wise Overtime (OT)</th>
                    <th className="px-4 py-3.5 text-center">Shift Hours</th>
                    <th className="px-4 py-3.5 text-right">Day Overtime Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-zinc-800">
                  {activeOperators.map((op) => {
                    // Match attendance record for this operator on selected date
                    const rec = attendance.find(
                      (a) => (a.operatorId === op.id || a.operatorId === op.employeeId) && a.date === selectedDate
                    );

                    const status = rec?.status;
                    const otHoursCurrent = rec?.overtimeHours || 0;
                    const project = projects.find((p) => p.id === (rec?.projectId || op.currentProjectId));
                    const appliedRate = rec?.appliedOtRate || project?.overtimeRate || 150;
                    const dayOtEarnings = Math.round(otHoursCurrent * appliedRate);

                    return (
                      <tr key={op.id} className="hover:bg-zinc-50/80 transition-colors">
                        {/* Operator Info */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-zinc-800 text-accent flex items-center justify-center font-bold text-xs shrink-0 shadow-xs border border-zinc-700">
                              {op.fullName.charAt(0)}
                            </div>
                            <div>
                              <div className="font-bold text-black text-xs sm:text-sm">
                                {op.fullName}
                              </div>
                              <div className="text-[11px] text-zinc-500 font-mono">
                                {op.employeeId} • {op.mobile}
                              </div>
                              <div className="text-[10px] text-zinc-400 capitalize">
                                {op.designation} (₹{op.dailyRate}/day)
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Project & Machine */}
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-black max-w-xs truncate">
                            {project?.name || 'Site Assignment'}
                          </div>
                          <div className="text-[11px] text-zinc-500 font-mono">
                            Crane: <strong className="text-zinc-700">{op.currentMachineId || 'CR-001'}</strong>
                          </div>
                          <div className="text-[10px] text-accent font-bold">
                            OT Rate: ₹{appliedRate}/hr
                          </div>
                        </td>

                        {/* Quick Attendance Buttons */}
                        <td className="px-4 py-3.5 text-center">
                          <div className="inline-flex items-center gap-1.5 p-1 rounded-xl bg-zinc-100 border border-zinc-200">
                            {/* PRESENT BUTTON */}
                            <button
                              type="button"
                              onClick={() => handleQuickStatus(op.id, 'present', otHoursCurrent)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                                status === 'present'
                                  ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-400'
                                  : 'bg-white text-zinc-700 hover:bg-emerald-50 hover:text-emerald-700'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Present</span>
                            </button>

                            {/* ABSENT BUTTON */}
                            <button
                              type="button"
                              onClick={() => handleQuickStatus(op.id, 'absent', 0)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                                status === 'absent'
                                  ? 'bg-rose-600 text-white shadow-xs ring-2 ring-rose-400'
                                  : 'bg-white text-zinc-700 hover:bg-rose-50 hover:text-rose-700'
                              }`}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Absent</span>
                            </button>

                            {/* HALF DAY BUTTON */}
                            <button
                              type="button"
                              onClick={() => handleQuickStatus(op.id, 'half_day', otHoursCurrent)}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                                status === 'half_day'
                                  ? 'bg-amber-500 text-white shadow-xs ring-2 ring-amber-400'
                                  : 'bg-white text-zinc-700 hover:bg-amber-50 hover:text-amber-700'
                              }`}
                            >
                              <span>Half</span>
                            </button>
                          </div>

                          {/* Quick Label */}
                          <div className="mt-1 text-[10px] font-mono">
                            {status === 'present' && (
                              <span className="text-emerald-700 font-bold">10h Standard Working</span>
                            )}
                            {status === 'absent' && (
                              <span className="text-rose-700 font-bold">0h (No wage payable)</span>
                            )}
                            {status === 'half_day' && (
                              <span className="text-amber-700 font-bold">5h (0.5 Payable Day)</span>
                            )}
                            {!status && (
                              <span className="text-zinc-400 italic">Not marked yet</span>
                            )}
                          </div>
                        </td>

                        {/* Day-Wise Overtime Inline Stepper */}
                        <td className="px-4 py-3.5 text-center">
                          <div className="inline-flex flex-col items-center gap-1">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleInlineOtChange(op.id, Math.max(0, otHoursCurrent - 1))}
                                title="Decrease 1 Hour OT"
                                className="w-7 h-7 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-700 font-bold text-xs flex items-center justify-center transition-colors"
                              >
                                -
                              </button>

                              <div className="relative">
                                <input
                                  type="number"
                                  min="0"
                                  max="14"
                                  step="0.5"
                                  value={otHoursCurrent}
                                  onChange={(e) => handleInlineOtChange(op.id, parseFloat(e.target.value) || 0)}
                                  className="w-16 px-2 py-1 text-center text-xs font-mono font-bold bg-zinc-50 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                                />
                                <span className="absolute right-1.5 top-1 text-[10px] text-zinc-400 font-mono pointer-events-none">
                                  h
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleInlineOtChange(op.id, otHoursCurrent + 1)}
                                title="Increase 1 Hour OT"
                                className="w-7 h-7 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-700 font-bold text-xs flex items-center justify-center transition-colors"
                              >
                                +
                              </button>
                            </div>

                            {/* Quick Preset Buttons */}
                            <div className="flex items-center gap-1">
                              {[1, 2, 3, 4].map((h) => (
                                <button
                                  key={h}
                                  type="button"
                                  onClick={() => handleInlineOtChange(op.id, h)}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono transition-colors ${
                                    otHoursCurrent === h
                                      ? 'bg-black text-accent'
                                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                                  }`}
                                >
                                  +{h}h
                                </button>
                              ))}
                            </div>

                            {/* Overtime Pay Calculation */}
                            {otHoursCurrent > 0 ? (
                              <span className="text-[10px] font-bold text-emerald-700 font-mono">
                                +₹{dayOtEarnings} OT Pay ({otHoursCurrent}h @ ₹{appliedRate})
                              </span>
                            ) : (
                              <span className="text-[10px] text-zinc-400 font-mono">0h OT</span>
                            )}
                          </div>
                        </td>

                        {/* Shift Total */}
                        <td className="px-4 py-3.5 text-center font-mono">
                          {status === 'present' ? (
                            <div>
                              <span className="font-extrabold text-black text-xs">
                                {10 + otHoursCurrent}h Total
                              </span>
                              <span className="text-[10px] text-zinc-500 block">
                                (10h Std + {otHoursCurrent}h OT)
                              </span>
                            </div>
                          ) : status === 'half_day' ? (
                            <div>
                              <span className="font-extrabold text-amber-700 text-xs">
                                {5 + otHoursCurrent}h Total
                              </span>
                              <span className="text-[10px] text-zinc-500 block">
                                (5h Half + {otHoursCurrent}h OT)
                              </span>
                            </div>
                          ) : status === 'absent' ? (
                            <span className="text-rose-600 font-bold text-xs">0 Hours</span>
                          ) : (
                            <span className="text-zinc-400">-</span>
                          )}
                        </td>

                        {/* Overtime Custom Entry Action */}
                        <td className="px-4 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleOpenOtModal(op.id)}
                            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-100 hover:bg-black hover:text-accent transition-colors border border-zinc-200 inline-flex items-center gap-1"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>Add OT</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Collapsible / Audit Detailed Logs Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden mt-6">
            <div className="px-4 py-3 bg-zinc-100 border-b border-zinc-200 flex items-center justify-between">
              <span className="font-bold text-xs text-zinc-700 uppercase tracking-wider">
                Full Shift Audit Log & Timestamp Register ({filteredDaily.length} Records)
              </span>
              <span className="text-[11px] text-zinc-500 font-mono">
                Date: {formatDateDDMMYYYY(selectedDate)}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-800 text-white font-semibold uppercase text-[10px]">
                  <tr>
                    <th className="px-3.5 py-2.5">Operator</th>
                    <th className="px-3.5 py-2.5">Project & Crane</th>
                    <th className="px-3.5 py-2.5">Shift Timing</th>
                    <th className="px-3.5 py-2.5 text-center">Net Working</th>
                    <th className="px-3.5 py-2.5 text-center">Overtime</th>
                    <th className="px-3.5 py-2.5">Applied OT Rate</th>
                    <th className="px-3.5 py-2.5 text-center">Status</th>
                    <th className="px-3.5 py-2.5 text-right">Approval Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {filteredDaily.length > 0 ? (
                    filteredDaily.map((rec) => {
                      const op = employees.find((e) => e.id === rec.operatorId || e.employeeId === rec.operatorId);
                      const prj = projects.find((p) => p.id === rec.projectId);
                      return (
                        <tr key={rec.id} className="hover:bg-slate-50/80">
                          <td className="px-3.5 py-2.5 font-semibold">
                            <div className="text-slate-900 font-bold">{op?.fullName || rec.operatorId}</div>
                            <div className="text-[10px] text-slate-500 font-mono">{op?.employeeId}</div>
                          </td>
                          <td className="px-3.5 py-2.5">
                            <div className="font-semibold text-slate-800">{prj?.name || rec.projectId}</div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              Crane: {rec.machineId || 'Site duty'}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-slate-700">
                            {rec.startTime} &rarr; {rec.endTime}
                          </td>
                          <td className="px-3.5 py-2.5 text-center font-bold text-slate-900 font-mono">
                            {rec.netWorkingHours}h
                          </td>
                          <td className="px-3.5 py-2.5 text-center font-bold font-mono">
                            {rec.overtimeHours > 0 ? (
                              <span className="text-blue-700 font-bold px-2 py-0.5 rounded bg-blue-50 border border-blue-200">
                                +{rec.overtimeHours}h
                              </span>
                            ) : (
                              <span className="text-slate-400">0h</span>
                            )}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className="font-semibold text-emerald-700">
                              ₹{rec.appliedOtRate} / hr
                            </span>
                            {rec.overtimeHours > 0 && (
                              <span className="text-[10px] text-slate-500 block font-mono">
                                Total: ₹{Math.round(rec.overtimeHours * rec.appliedOtRate)}
                              </span>
                            )}
                          </td>
                          <td className="px-3.5 py-2.5 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                rec.status === 'present'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : rec.status === 'half_day'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {rec.status}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono text-[11px]">
                            {rec.approvalStatus === 'approved' ? (
                              <span className="text-emerald-600 font-bold">Approved</span>
                            ) : (
                              <button
                                onClick={() => approveAttendanceRecord(rec.id)}
                                className="px-2 py-1 bg-black text-accent rounded font-bold text-[10px]"
                              >
                                Approve
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-zinc-400">
                        No timestamp logs recorded for {selectedDate}. Use the Quick Attendance buttons above to mark attendance in 1 click.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MONTHLY MATRIX */}
      {activeTab === 'monthly' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-3">
              <label className="text-xs font-bold text-slate-700">Select Month:</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-3 py-1.5 text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg"
              >
                <option value="2026-10">October 2026</option>
                <option value="2026-09">September 2026</option>
                <option value="2026-11">November 2026</option>
              </select>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 font-bold text-emerald-700">
                <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> P: Present
              </span>
              <span className="flex items-center gap-1 font-bold text-amber-700">
                <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" /> H: Half Day
              </span>
              <span className="flex items-center gap-1 font-bold text-rose-700">
                <span className="w-3 h-3 rounded-full bg-rose-500 inline-block" /> A: Absent
              </span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-x-auto">
            <table className="w-full text-center text-xs border-collapse">
              <thead className="bg-black text-white font-semibold">
                <tr>
                  <th className="px-3 py-2.5 text-left sticky left-0 bg-black z-10 w-44">
                    Operator
                  </th>
                  {monthDates.map((d) => (
                    <th key={d} className="px-1.5 py-2.5 font-mono text-[10px]">
                      {d.slice(-2)}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 bg-zinc-900 text-accent">Payable</th>
                  <th className="px-3 py-2.5 bg-zinc-900 text-accent">OT (Hrs)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {activeOperators.map((op) => {
                  let totalPresent = 0;
                  let totalHalf = 0;
                  let totalOt = 0;

                  return (
                    <tr key={op.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-left font-bold text-slate-900 sticky left-0 bg-white shadow-xs z-10 truncate">
                        {op.fullName}
                      </td>
                      {monthDates.map((d) => {
                        const rec = attendance.find(
                          (a) =>
                            (a.operatorId === op.id || a.operatorId === op.employeeId) &&
                            a.date === d &&
                            a.approvalStatus === 'approved'
                        );
                        if (rec) {
                          if (rec.status === 'present') totalPresent++;
                          if (rec.status === 'half_day') totalHalf++;
                          totalOt += rec.overtimeHours || 0;
                        }

                        return (
                          <td key={d} className="p-1 font-mono text-[11px]">
                            {rec?.status === 'present' ? (
                              <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold inline-flex items-center justify-center">
                                P
                              </span>
                            ) : rec?.status === 'half_day' ? (
                              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-800 font-bold inline-flex items-center justify-center">
                                H
                              </span>
                            ) : rec?.status === 'absent' ? (
                              <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-800 font-bold inline-flex items-center justify-center">
                                A
                              </span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 font-bold text-slate-900 bg-slate-50 font-mono">
                        {totalPresent + totalHalf * 0.5 || 24}d
                      </td>
                      <td className="px-3 py-2 font-bold text-blue-700 bg-slate-50 font-mono">
                        {totalOt}h
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: PENDING APPROVALS */}
      {activeTab === 'pending' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="font-bold text-xs uppercase tracking-wider text-slate-700">
              Shift Records Pending Review & Authorization
            </span>
            <span className="text-xs font-mono text-slate-500">
              {pendingList.length} logs awaiting signoff
            </span>
          </div>

          {pendingList.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {pendingList.map((rec) => {
                const op = employees.find((e) => e.id === rec.operatorId || e.employeeId === rec.operatorId);
                const prj = projects.find((p) => p.id === rec.projectId);
                return (
                  <div key={rec.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/50">
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-black text-sm">{op?.fullName}</strong>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent/15 text-accent">
                          {rec.date}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {prj?.name} • Machine: {rec.machineId || 'CR-001'} • Shift: {rec.startTime} to {rec.endTime}
                      </p>
                      <p className="text-xs text-zinc-700 font-mono mt-1">
                        Working: {rec.netWorkingHours}h | Overtime: <strong className="text-blue-700">{rec.overtimeHours}h</strong> @ ₹{rec.appliedOtRate}/hr
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          rejectAttendanceRecord(rec.id, 'Discrepancy in shift hours');
                          notifyFeedback(`Rejected attendance log for ${op?.fullName}.`);
                        }}
                        className="px-3.5 py-1.5 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-bold transition-colors"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => {
                          approveAttendanceRecord(rec.id);
                          generatePayrollForMonth(rec.date.slice(0, 7));
                          notifyFeedback(`Approved attendance log for ${op?.fullName}.`);
                        }}
                        className="px-4 py-1.5 rounded-xl bg-black hover:bg-zinc-800 text-accent text-xs font-bold transition-colors shadow-xs"
                      >
                        Approve Shift
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center text-zinc-400 text-xs space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto opacity-70" />
              <p className="font-bold text-black text-sm">All shift logs are verified and approved</p>
              <p className="text-zinc-500">All operator entries are currently in approved state for monthly payroll processing.</p>
            </div>
          )}
        </div>
      )}

      {/* DEDICATED MODAL: ADD DAY-WISE OVERTIME HOURS */}
      {showOtModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-zinc-300 w-full max-w-lg overflow-hidden animate-scaleIn">
            <div className="flex items-center justify-between px-6 py-4 bg-black text-white">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-accent" />
                <div>
                  <h3 className="font-extrabold text-sm tracking-tight">Add Operator Day-Wise Overtime</h3>
                  <p className="text-[11px] text-zinc-400">Recorded hours immediately reflect in accurate monthly payslips</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOtModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveDayWiseOt} className="p-6 space-y-4 text-xs">
              {/* Operator Selector */}
              <div>
                <label className="block font-bold text-zinc-700 mb-1">Select Crane Operator:</label>
                <select
                  value={otOperatorId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    setOtOperatorId(newId);
                    const op = employees.find((x) => x.id === newId || x.employeeId === newId);
                    if (op?.currentProjectId) {
                      setOtProjectId(op.currentProjectId);
                      const p = projects.find((x) => x.id === op.currentProjectId);
                      if (p) setOtRate(p.overtimeRate);
                    }
                  }}
                  required
                  className="w-full px-3 py-2 border border-zinc-300 rounded-xl font-bold bg-zinc-50 focus:ring-2 focus:ring-accent focus:outline-none"
                >
                  {activeOperators.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.fullName} ({op.employeeId}) • ₹{op.dailyRate}/day
                    </option>
                  ))}
                </select>
              </div>

              {/* Date & Overtime Hours */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-zinc-700 mb-1">Date of Work:</label>
                  <input
                    type="date"
                    value={otDate}
                    onChange={(e) => setOtDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-zinc-300 rounded-xl font-bold bg-zinc-50 focus:ring-2 focus:ring-accent"
                  />
                </div>

                <div>
                  <label className="block font-bold text-zinc-700 mb-1">Overtime Hours (OT):</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max="14"
                      value={otHours}
                      onChange={(e) => setOtHours(parseFloat(e.target.value) || 0)}
                      required
                      placeholder="e.g. 2.5"
                      className="w-full px-3 py-2 border border-zinc-300 rounded-xl font-mono font-bold focus:ring-2 focus:ring-accent"
                    />
                    <span className="absolute right-3 top-2 font-mono text-zinc-400">Hrs</span>
                  </div>
                </div>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-zinc-500">Quick Hours:</span>
                {[1, 1.5, 2, 2.5, 3, 4, 5].map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setOtHours(h)}
                    className={`px-2 py-0.5 rounded-lg text-xs font-bold font-mono transition-colors ${
                      otHours === h
                        ? 'bg-black text-accent'
                        : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                    }`}
                  >
                    {h}h
                  </button>
                ))}
              </div>

              {/* Project & Hourly OT Rate */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-zinc-700 mb-1">Project Site:</label>
                  <select
                    value={otProjectId}
                    onChange={(e) => {
                      const pId = e.target.value;
                      setOtProjectId(pId);
                      const prj = projects.find((p) => p.id === pId);
                      if (prj) setOtRate(prj.overtimeRate);
                    }}
                    required
                    className="w-full px-3 py-2 border border-zinc-300 rounded-xl font-bold bg-zinc-50 focus:ring-2 focus:ring-accent"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-zinc-700 mb-1">Hourly Overtime Rate:</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 font-bold text-zinc-500">₹</span>
                    <input
                      type="number"
                      step="10"
                      min="50"
                      value={otRate}
                      onChange={(e) => setOtRate(parseInt(e.target.value, 10) || 0)}
                      required
                      className="w-full pl-7 pr-3 py-2 border border-zinc-300 rounded-xl font-mono font-bold focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>
              </div>

              {/* Live Accurate Payslip Calculation Breakdown */}
              <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 space-y-1.5 font-mono">
                <div className="flex justify-between text-zinc-600">
                  <span>Day-Wise Overtime Log:</span>
                  <strong>{otHours} Hours on {formatDateDDMMYYYY(otDate)}</strong>
                </div>
                <div className="flex justify-between text-zinc-600">
                  <span>Site OT Rate Applied:</span>
                  <span>₹{otRate} / hour</span>
                </div>
                <div className="flex justify-between text-emerald-700 font-bold text-sm border-t border-zinc-200 pt-1.5">
                  <span>Overtime Earnings:</span>
                  <span>{formatINR(Math.round(otHours * otRate))}</span>
                </div>
              </div>

              {/* Scope & Remarks */}
              <div>
                <label className="block font-bold text-zinc-700 mb-1">Work Description / Site Notes:</label>
                <input
                  type="text"
                  placeholder="e.g. Night girder erection overtime, extended beam placement"
                  value={otRemarks}
                  onChange={(e) => setOtRemarks(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-xl font-medium focus:ring-2 focus:ring-accent"
                />
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-zinc-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowOtModal(false)}
                  className="px-4 py-2 rounded-xl text-zinc-600 hover:bg-zinc-100 font-bold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-black hover:bg-zinc-800 text-white font-bold transition-colors shadow-xs flex items-center gap-1.5"
                >
                  <Clock className="w-4 h-4 text-accent" />
                  <span>Save Overtime & Update Payslip</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LEGACY DETAILED MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 bg-black text-white">
              <div className="flex items-center gap-2">
                <CalendarCheck className="w-5 h-5 text-accent" />
                <h3 className="font-extrabold text-sm">Detailed Daily Shift Log</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveDetailedAttendance} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Operator:</label>
                  <select
                    value={operatorId}
                    onChange={(e) => setOperatorId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {activeOperators.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName} ({e.employeeId})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Project Site:</label>
                  <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (OT: ₹{p.overtimeRate}/h)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Machine / Crane:</label>
                  <select
                    value={machineId}
                    onChange={(e) => setMachineId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {machines.map((m) => (
                      <option key={m.id} value={m.assetId}>
                        {m.assetId} - {m.model} ({m.tonnageCapacity}T)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Attendance Status:</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-bold"
                  >
                    <option value="present">Present (Standard Shift)</option>
                    <option value="half_day">Half Day (under 5h)</option>
                    <option value="absent">Absent</option>
                    <option value="weekly_off">Weekly Off</option>
                    <option value="paid_leave">Paid Leave</option>
                    <option value="holiday">Official Holiday</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Start Time:</label>
                  <input
                    type="time"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">End Time:</label>
                  <input
                    type="time"
                    required
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Unpaid Break (m):</label>
                  <input
                    type="number"
                    value={breakMin}
                    onChange={(e) => setBreakMin(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Real-time Calculation Breakdown Box */}
              <div className="p-3 rounded-lg bg-accent-50 border border-accent-200 text-ink-950 space-y-1 font-mono">
                <div className="flex justify-between">
                  <span>Net Working Duration:</span>
                  <strong>{durationPreview.netWorkingHours} Hours</strong>
                </div>
                <div className="flex justify-between">
                  <span>Standard Shift Allowance:</span>
                  <span>10 Hours</span>
                </div>
                <div className="flex justify-between text-accent-700 font-bold">
                  <span>Calculated Overtime:</span>
                  <span>{durationPreview.potentialOtHours} Hours</span>
                </div>
                <div className="flex justify-between text-success-700 font-bold border-t border-accent-200 pt-1">
                  <span>OT Earnings (@ ₹{detailedOtRate}/hr):</span>
                  <span>{formatINR(otEarnings)}</span>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Remarks:</label>
                <input
                  type="text"
                  placeholder="e.g. Night shift girder launch, double boom assist"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 font-bold text-white bg-black hover:bg-zinc-800 rounded-xl shadow-xs"
                >
                  Save Attendance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
