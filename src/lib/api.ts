/**
 * Browser-side API client.
 *
 * The access token is held in memory, never in localStorage. A token in
 * localStorage is readable by any script that gets injected, and it survives a
 * tab close. An in-memory token dies with the tab.
 *
 * The refresh token never touches this code. It is an httpOnly cookie scoped to
 * /api/auth, so JavaScript cannot read it at all.
 */

const BASE = '/api';

/**
 * This client is browser-only.
 *
 * It uses relative URLs, which the browser resolves against the current origin
 * and Node's fetch cannot parse at all. The guard makes that contract explicit:
 * importing this from a server component fails loudly here rather than with a
 * confusing URL parse error three frames deeper.
 */
function assertBrowser(): void {
  if (typeof window === 'undefined') {
    throw new Error(
      'api() is browser-only. Call it from a client component or a route handler, not a server component.',
    );
  }
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.code = error.code;
    this.status = status;
    this.details = error.details;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the automatic one-shot refresh retry. */
  noRetry?: boolean;
}

/**
 * Calls the API.
 *
 * On a 401 the client refreshes once, then replays the original request. One
 * retry only. A refresh that fails sends the user to the login page.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  assertBrowser();

  const { method = 'GET', body, noRetry = false } = options;

  const response = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'same-origin',
    // Every response here is per-user and per-scope. The browser's default
    // cache mode would let a 304 serve one user's data to another who logs in
    // next, so this is enforced on the client as well as the server.
    cache: 'no-store',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  // Attempt the refresh on any 401, including cold sessions where accessToken
  // is still null (new tab, hard refresh). The httpOnly cookie carries the
  // refresh token; if it is absent or invalid the refresh fails and we bounce.
  if (response.status === 401 && !noRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return api<T>(path, { method, body, noRetry: true });
    }
    // Only redirect when we are not already on the login page. A hard
    // `location.href` to the same URL reloads the page, which re-mounts the
    // session provider, which calls /auth/me again — an infinite reload loop.
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new ApiRequestError(401, { code: 'UNAUTHENTICATED', message: 'Session expired' });
  }

  const payload = (await response.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: ApiError }
    | null;

  if (!response.ok || !payload || payload.ok === false) {
    const error = payload && payload.ok === false ? payload.error : {
      code: 'INTERNAL',
      message: 'Request failed',
    };
    throw new ApiRequestError(response.status, error);
  }

  return payload.data;
}

let refreshInFlight: Promise<RefreshResult> | null = null;

/**
 * A refresh can hand back a fresh user object. The session context registers a
 * hook here; after every successful rotation the hook fires with the new user
 * so the context never stays on the stale (null) value.
 */
export interface RefreshResult {
  ok: boolean;
  user?: import('@/lib/types').ClientUser;
}

let onUserRefreshed: ((user: import('@/lib/types').ClientUser) => void) | null = null;

export function registerOnUserRefreshed(
  cb: (user: import('@/lib/types').ClientUser) => void,
): () => void {
  onUserRefreshed = cb;
  return () => {
    if (onUserRefreshed === cb) onUserRefreshed = null;
  };
}

/**
 * Single-flight refresh: concurrent 401s share one refresh call.
 *
 * Exported so apiMultipart() can share the same gate instead of refreshing
 * twice when a file upload and a JSON call race.
 */
export async function tryRefresh(): Promise<boolean> {
  assertBrowser();

  if (refreshInFlight) return (await refreshInFlight).ok;

  refreshInFlight = (async (): Promise<RefreshResult> => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      });

      if (!res.ok) {
        setAccessToken(null);
        return { ok: false };
      }

      const payload = (await res.json()) as {
        ok: true;
        data: {
          accessToken: string;
          user?: import('@/lib/types').ClientUser;
        };
      };

      setAccessToken(payload.data.accessToken);

      if (payload.data.user) {
        onUserRefreshed?.(payload.data.user);
      }

      return { ok: true };
    } catch {
      setAccessToken(null);
      return { ok: false };
    } finally {
      refreshInFlight = null;
    }
  })();

  return (await refreshInFlight).ok;
}

/**
 * Posts multipart/form-data to the API.
 *
 * api() cannot do this: it JSON-stringifies the body and hard-codes
 * application/json, and FormData sets its own Content-Type with a boundary
 * that must never be overwritten. Everything else stays the same — the token
 * gate, the one-shot refresh, the no-store cache, the { ok, data } envelope.
 */
export async function apiMultipart<T>(
  path: string,
  form: FormData,
  options: { noRetry?: boolean } = {},
): Promise<T> {
  assertBrowser();

  const { noRetry = false } = options;

  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: form,
  });

  if (response.status === 401 && !noRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return apiMultipart<T>(path, form, { noRetry: true });
    }
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new ApiRequestError(401, { code: 'UNAUTHENTICATED', message: 'Session expired' });
  }

  const payload = (await response.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: ApiError }
    | null;

  if (!response.ok || !payload || payload.ok === false) {
    const error = payload && payload.ok === false ? payload.error : {
      code: 'INTERNAL',
      message: 'Request failed',
    };
    throw new ApiRequestError(response.status, error);
  }

  return payload.data;
}
