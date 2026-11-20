/**
 * Postgres access for Edge Functions. Uses `npm:pg` so the existing SQL and
 * $1-style parameters are reused verbatim from the Fastify implementation.
 * One connection per warm isolate (Supabase pooler handles the rest).
 */
import pg from 'npm:pg@8.16.3';
import { config } from './config.ts';

const { Pool, types } = pg;

types.setTypeParser(20, (v: string | null) => (v === null ? null : Number(v)));       // int8 -> paise numbers
types.setTypeParser(1700, (v: string | null) => (v === null ? null : Number(v)));     // numeric -> hours/days
types.setTypeParser(1082, (v: string) => v);                                          // date -> string
types.setTypeParser(1083, (v: string) => v);                                          // time -> string
types.setTypeParser(1266, (v: string) => v);

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 1,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
  ssl: { rejectUnauthorized: false },
  options: '-c search_path=skyhook,public -c client_encoding=UTF8',
});

export type QueryResult = { rows: any[]; rowCount: number | null };
export type Queryable = { query: (text: string, params?: unknown[]) => Promise<QueryResult> };

export async function query(text: string, params: unknown[] = []): Promise<QueryResult> {
  return pool.query(text, params) as Promise<QueryResult>;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const r = await query('SELECT 1 AS ok');
    return r.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

type PgClient = { query: (text: string, params?: unknown[]) => Promise<unknown>; release: (destroy?: boolean) => void };

async function rollbackQuietly(client: PgClient, onFail: () => void): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    onFail();
  }
}

/** BEGIN + set_config('app.tenant_id') + COMMIT. RLS scopes every query in `work`. */
export async function withTenant<T>(tenantId: string, work: (c: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const result = await work(client as unknown as Queryable);
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

/** Same, but rolls back at the end — safe for read-only work. */
export async function withTenantRead<T>(tenantId: string, work: (c: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const result = await work(client as unknown as Queryable);
    await client.query('ROLLBACK');
    return result;
  } catch (err) {
    // Without this, one failed query leaves the single pooled connection in an
    // aborted transaction and every later request fails until the isolate recycles.
    await rollbackQuietly(client, () => { broken = true; });
    throw err;
  } finally {
    client.release(broken);
  }
}
