import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { saveObject, getObject, removeObject, signedObjectUrl, documentKey } from '../../common/storage.js';
import { writeAudit } from '../../common/audit.js';

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.post('/files/sign-upload', { preHandler: requirePermission('employee:write') }, async (request) => {
    const b = z.object({ kind: z.string().min(1), ownerId: z.string().uuid(), name: z.string().min(1) }).parse(request.body);
    const key = documentKey(request.auth.tenantId, b.kind, b.ownerId, b.name);
    return { uploadUrl: `/files/${key}`, objectKey: key, method: 'PUT', expiresInSeconds: 600 };
  });

  app.put('/files/*', { preHandler: requirePermission('employee:write') }, async (request, reply) => {
    const key = (request.params as { '*': string })['*'];
    const body = request.body as Buffer;
    if (!Buffer.isBuffer(body)) throw Errors.badRequest('Expected raw body');
    if (body.length > 10 * 1024 * 1024) throw Errors.badRequest('File too large (max 10MB)');
    await saveObject(key, body);
    return reply.code(201).send({ objectKey: key, sizeBytes: body.length });
  });

  app.get('/files/*', { preHandler: requirePermission('company:read') }, async (request, reply) => {
    const key = (request.params as { '*': string })['*'];
    if (!key.startsWith(`tenant/${request.auth.tenantId}/`)) throw Errors.forbidden('Cross-tenant file access denied');
    try {
      const buffer = await getObject(key);
      return reply.header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`)
        .send(buffer);
    } catch {
      throw Errors.notFound('File');
    }
  });

  // Supabase Storage can issue a short-lived signed URL for direct downloads.
  // Returns 404 in local dev mode, where files are streamed through the API.
  app.get('/files/signed-url/*', { preHandler: requirePermission('company:read') }, async (request, reply) => {
    const key = (request.params as { '*': string })['*'];
    if (!key.startsWith(`tenant/${request.auth.tenantId}/`)) throw Errors.forbidden('Cross-tenant file access denied');
    const url = await signedObjectUrl(key, 600);
    if (!url) throw Errors.notFound('Signed URLs are unavailable in local storage mode');
    return reply.send({ url, expiresInSeconds: 600 });
  });

  app.get('/employees/:id/documents', { preHandler: requirePermission('employee:read') }, async (request) => {
    const { id } = request.params as { id: string };
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query("SELECT * FROM documents WHERE tenant_id=$1 AND owner_type='employee' AND owner_id=$2 ORDER BY uploaded_at DESC", [request.auth.tenantId, id]);
      return { items: r.rows };
    });
  });

  app.post('/documents', { preHandler: requirePermission('employee:write') }, async (request, reply) => {
    const b = z.object({
      ownerType: z.enum(['employee', 'machine', 'expense', 'emi', 'payroll']), ownerId: z.string().uuid(),
      docType: z.string().min(1), name: z.string().min(1), objectKey: z.string().min(1),
      sizeKb: z.number().int().nonnegative().optional(), mimeType: z.string().optional(), expiryDate: z.string().optional(),
    }).parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `INSERT INTO documents (tenant_id,owner_type,owner_id,doc_type,name,object_key,size_kb,mime_type,expiry_date,uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10) RETURNING *`,
        [request.auth.tenantId, b.ownerType, b.ownerId, b.docType, b.name, b.objectKey, b.sizeKb ?? null, b.mimeType ?? null, b.expiryDate ?? null, request.auth.userId],
      );
      await writeAudit(c, request.auth, { action: 'DOCUMENT_UPLOADED', entity: b.ownerType, entityId: b.ownerId, reason: b.name, requestId: request.id });
      return reply.code(201).send(r.rows[0]);
    });
  });

  app.delete('/documents/:id', { preHandler: requirePermission('employee:write') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query('DELETE FROM documents WHERE tenant_id=$1 AND id=$2 RETURNING id, object_key', [request.auth.tenantId, id]);
      if (!r.rows[0]) throw Errors.notFound('Document');
      await removeObject(r.rows[0].object_key);
      return reply.code(204).send();
    });
  });
}
