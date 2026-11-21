import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { hasPermission, requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';

const createSchema = z.object({
  projectId: z.string().uuid(),
  date: z.string(),
  category: z.string().min(1),
  description: z.string().min(1),
  amountPaise: z.number().int().positive(),
  paymentMode: z.enum(['cash', 'company_card', 'bank_transfer', 'upi', 'cheque']),
  paidBy: z.string().min(1),
  vendor: z.string().optional(),
  receiptNumber: z.string().optional(),
  remarks: z.string().optional(),
});

export async function expenseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/expenses', { preHandler: requirePermission('expense:read') }, async (request) => {
    const q = z.object({ projectId: z.string().uuid().optional(), category: z.string().optional(), limit: z.coerce.number().int().max(500).default(200) }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT e.*, p.name AS project_name FROM project_expenses e JOIN projects p ON p.id=e.project_id
         WHERE e.tenant_id=$1 AND ($2::uuid IS NULL OR e.project_id=$2) AND ($3::text IS NULL OR e.category=$3)
         ORDER BY e.expense_date DESC LIMIT $4`,
        [request.auth.tenantId, q.projectId ?? null, q.category ?? null, q.limit],
      );
      return { items: r.rows, total: r.rowCount };
    });
  });

  app.post('/expenses', { preHandler: requirePermission('expense:write') }, async (request, reply) => {
    const b = createSchema.parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const auto = hasPermission(request.auth, 'expense:approve');
      const seq = await c.query(`SELECT COALESCE(MAX(NULLIF(regexp_replace(expense_code,'\\D','','g'),'')::bigint),0)::int AS n FROM project_expenses WHERE tenant_id=$1`, [request.auth.tenantId]);
      const code = `EXP-${String(seq.rows[0].n + 1).padStart(3, '0')}`;
      const r = await c.query(
        `INSERT INTO project_expenses (tenant_id,expense_code,project_id,expense_date,category,description,
          amount_paise,payment_mode,paid_by,vendor,receipt_number,approval_status,approved_by,approved_at,remarks,created_by)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8::payment_mode,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [request.auth.tenantId, code, b.projectId, b.date, b.category, b.description, b.amountPaise,
          b.paymentMode, b.paidBy, b.vendor || null, b.receiptNumber || null, auto ? 'approved' : 'draft',
          auto ? request.auth.userId : null, auto ? new Date().toISOString() : null, b.remarks ?? null, request.auth.userId],
      );
      await writeAudit(c, request.auth, { action: 'EXPENSE_CREATED', entity: 'ProjectExpense', entityId: r.rows[0].id, reason: `Voucher ${code} for Rs.${(b.amountPaise / 100).toFixed(2)}`, requestId: request.id });
      return reply.code(201).send(r.rows[0]);
    });
  });

  app.post('/expenses/:id/approve', { preHandler: requirePermission('expense:approve') }, async (request) => {
    const { id } = request.params as { id: string };
    return withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `UPDATE project_expenses SET approval_status='approved', approved_by=$3, approved_at=now()
         WHERE tenant_id=$1 AND id=$2 AND approval_status='draft' RETURNING *`,
        [request.auth.tenantId, id, request.auth.userId],
      );
      if (!r.rows[0]) throw Errors.notFound('Pending expense voucher');
      await writeAudit(c, request.auth, { action: 'EXPENSE_APPROVED', entity: 'ProjectExpense', entityId: id, requestId: request.id });
      return r.rows[0];
    });
  });
}
