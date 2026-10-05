import { create } from 'zustand';

export interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmState {
  open: boolean;
  message: string;
  options: ConfirmOptions;
  resolve: ((ok: boolean) => void) | null;
  finish: (ok: boolean) => void;
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  open: false,
  message: '',
  options: {},
  resolve: null,
  finish: (ok) => {
    get().resolve?.(ok);
    set({ open: false, resolve: null });
  },
}));

/** Promise-based dialog — same contract as the original window.showAppConfirm(). */
export function showConfirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  // Only one dialog at a time; a pending one is treated as cancelled.
  useConfirm.getState().resolve?.(false);
  return new Promise((resolve) => {
    useConfirm.setState({ open: true, message, options, resolve });
  });
}
