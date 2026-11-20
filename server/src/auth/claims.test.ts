import { describe, expect, it } from 'vitest';
import { authContextFromSupabaseClaims } from './claims.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const authUserId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

describe('Supabase claim mapping', () => {
  it('maps trusted app_metadata to an AuthContext', () => {
    const ctx = authContextFromSupabaseClaims({
      sub: authUserId,
      appMetadata: {
        tenant_id: tenantId,
        skyhook_user_id: userId,
        roles: ['owner'],
        permissions: ['company:read', 'payroll:approve'],
        name: 'Vikram',
        email: 'owner@skyhook.in',
      },
      email: 'owner@skyhook.in',
    });
    expect(ctx).toMatchObject({
      userId,
      authUserId,
      tenantId,
      name: 'Vikram',
      email: 'owner@skyhook.in',
      roles: ['owner'],
      permissions: ['company:read', 'payroll:approve'],
    });
    expect(ctx?.requestId).toBeTruthy();
  });

  it('falls back to sub and user_metadata for older tokens', () => {
    const ctx = authContextFromSupabaseClaims({
      sub: authUserId,
      appMetadata: { tenant_id: tenantId },
      userMetadata: { name: 'Amit' },
      email: 'amit@skyhook.in',
    });
    expect(ctx).toMatchObject({
      userId: authUserId,
      name: 'Amit',
      email: 'amit@skyhook.in',
      roles: [],
      permissions: [],
    });
  });

  it('rejects tokens without a tenant claim', () => {
    expect(authContextFromSupabaseClaims({ sub: authUserId, appMetadata: {} })).toBeNull();
    expect(authContextFromSupabaseClaims({ appMetadata: { tenant_id: tenantId } })).toBeNull();
  });

  it('ignores non-string entries in permission arrays', () => {
    const ctx = authContextFromSupabaseClaims({
      sub: authUserId,
      appMetadata: { tenant_id: tenantId, permissions: ['user:read', 42, null] },
    });
    expect(ctx?.permissions).toEqual(['user:read']);
  });
});
