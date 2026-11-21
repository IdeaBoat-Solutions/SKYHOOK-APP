/** Workforce/employees module ported from server/src/modules/workforce/workforce.routes.ts. */
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

function optStr(v: unknown, field: string): string | undefined {
  return v === undefined ? undefined : str(v, field, 0, 5000);
}

/** Blank strings from forms mean "not provided"; never send '' to a ::date cast. */
function optDate(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return str(v, field, 1, 40);
}

function optText(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = str(v, field, 0, 500);
  return s ? s : undefined;
}

function textList(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 30) {
    throw Errors.validation([{ field, message: 'Must be a list of up to 30 short strings' }]);
  }
  return v.map((x) => str(x, field, 1, 20));
}

function nullableStr(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return str(v, field, 0, 5000);
}

function email(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    throw Errors.validation([{ field, message: 'Must be a valid email' }]);
  }
  return v;
}

function enumOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw Errors.validation([{ field, message: `Must be one of: ${allowed.join(', ')}` }]);
  }
  return v as T;
}

function intVal(v: unknown, field: string, min?: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || (min !== undefined && v < min)) {
    throw Errors.validation([{ field, message: `Must be an integer${min !== undefined ? ` >= ${min}` : ''}` }]);
  }
  return v;
}

function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw Errors.validation([{ field, message: 'Must be a boolean' }]);
  return v;
}

const EMPLOYEE_TYPES = ['operator', 'manager', 'supervisor', 'accounts', 'office', 'other'] as const;
const SALARY_TYPES = ['daily', 'monthly'] as const;
const STATUSES = ['active', 'inactive', 'on_leave', 'terminated'] as const;

function idParam(ctx: RouteCtx): string {
  return ctx.params.id ?? '';
}

/** Add whole days to a yyyy-mm-dd date using UTC arithmetic (no timezone / DST drift). */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().split('T')[0]!;
}

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

export const workforceRoutes: Route[] = [
  {
    method: 'GET', path: '/employees',
    handler: async (ctx: RouteCtx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:read');
      const type = ctx.url.searchParams.get('type');
      const status = ctx.url.searchParams.get('status');
      const rawLimit = ctx.url.searchParams.get('limit');
      const limit = rawLimit == null ? 200 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit > 500) {
        throw Errors.validation([{ field: 'limit', message: 'Must be an integer <= 500' }]);
      }
      return withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT * FROM employees WHERE tenant_id=$1 AND deleted_at IS NULL
             AND ($2::text IS NULL OR employee_type::text = $2)
             AND ($3::text IS NULL OR status::text = $3)
           ORDER BY employee_code LIMIT $4`,
          [auth.tenantId, type, status, limit],
        );
        return json({ items: r.rows, total: r.rowCount });
      });
    },
  },
  {
    method: 'GET', path: '/employees/:id',
    handler: async (ctx: RouteCtx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:read');
      const id = idParam(ctx);
      return withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT e.*, (SELECT json_agg(x) FROM emergency_contacts x WHERE x.employee_id=e.id) AS contacts,
                  (SELECT json_agg(d) FROM documents d WHERE d.owner_type='employee' AND d.owner_id=e.id) AS documents
           FROM employees e WHERE e.tenant_id=$1 AND e.id=$2`,
          [auth.tenantId, id],
        );
        if (!r.rows[0]) throw Errors.notFound('Employee');
        return json(r.rows[0]);
      });
    },
  },
  {
    method: 'POST', path: '/employees',
    handler: async (ctx: RouteCtx, req: Request) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:write');
      const b = await readJson(req);
      const body = {
        fullName: str(b.fullName, 'fullName'),
        mobile: str(b.mobile, 'mobile'),
        email: b.email === '' || b.email === null ? undefined : email(b.email, 'email'),
        dateOfBirth: optDate(b.dateOfBirth, 'dateOfBirth'),
        joiningDate: str(b.joiningDate, 'joiningDate'),
        designation: str(b.designation, 'designation'),
        employeeType: enumOf(b.employeeType, 'employeeType', EMPLOYEE_TYPES),
        address: optStr(b.address, 'address'),
        salaryType: enumOf(b.salaryType, 'salaryType', SALARY_TYPES),
        dailyRatePaise: b.dailyRatePaise === undefined ? 0 : intVal(b.dailyRatePaise, 'dailyRatePaise', 0),
        monthlySalaryPaise: b.monthlySalaryPaise === undefined ? 0 : intVal(b.monthlySalaryPaise, 'monthlySalaryPaise', 0),
        standardShiftMinutes: b.standardShiftMinutes === undefined ? 600 : intVal(b.standardShiftMinutes, 'standardShiftMinutes'),
        overtimeEligible: b.overtimeEligible === undefined ? true : bool(b.overtimeEligible, 'overtimeEligible'),
        licenseNumber: optText(b.licenseNumber, 'licenseNumber'),
        craneLicenseDate: optDate(b.craneLicenseDate, 'craneLicenseDate'),
        craneLicenseExpiry: optDate(b.craneLicenseExpiry, 'craneLicenseExpiry'),
        transportLicenseDate: optDate(b.transportLicenseDate, 'transportLicenseDate'),
        transportLicenseExpiry: optDate(b.transportLicenseExpiry, 'transportLicenseExpiry'),
        guardianName: optText(b.guardianName, 'guardianName'),
        bloodGroup: optText(b.bloodGroup, 'bloodGroup'),
        licenseIssueDate: optDate(b.licenseIssueDate, 'licenseIssueDate'),
        licenseValidNt: optDate(b.licenseValidNt, 'licenseValidNt'),
        licenseValidTr: optDate(b.licenseValidTr, 'licenseValidTr'),
        licenseFirstIssueDate: optDate(b.licenseFirstIssueDate, 'licenseFirstIssueDate'),
        licenseIssuingState: optText(b.licenseIssuingState, 'licenseIssuingState'),
        licenseIssuingAuthority: optText(b.licenseIssuingAuthority, 'licenseIssuingAuthority'),
        licenseVehicleClasses: textList(b.licenseVehicleClasses, 'licenseVehicleClasses'),
        organDonor: b.organDonor === undefined || b.organDonor === null ? null : bool(b.organDonor, 'organDonor'),
        licenseScanned: b.licenseScanned === true,
      };

      return withTenant(auth.tenantId, async (c) => {
        const prefix = body.employeeType === 'operator' ? 'OP' : 'EMP';
        const seq = await c.query(
          `SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_code,'\\D','','g'),'')::bigint),0)::int AS n FROM employees
           WHERE tenant_id=$1 AND employee_code LIKE $2`,
          [auth.tenantId, `${prefix}-%`],
        );
        const code = `${prefix}-${String(seq.rows[0].n + 1).padStart(3, '0')}`;
        const r = await c.query(
          `INSERT INTO employees (tenant_id,employee_code,full_name,mobile,email,date_of_birth,
            joining_date,designation,employee_type,address,salary_type,daily_rate_paise,
            monthly_salary_paise,standard_shift_minutes,overtime_eligible,salary_effective_date,
            license_number,crane_license_expiry,transport_license_expiry,created_by,
            crane_license_issue_date,transport_license_issue_date,guardian_name,blood_group,license_issue_date,license_valid_nt,license_valid_tr,license_first_issue_date,license_issuing_state,license_issuing_authority,license_vehicle_classes,organ_donor,license_scanned_at)
           VALUES ($1,$2,$3,$4,$5,COALESCE($6::date,NULL),$7::date,$8,$9,$10,$11,$12,$13,$14,$15,
             CURRENT_DATE,$16,COALESCE($17::date,NULL),COALESCE($18::date,NULL),$19,
             $20::date,$21::date,$22,$23,$24::date,$25::date,$26::date,$27::date,$28,$29,$30::text[],$31,
             CASE WHEN $32::boolean THEN now() ELSE NULL END)
           RETURNING *`,
          [
            auth.tenantId, code, body.fullName, body.mobile, body.email ?? null,
            body.dateOfBirth ?? null, body.joiningDate, body.designation, body.employeeType,
            body.address ?? null, body.salaryType, body.dailyRatePaise, body.monthlySalaryPaise,
            body.standardShiftMinutes, body.overtimeEligible, body.licenseNumber ?? null,
            body.craneLicenseExpiry ?? null, body.transportLicenseExpiry ?? null, auth.userId,
            body.craneLicenseDate ?? null, body.transportLicenseDate ?? null, body.guardianName ?? null,
            body.bloodGroup ?? null, body.licenseIssueDate ?? null, body.licenseValidNt ?? null,
            body.licenseValidTr ?? null, body.licenseFirstIssueDate ?? null,
            body.licenseIssuingState ?? null, body.licenseIssuingAuthority ?? null,
            body.licenseVehicleClasses, body.organDonor, body.licenseScanned,
          ],
        );
        await writeAudit(c, auth, {
          action: 'EMPLOYEE_CREATED', entity: 'Employee', entityId: r.rows[0].id,
          reason: `Registered ${body.employeeType}: ${body.fullName}`, requestId: ctx.requestId,
        });
        return json(r.rows[0], 201);
      });
    },
  },
  {
    method: 'PATCH', path: '/employees/:id',
    handler: async (ctx: RouteCtx, req: Request) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:write');
      const id = idParam(ctx);
      const b = await readJson(req);
      // zod used .passthrough(); unknown keys remain but are filtered by `columns` below.
      const parsed: Record<string, unknown> = {};
      const s = (f: string, min = 1) => { if (b[f] !== undefined) parsed[f] = str(b[f], f, min, 5000); };
      const ns = (f: string) => { if (b[f] !== undefined) parsed[f] = nullableStr(b[f], f); };
      s('fullName'); s('mobile'); s('joiningDate'); s('designation');
      s('employeeType'); // validated against enum below
      s('salaryType');
      if (b.email !== undefined) {
        parsed.email = b.email === null ? null : email(b.email, 'email');
      }
      ns('dateOfBirth'); ns('address'); ns('licenseNumber'); ns('craneLicenseExpiry'); ns('transportLicenseExpiry');
      ns('craneLicenseDate'); ns('transportLicenseDate'); ns('guardianName'); ns('bloodGroup');
      ns('licenseIssueDate'); ns('licenseValidNt'); ns('licenseValidTr'); ns('licenseFirstIssueDate');
      ns('licenseIssuingState'); ns('licenseIssuingAuthority');
      if (b.licenseVehicleClasses !== undefined) parsed.licenseVehicleClasses = textList(b.licenseVehicleClasses, 'licenseVehicleClasses');
      if (b.organDonor !== undefined) parsed.organDonor = b.organDonor === null ? null : bool(b.organDonor, 'organDonor');
      if (b.employeeType !== undefined && b.employeeType !== null) {
        parsed.employeeType = enumOf(b.employeeType, 'employeeType', EMPLOYEE_TYPES);
      }
      if (b.salaryType !== undefined && b.salaryType !== null) {
        parsed.salaryType = enumOf(b.salaryType, 'salaryType', SALARY_TYPES);
      }
      if (b.status !== undefined && b.status !== null) {
        parsed.status = enumOf(b.status, 'status', STATUSES);
      }
      if (b.dailyRatePaise !== undefined) parsed.dailyRatePaise = intVal(b.dailyRatePaise, 'dailyRatePaise', 0);
      if (b.monthlySalaryPaise !== undefined) parsed.monthlySalaryPaise = intVal(b.monthlySalaryPaise, 'monthlySalaryPaise', 0);
      if (b.standardShiftMinutes !== undefined) parsed.standardShiftMinutes = intVal(b.standardShiftMinutes, 'standardShiftMinutes');
      if (b.overtimeEligible !== undefined) parsed.overtimeEligible = bool(b.overtimeEligible, 'overtimeEligible');

      const columns: Record<string, [string, string?]> = {
        fullName: ['full_name'], mobile: ['mobile'], email: ['email'],
        dateOfBirth: ['date_of_birth', '::date'], joiningDate: ['joining_date', '::date'],
        designation: ['designation'], employeeType: ['employee_type', '::employee_type'],
        address: ['address'], salaryType: ['salary_type', '::salary_type'],
        dailyRatePaise: ['daily_rate_paise'], monthlySalaryPaise: ['monthly_salary_paise'],
        standardShiftMinutes: ['standard_shift_minutes'], overtimeEligible: ['overtime_eligible'],
        licenseNumber: ['license_number'], craneLicenseExpiry: ['crane_license_expiry', '::date'],
        transportLicenseExpiry: ['transport_license_expiry', '::date'], status: ['status', '::employment_status'],
        craneLicenseDate: ['crane_license_issue_date', '::date'],
        transportLicenseDate: ['transport_license_issue_date', '::date'],
        guardianName: ['guardian_name'], bloodGroup: ['blood_group'],
        licenseIssueDate: ['license_issue_date', '::date'], licenseValidNt: ['license_valid_nt', '::date'],
        licenseValidTr: ['license_valid_tr', '::date'], licenseFirstIssueDate: ['license_first_issue_date', '::date'],
        licenseIssuingState: ['license_issuing_state'], licenseIssuingAuthority: ['license_issuing_authority'],
        licenseVehicleClasses: ['license_vehicle_classes', '::text[]'], organDonor: ['organ_donor'],
      };
      const entries = Object.entries(parsed).filter(([k, v]) => k in columns && v !== undefined);
      if (!entries.length) throw Errors.badRequest('No fields to update');

      return withTenant(auth.tenantId, async (c) => {
        const sets = entries
          .map(([k], i) => `${columns[k]![0]} = $${i + 4}${columns[k]![1] ?? ''}`)
          .join(', ');
        const values = entries.map(([k, v]) =>
          v === '' && columns[k]![1] === '::date' ? null : v,
        );
        const r = await c.query(
          `UPDATE employees SET ${sets}, updated_by=$3, updated_at=now()
           WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [auth.tenantId, id, auth.userId, ...values],
        );
        if (!r.rows[0]) throw Errors.notFound('Employee');
        await writeAudit(c, auth, {
          action: entries.some(([k]) => k === 'status') ? 'EMPLOYEE_STATUS_CHANGED' : 'EMPLOYEE_UPDATED',
          entity: 'Employee', entityId: id, requestId: ctx.requestId,
        });
        return json(r.rows[0]);
      });
    },
  },
  {
    method: 'POST', path: '/employees/:id/license-renewal',
    handler: async (ctx: RouteCtx, req: Request) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:write');
      const id = idParam(ctx);
      const b = await readJson(req);
      const body = {
        craneLicenseExpiry: optStr(b.craneLicenseExpiry, 'craneLicenseExpiry'),
        transportLicenseExpiry: optStr(b.transportLicenseExpiry, 'transportLicenseExpiry'),
        renewalDate: optStr(b.renewalDate, 'renewalDate'),
        intervalDays: b.intervalDays === undefined ? 1095 : intVal(b.intervalDays, 'intervalDays', 1),
      };

      return withTenant(auth.tenantId, async (c) => {
        const before = await c.query('SELECT * FROM employees WHERE tenant_id=$1 AND id=$2', [auth.tenantId, id]);
        if (!before.rows[0]) throw Errors.notFound('Employee');
        const renewal = body.renewalDate ?? new Date().toISOString().split('T')[0]!;
        const newExpiry = body.craneLicenseExpiry ?? addDays(renewal, body.intervalDays);
        const r = await c.query(
          `UPDATE employees SET crane_license_expiry=$3, transport_license_expiry=COALESCE($4,transport_license_expiry),
             updated_by=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [auth.tenantId, id, newExpiry, body.transportLicenseExpiry ?? null, auth.userId],
        );
        await c.query(
          `INSERT INTO compliance_renewals (tenant_id,category,target_type,target_id,renewal_date,previous_expiry,new_expiry,recorded_by)
           VALUES ($1,'license','employee',$2,$3::date,$4::date,$5::date,$6)`,
          [auth.tenantId, id, renewal, before.rows[0].crane_license_expiry, newExpiry, auth.userId],
        );
        await writeAudit(c, auth, {
          action: 'LICENSE_RENEWED', entity: 'Employee', entityId: id,
          reason: `Licence renewed until ${newExpiry}`, requestId: ctx.requestId,
        });
        return json(r.rows[0]);
      });
    },
  },
];
