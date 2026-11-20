import type { PoolClient } from 'pg';
import { pool } from './pool.js';

/**
 * Run work inside a transaction with the PostgreSQL tenant context set.
 * RLS policies use current_setting('app.tenant_id'), so every query in the
 * callback is transparently scoped to this tenant — even if a filter is forgotten.
 */
export async function withTenant<T>(
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Read-only variant (still sets tenant context, but rolls back at the end). */
export async function withTenantRead<T>(
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const result = await work(client);
    await client.query('ROLLBACK');
    return result;
  } finally {
    client.release();
  }
}
