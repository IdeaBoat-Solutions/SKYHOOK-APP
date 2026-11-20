/** Files / documents module ported from server/src/modules/files/files.routes.ts. */
import { config } from '../_shared/config.ts';
import { withTenant, withTenantRead, type Queryable } from '../_shared/db.ts';
import type { AuthContext } from '../_shared/auth.ts';
import { requirePermission } from '../_shared/rbac.ts';
import { Errors } from '../_shared/errors.ts';
import { corsHeaders, json, readJson } from '../_shared/http.ts';
import { documentKey, saveObject, signedObjectUrl } from '../_shared/storage.ts';
import type { RouteCtx, Route } from '../_shared/types.ts';

const BUCKET = Deno.env.get('SUPABASE_STORAGE_BUCKET') ?? 'skyhook-documents';
const SIGNED_URL_TTL = 600;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function storageHeaders(contentType = 'application/octet-stream'): Record<string, string> {
  const key = config.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': contentType,
    'x-upsert': 'true',
  };
}

/** Keep slashes as path separators, encode each segment of the object key. */
function objectPath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

/** Supabase Storage download via REST (service role) — replaces getObject() from the local shim. */
async function getObjectBytes(key: string): Promise<Uint8Array> {
  const res = await fetch(`${config.SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath(key)}`, {
    headers: storageHeaders(),
  });
  if (!res.ok) throw new Error(`Supabase Storage download failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Supabase Storage delete via REST (service role) — replaces removeObject() from the local shim. */
async function removeObject(key: string): Promise<void> {
  const keySvc = config.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${config.SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath(key)}`, {
    method: 'DELETE',
    headers: { apikey: keySvc, Authorization: `Bearer ${keySvc}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`Supabase Storage delete failed (${res.status})`);
}

/** Ported from server/src/common/audit.ts (same two INSERTs in one transaction). */
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
      auth.tenantId, auth.userId, auth.name, input.action, input.entity, input.entityId,
      input.previousValue === undefined ? null : JSON.stringify(input.previousValue),
      input.updatedValue === undefined ? null : JSON.stringify(input.updatedValue),
      input.reason ?? null, input.requestId ?? null,
    ],
  );
  await c.query(
    `INSERT INTO outbox (tenant_id, event_type, aggregate_type, aggregate_id, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      auth.tenantId, input.action, input.entity, input.entityId,
      JSON.stringify({ reason: input.reason ?? null, at: new Date().toISOString() }),
    ],
  );
}

/** Extract the dynamic tail of a path (e.g. the `*` in /files/* or /signed-url/*). */
function pathAfter(ctx: RouteCtx, _prefix: string): string {
  return ctx.params['*'] ?? ctx.params.id ?? '';
}

/** All object keys are tenant-prefixed in the source storage layer. */
function assertTenantKey(tenantId: string, key: string): void {
  const prefix = `tenant/${tenantId}/`;
  if (!key || !key.startsWith(prefix)) throw Errors.forbidden('Cross-tenant file access denied');
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function str(v: unknown, field: string, min = 1, max = 500): string {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) {
    throw Errors.validation([{ field, message: `Must be a string of ${min}-${max} characters` }]);
  }
  return v.trim();
}

function uuid(v: unknown, field: string): string {
  const s = str(v, field, 36, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    throw Errors.validation([{ field, message: 'Must be a valid UUID' }]);
  }
  return s;
}

const OWNER_TYPES = ['employee', 'machine', 'expense', 'emi', 'payroll'] as const;
function ownerType(v: unknown): typeof OWNER_TYPES[number] {
  if (typeof v !== 'string' || !OWNER_TYPES.includes(v as typeof OWNER_TYPES[number])) {
    throw Errors.validation([{ field: 'ownerType', message: `Must be one of ${OWNER_TYPES.join(', ')}` }]);
  }
  return v as typeof OWNER_TYPES[number];
}

function optionalStr(v: unknown, field: string): string | null {
  if (v === undefined || v === null) return null;
  return str(v, field, 0, 2000);
}

function optionalNonNegInt(v: unknown, field: string): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw Errors.validation([{ field, message: 'Must be a non-negative integer' }]);
  }
  return v;
}

export const filesRoutes: Route[] = [
  {
    method: 'POST', path: '/files/sign-upload',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:write');
      const b = await readJson(req);
      const kind = str(b.kind, 'kind');
      const ownerId = uuid(b.ownerId, 'ownerId');
      const name = str(b.name, 'name');
      const key = documentKey(auth.tenantId, kind, ownerId, name);
      return json({ uploadUrl: `/files/${key}`, objectKey: key, method: 'PUT', expiresInSeconds: SIGNED_URL_TTL });
    },
  },
  {
    // Declared before the generic /files/* GET so a wildcard router cannot shadow it.
    method: 'GET', path: '/files/signed-url/*',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:read');
      const key = pathAfter(ctx, '/files/signed-url');
      assertTenantKey(auth.tenantId, key);
      const url = await signedObjectUrl(key, SIGNED_URL_TTL);
      return json({ url, expiresInSeconds: SIGNED_URL_TTL });
    },
  },
  {
    method: 'PUT', path: '/files/*',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:write');
      const key = pathAfter(ctx, '/files');
      assertTenantKey(auth.tenantId, key);

      const contentType = (req.headers.get('content-type') ?? '').split(';')[0]!.trim();
      let bytes: Uint8Array;
      if (contentType === 'multipart/form-data') {
        const form = await req.formData();
        const file = form.get('file');
        if (!(file instanceof File)) throw Errors.badRequest('Expected multipart field "file"');
        bytes = new Uint8Array(await file.arrayBuffer());
      } else {
        bytes = new Uint8Array(await req.arrayBuffer());
      }
      if (bytes.byteLength > MAX_UPLOAD_BYTES) throw Errors.badRequest('File too large (max 10MB)');
      await saveObject(key, bytes, contentType || 'application/octet-stream');
      return json({ objectKey: key, sizeBytes: bytes.byteLength }, 201);
    },
  },
  {
    method: 'GET', path: '/files/*',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:read');
      const key = pathAfter(ctx, '/files');
      assertTenantKey(auth.tenantId, key);
      try {
        const bytes = await getObjectBytes(key);
        const filename = (key.split('/').pop() ?? 'file').replace(/"/g, '');
        const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${filename}"`,
            ...corsHeaders(),
          },
        });
      } catch {
        throw Errors.notFound('File');
      }
    },
  },
  {
    method: 'GET', path: '/employees/:id/documents',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:read');
      const id = pathAfter(ctx, '/employees').split('/')[0] ?? '';
      if (!id) throw Errors.badRequest('Employee id is required');
      return json(await withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query("SELECT * FROM documents WHERE tenant_id=$1 AND owner_type='employee' AND owner_id=$2 ORDER BY uploaded_at DESC", [auth.tenantId, id]);
        return { items: r.rows };
      }));
    },
  },
  {
    method: 'POST', path: '/documents',
    handler: async (ctx, req) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:write');
      const b = await readJson(req);
      const ownerTypeValue = ownerType(b.ownerType);
      const ownerId = uuid(b.ownerId, 'ownerId');
      const docType = str(b.docType, 'docType');
      const name = str(b.name, 'name');
      const objectKey = str(b.objectKey, 'objectKey');
      const sizeKb = optionalNonNegInt(b.sizeKb, 'sizeKb');
      const mimeType = optionalStr(b.mimeType, 'mimeType');
      const expiryDate = optionalStr(b.expiryDate, 'expiryDate');
      return json(await withTenant(auth.tenantId, async (c) => {
        const r = await c.query(
          `INSERT INTO documents (tenant_id,owner_type,owner_id,doc_type,name,object_key,size_kb,mime_type,expiry_date,uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10) RETURNING *`,
          [auth.tenantId, ownerTypeValue, ownerId, docType, name, objectKey, sizeKb, mimeType, expiryDate, auth.userId],
        );
        await writeAudit(c, auth, {
          action: 'DOCUMENT_UPLOADED', entity: ownerTypeValue, entityId: ownerId,
          reason: name, requestId: ctx.requestId,
        });
        return r.rows[0];
      }), 201);
    },
  },
  {
    method: 'DELETE', path: '/documents/:id',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'employee:write');
      const id = pathAfter(ctx, '/documents');
      if (!id) throw Errors.badRequest('Document id is required');
      await withTenant(auth.tenantId, async (c) => {
        const r = await c.query('DELETE FROM documents WHERE tenant_id=$1 AND id=$2 RETURNING id, object_key', [auth.tenantId, id]);
        if (!r.rows[0]) throw Errors.notFound('Document');
        await removeObject(r.rows[0].object_key).catch(() => undefined);
      });
      return noContent();
    },
  },
];
