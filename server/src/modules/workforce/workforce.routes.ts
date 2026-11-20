import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';
import { addDays } from '../../domain/calculations.js';

const createSchema = z.object({
  fullName: z.string().min(1),
  mobile: z.string().min(1),
  email: z.string().email().optional(),
  dateOfBirth: z.string().optional(),
  joiningDate: z.string().min(1),
  designation: z.string().min(1),
  employeeType: z.enum(['operator', 'manager', 'supervisor', 'accounts', 'office', 'other']),
  address: z.string().optional(),
  salaryType: z.enum(['daily', 'monthly']),
  dailyRatePaise: z.number().int().nonnegative().default(0),
  monthlySalaryPaise: z.number().int().nonnegative().default(0),
  standardShiftMinutes: z.number().int().default(600),
  overtimeEligible: z.boolean().default(true),
  licenseNumber: z.string().optional(),
  craneLicenseExpiry: z.string().optional(),
  transportLicenseExpiry: z.string().optional(),
});

export async function workforceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/employees', { preHandler: requirePermission('employee:read') }, async (request) => {
    const q = z.object({
      type: z.string().optional(), status: z.string().optional(), limit: z.coerce.number().int().max(500).default(200),
    }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT * FROM employees WHERE tenant_id=$1 AND deleted_at IS NULL
           AND ($2::text IS NULL OR employee_type::text = $2)
           AND ($3::text IS NULL OR status::text = $3)
         ORDER BY employee_code LIMIT $4`,
        [request.auth.tenantId, q.type ?? null, q.status ?? null, q.limit],
      );
      return { items: r.rows, total: r.rowCount };
    });
  });

  app.get('/employees/:id', { preHandler: requirePermission('employee:read') }, async (request) => {
    const { id } = request.params as { id: string };
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT e.*, (SELECT json_agg(x) FROM emergency_contacts x WHERE x.employee_id=e.id) AS contacts,
                (SELECT json_agg(d) FROM documents d WHERE d.owner_type='employee' AND d.owner_id=e.id) AS documents
         FROM employees e WHERE e.tenant_id=$1 AND e.id=$2`,
        [request.auth.tenantId, id],
      );
      if (!r.rows[0]) throw Errors.notFound('Employee');
      return r.rows[0];
    });
  });

  app.post('/employees', { preHandler: requirePermission('employee:write') }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const prefix = body.employeeType === 'operator' ? 'OP' : 'EMP';
      const seq = await c.query(
        `SELECT count(*)::int AS n FROM employees
         WHERE tenant_id=$1 AND employee_code LIKE $2`,
        [request.auth.tenantId, `${prefix}-%`],
      );
      const code = `${prefix}-${String(seq.rows[0].n + 1).padStart(3, '0')}`;
      const r = await c.query(
        `INSERT INTO employees (tenant_id,employee_code,full_name,mobile,email,date_of_birth,
          joining_date,designation,employee_type,address,salary_type,daily_rate_paise,
          monthly_salary_paise,standard_shift_minutes,overtime_eligible,salary_effective_date,
          license_number,crane_license_expiry,transport_license_expiry,created_by)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6::date,NULL),$7::date,$8,$9,$10,$11,$12,$13,$14,$15,
           CURRENT_DATE,$16,COALESCE($17::date,NULL),COALESCE($18::date,NULL),$19)
         RETURNING *`,
        [
          request.auth.tenantId, code, body.fullName, body.mobile, body.email ?? null,
          body.dateOfBirth ?? null, body.joiningDate, body.designation, body.employeeType,
          body.address ?? null, body.salaryType, body.dailyRatePaise, body.monthlySalaryPaise,
          body.standardShiftMinutes, body.overtimeEligible, body.licenseNumber ?? null,
          body.craneLicenseExpiry ?? null, body.transportLicenseExpiry ?? null, request.auth.userId,
        ],
      );
      await writeAudit(c, request.auth, {
        action: 'EMPLOYEE_CREATED', entity: 'Employee', entityId: r.rows[0].id,
        reason: `Registered ${body.employeeType}: ${body.fullName}`, requestId: request.id,
      });
      return reply.code(201).send(r.rows[0]);
    });
  });

  // SPA profile edits and deactivation. Unknown camelCase keys sent by the client
  // are ignored; only mapped columns are written.
  app.patch('/employees/:id', { preHandler: requirePermission('employee:write') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      fullName: z.string().min(1).optional(),
      mobile: z.string().min(1).optional(),
      email: z.string().email().nullable().optional(),
      dateOfBirth: z.string().nullable().optional(),
      joiningDate: z.string().optional(),
      designation: z.string().optional(),
      employeeType: z.enum(['operator', 'manager', 'supervisor', 'accounts', 'office', 'other']).optional(),
      address: z.string().nullable().optional(),
      salaryType: z.enum(['daily', 'monthly']).optional(),
      dailyRatePaise: z.number().int().nonnegative().optional(),
      monthlySalaryPaise: z.number().int().nonnegative().optional(),
      standardShiftMinutes: z.number().int().optional(),
      overtimeEligible: z.boolean().optional(),
      licenseNumber: z.string().nullable().optional(),
      craneLicenseExpiry: z.string().nullable().optional(),
      transportLicenseExpiry: z.string().nullable().optional(),
      status: z.enum(['active', 'inactive', 'on_leave', 'terminated']).optional(),
    }).passthrough().parse(request.body);

    const columns: Record<string, [string, string?]> = {
      fullName: ['full_name'], mobile: ['mobile'], email: ['email'],
      dateOfBirth: ['date_of_birth', '::date'], joiningDate: ['joining_date', '::date'],
      designation: ['designation'], employeeType: ['employee_type', '::employee_type'],
      address: ['address'], salaryType: ['salary_type', '::salary_type'],
      dailyRatePaise: ['daily_rate_paise'], monthlySalaryPaise: ['monthly_salary_paise'],
      standardShiftMinutes: ['standard_shift_minutes'], overtimeEligible: ['overtime_eligible'],
      licenseNumber: ['license_number'], craneLicenseExpiry: ['crane_license_expiry', '::date'],
      transportLicenseExpiry: ['transport_license_expiry', '::date'], status: ['status', '::employment_status'],
    };
    const entries = Object.entries(body).filter(([k, v]) => k in columns && v !== undefined);
    if (!entries.length) throw Errors.badRequest('No fields to update');

    return withTenant(request.auth.tenantId, async (c) => {
      const sets = entries
        .map(([k], i) => `${columns[k]![0]} = $${i + 4}${columns[k]![1] ?? ''}`)
        .join(', ');
      const values = entries.map(([k, v]) =>
        v === '' && columns[k]![1] === '::date' ? null : v,
      );
      const r = await c.query(
        `UPDATE employees SET ${sets}, updated_by=$3, updated_at=now()
         WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [request.auth.tenantId, id, request.auth.userId, ...values],
      );
      if (!r.rows[0]) throw Errors.notFound('Employee');
      await writeAudit(c, request.auth, {
        action: entries.some(([k]) => k === 'status') ? 'EMPLOYEE_STATUS_CHANGED' : 'EMPLOYEE_UPDATED',
        entity: 'Employee', entityId: id, requestId: request.id,
      });
      return r.rows[0];
    });
  });

  app.post('/employees/:id/license-renewal', { preHandler: requirePermission('employee:write') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      craneLicenseExpiry: z.string().optional(),
      transportLicenseExpiry: z.string().optional(),
      renewalDate: z.string().optional(),
      intervalDays: z.number().int().positive().default(1095),
    }).parse(request.body);

    return withTenant(request.auth.tenantId, async (c) => {
      const before = await c.query('SELECT * FROM employees WHERE tenant_id=$1 AND id=$2', [request.auth.tenantId, id]);
      if (!before.rows[0]) throw Errors.notFound('Employee');
      const renewal = body.renewalDate ?? new Date().toISOString().split('T')[0]!;
      const newExpiry = body.craneLicenseExpiry ?? addDays(renewal, body.intervalDays);
      const r = await c.query(
        `UPDATE employees SET crane_license_expiry=$3, transport_license_expiry=COALESCE($4,transport_license_expiry),
           updated_by=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [request.auth.tenantId, id, newExpiry, body.transportLicenseExpiry ?? null, request.auth.userId],
      );
      await c.query(
        `INSERT INTO compliance_renewals (tenant_id,category,target_type,target_id,renewal_date,previous_expiry,new_expiry,recorded_by)
         VALUES ($1,'license','employee',$2,$3::date,$4::date,$5::date,$6)`,
        [request.auth.tenantId, id, renewal, before.rows[0].crane_license_expiry, newExpiry, request.auth.userId],
      );
      await writeAudit(c, request.auth, {
        action: 'LICENSE_RENEWED', entity: 'Employee', entityId: id,
        reason: `Licence renewed until ${newExpiry}`, requestId: request.id,
      });
      return r.rows[0];
    });
  });
}
