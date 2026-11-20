import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../auth/login.js';
import { isDevAuth } from '../../config.js';
import { Errors } from '../../common/errors.js';
import { withTenantRead } from '../../db/tenant.js';
import { requirePermission, ALL_PERMISSIONS, MANAGER_PERMISSIONS } from '../../auth/rbac.js';
import { randomUUID, randomBytes } from 'node:crypto';
import { hashPassword } from '../../auth/password.js';
import { supabaseMode } from '../../config.js';
import { provisionAuthUser, deleteAuthUser } from '../../auth/supabase.js';

const loginSchema = z.object({
  /** Optional: the tenant is resolved from the account when omitted. */
  tenantSlug: z.string().min(1).optional(),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(32).optional(),
  password: z.string().min(8).max(128),
});

function slugify(input: string): string {
  const base = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'company';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  // Canonical login endpoint. In Supabase mode this returns a Supabase access
  // token; in dev mode it returns a locally minted HS256 token.
  app.post('/auth/token', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await authenticate(body.tenantSlug, body.email, body.password);
    return reply.send(result);
  });

  // Self-service signup. Always creates a NEW company workspace (tenant) with
  // the registrant as its owner; nobody can self-join an existing company.
  // Additional staff are added by that owner from Settings.
  app.post('/auth/register', async (request, reply) => {
    const b = registerSchema.parse(request.body);
    const { pool } = await import('../../db/pool.js');
    const slug = slugify(b.companyName);
    const tenantId = randomUUID();
    const userId = randomUUID();
    let authUserId: string | null = null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO tenants (id, name, slug) VALUES ($1,$2,$3)', [tenantId, b.companyName, slug]);
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

      for (const code of ALL_PERMISSIONS) {
        await client.query('INSERT INTO permissions (code) VALUES ($1) ON CONFLICT (code) DO NOTHING', [code]);
      }
      await client.query(
        `INSERT INTO roles (tenant_id,name,label) VALUES ($1,'owner','Owner / Super Admin'),($1,'manager','Site Manager')`,
        [tenantId],
      );
      const roles = await client.query('SELECT id, name FROM roles WHERE tenant_id=$1', [tenantId]);
      const roleId = (n: string) => (roles.rows as any[]).find((r) => r.name === n).id as string;
      await client.query(
        'INSERT INTO role_permissions (role_id,permission_id) SELECT $1, id FROM permissions ON CONFLICT DO NOTHING',
        [roleId('owner')],
      );
      await client.query(
        `INSERT INTO role_permissions (role_id,permission_id)
         SELECT $1, id FROM permissions WHERE code = ANY($2::text[]) ON CONFLICT DO NOTHING`,
        [roleId('manager'), [...MANAGER_PERMISSIONS]],
      );
      await client.query(
        'INSERT INTO company_settings (tenant_id, name, email, phone) VALUES ($1,$2,$3,$4)',
        [tenantId, b.companyName, b.email, b.phone ?? null],
      );

      if (supabaseMode) {
        authUserId = await provisionAuthUser({
          tenantId,
          skyhookUserId: userId,
          email: b.email,
          password: b.password,
          name: b.name,
          roles: ['owner'],
          permissions: [...ALL_PERMISSIONS],
        });
      }
      await client.query(
        'INSERT INTO users (id,tenant_id,name,email,phone,auth_user_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [userId, tenantId, b.name, b.email, b.phone ?? null, authUserId],
      );
      if (!supabaseMode) {
        await client.query('INSERT INTO credentials (user_id,password_hash) VALUES ($1,$2)', [userId, await hashPassword(b.password)]);
      }
      await client.query('INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3)', [tenantId, userId, roleId('owner')]);
      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (authUserId) await deleteAuthUser(authUserId).catch(() => undefined);
      const msg = String(err?.message ?? '');
      if (/already (been )?registered|already exists|duplicate/i.test(msg)) {
        throw Errors.conflict('An account with this email already exists');
      }
      throw err;
    } finally {
      client.release();
    }

    const session = await authenticate(slug, b.email, b.password);
    return reply.code(201).send({
      ...session,
      tenantSlug: slug,
      user: { ...session.user, role: 'owner', tenantSlug: slug },
    });
  });

  // Backwards-compatible alias for the old dev-only login route.
  app.post('/dev/token', async (request, reply) => {
    if (!isDevAuth) throw Errors.forbidden('Dev token minting is disabled in production');
    const body = loginSchema.parse(request.body);
    const result = await authenticate(body.tenantSlug, body.email, body.password);
    return reply.send(result);
  });

  app.get('/auth/me', { preHandler: requirePermission('company:read') }, async (request) => {
    return withTenantRead(request.auth.tenantId, async (c) => {
      const roles = await c.query(
        `SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id
         WHERE ur.tenant_id=$1 AND ur.user_id=$2`,
        [request.auth.tenantId, request.auth.userId],
      );
      return {
        id: request.auth.userId,
        name: request.auth.name,
        email: request.auth.email,
        tenantId: request.auth.tenantId,
        roles: roles.rows.map((r: any) => r.name),
        permissions: request.auth.permissions,
      };
    });
  });

  app.get('/audit-logs', { preHandler: requirePermission('audit:read') }, async (request) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT id, occurred_at, actor_name, action, entity, entity_id, reason
         FROM audit_logs WHERE tenant_id=$1 ORDER BY occurred_at DESC, id DESC LIMIT $2`,
        [request.auth.tenantId, q.limit],
      );
      return { items: r.rows };
    });
  });
}
