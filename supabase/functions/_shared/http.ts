/** HTTP helpers: CORS, JSON responses, error mapping, path/body parsing. */
import { config } from './config.ts';
import { ApiError, problemBody } from './errors.ts';

export function corsHeaders(): Record<string, string> {
  const origin = config.ALLOWED_ORIGIN === '*'
    ? '*'
    : config.ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-request-id, idempotency-key',
    'Access-Control-Max-Age': '86400',
  };
}

/** Entry may end in ":*" to allow any port, e.g. http://localhost:* */
function originMatches(entry: string, origin: string): boolean {
  if (!entry.endsWith(':*')) return entry === origin;
  try {
    const base = new URL(entry.slice(0, -2));
    const o = new URL(origin);
    // origin must be a bare scheme://host:port (no path, userinfo or look-alike host)
    return o.origin === origin && o.protocol === base.protocol && o.hostname === base.hostname;
  } catch {
    return false;
  }
}

/**
 * ALLOWED_ORIGIN may be '*', one origin, or a comma-separated list (entries can
 * end in ":*" for any port). For a list, or any wildcard-port entry, the
 * request's own Origin is echoed back when it matches, since browsers accept
 * only a single value. This lets production and local dev both be allowed.
 */
export function withCors(req: Request, res: Response): Response {
  const allowed = config.ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  if (allowed.length === 0 || (allowed.length === 1 && !allowed[0].endsWith(':*'))) return res;
  const origin = req.headers.get('origin');
  const match = origin ? allowed.some((entry) => originMatches(entry, origin)) : false;
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', match && origin ? origin : allowed[0]);
  headers.append('Vary', 'Origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

export function problem(err: unknown, requestId: string, instance: string): Response {
  if (err instanceof ApiError) return json(problemBody(err, requestId, instance), err.status);
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[api] unhandled error', err);
  const apiErr = new ApiError(500, 'internal-error', 'Internal server error', msg);
  return json(problemBody(apiErr, requestId, instance), 500);
}

export async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, 'bad-request', 'Bad request', 'Invalid JSON body');
  }
}

/** Normalise the path to the part after the function name, e.g. /auth/token. */
export function routePath(req: Request): string {
  const p = new URL(req.url).pathname;
  const marker = '/functions/v1/api';
  const i = p.indexOf(marker);
  let path = i >= 0 ? p.slice(i + marker.length) : p;
  if (!path.startsWith('/')) path = `/${path}`;
  // The Supabase gateway forwards /api/<route> to the function (and older
  // gateways forwarded /functions/v1/api/<route>). Accept both shapes.
  if (path === '/api' || path.startsWith('/api/')) path = path.slice(4) || '/';
  return path.replace(/\/+$/, '') || '/';
}

export function requestId(req: Request): string {
  return req.headers.get('x-request-id') ?? crypto.randomUUID();
}
