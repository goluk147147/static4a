import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastState {
  toasts: ToastItem[];
  show: (message: string, type?: ToastType) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, type = 'success') => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, message, type }] });
    // Same 3.5s lifetime as the original showToast().
    setTimeout(() => get().dismiss(id), 3500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** Call from anywhere (event handlers, async code) — like the original showToast(). */
export function showToast(message: string, type: ToastType = 'success') {
  useToast.getState().show(message, type);
}
