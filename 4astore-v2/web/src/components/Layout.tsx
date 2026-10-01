import { ReactNode } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useCart } from '../store/cart';
import { useAuth } from '../store/auth';
import SiteFooter from './SiteFooter';

export default function Layout({ children }: { children: ReactNode }) {
  const count = useCart((s) => s.count());
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  function onSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = (new FormData(e.currentTarget).get('q') as string) || '';
    navigate(`/products?search=${encodeURIComponent(q.trim())}`);
  }

  const active = (to: string) => (pathname === to ? 'nav-item active' : 'nav-item');

  return (
    <>
      <div className="top-bar">
        <div className="location-text">📍 Delivering in Chandargarh – 824301 | ☎️ 7543888698</div>
      </div>

      <header className="main-header">
        <div className="header-content">
          <Link to="/" className="logo"><img src="/legacy/images/logo.svg" alt="4A Store" height={52} /></Link>
          <form className="search-box" onSubmit={onSearch}>
            <input type="text" name="q" placeholder="Search for groceries, fruits, snacks..." />
            <button type="submit">🔍</button>
          </form>
          <div className="header-actions">
            <div className="login-btn-area">
              {user ? (
                // Original updateLoginUI(): initial avatar + first name, linking to the profile page.
                <Link to="/profile" title={user.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ background: 'var(--primary)', color: 'white', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="action-text">{user.name.split(' ')[0]}</span>
                </Link>
              ) : (
                <Link to="/login">👤 <span className="action-text">Login</span></Link>
              )}
            </div>
            <Link to="/orders" id="headerOrdersLink">📋 <span className="action-text">Orders</span></Link>
            <Link to="/cart" className="cart-badge">🛒 <span className="action-text">Cart</span>
              {count > 0 && <span className="badge cart-count">{count}</span>}
            </Link>
          </div>
        </div>
      </header>

      <main>{children}</main>

      {/* One common footer for every storefront page (Admin → Settings → Footer). */}
      <SiteFooter />

      <nav className="bottom-nav">
        <div className="nav-items">
          <Link to="/" className={active('/')}><span className="nav-icon">🏠</span>Home</Link>
          <Link to="/products" className={active('/products')}><span className="nav-icon">📂</span>Categories</Link>
          <Link to="/cart" className={active('/cart')}><span className="nav-icon">🛒</span>Cart{count > 0 && <span className="mobile-badge cart-count">{count}</span>}</Link>
          <Link to="/orders" className={active('/orders')}><span className="nav-icon">📦</span>Orders</Link>
          <Link to={user ? '/profile' : '/login'} className={active('/profile')}><span className="nav-icon">👤</span>Profile</Link>
        </div>
      </nav>
    </>
  );
}
