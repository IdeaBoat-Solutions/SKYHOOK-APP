/** Attendance module ported from server/src/modules/attendance/*.ts. */
import { query, withTenant, withTenantRead, pool } from '../_shared/db.ts';
import { json, readJson } from '../_shared/http.ts';
import { Errors } from '../_shared/errors.ts';
import { requirePermission } from '../_shared/rbac.ts';
import type { AuthContext } from '../_shared/auth.ts';
import type { Queryable } from '../_shared/db.ts';
import type { RouteCtx, Route } from '../_shared/types.ts';

/* ------------------------------------------------------------------ *
 * Local validators (replacement for the zod schemas in the source)
 * ------------------------------------------------------------------ */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(v: unknown, field: string): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) {
    throw Errors.validation([{ field, message: 'Must be a valid UUID' }]);
  }
  return v;
}

function optionalUuid(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  return uuid(v, field);
}

function requiredStr(v: unknown, field: string, min = 1): string {
  if (typeof v !== 'string' || v.length < min) {
    throw Errors.validation([{ field, message: `Must be a string of at least ${min} characters` }]);
  }
  return v;
}

function optionalStr(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw Errors.validation([{ field, message: 'Must be a string' }]);
  return v;
}

function regexStr(v: unknown, field: string, re: RegExp): string {
  if (typeof v !== 'string' || !re.test(v)) {
    throw Errors.validation([{ field, message: `Must match ${re.toString()}` }]);
  }
  return v;
}

function intNonnegative(v: unknown, field: string, defaultValue?: number): number {
  if (v === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw Errors.validation([{ field, message: 'Must be a non-negative integer' }]);
  }
  return v;
}

function oneOf<T extends string>(v: unknown, field: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !values.includes(v as T)) {
    throw Errors.validation([{ field, message: `Must be one of: ${values.join(', ')}` }]);
  }
  return v as T;
}

function queryInt(raw: string | null, field: string, defaultValue: number, max: number): number {
  if (raw === null) return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n > max) {
    throw Errors.validation([{ field, message: `Must be an integer no greater than ${max}` }]);
  }
  return n;
}

/** Extract a Fastify-style :id parameter from the real request path. */
function pathParam(ctx: RouteCtx, fromEnd = 0): string {
  const segs = ctx.url.pathname.split('/').filter(Boolean);
  return segs[segs.length - 1 - fromEnd] ?? '';
}

/* ------------------------------------------------------------------ *
 * Local port of server/src/domain/calculations.ts
 * ------------------------------------------------------------------ */
interface TimeDurationResult {
  totalSpanMinutes: number;
  netWorkingMinutes: number;
  netWorkingHours: number;
  potentialOtMinutes: number;
  potentialOtHours: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function parseTimeToMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  const str = time.includes('T') ? (time.split('T')[1] ?? '') : time;
  const [h = '0', m = '0'] = str.split(':');
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}

function calculateWorkingAndOt(
  startTime: string,
  endTime: string,
  unpaidBreakMinutes = 0,
  standardShiftMinutes = 600,
): TimeDurationResult {
  const start = parseTimeToMinutes(startTime);
  let end = parseTimeToMinutes(endTime);
  if (end < start) end += 1440; // overnight shift
  const totalSpanMinutes = Math.max(0, end - start);
  const netWorkingMinutes = Math.max(0, totalSpanMinutes - Math.max(0, unpaidBreakMinutes));
  const netWorkingHours = round2(netWorkingMinutes / 60);
  const potentialOtMinutes = Math.max(0, netWorkingMinutes - standardShiftMinutes);
  return {
    totalSpanMinutes,
    netWorkingMinutes,
    netWorkingHours,
    potentialOtMinutes,
    potentialOtHours: round2(potentialOtMinutes / 60),
  };
}

/* ------------------------------------------------------------------ *
 * Local port of server/src/common/audit.ts
 * ------------------------------------------------------------------ */
interface AuditInput {
  action: string;
  entity: string;
  entityId: string;
  reason?: string;
  previousValue?: unknown;
  updatedValue?: unknown;
  requestId?: string;
}

async function writeAudit(c: Queryable, auth: AuthContext, input: AuditInput): Promise<void> {
  await c.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_name, action, entity, entity_id,
                             previous_value, updated_value, reason, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      auth.tenantId,
      auth.userId,
      auth.name,
      input.action,
      input.entity,
      input.entityId,
      input.previousValue === undefined ? null : JSON.stringify(input.previousValue),
      input.updatedValue === undefined ? null : JSON.stringify(input.updatedValue),
      input.reason ?? null,
      input.requestId ?? null,
    ],
  );
  await c.query(
    `INSERT INTO outbox (tenant_id, event_type, aggregate_type, aggregate_id, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      auth.tenantId,
      input.action,
      input.entity,
      input.entityId,
      JSON.stringify({ reason: input.reason ?? null, at: new Date().toISOString() }),
    ],
  );
}

/* ------------------------------------------------------------------ *
 * Local port of server/src/modules/attendance/attendance.service.ts
 * ------------------------------------------------------------------ */
interface AttendanceInput {
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
async function upsertAttendance(
  c: Queryable,
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

const ATTENDANCE_STATUSES = [
  'present', 'absent', 'half_day', 'paid_leave', 'unpaid_leave', 'weekly_off', 'holiday',
] as const;

export const attendanceRoutes: Route[] = [
  {
    method: 'GET', path: '/attendance',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'attendance:read');
      const from = ctx.url.searchParams.get('from');
      const to = ctx.url.searchParams.get('to');
      const operatorIdParam = ctx.url.searchParams.get('operatorId');
      const operatorId = operatorIdParam === null ? undefined : optionalUuid(operatorIdParam, 'operatorId');
      const approvalStatus = ctx.url.searchParams.get('approvalStatus');
      const limit = queryInt(ctx.url.searchParams.get('limit'), 'limit', 200, 1000);
      const result = await withTenantRead(auth.tenantId, (c) => c.query(
        `SELECT a.*, e.full_name AS operator_name, e.employee_code, p.name AS project_name
         FROM attendance_records a
         JOIN employees e ON e.id=a.operator_id
         JOIN projects p ON p.id=a.project_id
         WHERE a.tenant_id=$1 AND ($2::date IS NULL OR a.attendance_date >= $2::date)
           AND ($3::date IS NULL OR a.attendance_date <= $3::date)
           AND ($4::uuid IS NULL OR a.operator_id=$4)
           AND ($5::text IS NULL OR a.approval_status::text=$5)
         ORDER BY a.attendance_date DESC, e.employee_code LIMIT $6`,
        [auth.tenantId, from, to, operatorId ?? null, approvalStatus, limit],
      ));
      return json({ items: result.rows, total: result.rowCount });
    },
  },
  {
    method: 'GET', path: '/attendance/matrix',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'attendance:read');
      const month = regexStr(ctx.url.searchParams.get('month'), 'month', /^\d{4}-\d{2}$/);
      const result = await withTenantRead(auth.tenantId, (c) => c.query(
        `SELECT e.employee_code, e.full_name,
                count(*) FILTER (WHERE a.status='present')::int AS present_days,
                count(*) FILTER (WHERE a.status='half_day')::int AS half_days,
                count(*) FILTER (WHERE a.status='absent')::int AS absent_days,
                coalesce(sum(a.overtime_hours),0) AS overtime_hours,
                round(coalesce(sum(a.overtime_hours * a.ot_rate_paise_per_hour),0))::bigint AS ot_paise,
                count(*) FILTER (WHERE a.approval_status='submitted')::int AS pending_days
         FROM employees e
         LEFT JOIN attendance_records a ON a.operator_id=e.id AND a.tenant_id=e.tenant_id
           AND to_char(a.attendance_date,'YYYY-MM')=$2 AND a.approval_status='approved'
         WHERE e.tenant_id=$1 AND e.employee_type='operator' AND e.deleted_at IS NULL
         GROUP BY e.id ORDER BY e.employee_code`,
        [auth.tenantId, month],
      ));
      return json({ items: result.rows });
    },
  },
  {
    method: 'POST', path: '/attendance',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'attendance:write');
      const b = await readJson(req);
      const body: AttendanceInput = {
        operatorId: uuid(b.operatorId, 'operatorId'),
        date: regexStr(b.date, 'date', /^\d{4}-\d{2}-\d{2}$/),
        projectId: uuid(b.projectId, 'projectId'),
        machineId: optionalUuid(b.machineId, 'machineId'),
        startTime: requiredStr(b.startTime, 'startTime', 4),
        endTime: requiredStr(b.endTime, 'endTime', 4),
        unpaidBreakMinutes: intNonnegative(b.unpaidBreakMinutes, 'unpaidBreakMinutes', 0),
        status: oneOf(b.status, 'status', ATTENDANCE_STATUSES),
        remarks: optionalStr(b.remarks, 'remarks'),
      };
      const row = await withTenant(auth.tenantId, async (c) => {
        const settings = await c.query('SELECT standard_shift_minutes FROM company_settings WHERE tenant_id=$1', [auth.tenantId]);
        const standard = settings.rows[0]?.standard_shift_minutes ?? 600;
        return await upsertAttendance(c, auth, body, standard, ctx.requestId);
      });
      return json(row, 201);
    },
  },
  {
    method: 'POST', path: '/attendance/:id/approve',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'attendance:approve');
      const id = pathParam(ctx, 1);
      const row = await withTenant(auth.tenantId, async (c) => {
        const r = await c.query(
          `UPDATE attendance_records SET approval_status='approved', approved_by=$3, approved_at=now()
           WHERE tenant_id=$1 AND id=$2 AND approval_status='submitted' RETURNING *`,
          [auth.tenantId, id, auth.userId],
        );
        if (!r.rows[0]) throw Errors.notFound('Pending attendance record');
        await writeAudit(c, auth, {
          action: 'ATTENDANCE_APPROVED', entity: 'AttendanceRecord', entityId: id, requestId: ctx.requestId,
        });
        return r.rows[0];
      });
      return json(row);
    },
  },
  {
    method: 'POST', path: '/attendance/:id/reject',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'attendance:approve');
      const id = pathParam(ctx, 1);
      const b = await readJson(req);
      const reason = requiredStr(b.reason, 'reason');
      const row = await withTenant(auth.tenantId, async (c) => {
        const r = await c.query(
          `UPDATE attendance_records SET approval_status='rejected', remarks=COALESCE(remarks,'') || ' | Rejected: ' || $3
           WHERE tenant_id=$1 AND id=$2 AND approval_status='submitted' RETURNING *`,
          [auth.tenantId, id, reason],
        );
        if (!r.rows[0]) throw Errors.notFound('Pending attendance record');
        await writeAudit(c, auth, {
          action: 'ATTENDANCE_REJECTED', entity: 'AttendanceRecord', entityId: id, reason, requestId: ctx.requestId,
        });
        return r.rows[0];
      });
      return json(row);
    },
  },
];
