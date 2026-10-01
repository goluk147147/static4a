import { useToast } from '../store/toast';

const ICONS = { success: '✅', error: '⚠️', info: 'ℹ️' } as const;

/** Renders toasts with the original 4AStore `.toast-container` / `.toast` markup. */
export default function Toasts() {
  const { toasts, dismiss } = useToast();
  if (!toasts.length) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span className="toast-icon">{ICONS[t.type]}</span>
          <span className="toast-msg">{t.message}</span>
          <button className="toast-close" aria-label="Close" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
