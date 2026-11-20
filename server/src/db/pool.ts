import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config } from '../config.js';

const { Pool, types } = pg;

// int8 (BIGINT) comes back as string by default. All money values fit well inside
// Number.MAX_SAFE_INTEGER (paise for ₹9 crore = 9e11), so parse to number.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// NUMERIC used for hours/days — likewise safe at our precision.
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Keep DATE/TIME as plain strings (YYYY-MM-DD / HH:mm) instead of JS Date objects.
types.setTypeParser(1082, (v) => v);       // date
types.setTypeParser(1083, (v) => v);       // time without time zone
types.setTypeParser(1266, (v) => v);       // time with time zone

/**
 * Resolve the trusted CA for the database connection. Accepts inline PEM or a
 * path (relative paths resolve from the server directory).
 */
function loadCa(): string | undefined {
  const value = config.DATABASE_SSL_CA?.trim();
  if (!value) return undefined;
  if (value.includes('BEGIN CERTIFICATE')) return value;
  const file = path.resolve(process.cwd(), value);
  if (!fs.existsSync(file)) {
    throw new Error(`DATABASE_SSL_CA file not found: ${file}`);
  }
  return fs.readFileSync(file, 'utf8');
}

/**
 * pg lets the connection string override the `ssl` option, so when a CA is
 * configured the sslmode parameter is stripped and TLS is set explicitly:
 * encrypted, and the server certificate is verified against that CA.
 */
function connectionOptions(connectionString: string): pg.PoolConfig {
  const ca = loadCa();
  if (!ca) return { connectionString };
  const url = new URL(connectionString);
  for (const key of ['sslmode', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } };
}

export const pool = new Pool({
  ...connectionOptions(config.DATABASE_URL),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  options: '-c search_path=skyhook,public -c client_encoding=UTF8',
});

// A dropped connection on an idle client emits 'error' on the Pool. Without a
// listener Node treats it as unhandled and crashes the API/worker process.
pool.on('error', (err) => {
  console.error('[db] idle connection error (will reconnect):', err.message);
});

/**
 * DDL uses a separate pool so Supabase migrations can target the direct
 * (non-pooled) database connection while the app uses the transaction pooler.
 */
export const migrationPool = new Pool({
  ...connectionOptions(config.DATABASE_URL_DIRECT ?? config.DATABASE_URL),
  max: 2,
  connectionTimeoutMillis: 10_000,
  options: '-c search_path=skyhook,public -c client_encoding=UTF8',
});
migrationPool.on('error', (err) => {
  console.error('[db] migration pool idle error:', err.message);
});

export type Queryable = pg.PoolClient | pg.Pool;

export async function healthCheck(): Promise<boolean> {
  const r = await pool.query('SELECT 1 AS ok');
  return r.rows[0]?.ok === 1;
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export async function closeAllPools(): Promise<void> {
  await Promise.all([pool.end(), migrationPool.end()]);
}
