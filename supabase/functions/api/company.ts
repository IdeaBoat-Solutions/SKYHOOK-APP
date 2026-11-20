/** Company settings module ported from server/src/modules/company/company.routes.ts. */
import { withTenant, withTenantRead, type Queryable } from '../_shared/db.ts';
import { requirePermission } from '../_shared/rbac.ts';
import { Errors, ApiError } from '../_shared/errors.ts';
import { json, readJson } from '../_shared/http.ts';
import type { RouteCtx, Route } from '../_shared/types.ts';
import type { AuthContext } from '../_shared/auth.ts';

function str(v: unknown, field: string, min = 1, max = 500): string {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) {
    throw Errors.validation([{ field, message: `Must be a string of ${min}-${max} characters` }]);
  }
  return v.trim();
}

function intInRange(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw Errors.validation([{ field, message: `Must be an integer between ${min} and ${max}` }]);
  }
  return v;
}

const STRING_FIELDS = [
  'name', 'tagline', 'gstNumber', 'address', 'city', 'state', 'pincode', 'phone',
  'email', 'authorizedSignatory', 'signatoryTitle',
] as const;

const NUMERIC_FIELDS: Record<string, [number, number]> = {
  standardShiftMinutes: [60, 1440],
  payrollPaymentDay: [1, 28],
  emiReminderLeadDays: [0, 365],
  serviceReminderLeadDays: [0, 365],
  insuranceReminderLeadDays: [0, 365],
  pucReminderLeadDays: [0, 365],
  fitnessReminderLeadDays: [0, 365],
  licenseReminderLeadDays: [0, 365],
};

/** Manual equivalent of patchSchema.parse — unknown keys are stripped like zod. */
function parsePatch(b: any): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of STRING_FIELDS) {
    if (b[f] === undefined) continue;
    if (f === 'name') out[f] = str(b[f], f, 1, 500);
    else if (typeof b[f] !== 'string') {
      throw Errors.validation([{ field: f, message: 'Must be a string' }]);
    } else out[f] = b[f];
  }
  for (const [f, [min, max]] of Object.entries(NUMERIC_FIELDS)) {
    if (b[f] === undefined) continue;
    out[f] = intInRange(b[f], f, min, max);
  }
  return out;
}

const COLUMN_MAP: Record<string, string> = {
  name: 'name', tagline: 'tagline', gstNumber: 'gst_number', address: 'address',
  city: 'city', state: 'state', pincode: 'pincode', phone: 'phone', email: 'email',
  authorizedSignatory: 'authorized_signatory', signatoryTitle: 'signatory_title',
  standardShiftMinutes: 'standard_shift_minutes', payrollPaymentDay: 'payroll_payment_day',
  emiReminderLeadDays: 'emi_reminder_lead_days', serviceReminderLeadDays: 'service_reminder_lead_days',
  insuranceReminderLeadDays: 'insurance_reminder_lead_days', pucReminderLeadDays: 'puc_reminder_lead_days',
  fitnessReminderLeadDays: 'fitness_reminder_lead_days', licenseReminderLeadDays: 'license_reminder_lead_days',
};

async function writeAudit(
  c: Queryable,
  auth: AuthContext,
  input: {
    action: string; entity: string; entityId: string; reason?: string;
    previousValue?: unknown; updatedValue?: unknown; requestId?: string;
  },
): Promise<void> {
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

export const companyRoutes: Route[] = [
  {
    method: 'GET', path: '/company',
    handler: async (ctx: RouteCtx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:read');
      return withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query('SELECT * FROM company_settings WHERE tenant_id=$1', [auth.tenantId]);
        if (!r.rows[0]) throw Errors.notFound('Company settings');
        return json(r.rows[0]);
      });
    },
  },
  {
    method: 'PATCH', path: '/company',
    handler: async (ctx: RouteCtx, req: Request) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:write');
      const b = await readJson(req);
      const body = parsePatch(b);
      const entries = Object.entries(body).filter(([, v]) => v !== undefined);
      if (entries.length === 0) throw Errors.badRequest('No fields to update');

      return withTenant(auth.tenantId, async (c) => {
        const before = await c.query('SELECT * FROM company_settings WHERE tenant_id=$1', [auth.tenantId]);
        if (!before.rows[0]) throw Errors.notFound('Company settings');
        const sets = entries.map(([k], i) => `${COLUMN_MAP[k]!} = $${i + 2}`).join(', ');
        const values = entries.map(([, v]) => v);
        const r = await c.query(
          `UPDATE company_settings SET ${sets}, updated_by = $${entries.length + 2}
           WHERE tenant_id=$1 RETURNING *`,
          [auth.tenantId, ...values, auth.userId],
        );
        await writeAudit(c, auth, {
          action: 'SETTINGS_UPDATED', entity: 'CompanySettings', entityId: 'GLOBAL',
          reason: 'Company profile or payroll policies updated',
          previousValue: before.rows[0], updatedValue: r.rows[0], requestId: ctx.requestId,
        });
        return json(r.rows[0]);
      });
    },
  },
];
