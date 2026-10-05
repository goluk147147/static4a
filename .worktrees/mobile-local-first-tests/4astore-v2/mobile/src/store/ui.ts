import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ConfirmReq {
  message: string;
  title?: string;
  confirmText?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface UiState {
  toasts: Toast[];
  confirm: ConfirmReq | null;
}

export const useUi = create<UiState>(() => ({ toasts: [], confirm: null }));

let seq = 0;
export function showToast(message: string, type: ToastType = 'success') {
  const id = ++seq;
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, type }] }));
  setTimeout(() => useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), type === 'error' ? 5000 : 3500);
}
export function dismissToast(id: number) {
  useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function showConfirm(message: string, opts: { title?: string; confirmText?: string; danger?: boolean } = {}) {
  return new Promise<boolean>((resolve) => {
    useUi.setState({ confirm: { message, ...opts, resolve } });
  });
}
export function closeConfirm(ok: boolean) {
  const c = useUi.getState().confirm;
  useUi.setState({ confirm: null });
  c?.resolve(ok);
}
