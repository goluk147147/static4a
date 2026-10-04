import { create } from 'zustand';
import { api, setAccessToken, saveRefreshToken, clearRefreshToken, refreshSession, getRefreshToken, setOnSessionExpired } from '../api';
import { unregisterPush } from '../push';
import type { User } from '../types';

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

  register: async (payload) => {
    const data = await api.post('/users/register', payload);
    setAccessToken(data.token);
    if (data.refreshToken) await saveRefreshToken(data.refreshToken);
    const user = normalizeUser(data.user)!;
    set({ user });
    return user;
  },

  logout: async () => {
    // Clear LOCAL session FIRST so logout always works instantly — even if the token is already
    // invalid/expired or the network is down (earlier a hung server call could block logout).
    const rt = await getRefreshToken().catch(() => null);
    await clearRefreshToken().catch(() => null);
    setAccessToken(null);
    set({ user: null });
    // Clear the cart on logout so the next user doesn't inherit the previous person's cart.
    try { const { useCart } = require('./cart'); useCart.getState().clear(); } catch { /* ignore */ }
    // Best-effort server-side cleanup AFTER local logout; never blocks or throws.
    void unregisterPush().catch(() => null);
    void api.post('/users/logout', { refreshToken: rt }).catch(() => null);
  },

  // Launch: silent refresh → life-long login.
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

// When the API detects a truly-dead session (token expired/revoked + refresh failed), clear the
// local user so the UI stops showing a stale logged-in state and routes the user to login.
setOnSessionExpired(() => {
  setAccessToken(null);
  void clearRefreshToken().catch(() => null);
  useAuth.setState({ user: null });
  try { const { useCart } = require('./cart'); useCart.getState().clear(); } catch { /* ignore */ }
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
