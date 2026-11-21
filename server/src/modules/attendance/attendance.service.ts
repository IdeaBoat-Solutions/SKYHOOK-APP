import type { PoolClient } from 'pg';
import { Errors } from '../../common/errors.js';
import { calculateWorkingAndOt } from '../../domain/calculations.js';
import type { AuthContext } from '../../auth/context.js';
import { writeAudit } from '../../common/audit.js';

export interface AttendanceInput {
  operatorId: string;
  date: string;
  projectId: string;
  machineId?: string;
  startTime: string;
  endTime: string;
  unpaidBreakMinutes?: number;
  status: 'present' | 'absent' | 'half_day' | 'paid_leave' | 'unpaid_leave' | 'weekly_off' | 'holiday';
  remarks?: string;
}

/** Create or replace one operator/day attendance row. Hours and OT are ALWAYS recomputed server-side. */
export async function upsertAttendance(
  c: PoolClient,
  auth: AuthContext,
  input: AttendanceInput,
  standardShiftMinutes: number,
  requestId: string,
) {
  const project = await c.query(
    'SELECT id, ot_rate_paise_per_hour FROM projects WHERE tenant_id=$1 AND id=$2',
    [auth.tenantId, input.projectId],
  );
  if (!project.rows[0]) throw Errors.notFound('Project');

  const calc = calculateWorkingAndOt(
    input.startTime,
    input.endTime,
    input.unpaidBreakMinutes ?? 0,
    standardShiftMinutes,
  );

  const existing = await c.query(
    'SELECT id, approval_status FROM attendance_records WHERE tenant_id=$1 AND operator_id=$2 AND attendance_date=$3',
    [auth.tenantId, input.operatorId, input.date],
  );
  if (existing.rows[0]?.approval_status === 'approved') {
    throw Errors.conflict('Attendance is already approved; request a correction');
  }

  const r = await c.query(
    `INSERT INTO attendance_records (tenant_id,attendance_date,operator_id,project_id,machine_id,
       start_time,end_time,unpaid_break_minutes,net_working_minutes,net_working_hours,
       standard_working_minutes,overtime_hours,ot_rate_paise_per_hour,status,approval_status,
       remarks,entered_by)
     VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'submitted',$15,$16)
     ON CONFLICT (tenant_id,operator_id,attendance_date) DO UPDATE SET
       project_id=EXCLUDED.project_id, machine_id=EXCLUDED.machine_id,
       start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time,
       unpaid_break_minutes=EXCLUDED.unpaid_break_minutes,
       net_working_minutes=EXCLUDED.net_working_minutes, net_working_hours=EXCLUDED.net_working_hours,
       standard_working_minutes=EXCLUDED.standard_working_minutes,
       overtime_hours=EXCLUDED.overtime_hours, ot_rate_paise_per_hour=EXCLUDED.ot_rate_paise_per_hour,
       status=EXCLUDED.status, remarks=EXCLUDED.remarks, updated_at=now(),
       -- A corrected row must go back to the approver. Approved rows never reach this
       -- point (blocked above), so this only revives a rejected one.
       approval_status='submitted', approved_by=NULL, approved_at=NULL
     RETURNING *`,
    [
      auth.tenantId, input.date, input.operatorId, input.projectId, input.machineId ?? null,
      input.startTime, input.endTime, input.unpaidBreakMinutes ?? 0,
      calc.netWorkingMinutes, calc.netWorkingHours, standardShiftMinutes,
      calc.potentialOtHours, project.rows[0].ot_rate_paise_per_hour, input.status,
      input.remarks ?? null, auth.userId,
    ],
  );

  await writeAudit(c, auth, {
    action: existing.rows[0] ? 'ATTENDANCE_UPDATED' : 'ATTENDANCE_RECORDED',
    entity: 'AttendanceRecord', entityId: r.rows[0].id,
    reason: `${input.status} ${calc.netWorkingHours}h (${calc.potentialOtHours}h OT) on ${input.date}`,
    requestId,
  });
  return r.rows[0];
}
