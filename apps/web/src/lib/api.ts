'use client';

const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001').replace(
  /\/$/,
  '',
);
const TOKEN_KEY = 'atlas_access_token';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers['authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(
      0,
      `Could not reach the Atlas Rail API at ${BASE_URL}. Is the API server running?`,
    );
  }

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !path.includes('/auth/login')) {
      setToken(null);
      window.localStorage.removeItem('atlas_user');
    }
    const jsonBody = isJson && body ? (body as Record<string, unknown>) : null;
    const raw = jsonBody ? (jsonBody.message ?? jsonBody.error) : body;
    const message = Array.isArray(raw)
      ? raw.join(', ')
      : raw || `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message, body);
  }

  return body as T;
}

export const api = {
  baseUrl: BASE_URL,
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown, extraHeaders?: Record<string, string>) =>
    request<T>(path, {
      method: 'POST',
      body: data !== undefined ? JSON.stringify(data) : undefined,
      headers: extraHeaders,
    }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Downloads an authenticated endpoint's response as a file (used for CSV export, which the
 * browser can't fetch via a plain <a href> link since it needs a Bearer token attached). */
export async function downloadAuthenticated(path: string, filename: string) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `Download failed with status ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
