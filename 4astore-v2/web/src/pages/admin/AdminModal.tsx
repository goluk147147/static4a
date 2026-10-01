import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

/** Original `.order-detail-modal > .modal-body` overlay, rendered into <body>. */
export default function AdminModal({ onClose, children, maxWidth }: { onClose: () => void; children: ReactNode; maxWidth?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="order-detail-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-body" role="dialog" aria-modal="true" style={maxWidth ? { maxWidth } : undefined}>{children}</div>
    </div>,
    document.body
  );
}
