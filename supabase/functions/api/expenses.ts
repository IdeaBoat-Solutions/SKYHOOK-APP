/** Expenses module ported from server/src/modules/expenses/expenses.routes.ts. */
import { withTenant, withTenantRead, type Queryable } from '../_shared/db.ts';
import { hasPermission, requirePermission } from '../_shared/rbac.ts';
import { Errors } from '../_shared/errors.ts';
import { json, readJson, routePath } from '../_shared/http.ts';
import type { AuthContext } from '../_shared/auth.ts';
import type { RouteCtx, Route } from '../_shared/types.ts';

/* ----------------------------- validators ----------------------------- */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function strField(
  b: any, field: string,
  opts: { required?: boolean; minLen?: number; fallback?: string } = {},
): string | undefined {
  const v = b?.[field];
  if (v === undefined || v === null) {
    if (opts.required) throw Errors.validation([{ field, message: 'Required' }]);
    return opts.fallback;
  }
  if (typeof v !== 'string') throw Errors.validation([{ field, message: 'Must be a string' }]);
  if (opts.minLen != null && v.length < opts.minLen) {
    throw Errors.validation([{ field, message: `Must be at least ${opts.minLen} characters` }]);
  }
  return v;
}

function numField(
  b: any, field: string,
  opts: { required?: boolean; integer?: boolean; min?: number; max?: number; fallback?: number } = {},
): number | undefined {
  const v = b?.[field];
  if (v === undefined || v === null) {
    if (opts.required) throw Errors.validation([{ field, message: 'Required' }]);
    return opts.fallback;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw Errors.validation([{ field, message: 'Must be a number' }]);
  }
  if (opts.integer && !Number.isInteger(v)) throw Errors.validation([{ field, message: 'Must be an integer' }]);
  if (opts.min != null && v < opts.min) throw Errors.validation([{ field, message: `Must be >= ${opts.min}` }]);
  if (opts.max != null && v > opts.max) throw Errors.validation([{ field, message: `Must be <= ${opts.max}` }]);
  return v;
}

function enumField<T extends string>(
  b: any, field: string, allowed: readonly T[],
  opts: { required?: boolean; fallback?: T } = {},
): T | undefined {
  const v = b?.[field];
  if (v === undefined || v === null) {
    if (opts.required) throw Errors.validation([{ field, message: 'Required' }]);
    return opts.fallback;
  }
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw Errors.validation([{ field, message: `Must be one of: ${allowed.join(', ')}` }]);
  }
  return v as T;
}

function uuidField(b: any, field: string): string {
  const v = strField(b, field, { required: true })!;
  if (!UUID_RE.test(v)) throw Errors.validation([{ field, message: 'Must be a valid UUID' }]);
  return v;
}

function queryLimit(sp: URLSearchParams): number {
  const raw = sp.get('limit');
  if (raw === null) return 200;
  const n = Number(raw);
  if (!Number.isInteger(n) || n > 500) {
    throw Errors.validation([{ field: 'limit', message: 'Must be an integer <= 500' }]);
  }
  return n;
}

function idFromPath(req: Request): string {
  return routePath(req).split('/').filter(Boolean)[1] ?? '';
}

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

export const expensesRoutes: Route[] = [
  {
    method: 'GET', path: '/expenses',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'expense:read');
      const sp = ctx.url.searchParams;
      const projectIdRaw = sp.get('projectId');
      const projectId = projectIdRaw === null ? null : (() => {
        if (!UUID_RE.test(projectIdRaw)) throw Errors.validation([{ field: 'projectId', message: 'Must be a valid UUID' }]);
        return projectIdRaw;
      })();
      const category = sp.get('category');
      const limit = queryLimit(sp);
      const result = await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT e.*, p.name AS project_name FROM project_expenses e JOIN projects p ON p.id=e.project_id
           WHERE e.tenant_id=$1 AND ($2::uuid IS NULL OR e.project_id=$2) AND ($3::text IS NULL OR e.category=$3)
           ORDER BY e.expense_date DESC LIMIT $4`,
          [auth.tenantId, projectId, category, limit],
        );
        return { items: r.rows, total: r.rowCount };
      });
      return json(result);
    },
  },
  {
    method: 'POST', path: '/expenses',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'expense:write');
      const b = await readJson(req);
      const projectId = uuidField(b, 'projectId');
      const date = strField(b, 'date', { required: true })!;
      const category = strField(b, 'category', { required: true, minLen: 1 })!;
      const description = strField(b, 'description', { required: true, minLen: 1 })!;
      const amountPaise = numField(b, 'amountPaise', { required: true, integer: true, min: 1 })!;
      const paymentMode = enumField(b, 'paymentMode', ['cash', 'company_card', 'bank_transfer', 'upi', 'cheque'], { required: true })!;
      const paidBy = strField(b, 'paidBy', { required: true, minLen: 1 })!;
      const vendor = strField(b, 'vendor');
      const receiptNumber = strField(b, 'receiptNumber');
      const remarks = strField(b, 'remarks');
      const created = await withTenant(auth.tenantId, async (c) => {
        const auto = hasPermission(auth, 'expense:approve');
        const seq = await c.query('SELECT count(*)::int n FROM project_expenses WHERE tenant_id=$1', [auth.tenantId]);
        const code = `EXP-${String(seq.rows[0].n + 1).padStart(3, '0')}`;
        const r = await c.query(
          `INSERT INTO project_expenses (tenant_id,expense_code,project_id,expense_date,category,description,
            amount_paise,payment_mode,paid_by,vendor,receipt_number,approval_status,approved_by,approved_at,remarks,created_by)
           VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8::payment_mode,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
          [auth.tenantId, code, projectId, date, category, description, amountPaise,
            paymentMode, paidBy, vendor ?? null, receiptNumber ?? null, auto ? 'approved' : 'draft',
            auto ? auth.userId : null, auto ? new Date().toISOString() : null, remarks ?? null, auth.userId],
        );
        await writeAudit(c, auth, { action: 'EXPENSE_CREATED', entity: 'ProjectExpense', entityId: r.rows[0].id, reason: `Voucher ${code} for Rs.${(amountPaise / 100).toFixed(2)}`, requestId: ctx.requestId });
        return r.rows[0];
      });
      return json(created, 201);
    },
  },
  {
    method: 'POST', path: '/expenses/:id/approve',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'expense:approve');
      const id = idFromPath(req);
      const result = await withTenant(auth.tenantId, async (c) => {
        const r = await c.query(
          `UPDATE project_expenses SET approval_status='approved', approved_by=$3, approved_at=now()
           WHERE tenant_id=$1 AND id=$2 AND approval_status='draft' RETURNING *`,
          [auth.tenantId, id, auth.userId],
        );
        if (!r.rows[0]) throw Errors.notFound('Pending expense voucher');
        await writeAudit(c, auth, { action: 'EXPENSE_APPROVED', entity: 'ProjectExpense', entityId: id, requestId: ctx.requestId });
        return r.rows[0];
      });
      return json(result);
    },
  },
];
