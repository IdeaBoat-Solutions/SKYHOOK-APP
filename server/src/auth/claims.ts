import type { AuthContext } from './context.js';

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Pure claim mapping for Supabase access tokens. Returns null when the token
 * lacks the tenant claim that only our service-role key can write into
 * app_metadata. Kept free of config/network imports so it is unit-testable.
 */
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
    roles: stringArray(app.roles),
    permissions: stringArray(app.permissions),
    requestId: crypto.randomUUID(),
  };
}
