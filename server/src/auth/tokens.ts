import { SignJWT, jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';
import { config, isDevAuth, supabaseMode } from '../config.js';
import { supabaseIssuer, supabaseJwksUrl, getSupabaseAnon } from '../lib/supabase.js';
import { authContextFromSupabaseClaims } from './claims.js';
import type { AuthContext } from './context.js';

const secretKey = new TextEncoder().encode(config.JWT_DEV_SECRET);
const jwks = config.JWT_JWKS_URL
  ? createRemoteJWKSet(new URL(config.JWT_JWKS_URL))
  : null;
// Supabase's JWKS is cached and rotated by jose. Legacy HS256 projects expose no
// JWKS keys — those tokens are verified through the Auth server fallback below.
const supabaseJwks = supabaseMode ? createRemoteJWKSet(new URL(supabaseJwksUrl())) : null;

export interface TokenClaims extends JWTPayload {
  sub: string;
  tenant_id: string;
  name?: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
  session_id?: string;
}

export async function signDevToken(input: {
  userId: string;
  tenantId: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
}): Promise<string> {
  if (!isDevAuth) throw new Error('Dev token minting is disabled');
  return new SignJWT({
    tenant_id: input.tenantId,
    name: input.name,
    email: input.email,
    roles: input.roles,
    permissions: input.permissions,
    session_id: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(input.userId)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secretKey);
}

/** Verify a Supabase-issued token via JWKS, falling back to the Auth server. */
async function verifySupabaseToken(token: string): Promise<AuthContext> {
  try {
    const { payload } = await jwtVerify(token, supabaseJwks!, {
      issuer: supabaseIssuer(),
      audience: 'authenticated',
    });
    const context = authContextFromSupabaseClaims({
      sub: payload.sub,
      appMetadata: payload.app_metadata as Record<string, unknown> | undefined,
      userMetadata: payload.user_metadata as Record<string, unknown> | undefined,
      email: payload.email as string | undefined,
    });
    if (context) return context;
  } catch {
    // Legacy HS256 projects have no JWKS keys, or the key rotated — try /auth/v1/user.
  }

  // Authoritative check against Supabase Auth; also covers tokens whose
  // app_metadata is not embedded in the JWT.
  const { data, error } = await getSupabaseAnon().auth.getUser(token);
  if (error || !data.user) throw new Error('Invalid or expired Supabase token');
  const context = authContextFromSupabaseClaims({
    sub: data.user.id,
    appMetadata: data.user.app_metadata as Record<string, unknown> | undefined,
    userMetadata: data.user.user_metadata as Record<string, unknown> | undefined,
    email: data.user.email,
  });
  if (!context) throw new Error('Supabase token is missing tenant claims — re-run npm run seed');
  return context;
}

/** Verify a locally minted dev token or a custom OIDC token (non-Supabase mode). */
async function verifyLegacyToken(token: string): Promise<AuthContext> {
  const { payload } = await jwtVerify(
    token,
    jwks ?? secretKey,
    { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, algorithms: jwks ? undefined : ['HS256'] },
  );
  const c = payload as TokenClaims;
  if (!c.sub || !c.tenant_id) throw new Error('Invalid token claims');
  return {
    userId: c.sub,
    tenantId: c.tenant_id,
    name: c.name ?? 'Unknown',
    email: c.email ?? '',
    roles: Array.isArray(c.roles) ? c.roles : [],
    permissions: Array.isArray(c.permissions) ? c.permissions : [],
    requestId: crypto.randomUUID(),
  };
}

export async function verifyToken(token: string): Promise<AuthContext> {
  return supabaseJwks ? verifySupabaseToken(token) : verifyLegacyToken(token);
}
