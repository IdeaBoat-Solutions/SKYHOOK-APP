import type { PoolClient } from 'pg';
import { withTenant } from '../db/tenant.js';

export interface IdempotentResult<T> {
  statusCode: number;
  body: T;
}

/**
 * Executes a mutating operation at most once per (tenant, key, endpoint).
 * A replay returns the stored original response with no side effects.
 */
export async function idempotent<T>(
  tenantId: string,
  key: string,
  endpoint: string,
  requestHash: string,
  handler: (client: PoolClient) => Promise<IdempotentResult<T>>,
): Promise<IdempotentResult<T>> {
  return withTenant(tenantId, async (client) => {
    const hit = await client.query(
      `SELECT status_code, response_body FROM idempotency_keys
       WHERE tenant_id = $1 AND key = $2 AND endpoint = $3 AND expires_at > now()`,
      [tenantId, key, endpoint],
    );
    if (hit.rows[0]) {
      return {
        statusCode: hit.rows[0].status_code as number,
        body: hit.rows[0].response_body as T,
      };
    }

    const result = await handler(client);
    await client.query(
      `INSERT INTO idempotency_keys
         (tenant_id, key, endpoint, request_hash, status_code, response_body, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + interval '24 hours')
       ON CONFLICT (tenant_id, key, endpoint) DO NOTHING`,
      [tenantId, key, endpoint, requestHash, result.statusCode, JSON.stringify(result.body)],
    );
    return result;
  });
}
