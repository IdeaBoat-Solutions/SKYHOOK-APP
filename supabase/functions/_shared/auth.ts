/** Supabase Auth via REST (GoTrue). No Node-only dependencies. */
import { config } from './config.ts';
import { ApiError, Errors } from './errors.ts';

export interface AuthContext {
  userId: string;
  authUserId?: string;
  tenantId: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
  requestId: string;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function authContextFromSupabaseClaims(input: {
  sub?: string;
  appMetadata?: Record<string, unknown> | null;
  userMetadata?: Record<string, unknown> | null;
  email?: string;
}): AuthContext | null {
  const app = input.appMetadata ?? {};
  const meta = input.userMetadata ?? {};
  const tenantId = app.tenant_id;
  if (!input.sub || typeof tenantId !== 'string' || !tenantId) return null;
  return {
    userId: typeof app.skyhook_user_id === 'string' ? app.skyhook_user_id : input.sub,
    authUserId: input.sub,
    tenantId,
    name: (app.name as string) || (meta.name as string) || 'Unknown',
    email: (app.email as string) || (meta.email as string) || input.email || '',
    roles: strArray(app.roles),
    permissions: strArray(app.permissions),
    requestId: crypto.randomUUID(),
  };
}

async function authFetch(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const key = token ? config.SUPABASE_ANON_KEY : config.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${config.SUPABASE_URL}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : { Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}` }),
      ...(init.headers ?? {}),
    },
  });
}

/** Authoritative token check — GoTrue validates signature + expiry. */
export async function verifyToken(token: string): Promise<AuthContext> {
  const res = await authFetch('/user', {}, token);
  if (!res.ok) throw Errors.unauthorized('Invalid or expired token');
  const user = await res.json();
  const ctx = authContextFromSupabaseClaims({
    sub: user.id,
    appMetadata: user.app_metadata,
    userMetadata: user.user_metadata,
    email: user.email,
  });
  if (!ctx) throw Errors.forbidden('Token is missing tenant claims — re-run npm run seed');
  return ctx;
}

export interface Session {
  token: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  user: { id: string; name: string; email: string };
}

export async function signInWithPassword(email: string, password: string): Promise<{
  access_token: string; refresh_token: string; expires_at: number; user: any;
}> {
  const res = await authFetch('/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw Errors.unauthorized('Invalid credentials');
  return res.json();
}

export function appMetadataFor(c: {
  tenantId: string; skyhookUserId: string; roles: string[]; permissions: string[];
  name: string; email: string;
}): Record<string, unknown> {
  return {
    tenant_id: c.tenantId,
    skyhook_user_id: c.skyhookUserId,
    roles: c.roles,
    permissions: c.permissions,
    name: c.name,
    email: c.email,
  };
}

/** Admin API (service role) — mirrors server/src/auth/supabase.ts. */
export async function provisionAuthUser(input: {
  tenantId: string; skyhookUserId: string; email: string; password: string;
  name: string; roles: string[]; permissions: string[]; authUserId?: string | null;
}): Promise<string> {
  const attrs = {
    email: input.email,
    password: input.password,
    email_confirm: true,
    app_metadata: appMetadataFor(input),
    user_metadata: { name: input.name },
  };
  const res = input.authUserId
    ? await authFetch(`/admin/users/${input.authUserId}`, { method: 'PUT', body: JSON.stringify(attrs) })
    : await authFetch('/admin/users', { method: 'POST', body: JSON.stringify(attrs) });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(500, 'auth-provision-failed', 'Auth provisioning failed', body);
  }
  const data = await res.json();
  if (!data.id) throw new Error('Auth provisioning returned no user id');
  return data.id as string;
}

export async function deleteAuthUser(authUserId: string): Promise<void> {
  await authFetch(`/admin/users/${authUserId}`, { method: 'DELETE' });
}
