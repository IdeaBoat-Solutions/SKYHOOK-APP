import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';

const createSchema = z.object({
  name: z.string().min(1),
  clientName: z.string().min(1),
  clientPhone: z.string().min(1),
  clientEmail: z.string().optional(),
  location: z.string().optional(),
  siteAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  startDate: z.string().min(1),
  expectedEndDate: z.string().min(1),
  otRatePaisePerHour: z.number().int().nonnegative().default(0),
  contractValuePaise: z.number().int().nonnegative().optional(),
  description: z.string().optional(),
  status: z.enum(['upcoming', 'active', 'on_hold', 'completed', 'cancelled']).default('upcoming'),
});

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects', { preHandler: requirePermission('project:read') }, async (request) => {
    const q = z.object({ status: z.string().optional(), limit: z.coerce.number().int().max(500).default(200) }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT * FROM projects WHERE tenant_id=$1 AND deleted_at IS NULL
           AND ($2::text IS NULL OR status::text=$2) ORDER BY project_code LIMIT $3`,
        [request.auth.tenantId, q.status ?? null, q.limit],
      );
      return { items: r.rows, total: r.rowCount };
    });
  });

  app.get('/projects/:id', { preHandler: requirePermission('project:read') }, async (request) => {
    const { id } = request.params as { id: string };
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query('SELECT * FROM projects WHERE tenant_id=$1 AND id=$2', [request.auth.tenantId, id]);
      if (!r.rows[0]) throw Errors.notFound('Project');
      return r.rows[0];
    });
  });

  app.post('/projects', { preHandler: requirePermission('project:write') }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const seq = await c.query('SELECT count(*)::int AS n FROM projects WHERE tenant_id=$1', [request.auth.tenantId]);
      const code = `PRJ-${String(seq.rows[0].n + 1).padStart(3, '0')}`;
      const r = await c.query(
        `INSERT INTO projects (tenant_id,project_code,name,client_name,client_phone,client_email,
          location,site_address,city,state,start_date,expected_end_date,ot_rate_paise_per_hour,
          contract_value_paise,description,status,manager_id,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12::date,$13,$14,$15,$16,$17,$17)
         RETURNING *`,
        [
          request.auth.tenantId, code, body.name, body.clientName, body.clientPhone, body.clientEmail ?? null,
          body.location ?? null, body.siteAddress ?? null, body.city ?? null, body.state ?? null,
          body.startDate, body.expectedEndDate, body.otRatePaisePerHour, body.contractValuePaise ?? null,
          body.description ?? null, body.status, request.auth.userId,
        ],
      );
      await writeAudit(c, request.auth, {
        action: 'PROJECT_CREATED', entity: 'Project', entityId: r.rows[0].id,
        reason: `Created project: ${body.name}`, requestId: request.id,
      });
      return reply.code(201).send(r.rows[0]);
    });
  });

  app.patch('/projects/:id', { preHandler: requirePermission('project:write') }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      name: z.string().optional(), status: z.string().optional(),
      otRatePaisePerHour: z.number().int().nonnegative().optional(),
      contractValuePaise: z.number().int().nonnegative().optional(),
      description: z.string().optional(),
    }).parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const before = await c.query('SELECT * FROM projects WHERE tenant_id=$1 AND id=$2', [request.auth.tenantId, id]);
      if (!before.rows[0]) throw Errors.notFound('Project');
      const map: Record<string, string> = {
        name: 'name', status: 'status', otRatePaisePerHour: 'ot_rate_paise_per_hour',
        contractValuePaise: 'contract_value_paise', description: 'description',
      };
      const entries = Object.entries(body).filter(([, v]) => v !== undefined);
      if (!entries.length) throw Errors.badRequest('No fields to update');
      const sets = entries.map(([k], i) => `${map[k]!} = $${i + 3}`).join(', ');
      const r = await c.query(
        `UPDATE projects SET ${sets}, updated_by=$2 WHERE tenant_id=$1 AND id=$3 RETURNING *`,
        [request.auth.tenantId, request.auth.userId, id, ...entries.map(([, v]) => v)],
      );
      await writeAudit(c, request.auth, {
        action: 'PROJECT_UPDATED', entity: 'Project', entityId: id,
        previousValue: before.rows[0], updatedValue: r.rows[0], requestId: request.id,
      });
      return r.rows[0];
    });
  });
}
