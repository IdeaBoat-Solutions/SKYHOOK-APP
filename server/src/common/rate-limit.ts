import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { ApiError, problemBody } from './errors.js';

interface Bucket { hits: number[] }

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

function consume(key: string, limit: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < WINDOW_MS);
  if (bucket.hits.length >= limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.hits[0]! + WINDOW_MS - now) / 1000));
    buckets.set(key, bucket);
    return { allowed: false, retryAfter };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { allowed: true, retryAfter: 0 };
}

/** Simple in-process sliding-window limiter. Swap for Redis in a multi-instance deployment. */
export async function rateLimitPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (path.startsWith('/health')) return;

    const identity = request.headers.authorization?.slice(0, 40) ?? request.ip;
    const isAuth = path === '/auth/token' || path === '/auth/register' || path === '/dev/token';
    const isWrite = !isAuth && request.method !== 'GET' && request.method !== 'HEAD';
    const limit = isAuth ? config.RATE_LIMIT_AUTH : isWrite ? config.RATE_LIMIT_WRITE : config.RATE_LIMIT_READ;
    const bucketKey = `${identity}:${isAuth ? 'auth' : isWrite ? 'w' : 'r'}`;

    const result = consume(bucketKey, limit);
    if (!result.allowed) {
      const problem = new ApiError(429, 'rate-limited', 'Too many requests', `Limit ${limit}/min exceeded`);
      return reply.code(429)
        .header('Retry-After', String(result.retryAfter))
        .send(problemBody(problem, request.id, request.url));
    }
  });
}

/** Test helper: clear in-memory buckets between cases. */
export function clearRateLimitBuckets(): void { buckets.clear(); }
