import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config, supabaseMode } from '../config.js';
import { getSupabaseAdmin } from '../lib/supabase.js';

const ROOT = path.resolve(config.STORAGE_DIR);
const bucket = () => config.SUPABASE_STORAGE_BUCKET;

/** Local object-storage shim for development. Keys are tenant-prefixed and traversal-safe. */
function resolveKey(key: string): string {
  const safe = key.replace(/\\/g, '/').replace(/\.\./g, '');
  const full = path.resolve(ROOT, safe);
  if (!full.startsWith(ROOT)) throw new Error('Invalid object key');
  return full;
}

export interface PutOptions {
  contentType?: string;
}

/** Upload bytes: Supabase Storage when configured, local disk in dev mode. */
export async function saveObject(key: string, data: Buffer, options: PutOptions = {}): Promise<void> {
  if (supabaseMode) {
    const { error } = await getSupabaseAdmin()
      .storage.from(bucket())
      .upload(key, data, {
        upsert: true,
        contentType: options.contentType ?? 'application/octet-stream',
      });
    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
    return;
  }
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}

export async function getObject(key: string): Promise<Buffer> {
  if (supabaseMode) {
    const { data, error } = await getSupabaseAdmin().storage.from(bucket()).download(key);
    if (error || !data) throw new Error(`Supabase Storage download failed: ${error?.message ?? 'no data'}`);
    return Buffer.from(await data.arrayBuffer());
  }
  return readFile(resolveKey(key));
}

export async function removeObject(key: string): Promise<void> {
  if (supabaseMode) {
    const { error } = await getSupabaseAdmin().storage.from(bucket()).remove([key]);
    if (error) throw new Error(`Supabase Storage delete failed: ${error.message}`);
    return;
  }
  await unlink(resolveKey(key)).catch(() => undefined);
}

/** Short-lived signed URL for direct downloads; null when running the local shim. */
export async function signedObjectUrl(key: string, expiresInSeconds = 600): Promise<string | null> {
  if (!supabaseMode) return null;
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket())
    .createSignedUrl(key, expiresInSeconds);
  if (error || !data) throw new Error(`Supabase Storage sign failed: ${error?.message ?? 'no data'}`);
  return data.signedUrl;
}

export function exportKey(tenantId: string, jobId: string): string {
  return `tenant/${tenantId}/exports/${jobId}.xlsx`;
}

export function documentKey(tenantId: string, kind: string, id: string, name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return `tenant/${tenantId}/${kind}/${id}/${Date.now()}-${safeName}`;
}
