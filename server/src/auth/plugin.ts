import type { FastifyInstance } from 'fastify';
import { Errors } from '../common/errors.js';
import { verifyToken } from './tokens.js';

const PUBLIC_PATHS = new Set(['/health/live', '/health/ready', '/dev/token', '/auth/token', '/auth/register', '/auth/profiles']);

export async function authPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? '';
    if (PUBLIC_PATHS.has(path)) return;
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Errors.unauthorized();
    try {
      const auth = await verifyToken(header.slice(7));
      request.auth = { ...auth, requestId: request.id };
    } catch {
      throw Errors.unauthorized('Invalid or expired token');
    }
  });
}
