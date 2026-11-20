import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';

const monthPattern = /^\d{4}-\d{2}$/;

function payrollAdjustmentView(r: any) {
  return {
    id: r.id,
    month: r.month,
    employeeCode: r.employee_code,
    kind: r.kind,
    label: r.label,
    amountPaise: r.amount_paise,
    remarks: r.remarks,
    createdAt: r.created_at,
  };
}

function personalRecordView(r: any) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    provider: r.provider,
    referenceNumber: r.reference_number,
    amountPaise: r.amount_paise,
    periodicAmountPaise: r.periodic_amount_paise,
    startDate: r.start_date,
    dueDate: r.due_date,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

const payrollAdjustmentSchema = z.object({
  month: z.string().regex(monthPattern, 'month must be YYYY-MM'),
  employeeCode: z.string().min(1),
  kind: z.enum(['pay', 'deduction']),
  label: z.string().min(1),
  amountPaise: z.number().int().nonnegative(),
  remarks: z.string().optional(),
});

const personalRecordSchema = z.object({
  kind: z.string().min(1),
  title: z.string().min(1),
  provider: z.string().default(''),
  referenceNumber: z.string().default(''),
  amountPaise: z.number().int().nonnegative().default(0),
  periodicAmountPaise: z.number().int().nonnegative().default(0),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const personalRecordPatchSchema = z.object({
  kind: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  provider: z.string().optional(),
  referenceNumber: z.string().optional(),
  amountPaise: z.number().int().nonnegative().optional(),
  periodicAmountPaise: z.number().int().nonnegative().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function extrasRoutes(app: FastifyInstance): Promise<void> {
  app.get('/payroll-adjustments', { preHandler: requirePermission('payroll:read') }, async (request) => {
    const { month } = z.object({ month: z.string().regex(monthPattern, 'month must be YYYY-MM') }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT id, month, employee_code, kind, label, amount_paise, remarks, created_at
         FROM payroll_adjustments WHERE tenant_id=$1 AND month=$2 ORDER BY created_at DESC`,
        [request.auth.tenantId, month],
      );
      return { items: r.rows.map(payrollAdjustmentView) };
    });
  });

  app.post('/payroll-adjustments', { preHandler: requirePermission('payroll:generate') }, async (request, reply) => {
    const b = payrollAdjustmentSchema.parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `INSERT INTO payroll_adjustments (tenant_id, month, employee_code, kind, label, amount_paise, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, month, employee_code, kind, label, amount_paise, remarks, created_at`,
        [request.auth.tenantId, b.month, b.employeeCode, b.kind, b.label, b.amountPaise, b.remarks ?? null],
      );
      const item = payrollAdjustmentView(r.rows[0]);
      await writeAudit(c, request.auth, {
        action: 'PAYROLL_ADJUSTMENT_ADDED', entity: 'PayrollAdjustment', entityId: item.id,
        reason: `${b.kind} for ${b.employeeCode} (${b.month})`, requestId: request.id,
      });
      return reply.code(201).send(item);
    });
  });

  app.delete('/payroll-adjustments/:id', { preHandler: requirePermission('payroll:generate') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query('DELETE FROM payroll_adjustments WHERE tenant_id=$1 AND id=$2', [request.auth.tenantId, id]);
      if (!r.rowCount) throw Errors.notFound('Payroll adjustment');
      await writeAudit(c, request.auth, {
        action: 'PAYROLL_ADJUSTMENT_DELETED', entity: 'PayrollAdjustment', entityId: id, requestId: request.id,
      });
    });
    return reply.code(204).send();
  });

  app.get('/personal-records', { preHandler: requirePermission('company:read') }, async (request) => {
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT id, kind, title, provider, reference_number, amount_paise, periodic_amount_paise,
                start_date, due_date, notes, created_at
         FROM personal_records WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC`,
        [request.auth.tenantId, request.auth.userId],
      );
      return { items: r.rows.map(personalRecordView) };
    });
  });

  app.post('/personal-records', { preHandler: requirePermission('company:write') }, async (request, reply) => {
    const b = personalRecordSchema.parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `INSERT INTO personal_records (tenant_id, user_id, kind, title, provider, reference_number,
           amount_paise, periodic_amount_paise, start_date, due_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, kind, title, provider, reference_number, amount_paise, periodic_amount_paise,
                   start_date, due_date, notes, created_at`,
        [request.auth.tenantId, request.auth.userId, b.kind, b.title, b.provider, b.referenceNumber,
          b.amountPaise, b.periodicAmountPaise, b.startDate ?? null, b.dueDate ?? null, b.notes ?? null],
      );
      const item = personalRecordView(r.rows[0]);
      await writeAudit(c, request.auth, {
        action: 'PERSONAL_RECORD_ADDED', entity: 'PersonalRecord', entityId: item.id, requestId: request.id,
      });
      return reply.code(201).send(item);
    });
  });

  app.patch('/personal-records/:id', { preHandler: requirePermission('company:write') }, async (request) => {
    const { id } = request.params as { id: string };
    const b = personalRecordPatchSchema.parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const columns: Record<string, string> = {
        kind: 'kind', title: 'title', provider: 'provider', referenceNumber: 'reference_number',
        amountPaise: 'amount_paise', periodicAmountPaise: 'periodic_amount_paise',
        startDate: 'start_date', dueDate: 'due_date', notes: 'notes',
      };
      const entries = Object.entries(b).filter(([, v]) => v !== undefined);
      if (!entries.length) throw Errors.badRequest('No fields to update');
      // $1 tenant, $2 user, $3 id; values occupy $4..$n.
      const sets = entries.map(([k], i) => `${columns[k]!}=$${i + 4}`).join(', ');
      const r = await c.query(
        `UPDATE personal_records SET ${sets}, updated_at=now()
         WHERE tenant_id=$1 AND user_id=$2 AND id=$3
         RETURNING id, kind, title, provider, reference_number, amount_paise, periodic_amount_paise,
                   start_date, due_date, notes, created_at`,
        [request.auth.tenantId, request.auth.userId, id, ...entries.map(([, v]) => v)],
      );
      if (!r.rows[0]) throw Errors.notFound('Personal record');
      await writeAudit(c, request.auth, {
        action: 'PERSONAL_RECORD_UPDATED', entity: 'PersonalRecord', entityId: id, requestId: request.id,
      });
      return personalRecordView(r.rows[0]);
    });
  });

  app.delete('/personal-records/:id', { preHandler: requirePermission('company:write') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query('DELETE FROM personal_records WHERE tenant_id=$1 AND user_id=$2 AND id=$3',
        [request.auth.tenantId, request.auth.userId, id]);
      if (!r.rowCount) throw Errors.notFound('Personal record');
      await writeAudit(c, request.auth, {
        action: 'PERSONAL_RECORD_DELETED', entity: 'PersonalRecord', entityId: id, requestId: request.id,
      });
    });
    return reply.code(204).send();
  });
}
