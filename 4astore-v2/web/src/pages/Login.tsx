import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../store/auth';
import { api, apiError } from '../lib/api';
import { showToast } from '../store/toast';
import PasswordInput from '../components/PasswordInput';

// Optional social-login credentials (default '' when unset). Build-safe: with
// empty creds the buttons no-op with a "setup pending" toast — no OAuth, no dep.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const FACEBOOK_APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID || '';
const INSTAGRAM_APP_ID = import.meta.env.VITE_INSTAGRAM_APP_ID || '';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';

  // login fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // register fields
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [regUser, setRegUser] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  // forgot-password fields (identifier = username / mobile / email)
  const [resetId, setResetId] = useState('');
  const [resetPassword, setResetPassword] = useState('');

  // Switch modes and reset the shared OTP/reset state so forms never carry over
  // stale values. Used by every login⇄register⇄forgot toggle.
  function switchMode(m: 'login' | 'register' | 'forgot') {
    setMode(m);
    setError('');
    setOtpSent(false);
    setOtp('');
    setResetId('');
    setResetPassword('');
  }

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await login(username, password);
      navigate(next);
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  }

  async function sendOtp() {
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/otp/send', { email });
      setOtpSent(true);
      if (data.devOtp) setOtp(String(data.devOtp)); // dev convenience
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  }

  async function doRegister(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await register({ name, mobile, username: regUser, email, password, otp });
      navigate(next);
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  }

  // --- Forgot password -------------------------------------------------------
  // Real end-to-end reset via the PUBLIC endpoints (enumeration-safe server):
  //   POST /users/forgot-password/send { identifier }  → emails a 6-digit code
  //   POST /users/reset-password { identifier, otp, newPassword }
  // identifier = username / mobile / email. Does NOT log the user in — it ends by
  // returning to the login form prefilled with the identifier.
  async function sendResetOtp() {
    setBusy(true); setError('');
    try {
      await api.post('/users/forgot-password/send', { identifier: resetId.trim() });
      setOtpSent(true);
      setOtp('');
      showToast('Reset code aapke registered email par bheja gaya. / Reset code sent to your registered email.', 'info');
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  }

  async function submitReset() {
    setBusy(true); setError('');
    try {
      await api.post('/users/reset-password', { identifier: resetId.trim(), otp: otp.trim(), newPassword: resetPassword });
      showToast('Password reset ✅ — ab login karein. / Log in with your new password.', 'success');
      // Return to login prefilled with the identifier the user just reset.
      setUsername(resetId.trim());
      switchMode('login');
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  }

  // --- Social login ----------------------------------------------------------
  // Build-safe buttons only: no OAuth round-trip, no SDK, no new dep. With empty
  // creds (or no server endpoint) each button shows a per-provider "setup
  // pending" toast and no-ops.
  function socialLogin(provider: 'Google' | 'Facebook' | 'Instagram', clientId: string) {
    // TODO: future — POST /users/social-login (endpoint does not exist yet);
    // buttons no-op until then. `clientId` is read from VITE_* env; even when set
    // we still no-op because the server endpoint is not deployed.
    void clientId;
    showToast(`${provider} login setup pending — admin se contact karein. / ${provider} login setup pending — please contact admin.`, 'info');
  }

  return (
    <div className="container">
      <Helmet><title>{`${mode === 'login' ? 'Login' : mode === 'register' ? 'Sign Up' : 'Reset Password'} | 4A Store`}</title></Helmet>
      <div className="form-card">
        <h2>{mode === 'login' ? 'Welcome back 👋' : mode === 'register' ? 'Create your account' : 'Reset password'}</h2>
        {error && <div className="error">{error}</div>}

        {mode === 'login' ? (
          <form onSubmit={doLogin}>
            <div className="field"><label>Username or Mobile</label><input value={username} onChange={(e) => setUsername(e.target.value)} required /></div>
            <div className="field"><label>Password</label><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
            <a onClick={() => switchMode('forgot')} style={{ color: 'var(--primary)', cursor: 'pointer', display: 'block', textAlign: 'right', marginBottom: 8 }}>Forgot password? / पासवर्ड भूल गए?</a>
            <button className="btn btn-block" disabled={busy}>{busy ? 'Please wait…' : 'Login'}</button>

            {/* Build-safe social login — gated by VITE_* creds, no OAuth SDK, no new dep. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 12px' }}>
              <span style={{ flex: 1, height: 1, background: 'var(--border, #e5e5e5)' }} />
              <span className="muted" style={{ fontSize: 12 }}>or continue with / या इसके साथ जारी रखें</span>
              <span style={{ flex: 1, height: 1, background: 'var(--border, #e5e5e5)' }} />
            </div>
            <button type="button" onClick={() => socialLogin('Google', GOOGLE_CLIENT_ID)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', minHeight: 44, marginBottom: 10, borderRadius: 8, border: '1.5px solid var(--border, #ddd)', background: '#fff', color: '#1f1f1f', fontWeight: 700, cursor: 'pointer' }}>
              <span style={{ color: '#4285F4', fontWeight: 800, fontSize: 18 }}>G</span>Continue with Google
            </button>
            <button type="button" onClick={() => socialLogin('Facebook', FACEBOOK_APP_ID)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', minHeight: 44, marginBottom: 10, borderRadius: 8, border: 'none', background: '#1877F2', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              <span style={{ fontWeight: 800, fontSize: 18 }}>f</span>Continue with Facebook
            </button>
            <button type="button" onClick={() => socialLogin('Instagram', INSTAGRAM_APP_ID)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', minHeight: 44, marginBottom: 10, borderRadius: 8, border: 'none', background: 'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              📷 Continue with Instagram
            </button>

            <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>New here? <a onClick={() => switchMode('register')} style={{ color: 'var(--primary)', cursor: 'pointer' }}>Create account</a></p>
          </form>
        ) : mode === 'register' ? (
          <form onSubmit={doRegister}>
            <div className="field"><label>Full Name</label><input value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="field"><label>Mobile (10-digit)</label><input value={mobile} onChange={(e) => setMobile(e.target.value)} required /></div>
            <div className="field"><label>Username</label><input value={regUser} onChange={(e) => setRegUser(e.target.value)} required /></div>
            <div className="field"><label>Password (4+ chars)</label><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required /></div>
            <div className="field">
              <label>Email</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <button type="button" className="btn btn-outline" onClick={sendOtp} disabled={busy || !email}>{otpSent ? 'Resend' : 'Send OTP'}</button>
              </div>
            </div>
            {otpSent && <div className="field"><label>Email OTP</label><input value={otp} onChange={(e) => setOtp(e.target.value)} required /></div>}
            <button className="btn btn-block" disabled={busy || !otpSent}>{busy ? 'Please wait…' : 'Create Account'}</button>
            <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>Already have an account? <a onClick={() => switchMode('login')} style={{ color: 'var(--primary)', cursor: 'pointer' }}>Login</a></p>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (otpSent) submitReset(); else sendResetOtp(); }}>
            <p className="muted" style={{ marginBottom: 12 }}>Username, mobile ya email daalein — reset code aapke registered email par aayega. / Enter your username, mobile or email — the reset code goes to your registered email.</p>
            <div className="field"><label>Username / Mobile / Email</label><input value={resetId} onChange={(e) => setResetId(e.target.value)} disabled={otpSent} required /></div>
            <button type="button" className="btn btn-outline btn-block" onClick={sendResetOtp} disabled={busy || !resetId}>{otpSent ? 'Resend code' : 'Send reset code'}</button>
            {otpSent && (
              <>
                <p className="muted" style={{ margin: '12px 0 6px' }}>📧 6 ankon ka code email check karke daalein. / Enter the 6-digit code from your email.</p>
                <div className="field"><label>Reset code</label><input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} maxLength={6} inputMode="numeric" required /></div>
                <div className="field"><label>New Password (4+ chars) / नया पासवर्ड</label><PasswordInput value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} autoComplete="new-password" required /></div>
                <button className="btn btn-block" disabled={busy || !otp || !resetPassword}>{busy ? 'Please wait…' : 'Reset password'}</button>
              </>
            )}
            <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>Email nahi hai? Store se contact karein: 7543888698</p>
            <p className="muted" style={{ marginTop: 8, textAlign: 'center' }}>Back to <a onClick={() => switchMode('login')} style={{ color: 'var(--primary)', cursor: 'pointer' }}>Login</a></p>
          </form>
        )}
      </div>
    </div>
  );
}
