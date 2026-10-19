import { useState } from 'react';
import { useAuth } from '../store/auth';
import { api, apiError } from '../lib/api';
import { hasRealMobile } from '../lib/mobileGate';
import type { User } from '../types';

const MOBILE_RE = /^[6-9]\d{9}$/;
const OTP_RE = /^\d{6}$/;

type Status = { text: string; color: string };

/**
 * Add-and-verify a real mobile number for accounts that have none (Google sign-in
 * returns mobile: null). Reuses the EXISTING email-OTP endpoints:
 *   POST /users/mobile/send   → emails a 6-digit code to the recovery/primary email
 *   POST /users/mobile/verify → saves the mobile, returns the updated safeUser
 * On success it writes the fresh user into the auth store so this prompt and the
 * checkout gate clear immediately. Self-hides for logged-out users and for anyone
 * who already has a real mobile — no new backend, no new store action.
 *
 * `message` lets a caller (e.g. Checkout) explain why the mobile is required.
 */
export default function AddMobilePrompt({ message }: { message?: string }) {
  const { user, setUser } = useAuth();
  const [sent, setSent] = useState(false);
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ text: '', color: 'var(--gray)' });

  // Self-hide: no user, or the account already has a real mobile.
  if (!user || hasRealMobile(user)) return null;

  async function sendCode() {
    setBusy(true);
    setStatus({ text: 'Sending code… / कोड भेजा जा रहा है…', color: 'var(--gray)' });
    try {
      const { data } = await api.post('/users/mobile/send', {});
      setSent(true);
      // Auto-fill the fallback OTP the backend returns when no real channel
      // delivered (email down / no FCM device) — so a Google user can clear the
      // checkout gate during a mail outage. Absent once a real channel delivers.
      if (data.devOtp) setOtp(String(data.devOtp));
      setStatus({ text: 'Code sent to your email. Check inbox and spam. / कोड आपकी ईमेल पर भेजा गया।', color: '#087a3d' });
    } catch (e) {
      // A delivery failure now returns 503 from the server — surface its message
      // and STAY on the send step (setSent stays false, so no "enter code" step).
      setStatus({ text: apiError(e) || 'Code bhej nahi paaye — thodi der baad try karein ya support se sampark karein. / Could not send the code. Please try again shortly or contact support.', color: '#b42318' });
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    const m = mobile.trim();
    const code = otp.trim();
    if (!MOBILE_RE.test(m)) {
      setStatus({ text: 'Enter a valid 10-digit mobile number.', color: '#b42318' });
      return;
    }
    if (!OTP_RE.test(code)) {
      setStatus({ text: 'Enter the 6-digit code from your email.', color: '#b42318' });
      return;
    }
    setBusy(true);
    setStatus({ text: 'Verifying… / जाँच हो रही है…', color: 'var(--gray)' });
    try {
      const { data } = await api.post('/users/mobile/verify', { mobile: m, otp: code });
      // The server returns the updated safeUser; writing it clears this prompt + the checkout gate.
      setUser(data.user as User);
      setStatus({ text: '✅ Mobile number verified. / मोबाइल नंबर सत्यापित हो गया।', color: '#087a3d' });
    } catch (e) {
      // 409 = number already registered to another account, 422 = bad/expired code.
      setStatus({ text: apiError(e) || 'Verification failed. Try again.', color: '#b42318' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Add mobile number"
      style={{ margin: '0 auto 16px', maxWidth: 1100, padding: '14px 16px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, textAlign: 'left' }}
    >
      <h3 style={{ margin: '0 0 5px', fontSize: 15, color: '#8a6d00' }}>📱 Add your mobile number</h3>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b5500' }}>
        {message || 'Add and verify a mobile number so we can reach you about your orders. / अपना मोबाइल नंबर जोड़ें और सत्यापित करें।'}
      </p>

      {!sent ? (
        <button
          type="button"
          onClick={sendCode}
          disabled={busy}
          style={{ padding: '10px 16px', border: 0, borderRadius: 8, background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}
        >
          {busy ? 'Sending…' : 'Send verification code'}
        </button>
      ) : (
        <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            Mobile number
            <input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit mobile"
              autoComplete="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
              style={{ width: '100%', boxSizing: 'border-box', minHeight: 42, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, font: 'inherit', marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            6-digit email code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              style={{ width: '100%', boxSizing: 'border-box', minHeight: 42, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, font: 'inherit', letterSpacing: 2, marginTop: 4 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={verify}
              disabled={busy}
              style={{ flex: 1, minHeight: 42, padding: '9px 12px', border: 0, borderRadius: 8, background: '#087a3d', color: '#fff', fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}
            >
              {busy ? 'Verifying…' : 'Verify & save'}
            </button>
            <button
              type="button"
              onClick={sendCode}
              disabled={busy}
              style={{ minHeight: 42, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', color: 'var(--dark)', fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}
            >
              Resend
            </button>
          </div>
        </div>
      )}

      <p role="status" aria-live="polite" style={{ minHeight: 18, margin: '8px 0 0', fontSize: 12, color: status.color }}>{status.text}</p>
    </section>
  );
}
