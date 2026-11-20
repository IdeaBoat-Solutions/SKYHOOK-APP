import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';
import { upsertAttendance, type AttendanceInput } from './attendance.service.js';

const inputSchema = z.object({
  operatorId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  projectId: z.string().uuid(),
  machineId: z.string().uuid().optional(),
  startTime: z.string().min(4),
  endTime: z.string().min(4),
  unpaidBreakMinutes: z.number().int().nonnegative().default(0),
  status: z.enum(['present', 'absent', 'half_day', 'paid_leave', 'unpaid_leave', 'weekly_off', 'holiday']),
  remarks: z.string().optional(),
});

export async function attendanceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/attendance', { preHandler: requirePermission('attendance:read') }, async (request) => {
    const q = z.object({
      from: z.string().optional(), to: z.string().optional(),
      operatorId: z.string().uuid().optional(), approvalStatus: z.string().optional(),
      limit: z.coerce.number().int().max(1000).default(200),
    }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT a.*, e.full_name AS operator_name, e.employee_code, p.name AS project_name
         FROM attendance_records a
         JOIN employees e ON e.id=a.operator_id
         JOIN projects p ON p.id=a.project_id
         WHERE a.tenant_id=$1 AND ($2::date IS NULL OR a.attendance_date >= $2::date)
           AND ($3::date IS NULL OR a.attendance_date <= $3::date)
           AND ($4::uuid IS NULL OR a.operator_id=$4)
           AND ($5::text IS NULL OR a.approval_status::text=$5)
         ORDER BY a.attendance_date DESC, e.employee_code LIMIT $6`,
        [request.auth.tenantId, q.from ?? null, q.to ?? null, q.operatorId ?? null, q.approvalStatus ?? null, q.limit],
      );
      return { items: r.rows, total: r.rowCount };
    });
  });

  app.get('/attendance/matrix', { preHandler: requirePermission('attendance:read') }, async (request) => {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
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
        [request.auth.tenantId, month],
      );
      return { items: r.rows };
    });
  });

  app.post('/attendance', { preHandler: requirePermission('attendance:write') }, async (request, reply) => {
    const body: AttendanceInput = inputSchema.parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const settings = await c.query('SELECT standard_shift_minutes FROM company_settings WHERE tenant_id=$1', [request.auth.tenantId]);
      const standard = settings.rows[0]?.standard_shift_minutes ?? 600;
      const row = await upsertAttendance(c, request.auth, body, standard, request.id);
      return reply.code(201).send(row);
    });
  });

  app.post('/attendance/:id/approve', { preHandler: requirePermission('attendance:approve') }, async (request) => {
    const { id } = request.params as { id: string };
    return withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `UPDATE attendance_records SET approval_status='approved', approved_by=$3, approved_at=now()
         WHERE tenant_id=$1 AND id=$2 AND approval_status='submitted' RETURNING *`,
        [request.auth.tenantId, id, request.auth.userId],
      );
      if (!r.rows[0]) throw Errors.notFound('Pending attendance record');
      await writeAudit(c, request.auth, {
        action: 'ATTENDANCE_APPROVED', entity: 'AttendanceRecord', entityId: id, requestId: request.id,
      });
      return r.rows[0];
    });
  });

  app.post('/attendance/:id/reject', { preHandler: requirePermission('attendance:approve') }, async (request) => {
    const { id } = request.params as { id: string };
    const { reason } = z.object({ reason: z.string().min(1) }).parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `UPDATE attendance_records SET approval_status='rejected', remarks=COALESCE(remarks,'') || ' | Rejected: ' || $3
         WHERE tenant_id=$1 AND id=$2 AND approval_status='submitted' RETURNING *`,
        [request.auth.tenantId, id, reason],
      );
      if (!r.rows[0]) throw Errors.notFound('Pending attendance record');
      await writeAudit(c, request.auth, {
        action: 'ATTENDANCE_REJECTED', entity: 'AttendanceRecord', entityId: id, reason, requestId: request.id,
      });
      return r.rows[0];
    });
  });
}
