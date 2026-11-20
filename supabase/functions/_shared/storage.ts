/** Supabase Storage via REST (service role) — ported from server/src/common/storage.ts. */
import { config } from './config.ts';

const BUCKET = Deno.env.get('SUPABASE_STORAGE_BUCKET') ?? 'skyhook-documents';

function headers(contentType = 'application/octet-stream'): Record<string, string> {
  const key = config.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': contentType,
    'x-upsert': 'true',
  };
}

export async function saveObject(key: string, data: Uint8Array | ArrayBuffer, contentType?: string): Promise<void> {
  const u8 = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const body: ArrayBuffer = (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength)
    ? u8.buffer as ArrayBuffer
    : u8.slice().buffer as ArrayBuffer;
  const res = await fetch(`${config.SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'POST',
    headers: headers(contentType),
    body,
  });
  if (!res.ok) throw new Error(`Supabase Storage upload failed (${res.status}): ${await res.text()}`);
}

export async function signedObjectUrl(key: string, expiresIn = 600): Promise<string> {
  const keySvc = config.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${config.SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${key}`, {
    method: 'POST',
    headers: { apikey: keySvc, Authorization: `Bearer ${keySvc}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new Error(`Supabase Storage sign failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return `${config.SUPABASE_URL}/storage/v1${data.signedURL ?? data.signedUrl}`;
}

export function exportKey(tenantId: string, jobId: string): string {
  return `tenant/${tenantId}/exports/${jobId}.xlsx`;
}

export function documentKey(tenantId: string, kind: string, id: string, name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return `tenant/${tenantId}/${kind}/${id}/${Date.now()}-${safeName}`;
}
