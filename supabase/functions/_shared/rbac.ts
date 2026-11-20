/** Ported from server/src/auth/rbac.ts. Pure functions — no Fastify dependency. */
import type { AuthContext } from './auth.ts';
import { Errors } from './errors.ts';

export const ALL_PERMISSIONS = [
  'company:read', 'company:write',
  'employee:read', 'employee:write',
  'project:read', 'project:write',
  'attendance:read', 'attendance:write', 'attendance:approve',
  'payroll:read', 'payroll:generate', 'payroll:approve', 'payroll:pay', 'payroll:adjust',
  'advance:read', 'advance:write',
  'emi:read', 'emi:write',
  'expense:read', 'expense:write', 'expense:approve',
  'machine:read', 'machine:write',
  'audit:read', 'user:read', 'user:write', 'role:write', 'report:export',
] as const;

export const MANAGER_PERMISSIONS = [
  'company:read',
  'employee:read', 'employee:write',
  'project:read', 'project:write',
  'attendance:read', 'attendance:write', 'attendance:approve',
  'payroll:read',
  'advance:read',
  'expense:read', 'expense:write',
  'machine:read', 'machine:write',
  'report:export',
] as const;

export function hasPermission(auth: AuthContext, permission: string): boolean {
  return auth.permissions.includes('*') || auth.permissions.includes(permission);
}

export function requirePermission(auth: AuthContext, ...permissions: string[]): void {
  if (!permissions.some((p) => hasPermission(auth, p))) {
    throw Errors.forbidden(`Requires: ${permissions.join(' or ')}`);
  }
}
