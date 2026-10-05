import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useConfirm } from '../store/confirm';

/** Original notifications.js app-confirm dialog (markup + classes). */
export default function ConfirmDialog() {
  const { open, message, options, finish } = useConfirm();
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, finish]);

  if (!open) return null;
  return createPortal(
    <div className="app-confirm-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && finish(false)}>
      <section className="app-confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="appConfirmTitle" aria-describedby="appConfirmMessage">
        <h2 className="app-confirm-title" id="appConfirmTitle">{options.title || 'Please confirm'}</h2>
        <p className="app-confirm-message" id="appConfirmMessage">{message}</p>
        <div className="app-confirm-actions">
          <button type="button" className="app-confirm-button" onClick={() => finish(false)}>{options.cancelText || 'Cancel'}</button>
          <button type="button" ref={confirmRef} className={`app-confirm-button ${options.danger ? 'danger' : 'primary'}`} onClick={() => finish(true)}>
            {options.confirmText || 'Continue'}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
