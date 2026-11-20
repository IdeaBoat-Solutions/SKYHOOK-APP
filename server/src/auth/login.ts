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

/** One generic message for every failure so callers cannot probe which emails exist. */
const invalidCredentials = () => Errors.unauthorized('Invalid email or password');

/**
 * Supabase Auth: password is verified by GoTrue; the tenant comes from the
 * signed app_metadata claims, so the client never has to name its tenant.
 */
async function authenticateWithSupabase(
  tenantSlug: string | undefined,
  email: string,
  password: string,
): Promise<LoginResult> {
  const { data, error } = await getSupabaseAnon().auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) throw invalidCredentials();

  const claims = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  const tenantId = typeof claims.tenant_id === 'string' ? claims.tenant_id : null;
  if (!tenantId) throw invalidCredentials();
  if (tenantSlug) {
    const tenant = await pool.query('SELECT id FROM tenants WHERE slug = $1', [tenantSlug]);
    if (tenant.rows[0]?.id !== tenantId) throw invalidCredentials();
  }

  // Confirm the internal user is still active; RLS is scoped to the tenant from the JWT.
  const result = await withTenantRead(tenantId, async (c) =>
    c.query(
      'SELECT id, name, email, is_active FROM users WHERE auth_user_id = $1 AND deleted_at IS NULL',
      [data.user.id],
    ),
  );
  const user = result.rows[0];
  if (!user || !user.is_active) throw invalidCredentials();

  return {
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
    tokenType: 'bearer',
    user: { id: user.id, name: user.name, email: user.email },
  };
}

/**
 * Legacy dev stack: password hash check + locally minted HS256 token.
 * Without a tenant slug, every tenant holding this email is tried and the one
 * whose stored hash matches wins (email is unique per tenant, not globally).
 */
async function authenticateLegacy(
  tenantSlug: string | undefined,
  email: string,
  password: string,
): Promise<LoginResult> {
  const tenants = tenantSlug
    ? await pool.query('SELECT id FROM tenants WHERE slug = $1', [tenantSlug])
    : await pool.query('SELECT id FROM tenants ORDER BY created_at');
  for (const t of tenants.rows as { id: string }[]) {
    const result = await tryTenantLogin(t.id, email, password);
    if (result) return result;
  }
  throw invalidCredentials();
}

async function tryTenantLogin(
  tenantId: string,
  email: string,
  password: string,
): Promise<LoginResult | null> {
  return withTenantRead(tenantId, async (c) => {
    const u = await c.query(
      'SELECT id, name, email, is_active FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL',
      [email],
    );
    const user = u.rows[0];
    if (!user || !user.is_active) return null;

    const cred = await c.query('SELECT password_hash FROM credentials WHERE user_id = $1', [user.id]);
    if (!cred.rows[0] || !(await verifyPassword(password, cred.rows[0].password_hash))) {
      return null;
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

export function authenticate(
  tenantSlug: string | undefined,
  email: string,
  password: string,
): Promise<LoginResult> {
  return supabaseMode
    ? authenticateWithSupabase(tenantSlug, email, password)
    : authenticateLegacy(tenantSlug, email, password);
}
