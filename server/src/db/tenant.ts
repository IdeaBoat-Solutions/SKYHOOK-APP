import type { PoolClient } from 'pg';
import { pool } from './pool.js';

async function rollbackQuietly(client: PoolClient, onFail: () => void): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    onFail();
  }
}

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
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await rollbackQuietly(client, () => { broken = true; });
    throw err;
  } finally {
    // A connection that could not be rolled back is destroyed, never reused.
    client.release(broken);
  }
}

/** Read-only variant (still sets tenant context, but rolls back at the end). */
export async function withTenantRead<T>(
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const result = await work(client);
    await client.query('ROLLBACK');
    return result;
  } catch (err) {
    // Without this, a failed query leaves the transaction aborted and the next
    // request that reuses this connection fails with "current transaction is aborted".
    await rollbackQuietly(client, () => { broken = true; });
    throw err;
  } finally {
    client.release(broken);
  }
}
