import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, withTenantRead } from '../../db/tenant.js';
import { requirePermission, ALL_PERMISSIONS, MANAGER_PERMISSIONS } from '../../auth/rbac.js';
import { Errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';
import { hashPassword } from '../../auth/password.js';
import { supabaseMode } from '../../config.js';
import {
  provisionAuthUser,
  updateAuthUserClaims,
  setAuthUserActive,
  deleteAuthUser,
  type SkyhookClaims,
} from '../../auth/supabase.js';

function permissionsForRole(role: 'owner' | 'manager'): string[] {
  return role === 'owner' ? [...ALL_PERMISSIONS] : [...MANAGER_PERMISSIONS];
}

/** Build the claim set that Supabase embeds in each access token. */
async function loadClaims(
  c: PoolClient,
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

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users', { preHandler: requirePermission('user:read') }, async (request) => {
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query(
        `SELECT u.id, u.name, u.email, u.phone, u.is_active,
                COALESCE(json_agg(roles.name) FILTER (WHERE roles.id IS NOT NULL),'[]') AS roles
         FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id AND ur.tenant_id=u.tenant_id
         LEFT JOIN roles ON roles.id=ur.role_id
         WHERE u.tenant_id=$1 AND u.deleted_at IS NULL GROUP BY u.id ORDER BY u.name`,
        [request.auth.tenantId],
      );
      return { items: r.rows };
    });
  });

  app.get('/roles', { preHandler: requirePermission('user:read') }, async (request) => {
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query('SELECT id, name, label FROM roles WHERE tenant_id=$1 ORDER BY name', [request.auth.tenantId]);
      const items = [];
      for (const role of r.rows) {
        const p = await c.query(
          `SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
           WHERE rp.role_id = $1 ORDER BY p.code`,
          [role.id],
        );
        items.push({ ...role, permissions: p.rows.map((row: any) => row.code) });
      }
      return { items };
    });
  });

  app.get('/permissions', { preHandler: requirePermission('user:read') }, async (request) => {
    return withTenantRead(request.auth.tenantId, async (c) => {
      const r = await c.query('SELECT id, code, description FROM permissions ORDER BY code');
      return { items: r.rows };
    });
  });

  app.post('/users', { preHandler: requirePermission('user:write') }, async (request, reply) => {
    const b = z.object({
      name: z.string().min(1), email: z.string().email(), password: z.string().min(8),
      phone: z.string().optional(), role: z.enum(['owner', 'manager']),
    }).parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const userId = randomUUID();
      let authUserId: string | null = null;

      if (supabaseMode) {
        authUserId = await provisionAuthUser({
          tenantId: request.auth.tenantId,
          skyhookUserId: userId,
          email: b.email,
          password: b.password,
          name: b.name,
          roles: [b.role],
          permissions: permissionsForRole(b.role),
        });
      }

      try {
        await c.query(
          `INSERT INTO users (id,tenant_id,name,email,phone,auth_user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
          [userId, request.auth.tenantId, b.name, b.email, b.phone ?? null, authUserId],
        );
      } catch (err) {
        // The auth user cannot be rolled back with the DB transaction — compensate.
        if (authUserId) await deleteAuthUser(authUserId).catch(() => undefined);
        throw err;
      }

      if (!supabaseMode) {
        await c.query('INSERT INTO credentials (user_id,password_hash) VALUES ($1,$2)', [userId, await hashPassword(b.password)]);
      }
      const role = await c.query('SELECT id FROM roles WHERE tenant_id=$1 AND name=$2', [request.auth.tenantId, b.role]);
      if (!role.rows[0]) throw Errors.notFound('Role');
      await c.query('INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3)', [request.auth.tenantId, userId, role.rows[0].id]);
      await writeAudit(c, request.auth, { action: 'USER_CREATED', entity: 'User', entityId: userId, reason: `Created ${b.role} account`, requestId: request.id });
      return reply.code(201).send({ id: userId, name: b.name, email: b.email, role: b.role });
    });
  });

  app.patch('/users/:id', { preHandler: requirePermission('user:write') }, async (request) => {
    const { id } = request.params as { id: string };
    const b = z.object({ name: z.string().optional(), phone: z.string().optional(), isActive: z.boolean().optional() }).parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const existing = await c.query('SELECT auth_user_id FROM users WHERE tenant_id=$1 AND id=$2', [request.auth.tenantId, id]);
      if (!existing.rows[0]) throw Errors.notFound('User');

      const map: Record<string, string> = { name: 'name', phone: 'phone', isActive: 'is_active' };
      const entries = Object.entries(b).filter(([, v]) => v !== undefined);
      if (!entries.length) throw Errors.badRequest('No fields to update');
      const sets = entries.map(([k], i) => `${map[k]!} = $${i + 3}`).join(', ');
      const r = await c.query(`UPDATE users SET ${sets}, updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,name,email,is_active`,
        [request.auth.tenantId, id, ...entries.map(([, v]) => v)]);
      if (!r.rows[0]) throw Errors.notFound('User');

      const authUserId = existing.rows[0].auth_user_id as string | null;
      if (supabaseMode && authUserId) {
        await setAuthUserActive(authUserId, r.rows[0].is_active);
        await updateAuthUserClaims(
          authUserId,
          await loadClaims(c, request.auth.tenantId, id, r.rows[0].name, r.rows[0].email),
        );
      }
      await writeAudit(c, request.auth, { action: 'USER_UPDATED', entity: 'User', entityId: id, requestId: request.id });
      return r.rows[0];
    });
  });

  // Edit which permissions the Site Manager role has (owner always has everything).
  app.put('/roles/:role/permissions', { preHandler: requirePermission('role:write') }, async (request) => {
    const { role: roleName } = request.params as { role: string };
    if (roleName !== 'manager') throw Errors.badRequest('Only the manager role can be edited');
    const { permissions } = z.object({ permissions: z.array(z.string()) }).parse(request.body);
    const requested = [...new Set(permissions)];
    const unknown = requested.filter((p) => !(ALL_PERMISSIONS as readonly string[]).includes(p));
    if (unknown.length) throw Errors.badRequest(`Unknown permissions: ${unknown.join(', ')}`);
    const blocked = requested.filter((p) => p === 'role:write' || p === 'user:write');
    if (blocked.length) throw Errors.forbidden(`Cannot grant access-management permissions: ${blocked.join(', ')}`);
    return withTenant(request.auth.tenantId, async (c) => {
      const role = await c.query('SELECT id FROM roles WHERE tenant_id=$1 AND name=$2', [request.auth.tenantId, roleName]);
      if (!role.rows[0]) throw Errors.notFound('Role');
      const roleId = role.rows[0].id as string;
      await c.query('DELETE FROM role_permissions WHERE role_id=$1', [roleId]);
      for (const code of requested) {
        await c.query(
          `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING`,
          [roleId, code],
        );
      }
      await writeAudit(c, request.auth, { action: 'ROLE_PERMISSIONS_UPDATED', entity: 'Role', entityId: roleId, updatedValue: requested, requestId: request.id });
      return { role: roleName, permissions: requested };
    });
  });

  app.post('/users/:id/roles', { preHandler: requirePermission('role:write') }, async (request) => {
    const { id } = request.params as { id: string };
    const { role } = z.object({ role: z.enum(['owner', 'manager']) }).parse(request.body);
    return withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query('SELECT id FROM roles WHERE tenant_id=$1 AND name=$2', [request.auth.tenantId, role]);
      if (!r.rows[0]) throw Errors.notFound('Role');
      const user = await c.query('SELECT id,name,email,auth_user_id FROM users WHERE tenant_id=$1 AND id=$2', [request.auth.tenantId, id]);
      if (!user.rows[0]) throw Errors.notFound('User');
      await c.query('DELETE FROM user_roles WHERE tenant_id=$1 AND user_id=$2', [request.auth.tenantId, id]);
      await c.query('INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3)', [request.auth.tenantId, id, r.rows[0].id]);

      const authUserId = user.rows[0].auth_user_id as string | null;
      if (supabaseMode && authUserId) {
        await updateAuthUserClaims(
          authUserId,
          await loadClaims(c, request.auth.tenantId, id, user.rows[0].name, user.rows[0].email),
        );
      }
      await writeAudit(c, request.auth, { action: 'USER_ACCESS_ASSIGNED', entity: 'User', entityId: id, reason: `Assigned role ${role}`, requestId: request.id });
      return { userId: id, role };
    });
  });

  app.delete('/users/:id', { preHandler: requirePermission('user:write') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.auth.userId) throw Errors.badRequest('Cannot delete your own account');
    return withTenant(request.auth.tenantId, async (c) => {
      const r = await c.query('UPDATE users SET deleted_at=now(), is_active=false WHERE tenant_id=$1 AND id=$2 RETURNING id, auth_user_id', [request.auth.tenantId, id]);
      if (!r.rows[0]) throw Errors.notFound('User');
      await c.query('DELETE FROM refresh_tokens WHERE tenant_id=$1 AND user_id=$2', [request.auth.tenantId, id]);
      const authUserId = r.rows[0].auth_user_id as string | null;
      if (supabaseMode && authUserId) await deleteAuthUser(authUserId);
      await writeAudit(c, request.auth, { action: 'USER_DELETED', entity: 'User', entityId: id, requestId: request.id });
      return reply.code(204).send();
    });
  });
}
