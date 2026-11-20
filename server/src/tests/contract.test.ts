import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const spec = JSON.parse(readFileSync(path.join(root, 'openapi.json'), 'utf8'));

describe('OpenAPI contract', () => {
  it('every documented operation is registered on the Fastify app', async () => {
    process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:5432/unused';
    const { buildApp } = await import('../app.js');
    const app = await buildApp();
    await app.ready();

    const missing: string[] = [];
    for (const [openapiPath, methods] of Object.entries(spec.paths) as Array<[string, Record<string, unknown>]>) {
      // Fastify uses :param and * wildcards; OpenAPI uses {param}.
      let fastifyPath = openapiPath.replace(/\{[^}]+\}/g, ':param');
      if (openapiPath.startsWith('/files/')) {
        fastifyPath = openapiPath.replace(/\{key\}$/, '*');
      }
      for (const method of Object.keys(methods)) {
        if (!app.hasRoute({ method: method.toUpperCase() as any, url: fastifyPath })) {
          missing.push(`${method.toUpperCase()} ${openapiPath} (expected ${fastifyPath})`);
        }
      }
    }
    await app.close();
    expect(missing).toEqual([]);
  });

  it('spec has the documented security schemes and problem responses', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    expect(spec.components.schemas.Problem.properties.requestId).toBeDefined();
  });
});
