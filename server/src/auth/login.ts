import { pool } from '../db/pool.js';
import { withTenantRead } from '../db/tenant.js';
import { verifyPassword } from './password.js';
import { signDevToken } from './tokens.js';
import { Errors } from '../common/errors.js';
import { supabaseMode } from '../config.js';
import { getSupabaseAnon } from '../lib/supabase.js';

export interface LoginResult {
  token: string;
  user: { id: string; name: string; email: string };
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
}

/** Supabase Auth: password is verified by GoTrue; tenant/roles come from signed claims. */
async function authenticateWithSupabase(
  tenantSlug: string,
  email: string,
  password: string,
): Promise<LoginResult> {
  const tenant = await pool.query('SELECT id FROM tenants WHERE slug = $1', [tenantSlug]);
  if (!tenant.rows[0]) throw Errors.unauthorized('Unknown tenant');
  const tenantId = tenant.rows[0].id as string;

  const { data, error } = await getSupabaseAnon().auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) throw Errors.unauthorized('Invalid credentials');

  const claims = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  if (claims.tenant_id !== tenantId) {
    throw Errors.unauthorized('This account does not belong to the requested tenant');
  }

  // Confirm the internal user is still active; RLS is scoped to the tenant from the JWT.
  const result = await withTenantRead(tenantId, async (c) =>
    c.query(
      'SELECT id, name, email, is_active FROM users WHERE auth_user_id = $1 AND deleted_at IS NULL',
      [data.user.id],
    ),
  );
  const user = result.rows[0];
  if (!user || !user.is_active) throw Errors.unauthorized('Account is inactive');

  return {
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
    tokenType: 'bearer',
    user: { id: user.id, name: user.name, email: user.email },
  };
}

/** Legacy dev stack: scrypt password check + locally minted HS256 token. */
async function authenticateLegacy(
  tenantSlug: string,
  email: string,
  password: string,
): Promise<LoginResult> {
  const tenant = await pool.query('SELECT id FROM tenants WHERE slug = $1', [tenantSlug]);
  if (!tenant.rows[0]) throw Errors.unauthorized('Unknown tenant');
  const tenantId = tenant.rows[0].id as string;

  return withTenantRead(tenantId, async (c) => {
    const u = await c.query(
      'SELECT id, name, email, is_active FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email],
    );
    const user = u.rows[0];
    if (!user || !user.is_active) throw Errors.unauthorized('Invalid credentials');

    const cred = await c.query('SELECT password_hash FROM credentials WHERE user_id = $1', [user.id]);
    if (!cred.rows[0] || !(await verifyPassword(password, cred.rows[0].password_hash))) {
      throw Errors.unauthorized('Invalid credentials');
    }

    const perms = await c.query(
      `SELECT DISTINCT p.code FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2`,
      [tenantId, user.id],
    );
    const roles = await c.query(
      `SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2`,
      [tenantId, user.id],
    );

    const token = await signDevToken({
      userId: user.id,
      tenantId,
      name: user.name,
      email: user.email,
      roles: roles.rows.map((r: any) => r.name),
      permissions: perms.rows.map((p: any) => p.code),
    });
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  });
}

export function authenticate(tenantSlug: string, email: string, password: string): Promise<LoginResult> {
  return supabaseMode
    ? authenticateWithSupabase(tenantSlug, email, password)
    : authenticateLegacy(tenantSlug, email, password);
}
