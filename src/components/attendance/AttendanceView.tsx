import React, { useRef, useState } from 'react';
import {
  CalendarCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Plus,
  Search,
  Filter,
  FileSpreadsheet,
  AlertCircle,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  X,
  Lock,
} from 'lucide-react';
import { useSkyhook } from '../../data/apiStore';
import { ShiftToggle, shiftTimes, type Shift } from '../common/ShiftToggle';
import {
  formatINR,
  formatDateDDMMYYYY,
  calculateWorkingAndOt,
} from '../../utils/calculations';
import { AttendanceRecord, AttendanceStatus } from '../../types';
import { DateInput } from '../common/DateInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Current device time as HH:mm (the system clock, not a constant). */
const nowHHmm = () => {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** HH:mm plus a number of hours, wrapping past midnight (night shifts end the next morning). */
const addHoursToTime = (time: string, hours: number) => {
  const [h, m] = time.split(':').map(Number);
  const total = (h || 0) * 60 + (m || 0) + Math.round(hours * 60);
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
};

const hhmm = (t?: string) => (t ? t.slice(0, 5) : '');

const daysInMonthOf = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();

const statusLabel = (s: AttendanceStatus) => s.replace(/_/g, ' ');

const approvalBadge = (a: AttendanceRecord['approvalStatus']) =>
  a === 'approved'
    ? { text: 'Approved', cls: 'badge-success' }
    : a === 'rejected'
    ? { text: 'Rejected', cls: 'badge-danger' }
    : { text: 'Pending approval', cls: 'badge-warning' };

export const AttendanceView: React.FC = () => {
  const {
    currentUser,
    currentDate,
    companySettings,
    attendance,
    employees,
    projects,
    machines,
    addAttendanceRecord,
    bulkAddAttendance,
    approveAttendanceRecord,
    rejectAttendanceRecord,
    addOrUpdateOvertimeHours,
    generatePayrollForMonth,
  } = useSkyhook();

  const shiftHours = companySettings.standardShiftHours || 10;
  const canApprove = currentUser.role === 'owner' || currentUser.role === 'manager';

  const [activeTab, setActiveTab] = useState<'daily' | 'monthly' | 'pending'>('daily');
  const [selectedDate, setSelectedDate] = useState(currentDate);
  const [selectedMonth, setSelectedMonth] = useState(currentDate.slice(0, 7));
  const [selectedProject, setSelectedProject] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  // Rows with a save in flight, so a double click cannot submit the same change twice.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [modalError, setModalError] = useState('');

  // Day-Wise Overtime Modal State
  const [showOtModal, setShowOtModal] = useState(false);
  const [otOperatorId, setOtOperatorId] = useState('');
  const [otDate, setOtDate] = useState(selectedDate);
  const [otHours, setOtHours] = useState<number>(2);
  const [otProjectId, setOtProjectId] = useState('');
  const [otRate, setOtRate] = useState<number>(0);
  const [otRemarks, setOtRemarks] = useState('');

  // Detailed Shift Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [operatorId, setOperatorId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [shift, setShift] = useState<Shift>('day');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('18:00');
  const [breakMin, setBreakMin] = useState(0);
  const [status, setStatus] = useState<AttendanceStatus>('present');
  const [remarks, setRemarks] = useState('');

  const activeOperators = employees.filter(
    (e) => e.employeeType === 'operator' && e.status === 'active'
  );

  // Dynamic preview for daily modal
  const durationPreview = calculateWorkingAndOt(startTime, endTime, breakMin, Math.round(shiftHours * 60));
  const currentPrj = projects.find((p) => p.id === projectId);
  const detailedOtRate = currentPrj?.overtimeRate ?? 0;
  const otEarnings = Math.round(durationPreview.potentialOtHours * detailedOtRate);

  const pendingList = attendance.filter((a) => a.approvalStatus === 'submitted');

  // Feedback banner: green on success, red on failure.
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifyFeedback = (text: string, kind: 'ok' | 'error' = 'ok') => {
    setFeedback({ text, kind });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), kind === 'error' ? 9000 : 3200);
  };

  /**
   * Run one save: ignore repeat clicks on the same row, report what really happened, and
   * refresh the month's payroll afterwards. `inModal` shows a failure inside the open dialog,
   * where the page banner would be hidden behind the overlay.
   */
  const runAction = async (
    key: string,
    action: () => Promise<string>,
    payrollMonth?: string,
    inModal = false,
  ) => {
    if (pending.has(key)) return;
    setPending((prev) => new Set(prev).add(key));
    try {
      const message = await action();
      notifyFeedback(message);
      // Best effort: a locked or empty payroll month, or a role without payroll rights,
      // must not make a saved attendance look failed.
      if (payrollMonth && currentUser.role === 'owner') void generatePayrollForMonth(payrollMonth).catch(() => undefined);
    } catch (e) {
      const text = e instanceof Error && e.message ? e.message : 'Could not save. Please try again.';
      if (inModal) setModalError(text);
      else notifyFeedback(text, 'error');
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const findOperator = (ref: string) => employees.find((e) => e.id === ref || e.employeeId === ref);
  const recordFor = (op: { id: string; employeeId: string }, date: string) =>
    attendance.find((a) => (a.operatorId === op.id || a.operatorId === op.employeeId) && a.date === date);
  const machineLabel = (id?: string) => machines.find((m) => m.id === id)?.assetId ?? 'Not assigned';

  // Date stepper handlers (UTC arithmetic so the day never shifts with the browser timezone)
  const handleStepDay = (delta: number) => {
    const current = new Date(`${selectedDate}T00:00:00Z`);
    current.setUTCDate(current.getUTCDate() + delta);
    const nextDate = current.toISOString().slice(0, 10);
    setSelectedDate(nextDate);
    setOtDate(nextDate);
  };

  const handleSetToday = () => {
    setSelectedDate(currentDate);
    setOtDate(currentDate);
  };

  /**
   * Check-in / check-out for a quick mark. Today: check-in is the device clock; other days start
   * at 08:00. Check-out is check-in plus the company shift (half of it for a half day) plus overtime.
   */
  const quickTimes = (date: string, target: AttendanceStatus, overtime: number) => {
    const base = target === 'present' ? shiftHours : target === 'half_day' ? shiftHours / 2 : 0;
    const start = date === currentDate && target !== 'absent' ? nowHHmm() : '08:00';
    return { startTime: start, endTime: addHoursToTime(start, base + overtime) };
  };

  const saveQuick = (
    opId: string,
    date: string,
    target: AttendanceStatus,
    overtime: number,
    existing?: AttendanceRecord,
    projectOverride?: string,
  ) => {
    const op = findOperator(opId);
    const t = quickTimes(date, target, overtime);
    return addAttendanceRecord({
      operatorId: opId,
      date,
      projectId: projectOverride ?? existing?.projectId ?? op?.currentProjectId,
      machineId: existing?.machineId ?? op?.currentMachineId,
      startTime: t.startTime,
      endTime: t.endTime,
      unpaidBreakMinutes: 0,
      status: target,
      remarks: overtime ? `${overtime}h OT` : 'Quick attendance',
    });
  };

  // Quick Attendance Handler
  const handleQuickStatus = (opId: string, targetStatus: AttendanceStatus, customOt?: number) => {
    const op = findOperator(opId);
    const label = targetStatus === 'present' ? 'PRESENT' : targetStatus === 'absent' ? 'ABSENT' : 'HALF DAY';
    const existing = op ? recordFor(op, selectedDate) : undefined;
    return runAction(
      opId,
      async () => {
        const ot = targetStatus === 'absent' ? 0 : Math.max(0, Number(customOt) || 0);
        const saved = await saveQuick(opId, selectedDate, targetStatus, ot, existing);
        const when = targetStatus !== 'absent' ? ` (check-in ${hhmm(saved.startTime)})` : '';
        return `Marked ${op?.fullName || opId} as ${label} for ${formatDateDDMMYYYY(selectedDate)}${when}.`;
      },
      undefined,
    );
  };

  // Inline Overtime change
  const handleInlineOtChange = (opId: string, newOtHours: number) => {
    const validHours = Math.max(0, Number(newOtHours) || 0);
    const op = findOperator(opId);
    const existing = op ? recordFor(op, selectedDate) : undefined;
    const marked = existing && (existing.status === 'present' || existing.status === 'half_day');
    // Nothing to change for a day that is not marked and gets no overtime.
    if (!marked && validHours === 0) return Promise.resolve();
    return runAction(
      opId,
      async () => {
        if (marked) {
          // Keeps the recorded check-in; only the check-out moves with the overtime.
          await addOrUpdateOvertimeHours({
            operatorId: opId,
            date: selectedDate,
            overtimeHours: validHours,
            projectId: existing?.projectId ?? op?.currentProjectId,
            remarks: validHours > 0 ? `Inline logged ${validHours}h OT` : undefined,
          });
        } else {
          await saveQuick(opId, selectedDate, 'present', validHours, existing);
        }
        return `Updated overtime: ${validHours} hrs for ${op?.fullName || opId}. Pending approval for payroll.`;
      },
      undefined,
    );
  };

  // Mark all present: leaves anyone already marked for the day untouched, and says who failed.
  const handleMarkAllPresent = () =>
    runAction(
      'all',
      async () => {
        const todo = activeOperators.filter((op) => !recordFor(op, selectedDate));
        const skipped = activeOperators.length - todo.length;
        const summary = [`${todo.length} marked present`];
        if (skipped) summary.push(`${skipped} already marked (left unchanged)`);
        if (todo.length) {
          // One batch, so the app reloads its data once instead of once per operator.
          const t = quickTimes(selectedDate, 'present', 0);
          const rows = todo.map((op) => ({
            operatorId: op.id,
            date: selectedDate,
            projectId: op.currentProjectId,
            machineId: op.currentMachineId,
            startTime: t.startTime,
            endTime: t.endTime,
            unpaidBreakMinutes: 0,
            status: 'present',
            remarks: 'Marked present via Quick Attendance bulk action',
          }));
          try {
            await bulkAddAttendance(rows as unknown as AttendanceRecord[]);
          } catch (e) {
            const why = e instanceof Error ? e.message : 'Request failed';
            throw new Error(`Could not mark everyone present: ${why}`);
          }
        }
        return `${summary.join(', ')} for ${formatDateDDMMYYYY(selectedDate)}.`;
      },
      undefined,
    );

  // Open Overtime Modal for specific operator
  const handleOpenOtModal = (opId?: string) => {
    const targetOpId = opId || activeOperators[0]?.id || '';
    const op = findOperator(targetOpId);
    const prjId = op?.currentProjectId || projects[0]?.id || '';
    const prj = projects.find((p) => p.id === prjId);

    setOtOperatorId(targetOpId);
    setOtDate(selectedDate);
    setOtProjectId(prjId);
    setOtRate(prj?.overtimeRate ?? 0);
    setOtHours(2);
    setOtRemarks('');
    setModalError('');
    setShowOtModal(true);
  };

  // Save Day-Wise Overtime Modal
  const handleSaveDayWiseOt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!otOperatorId) return;
    const op = findOperator(otOperatorId);
    return runAction(
      `ot:${otOperatorId}`,
      async () => {
        await addOrUpdateOvertimeHours({
          operatorId: otOperatorId,
          date: otDate,
          overtimeHours: Number(otHours) || 0,
          projectId: otProjectId,
          remarks: otRemarks.trim() || undefined,
        });
        setShowOtModal(false);
        return `Overtime of ${otHours}h recorded for ${op?.fullName || otOperatorId} on ${formatDateDDMMYYYY(otDate)}.`;
      },
      undefined,
      true,
    );
  };

  const pickShift = (kind: Shift) => {
    setShift(kind);
    if (kind !== 'custom') {
      const t = shiftTimes(kind, shiftHours);
      setStartTime(t.start);
      setEndTime(t.end);
    }
  };

  /** Today starts at the device clock (end = start + shift); other dates start from the Day preset. */
  const applyDefaultTimes = () => {
    if (selectedDate === currentDate) {
      const start = nowHHmm();
      setShift('custom');
      setStartTime(start);
      setEndTime(addHoursToTime(start, shiftHours));
    } else {
      pickShift('day');
    }
  };

  const pickOperator = (opId: string) => {
    const op = activeOperators.find((o) => o.id === opId) ?? activeOperators[0];
    setOperatorId(op?.id ?? '');
    setProjectId(op?.currentProjectId ?? projects[0]?.id ?? '');
    setMachineId(op?.currentMachineId ?? '');
  };

  /** Pre-fill the detailed shift form from live data and the system clock. */
  const openDetailedModal = (opId?: string) => {
    pickOperator(opId ?? '');
    setModalError('');
    setBreakMin(0);
    setStatus('present');
    applyDefaultTimes();
    setShowAddModal(true);
  };

  const handleSaveDetailedAttendance = (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorId) {
      setModalError('Choose an operator first.');
      return;
    }
    return runAction(
      `detail:${operatorId}`,
      async () => {
        await addAttendanceRecord({
          date: selectedDate,
          operatorId,
          projectId,
          machineId: machineId || undefined,
          startTime,
          endTime,
          unpaidBreakMinutes: Number(breakMin) || 0,
          status,
          remarks,
        });
        setShowAddModal(false);
        setRemarks('');
        return `Saved shift log for ${formatDateDDMMYYYY(selectedDate)}.`;
      },
      undefined,
      true,
    );
  };

  const handleApprove = (rec: AttendanceRecord) =>
    runAction(
      `approve:${rec.id}`,
      async () => {
        await approveAttendanceRecord(rec.id);
        return `Approved attendance for ${findOperator(rec.operatorId)?.fullName ?? 'operator'}.`;
      },
      rec.date.slice(0, 7),
    );

  const handleReject = (rec: AttendanceRecord) =>
    runAction(`reject:${rec.id}`, async () => {
      await rejectAttendanceRecord(rec.id, 'Discrepancy in shift hours');
      return `Rejected attendance for ${findOperator(rec.operatorId)?.fullName ?? 'operator'}. It returns to pending once re-entered.`;
    });

  const handleApproveAll = () =>
    runAction(
      'approve-all',
      async () => {
        let done = 0;
        const months = new Set<string>();
        for (const rec of pendingList) {
          try {
            await approveAttendanceRecord(rec.id);
            done += 1;
            months.add(rec.date.slice(0, 7));
          } catch (e) {
            throw new Error(`${done} approved, then failed: ${e instanceof Error ? e.message : 'Request failed'}`);
          }
        }
        if (currentUser.role === 'owner') months.forEach((m) => void generatePayrollForMonth(m).catch(() => undefined));
        return `Approved ${done} attendance record${done === 1 ? '' : 's'}.`;
      },
    );

  // Last 12 months for the monthly view, counted back from today.
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Number(currentDate.slice(0, 4)), Number(currentDate.slice(5, 7)) - 1 - i, 1);
    return {
      value: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`,
      label: d.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
    };
  });

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

  // Operators shown in the quick sheet follow the search box and the project filter.
  const visibleOperators = activeOperators.filter((op) => {
    const rec = recordFor(op, selectedDate);
    const matchSearch =
      !searchTerm ||
      op.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      op.employeeId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchProject = selectedProject === 'all' || (rec?.projectId ?? op.currentProjectId) === selectedProject;
    return matchSearch && matchProject;
  });

  // Day stats
  const dateRecords = attendance.filter((a) => a.date === selectedDate);
  const presentCount = dateRecords.filter((a) => a.status === 'present').length;
  const absentCount = dateRecords.filter((a) => a.status === 'absent').length;
  const halfDayCount = dateRecords.filter((a) => a.status === 'half_day').length;
  const totalDayOtHours = dateRecords.reduce((sum, a) => sum + (a.overtimeHours || 0), 0);
  const totalDayOtPay = dateRecords.reduce((sum, a) => sum + (a.overtimeHours || 0) * (a.appliedOtRate || 0), 0);

  // Monthly spreadsheet matrix: the real number of days in the chosen month
  const monthDayCount = daysInMonthOf(selectedMonth);
  const monthDates = Array.from({ length: monthDayCount }, (_, i) => `${selectedMonth}-${pad2(i + 1)}`);

  /* ------------------------------------------------------------------ */
  /* Shared pieces of the daily sheet (used by both the table and cards) */
  /* ------------------------------------------------------------------ */

  const statusButtons = (opId: string, current: AttendanceStatus | undefined, ot: number, busy: boolean) => {
    const base =
      'min-h-11 lg:min-h-0 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all disabled:opacity-60';
    return (
      <div className="grid grid-cols-3 gap-1.5 lg:inline-flex p-1 rounded-xl bg-zinc-100 border border-zinc-200">
        <button
          type="button"
          onClick={() => handleQuickStatus(opId, 'present', ot)}
          disabled={busy}
          aria-pressed={current === 'present'}
          className={`${base} ${
            current === 'present'
              ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-400'
              : 'bg-white text-zinc-700 hover:bg-emerald-50 hover:text-emerald-700'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Present</span>
        </button>
        <button
          type="button"
          onClick={() => handleQuickStatus(opId, 'absent', 0)}
          disabled={busy}
          aria-pressed={current === 'absent'}
          className={`${base} ${
            current === 'absent'
              ? 'bg-rose-600 text-white shadow-xs ring-2 ring-rose-400'
              : 'bg-white text-zinc-700 hover:bg-rose-50 hover:text-rose-700'
          }`}
        >
          <XCircle className="w-3.5 h-3.5" />
          <span>Absent</span>
        </button>
        <button
          type="button"
          onClick={() => handleQuickStatus(opId, 'half_day', ot)}
          disabled={busy}
          aria-pressed={current === 'half_day'}
          className={`${base} ${
            current === 'half_day'
              ? 'bg-amber-500 text-white shadow-xs ring-2 ring-amber-400'
              : 'bg-white text-zinc-700 hover:bg-amber-50 hover:text-amber-700'
          }`}
        >
          <span>Half</span>
        </button>
      </div>
    );
  };

  const statusCaption = (rec?: AttendanceRecord) => {
    const s = rec?.status;
    return (
      <div className="mt-1.5 text-[11px] font-mono leading-snug">
        {s === 'present' && (
          <span className="text-emerald-700 font-bold">{shiftHours}h Standard Working</span>
        )}
        {s === 'absent' && <span className="text-rose-700 font-bold">0h (No wage payable)</span>}
        {s === 'half_day' && (
          <span className="text-amber-700 font-bold">{shiftHours / 2}h (0.5 Payable Day)</span>
        )}
        {!s && <span className="text-zinc-400 italic">Not marked yet</span>}
        {rec && (s === 'present' || s === 'half_day') && (
          <span className="block text-ink-700 font-bold">
            In {hhmm(rec.startTime)} &rarr; Out {hhmm(rec.endTime)}
          </span>
        )}
      </div>
    );
  };

  const otStepper = (opId: string, ot: number, rate: number, busy: boolean) => (
    <div className="inline-flex flex-col items-stretch lg:items-center gap-1.5">
      <div className="flex items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={() => handleInlineOtChange(opId, Math.max(0, ot - 1))}
          disabled={busy}
          title="Decrease 1 Hour OT"
          aria-label="Decrease overtime by 1 hour"
          className="w-11 h-11 lg:w-8 lg:h-8 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-700 font-bold text-base lg:text-xs flex items-center justify-center transition-colors disabled:opacity-60"
        >
          -
        </button>
        <div className="relative">
          <input
            type="number"
            min="0"
            max="13"
            step="0.5"
            value={ot}
            disabled={busy}
            aria-label="Overtime hours"
            onChange={(e) => handleInlineOtChange(opId, parseFloat(e.target.value) || 0)}
            className="w-20 lg:w-16 min-h-11 lg:min-h-0 px-2 py-1 text-center text-sm lg:text-xs font-mono font-bold bg-zinc-50 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <button
          type="button"
          onClick={() => handleInlineOtChange(opId, ot + 1)}
          disabled={busy}
          title="Increase 1 Hour OT"
          aria-label="Increase overtime by 1 hour"
          className="w-11 h-11 lg:w-8 lg:h-8 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-700 font-bold text-base lg:text-xs flex items-center justify-center transition-colors disabled:opacity-60"
        >
          +
        </button>
      </div>
      <div className="flex items-center justify-center gap-1.5">
        {[1, 2, 3, 4].map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => handleInlineOtChange(opId, h)}
            disabled={busy}
            className={`min-h-10 lg:min-h-0 px-2.5 lg:px-1.5 py-0.5 rounded text-xs lg:text-[10px] font-bold font-mono transition-colors disabled:opacity-60 ${
              ot === h ? 'bg-logo-700 text-logo-50' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            {h}h
          </button>
        ))}
      </div>
      {ot > 0 ? (
        <span className="text-[11px] lg:text-[10px] font-bold text-emerald-700 font-mono text-center">
          +{formatINR(Math.round(ot * rate))} OT Pay ({ot}h @ ₹{rate})
        </span>
      ) : (
        <span className="text-[11px] lg:text-[10px] text-zinc-400 font-mono text-center">0h OT</span>
      )}
    </div>
  );

  const shiftTotal = (rec?: AttendanceRecord) => {
    const s = rec?.status;
    const ot = rec?.overtimeHours || 0;
    if (s === 'present')
      return (
        <div>
          <span className="font-extrabold text-logo-900 text-xs">{shiftHours + ot}h Total</span>
          <span className="text-[10px] text-zinc-500 block">({shiftHours}h Std + {ot}h OT)</span>
        </div>
      );
    if (s === 'half_day')
      return (
        <div>
          <span className="font-extrabold text-amber-700 text-xs">{shiftHours / 2 + ot}h Total</span>
          <span className="text-[10px] text-zinc-500 block">({shiftHours / 2}h Half + {ot}h OT)</span>
        </div>
      );
    if (s === 'absent') return <span className="text-rose-600 font-bold text-xs">0 Hours</span>;
    return <span className="text-zinc-400">-</span>;
  };

  const lockedNote = (rec?: AttendanceRecord) =>
    rec?.approvalStatus === 'approved' ? (
      <p className="mt-1 text-[11px] text-ink-500 flex items-center gap-1">
        <Lock className="w-3 h-3" /> Approved &ndash; locked for payroll
      </p>
    ) : null;

  return (
    <div className="space-y-4 sm:space-y-6 pb-12">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-accent bg-accent/10 px-2 py-0.5 rounded border border-accent/20">
              Workforce Operations
            </span>
            <span className="text-xs text-zinc-500 font-medium">Standard {shiftHours}h Daily Shift</span>
          </div>
          <h2 className="page-title">Operator Attendance & Overtime Register</h2>
          <p className="page-subtitle">
            One-tap Present / Absent / Half marking on the device clock, day-wise overtime, and instant payslip sync.
          </p>
        </div>

        <div className="page-header-actions">
          <button onClick={handleMarkAllPresent} disabled={pending.has('all')} className="btn btn-primary">
            <CheckCircle2 className="w-4 h-4" />
            <span>{pending.has('all') ? 'Marking…' : 'Mark All Present'}</span>
          </button>
          <button onClick={() => handleOpenOtModal()} className="btn btn-secondary">
            <Clock className="w-4 h-4" />
            <span>Add Day-Wise Overtime</span>
          </button>
          <button onClick={() => openDetailedModal()} className="btn btn-secondary">
            <Plus className="w-4 h-4" />
            <span>Detailed Shift</span>
          </button>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={`sticky top-2 z-30 p-3 rounded-xl text-white text-xs font-bold flex items-start justify-between gap-3 shadow-lg border animate-fadeIn ${
            feedback.kind === 'error' ? 'bg-rose-700 border-rose-900' : 'bg-logo-700 border-zinc-800'
          }`}
        >
          <div className="flex items-start gap-2 min-w-0">
            {feedback.kind === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-accent" />
            )}
            <span className="break-words">{feedback.text}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="shrink-0 text-zinc-200 hover:text-white"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="tab-bar overflow-x-auto" role="tablist">
        {(
          [
            ['daily', UserCheck, 'Daily', 'Quick Attendance Sheet'],
            ['monthly', FileSpreadsheet, 'Monthly', 'Monthly Spreadsheet Matrix'],
            ['pending', null, 'Pending', 'Pending Approvals'],
          ] as const
        ).map(([id, Icon, short, long]) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => setActiveTab(id)}
            className={`tab flex-1 sm:flex-none whitespace-nowrap inline-flex items-center justify-center gap-2 min-h-11 sm:min-h-0 ${
              activeTab === id ? 'tab-active' : ''
            }`}
          >
            {Icon && <Icon className="w-4 h-4" />}
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{long}</span>
            {id === 'pending' && pendingList.length > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-black rounded-full bg-accent text-white">
                {pendingList.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* TAB 1: QUICK ATTENDANCE SHEET */}
      {activeTab === 'daily' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="filter-bar">
            <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
              <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-200 rounded-xl p-1 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => handleStepDay(-1)}
                  title="Previous Day"
                  aria-label="Previous day"
                  className="w-11 h-11 sm:w-9 sm:h-9 shrink-0 flex items-center justify-center rounded-lg hover:bg-zinc-200 text-zinc-600 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex-1 min-w-0 sm:w-40 font-mono">
                  <DateInput
                    value={selectedDate}
                    onChange={(e) => {
                      setSelectedDate(e.target.value);
                      setOtDate(e.target.value);
                    }}
                    className="w-full bg-transparent font-bold text-logo-900 focus:outline-none cursor-pointer"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleStepDay(1)}
                  title="Next Day"
                  aria-label="Next day"
                  className="w-11 h-11 sm:w-9 sm:h-9 shrink-0 flex items-center justify-center rounded-lg hover:bg-zinc-200 text-zinc-600 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleSetToday}
                className={`btn ${selectedDate === currentDate ? 'btn-primary' : 'btn-secondary'}`}
              >
                Today
              </button>

              <div className="flex items-center gap-1.5 flex-1 min-w-[10rem]">
                <Filter className="w-4 h-4 text-zinc-400 shrink-0" />
                <Select value={selectedProject} onValueChange={setSelectedProject}>
                  <SelectTrigger aria-label="Filter by project" className="form-input min-w-0">
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

            <div className="search-box w-full sm:w-72">
              <Search className="w-4 h-4" />
              <input
                type="text"
                placeholder="Search operator..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="form-input"
              />
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="stat-card">
              <span className="stat-label">Active Operators</span>
              <div className="stat-value">{activeOperators.length}</div>
            </div>
            <div className="stat-card">
              <span className="stat-label text-emerald-700">Marked Present</span>
              <div className="stat-value text-emerald-700">{presentCount}</div>
            </div>
            <div className="stat-card">
              <span className="stat-label text-amber-700">Half Day</span>
              <div className="stat-value text-amber-700">{halfDayCount}</div>
            </div>
            <div className="stat-card">
              <span className="stat-label text-rose-700">Marked Absent</span>
              <div className="stat-value text-rose-700">{absentCount}</div>
            </div>
            <div className="stat-card col-span-2 lg:col-span-1">
              <span className="stat-label">{selectedDate === currentDate ? "Today's" : 'Day'} OT Hours</span>
              <div className="stat-value font-mono">
                {totalDayOtHours}h <span className="text-xs text-zinc-400 font-normal">({formatINR(totalDayOtPay)})</span>
              </div>
            </div>
          </div>

          {/* Quick sheet */}
          <div className="table-card">
            <div className="px-4 sm:px-5 py-4 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-zinc-50/50">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-extrabold text-sm text-logo-900">Daily Operator Attendance & Overtime</h3>
                <span className="text-xs font-bold text-accent bg-white px-2.5 py-0.5 rounded-full border border-zinc-200">
                  {formatDateDDMMYYYY(selectedDate)}
                </span>
              </div>
              <span className="text-xs text-zinc-500">
                Tap <strong>Present</strong>, <strong>Absent</strong> or <strong>Half</strong>.
                {selectedDate === currentDate && ' Check-in is the current device time.'}
              </span>
            </div>

            {/* Phones and small tablets: one card per operator */}
            <div className="lg:hidden divide-y divide-zinc-100">
              {visibleOperators.length === 0 && (
                <p className="p-6 text-center text-xs text-zinc-400">No operators match.</p>
              )}
              {visibleOperators.map((op) => {
                const rec = recordFor(op, selectedDate);
                const ot = rec?.overtimeHours || 0;
                const project = projects.find((p) => p.id === (rec?.projectId || op.currentProjectId));
                const rate = rec?.appliedOtRate || project?.overtimeRate || 0;
                const locked = rec?.approvalStatus === 'approved';
                const busy = pending.has(op.id) || locked;
                return (
                  <div key={op.id} className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-zinc-800 text-accent flex items-center justify-center font-bold text-sm shrink-0">
                        {op.fullName.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-logo-900 text-sm">{op.fullName}</div>
                        <div className="text-[11px] text-zinc-500 font-mono break-words">
                          {op.employeeId} • {op.mobile}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          <span className="capitalize">{op.designation}</span> (₹{op.dailyRate}/day)
                        </div>
                      </div>
                      {rec && (
                        <span className={`badge ${approvalBadge(rec.approvalStatus).cls} shrink-0`}>
                          {approvalBadge(rec.approvalStatus).text}
                        </span>
                      )}
                    </div>
                    <div className="text-xs">
                      <div className="font-semibold text-logo-900">{project?.name || 'Site Assignment'}</div>
                      <div className="text-[11px] text-zinc-500 font-mono">
                        Crane: <strong className="text-zinc-700">{machineLabel(rec?.machineId ?? op.currentMachineId)}</strong>
                        {' · '}OT ₹{rate}/hr
                      </div>
                    </div>
                    <div>
                      {statusButtons(op.id, rec?.status, ot, busy)}
                      {statusCaption(rec)}
                      {lockedNote(rec)}
                    </div>
                    <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-3">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Overtime</div>
                      {otStepper(op.id, ot, rate, busy)}
                      <button
                        type="button"
                        onClick={() => handleOpenOtModal(op.id)}
                        className="btn btn-secondary btn-sm w-full mt-3"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>Add OT with notes</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-logo-700 text-white font-semibold uppercase text-[11px] tracking-wider">
                  <tr>
                    <th className="px-4 py-3.5">Operator</th>
                    <th className="px-4 py-3.5">Assigned Project & Crane</th>
                    <th className="px-4 py-3.5 text-center">Quick Attendance</th>
                    <th className="px-4 py-3.5 text-center">Day-Wise Overtime (OT)</th>
                    <th className="px-4 py-3.5 text-center">Shift Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-zinc-800">
                  {visibleOperators.map((op) => {
                    const rec = recordFor(op, selectedDate);
                    const ot = rec?.overtimeHours || 0;
                    const project = projects.find((p) => p.id === (rec?.projectId || op.currentProjectId));
                    const rate = rec?.appliedOtRate || project?.overtimeRate || 0;
                    const locked = rec?.approvalStatus === 'approved';
                    const busy = pending.has(op.id) || locked;
                    return (
                      <tr key={op.id} className="hover:bg-zinc-50/80 transition-colors">
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-zinc-800 text-accent flex items-center justify-center font-bold text-xs shrink-0 border border-zinc-700">
                              {op.fullName.charAt(0)}
                            </div>
                            <div>
                              <div className="font-bold text-logo-900 text-sm">{op.fullName}</div>
                              <div className="text-[11px] text-zinc-500 font-mono">
                                {op.employeeId} • {op.mobile}
                              </div>
                              <div className="text-[10px] text-zinc-400 capitalize">
                                {op.designation} (₹{op.dailyRate}/day)
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-logo-900 max-w-xs truncate">
                            {project?.name || 'Site Assignment'}
                          </div>
                          <div className="text-[11px] text-zinc-500 font-mono">
                            Crane: <strong className="text-zinc-700">{machineLabel(rec?.machineId ?? op.currentMachineId)}</strong>
                          </div>
                          <div className="text-[10px] text-accent font-bold">OT Rate: ₹{rate}/hr</div>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {statusButtons(op.id, rec?.status, ot, busy)}
                          {statusCaption(rec)}
                          {lockedNote(rec)}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {otStepper(op.id, ot, rate, busy)}
                          <button
                            type="button"
                            onClick={() => handleOpenOtModal(op.id)}
                            className="btn btn-secondary btn-sm mt-1.5"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>Add OT with notes</span>
                          </button>
                        </td>
                        <td className="px-4 py-3.5 text-center font-mono">{shiftTotal(rec)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Audit log */}
          <div className="table-card">
            <div className="px-4 py-3 bg-zinc-100 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-1">
              <span className="font-bold text-xs text-zinc-700 uppercase tracking-wider">
                Shift Audit Log ({filteredDaily.length} {filteredDaily.length === 1 ? 'record' : 'records'})
              </span>
              <span className="text-[11px] text-zinc-500 font-mono">Date: {formatDateDDMMYYYY(selectedDate)}</span>
            </div>

            {filteredDaily.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-zinc-400">
                No attendance recorded for {formatDateDDMMYYYY(selectedDate)}. Use the quick buttons above to mark attendance in one tap.
              </p>
            )}

            {/* Cards on phones */}
            <div className="lg:hidden divide-y divide-slate-100">
              {filteredDaily.map((rec) => {
                const op = findOperator(rec.operatorId);
                const prj = projects.find((p) => p.id === rec.projectId);
                const ap = approvalBadge(rec.approvalStatus);
                return (
                  <div key={rec.id} className="p-4 space-y-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 text-sm">{op?.fullName || rec.operatorId}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{op?.employeeId}</div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                          rec.status === 'present'
                            ? 'bg-emerald-100 text-emerald-800'
                            : rec.status === 'half_day'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {statusLabel(rec.status)}
                      </span>
                    </div>
                    <div className="text-slate-600">{prj?.name || '-'}</div>
                    <div className="grid grid-cols-3 gap-2 font-mono">
                      <div>
                        <div className="text-[10px] uppercase text-slate-400">Check-in → out</div>
                        <div className="font-bold text-slate-800">
                          {hhmm(rec.startTime)} → {hhmm(rec.endTime)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-slate-400">Working</div>
                        <div className="font-bold text-slate-800">{rec.netWorkingHours}h</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-slate-400">Overtime</div>
                        <div className="font-bold text-blue-700">
                          {rec.overtimeHours > 0 ? `+${rec.overtimeHours}h` : '0h'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className={`badge ${ap.cls}`}>{ap.text}</span>
                      {canApprove && rec.approvalStatus === 'submitted' && (
                        <button
                          onClick={() => handleApprove(rec)}
                          disabled={pending.has(`approve:${rec.id}`)}
                          className="btn btn-primary btn-sm"
                        >
                          Approve
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Table on larger screens */}
            {filteredDaily.length > 0 && (
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-800 text-white font-semibold uppercase text-[10px]">
                    <tr>
                      <th className="px-3.5 py-2.5">Operator</th>
                      <th className="px-3.5 py-2.5">Project & Crane</th>
                      <th className="px-3.5 py-2.5">Check-in → Check-out</th>
                      <th className="px-3.5 py-2.5 text-center">Net Working</th>
                      <th className="px-3.5 py-2.5 text-center">Overtime</th>
                      <th className="px-3.5 py-2.5">Applied OT Rate</th>
                      <th className="px-3.5 py-2.5 text-center">Status</th>
                      <th className="px-3.5 py-2.5 text-right">Approval</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {filteredDaily.map((rec) => {
                      const op = findOperator(rec.operatorId);
                      const prj = projects.find((p) => p.id === rec.projectId);
                      const ap = approvalBadge(rec.approvalStatus);
                      return (
                        <tr key={rec.id} className="hover:bg-slate-50/80">
                          <td className="px-3.5 py-2.5 font-semibold">
                            <div className="text-slate-900 font-bold">{op?.fullName || rec.operatorId}</div>
                            <div className="text-[10px] text-slate-500 font-mono">{op?.employeeId}</div>
                          </td>
                          <td className="px-3.5 py-2.5">
                            <div className="font-semibold text-slate-800">{prj?.name || rec.projectId}</div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              Crane: {machines.find((m) => m.id === rec.machineId)?.assetId || 'Site duty'}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                            {hhmm(rec.startTime)} &rarr; {hhmm(rec.endTime)}
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
                            <span className="font-semibold text-emerald-700">₹{rec.appliedOtRate} / hr</span>
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
                              {statusLabel(rec.status)}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-right">
                            {canApprove && rec.approvalStatus === 'submitted' ? (
                              <button
                                onClick={() => handleApprove(rec)}
                                disabled={pending.has(`approve:${rec.id}`)}
                                className="btn btn-primary btn-sm"
                              >
                                Approve
                              </button>
                            ) : (
                              <span className={`badge ${ap.cls}`}>{ap.text}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: MONTHLY MATRIX */}
      {activeTab === 'monthly' && (
        <div className="space-y-4">
          <div className="filter-bar">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <label className="text-xs font-bold text-slate-700 shrink-0" htmlFor="att-month">
                Select Month:
              </label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger id="att-month" className="form-input min-w-0">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
              <span className="flex items-center gap-1 font-bold text-emerald-700">
                <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> P: Present
              </span>
              <span className="flex items-center gap-1 font-bold text-amber-700">
                <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" /> H: Half Day
              </span>
              <span className="flex items-center gap-1 font-bold text-rose-700">
                <span className="w-3 h-3 rounded-full bg-rose-500 inline-block" /> A: Absent
              </span>
              <span className="flex items-center gap-1 font-bold text-zinc-500">
                <span className="w-3 h-3 rounded-full border-2 border-dashed border-zinc-400 inline-block" /> Awaiting approval
              </span>
            </div>
          </div>

          <div className="table-card">
            <table className="w-full text-center text-xs border-collapse">
              <thead className="bg-logo-700 text-white font-semibold">
                <tr>
                  <th className="px-3 py-2.5 text-left sticky left-0 bg-logo-700 z-10 min-w-[7.5rem] sm:min-w-[11rem]">
                    Operator
                  </th>
                  {monthDates.map((d) => (
                    <th key={d} className="px-1.5 py-2.5 font-mono text-[10px] min-w-7">
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
                      <td className="px-3 py-2 text-left font-bold text-slate-900 sticky left-0 bg-white z-10 border-r border-slate-100">
                        {op.fullName}
                      </td>
                      {monthDates.map((d) => {
                        const rec = recordFor(op, d);
                        const approved = rec?.approvalStatus === 'approved';
                        // Only approved days count towards pay, exactly as payroll does.
                        if (rec && approved) {
                          if (rec.status === 'present') totalPresent++;
                          if (rec.status === 'half_day') totalHalf++;
                          totalOt += rec.overtimeHours || 0;
                        }
                        const shown = rec && rec.approvalStatus !== 'rejected' ? rec : undefined;
                        const ring = approved ? '' : ' border-2 border-dashed border-zinc-400';
                        return (
                          <td key={d} className="p-1 font-mono text-[11px]">
                            {shown?.status === 'present' ? (
                              <span className={`w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold inline-flex items-center justify-center${ring}`}>
                                P
                              </span>
                            ) : shown?.status === 'half_day' ? (
                              <span className={`w-6 h-6 rounded-full bg-amber-100 text-amber-800 font-bold inline-flex items-center justify-center${ring}`}>
                                H
                              </span>
                            ) : shown?.status === 'absent' ? (
                              <span className={`w-6 h-6 rounded-full bg-rose-100 text-rose-800 font-bold inline-flex items-center justify-center${ring}`}>
                                A
                              </span>
                            ) : shown ? (
                              <span className={`w-6 h-6 rounded-full bg-zinc-100 text-zinc-700 font-bold inline-flex items-center justify-center${ring}`} title={statusLabel(shown.status)}>
                                {shown.status.charAt(0).toUpperCase()}
                              </span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 font-bold text-slate-900 bg-slate-50 font-mono whitespace-nowrap">
                        {totalPresent + totalHalf * 0.5}d
                      </td>
                      <td className="px-3 py-2 font-bold text-blue-700 bg-slate-50 font-mono whitespace-nowrap">
                        {totalOt}h
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-zinc-500">
            Payable days and OT count approved attendance only. Days with a dashed outline are waiting in Pending Approvals.
          </p>
        </div>
      )}

      {/* TAB 3: PENDING APPROVALS */}
      {activeTab === 'pending' && (
        <div className="table-card">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-bold text-xs uppercase tracking-wider text-slate-700 block">
                Shift Records Pending Review & Authorization
              </span>
              <span className="text-xs font-mono text-slate-500">{pendingList.length} logs awaiting signoff</span>
            </div>
            {canApprove && pendingList.length > 1 && (
              <button onClick={handleApproveAll} disabled={pending.has('approve-all')} className="btn btn-primary btn-sm">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{pending.has('approve-all') ? 'Approving…' : `Approve all ${pendingList.length}`}</span>
              </button>
            )}
          </div>

          {pendingList.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {pendingList.map((rec) => {
                const op = findOperator(rec.operatorId);
                const prj = projects.find((p) => p.id === rec.projectId);
                return (
                  <div key={rec.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-logo-900 text-sm">{op?.fullName}</strong>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent/15 text-accent">
                          {formatDateDDMMYYYY(rec.date)}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-zinc-100 text-zinc-700">
                          {statusLabel(rec.status)}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5 break-words">
                        {prj?.name} • Machine: {machineLabel(rec.machineId)} • Shift: {hhmm(rec.startTime)} to {hhmm(rec.endTime)}
                      </p>
                      <p className="text-xs text-zinc-700 font-mono mt-1">
                        Working: {rec.netWorkingHours}h | Overtime: <strong className="text-blue-700">{rec.overtimeHours}h</strong> @ ₹{rec.appliedOtRate}/hr
                      </p>
                    </div>

                    {canApprove && (
                      <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleReject(rec)}
                          disabled={pending.has(`reject:${rec.id}`)}
                          className="btn btn-secondary text-rose-700 border-rose-300"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => handleApprove(rec)}
                          disabled={pending.has(`approve:${rec.id}`)}
                          className="btn btn-primary"
                        >
                          Approve
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center text-zinc-400 text-xs space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto opacity-70" />
              <p className="font-bold text-logo-900 text-sm">All shift logs are verified and approved</p>
              <p className="text-zinc-500">All operator entries are currently in approved state for monthly payroll processing.</p>
            </div>
          )}
        </div>
      )}

      {/* DAY-WISE OVERTIME MODAL */}
      {showOtModal && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <div className="flex items-center gap-2 min-w-0">
                <Clock className="w-5 h-5 text-accent shrink-0" />
                <div className="min-w-0">
                  <h3 className="modal-title">Add Operator Day-Wise Overtime</h3>
                  <p className="text-[11px] text-zinc-500">Hours flow straight into the monthly payslip</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowOtModal(false)} className="icon-btn" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form id="ot-form" onSubmit={handleSaveDayWiseOt} className="modal-body space-y-4 text-xs">
              {modalError && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="font-semibold">{modalError}</span>
                </div>
              )}
              <div>
                <label className="form-label">Crane operator</label>
                <Select
                  value={otOperatorId}
                  required
                  onValueChange={(newId) => {
                    setOtOperatorId(newId);
                    const op = findOperator(newId);
                    if (op?.currentProjectId) {
                      setOtProjectId(op.currentProjectId);
                      const p = projects.find((x) => x.id === op.currentProjectId);
                      if (p) setOtRate(p.overtimeRate);
                    }
                  }}
                >
                  <SelectTrigger className="form-input font-bold" aria-label="Crane operator">
                    <SelectValue placeholder="Select an operator" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeOperators.map((op) => (
                      <SelectItem key={op.id} value={op.id}>
                        {op.fullName} ({op.employeeId}) • ₹{op.dailyRate}/day
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="form-grid">
                <div>
                  <label className="form-label">Date of work</label>
                  <DateInput value={otDate} onChange={(e) => setOtDate(e.target.value)} required className="form-input font-bold" />
                </div>
                <div>
                  <label className="form-label">Overtime hours</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="13"
                    value={otHours}
                    onChange={(e) => setOtHours(parseFloat(e.target.value) || 0)}
                    required
                    placeholder="e.g. 2.5"
                    className="form-input font-mono font-bold"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold text-zinc-500">Quick hours:</span>
                {[1, 1.5, 2, 2.5, 3, 4, 5].map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setOtHours(h)}
                    className={`min-h-10 sm:min-h-0 px-3 sm:px-2 py-0.5 rounded-lg text-xs font-bold font-mono transition-colors ${
                      otHours === h ? 'bg-logo-700 text-logo-50' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                    }`}
                  >
                    {h}h
                  </button>
                ))}
              </div>

              <div className="form-grid">
                <div>
                  <label className="form-label">Project site</label>
                  <Select
                    value={otProjectId}
                    required
                    onValueChange={(pId) => {
                      setOtProjectId(pId);
                      const prj = projects.find((p) => p.id === pId);
                      if (prj) setOtRate(prj.overtimeRate);
                    }}
                  >
                    <SelectTrigger className="form-input font-bold" aria-label="Project site">
                      <SelectValue placeholder="Select a project" />
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
                  <label className="form-label">Hourly overtime rate (₹)</label>
                  <input
                    type="number"
                    step="10"
                    min="0"
                    value={otRate}
                    readOnly
                    title="The rate comes from the project and is applied by payroll"
                    className="form-input font-mono font-bold bg-zinc-50"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 space-y-1.5 font-mono">
                <div className="flex justify-between gap-3 text-zinc-600">
                  <span>Overtime log:</span>
                  <strong className="text-right">{otHours} h on {formatDateDDMMYYYY(otDate)}</strong>
                </div>
                <div className="flex justify-between gap-3 text-zinc-600">
                  <span>Site OT rate:</span>
                  <span>₹{otRate} / hour</span>
                </div>
                <div className="flex justify-between gap-3 text-emerald-700 font-bold text-sm border-t border-zinc-200 pt-1.5">
                  <span>Overtime earnings:</span>
                  <span>{formatINR(Math.round(otHours * otRate))}</span>
                </div>
              </div>

              <div>
                <label className="form-label">Work description / site notes</label>
                <input
                  type="text"
                  placeholder="Optional note"
                  value={otRemarks}
                  onChange={(e) => setOtRemarks(e.target.value)}
                  className="form-input"
                />
              </div>
            </form>

            <div className="modal-footer">
              <button type="button" onClick={() => setShowOtModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" form="ot-form" disabled={pending.has(`ot:${otOperatorId}`)} className="btn btn-primary">
                <Clock className="w-4 h-4" />
                <span>Save Overtime</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DETAILED SHIFT MODAL */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-panel">
            <div className="modal-header">
              <div className="flex items-center gap-2 min-w-0">
                <CalendarCheck className="w-5 h-5 text-accent shrink-0" />
                <div className="min-w-0">
                  <h3 className="modal-title">Detailed Daily Shift Log</h3>
                  <p className="text-[11px] text-zinc-500">For {formatDateDDMMYYYY(selectedDate)}</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowAddModal(false)} className="icon-btn" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form id="shift-form" onSubmit={handleSaveDetailedAttendance} className="modal-body space-y-4 text-xs">
              {modalError && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="font-semibold">{modalError}</span>
                </div>
              )}
              <div className="form-grid">
                <div>
                  <label className="form-label">Operator</label>
                  <Select value={operatorId} onValueChange={pickOperator}>
                    <SelectTrigger className="form-input" aria-label="Operator">
                      <SelectValue placeholder="Select an operator" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeOperators.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.fullName} ({e.employeeId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="form-label">Project site</label>
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger className="form-input" aria-label="Project site">
                      <SelectValue placeholder="Select a project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} (OT: ₹{p.overtimeRate}/h)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="form-grid">
                <div>
                  <label className="form-label">Machine / crane</label>
                  <Select value={machineId} onValueChange={setMachineId}>
                    <SelectTrigger className="form-input" aria-label="Machine / crane">
                      <SelectValue placeholder="No machine" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No machine</SelectItem>
                      {machines.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.assetId} - {m.model} ({m.tonnageCapacity}T)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="form-label">Attendance status</label>
                  <Select value={status} onValueChange={(v) => setStatus(v as AttendanceStatus)}>
                    <SelectTrigger className="form-input font-bold" aria-label="Attendance status">
                      <SelectValue placeholder="Select a status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="present">Present (Standard Shift)</SelectItem>
                      <SelectItem value="half_day">Half Day (under {shiftHours / 2}h)</SelectItem>
                      <SelectItem value="absent">Absent</SelectItem>
                      <SelectItem value="weekly_off">Weekly Off</SelectItem>
                      <SelectItem value="paid_leave">Paid Leave</SelectItem>
                      <SelectItem value="holiday">Official Holiday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <span className="form-label">Shift</span>
                <ShiftToggle value={shift} onChange={pickShift} />
                <p className="mt-1 text-[11px] text-slate-500">
                  {selectedDate === currentDate
                    ? `Starts at the current device time and runs ${shiftHours} hours. `
                    : ''}
                  Day starts 08:00, night starts 20:00. Pick Custom, or edit the times, to set your own.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="form-label">Start time</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      required
                      value={startTime}
                      onChange={(e) => {
                        setStartTime(e.target.value);
                        setShift('custom');
                      }}
                      className="form-input min-w-0"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setStartTime(nowHHmm());
                        setShift('custom');
                      }}
                      className="btn btn-secondary btn-sm shrink-0"
                    >
                      Now
                    </button>
                  </div>
                </div>
                <div>
                  <label className="form-label">End time</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      required
                      value={endTime}
                      onChange={(e) => {
                        setEndTime(e.target.value);
                        setShift('custom');
                      }}
                      className="form-input min-w-0"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setEndTime(nowHHmm());
                        setShift('custom');
                      }}
                      className="btn btn-secondary btn-sm shrink-0"
                    >
                      Now
                    </button>
                  </div>
                </div>
                <div>
                  <label className="form-label">Unpaid break (min)</label>
                  <input
                    type="number"
                    min="0"
                    value={breakMin}
                    onChange={(e) => setBreakMin(parseInt(e.target.value, 10) || 0)}
                    className="form-input"
                  />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-accent-50 border border-accent-200 text-logo-900 space-y-1 font-mono">
                <div className="flex justify-between gap-3">
                  <span>Net working duration:</span>
                  <strong>{durationPreview.netWorkingHours} Hours</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Standard shift allowance:</span>
                  <span>{shiftHours} Hours</span>
                </div>
                <div className="flex justify-between gap-3 text-accent-700 font-bold">
                  <span>Calculated overtime:</span>
                  <span>{durationPreview.potentialOtHours} Hours</span>
                </div>
                <div className="flex justify-between gap-3 text-success-700 font-bold border-t border-accent-200 pt-1">
                  <span>OT earnings (@ ₹{detailedOtRate}/hr):</span>
                  <span>{formatINR(otEarnings)}</span>
                </div>
              </div>

              <div>
                <label className="form-label">Remarks</label>
                <input
                  type="text"
                  placeholder="Optional note"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="form-input"
                />
              </div>
            </form>

            <div className="modal-footer">
              <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" form="shift-form" disabled={pending.has(`detail:${operatorId}`)} className="btn btn-primary">
                Save Attendance
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
