import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../store/auth';
import { useMyOrders, useSettings, MyOrder } from '../lib/queries';
import { downloadInvoice } from '../lib/invoice';
import { showToast } from '../store/toast';

// Original app.js getStatusClass()
const STATUS_CLASS: Record<string, string> = {
  'Order Placed': 'status-placed',
  Confirmed: 'status-confirmed',
  Processing: 'status-processing',
  'Out for Delivery': 'status-out',
  Delivered: 'status-delivered',
};

// Original app.js formatDate()
const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function Orders() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const settings = useSettings().data;
  const { data: orders, isLoading, isError } = useMyOrders(user?.mobile);

  useEffect(() => {
    if (ready && !user) navigate('/login?next=/orders');
  }, [ready, user, navigate]);

  async function invoice(order: MyOrder) {
    try {
      const result = await downloadInvoice(order, settings?.storePhone, settings?.storeAddress);
      if (result === 'saved-to-downloads') showToast('📄 Invoice saved to Downloads', 'success');
    } catch {
      showToast('Invoice could not be created. Please try again.', 'error');
    }
  }

  return (
    <div className="orders-page">
      <Helmet>
        <title>My Orders - 4A Store</title>
        <meta name="robots" content="noindex, nofollow, noarchive" />
      </Helmet>
      <h2 style={{ marginBottom: 20 }}>📋 My Orders</h2>

      {(isLoading || !user) && (
        <>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton-order">
              <div className="skeleton-order-header"><div className="skeleton-text shimmer" style={{ width: 120 }} /><div className="skeleton-text shimmer" style={{ width: 80 }} /></div>
              <div className="skeleton-order-items"><div className="skeleton-text shimmer" style={{ width: '90%' }} /><div className="skeleton-text shimmer" style={{ width: '70%' }} /></div>
              <div className="skeleton-order-footer"><div className="skeleton-text shimmer" style={{ width: 150 }} /><div className="skeleton-text shimmer" style={{ width: 80 }} /></div>
            </div>
          ))}
        </>
      )}

      {isError && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}><p>Unable to load data. Please refresh the page.</p></div>
      )}

      {orders && orders.length === 0 && (
        <div className="empty-cart">
          <div className="empty-icon">📋</div>
          <h3>No orders yet</h3>
          <p>You haven't placed any orders yet. Start shopping!</p>
          <Link to="/products" className="btn-primary">Browse Products →</Link>
        </div>
      )}

      {orders?.map((order) => (
        <div key={order.order_id} className="order-card">
          <div className="order-header">
            <div>
              <span className="order-id-text">#{order.order_id}</span>
              <span className="order-date"> · {formatDate(order.order_date)}</span>
            </div>
            <span className={`order-status ${STATUS_CLASS[order.order_status] || 'status-placed'}`}>{order.order_status}</span>
          </div>
          <div className="order-items-list">
            {order.items.map((item, i) => (
              <div key={`${item.id ?? item.name}-${i}`} className="o-item">
                <span>{item.name} × {item.quantity}</span>
                <span>₹{item.price * item.quantity}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13, color: 'var(--gray)' }}>
              📍 {order.customer.address}, {order.customer.city} – {order.customer.pincode}
              <br />💳 {order.payment_method}
            </div>
            <div className="order-total">Total: ₹{order.total_amount}</div>
          </div>
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <Link to={`/track/${order.order_id}`} style={{ display: 'inline-block', padding: '9px 18px', background: '#0891b2', color: 'white', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none', marginRight: 8 }}>📍 Track Order</Link>
            <button type="button" onClick={() => invoice(order)} style={{ padding: '9px 18px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>📄 Download Invoice</button>
          </div>
        </div>
      ))}
    </div>
  );
}
