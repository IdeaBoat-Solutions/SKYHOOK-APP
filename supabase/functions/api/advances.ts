/** Advances module ported from server/src/modules/advances/advances.routes.ts. */
import { withTenant, withTenantRead, type Queryable } from '../_shared/db.ts';
import { requirePermission } from '../_shared/rbac.ts';
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

export const advancesRoutes: Route[] = [
  {
    method: 'GET', path: '/advances',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'advance:read');
      const sp = ctx.url.searchParams;
      const employeeIdRaw = sp.get('employeeId');
      const employeeId = employeeIdRaw === null ? null : (() => {
        if (!UUID_RE.test(employeeIdRaw)) throw Errors.validation([{ field: 'employeeId', message: 'Must be a valid UUID' }]);
        return employeeIdRaw;
      })();
      const limit = queryLimit(sp);
      const result = await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT a.*, e.full_name AS employee_name, e.employee_code
           FROM salary_advances a JOIN employees e ON e.id=a.employee_id
           WHERE a.tenant_id=$1 AND ($2::uuid IS NULL OR a.employee_id=$2)
           ORDER BY a.advance_date DESC LIMIT $3`,
          [auth.tenantId, employeeId, limit],
        );
        return { items: r.rows, total: r.rowCount };
      });
      return json(result);
    },
  },
  {
    method: 'GET', path: '/advances/:id/recoveries',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'advance:read');
      const id = idFromPath(req);
      const result = await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT ar.*, r.run_code FROM advance_recoveries ar JOIN payroll_runs r ON r.id=ar.payroll_run_id
           WHERE ar.tenant_id=$1 AND ar.advance_id=$2 ORDER BY ar.recovery_date DESC`,
          [auth.tenantId, id],
        );
        return { items: r.rows };
      });
      return json(result);
    },
  },
  {
    method: 'POST', path: '/advances',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'advance:write');
      const b = await readJson(req);
      const employeeId = uuidField(b, 'employeeId');
      const date = strField(b, 'date', { required: true })!;
      const amountPaise = numField(b, 'amountPaise', { required: true, integer: true, min: 1 })!;
      const paymentMode = enumField(b, 'paymentMode', ['cash', 'bank_transfer', 'upi', 'cheque', 'company_card'], { required: true })!;
      const paymentReference = strField(b, 'paymentReference');
      const projectId = b?.projectId === undefined || b?.projectId === null ? undefined : uuidField(b, 'projectId');
      const remarks = strField(b, 'remarks');
      const created = await withTenant(auth.tenantId, async (c) => {
        const emp = await c.query(
          "SELECT id FROM employees WHERE tenant_id=$1 AND id=$2 AND employee_type='operator' AND status='active'",
          [auth.tenantId, employeeId],
        );
        if (!emp.rows[0]) throw Errors.validation([{ field: 'employeeId', message: 'Only active operators are eligible' }]);
        const seq = await c.query('SELECT count(*)::int n FROM salary_advances WHERE tenant_id=$1', [auth.tenantId]);
        const code = `ADV-${String(seq.rows[0].n + 1).padStart(3, '0')}`;
        const r = await c.query(
          `INSERT INTO salary_advances (tenant_id,advance_code,employee_id,advance_date,amount_paise,payment_mode,
            payment_reference,project_id,remarks,approved_by,outstanding_paise,created_by)
           VALUES ($1,$2,$3,$4::date,$5,$6::payment_mode,$7,$8,$9,$10,$5,$10) RETURNING *`,
          [auth.tenantId, code, employeeId, date, amountPaise, paymentMode,
            paymentReference ?? null, projectId ?? null, remarks ?? null, auth.userId],
        );
        await writeAudit(c, auth, { action: 'ADVANCE_GIVEN', entity: 'SalaryAdvance', entityId: r.rows[0].id, reason: `Advance of Rs.${(amountPaise / 100).toFixed(2)}`, requestId: ctx.requestId });
        return r.rows[0];
      });
      return json(created, 201);
    },
  },
  // Idempotent approval — advances are created approved by default; this records who approved.
  {
    method: 'POST', path: '/advances/:id/approve',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'advance:write');
      const id = idFromPath(req);
      const result = await withTenant(auth.tenantId, async (c) => {
        const r = await c.query(
          `UPDATE salary_advances SET status='approved', approved_by=$3, version=version+1
           WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [auth.tenantId, id, auth.userId],
        );
        if (!r.rows[0]) throw Errors.notFound('Advance');
        await writeAudit(c, auth, {
          action: 'ADVANCE_APPROVED', entity: 'SalaryAdvance', entityId: id, requestId: ctx.requestId,
        });
        return r.rows[0];
      });
      return json(result);
    },
  },
];
