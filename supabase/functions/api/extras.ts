/** DB-backed extras: custom payroll lines and the owner's personal vault. */
import { withTenant, withTenantRead } from '../_shared/db.ts';
import { requirePermission } from '../_shared/rbac.ts';
import { Errors } from '../_shared/errors.ts';
import { corsHeaders, json, readJson } from '../_shared/http.ts';
import type { RouteCtx, Route } from '../_shared/types.ts';

/* ----------------------------- validators ----------------------------- */

function strField(b: any, field: string, min = 1, max = 500): string {
  const v = b?.[field];
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) {
    throw Errors.validation([{ field, message: `Must be a string of ${min}-${max} characters` }]);
  }
  return v.trim();
}

function optionalStrField(b: any, field: string, max = 2000): string | null {
  const v = b?.[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.length > max) {
    throw Errors.validation([{ field, message: `Must be a string of at most ${max} characters` }]);
  }
  return v.trim() || null;
}

/** Text that may be empty: missing, null and '' all become ''. */
function optionalText(b: any, field: string, max: number): string {
  const v = b?.[field];
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > max) {
    throw Errors.validation([{ field, message: `Must be text of at most ${max} characters` }]);
  }
  return v.trim();
}

function paiseField(b: any, field: string, required = false): number | undefined {
  const v = b?.[field];
  if (v === undefined || v === null) {
    if (required) throw Errors.validation([{ field, message: 'Required' }]);
    return undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
    throw Errors.validation([{ field, message: 'Must be an integer >= 0' }]);
  }
  return v;
}

/* ------------------------------ mappers ------------------------------- */

function toAdjustment(r: any) {
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

function toPersonalRecord(r: any) {
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
    updatedAt: r.updated_at,
  };
}

const ADJUSTMENT_COLUMNS =
  'id, month, employee_code, kind, label, amount_paise, remarks, created_at';

const PERSONAL_COLUMNS =
  `id, kind, title, provider, reference_number, amount_paise, periodic_amount_paise,
   start_date, due_date, notes, created_at, updated_at`;

/** Empty-but-valid 204 response (no JSON body), with the standard CORS headers. */
function noContent(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export const extrasRoutes: Route[] = [
  /* ---- Custom pay & deduction lines ---- */
  {
    method: 'GET', path: '/payroll-adjustments',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'payroll:read');
      const month = ctx.url.searchParams.get('month');
      if (month && !/^\d{4}-\d{2}$/.test(month)) {
        throw Errors.validation([{ field: 'month', message: 'Must be YYYY-MM' }]);
      }
      const items = await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT ${ADJUSTMENT_COLUMNS} FROM payroll_adjustments
           WHERE tenant_id = $1 AND ($2::text IS NULL OR month = $2)
           ORDER BY created_at, id`,
          [auth.tenantId, month],
        );
        return r.rows.map(toAdjustment);
      });
      return json({ items });
    },
  },
  {
    method: 'POST', path: '/payroll-adjustments',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'payroll:generate');
      const b = await readJson(req);
      const month = b?.month;
      if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
        throw Errors.validation([{ field: 'month', message: 'Must be YYYY-MM' }]);
      }
      const employeeCode = strField(b, 'employeeCode', 1, 120);
      const kind = b?.kind;
      if (kind !== 'pay' && kind !== 'deduction') {
        throw Errors.validation([{ field: 'kind', message: "Must be 'pay' or 'deduction'" }]);
      }
      const label = strField(b, 'label', 1, 120);
      const amountPaise = paiseField(b, 'amountPaise', true)!;
      const remarks = optionalStrField(b, 'remarks');

      const item = await withTenant(auth.tenantId, async (c) => {
        const r = await c.query(
          `INSERT INTO payroll_adjustments
             (id, tenant_id, month, employee_code, kind, label, amount_paise, remarks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING ${ADJUSTMENT_COLUMNS}`,
          [crypto.randomUUID(), auth.tenantId, month, employeeCode, kind, label, amountPaise, remarks],
        );
        return toAdjustment(r.rows[0]);
      });
      return json(item, 201);
    },
  },
  {
    method: 'DELETE', path: '/payroll-adjustments/:id',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'payroll:generate');
      await withTenant(auth.tenantId, async (c) => {
        const r = await c.query(
          'DELETE FROM payroll_adjustments WHERE tenant_id = $1 AND id = $2',
          [auth.tenantId, ctx.params.id],
        );
        if (r.rowCount === 0) throw Errors.notFound('Payroll adjustment');
      });
      return noContent();
    },
  },

  /* ---- Owner personal vault ---- */
  {
    method: 'GET', path: '/personal-records',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:read');
      const items = await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT ${PERSONAL_COLUMNS} FROM personal_records
           WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at, id`,
          [auth.tenantId, auth.userId],
        );
        return r.rows.map(toPersonalRecord);
      });
      return json({ items });
    },
  },
  {
    method: 'POST', path: '/personal-records',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:write');
      const b = await readJson(req);
      const kind = strField(b, 'kind', 1, 60);
      const title = strField(b, 'title', 1, 200);
      const provider = optionalText(b, 'provider', 200);
      const referenceNumber = optionalText(b, 'referenceNumber', 200);
      const amountPaise = paiseField(b, 'amountPaise') ?? 0;
      const periodicAmountPaise = paiseField(b, 'periodicAmountPaise') ?? 0;
      const startDate = optionalText(b, 'startDate', 32) || null;
      const dueDate = optionalText(b, 'dueDate', 32) || null;
      const notes = optionalStrField(b, 'notes');

      const item = await withTenant(auth.tenantId, async (c) => {
        const r = await c.query(
          `INSERT INTO personal_records
             (id, tenant_id, user_id, kind, title, provider, reference_number,
              amount_paise, periodic_amount_paise, start_date, due_date, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING ${PERSONAL_COLUMNS}`,
          [crypto.randomUUID(), auth.tenantId, auth.userId, kind, title, provider,
            referenceNumber, amountPaise, periodicAmountPaise, startDate, dueDate, notes],
        );
        return toPersonalRecord(r.rows[0]);
      });
      return json(item, 201);
    },
  },
  {
    method: 'PATCH', path: '/personal-records/:id',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:write');
      const raw = await readJson(req);
      const map: Record<string, string> = {
        kind: 'kind',
        title: 'title',
        provider: 'provider',
        referenceNumber: 'reference_number',
        amountPaise: 'amount_paise',
        periodicAmountPaise: 'periodic_amount_paise',
        startDate: 'start_date',
        dueDate: 'due_date',
        notes: 'notes',
      };
      const entries: Array<[string, unknown]> = [];
      for (const field of Object.keys(map)) {
        const v = raw?.[field];
        if (v === undefined) continue;
        if (field === 'amountPaise' || field === 'periodicAmountPaise') {
          entries.push([map[field]!, paiseField(raw, field, true)!]);
        } else if (field === 'provider' || field === 'referenceNumber') {
          entries.push([map[field]!, optionalText(raw, field, 200)]);
        } else if (field === 'startDate' || field === 'dueDate') {
          entries.push([map[field]!, optionalText(raw, field, 32) || null]);
        } else if (v === null) {
          if (field === 'notes') entries.push([map[field]!, null]);
          else throw Errors.validation([{ field, message: 'Required' }]);
        } else {
          entries.push([map[field]!, strField(raw, field)]);
        }
      }
      if (entries.length === 0) throw Errors.badRequest('No fields to update');

      const item = await withTenant(auth.tenantId, async (c) => {
        const sets = entries.map(([col], i) => `${col} = $${i + 4}`).join(', ');
        const r = await c.query(
          `UPDATE personal_records SET ${sets}, updated_at = now()
           WHERE tenant_id = $1 AND user_id = $2 AND id = $3
           RETURNING ${PERSONAL_COLUMNS}`,
          [auth.tenantId, auth.userId, ctx.params.id, ...entries.map(([, v]) => v)],
        );
        if (!r.rows[0]) throw Errors.notFound('Personal record');
        return toPersonalRecord(r.rows[0]);
      });
      return json(item);
    },
  },
  {
    method: 'DELETE', path: '/personal-records/:id',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:write');
      await withTenant(auth.tenantId, async (c) => {
        const r = await c.query(
          'DELETE FROM personal_records WHERE tenant_id = $1 AND user_id = $2 AND id = $3',
          [auth.tenantId, auth.userId, ctx.params.id],
        );
        if (r.rowCount === 0) throw Errors.notFound('Personal record');
      });
      return noContent();
    },
  },
];
