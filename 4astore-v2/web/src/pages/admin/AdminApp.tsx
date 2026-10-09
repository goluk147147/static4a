import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../store/auth';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';
import { showConfirm } from '../../store/confirm';
import { canAdmin, useAdminOrders } from './adminData';
import { useOrderNotifications, unlockNotifAudio } from './useOrderNotifications';
import PasswordInput from '../../components/PasswordInput';
import './admin.css';

const STAFF_ROLES = ['owner', 'superadmin', 'admin'];

// Same order, icons, titles and permission keys as the original sidebar.
export const ADMIN_TABS = [
  { path: '', key: 'dashboard', icon: '📊', label: 'Dashboard', title: '📊 Dashboard' },
  { path: 'orders', key: 'orders', icon: '📦', label: 'Orders', title: '📦 Orders' },
  { path: 'rider-tracking', key: 'riderTracking', icon: '📍', label: 'Rider Tracking', title: '📍 Rider Tracking' },
  { path: 'products', key: 'products', icon: '🛍️', label: 'Products', title: '🛍️ Products' },
  { path: 'categories', key: 'categories', icon: '🗂️', label: 'Categories', title: '🗂️ Categories' },
  { path: 'banners', key: 'banners', icon: '🖼️', label: 'Banners', title: '🖼️ Banners' },
  { path: 'ads', key: 'ads', icon: '📢', label: 'Ads & Social', title: '📢 Ads & Social Media' },
  { path: 'users', key: 'users', icon: '👥', label: 'Users', title: '👥 Users' },
  { path: 'earnings', key: 'earnings', icon: '💰', label: 'Earnings', title: '💰 Earnings' },
  { path: 'settings', key: 'settings', icon: '⚙️', label: 'Settings', title: '⚙️ Settings' },
  { path: 'seo', key: 'settings', icon: '🔍', label: 'SEO', title: '🔍 SEO Engine' },
  { path: 'pages', key: 'settings', icon: '📄', label: 'Pages', title: '📄 Pages (Privacy, Terms, Help…)' },
  { path: 'team', key: 'team', icon: '🔐', label: 'Team Access', title: '🔐 Team Access' },
  { path: 'notify', key: 'ads', icon: '🔔', label: 'Push Notifications', title: '🔔 Push Notifications' },
];

function useBodyClass(className: string, on: boolean) {
  useEffect(() => {
    if (!on) return;
    className.split(' ').forEach((c) => document.body.classList.add(c));
    return () => className.split(' ').forEach((c) => document.body.classList.remove(c));
  }, [className, on]);
}

/** Original admin login screen (saffron card with brand lock-up). */
function AdminLogin() {
  const { login, logout } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    unlockNotifAudio(); // login click = user gesture, so later order beeps are allowed
    setBusy(true);
    setError(false);
    try {
      await login(username.trim(), password);
      const user = useAuth.getState().user;
      if (!user || !STAFF_ROLES.includes(user.role)) {
        await logout();
        setError(true);
        showToast('Admin access required', 'error');
      }
    } catch (err) {
      setError(true);
      showToast(apiError(err) || 'Admin login failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-login" style={{ display: 'flex' }}>
      <div className="checkout-form">
        <div className="admin-brand-lockup">
          <div className="admin-brand-top">
            <img className="admin-brand-mark" src="/legacy/images/favicon.svg" alt="4AStore logo" />
            <div>
              <h1 className="admin-brand-name">4AStore</h1>
              <p className="admin-brand-tagline">Grocery in minutes</p>
            </div>
          </div>
          <div className="admin-grocery-hero">
            <span className="grocery-icon">🛒</span>
            <strong>Fresh groceries. Fast delivery.</strong>
            <p>Keep orders moving, stock updated, and every neighbourhood delivery on time.</p>
          </div>
          <div className="admin-ops-pills"><span>📦 Orders</span><span>🥬 Fresh stock</span><span>🚴 Quick delivery</span></div>
        </div>
        <form className="admin-login-form" onSubmit={submit}>
          <h2 className="admin-login-heading">Login</h2>
          <p className="admin-login-subtitle">Access your secure store workspace.</p>
          <div className={`form-group${error ? ' error' : ''}`}>
            <label htmlFor="adminUser">Admin Username</label>
            <input type="text" id="adminUser" placeholder="Enter admin username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <label htmlFor="adminPass" style={{ marginTop: 10 }}>Admin Password</label>
            <PasswordInput id="adminPass" placeholder="Enter admin password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="error-msg">Incorrect username or password</div>
          </div>
          <button className="btn-checkout" type="submit" disabled={busy}>{busy ? '⏳ Signing in…' : '🔓 SIGN IN'}</button>
          <p className="login-note">Use your assigned admin username and password.</p>
        </form>
      </div>
      <p className="admin-login-footer">© 2026 4AStore · Grocery in minutes</p>
    </div>
  );
}

function NotificationBell({ notifs, unread, onOpen, onMarkAll }: {
  notifs: ReturnType<typeof useOrderNotifications>['notifs'];
  unread: number;
  onOpen: (orderId: string) => void;
  onMarkAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div style={{ position: 'relative' }} ref={wrapRef}>
      <button type="button" onClick={() => setOpen((o) => !o)} title="Notifications" aria-label={`Notifications, ${unread} unread`}
        style={{ position: 'relative', background: 'white', border: '1px solid var(--border)', borderRadius: '50%', width: 42, height: 42, fontSize: 19, cursor: 'pointer', boxShadow: 'var(--shadow)' }}>
        🔔
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -4, background: '#e53935', color: 'white', fontSize: 11, fontWeight: 700, minWidth: 18, height: 18, lineHeight: '18px', borderRadius: 9, padding: '0 4px' }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 52, width: 320, maxWidth: '88vw', background: 'white', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.18)', zIndex: 9998, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--primary-light)' }}>
            <strong style={{ color: 'var(--primary-dark)', fontSize: 14 }}>🔔 Notifications</strong>
            <button type="button" onClick={onMarkAll} style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Mark all read</button>
          </div>
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {notifs.length === 0 ? (
              <div style={{ padding: '26px 14px', textAlign: 'center', color: 'var(--gray)', fontSize: 13 }}>No notifications yet</div>
            ) : (
              notifs.map((n) => (
                <button type="button" key={`${n.orderId}-${n.time}`} onClick={() => { setOpen(false); onOpen(n.orderId); }}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 14px', border: 0, borderBottom: '1px solid #f0f0f0', cursor: 'pointer', background: n.read ? 'white' : '#fff6ec', width: '100%', textAlign: 'left', font: 'inherit' }}>
                  <span style={{ width: 8, height: 8, marginTop: 5, background: n.read ? 'transparent' : '#e53935', borderRadius: '50%', flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, color: 'var(--primary-dark)', fontWeight: n.read ? 500 : 700 }}>🛒 New order #{n.orderId}</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#666' }}>{n.name} · ₹{n.amount}</span>
                    <span style={{ display: 'block', fontSize: 11, color: '#aaa', marginTop: 2 }}>
                      {new Date(n.time).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const canOrders = canAdmin(user?.role, user?.permissions, 'orders') || canAdmin(user?.role, user?.permissions, 'dashboard');
  const { data: orders } = useAdminOrders(canOrders);
  const notif = useOrderNotifications(orders, user?.username || user?.id);

  const sub = pathname.replace(/^\/admin\/?/, '').split('/')[0];
  const current = ADMIN_TABS.find((t) => t.path === sub) || ADMIN_TABS[0];
  const allowed = canAdmin(user?.role, user?.permissions, current.key);

  // Close the mobile drawer whenever the tab changes (original toggleSidebar(false)).
  useEffect(() => setSidebarOpen(false), [pathname]);

  async function adminLogout() {
    const ok = await showConfirm('Log out of the admin panel?', { title: 'Log out?', confirmText: 'Log out' });
    if (!ok) return;
    await logout();
    qc.removeQueries({ queryKey: ['admin-orders'] });
    qc.removeQueries({ queryKey: ['admin-users'] });
    navigate('/admin');
  }

  function openNotif(orderId: string) {
    notif.markRead(orderId);
    navigate(`/admin/orders?view=${encodeURIComponent(orderId)}`);
  }

  return (
    <div id="adminDashboard" className={`admin-shell${sidebarOpen ? ' sidebar-open' : ''}`} onClick={unlockNotifAudio}>
      <aside className="admin-sidebar" id="adminSidebar">
        <div className="side-brand">
          <img src="/legacy/images/favicon.svg" alt="4AStore logo" />
          <div className="side-brand-copy"><strong>4AStore</strong><small>Grocery in minutes</small></div>
          <span className="brand-tag">ADMIN</span>
        </div>
        <nav>
          {ADMIN_TABS.filter((t) => canAdmin(user?.role, user?.permissions, t.key)).map((t) => (
            <NavLink key={t.path} to={t.path ? `/admin/${t.path}` : '/admin'} end={!t.path} className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}>
              <span className="side-ic">{t.icon}</span> {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <Link to="/">🏠 View Store</Link>
          <button type="button" onClick={() => navigate('/admin/rider-tracking')} style={{ color: '#fff' }}>📍 Rider Live Tracking</button>
          <button type="button" onClick={adminLogout} style={{ color: '#ffd0d0' }}>🚪 Logout</button>
        </div>
      </aside>
      <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />

      <div className="admin-main">
        <div className="admin-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" className="side-toggle" onClick={() => setSidebarOpen((o) => !o)} aria-label="Menu">☰</button>
            <span className="page-title">{current.title}</span>
          </div>
          <div className="topbar-actions">
            {canOrders && <NotificationBell notifs={notif.notifs} unread={notif.unread} onOpen={openNotif} onMarkAll={notif.markAllRead} />}
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--gray)', cursor: 'pointer' }}>
              <input type="checkbox" checked={notif.soundOn} onChange={(e) => notif.setSoundOn(e.target.checked)} style={{ cursor: 'pointer' }} /> 🔊 Sound
            </label>
            <button type="button" onClick={notif.testNotif} title="Test notification" style={{ padding: '8px 12px', background: 'var(--secondary)', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>🔔 Test</button>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--primary-dark)', fontWeight: 600 }}>👤 {user?.name || user?.username || 'Admin'}</span>
          </div>
        </div>

        <div className="admin-content">
          <div className="tab-content">
            {allowed ? <Outlet /> : <p style={{ textAlign: 'center', padding: 40, color: '#c62828' }}>You do not have permission for this section.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** /admin/* entry: boot loader → login (if not staff) → persistent shell. */
export default function AdminApp() {
  const { user, ready } = useAuth();
  const isStaff = !!user && STAFF_ROLES.includes(user.role);

  useBodyClass('admin-body', true);
  useBodyClass('admin-login-page', ready && !isStaff);
  useBodyClass('admin-active', ready && isStaff);

  return (
    <>
      <Helmet>
        <title>Admin Panel - 4A Store</title>
        <meta name="robots" content="noindex, nofollow, noarchive" />
      </Helmet>
      {!ready ? (
        <div id="adminBootLoader" role="status" aria-live="polite"><span className="admin-boot-spinner" aria-hidden="true" />Checking admin session...</div>
      ) : isStaff ? (
        <AdminShell />
      ) : (
        <AdminLogin />
      )}
    </>
  );
}
