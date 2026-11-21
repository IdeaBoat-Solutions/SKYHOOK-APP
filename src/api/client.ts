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

async function request<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
    headers['Idempotency-Key'] = crypto.randomUUID();
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
  });

  if (!res.ok) {
    let detail: any = null;
    try { detail = await res.json(); } catch { /* non-JSON error */ }
    throw new ApiFailure(res.status, detail?.detail ?? detail?.title ?? `HTTP ${res.status}`, detail);
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
    if (!res.ok) throw new ApiFailure(res.status, `HTTP ${res.status}`);
    return res.blob();
  },
};
