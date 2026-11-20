import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationPool } from '../db/pool.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(root, 'db', 'migrations');

/**
 * Forward-only migrations with an applied-file ledger.
 * Each file runs at most once; a changed checksum for an already-applied file
 * is an error (never silently re-apply mutated DDL).
 */
export async function migrate(): Promise<void> {
  await migrationPool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const prior = await migrationPool.query('SELECT checksum FROM public.schema_migrations WHERE filename=$1', [file]);
    if (prior.rows[0]) {
      if (prior.rows[0].checksum !== checksum) {
        throw new Error(`Migration ${file} changed after it was applied — write a new forward migration instead`);
      }
      console.log(`Skipped ${file} (already applied)`);
      continue;
    }
    process.stdout.write(`Applying ${file} ... `);
    // Each file manages its own transaction; record in a separate statement after success.
    await migrationPool.query(sql);
    await migrationPool.query(
      'INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1,$2)',
      [file, checksum],
    );
    console.log('done');
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  migrate()
    .then(() => migrationPool.end())
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
