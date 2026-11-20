import type { FastifyReply, FastifyRequest } from 'fastify';
import { Errors } from '../common/errors.js';
import type { AuthContext } from './context.js';

/** All permission codes. Owner gets everything; manager gets the operational subset. */
export const ALL_PERMISSIONS = [
  'company:read', 'company:write',
  'employee:read', 'employee:write',
  'project:read', 'project:write',
  'attendance:read', 'attendance:write', 'attendance:approve',
  'payroll:read', 'payroll:generate', 'payroll:approve', 'payroll:pay',
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

export function requirePermission(...permissions: string[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!permissions.some((p) => hasPermission(request.auth, p))) {
      throw Errors.forbidden(`Requires: ${permissions.join(' or ')}`);
    }
  };
}
