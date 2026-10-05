import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../../lib/api';
import { updateOrderStatus, deleteOrder } from '../../lib/admin';
import { useSettings } from '../../lib/queries';
import { downloadInvoice } from '../../lib/invoice';
import { showToast } from '../../store/toast';
import { showConfirm } from '../../store/confirm';
import { useAdminOrders, AdminOrderFull, formatDate, ADMIN_ORDERS_KEY } from './adminData';
import AdminModal from './AdminModal';

// Original status <select> options (plus any other status the order already has).
const STATUS_OPTIONS: [string, string][] = [
  ['Order Placed', '📋 Order Placed'],
  ['Confirmed', '✅ Confirmed'],
  ['Processing', '⚙️ Processing'],
  ['Out for Delivery', '🚴 Out for Delivery'],
  ['Delivered', '✅ Delivered'],
];

const STATUS_CLASS: Record<string, string> = {
  'Order Placed': 'status-placed', Confirmed: 'status-confirmed', Processing: 'status-processing',
  'Out for Delivery': 'status-out', Delivered: 'status-delivered',
};

const PAGE_SIZE = 10;

/** Loads the payment screenshot with the auth header (an <img src> can't send one). */
function PaymentScreenshot({ orderId }: { orderId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    api
      .get(`/orders/${encodeURIComponent(orderId)}/screenshot`, { responseType: 'blob' })
      .then((r) => {
        objectUrl = URL.createObjectURL(r.data as Blob);
        setUrl(objectUrl);
      })
      .catch(() => setMissing(true));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [orderId]);

  return (
    <>
      <h4 style={{ marginTop: 16, marginBottom: 8 }}>📸 Payment Screenshot</h4>
      {url && <img src={url} style={{ maxWidth: '100%', borderRadius: 8, border: '2px solid var(--primary)' }} alt="Payment Screenshot" />}
      {missing && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--gray)' }}>⚠️ No payment screenshot found</p>}
      {!url && !missing && <p style={{ fontSize: 13, color: 'var(--gray)' }}>Loading screenshot…</p>}
    </>
  );
}

function OrderDetail({ order, onClose }: { order: AdminOrderFull; onClose: () => void }) {
  const settings = useSettings().data;
  const c = order.customer || {};
  const dest = order.delivery_address || {};
  return (
    <AdminModal onClose={onClose}>
      <h3 style={{ color: 'var(--primary)', marginBottom: 12 }}>Order #{order.order_id}</h3>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16 }}>{formatDate(order.order_date)}</p>

      <h4 style={{ marginBottom: 8 }}>👤 Customer</h4>
      <p><strong>{c.name}</strong></p>
      <p>📱 <a href={`tel:${c.mobile}`}>{c.mobile}</a></p>
      <p>📍 {c.address}, {c.city} – {c.pincode}</p>
      {dest.landmark && <p>🏷️ {dest.landmark}</p>}

      <h4 style={{ marginTop: 16, marginBottom: 8 }}>📦 Items</h4>
      {order.items.map((item, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14 }}>
          <span>{item.name} × {item.quantity}</span>
          <span>₹{item.price * item.quantity}</span>
        </div>
      ))}

      <div style={{ marginTop: 16, padding: 12, background: '#e8f5e9', borderRadius: 8, fontSize: 14 }}>
        <strong>🛵 Rider details</strong>
        <p style={{ margin: '6px 0 0', color: 'var(--gray)' }}>
          {order.rider_name ? <>{order.rider_name}{order.rider_mobile && <> · 📞 <a href={`tel:${order.rider_mobile}`}>{order.rider_mobile}</a></>}</> : 'No rider assigned yet'}
        </p>
        <Link to={`/track/${encodeURIComponent(order.order_id)}`} target="_blank" rel="noopener" style={{ display: 'inline-block', marginTop: 10, padding: '9px 12px', borderRadius: 8, background: '#0891b2', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
          🛵 राइडर ट्रैकिंग खोलें
        </Link>
      </div>

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '2px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>Subtotal</span><span>₹{order.subtotal}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--primary)' }}><span>Discount</span><span>-₹{order.discount}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>Delivery</span><span>₹{order.delivery_charge}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 700, color: 'var(--primary-dark)', marginTop: 8, paddingTop: 8, borderTop: '2px solid var(--border)' }}>
          <span>Total</span><span>₹{order.total_amount}</span>
        </div>
      </div>

      <div style={{ marginTop: 16, padding: 12, background: 'var(--primary-light)', borderRadius: 8 }}>
        <p><strong>Payment:</strong> {order.payment_method}{order.payment_reference ? ` · UTR ${order.payment_reference}` : ''}</p>
        <p><strong>Status:</strong> <span className={`order-status ${STATUS_CLASS[order.order_status] || 'status-placed'}`}>{order.order_status}</span></p>
      </div>

      <PaymentScreenshot orderId={order.order_id} />

      <div className="admin-invoice-actions">
        <button type="button" onClick={() => downloadInvoice(order, settings?.storePhone, settings?.storeAddress).catch(() => showToast('Invoice could not be created', 'error'))}
          style={{ padding: 11, background: 'var(--primary)', color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
          📄 Download A4
        </button>
      </div>
      <button type="button" onClick={onClose} style={{ marginTop: 16, width: '100%', padding: 10, background: 'var(--gray)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Close</button>
    </AdminModal>
  );
}

export default function AdminOrders() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: orders = [], isLoading } = useAdminOrders();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const viewId = params.get('view');
  const viewing = viewId ? orders.find((o) => o.order_id === viewId) : undefined;
  const openView = (id: string) => setParams({ view: id });
  const closeView = () => setParams({});

  if (isLoading) return <p style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>Loading orders...</p>;
  if (orders.length === 0) return <p style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>No orders yet</p>;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? orders.filter((o) => String(o.customer?.name || '').toLowerCase().includes(q) || o.order_id.toLowerCase().includes(q))
    : orders;
  // Same as the original: searching shows every match on one page.
  const pageSize = q ? Math.max(filtered.length, 1) : PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageOrders = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function applySearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  async function changeStatus(orderId: string, status: string) {
    try {
      await updateOrderStatus(orderId, status);
      showToast(`Order #${orderId} → ${status}`, 'success');
      qc.invalidateQueries({ queryKey: ADMIN_ORDERS_KEY });
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  async function remove(orderId: string) {
    const ok = await showConfirm(`Permanently delete order #${orderId}? This also removes its tracking and payment screenshot.`, {
      title: 'Delete order', confirmText: 'Delete', danger: true,
    });
    if (!ok) return;
    try {
      await deleteOrder(orderId);
      showToast(`Order #${orderId} deleted.`, 'success');
      qc.invalidateQueries({ queryKey: ADMIN_ORDERS_KEY });
    } catch (e) {
      showToast(apiError(e) || 'Order could not be deleted. Please try again.', 'error');
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input value={searchInput} placeholder="Search customer name or Order ID" aria-label="Search orders"
          onChange={(e) => { setSearchInput(e.target.value); if (!e.target.value.trim()) applySearch(''); }}
          onKeyDown={(e) => e.key === 'Enter' && applySearch(searchInput)}
          style={{ flex: 1, minWidth: 220, maxWidth: 380, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }} />
        <button type="button" onClick={() => applySearch(searchInput)} style={{ padding: '10px 14px', border: 0, borderRadius: 8, background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Search</button>
        <span style={{ fontSize: 12, color: 'var(--gray)' }}>{filtered.length} order{filtered.length === 1 ? '' : 's'}</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr><th>Order ID</th><th>Date</th><th>Customer</th><th>Mobile</th><th>Items</th><th>Total</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            {pageOrders.length ? (
              pageOrders.map((o) => {
                const options = STATUS_OPTIONS.some(([v]) => v === o.order_status) ? STATUS_OPTIONS : [...STATUS_OPTIONS, [o.order_status, o.order_status] as [string, string]];
                return (
                  <tr key={o.order_id}>
                    <td><strong>#{o.order_id}</strong></td>
                    <td>{formatDate(o.order_date)}</td>
                    <td>{o.customer?.name}</td>
                    <td><a href={`tel:${o.customer?.mobile}`}>{o.customer?.mobile}</a></td>
                    <td>{o.items.length} items</td>
                    <td><strong>₹{o.total_amount}</strong></td>
                    <td>
                      <select className="status-select" value={o.order_status} onChange={(e) => changeStatus(o.order_id, e.target.value)} aria-label={`Status of order ${o.order_id}`}>
                        {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" onClick={() => openView(o.order_id)} style={{ padding: '6px 10px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>👁️ View</button>{' '}
                      <button type="button" onClick={() => remove(o.order_id)} title="Delete fake or test order" aria-label={`Delete order ${o.order_id}`} style={{ padding: '6px 10px', background: '#c62828', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>🗑️ Delete</button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--gray)' }}>No customer found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-pager">
        <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1}>← Prev</button>
        <span style={{ fontSize: 12, color: 'var(--gray)' }}>Page {currentPage} of {pageCount}</span>
        <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= pageCount}>Next →</button>
      </div>

      {viewing && <OrderDetail order={viewing} onClose={closeView} />}
    </>
  );
}
