import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../store/auth';
import { useCart } from '../store/cart';
import { useMyOrders } from '../lib/queries';
import { api, apiError, setAccessToken } from '../lib/api';
import { showToast } from '../store/toast';
import { showConfirm } from '../store/confirm';
import './profile.css';
import { SkeletonOrders } from '../components/Skeleton';
import { usePages } from '../lib/pages';

const STAFF_ROLES = ['owner', 'superadmin', 'admin'];

type Status = { text: string; color: string };

export default function Profile() {
  const { user, ready, logout, setUser } = useAuth();
  const cartCount = useCart((s) => s.count());
  const clearCart = useCart((s) => s.clear);
  const navigate = useNavigate();
  const { data: orders = [] } = useMyOrders(user?.mobile);
  const pagesQ = usePages();

  // ---- recovery email (original loadRecoveryEmail / send / verify) ----
  const [email, setEmail] = useState('');
  const [emailReady, setEmailReady] = useState(false);
  const [verified, setVerified] = useState(false);
  const [code, setCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [status, setStatus] = useState<Status>({ text: '', color: 'var(--gray)' });

  useEffect(() => {
    if (ready && !user) navigate('/login?next=/profile');
  }, [ready, user, navigate]);

  async function loadRecoveryEmail() {
    try {
      const { data } = await api.get('/users/recovery-email');
      setEmail(data.email || '');
      setVerified(!!data.verified);
      setEmailReady(true);
      setStatus(
        data.verified
          ? { text: '✅ Current recovery email verified. A new email replaces it only after OTP verification.', color: '#087a3d' }
          : { text: 'No verified recovery email yet.', color: 'var(--gray)' }
      );
    } catch {
      setStatus({ text: 'Could not load recovery email status.', color: 'var(--gray)' });
    }
  }

  useEffect(() => {
    if (user) void loadRecoveryEmail();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendRecoveryEmailCode() {
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setStatus({ text: 'Enter a valid email address.', color: '#b42318' });
      return;
    }
    setStatus({ text: 'Sending verification code...', color: 'var(--gray)' });
    try {
      const { data } = await api.post('/users/recovery-email/send', { email: clean });
      if (data.alreadyVerified) {
        setPendingEmail('');
        setStatus({ text: '✅ This recovery email is already verified.', color: '#087a3d' });
        return;
      }
      setPendingEmail(clean);
      if (data.devOtp) setCode(String(data.devOtp)); // dev only (no mail server)
      setStatus({ text: 'Code sent. Check your inbox and spam folder.', color: '#087a3d' });
    } catch (e) {
      setStatus({ text: apiError(e) || 'Could not send code. Try again.', color: '#b42318' });
    }
  }

  async function verifyRecoveryEmailCode() {
    const clean = email.trim().toLowerCase();
    if (!pendingEmail || clean !== pendingEmail) {
      setStatus({ text: 'Email changed. Send a new verification code.', color: '#b42318' });
      return;
    }
    try {
      await api.post('/users/recovery-email/verify', { email: clean, otp: code.trim() });
      setPendingEmail('');
      setCode('');
      setStatus({ text: '✅ Recovery email verified and saved.', color: '#087a3d' });
      await loadRecoveryEmail();
    } catch (e) {
      setStatus({ text: apiError(e) || 'Code verification failed.', color: '#b42318' });
    }
  }

  async function handleLogout() {
    const ok = await showConfirm('Are you sure you want to logout?', { title: 'Log out?', confirmText: 'Log out' });
    if (!ok) return;
    await logout();
    showToast('Logged out successfully', 'info');
    navigate('/');
  }

  async function deleteMyAccount() {
    const ok = await showConfirm(
      'Your account details will be removed. Existing order records may be retained for legal and store records.',
      { title: 'Delete your account?', confirmText: 'Delete account', danger: true }
    );
    if (!ok) return;
    try {
      await api.post('/users/deleteSelf');
      clearCart();
      setAccessToken(null);
      setUser(null);
      showToast('Your account has been deleted.', 'success');
      navigate('/');
    } catch (e) {
      showToast(apiError(e) || 'Unable to delete account. Please contact support.', 'error');
    }
  }

  if (!user) return <div className="profile-container"><SkeletonOrders count={2} /></div>;
  const cmsPages = (pagesQ.data ?? []).filter((p) => p.showInFooter);

  const totalSpent = orders.reduce((s, o) => s + o.total_amount, 0);
  const memberSince = user.registered_at
    ? new Date(user.registered_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '-';

  return (
    <div className="profile-container">
      <Helmet>
        <title>My Profile - 4A Store</title>
        <meta name="robots" content="noindex, nofollow, noarchive" />
      </Helmet>
      <div className="profile-card">
        <div className="profile-header">
          <div className="avatar">👤</div>
          <h2>{user.name}</h2>
          <p>@{user.username || user.mobile}</p>
        </div>
        <div className="profile-body">
          <div className="profile-stats">
            <div className="stat"><div className="num">{orders.length}</div><div className="lbl">Orders</div></div>
            <div className="stat"><div className="num">₹{totalSpent}</div><div className="lbl">Total Spent</div></div>
            <div className="stat"><div className="num">{cartCount}</div><div className="lbl">In Cart</div></div>
          </div>

          <div className="profile-info">
            <div className="info-row"><span className="label">👤 Name</span><span className="value">{user.name}</span></div>
            <div className="info-row"><span className="label">📱 Mobile</span><span className="value">{user.mobile}</span></div>
            <div className="info-row"><span className="label">🆔 Username</span><span className="value">{user.username || '-'}</span></div>
            <div className="info-row"><span className="label">📅 Member Since</span><span className="value">{memberSince}</span></div>
          </div>

          <section style={{ margin: '0 0 20px', padding: '16px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
            <h3 style={{ margin: '0 0 5px', fontSize: 15, color: 'var(--dark)' }}>Password recovery email</h3>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--gray)' }}>Verify an email address to receive password reset codes.</p>
            <label htmlFor="recoveryEmail" style={{ display: 'block', marginBottom: 5, fontSize: 13, fontWeight: 700 }}>Email address</label>
            <input id="recoveryEmail" type="email" autoComplete="email" placeholder="you@example.com" readOnly={!emailReady} value={email} onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', minHeight: 44, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, font: 'inherit', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
              <button type="button" onClick={sendRecoveryEmailCode} style={{ flex: 1, minHeight: 42, padding: '9px 12px', border: 0, borderRadius: 8, background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                {verified ? 'Update recovery email' : 'Send verification code'}
              </button>
            </div>
            <p role="status" aria-live="polite" style={{ minHeight: 18, margin: '8px 0 0', fontSize: 12, color: status.color }}>{status.text}</p>
            {pendingEmail && (
              <div style={{ marginTop: 8 }}>
                <label htmlFor="recoveryEmailCode" style={{ display: 'block', marginBottom: 5, fontSize: 13, fontWeight: 700 }}>6-digit email code</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input id="recoveryEmailCode" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    style={{ flex: 1, minWidth: 0, minHeight: 42, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, font: 'inherit', letterSpacing: 2 }} />
                  <button type="button" onClick={verifyRecoveryEmailCode} style={{ minHeight: 42, padding: '9px 12px', border: 0, borderRadius: 8, background: '#087a3d', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Verify</button>
                </div>
              </div>
            )}
          </section>

          <div className="profile-actions">
            <Link to="/orders" className="action-orders">📦 My Orders <span style={{ marginLeft: 'auto', fontSize: 12 }}>{orders.length} orders →</span></Link>
            <Link to="/cart" className="action-cart">🛒 My Cart <span style={{ marginLeft: 'auto', fontSize: 12 }}>{cartCount} items →</span></Link>
            <Link to="/checkout" className="action-address">🏠 Delivery Address</Link>
            {STAFF_ROLES.includes(user.role) && (
              <Link to="/admin" className="action-admin" style={{ background: '#2C6FAD', color: 'white' }}>🔐 Admin Panel →</Link>
            )}
            {user.role === 'rider' && (
              <Link to="/rider" className="action-admin" style={{ background: '#0891b2', color: 'white' }}>🛵 Rider Console →</Link>
            )}
            <button type="button" className="action-logout" onClick={handleLogout}>🚪 Logout</button>
            <button type="button" className="action-delete" onClick={deleteMyAccount}>🗑️ Delete my account</button>
            <div className="profile-support">
              <h3>Help &amp; Legal</h3>
              <div className="profile-support-links">
                {/* Same CMS pages as the footer (Admin → Pages). */}
                {cmsPages.map((p) => <Link key={p.slug} to={`/page/${p.slug}`}>{p.title} <span>›</span></Link>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
