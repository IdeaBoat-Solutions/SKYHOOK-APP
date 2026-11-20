/** Identity/auth module ported from server/src/modules/identity/identity.routes.ts. */
import { query, withTenantRead } from '../_shared/db.ts';
import { deleteAuthUser, provisionAuthUser, signInWithPassword } from '../_shared/auth.ts';
import { ALL_PERMISSIONS, MANAGER_PERMISSIONS, requirePermission } from '../_shared/rbac.ts';
import { ApiError, Errors } from '../_shared/errors.ts';
import { json, readJson } from '../_shared/http.ts';
import type { RouteCtx, Route } from '../_shared/types.ts';

function str(v: unknown, field: string, min = 1, max = 500): string {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) {
    throw Errors.validation([{ field, message: `Must be a string of ${min}-${max} characters` }]);
  }
  return v.trim();
}

function slugify(input: string): string {
  const base = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'company';
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${base}-${hex}`;
}

/** One generic message for every failure so callers cannot probe which emails exist. */
const invalidCredentials = () => Errors.unauthorized('Invalid email or password');

/** Password is verified by Supabase Auth; the tenant comes from the signed claims. */
async function authenticate(tenantSlug: string | undefined, email: string, password: string) {
  const session = await signInWithPassword(email, password);
  const claims = (session.user.app_metadata ?? {}) as Record<string, unknown>;
  const tenantId = typeof claims.tenant_id === 'string' ? claims.tenant_id : null;
  if (!tenantId) throw invalidCredentials();
  if (tenantSlug) {
    const tenant = await query('SELECT id FROM tenants WHERE slug = $1', [tenantSlug]);
    if (tenant.rows[0]?.id !== tenantId) throw invalidCredentials();
  }

  const result = await withTenantRead(tenantId, (c) => c.query(
    'SELECT id, name, email, is_active FROM users WHERE auth_user_id = $1 AND deleted_at IS NULL',
    [session.user.id],
  ));
  const user = result.rows[0];
  if (!user || !user.is_active) throw invalidCredentials();

  return {
    token: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
    tokenType: 'bearer',
    user: { id: user.id, name: user.name, email: user.email },
  };
}

export const identityRoutes: Route[] = [
  {
    // Public profile list used by the deployed sign-in screen to populate its
    // account cards. Keep this while that screen is live.
    method: 'GET', path: '/auth/profiles', public: true,
    handler: async () => {
      const tenants = await query('SELECT id, slug FROM tenants ORDER BY created_at');
      const items: any[] = [];
      for (const t of tenants.rows) {
        const users = await withTenantRead(t.id, (c) => c.query(
          `SELECT u.id, u.name, u.email, COALESCE(min(r.name::text),'manager') AS role
           FROM users u
           LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
           LEFT JOIN roles r ON r.id = ur.role_id
           WHERE u.tenant_id = $1 AND u.is_active AND u.deleted_at IS NULL
           GROUP BY u.id ORDER BY u.name`,
          [t.id],
        ));
        for (const u of users.rows) items.push({ ...u, tenantSlug: t.slug });
      }
      return json({ items });
    },
  },
  {
    method: 'POST', path: '/auth/token', public: true,
    handler: async (_ctx, req) => {
      const b = await readJson(req);
      const result = await authenticate(
        b.tenantSlug == null || b.tenantSlug === '' ? undefined : str(b.tenantSlug, 'tenantSlug'),
        str(b.email, 'email').toLowerCase(),
        str(b.password, 'password'),
      );
      return json(result);
    },
  },
  {
    method: 'POST', path: '/auth/register', public: true,
    handler: async (_ctx, req) => {
      const b = await readJson(req);
      const companyName = str(b.companyName, 'companyName', 2, 120);
      const name = str(b.name, 'name', 2, 120);
      const email = str(b.email, 'email').toLowerCase();
      const phone = b.phone == null ? null : str(b.phone, 'phone', 1, 32);
      const password = str(b.password, 'password', 8, 128);

      const slug = slugify(companyName);
      const tenantId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      let authUserId: string | null = null;

      const client = await (await import('../_shared/db.ts')).pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO tenants (id, name, slug) VALUES ($1,$2,$3)', [tenantId, companyName, slug]);
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        for (const code of ALL_PERMISSIONS) {
          await client.query('INSERT INTO permissions (code) VALUES ($1) ON CONFLICT (code) DO NOTHING', [code]);
        }
        await client.query(
          `INSERT INTO roles (tenant_id,name,label) VALUES ($1,'owner','Owner / Super Admin'),($1,'manager','Site Manager')`,
          [tenantId],
        );
        const roles = await client.query('SELECT id, name FROM roles WHERE tenant_id=$1', [tenantId]);
        const roleId = (n: string) => roles.rows.find((r: any) => r.name === n).id as string;
        await client.query('INSERT INTO role_permissions (role_id,permission_id) SELECT $1, id FROM permissions ON CONFLICT DO NOTHING', [roleId('owner')]);
        await client.query(
          `INSERT INTO role_permissions (role_id,permission_id)
           SELECT $1, id FROM permissions WHERE code = ANY($2::text[]) ON CONFLICT DO NOTHING`,
          [roleId('manager'), [...MANAGER_PERMISSIONS]],
        );
        await client.query('INSERT INTO company_settings (tenant_id, name, email, phone) VALUES ($1,$2,$3,$4)', [tenantId, companyName, email, phone]);

        authUserId = await provisionAuthUser({
          tenantId, skyhookUserId: userId, email, password, name,
          roles: ['owner'], permissions: [...ALL_PERMISSIONS],
        });
        await client.query(
          'INSERT INTO users (id,tenant_id,name,email,phone,auth_user_id) VALUES ($1,$2,$3,$4,$5,$6)',
          [userId, tenantId, name, email, phone, authUserId],
        );
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

      const session = await authenticate(slug, email, password);
      return json({ ...session, tenantSlug: slug, user: { ...session.user, role: 'owner', tenantSlug: slug } }, 201);
    },
  },
  {
    method: 'POST', path: '/dev/token', public: true,
    handler: async () => {
      throw Errors.forbidden('Dev token minting is disabled in production');
    },
  },
  {
    method: 'GET', path: '/auth/me',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'company:read');
      const roles = await withTenantRead(auth.tenantId, (c) => c.query(
        `SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id
         WHERE ur.tenant_id=$1 AND ur.user_id=$2`,
        [auth.tenantId, auth.userId],
      ));
      return json({
        id: auth.userId, name: auth.name, email: auth.email, tenantId: auth.tenantId,
        roles: roles.rows.map((r: any) => r.name), permissions: auth.permissions,
      });
    },
  },
  {
    method: 'GET', path: '/audit-logs',
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'audit:read');
      const raw = Number(ctx.url.searchParams.get('limit') ?? 50);
      const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 200) : 50;
      const r = await withTenantRead(auth.tenantId, (c) => c.query(
        `SELECT id, occurred_at, actor_name, action, entity, entity_id, reason
         FROM audit_logs WHERE tenant_id=$1 ORDER BY occurred_at DESC, id DESC LIMIT $2`,
        [auth.tenantId, limit],
      ));
      return json({ items: r.rows });
    },
  },
];
