import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { config } from './config.js';
import { healthCheck } from './db/pool.js';
import { ApiError, problemBody } from './common/errors.js';
import { authPlugin } from './auth/plugin.js';
import { rateLimitPlugin } from './common/rate-limit.js';
import { identityRoutes } from './modules/identity/identity.routes.js';
import { companyRoutes } from './modules/company/company.routes.js';
import { workforceRoutes } from './modules/workforce/workforce.routes.js';
import { projectRoutes } from './modules/projects/projects.routes.js';
import { attendanceRoutes } from './modules/attendance/attendance.routes.js';
import { payrollRoutes } from './modules/payroll/payroll.routes.js';
import { machineRoutes } from './modules/machines/machines.routes.js';
import { machineWorkingRoutes } from './modules/machine-working/machine-working.routes.js';
import { emiRoutes } from './modules/emi/emi.routes.js';
import { expenseRoutes } from './modules/expenses/expenses.routes.js';
import { advanceRoutes } from './modules/advances/advances.routes.js';
import { reminderRoutes } from './modules/reminders/reminders.routes.js';
import { userRoutes } from './modules/users/users.routes.js';
import { reportRoutes } from './modules/reports/reports.routes.js';
import { fileRoutes } from './modules/files/files.routes.js';
import { extrasRoutes } from './modules/extras/extras.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'body.password'],
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  await app.register(cors, { origin: true });

  app.get('/health/live', async () => ({ status: 'ok', uptime: process.uptime() }));
  app.get('/health/ready', async (_request, reply) => {
    const ok = await healthCheck().catch(() => false);
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ready' : 'unavailable' });
  });

  // Register directly (not via app.register) so onRequest hooks apply to
  // all sibling routes on the root instance. Rate limit runs before auth.
  await rateLimitPlugin(app);
  await authPlugin(app);

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send(problemBody(err, request.id, request.url));
    }
    if (err instanceof ZodError) {
      const problem = new ApiError(
        422, 'validation-failed', 'Validation failed', undefined,
        err.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message })),
      );
      return reply.code(422).send(problemBody(problem, request.id, request.url));
    }
    // PostgreSQL unique violation
    if ((err as any).code === '23505') {
      const problem = new ApiError(409, 'conflict', 'Conflict', 'A record with this code already exists');
      return reply.code(409).send(problemBody(problem, request.id, request.url));
    }
    request.log.error({ err }, 'Unhandled error');
    const problem = new ApiError(500, 'internal-error', 'Internal server error');
    return reply.code(500).send(problemBody(problem, request.id, request.url));
  });

  app.setNotFoundHandler((request, reply) => {
    const problem = new ApiError(404, 'not-found', 'Not found', `Route ${request.url} not found`);
    return reply.code(404).send(problemBody(problem, request.id, request.url));
  });

  await app.register(identityRoutes);
  await app.register(companyRoutes);
  await app.register(workforceRoutes);
  await app.register(projectRoutes);
  await app.register(attendanceRoutes);
  await app.register(payrollRoutes);
  await app.register(machineRoutes);
  await app.register(machineWorkingRoutes);
  await app.register(emiRoutes);
  await app.register(expenseRoutes);
  await app.register(advanceRoutes);
  await app.register(reminderRoutes);
  await app.register(userRoutes);
  await app.register(reportRoutes);
  await app.register(fileRoutes);
  await app.register(extrasRoutes);

  return app;
}
