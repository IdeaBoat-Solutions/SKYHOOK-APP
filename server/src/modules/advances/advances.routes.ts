import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';

export async function advanceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/advances', { preHandler: requirePermission('advance:read') }, async (request) => {
    const q = z.object({ employeeId: z.string().uuid().optional(), limit: z.coerce.number().int().max(500).default(200) }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT a.*, e.full_name AS employee_name, e.employee_code
         FROM salary_advances a JOIN employees e ON e.id=a.employee_id
         WHERE a.tenant_id=$1 AND ($2::uuid IS NULL OR a.employee_id=$2)
         ORDER BY a.advance_date DESC LIMIT $3`,
        [request.auth.tenantId, q.employeeId ?? null, q.limit],
      );
      return { items: r.rows, total: r.rowCount };
    });
  });

  app.get('/advances/:id/recoveries', { preHandler: requirePermission('advance:read') }, async (request) => {
    const { id } = request.params as { id: string };
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT ar.*, r.run_code FROM advance_recoveries ar JOIN payroll_runs r ON r.id=ar.payroll_run_id
         WHERE ar.tenant_id=$1 AND ar.advance_id=$2 ORDER BY ar.recovery_date DESC`,
        [request.auth.tenantId, id],
      );
      return { items: r.rows };
    });
  });

  app.post('/advances', { preHandler: requirePermission('advance:write') }, async (request, reply) => {
    const b = z.object({
      employeeId: z.string().uuid(), date: z.string(), amountPaise: z.number().int().positive(),
      paymentMode: z.enum(['cash', 'bank_transfer', 'upi', 'cheque', 'company_card']),
      paymentReference: z.string().optional(), projectId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
      remarks: z.string().optional(),
    }).parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const emp = await c.query(
        "SELECT id FROM employees WHERE tenant_id=$1 AND id=$2 AND employee_type='operator' AND status='active'",
        [request.auth.tenantId, b.employeeId],
      );
      if (!emp.rows[0]) throw Errors.validation([{ field: 'employeeId', message: 'Only active operators are eligible' }]);
      const seq = await c.query(`SELECT COALESCE(MAX(NULLIF(regexp_replace(advance_code,'\\D','','g'),'')::bigint),0)::int AS n FROM salary_advances WHERE tenant_id=$1`, [request.auth.tenantId]);
      const code = `ADV-${String(seq.rows[0].n + 1).padStart(3, '0')}`;
      const r = await c.query(
        `INSERT INTO salary_advances (tenant_id,advance_code,employee_id,advance_date,amount_paise,payment_mode,
          payment_reference,project_id,remarks,approved_by,outstanding_paise,created_by)
         VALUES ($1,$2,$3,$4::date,$5,$6::payment_mode,$7,$8,$9,$10,$5,$10) RETURNING *`,
        [request.auth.tenantId, code, b.employeeId, b.date, b.amountPaise, b.paymentMode,
          b.paymentReference ?? null, b.projectId ?? null, b.remarks ?? null, request.auth.userId],
      );
      await writeAudit(c, request.auth, { action: 'ADVANCE_GIVEN', entity: 'SalaryAdvance', entityId: r.rows[0].id, reason: `Advance of Rs.${(b.amountPaise / 100).toFixed(2)}`, requestId: request.id });
      return reply.code(201).send(r.rows[0]);
    });
  });

  // Idempotent approval — advances are created approved by default; this records who approved.
  app.post('/advances/:id/approve', { preHandler: requirePermission('advance:write') }, async (request) => {
    const { id } = request.params as { id: string };
    return withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `UPDATE salary_advances SET status='approved', approved_by=$3, version=version+1
         WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [request.auth.tenantId, id, request.auth.userId],
      );
      if (!r.rows[0]) throw Errors.notFound('Advance');
      await writeAudit(c, request.auth, {
        action: 'ADVANCE_APPROVED', entity: 'SalaryAdvance', entityId: id, requestId: request.id,
      });
      return r.rows[0];
    });
  });
}
