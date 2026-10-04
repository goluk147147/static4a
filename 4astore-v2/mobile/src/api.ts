import * as SecureStore from 'expo-secure-store';
import { API_BASE } from './config';

// JWT: short-lived access token in memory, ~1-year refresh token in SecureStore (Android Keystore).
// The app silently refreshes on launch / on any 401 → life-long login, same as the web app.
const REFRESH_KEY = '4astore_refresh_token';
let accessToken: string | null = null;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const getAccessToken = () => accessToken;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

export async function saveRefreshToken(token: string) {
  await SecureStore.setItemAsync(REFRESH_KEY, token);
}
export async function getRefreshToken() {
  return SecureStore.getItemAsync(REFRESH_KEY);
}
export async function clearRefreshToken() {
  await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => null);
}

type Query = Record<string, string | number | boolean | undefined | null>;
interface RequestOpts {
  method?: 'GET' | 'POST';
  body?: unknown;
  params?: Query;
  /** internal: already retried after refresh */
  _retried?: boolean;
}

function buildUrl(path: string, params?: Query) {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!params) return url;
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
}

export function authHeaders(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

let refreshing: Promise<{ token: string; user: unknown } | null> | null = null;

/** Silent refresh with the stored refresh token. Returns the new session or null. */
export function refreshSession(): Promise<{ token: string; user: unknown } | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const rt = await getRefreshToken();
      if (!rt) return null;
      try {
        const res = await fetch(buildUrl('/users/refresh'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client': 'mobile' },
          body: JSON.stringify({ refreshToken: rt }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.token) {
          // Only a definite rejection logs the user out; network errors keep the token.
          if (res.status === 401 || res.status === 404) await clearRefreshToken();
          return null;
        }
        setAccessToken(data.token);
        return { token: data.token as string, user: data.user };
      } catch {
        return null;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** JSON request against the Node API using the `{success, message}` envelope. */
export async function api<T = any>(path: string, opts: RequestOpts = {}): Promise<T> {
  const method = opts.method || (opts.body !== undefined ? 'POST' : 'GET');
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.params), {
      method,
      headers: {
        Accept: 'application/json',
        'X-Client': 'mobile',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError('No internet connection. Please try again / इंटरनेट कनेक्शन जाँचें।', 0);
  }

  // Bounded 401 recovery (audited — no loop/hang possible):
  //  • isAuthCall excludes /users/login,/users/refresh,/users/register so a refresh never retries itself.
  //  • opts._retried guards the single retry — the retried request has _retried:true and so can never
  //    re-enter this branch, making the refresh+retry exactly ONE attempt per request.
  //  • refreshSession() is single-flight (shared `refreshing` promise) so concurrent 401s share one refresh.
  //  • If refresh fails (session === null) we fall through and throw an ApiError below — never an
  //    unresolved spinner.
  const isAuthCall = path.includes('/users/login') || path.includes('/users/refresh') || path.includes('/users/register');
  if (res.status === 401 && !opts._retried && !isAuthCall) {
    const session = await refreshSession();
    if (session) return api<T>(path, { ...opts, _retried: true });
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || (data && data.success === false)) {
    throw new ApiError((data && data.message) || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

api.get = <T = any>(path: string, params?: Query) => api<T>(path, { method: 'GET', params });
api.post = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });

export function apiError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return (e as Error)?.message || 'Something went wrong';
}

export const apiUrl = buildUrl;
