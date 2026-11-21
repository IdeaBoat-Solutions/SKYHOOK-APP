/** Machines / asset module ported from server/src/modules/machines/machines.routes.ts. */
import { withTenant, withTenantRead, type Queryable } from '../_shared/db.ts';
import { config } from '../_shared/config.ts';
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

/** RC (registration certificate) fields: text or number, nothing else. */
const RC_TEXT_KEYS = [
  'chassisNumber', 'engineNumber', 'registrationDate', 'registrationValidUpto', 'ownerName',
  'ownership', 'ownerAddress', 'vehicleClass', 'makerName', 'bodyType', 'colour', 'fuel',
  'emissionNorms', 'manufactureMonthYear', 'financier', 'registrationAuthority', 'cardIssueDate', 'scannedAt',
] as const;
const RC_NUMBER_KEYS = [
  'ownerSerial', 'cylinders', 'seatingCapacity', 'unladenWeightKg', 'cubicCapacityCc', 'horsePower', 'wheelBaseMm',
] as const;

/** Whitelist + type-check the rcDetails object; returns JSON text for a jsonb column. */
function rcDetailsField(b: any): string | undefined {
  const v = b?.rcDetails;
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw Errors.validation([{ field: 'rcDetails', message: 'Must be an object' }]);
  }
  const out: Record<string, string | number> = {};
  for (const key of RC_TEXT_KEYS) {
    const x = v[key];
    if (x === undefined || x === null || x === '') continue;
    if (typeof x !== 'string' || x.length > 300) {
      throw Errors.validation([{ field: `rcDetails.${key}`, message: 'Must be text (max 300 chars)' }]);
    }
    out[key] = x.trim();
  }
  for (const key of RC_NUMBER_KEYS) {
    const x = v[key];
    if (x === undefined || x === null || x === '') continue;
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) {
      throw Errors.validation([{ field: `rcDetails.${key}`, message: 'Must be a non-negative number' }]);
    }
    out[key] = x;
  }
  return JSON.stringify(out);
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

/* ------------------------ calculations / helpers ----------------------- */
function businessDate(): string {
  // Today in India (en-CA formats as yyyy-mm-dd). The old DEMO_DATE override is ignored so a
  // leftover secret can never pin reminders to a past date.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0]!;
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0]!;
}

function nextServiceDate(lastService: string, value: number, unit: 'days' | 'months' | 'hours'): string {
  // Hour-based servicing has no calendar due date (due point is an hour reading).
  if (unit === 'hours') return '';
  return unit === 'days' ? addDays(lastService, value) : addMonths(lastService, value);
}

function evaluateReminderStatus(
  dueDateStr: string | null | undefined,
  leadDays: number,
  currentDateStr: string,
): { daysRemaining: number; status: 'overdue' | 'due_today' | 'upcoming' | 'none'; label: string } {
  if (!dueDateStr) return { daysRemaining: 9999, status: 'none', label: 'No Due Date' };
  const due = new Date(dueDateStr);
  const curr = new Date(currentDateStr);
  const utc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const daysRemaining = Math.round((utc(due) - utc(curr)) / 86_400_000);
  if (daysRemaining < 0) {
    const n = Math.abs(daysRemaining);
    return { daysRemaining, status: 'overdue', label: `Overdue by ${n} Day${n === 1 ? '' : 's'}` };
  }
  if (daysRemaining === 0) return { daysRemaining, status: 'due_today', label: 'Due Today' };
  if (daysRemaining <= leadDays) {
    return { daysRemaining, status: 'upcoming', label: `Due in ${daysRemaining} Day${daysRemaining === 1 ? '' : 's'}` };
  }
  return { daysRemaining, status: 'none', label: `Scheduled (${daysRemaining} days away)` };
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

const MACHINE_TYPES = [
  'hydraulic_crane', 'mobile_crane', 'crawler_crane', 'tower_crane',
  'hydra', 'all_terrain_crane', 'rough_terrain_crane', 'other',
] as const;
const MACHINE_STATUSES = ['available', 'assigned', 'under_maintenance', 'inactive', 'sold'] as const;

export const machinesRoutes: Route[] = [
  {
    method: 'GET', path: '/machines',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'machine:read');
      const sp = ctx.url.searchParams;
      const type = sp.get('type');
      const status = sp.get('status');
      const limit = queryLimit(sp);
      const result = await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT *, (SELECT sr.odometer_or_hours FROM service_records sr
             WHERE sr.machine_id = machines.id
             ORDER BY sr.service_date DESC LIMIT 1) AS last_service_hours
           FROM machines WHERE tenant_id=$1 AND deleted_at IS NULL
             AND ($2::text IS NULL OR machine_type::text=$2) AND ($3::text IS NULL OR status::text=$3)
           ORDER BY asset_code LIMIT $4`,
          [auth.tenantId, type, status, limit],
        );
        return { items: r.rows, total: r.rowCount };
      });
      return json(result);
    },
  },
  {
    method: 'GET', path: '/machines/:id',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'machine:read');
      const id = idFromPath(req);
      const result = await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT *, (SELECT sr.odometer_or_hours FROM service_records sr
             WHERE sr.machine_id = machines.id
             ORDER BY sr.service_date DESC LIMIT 1) AS last_service_hours
           FROM machines WHERE tenant_id=$1 AND id=$2`,
          [auth.tenantId, id],
        );
        if (!r.rows[0]) throw Errors.notFound('Machine');
        return r.rows[0];
      });
      return json(result);
    },
  },
  {
    method: 'POST', path: '/machines',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'machine:write');
      const b = await readJson(req);
      const assetCode = strField(b, 'assetCode');
      const machineType = enumField(b, 'machineType', MACHINE_TYPES, { required: true })!;
      const make = strField(b, 'make', { required: true, minLen: 1 })!;
      const model = strField(b, 'model', { required: true, minLen: 1 })!;
      const registrationNumber = strField(b, 'registrationNumber', { required: true, minLen: 1 })!;
      const serialNumber = strField(b, 'serialNumber');
      const tonnageCapacity = numField(b, 'tonnageCapacity', { min: 0 });
      const purchaseDate = strField(b, 'purchaseDate');
      const purchaseCostPaise = numField(b, 'purchaseCostPaise', { integer: true, min: 0 });
      const serviceFrequencyValue = numField(b, 'serviceFrequencyValue', { integer: true, min: 1, fallback: 500 })!;
      const serviceFrequencyUnit = enumField(b, 'serviceFrequencyUnit', ['days', 'months', 'hours'], { fallback: 'hours' })!;
      const serviceReminderLeadHours = numField(b, 'serviceReminderLeadHours', { min: 0, fallback: 50 })!;
      const lastServiceDate = strField(b, 'lastServiceDate');
      const insuranceProvider = strField(b, 'insuranceProvider');
      const insurancePolicyNumber = strField(b, 'insurancePolicyNumber');
      const insuranceExpiryDate = strField(b, 'insuranceExpiryDate');
      const insuranceIntervalDays = numField(b, 'insuranceIntervalDays', { integer: true, min: 1, fallback: 365 })!;
      const pucNumber = strField(b, 'pucNumber');
      const pucIssueDate = strField(b, 'pucIssueDate');
      const pucExpiryDate = strField(b, 'pucExpiryDate');
      const pucIntervalDays = numField(b, 'pucIntervalDays', { integer: true, min: 1, fallback: 180 })!;
      const fitnessCertificateNumber = strField(b, 'fitnessCertificateNumber');
      const lastFitnessDate = strField(b, 'lastFitnessDate');
      const nextFitnessDueDate = strField(b, 'nextFitnessDueDate');
      const fitnessIntervalDays = numField(b, 'fitnessIntervalDays', { integer: true, min: 1, fallback: 730 })!;
      const status = enumField(b, 'status', MACHINE_STATUSES, { fallback: 'available' })!;
      const rcDetails = rcDetailsField(b);
      const created = await withTenant(auth.tenantId, async (c) => {
        const code = assetCode ?? `CR-${String((await c.query('SELECT count(*)::int n FROM machines WHERE tenant_id=$1', [auth.tenantId])).rows[0].n + 1).padStart(3, '0')}`;
        const r = await c.query(
          `INSERT INTO machines (tenant_id,asset_code,machine_type,make,model,registration_number,serial_number,
            tonnage_capacity,purchase_date,purchase_cost_paise,service_frequency_value,service_frequency_unit,
            last_service_date,next_service_due_date,insurance_provider,insurance_policy_number,
            insurance_expiry_date,insurance_interval_days,puc_number,puc_issue_date,puc_expiry_date,
            puc_interval_days,fitness_certificate_number,last_fitness_date,next_fitness_due_date,
            fitness_interval_days,status,created_by,service_reminder_lead_hours,rc_details,insurance_start_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13::date,$14::date,$15,$16,$17::date,$18,
             $19,$20::date,$21::date,$22,$23,$24::date,$25::date,$26,$27,$28,$29,$30::jsonb,$31::date) RETURNING *`,
          [auth.tenantId, code, machineType, make, model, registrationNumber, serialNumber ?? null,
            tonnageCapacity ?? null, purchaseDate ?? null, purchaseCostPaise ?? null,
            serviceFrequencyValue, serviceFrequencyUnit, lastServiceDate ?? null,
            lastServiceDate ? (nextServiceDate(lastServiceDate, serviceFrequencyValue, serviceFrequencyUnit) || null) : null,
            insuranceProvider ?? null, insurancePolicyNumber ?? null, insuranceExpiryDate ?? null, insuranceIntervalDays,
            pucNumber ?? null, pucIssueDate ?? null, pucExpiryDate ?? null, pucIntervalDays,
            fitnessCertificateNumber ?? null, lastFitnessDate ?? null, nextFitnessDueDate ?? null,
            fitnessIntervalDays, status, auth.userId, serviceReminderLeadHours, rcDetails ?? '{}', strField(b, 'insuranceStartDate') ?? null],
        );
        await writeAudit(c, auth, { action: 'ASSET_CREATED', entity: 'MachineAsset', entityId: r.rows[0].id, reason: `Registered ${make} ${model}`, requestId: ctx.requestId });
        return r.rows[0];
      });
      return json(created, 201);
    },
  },
  {
    method: 'PATCH', path: '/machines/:id',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'machine:write');
      const id = idFromPath(req);
      const raw = await readJson(req);
      const b: Record<string, unknown> = {};
      if (raw?.status !== undefined && raw?.status !== null) b.status = strField(raw, 'status', { required: true });
      if (raw?.currentProjectId !== undefined) b.currentProjectId = raw.currentProjectId === null ? null : uuidField(raw, 'currentProjectId');
      if (raw?.assignedOperatorId !== undefined) b.assignedOperatorId = raw.assignedOperatorId === null ? null : uuidField(raw, 'assignedOperatorId');
      if (raw?.serviceFrequencyValue !== undefined && raw?.serviceFrequencyValue !== null) {
        b.serviceFrequencyValue = numField(raw, 'serviceFrequencyValue', { integer: true, min: 1 });
      }
      if (raw?.serviceFrequencyUnit !== undefined && raw?.serviceFrequencyUnit !== null) {
        b.serviceFrequencyUnit = enumField(raw, 'serviceFrequencyUnit', ['days', 'months', 'hours']);
      }
      if (raw?.serviceReminderLeadHours !== undefined && raw?.serviceReminderLeadHours !== null) {
        b.serviceReminderLeadHours = numField(raw, 'serviceReminderLeadHours', { min: 0 });
      }
      // Identity fields, editable so a corrected or newly scanned RC can be saved.
      if (raw?.machineType != null) b.machineType = enumField(raw, 'machineType', MACHINE_TYPES);
      for (const key of ['make', 'model', 'registrationNumber'] as const) {
        if (raw?.[key] != null) b[key] = strField(raw, key, { minLen: 1 });
      }
      if (raw?.serialNumber !== undefined) b.serialNumber = raw.serialNumber === null ? null : strField(raw, 'serialNumber');
      if (raw?.tonnageCapacity != null) b.tonnageCapacity = numField(raw, 'tonnageCapacity', { min: 0 });
      if (raw?.rcDetails != null) b.rcDetails = rcDetailsField(raw);
      // Statutory and service details, so the Edit form really saves what it shows.
      for (const key of ['insuranceProvider', 'insurancePolicyNumber', 'pucNumber', 'fitnessCertificateNumber'] as const) {
        if (raw?.[key] !== undefined) b[key] = raw[key] === null || raw[key] === '' ? null : strField(raw, key);
      }
      for (const key of ['purchaseDate', 'lastServiceDate', 'nextServiceDueDate', 'insuranceStartDate', 'insuranceExpiryDate', 'pucIssueDate', 'pucExpiryDate', 'lastFitnessDate', 'nextFitnessDueDate'] as const) {
        const v = raw?.[key];
        if (v === undefined) continue;
        if (v === null || v === '') b[key] = null;
        else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) b[key] = v;
        else throw Errors.validation([{ field: key, message: 'Must be a date (YYYY-MM-DD)' }]);
      }
      for (const key of ['insuranceIntervalDays', 'pucIntervalDays', 'fitnessIntervalDays'] as const) {
        if (raw?.[key] != null) b[key] = numField(raw, key, { integer: true, min: 1 });
      }
      if (raw?.purchaseCostPaise != null) b.purchaseCostPaise = numField(raw, 'purchaseCostPaise', { integer: true, min: 0 });
      const result = await withTenant(auth.tenantId, async (c) => {
        const map: Record<string, string> = { purchaseDate: 'purchase_date', purchaseCostPaise: 'purchase_cost_paise', lastServiceDate: 'last_service_date', nextServiceDueDate: 'next_service_due_date', insuranceProvider: 'insurance_provider', insurancePolicyNumber: 'insurance_policy_number', insuranceStartDate: 'insurance_start_date', insuranceExpiryDate: 'insurance_expiry_date', insuranceIntervalDays: 'insurance_interval_days', pucNumber: 'puc_number', pucIssueDate: 'puc_issue_date', pucExpiryDate: 'puc_expiry_date', pucIntervalDays: 'puc_interval_days', fitnessCertificateNumber: 'fitness_certificate_number', lastFitnessDate: 'last_fitness_date', nextFitnessDueDate: 'next_fitness_due_date', fitnessIntervalDays: 'fitness_interval_days', status: 'status', currentProjectId: 'current_project_id', assignedOperatorId: 'assigned_operator_id', serviceFrequencyValue: 'service_frequency_value', serviceFrequencyUnit: 'service_frequency_unit', serviceReminderLeadHours: 'service_reminder_lead_hours', machineType: 'machine_type', make: 'make', model: 'model', registrationNumber: 'registration_number', serialNumber: 'serial_number', tonnageCapacity: 'tonnage_capacity', rcDetails: 'rc_details' };
        const entries = Object.entries(b).filter(([, v]) => v !== undefined);
        if (!entries.length) throw Errors.badRequest('No fields to update');
        // Fixed upstream off-by-one: values occupy $4..$n; $3 is the id in WHERE.
        const sets = entries.map(([k], i) => `${map[k]!} = $${i + 4}${k === 'rcDetails' ? '::jsonb' : ''}`).join(', ');
        const r = await c.query(`UPDATE machines SET ${sets}, updated_by=$2 WHERE tenant_id=$1 AND id=$3 RETURNING *`,
          [auth.tenantId, auth.userId, id, ...entries.map(([, v]) => v)]);
        if (!r.rows[0]) throw Errors.notFound('Machine');
        await writeAudit(c, auth, { action: 'ASSET_UPDATED', entity: 'MachineAsset', entityId: id, requestId: ctx.requestId });
        return r.rows[0];
      });
      return json(result);
    },
  },
  {
    method: 'GET', path: '/machines/:id/service-history',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'machine:read');
      const id = idFromPath(req);
      const result = await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query('SELECT * FROM service_records WHERE tenant_id=$1 AND machine_id=$2 ORDER BY service_date DESC', [auth.tenantId, id]);
        return { items: r.rows };
      });
      return json(result);
    },
  },
  {
    method: 'POST', path: '/machines/:id/service',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'machine:write');
      const id = idFromPath(req);
      const b = await readJson(req);
      const serviceDate = strField(b, 'serviceDate', { required: true })!;
      const serviceProvider = strField(b, 'serviceProvider');
      const costPaise = numField(b, 'costPaise', { integer: true, min: 0, fallback: 0 })!;
      const notes = strField(b, 'notes');
      const odometerOrHours = numField(b, 'odometerOrHours');
      const result = await withTenant(auth.tenantId, async (c) => {
        const m = await c.query('SELECT * FROM machines WHERE tenant_id=$1 AND id=$2', [auth.tenantId, id]);
        if (!m.rows[0]) throw Errors.notFound('Machine');
        const next = nextServiceDate(serviceDate, m.rows[0].service_frequency_value, m.rows[0].service_frequency_unit) || null;
        await c.query(
          `INSERT INTO service_records (tenant_id,machine_id,service_date,service_type,service_provider,cost_paise,odometer_or_hours,notes,completed_by)
           VALUES ($1,$2,$3::date,'Periodic Maintenance',$4,$5,$6,$7,$8)`,
          [auth.tenantId, id, serviceDate, serviceProvider ?? 'Authorized Service Agency', costPaise, odometerOrHours ?? null, notes ?? null, auth.userId],
        );
        const r = await c.query('UPDATE machines SET last_service_date=$3::date, next_service_due_date=$4::date, updated_by=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *',
          [auth.tenantId, id, serviceDate, next, auth.userId]);
        await writeAudit(c, auth, { action: 'SERVICE_COMPLETED', entity: 'MachineAsset', entityId: id, reason: `Service completed, next due ${next}`, requestId: ctx.requestId });
        return r.rows[0];
      });
      return json(result);
    },
  },
  {
    method: 'POST', path: '/machines/:id/renewals',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'machine:write');
      const id = idFromPath(req);
      const b = await readJson(req);
      const category = enumField(b, 'category', ['insurance', 'puc', 'fitness'], { required: true })!;
      const renewalDate = strField(b, 'renewalDate', { required: true })!;
      const newExpiry = strField(b, 'newExpiry');
      const intervalDays = numField(b, 'intervalDays', { integer: true, min: 1 });
      const provider = strField(b, 'provider');
      const referenceNumber = strField(b, 'referenceNumber');
      const result = await withTenant(auth.tenantId, async (c) => {
        const m = await c.query('SELECT * FROM machines WHERE tenant_id=$1 AND id=$2', [auth.tenantId, id]);
        if (!m.rows[0]) throw Errors.notFound('Machine');
        const machine = m.rows[0];
        const defaultInterval = category === 'insurance' ? machine.insurance_interval_days ?? 365 : category === 'puc' ? machine.puc_interval_days ?? 180 : machine.fitness_interval_days ?? 730;
        const interval = intervalDays ?? defaultInterval;
        const expiry = newExpiry ?? addDays(renewalDate, interval);
        const previousExpiry = category === 'insurance' ? machine.insurance_expiry_date
          : category === 'puc' ? machine.puc_expiry_date : machine.next_fitness_due_date;

        let updated: any;
        if (category === 'insurance') {
          updated = await c.query(`UPDATE machines SET insurance_expiry_date=$3::date, insurance_start_date=$4::date, insurance_provider=$5, insurance_policy_number=$6, updated_by=$7 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [auth.tenantId, id, expiry, renewalDate, provider ?? machine.insurance_provider, referenceNumber ?? machine.insurance_policy_number, auth.userId]);
        } else if (category === 'puc') {
          updated = await c.query(`UPDATE machines SET puc_expiry_date=$3::date, puc_issue_date=$4::date, puc_number=$5, updated_by=$6 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [auth.tenantId, id, expiry, renewalDate, referenceNumber ?? machine.puc_number, auth.userId]);
        } else {
          updated = await c.query(`UPDATE machines SET next_fitness_due_date=$3::date, last_fitness_date=$4::date, fitness_certificate_number=$5, updated_by=$6 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
            [auth.tenantId, id, expiry, renewalDate, referenceNumber ?? machine.fitness_certificate_number, auth.userId]);
        }
        await c.query(
          `INSERT INTO compliance_renewals (tenant_id,category,target_type,target_id,renewal_date,previous_expiry,new_expiry,provider,reference_number,recorded_by)
           VALUES ($1,$2::reminder_category,'machine',$3,$4::date,$5::date,$6::date,$7,$8,$9)`,
          [auth.tenantId, category, id, renewalDate, previousExpiry, expiry, provider ?? null, referenceNumber ?? null, auth.userId],
        );
        await writeAudit(c, auth, { action: `${category.toUpperCase()}_RENEWED`, entity: 'MachineAsset', entityId: id, reason: `Renewed until ${expiry}`, requestId: ctx.requestId });
        return updated.rows[0];
      });
      return json(result);
    },
  },
  {
    method: 'GET', path: '/machines/:id/documents',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'machine:read');
      const id = idFromPath(req);
      const result = await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query("SELECT * FROM documents WHERE tenant_id=$1 AND owner_type='machine' AND owner_id=$2 ORDER BY uploaded_at DESC", [auth.tenantId, id]);
        return { items: r.rows };
      });
      return json(result);
    },
  },
  {
    method: 'GET', path: '/compliance/upcoming',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'machine:read');
      const result = await withTenantRead(auth.tenantId, async (c) => {
        const rules = await c.query('SELECT category, lead_days FROM reminder_rules WHERE tenant_id=$1 AND enabled', [auth.tenantId]);
        const lead = (cat: string) => rules.rows.find((r: any) => r.category === cat)?.lead_days ?? 15;
        const rows = await c.query('SELECT * FROM v_upcoming_renewals WHERE tenant_id=$1 AND due_date IS NOT NULL ORDER BY due_date', [auth.tenantId]);
        const today = businessDate();
        return {
          items: rows.rows.map((r: any) => {
            const ev = evaluateReminderStatus(r.due_date, lead(r.category), today);
            return { ...r, daysRemaining: ev.daysRemaining, status: ev.status, urgencyLabel: ev.label };
          }).filter((r: any) => r.status !== 'none'),
        };
      });
      return json(result);
    },
  },
];
