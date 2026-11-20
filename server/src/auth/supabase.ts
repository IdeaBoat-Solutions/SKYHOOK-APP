import { getSupabaseAdmin } from '../lib/supabase.js';

/**
 * Claims embedded in the Supabase user's app_metadata. Supabase copies these into
 * the signed access token, so the API can trust tenant + role data without a DB
 * round-trip on every request. Only the service-role key can modify app_metadata.
 */
export interface SkyhookClaims {
  tenantId: string;
  skyhookUserId: string;
  roles: string[];
  permissions: string[];
  name: string;
  email: string;
}

export function appMetadataFor(claims: SkyhookClaims): Record<string, unknown> {
  return {
    tenant_id: claims.tenantId,
    skyhook_user_id: claims.skyhookUserId,
    roles: claims.roles,
    permissions: claims.permissions,
    name: claims.name,
    email: claims.email,
  };
}

export interface ProvisionInput extends SkyhookClaims {
  password: string;
  /** Existing Supabase user id, when re-provisioning (seed is repeatable). */
  authUserId?: string | null;
}

/**
 * Create or update a user in Supabase Auth with Skyhook claims. Returns the
 * Supabase auth user id, which is stored on skyhook.users.auth_user_id.
 */
export async function provisionAuthUser(input: ProvisionInput): Promise<string> {
  const admin = getSupabaseAdmin();
  const attributes = {
    email: input.email,
    password: input.password,
    email_confirm: true,
    app_metadata: appMetadataFor(input),
    user_metadata: { name: input.name },
  };

  if (input.authUserId) {
    const { data, error } = await admin.auth.admin.updateUserById(input.authUserId, attributes);
    if (error) throw new Error(`Supabase Auth updateUser failed: ${error.message}`);
    if (!data.user) throw new Error('Supabase Auth updateUser returned no user');
    return data.user.id;
  }

  const { data, error } = await admin.auth.admin.createUser(attributes);
  if (error) throw new Error(`Supabase Auth createUser failed: ${error.message}`);
  if (!data.user) throw new Error('Supabase Auth createUser returned no user');
  return data.user.id;
}

/** Refresh role/permission claims after an RBAC change. */
export async function updateAuthUserClaims(authUserId: string, claims: SkyhookClaims): Promise<void> {
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(authUserId, {
    app_metadata: appMetadataFor(claims),
  });
  if (error) throw new Error(`Supabase Auth claim update failed: ${error.message}`);
}

/** Disable/re-enable an auth user (used when a user is deactivated/restored). */
export async function setAuthUserActive(authUserId: string, active: boolean): Promise<void> {
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(authUserId, {
    ban_duration: active ? 'none' : '876000h',
  });
  if (error) throw new Error(`Supabase Auth status update failed: ${error.message}`);
}

export async function deleteAuthUser(authUserId: string): Promise<void> {
  const { error } = await getSupabaseAdmin().auth.admin.deleteUser(authUserId);
  if (error) throw new Error(`Supabase Auth deleteUser failed: ${error.message}`);
}
