import { create } from 'zustand';
import { api, setAccessToken, saveRefreshToken, clearRefreshToken, refreshSession, getRefreshToken } from '../api';
import { unregisterPush } from '../push';
import { queryClient } from '../queries';
import { useCart } from './cart';
import type { User } from '../types';

// Per-user React Query data. Storefront data (products/categories/config/settings/pages) is shared.
const USER_SCOPED_KEYS = ['orders', 'order', 'all-orders', 'track', 'screenshot'];

/** Drop everything that belongs to the previous account so a new login never sees old data. */
function clearUserScopedData() {
  for (const k of USER_SCOPED_KEYS) queryClient.removeQueries({ queryKey: [k] });
  useCart.getState().clear();
}

let lastUserId: number | null = null;
/** Clear per-user data whenever the signed-in account changes (logout, or login as someone else). */
function trackIdentity(next: User | null) {
  const nextId = next?.id ?? null;
  if (lastUserId != null && nextId !== lastUserId) clearUserScopedData();
  if (nextId != null) lastUserId = nextId;
  else if (lastUserId != null) lastUserId = null;
}

interface RegisterPayload {
  name: string;
  mobile: string;
  username: string;
  email: string;
  password: string;
  otp: string;
}

interface AuthState {
  user: User | null;
  ready: boolean;
  setUser: (u: User | null) => void;
  login: (username: string, password: string) => Promise<User>;
  socialLogin: (idToken: string) => Promise<User>;
  register: (p: RegisterPayload) => Promise<User>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  reloadSession: () => Promise<void>;
}

function normalizeUser(u: any): User | null {
  if (!u) return null;
  return {
    ...u,
    id: Number(u.id),
    permissions: Array.isArray(u.permissions) ? u.permissions : [],
    custom_delivery: u.custom_delivery === null || u.custom_delivery === undefined ? null : Number(u.custom_delivery),
  };
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,
  setUser: (u) => set({ user: u }),

  login: async (username, password) => {
    const data = await api.post('/users/login', { username: username.trim(), password });
    setAccessToken(data.token);
    if (data.refreshToken) await saveRefreshToken(data.refreshToken);
    const user = normalizeUser(data.user)!;
    set({ user });
    return user;
  },

  // Google Sign-In: POST the Google ID token and set the session via the SAME path as login()
  // (X-Client:mobile → the server returns a refreshToken, mirroring /login exactly).
  socialLogin: async (idToken) => {
    const data = await api.post('/users/social-login', { provider: 'google', idToken });
    setAccessToken(data.token);
    if (data.refreshToken) await saveRefreshToken(data.refreshToken);
    const user = normalizeUser(data.user)!;
    set({ user });
    return user;
  },

  register: async (payload) => {
    const data = await api.post('/users/register', payload);
    setAccessToken(data.token);
    if (data.refreshToken) await saveRefreshToken(data.refreshToken);
    const user = normalizeUser(data.user)!;
    set({ user });
    return user;
  },

  logout: async () => {
    // Local-first logout (audited): clear the in-memory session FIRST and synchronously so the UI
    // flips to logged-out instantly — the logout button never waits on a slow/offline network.
    setAccessToken(null);
    set({ user: null });
    // Everything below is best-effort and fire-and-forget (.catch → null); it never blocks the
    // local clear, so offline logout always works.
    (async () => {
      const rt = await getRefreshToken();
      // Remove this device's push token (best-effort), then revoke the refresh token silently.
      await unregisterPush().catch(() => null);
      await api('/users/logout', { method: 'POST', body: { refreshToken: rt }, silent: true }).catch(() => null);
      await clearRefreshToken().catch(() => null);
    })();
  },

  // Launch: silent refresh → life-long login.
  // Audited: `ready` is set in finally, so a failed/offline refresh still releases the splash
  // loader — the app lands on its screens (bounded by OfflineGate + per-screen error branches),
  // never an endless spinner.
  bootstrap: async () => {
    try {
      const session = await refreshSession();
      if (session) set({ user: normalizeUser(session.user) });
    } finally {
      set({ ready: true });
    }
  },

  // Re-read the user (role/permissions can be changed by the owner at any time).
  reloadSession: async () => {
    const session = await refreshSession();
    if (session) set({ user: normalizeUser(session.user) });
  },
}));

// Every path that changes `user` (login, social, register, logout, bootstrap, session-expired
// setUser(null), reloadSession) goes through set(), so one subscription covers them all.
useAuth.subscribe((s, prev) => {
  if (s.user?.id !== prev.user?.id) trackIdentity(s.user);
});

export const STAFF_ROLES = ['owner', 'superadmin', 'admin'];

export function canAdmin(user: User | null | undefined, perm: string): boolean {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'superadmin') return true;
  if (user.role !== 'admin') return false;
  const p = user.permissions || [];
  return p.includes('*') || p.includes(perm);
}

/** Staff who receive new-order alerts and can open order details. */
export const isOrderStaff = (u: User | null | undefined) => canAdmin(u, 'orders');
export const isRider = (u: User | null | undefined) => u?.role === 'rider';
export const isOwner = (u: User | null | undefined) => u?.role === 'owner' || u?.role === 'superadmin';
