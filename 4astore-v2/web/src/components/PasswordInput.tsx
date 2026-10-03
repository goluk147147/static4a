import { useState } from 'react';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Extra style for the relative wrapper (used by inline-styled admin forms). */
  wrapperStyle?: React.CSSProperties;
};

/**
 * Password input with an accessible show/hide eye toggle. Shared by every
 * password field (customer login/register, admin login, team + user forms) so
 * the behaviour and a11y are consistent. All passed props (value, onChange,
 * required, autoComplete, placeholder, id, style, className…) are forwarded to
 * the underlying <input>, so it drops in for both className-based and
 * inline-styled forms. The toggle button is keyboard-focusable and announces
 * its state via aria-label + aria-pressed.
 */
export default function PasswordInput({ wrapperStyle, style, ...rest }: Props) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'block', ...wrapperStyle }}>
      <input
        {...rest}
        type={show ? 'text' : 'password'}
        // Leave room for the toggle button so long values don't slide under it.
        style={{ ...style, paddingRight: 42, width: style?.width ?? '100%', boxSizing: 'border-box' }}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        title={show ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute', top: 0, bottom: 0, right: 4, margin: 'auto',
          height: 30, width: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, lineHeight: 1,
          color: 'var(--gray, #666)', padding: 0,
        }}
      >
        {show ? '🙈' : '👁️'}
      </button>
    </div>
  );
}
