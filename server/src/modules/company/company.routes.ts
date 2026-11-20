import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  tagline: z.string().optional(),
  gstNumber: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  authorizedSignatory: z.string().optional(),
  signatoryTitle: z.string().optional(),
  standardShiftMinutes: z.number().int().min(60).max(1440).optional(),
  payrollPaymentDay: z.number().int().min(1).max(28).optional(),
  emiReminderLeadDays: z.number().int().min(0).max(365).optional(),
  serviceReminderLeadDays: z.number().int().min(0).max(365).optional(),
  insuranceReminderLeadDays: z.number().int().min(0).max(365).optional(),
  pucReminderLeadDays: z.number().int().min(0).max(365).optional(),
  fitnessReminderLeadDays: z.number().int().min(0).max(365).optional(),
  licenseReminderLeadDays: z.number().int().min(0).max(365).optional(),
});

const COLUMN_MAP: Record<string, string> = {
  name: 'name', tagline: 'tagline', gstNumber: 'gst_number', address: 'address',
  city: 'city', state: 'state', pincode: 'pincode', phone: 'phone', email: 'email',
  authorizedSignatory: 'authorized_signatory', signatoryTitle: 'signatory_title',
  standardShiftMinutes: 'standard_shift_minutes', payrollPaymentDay: 'payroll_payment_day',
  emiReminderLeadDays: 'emi_reminder_lead_days', serviceReminderLeadDays: 'service_reminder_lead_days',
  insuranceReminderLeadDays: 'insurance_reminder_lead_days', pucReminderLeadDays: 'puc_reminder_lead_days',
  fitnessReminderLeadDays: 'fitness_reminder_lead_days', licenseReminderLeadDays: 'license_reminder_lead_days',
};

export async function companyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/company', { preHandler: requirePermission('company:read') }, async (request) => {
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query('SELECT * FROM company_settings WHERE tenant_id=$1', [request.auth.tenantId]);
      if (!r.rows[0]) throw Errors.notFound('Company settings');
      return r.rows[0];
    });
  });

  app.patch('/company', { preHandler: requirePermission('company:write') }, async (request) => {
    const body = patchSchema.parse(request.body);
    const entries = Object.entries(body).filter(([, v]) => v !== undefined);
    if (entries.length === 0) throw Errors.badRequest('No fields to update');

    return withTenant(request.auth.tenantId, async (c) => {
      const before = await c.query('SELECT * FROM company_settings WHERE tenant_id=$1', [request.auth.tenantId]);
      if (!before.rows[0]) throw Errors.notFound('Company settings');
      const sets = entries.map(([k], i) => `${COLUMN_MAP[k]!} = $${i + 2}`).join(', ');
      const values = entries.map(([, v]) => v);
      const r = await c.query(
        `UPDATE company_settings SET ${sets}, updated_by = $${entries.length + 2}
         WHERE tenant_id=$1 RETURNING *`,
        [request.auth.tenantId, ...values, request.auth.userId],
      );
      await writeAudit(c, request.auth, {
        action: 'SETTINGS_UPDATED', entity: 'CompanySettings', entityId: 'GLOBAL',
        reason: 'Company profile or payroll policies updated',
        previousValue: before.rows[0], updatedValue: r.rows[0], requestId: request.id,
      });
      return r.rows[0];
    });
  });
}
