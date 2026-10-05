import axios, { AxiosError, AxiosRequestConfig } from 'axios';

const BASE = import.meta.env.VITE_API_BASE || '/api';

// In-memory access token (JWT). Refresh token lives in an HttpOnly cookie,
// so login survives reloads (life-long login) via silent refresh.
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}

export const api = axios.create({
  baseURL: BASE,
  withCredentials: true, // send/receive the refresh cookie
});

api.interceptors.request.use((cfg) => {
  if (accessToken) {
    cfg.headers = cfg.headers || {};
    cfg.headers.Authorization = `Bearer ${accessToken}`;
  }
  return cfg;
});

// On 401, try one silent refresh, then replay the original request.
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = api
      .post('/users/refresh')
      .then((r) => {
        const t = (r.data?.token as string) || null;
        setAccessToken(t);
        return t;
      })
      .catch(() => {
        setAccessToken(null);
        return null;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig & { _retried?: boolean };
    const status = error.response?.status;
    const url = original?.url || '';
    if (status === 401 && !original._retried && !url.includes('/users/refresh') && !url.includes('/users/login')) {
      original._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        original.headers = original.headers || {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  }
);

/** Extracts the `{success,message}` error text for toasts. */
export function apiError(e: unknown): string {
  const err = e as AxiosError<{ message?: string }>;
  return err.response?.data?.message || err.message || 'Something went wrong';
}
