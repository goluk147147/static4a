import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../store/auth';
import { api, apiError } from '../lib/api';
import PasswordInput from '../components/PasswordInput';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
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

  return (
    <div className="container">
      <Helmet><title>{`${mode === 'login' ? 'Login' : 'Sign Up'} | 4A Store`}</title></Helmet>
      <div className="form-card">
        <h2>{mode === 'login' ? 'Welcome back 👋' : 'Create your account'}</h2>
        {error && <div className="error">{error}</div>}

        {mode === 'login' ? (
          <form onSubmit={doLogin}>
            <div className="field"><label>Username or Mobile</label><input value={username} onChange={(e) => setUsername(e.target.value)} required /></div>
            <div className="field"><label>Password</label><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
            <button className="btn btn-block" disabled={busy}>{busy ? 'Please wait…' : 'Login'}</button>
            <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>New here? <a onClick={() => { setMode('register'); setError(''); }} style={{ color: 'var(--primary)', cursor: 'pointer' }}>Create account</a></p>
          </form>
        ) : (
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
            <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>Already have an account? <a onClick={() => { setMode('login'); setError(''); }} style={{ color: 'var(--primary)', cursor: 'pointer' }}>Login</a></p>
          </form>
        )}
      </div>
    </div>
  );
}
