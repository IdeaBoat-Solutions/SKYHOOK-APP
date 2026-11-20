/**
 * Skyhook API — single Supabase Edge Function router.
 * Deploy: supabase functions deploy api --no-verify-jwt
 * URL: https://<ref>.supabase.co/functions/v1/api/*
 */
import { config, requireConfig } from '../_shared/config.ts';
import { healthCheck } from '../_shared/db.ts';
import { verifyToken, type AuthContext } from '../_shared/auth.ts';
import { ApiError, Errors } from '../_shared/errors.ts';
import { corsHeaders, json, problem, requestId, routePath, withCors } from '../_shared/http.ts';
import type { Route } from '../_shared/types.ts';
import { identityRoutes } from './identity.ts';
import { companyRoutes } from './company.ts';
import { workforceRoutes } from './workforce.ts';
import { usersRoutes } from './users.ts';
import { projectsRoutes } from './projects.ts';
import { attendanceRoutes } from './attendance.ts';
import { machineWorkingRoutes } from './machine-working.ts';
import { payrollRoutes } from './payroll.ts';
import { machinesRoutes } from './machines.ts';
import { emiRoutes } from './emi.ts';
import { expensesRoutes } from './expenses.ts';
import { advancesRoutes } from './advances.ts';
import { remindersRoutes } from './reminders.ts';
import { reportsRoutes } from './reports.ts';
import { filesRoutes } from './files.ts';
import { extrasRoutes } from './extras.ts';

const routes: Route[] = [
  ...identityRoutes,
  ...companyRoutes,
  ...workforceRoutes,
  ...usersRoutes,
  ...projectsRoutes,
  ...attendanceRoutes,
  ...machineWorkingRoutes,
  ...payrollRoutes,
  ...machinesRoutes,
  ...emiRoutes,
  ...expensesRoutes,
  ...advancesRoutes,
  ...remindersRoutes,
  ...reportsRoutes,
  ...filesRoutes,
  ...extrasRoutes,
];

const PUBLIC_EXTRA = new Set(['/health/live', '/health/ready']);

/** Match `/users/:id/roles` against `/users/abc/roles`, extracting named params. */
function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '*') {
      // Wildcard swallows all remaining segments (e.g. /files/* -> tenant/x/y.pdf).
      params['*'] = b.slice(i).map(decodeURIComponent).join('/');
      return params;
    }
    if (a[i]!.startsWith(':')) params[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

async function handle(req: Request): Promise<Response> {
  const rid = requestId(req);
  const path = routePath(req);
  const method = req.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    requireConfig();

    if (path === '/health/live' && method === 'GET') return json({ status: 'ok' });
    if (path === '/health/ready' && method === 'GET') {
      const ok = await healthCheck();
      return json({ status: ok ? 'ready' : 'unavailable' }, ok ? 200 : 503);
    }

    let route: Route | undefined;
    let params: Record<string, string> = {};
    for (const r of routes) {
      if (r.method !== method) continue;
      const matched = matchPath(r.path, path);
      if (matched) {
        route = r;
        params = matched;
        break;
      }
    }
    if (!route) {
      throw new ApiError(
        404, 'not-found', 'Not found',
        `No Edge Function route for ${method} ${path}. Modules not yet ported return this response.`,
      );
    }

    let auth: AuthContext | undefined;
    if (!route.public && !PUBLIC_EXTRA.has(path)) {
      const header = req.headers.get('authorization');
      if (!header?.startsWith('Bearer ')) throw Errors.unauthorized();
      auth = await verifyToken(header.slice(7)).catch(() => {
        throw Errors.unauthorized('Invalid or expired token');
      });
    }

    return await route.handler({ url: new URL(req.url), auth, requestId: rid, params }, req);
  } catch (err) {
    return problem(err, rid, path);
  }
}

Deno.serve(async (req) => withCors(req, await handle(req)));
