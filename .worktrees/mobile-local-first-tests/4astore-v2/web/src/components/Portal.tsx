import { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders children directly into <body>. Modals must live here: ancestors with
 * backdrop-filter/transform (the glass cards in style.css) would otherwise trap
 * `position: fixed` overlays and the sticky header (z-index 9999) covers them.
 */
export default function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
