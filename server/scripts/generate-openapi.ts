import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Declarative route catalogue -> OpenAPI 3.1. Keep in sync with the registered routers. */
type Route = [method: string, path: string, tag: string, summary: string, auth?: boolean];

const routes: Route[] = [
  ['post', '/auth/token', 'Auth', 'Exchange credentials for access + refresh tokens', false],
  ['post', '/dev/token', 'Auth', 'Dev-only token minting', false],
  ['get', '/auth/me', 'Auth', 'Current user, roles and permissions'],
  ['get', '/audit-logs', 'Audit', 'Paginated audit trail'],
  ['get', '/company', 'Company', 'Company settings'],
  ['patch', '/company', 'Company', 'Update company settings'],
  ['get', '/employees', 'Workforce', 'List employees'],
  ['post', '/employees', 'Workforce', 'Create employee/operator'],
  ['get', '/employees/{id}', 'Workforce', 'Employee profile'],
  ['post', '/employees/{id}/license-renewal', 'Workforce', 'Renew operator licence'],
  ['get', '/employees/{id}/documents', 'Files', 'Employee documents'],
  ['get', '/projects', 'Projects', 'List projects'],
  ['post', '/projects', 'Projects', 'Create project'],
  ['get', '/projects/{id}', 'Projects', 'Project details'],
  ['patch', '/projects/{id}', 'Projects', 'Update project'],
  ['get', '/attendance', 'Attendance', 'List attendance records'],
  ['post', '/attendance', 'Attendance', 'Create/upsert attendance (hours computed server-side)'],
  ['get', '/attendance/matrix', 'Attendance', 'Monthly attendance matrix'],
  ['post', '/attendance/{id}/approve', 'Attendance', 'Approve attendance'],
  ['post', '/attendance/{id}/reject', 'Attendance', 'Reject attendance'],
  ['get', '/payroll/runs', 'Payroll', 'List payroll runs'],
  ['post', '/payroll/runs/generate', 'Payroll', 'Generate monthly draft run'],
  ['get', '/payroll/runs/{id}', 'Payroll', 'Run with entries and OT breakdowns'],
  ['post', '/payroll/runs/{id}/approve', 'Payroll', 'Approve and lock run'],
  ['post', '/payroll/runs/{id}/entries/{entryId}/payment', 'Payroll', 'Record salary payment'],
  ['get', '/machines', 'Assets', 'List cranes'],
  ['post', '/machines', 'Assets', 'Register crane'],
  ['get', '/machines/{id}', 'Assets', 'Crane details'],
  ['patch', '/machines/{id}', 'Assets', 'Update crane'],
  ['get', '/machines/{id}/service-history', 'Assets', 'Service history'],
  ['post', '/machines/{id}/service', 'Assets', 'Log completed service'],
  ['post', '/machines/{id}/renewals', 'Assets', 'Renew insurance/PUC/fitness'],
  ['get', '/machines/{id}/documents', 'Files', 'Crane documents'],
  ['get', '/compliance/upcoming', 'Compliance', 'Upcoming renewals'],
  ['get', '/machine-working-logs', 'Machine Operations', 'List crane logs'],
  ['post', '/machine-working-logs', 'Machine Operations', 'Create crane log'],
  ['get', '/machine-working-logs/template', 'Machine Operations', 'XLSX import template'],
  ['post', '/machine-working-logs/import', 'Machine Operations', 'Import XLSX with validation report'],
  ['post', '/emi/calculate', 'EMI', 'Amortization calculator'],
  ['get', '/emi-loans', 'EMI', 'List loans'],
  ['post', '/emi-loans', 'EMI', 'Create loan with generated schedule'],
  ['get', '/emi-loans/{id}', 'EMI', 'Loan with installments'],
  ['post', '/emi-loans/{id}/payments', 'EMI', 'Record installment payment'],
  ['get', '/emi/alerts', 'EMI', 'EMI reminders'],
  ['get', '/expenses', 'Expenses', 'List expense vouchers'],
  ['post', '/expenses', 'Expenses', 'Create voucher'],
  ['post', '/expenses/{id}/approve', 'Expenses', 'Approve voucher'],
  ['get', '/advances', 'Advances', 'List advances'],
  ['post', '/advances', 'Advances', 'Disburse advance'],
  ['get', '/advances/{id}/recoveries', 'Advances', 'Recovery ledger'],
  ['get', '/reminders', 'Reminders', 'Unified alert engine'],
  ['get', '/notifications', 'Notifications', 'In-app notification centre'],
  ['patch', '/notifications/{id}', 'Notifications', 'Mark read / acknowledge'],
  ['get', '/notification-preferences', 'Notifications', 'Channel preferences'],
  ['patch', '/notification-preferences', 'Notifications', 'Update preferences'],
  ['get', '/users', 'Users', 'List users'],
  ['post', '/users', 'Users', 'Create user'],
  ['patch', '/users/{id}', 'Users', 'Update user'],
  ['delete', '/users/{id}', 'Users', 'Deactivate/delete user'],
  ['post', '/users/{id}/roles', 'Users', 'Assign role'],
  ['get', '/roles', 'Users', 'List roles'],
  ['get', '/permissions', 'Users', 'Permission catalogue'],
  ['post', '/reports/exports', 'Reports', 'Queue XLSX export job'],
  ['get', '/jobs/{id}', 'Reports', 'Poll export job'],
  ['post', '/files/sign-upload', 'Files', 'Sign an upload URL'],
  ['put', '/files/{key}', 'Files', 'Upload object bytes'],
  ['get', '/files/{key}', 'Files', 'Download object'],
  ['get', '/files/signed-url/{key}', 'Files', 'Short-lived signed download URL'],
  ['post', '/documents', 'Files', 'Register document metadata'],
  ['delete', '/documents/{id}', 'Files', 'Delete document'],
  ['get', '/health/live', 'Health', 'Liveness', false],
  ['get', '/health/ready', 'Health', 'Readiness', false],
];

const responses = (ok: string) => ({
  [ok]: { description: 'Success' },
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '422': { $ref: '#/components/responses/ValidationFailed' },
  '429': { $ref: '#/components/responses/RateLimited' },
  '500': { $ref: '#/components/responses/InternalError' },
});

const paths: Record<string, any> = {};
for (const [method, routePath, tag, summary, auth = true] of routes) {
  const ok = method === 'post' ? (routePath.includes('/generate') || routePath.includes('/exports') ? '202' : '201') : '200';
  paths[routePath] ??= {};
  paths[routePath][method] = {
    tags: [tag],
    summary,
    operationId: `${method}_${routePath.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
    ...(auth ? { security: [{ bearerAuth: [] }] } : { security: [] }),
    responses: responses(ok),
  };
}

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Skyhook ERP API',
    version: '1.0.0',
    description: 'Crane business management ERP — generated from server/scripts/generate-openapi.ts. See docs/08-API-DESIGN.md for semantics and payload examples.',
  },
  servers: [{ url: 'http://127.0.0.1:3001', description: 'Local development' }],
  tags: [...new Set(routes.map((r) => r[2]))].map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    responses: Object.fromEntries(
      ['BadRequest', 'Unauthorized', 'Forbidden', 'ValidationFailed', 'RateLimited', 'InternalError'].map((n) => [
        n,
        { description: n, content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
      ]),
    ),
    schemas: {
      Problem: {
        type: 'object',
        properties: {
          type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' },
          detail: { type: 'string' }, instance: { type: 'string' }, requestId: { type: 'string' },
          errors: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          tenantSlug: { type: 'string', description: 'Optional; resolved from the account when omitted' },
          email: { type: 'string', format: 'email', example: 'admin@skyhook.com' },
          password: { type: 'string', format: 'password' },
        },
      },
      TokenResponse: {
        type: 'object',
        properties: {
          token: { type: 'string' }, refreshToken: { type: 'string' }, expiresAt: { type: 'integer' },
          tokenType: { type: 'string' }, user: { type: 'object' },
        },
      },
    },
  },
};

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'openapi.json');
writeFileSync(out, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`Wrote ${out} — ${routes.length} operations across ${Object.keys(paths).length} paths`);
