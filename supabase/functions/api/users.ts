/** Users/roles module ported from server/src/modules/users/users.routes.ts. */
import { withTenant, withTenantRead, type Queryable } from '../_shared/db.ts';
import { ALL_PERMISSIONS, MANAGER_PERMISSIONS, requirePermission } from '../_shared/rbac.ts';
import { Errors, ApiError } from '../_shared/errors.ts';
import { json, readJson } from '../_shared/http.ts';
import { appMetadataFor, provisionAuthUser, deleteAuthUser } from '../_shared/auth.ts';
import { config } from '../_shared/config.ts';
import type { RouteCtx, Route } from '../_shared/types.ts';
import type { AuthContext } from '../_shared/auth.ts';

interface SkyhookClaims {
  tenantId: string;
  skyhookUserId: string;
  roles: string[];
  permissions: string[];
  name: string;
  email: string;
}

function str(v: unknown, field: string, min = 1, max = 500): string {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) {
    throw Errors.validation([{ field, message: `Must be a string of ${min}-${max} characters` }]);
  }
  return v.trim();
}

function email(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    throw Errors.validation([{ field, message: 'Must be a valid email' }]);
  }
  return v;
}

function enumOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw Errors.validation([{ field, message: `Must be one of: ${allowed.join(', ')}` }]);
  }
  return v as T;
}

function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw Errors.validation([{ field, message: 'Must be a boolean' }]);
  return v;
}

/** Use the params the router already parsed from `:name` segments. This is
 * independent of how the Supabase gateway prefixes the function path. */
const ID_PARAM = (ctx: RouteCtx): string => ctx.params.id ?? ctx.params.role ?? '';

function permissionsForRole(role: 'owner' | 'manager'): string[] {
  return role === 'owner' ? [...ALL_PERMISSIONS] : [...MANAGER_PERMISSIONS];
}

/** Build the claim set that Supabase embeds in each access token. */
async function loadClaims(
  c: Queryable,
  tenantId: string,
  userId: string,
  name: string,
  email: string,
): Promise<SkyhookClaims> {
  const roles = await c.query(
    `SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.tenant_id = $1 AND ur.user_id = $2`,
    [tenantId, userId],
  );
  const permissions = await c.query(
    `SELECT DISTINCT p.code FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.tenant_id = $1 AND ur.user_id = $2`,
    [tenantId, userId],
  );
  return {
    tenantId,
    skyhookUserId: userId,
    roles: roles.rows.map((r: any) => r.name),
    permissions: permissions.rows.map((p: any) => p.code),
    name,
    email,
  };
}

/** GoTrue admin REST equivalents of updateAuthUserClaims / setAuthUserActive. */
async function adminUpdateAuthUser(authUserId: string, attrs: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${config.SUPABASE_URL}/auth/v1/admin/users/${authUserId}`, {
    method: 'PUT',
    headers: {
      apikey: config.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(attrs),
  });
  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`Supabase Auth user update failed: ${bodyText}`);
  }
}

async function updateAuthUserClaims(authUserId: string, claims: SkyhookClaims): Promise<void> {
  await adminUpdateAuthUser(authUserId, { app_metadata: appMetadataFor(claims) });
}

async function setAuthUserActive(authUserId: string, active: boolean): Promise<void> {
  await adminUpdateAuthUser(authUserId, { ban_duration: active ? 'none' : '876000h' });
}

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
      auth.tenantId,
      auth.userId,
      auth.name,
      input.action,
      input.entity,
      input.entityId,
      input.previousValue === undefined ? null : JSON.stringify(input.previousValue),
      input.updatedValue === undefined ? null : JSON.stringify(input.updatedValue),
      input.reason ?? null,
      input.requestId ?? null,
    ],
  );
  await c.query(
    `INSERT INTO outbox (tenant_id, event_type, aggregate_type, aggregate_id, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      auth.tenantId,
      input.action,
      input.entity,
      input.entityId,
      JSON.stringify({ reason: input.reason ?? null, at: new Date().toISOString() }),
    ],
  );
}

export const usersRoutes: Route[] = [
  {
    method: 'GET', path: '/users',
    handler: async (ctx: RouteCtx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'user:read');
      return withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query(
          `SELECT u.id, u.name, u.email, u.phone, u.is_active,
                  COALESCE(json_agg(roles.name) FILTER (WHERE roles.id IS NOT NULL),'[]') AS roles
           FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id AND ur.tenant_id=u.tenant_id
           LEFT JOIN roles ON roles.id=ur.role_id
           WHERE u.tenant_id=$1 AND u.deleted_at IS NULL GROUP BY u.id ORDER BY u.name`,
          [auth.tenantId],
        );
        return json({ items: r.rows });
      });
    },
  },
  {
    method: 'GET', path: '/roles',
    handler: async (ctx: RouteCtx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'user:read');
      return withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query('SELECT id, name, label FROM roles WHERE tenant_id=$1 ORDER BY name', [auth.tenantId]);
        const items: any[] = [];
        for (const role of r.rows) {
          const p = await c.query(
            `SELECT p.code FROM permissions p
             JOIN role_permissions rp ON rp.permission_id = p.id
             WHERE rp.role_id = $1 ORDER BY p.code`,
            [role.id],
          );
          items.push({ ...role, permissions: p.rows.map((row: any) => row.code) });
        }
        return json({ items });
      });
    },
  },
  {
    method: 'GET', path: '/permissions',
    handler: async (ctx: RouteCtx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'user:read');
      return withTenantRead(auth.tenantId, async (c) => {
        const r = await c.query('SELECT id, code, description FROM permissions ORDER BY code');
        return json({ items: r.rows });
      });
    },
  },
  {
    /**
     * Owner-only permission bifurcation. The permission sets are stored in
     * `role_permissions`, so the DB is the single source of truth; after a
     * change every affected user's Supabase Auth claims are refreshed so the
     * next access token carries the new permissions.
     *
     * The owner role is deliberately not editable — there must always be an
     * account able to grant access back. Managers can never be given the
     * permissions that let them create users or assign roles.
     */
    method: 'PUT', path: '/roles/:role/permissions',
    handler: async (ctx: RouteCtx, req: Request) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'role:write');
      const roleName = ID_PARAM(ctx);
      if (roleName !== 'manager') throw Errors.badRequest('Only the manager role can be edited');

      const b = await readJson(req);
      if (!Array.isArray(b.permissions) || !b.permissions.every((p: unknown) => typeof p === 'string')) {
        throw Errors.validation([{ field: 'permissions', message: 'Must be an array of permission codes' }]);
      }
      const requested = [...new Set(b.permissions as string[])];
      const unknown = requested.filter((p) => !(ALL_PERMISSIONS as readonly string[]).includes(p));
      if (unknown.length) throw Errors.validation([{ field: 'permissions', message: `Unknown permissions: ${unknown.join(', ')}` }]);
      const RESERVED = ['role:write', 'user:write'];
      const blocked = requested.filter((p) => RESERVED.includes(p));
      if (blocked.length) throw Errors.forbidden(`Cannot grant access-management permissions: ${blocked.join(', ')}`);

      return withTenant(auth.tenantId, async (c) => {
        const role = await c.query('SELECT id FROM roles WHERE tenant_id=$1 AND name=$2', [auth.tenantId, roleName]);
        if (!role.rows[0]) throw Errors.notFound('Role');
        const roleId = role.rows[0].id as string;

        await c.query('DELETE FROM role_permissions WHERE role_id=$1', [roleId]);
        for (const code of requested) {
          await c.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT $1, id FROM permissions WHERE code=$2
             ON CONFLICT DO NOTHING`,
            [roleId, code],
          );
        }

        const affected = await c.query(
          `SELECT u.id, u.name, u.email, u.auth_user_id
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
           WHERE u.tenant_id = $1 AND ur.role_id = $2 AND u.deleted_at IS NULL`,
          [auth.tenantId, roleId],
        );
        for (const u of affected.rows) {
          if (u.auth_user_id) {
            await updateAuthUserClaims(
              u.auth_user_id as string,
              await loadClaims(c, auth.tenantId, u.id, u.name, u.email),
            );
          }
        }

        await writeAudit(c, auth, {
          action: 'ROLE_PERMISSIONS_UPDATED',
          entity: 'Role',
          entityId: roleId,
          updatedValue: requested,
          requestId: ctx.requestId,
        });
        return json({ role: roleName, permissions: requested });
      });
    },
  },
  {
    method: 'POST', path: '/users',
    handler: async (ctx: RouteCtx, req: Request) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'user:write');
      const b = await readJson(req);
      const body = {
        name: str(b.name, 'name'),
        email: email(b.email, 'email'),
        password: str(b.password, 'password', 8, 128),
        phone: b.phone === undefined ? undefined : str(b.phone, 'phone', 1, 32),
        role: enumOf(b.role, 'role', ['owner', 'manager'] as const),
      };
      return withTenant(auth.tenantId, async (c) => {
        const userId = crypto.randomUUID();
        let authUserId: string | null = null;

        // Edge Functions always run in Supabase-Auth mode.
        authUserId = await provisionAuthUser({
          tenantId: auth.tenantId,
          skyhookUserId: userId,
          email: body.email,
          password: body.password,
          name: body.name,
          roles: [body.role],
          permissions: permissionsForRole(body.role),
        });

        try {
          await c.query(
            `INSERT INTO users (id,tenant_id,name,email,phone,auth_user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
            [userId, auth.tenantId, body.name, body.email, body.phone ?? null, authUserId],
          );
        } catch (err) {
          // The auth user cannot be rolled back with the DB transaction — compensate.
          if (authUserId) await deleteAuthUser(authUserId).catch(() => undefined);
          throw err;
        }

        const role = await c.query('SELECT id FROM roles WHERE tenant_id=$1 AND name=$2', [auth.tenantId, body.role]);
        if (!role.rows[0]) throw Errors.notFound('Role');
        await c.query('INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3)', [auth.tenantId, userId, role.rows[0].id]);
        await writeAudit(c, auth, { action: 'USER_CREATED', entity: 'User', entityId: userId, reason: `Created ${body.role} account`, requestId: ctx.requestId });
        return json({ id: userId, name: body.name, email: body.email, role: body.role }, 201);
      });
    },
  },
  {
    method: 'PATCH', path: '/users/:id',
    handler: async (ctx: RouteCtx, req: Request) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'user:write');
      const id = ID_PARAM(ctx);
      const b = await readJson(req);
      const parsed: Record<string, unknown> = {};
      if (b.name !== undefined) parsed.name = str(b.name, 'name');
      if (b.phone !== undefined) parsed.phone = str(b.phone, 'phone', 0, 32);
      if (b.isActive !== undefined) parsed.isActive = bool(b.isActive, 'isActive');
      return withTenant(auth.tenantId, async (c) => {
        const existing = await c.query('SELECT auth_user_id FROM users WHERE tenant_id=$1 AND id=$2', [auth.tenantId, id]);
        if (!existing.rows[0]) throw Errors.notFound('User');

        const map: Record<string, string> = { name: 'name', phone: 'phone', isActive: 'is_active' };
        const entries = Object.entries(parsed).filter(([, v]) => v !== undefined);
        if (!entries.length) throw Errors.badRequest('No fields to update');
        const sets = entries.map(([k], i) => `${map[k]!} = $${i + 3}`).join(', ');
        const r = await c.query(`UPDATE users SET ${sets}, updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,name,email,is_active`,
          [auth.tenantId, id, ...entries.map(([, v]) => v)]);
        if (!r.rows[0]) throw Errors.notFound('User');

        const authUserId = existing.rows[0].auth_user_id as string | null;
        if (authUserId) {
          await setAuthUserActive(authUserId, r.rows[0].is_active);
          await updateAuthUserClaims(
            authUserId,
            await loadClaims(c, auth.tenantId, id, r.rows[0].name, r.rows[0].email),
          );
        }
        await writeAudit(c, auth, { action: 'USER_UPDATED', entity: 'User', entityId: id, requestId: ctx.requestId });
        return json(r.rows[0]);
      });
    },
  },
  {
    method: 'POST', path: '/users/:id/roles',
    handler: async (ctx: RouteCtx, req: Request) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'role:write');
      const id = ID_PARAM(ctx);
      const b = await readJson(req);
      const role = enumOf(b.role, 'role', ['owner', 'manager'] as const);
      return withTenant(auth.tenantId, async (c) => {
        const r = await c.query('SELECT id FROM roles WHERE tenant_id=$1 AND name=$2', [auth.tenantId, role]);
        if (!r.rows[0]) throw Errors.notFound('Role');
        const user = await c.query('SELECT id,name,email,auth_user_id FROM users WHERE tenant_id=$1 AND id=$2', [auth.tenantId, id]);
        if (!user.rows[0]) throw Errors.notFound('User');
        await c.query('DELETE FROM user_roles WHERE tenant_id=$1 AND user_id=$2', [auth.tenantId, id]);
        await c.query('INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3)', [auth.tenantId, id, r.rows[0].id]);

        const authUserId = user.rows[0].auth_user_id as string | null;
        if (authUserId) {
          await updateAuthUserClaims(
            authUserId,
            await loadClaims(c, auth.tenantId, id, user.rows[0].name, user.rows[0].email),
          );
        }
        await writeAudit(c, auth, { action: 'USER_ACCESS_ASSIGNED', entity: 'User', entityId: id, reason: `Assigned role ${role}`, requestId: ctx.requestId });
        return json({ userId: id, role });
      });
    },
  },
  {
    method: 'DELETE', path: '/users/:id',
    handler: async (ctx: RouteCtx) => {
      const auth = ctx.auth!;
      requirePermission(auth, 'user:write');
      const id = ID_PARAM(ctx);
      if (id === auth.userId) throw Errors.badRequest('Cannot delete your own account');
      return withTenant(auth.tenantId, async (c) => {
        const r = await c.query('UPDATE users SET deleted_at=now(), is_active=false WHERE tenant_id=$1 AND id=$2 RETURNING id, auth_user_id', [auth.tenantId, id]);
        if (!r.rows[0]) throw Errors.notFound('User');
        await c.query('DELETE FROM refresh_tokens WHERE tenant_id=$1 AND user_id=$2', [auth.tenantId, id]);
        const authUserId = r.rows[0].auth_user_id as string | null;
        if (authUserId) await deleteAuthUser(authUserId);
        await writeAudit(c, auth, { action: 'USER_DELETED', entity: 'User', entityId: id, requestId: ctx.requestId });
        return json(undefined, 204);
      });
    },
  },
];
