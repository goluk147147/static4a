import { create } from 'zustand';
import { api, setAccessToken } from '../lib/api';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  ready: boolean; // true once the initial silent-refresh check has run
  setUser: (u: User | null) => void;
  login: (username: string, password: string) => Promise<void>;
  register: (payload: {
    name: string;
    mobile: string;
    username: string;
    email: string;
    password: string;
    otp: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,
  setUser: (u) => set({ user: u }),

  login: async (username, password) => {
    const { data } = await api.post('/users/login', { username, password });
    setAccessToken(data.token);
    set({ user: data.user });
  },

  register: async (payload) => {
    const { data } = await api.post('/users/register', payload);
    setAccessToken(data.token);
    set({ user: data.user });
  },

  logout: async () => {
    await api.post('/users/logout').catch(() => null);
    setAccessToken(null);
    set({ user: null });
  },

  // On app load, use the refresh cookie to restore the session (life-long login).
  bootstrap: async () => {
    try {
      const { data } = await api.post('/users/refresh');
      if (data?.token) {
        setAccessToken(data.token);
        set({ user: data.user ?? null });
      }
    } catch {
      /* not logged in */
    } finally {
      set({ ready: true });
    }
  },
}));
