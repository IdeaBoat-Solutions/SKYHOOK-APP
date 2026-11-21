/** Typed HTTP client for the Skyhook backend. Token lives in localStorage only. */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:3001';
const TOKEN_KEY = 'skyhook_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiFailure extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

/** 'dailyRatePaise' -> 'Daily rate' (drops unit suffixes the user never sees). */
function humanizeField(field: string): string {
  const words = field
    .replace(/\[\d+\]/g, '')
    .split('.').pop()!
    .replace(/(Paise|Id)$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Value';
}

/** Readable text from an RFC 9457 problem body; a 422 names the first offending field. */
function problemMessage(body: any, status: number): string {
  const first = Array.isArray(body?.errors) ? body.errors[0] : undefined;
  if (first?.message) {
    const field = first.field && first.field !== '(root)' ? `${humanizeField(String(first.field))}: ` : '';
    const more = body.errors.length > 1 ? ` (and ${body.errors.length - 1} more)` : '';
    return `${field}${first.message}${more}`;
  }
  if (typeof body?.detail === 'string' && body.detail) return body.detail;
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status >= 500) return 'Something went wrong on the server. Please try again.';
  return body?.title ?? `HTTP ${status}`;
}

async function request<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  // One idempotency key per logical request. Retrying below reuses it so a write
  // can never be applied twice if the server already accepted the first attempt.
  const idempotencyKey = crypto.randomUUID();
  const send = () => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = raw ? 'application/octet-stream' : 'application/json';
    if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    return fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
    });
  };

  let res = await send();
  // A burst of saves (each followed by a full data refresh) can hit the server's
  // per-minute rate limit. Without a retry, the save silently fails and the form
  // looks as if nothing happened. Retry a 429 with the server's suggested delay.
  for (let attempt = 0; res.status === 429 && attempt < 3; attempt += 1) {
    const retryAfter = Number(res.headers.get('Retry-After'));
    const delayMs = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1, 8) * 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    res = await send();
  }

  if (!res.ok) {
    let detail: any = null;
    try { detail = await res.json(); } catch { /* non-JSON error */ }
    throw new ApiFailure(res.status, problemMessage(detail, res.status), detail);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  base: BASE,
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  putBinary: <T>(path: string, data: ArrayBuffer) => request<T>('PUT', path, data, true),
  /** Authenticated binary download (stored documents). */
  getBlob: async (path: string): Promise<Blob> => {
    const token = getToken();
    const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      let detail: any = null;
      try { detail = await res.json(); } catch { /* non-JSON error */ }
      throw new ApiFailure(res.status, problemMessage(detail, res.status), detail);
    }
    return res.blob();
  },
};
