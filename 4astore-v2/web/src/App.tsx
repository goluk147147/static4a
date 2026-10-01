import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import Page from './pages/Page';
import AdminPages from './pages/admin/AdminPages';
import Layout from './components/Layout';
import Home from './pages/Home';
import Products from './pages/Products';
import ProductDetails from './pages/ProductDetails';
import Cart from './pages/Cart';
import Checkout from './pages/checkout/Checkout';
import Orders from './pages/Orders';
import Track from './pages/Track';
import Login from './pages/Login';
import Profile from './pages/Profile';
import Rider from './pages/Rider';
import AdminApp from './pages/admin/AdminApp';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminOrders from './pages/admin/AdminOrders';
import AdminRiderTracking from './pages/admin/AdminRiderTracking';
import AdminProducts from './pages/admin/AdminProducts';
import AdminUsers from './pages/admin/AdminUsers';
import AdminBanners from './pages/admin/AdminBanners';
import AdminCategories from './pages/admin/AdminCategories';
import AdminNotify from './pages/admin/AdminNotify';
import AdminPending from './pages/admin/AdminPending';
import AdminEarnings from './pages/admin/AdminEarnings';
import AdminAds from './pages/admin/AdminAds';
import AdminTeam from './pages/admin/AdminTeam';
import AdminSettings from './pages/admin/AdminSettings';
import { useAuth } from './store/auth';
import ErrorBoundary from './components/ErrorBoundary';

const LEGAL_PAGES = ['privacy-policy', 'terms', 'help-support', 'account-deletion'];

/** /legacy-pages/terms.html (links shared from the previous build) → /page/terms */
function LegacyPageRedirect() {
  const { file = '' } = useParams();
  return <Navigate to={`/page/${file.replace(/\.html$/, '')}`} replace />;
}

/** track.html?orderId=X → /track/X */
function TrackLegacy() {
  const id = new URLSearchParams(useLocation().search).get('orderId');
  return <Navigate to={id ? `/track/${encodeURIComponent(id)}` : '/track'} replace />;
}

// Customer/rider pages share the storefront chrome; admin pages have their own shell.
function Shop({ children }: { children: React.ReactNode }) {
  return <Layout><ErrorBoundary>{children}</ErrorBoundary></Layout>;
}

export default function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <ErrorBoundary>
    <Routes>
      {/* Admin: one persistent shell (login/boot loader/sidebar); tabs render in its <Outlet/> */}
      <Route path="/admin" element={<AdminApp />}>
        <Route index element={<AdminDashboard />} />
        <Route path="orders" element={<AdminOrders />} />
        <Route path="rider-tracking" element={<AdminRiderTracking />} />
        <Route path="products" element={<AdminProducts />} />
        <Route path="categories" element={<AdminCategories />} />
        <Route path="banners" element={<AdminBanners />} />
        <Route path="ads" element={<AdminAds />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="earnings" element={<AdminEarnings />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="team" element={<AdminTeam />} />
        <Route path="pages" element={<AdminPages />} />
        <Route path="notify" element={<AdminNotify />} />
        <Route path="*" element={<AdminPending title="Page" note="Ye admin page maujood nahi hai." />} />
      </Route>

      {/* Rider console */}
      <Route path="/rider" element={<Shop><Rider /></Shop>} />

      {/* Storefront */}
      <Route path="/" element={<Shop><Home /></Shop>} />
      <Route path="/products" element={<Shop><Products /></Shop>} />
      <Route path="/product/:id" element={<Shop><ProductDetails /></Shop>} />
      <Route path="/cart" element={<Shop><Cart /></Shop>} />
      <Route path="/checkout" element={<Shop><Checkout /></Shop>} />
      <Route path="/orders" element={<Shop><Orders /></Shop>} />
      <Route path="/track" element={<Shop><Track /></Shop>} />
      <Route path="/track/:orderId" element={<Shop><Track /></Shop>} />
      <Route path="/login" element={<Shop><Login /></Shop>} />
      <Route path="/profile" element={<Shop><Profile /></Shop>} />

      {/* CMS pages (Admin → Pages) */}
      <Route path="/page/:slug" element={<Shop><Page /></Shop>} />

      {/* Old site URLs (shared links, Play Store policy URL) → CMS pages */}
      {LEGAL_PAGES.flatMap((p) => [p, `${p}.html`]).map((p) => (
        <Route key={p} path={`/${p}`} element={<Navigate to={`/page/${p.replace(/\.html$/, '')}`} replace />} />
      ))}
      <Route path="/legacy-pages/:file" element={<LegacyPageRedirect />} />
      <Route path="/order-history" element={<Navigate to="/orders" replace />} />
      <Route path="/order-history.html" element={<Navigate to="/orders" replace />} />
      <Route path="/track.html" element={<TrackLegacy />} />
      <Route path="/products.html" element={<Navigate to="/products" replace />} />
      <Route path="/cart.html" element={<Navigate to="/cart" replace />} />
      <Route path="*" element={<Shop><div className="container" style={{ padding: 40 }}>Page not found. <a href="/">Go home</a></div></Shop>} />
    </Routes>
    </ErrorBoundary>
  );
}
