import { create } from 'zustand';
import { api, setAccessToken, saveRefreshToken, clearRefreshToken, refreshSession, getRefreshToken } from '../api';
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
    const rt = await getRefreshToken();
    // Remove this device's push token first (still authenticated), then revoke the refresh token.
    await unregisterPush().catch(() => null);
    await api.post('/users/logout', { refreshToken: rt }).catch(() => null);
    await clearRefreshToken();
    setAccessToken(null);
    set({ user: null });
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
