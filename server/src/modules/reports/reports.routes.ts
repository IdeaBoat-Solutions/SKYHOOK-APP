import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { type ExportKind } from './export.service.js';

const KINDS: ExportKind[] = ['payroll', 'expenses', 'attendance', 'assets', 'workforce', 'machine_hours'];

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/reports/exports', { preHandler: requirePermission('report:export') }, async (request, reply) => {
    const b = z.object({ kind: z.enum(KINDS), month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(request.body);
    const jobId = randomUUID();
    await withTenant(request.auth.tenantId, async (c) => {
      await c.query(
        `INSERT INTO export_jobs (id,tenant_id,kind,parameters,status,requested_by) VALUES ($1,$2,$3,$4,'queued',$5)`,
        [jobId, request.auth.tenantId, b.kind, JSON.stringify(b), request.auth.userId],
      );
    });
    // The job row is the source of truth; the worker processes it durably.
    return reply.code(202).send({ jobId, status: 'queued', pollUrl: `/jobs/${jobId}` });
  });

  app.get('/jobs/:id', { preHandler: requirePermission('report:export') }, async (request) => {
    const { id } = request.params as { id: string };
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query('SELECT id, kind, status, result_key, error, created_at, completed_at FROM export_jobs WHERE tenant_id=$1 AND id=$2',
        [request.auth.tenantId, id]);
      if (!r.rows[0]) throw Errors.notFound('Export job');
      const job = r.rows[0];
      return {
        ...job,
        downloadUrl: job.status === 'completed' ? `/files/${job.result_key}` : null,
      };
    });
  });
}
