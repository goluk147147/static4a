import { useEffect, useState } from 'react';
import { fetchNotifications, AdminNotification } from '../../lib/admin';
import { apiError } from '../../lib/api';

const PAGE_SIZE = 50;

const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--primary-dark)', marginBottom: 4 };
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '2px solid var(--border)', borderRadius: 8, fontSize: 13 };

function fmtDate(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v || '-';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function targetLink(n: AdminNotification): React.ReactNode {
  if (n.productId != null) return <a href={`/product/${n.productId}`} target="_blank" rel="noreferrer">Product #{n.productId}</a>;
  if (n.orderId) return <span>Order {n.orderId}</span>;
  if (n.link) return <span style={{ wordBreak: 'break-all' }}>{n.link}</span>;
  return <span style={{ color: 'var(--gray)' }}>—</span>;
}

export default function AdminNotifications() {
  const [rows, setRows] = useState<AdminNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Filter inputs (text) and the applied filter values used for queries.
  const [userIdInput, setUserIdInput] = useState('');
  const [productIdInput, setProductIdInput] = useState('');
  const [applied, setApplied] = useState<{ userId: string; productId: string }>({ userId: '', productId: '' });

  async function load(cursor: string | null, reset: boolean) {
    setLoading(true);
    setErr(null);
    try {
      const page = await fetchNotifications({
        userId: applied.userId || undefined,
        productId: applied.productId || undefined,
        limit: PAGE_SIZE,
        cursor: cursor || undefined,
      });
      setRows((prev) => (reset ? page.notifications : [...prev, ...page.notifications]));
      setNextCursor(page.nextCursor);
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setLoading(false);
    }
  }

  // Reload from the top whenever applied filters change (and on first mount).
  useEffect(() => {
    void load(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setApplied({ userId: userIdInput.trim(), productId: productIdInput.trim() });
  }

  function clearFilters() {
    setUserIdInput('');
    setProductIdInput('');
    setApplied({ userId: '', productId: '' });
  }

  return (
    <>
      <h4 style={{ margin: '0 0 6px' }}>🗂️ Notification Log</h4>
      <p style={{ fontSize: 13, color: 'var(--gray)', margin: '0 0 16px' }}>Bheji gayi sabhi notifications ka record — kis user/product ke liye, kitni success/fail hui.</p>

      <form onSubmit={applyFilters} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16, maxWidth: 640 }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={lbl} htmlFor="notif_user">User ID (optional)</label>
          <input id="notif_user" value={userIdInput} inputMode="numeric" onChange={(e) => setUserIdInput(e.target.value.replace(/[^0-9]/g, ''))} placeholder="e.g. 42" style={inp} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={lbl} htmlFor="notif_prod">Product ID (optional)</label>
          <input id="notif_prod" value={productIdInput} inputMode="numeric" onChange={(e) => setProductIdInput(e.target.value.replace(/[^0-9]/g, ''))} placeholder="e.g. 12" style={inp} />
        </div>
        <button type="submit" style={{ padding: '9px 18px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>🔍 Filter</button>
        {(applied.userId || applied.productId) && (
          <button type="button" onClick={clearFilters} style={{ padding: '9px 16px', background: '#666', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Clear</button>
        )}
      </form>

      {err && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: 10, borderRadius: 8, marginBottom: 12, maxWidth: 640 }}>{err}</div>
      )}

      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid var(--border)', borderRadius: 12 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Title</th><th>Type</th><th>Target</th><th>Link / Product</th><th>Success</th><th>Fail</th><th>Sent by</th><th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((n) => (
                <tr key={n.id}>
                  <td><strong>{n.title || '-'}</strong>{n.body ? <div style={{ fontSize: 11, color: 'var(--gray)', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.body}</div> : null}</td>
                  <td>{n.type || '-'}</td>
                  <td>{n.target || '-'}</td>
                  <td>{targetLink(n)}</td>
                  <td style={{ color: '#2e7d32', fontWeight: 600 }}>{n.successCount}</td>
                  <td style={{ color: n.failureCount ? '#c62828' : '#999', fontWeight: 600 }}>{n.failureCount}</td>
                  <td>{n.sentBy || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(n.createdAt)}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--gray)' }}>{loading ? 'Loading…' : 'No notifications yet'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        {nextCursor && (
          <button type="button" onClick={() => load(nextCursor, false)} disabled={loading}
            style={{ padding: '9px 20px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
        {rows.length > 0 && <span style={{ fontSize: 12, color: 'var(--gray)' }}>{rows.length} shown</span>}
      </div>
    </>
  );
}
