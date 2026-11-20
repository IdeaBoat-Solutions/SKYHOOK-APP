import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';
import { businessDate } from '../../common/date.js';
import { addDays, addMonths, evaluateReminderStatus, nextServiceDate } from '../../domain/calculations.js';

const createSchema = z.object({
  assetCode: z.string().optional(),
  machineType: z.enum(['hydraulic_crane', 'mobile_crane', 'crawler_crane', 'tower_crane', 'hydra', 'all_terrain_crane', 'rough_terrain_crane', 'other']),
  make: z.string().min(1),
  model: z.string().min(1),
  registrationNumber: z.string().min(1),
  serialNumber: z.string().optional(),
  tonnageCapacity: z.number().nonnegative().optional(),
  purchaseDate: z.string().optional(),
  purchaseCostPaise: z.number().int().nonnegative().optional(),
  serviceFrequencyValue: z.number().int().positive().default(500),
  serviceFrequencyUnit: z.enum(['days', 'months', 'hours']).default('hours'),
  serviceReminderLeadHours: z.number().nonnegative().default(50),
  lastServiceDate: z.string().optional(),
  insuranceProvider: z.string().optional(),
  insurancePolicyNumber: z.string().optional(),
  insuranceExpiryDate: z.string().optional(),
  insuranceIntervalDays: z.number().int().positive().default(365),
  pucNumber: z.string().optional(),
  pucIssueDate: z.string().optional(),
  pucExpiryDate: z.string().optional(),
  pucIntervalDays: z.number().int().positive().default(180),
  fitnessCertificateNumber: z.string().optional(),
  lastFitnessDate: z.string().optional(),
  nextFitnessDueDate: z.string().optional(),
  fitnessIntervalDays: z.number().int().positive().default(730),
  status: z.enum(['available', 'assigned', 'under_maintenance', 'inactive', 'sold']).default('available'),
});

export async function machineRoutes(app: FastifyInstance): Promise<void> {
  app.get('/machines', { preHandler: requirePermission('machine:read') }, async (request) => {
    const q = z.object({ type: z.string().optional(), status: z.string().optional(), limit: z.coerce.number().int().max(500).default(200) }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT machines.*,
                (SELECT sr.odometer_or_hours FROM service_records sr
                 WHERE sr.machine_id = machines.id
                 ORDER BY sr.service_date DESC LIMIT 1) AS last_service_hours
         FROM machines WHERE tenant_id=$1 AND deleted_at IS NULL
           AND ($2::text IS NULL OR machine_type::text=$2) AND ($3::text IS NULL OR status::text=$3)
         ORDER BY asset_code LIMIT $4`,
        [request.auth.tenantId, q.type ?? null, q.status ?? null, q.limit],
      );
      return { items: r.rows, total: r.rowCount };
    });
  });

  app.get('/machines/:id', { preHandler: requirePermission('machine:read') }, async (request) => {
    const { id } = request.params as { id: string };
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT machines.*,
                (SELECT sr.odometer_or_hours FROM service_records sr
                 WHERE sr.machine_id = machines.id
                 ORDER BY sr.service_date DESC LIMIT 1) AS last_service_hours
         FROM machines WHERE tenant_id=$1 AND id=$2`,
        [request.auth.tenantId, id],
      );
      if (!r.rows[0]) throw Errors.notFound('Machine');
      return r.rows[0];
    });
  });

  app.post('/machines', { preHandler: requirePermission('machine:write') }, async (request, reply) => {
    const b = createSchema.parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const code = b.assetCode ?? `CR-${String((await c.query('SELECT count(*)::int n FROM machines WHERE tenant_id=$1', [request.auth.tenantId])).rows[0].n + 1).padStart(3, '0')}`;
      const r = await c.query(
        `INSERT INTO machines (tenant_id,asset_code,machine_type,make,model,registration_number,serial_number,
          tonnage_capacity,purchase_date,purchase_cost_paise,service_frequency_value,service_frequency_unit,
          last_service_date,next_service_due_date,insurance_provider,insurance_policy_number,
          insurance_expiry_date,insurance_interval_days,puc_number,puc_issue_date,puc_expiry_date,
          puc_interval_days,fitness_certificate_number,last_fitness_date,next_fitness_due_date,
          fitness_interval_days,status,created_by,service_reminder_lead_hours)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13::date,$14::date,$15,$16,$17::date,$18,
           $19,$20::date,$21::date,$22,$23,$24::date,$25::date,$26,$27,$28,$29) RETURNING *`,
        [request.auth.tenantId, code, b.machineType, b.make, b.model, b.registrationNumber, b.serialNumber ?? null,
          b.tonnageCapacity ?? null, b.purchaseDate ?? null, b.purchaseCostPaise ?? null,
          b.serviceFrequencyValue, b.serviceFrequencyUnit, b.lastServiceDate ?? null,
          // Hour-based servicing has no calendar date — store NULL instead.
          b.lastServiceDate ? (nextServiceDate(b.lastServiceDate, b.serviceFrequencyValue, b.serviceFrequencyUnit) || null) : null,
          b.insuranceProvider ?? null, b.insurancePolicyNumber ?? null, b.insuranceExpiryDate ?? null, b.insuranceIntervalDays,
          b.pucNumber ?? null, b.pucIssueDate ?? null, b.pucExpiryDate ?? null, b.pucIntervalDays,
          b.fitnessCertificateNumber ?? null, b.lastFitnessDate ?? null, b.nextFitnessDueDate ?? null,
          b.fitnessIntervalDays, b.status, request.auth.userId, b.serviceReminderLeadHours],
      );
      await writeAudit(c, request.auth, { action: 'ASSET_CREATED', entity: 'MachineAsset', entityId: r.rows[0].id, reason: `Registered ${b.make} ${b.model}`, requestId: request.id });
      return reply.code(201).send(r.rows[0]);
    });
  });

  app.patch('/machines/:id', { preHandler: requirePermission('machine:write') }, async (request) => {
    const { id } = request.params as { id: string };
    const b = z.object({
      status: z.string().optional(), currentProjectId: z.string().uuid().optional().nullable(),
      assignedOperatorId: z.string().uuid().optional().nullable(),
      serviceFrequencyValue: z.number().int().positive().optional(),
      serviceFrequencyUnit: z.enum(['days', 'months', 'hours']).optional(),
      serviceReminderLeadHours: z.number().nonnegative().optional(),
    }).parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const map: Record<string, string> = { status: 'status', currentProjectId: 'current_project_id', assignedOperatorId: 'assigned_operator_id', serviceFrequencyValue: 'service_frequency_value', serviceFrequencyUnit: 'service_frequency_unit', serviceReminderLeadHours: 'service_reminder_lead_hours' };
      const entries = Object.entries(b).filter(([, v]) => v !== undefined);
      if (!entries.length) throw Errors.badRequest('No fields to update');
      // Values occupy $4..$n; $3 is the machine id in WHERE.
      const sets = entries.map(([k], i) => `${map[k]!} = $${i + 4}`).join(', ');
      const r = await c.query(`UPDATE machines SET ${sets}, updated_by=$2 WHERE tenant_id=$1 AND id=$3 RETURNING *`,
        [request.auth.tenantId, request.auth.userId, id, ...entries.map(([, v]) => v)]);
      if (!r.rows[0]) throw Errors.notFound('Machine');
      await writeAudit(c, request.auth, { action: 'ASSET_UPDATED', entity: 'MachineAsset', entityId: id, requestId: request.id });
      return r.rows[0];
    });
  });

  app.get('/machines/:id/service-history', { preHandler: requirePermission('machine:read') }, async (request) => {
    const { id } = request.params as { id: string };
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query('SELECT * FROM service_records WHERE tenant_id=$1 AND machine_id=$2 ORDER BY service_date DESC', [request.auth.tenantId, id]);
      return { items: r.rows };
    });
  });

  app.post('/machines/:id/service', { preHandler: requirePermission('machine:write') }, async (request) => {
    const { id } = request.params as { id: string };
    const b = z.object({
      serviceDate: z.string(), serviceProvider: z.string().optional(), costPaise: z.number().int().nonnegative().default(0),
      notes: z.string().optional(), odometerOrHours: z.number().optional(),
    }).parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const m = await c.query('SELECT * FROM machines WHERE tenant_id=$1 AND id=$2', [request.auth.tenantId, id]);
      if (!m.rows[0]) throw Errors.notFound('Machine');
      const next = nextServiceDate(b.serviceDate, m.rows[0].service_frequency_value, m.rows[0].service_frequency_unit) || null;
      await c.query(
        `INSERT INTO service_records (tenant_id,machine_id,service_date,service_type,service_provider,cost_paise,odometer_or_hours,notes,completed_by)
         VALUES ($1,$2,$3::date,'Periodic Maintenance',$4,$5,$6,$7,$8)`,
        [request.auth.tenantId, id, b.serviceDate, b.serviceProvider ?? 'Authorized Service Agency', b.costPaise, b.odometerOrHours ?? null, b.notes ?? null, request.auth.userId],
      );
      const r = await c.query('UPDATE machines SET last_service_date=$3::date, next_service_due_date=$4::date, updated_by=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *',
        [request.auth.tenantId, id, b.serviceDate, next, request.auth.userId]);
      await writeAudit(c, request.auth, { action: 'SERVICE_COMPLETED', entity: 'MachineAsset', entityId: id, reason: `Service completed, next due ${next}`, requestId: request.id });
      return r.rows[0];
    });
  });

  app.post('/machines/:id/renewals', { preHandler: requirePermission('machine:write') }, async (request) => {
    const { id } = request.params as { id: string };
    const b = z.object({
      category: z.enum(['insurance', 'puc', 'fitness']),
      renewalDate: z.string(), newExpiry: z.string().optional(),
      intervalDays: z.number().int().positive().optional(),
      provider: z.string().optional(), referenceNumber: z.string().optional(),
    }).parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const m = await c.query('SELECT * FROM machines WHERE tenant_id=$1 AND id=$2', [request.auth.tenantId, id]);
      if (!m.rows[0]) throw Errors.notFound('Machine');
      const machine = m.rows[0];
      const defaultInterval = b.category === 'insurance' ? machine.insurance_interval_days ?? 365 : b.category === 'puc' ? machine.puc_interval_days ?? 180 : machine.fitness_interval_days ?? 730;
      const interval = b.intervalDays ?? defaultInterval;
      const expiry = b.newExpiry ?? addDays(b.renewalDate, interval);
      const previousExpiry = b.category === 'insurance' ? machine.insurance_expiry_date
        : b.category === 'puc' ? machine.puc_expiry_date : machine.next_fitness_due_date;

      let updated: any;
      if (b.category === 'insurance') {
        updated = await c.query(`UPDATE machines SET insurance_expiry_date=$3::date, insurance_start_date=$4::date, insurance_provider=$5, insurance_policy_number=$6, updated_by=$7 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [request.auth.tenantId, id, expiry, b.renewalDate, b.provider ?? machine.insurance_provider, b.referenceNumber ?? machine.insurance_policy_number, request.auth.userId]);
      } else if (b.category === 'puc') {
        updated = await c.query(`UPDATE machines SET puc_expiry_date=$3::date, puc_issue_date=$4::date, puc_number=$5, updated_by=$6 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [request.auth.tenantId, id, expiry, b.renewalDate, b.referenceNumber ?? machine.puc_number, request.auth.userId]);
      } else {
        updated = await c.query(`UPDATE machines SET next_fitness_due_date=$3::date, last_fitness_date=$4::date, fitness_certificate_number=$5, updated_by=$6 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [request.auth.tenantId, id, expiry, b.renewalDate, b.referenceNumber ?? machine.fitness_certificate_number, request.auth.userId]);
      }
      await c.query(
        `INSERT INTO compliance_renewals (tenant_id,category,target_type,target_id,renewal_date,previous_expiry,new_expiry,provider,reference_number,recorded_by)
         VALUES ($1,$2::reminder_category,'machine',$3,$4::date,$5::date,$6::date,$7,$8,$9)`,
        [request.auth.tenantId, b.category, id, b.renewalDate, previousExpiry, expiry, b.provider ?? null, b.referenceNumber ?? null, request.auth.userId],
      );
      await writeAudit(c, request.auth, { action: `${b.category.toUpperCase()}_RENEWED`, entity: 'MachineAsset', entityId: id, reason: `Renewed until ${expiry}`, requestId: request.id });
      return updated.rows[0];
    });
  });

  app.get('/machines/:id/documents', { preHandler: requirePermission('machine:read') }, async (request) => {
    const { id } = request.params as { id: string };
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query("SELECT * FROM documents WHERE tenant_id=$1 AND owner_type='machine' AND owner_id=$2 ORDER BY uploaded_at DESC", [request.auth.tenantId, id]);
      return { items: r.rows };
    });
  });

  app.get('/compliance/upcoming', { preHandler: requirePermission('machine:read') }, async (request) => {
    return withTenantRead(request.auth.tenantId, async (c) => {
      const rules = await c.query('SELECT category, lead_days FROM reminder_rules WHERE tenant_id=$1 AND enabled', [request.auth.tenantId]);
      const lead = (cat: string) => rules.rows.find((r: any) => r.category === cat)?.lead_days ?? 15;
      const rows = await c.query('SELECT * FROM v_upcoming_renewals WHERE tenant_id=$1 AND due_date IS NOT NULL ORDER BY due_date', [request.auth.tenantId]);
      const today = businessDate();
      return {
        items: rows.rows.map((r: any) => {
          const ev = evaluateReminderStatus(r.due_date, lead(r.category), today);
          return { ...r, daysRemaining: ev.daysRemaining, status: ev.status, urgencyLabel: ev.label };
        }).filter((r: any) => r.status !== 'none'),
      };
    });
  });
}
