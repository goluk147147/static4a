import { Link } from 'react-router-dom';

/**
 * Sidebar sections from the original admin.html that have not been ported to
 * React yet. They are shown (so the menu matches the original) but say so plainly
 * instead of showing a fake/empty screen.
 */
export default function AdminPending({ title, note }: { title: string; note?: string }) {
  return (
    <div className="admin-pending">
      <div style={{ fontSize: 32, marginBottom: 8 }}>🚧</div>
      <h3 style={{ margin: '0 0 6px' }}>{title} — abhi React me port nahi hua</h3>
      <p style={{ margin: 0, fontSize: 13 }}>{note || 'Ye section original admin panel me hai; iska React version agla kaam hai.'}</p>
      <p style={{ margin: '12px 0 0', fontSize: 13 }}>
        <Link to="/admin" style={{ color: 'var(--primary-dark)', fontWeight: 700 }}>← Dashboard par wapas</Link>
      </p>
    </div>
  );
}
