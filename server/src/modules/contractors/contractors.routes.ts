import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';

const CONTRACTOR_COLUMNS = `id, contractor_code, full_name, mobile, skill, agency_name,
  daily_rate_paise, city, availability, notes, created_at, updated_at`;

const skills = ['crane_operator', 'rigger', 'bankman', 'electrician', 'fitter', 'driver', 'other'] as const;
const availability = ['available', 'busy', 'unknown'] as const;

function contractorView(r: any) {
  return {
    id: r.id,
    contractorCode: r.contractor_code,
    fullName: r.full_name,
    mobile: r.mobile,
    skill: r.skill,
    agencyName: r.agency_name ?? undefined,
    dailyRatePaise: r.daily_rate_paise,
    city: r.city ?? undefined,
    availability: r.availability,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  };
}

const createSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
  mobile: z.string().trim().min(1).max(32),
  skill: z.enum(skills).default('crane_operator'),
  agencyName: z.string().trim().max(160).optional(),
  dailyRatePaise: z.number().int().nonnegative().default(0),
  city: z.string().trim().max(120).optional(),
  availability: z.enum(availability).default('available'),
  notes: z.string().trim().max(2000).optional(),
});

const patchSchema = createSchema.partial();

/** External/freelancer operators and contractors — contact records, not workforce employees. */
export async function contractorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/contractors', { preHandler: requirePermission('employee:read') }, async (request) => {
    const q = z.object({
      skill: z.enum(skills).optional(),
      availability: z.enum(availability).optional(),
      search: z.string().max(120).optional(),
      limit: z.coerce.number().int().max(500).default(300),
    }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT ${CONTRACTOR_COLUMNS} FROM contractors
         WHERE tenant_id=$1
           AND ($2::text IS NULL OR skill::text=$2)
           AND ($3::text IS NULL OR availability::text=$3)
           AND ($4::text IS NULL OR full_name ILIKE '%'||$4||'%' OR mobile ILIKE '%'||$4||'%' OR agency_name ILIKE '%'||$4||'%')
         ORDER BY contractor_code LIMIT $5`,
        [request.auth.tenantId, q.skill ?? null, q.availability ?? null, q.search ?? null, q.limit],
      );
      return { items: r.rows.map(contractorView), total: r.rowCount };
    });
  });

  app.post('/contractors', { preHandler: requirePermission('employee:write') }, async (request, reply) => {
    const b = createSchema.parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const seq = await c.query(
        'SELECT COALESCE(MAX(CAST(SUBSTRING(contractor_code FROM 4) AS INTEGER)),0)+1 AS next FROM contractors WHERE tenant_id=$1',
        [request.auth.tenantId],
      );
      const code = `EXT-${String(seq.rows[0].next).padStart(3, '0')}`;
      const r = await c.query(
        `INSERT INTO contractors (tenant_id, contractor_code, full_name, mobile, skill, agency_name,
           daily_rate_paise, city, availability, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING ${CONTRACTOR_COLUMNS}`,
        [request.auth.tenantId, code, b.fullName, b.mobile, b.skill, b.agencyName ?? null,
          b.dailyRatePaise, b.city ?? null, b.availability, b.notes ?? null, request.auth.userId],
      );
      const item = contractorView(r.rows[0]);
      await writeAudit(c, request.auth, {
        action: 'CONTRACTOR_ADDED', entity: 'Contractor', entityId: item.id, requestId: request.id,
      });
      return reply.code(201).send(item);
    });
  });

  app.patch('/contractors/:id', { preHandler: requirePermission('employee:write') }, async (request) => {
    const { id } = request.params as { id: string };
    const b = patchSchema.parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const columns: Record<string, string> = {
        fullName: 'full_name', mobile: 'mobile', skill: 'skill', agencyName: 'agency_name',
        dailyRatePaise: 'daily_rate_paise', city: 'city', availability: 'availability', notes: 'notes',
      };
      const entries = Object.entries(b).filter(([, v]) => v !== undefined);
      if (!entries.length) throw Errors.badRequest('No fields to update');
      const sets = entries.map(([k], i) => `${columns[k]!}=$${i + 3}`).join(', ');
      const r = await c.query(
        `UPDATE contractors SET ${sets}, updated_at=now()
         WHERE tenant_id=$1 AND id=$2 RETURNING ${CONTRACTOR_COLUMNS}`,
        [request.auth.tenantId, id, ...entries.map(([, v]) => v)],
      );
      if (!r.rows[0]) throw Errors.notFound('Contractor');
      await writeAudit(c, request.auth, {
        action: 'CONTRACTOR_UPDATED', entity: 'Contractor', entityId: id, requestId: request.id,
      });
      return contractorView(r.rows[0]);
    });
  });

  app.delete('/contractors/:id', { preHandler: requirePermission('employee:write') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query('DELETE FROM contractors WHERE tenant_id=$1 AND id=$2', [request.auth.tenantId, id]);
      if (!r.rowCount) throw Errors.notFound('Contractor');
      await writeAudit(c, request.auth, {
        action: 'CONTRACTOR_DELETED', entity: 'Contractor', entityId: id, requestId: request.id,
      });
    });
    return reply.code(204).send();
  });
}
