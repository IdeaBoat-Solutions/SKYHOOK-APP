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
    'Access-Control-Allow-Headers': 'authorization, content-type, x-request-id',
    'Access-Control-Max-Age': '86400',
  };
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
  return path.replace(/\/+$/, '') || '/';
}

export function requestId(req: Request): string {
  return req.headers.get('x-request-id') ?? crypto.randomUUID();
}
