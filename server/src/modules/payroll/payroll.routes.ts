import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission } from '../../auth/rbac.js';
import { idempotent } from '../../common/idempotency.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';
import { generatePayroll, approvePayroll, getRun } from './payroll.service.js';

function idemKey(request: { headers: Record<string, unknown> }): string {
  const key = request.headers['idempotency-key'];
  if (typeof key === 'string' && key.length > 0) return key;
  return randomUUID();
}
const hash = (body: unknown) => createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');

export async function payrollRoutes(app: FastifyInstance): Promise<void> {
  app.get('/payroll/runs', { preHandler: requirePermission('payroll:read') }, async (request) => {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT * FROM payroll_runs WHERE tenant_id=$1 AND ($2::text IS NULL OR to_char(month,'YYYY-MM')=$2)
         ORDER BY month DESC`,
        [request.auth.tenantId, month ?? null],
      );
      return { items: r.rows };
    });
  });

  app.get('/payroll/runs/:id', { preHandler: requirePermission('payroll:read') }, async (request) => {
    const { id } = request.params as { id: string };
    return withTenantRead(request.auth.tenantId, async (c) => getRun(c, request.auth.tenantId, id));
  });

  app.post('/payroll/runs/generate', { preHandler: requirePermission('payroll:generate') }, async (request, reply) => {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(request.body);
    const result = await idempotent(
      request.auth.tenantId, idemKey(request as any), 'POST /payroll/runs/generate', hash(request.body),
      async (c) => {
        const run = await generatePayroll(c, request.auth, month, request.id);
        return { statusCode: 201, body: run };
      },
    );
    return reply.code(result.statusCode).send(result.body);
  });

  app.post('/payroll/runs/:id/approve', { preHandler: requirePermission('payroll:approve') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await idempotent(
      request.auth.tenantId, idemKey(request as any), `POST /payroll/runs/${id}/approve`, hash(request.body),
      async (c) => {
        const run = await approvePayroll(c, request.auth, id, request.id);
        return { statusCode: 200, body: run };
      },
    );
    return reply.code(result.statusCode).send(result.body);
  });

  app.post('/payroll/runs/:id/entries/:entryId/payment', { preHandler: requirePermission('payroll:pay') }, async (request, reply) => {
    const { id, entryId } = request.params as { id: string; entryId: string };
    const body = z.object({
      paymentMode: z.enum(['cash', 'bank_transfer', 'upi', 'cheque', 'company_card']),
      paymentReference: z.string().optional(),
    }).parse(request.body);

    const result = await idempotent(
      request.auth.tenantId, idemKey(request as any), `POST /payroll/runs/${id}/entries/${entryId}/payment`, hash(request.body),
      async (c) => {
        const entry = await c.query(
          `UPDATE payroll_entries SET payment_status='paid', payment_date=CURRENT_DATE,
            payment_mode=$4, payment_reference=$5
           WHERE tenant_id=$1 AND payroll_run_id=$2 AND id=$3 AND payment_status='unpaid' RETURNING *`,
          [request.auth.tenantId, id, entryId, body.paymentMode, body.paymentReference ?? 'NEFT-PROCESSED'],
        );
        if (!entry.rows[0]) throw Errors.notFound('Unpaid payroll entry');

        const totals = await c.query(
          `SELECT COALESCE(sum(net_paise) FILTER (WHERE payment_status='paid'),0)::bigint AS paid,
                  count(*) FILTER (WHERE payment_status='unpaid')::int AS remaining
           FROM payroll_entries WHERE tenant_id=$1 AND payroll_run_id=$2`,
          [request.auth.tenantId, id],
        );
        await c.query(
          `UPDATE payroll_runs SET total_paid_paise=$3,
            status=(CASE WHEN $4::int=0 THEN 'paid' ELSE 'partially_paid' END)::payroll_status,
            version=version+1
           WHERE tenant_id=$1 AND id=$2`,
          [request.auth.tenantId, id, totals.rows[0].paid, totals.rows[0].remaining],
        );
        await writeAudit(c, request.auth, {
          action: 'PAYROLL_PAYMENT_RECORDED', entity: 'PayrollEntry', entityId: entryId,
          reason: `Salary payment via ${body.paymentMode}`, requestId: request.id,
        });
        return { statusCode: 200, body: entry.rows[0] };
      },
    );
    return reply.code(result.statusCode).send(result.body);
  });
}
