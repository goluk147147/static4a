import { useMemo, useState } from 'react';
import { downloadText } from '../../lib/admin';
import { showToast } from '../../store/toast';
import { useAdminOrders, AdminOrderFull } from './adminData';
import AdminModal from './AdminModal';

interface ItemRow {
  date: string; orderId: string; customer: string; item: string; weight: string; qty: number; price: number; lineTotal: number;
}

const dayKey = (d: string) => new Date(d).toLocaleDateString('en-IN');

// Original collectDeliveredItems(): delivered line items, optionally for one day key.
function collectDeliveredItems(orders: AdminOrderFull[], dateKey?: string): ItemRow[] {
  const rows: ItemRow[] = [];
  for (const o of orders) {
    const dk = dayKey(o.order_date);
    if (dateKey && dk !== dateKey) continue;
    for (const it of o.items || []) {
      const qty = Number(it.quantity) || 0;
      const price = Number(it.price) || 0;
      rows.push({ date: dk, orderId: o.order_id || '', customer: o.customer?.name || '', item: it.name || `#${it.id}`, weight: it.weight || '', qty, price, lineTotal: qty * price });
    }
  }
  return rows;
}

// Original downloadItemsCSV(): BOM so Excel reads ₹ / Hindi, totals row at the end.
function downloadItemsCSV(orders: AdminOrderFull[], dateKey?: string) {
  const rows = collectDeliveredItems(orders, dateKey);
  if (!rows.length) return showToast('Koi data nahi mila', 'info');
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    // Also neutralise spreadsheet formulas (=, +, -, @) coming from customer names / item names.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [['Date', 'Order ID', 'Customer', 'Item', 'Weight/Size', 'Qty', 'Price', 'Line Total'].join(',')];
  rows.forEach((r) => lines.push([r.date, r.orderId, r.customer, r.item, r.weight, r.qty, r.price, r.lineTotal].map(esc).join(',')));
  const totQty = rows.reduce((s, r) => s + r.qty, 0);
  const totAmt = rows.reduce((s, r) => s + r.lineTotal, 0);
  lines.push(['', '', '', '', 'TOTAL', totQty, '', totAmt].map(esc).join(','));
  downloadText(`4astore-sales-${dateKey ? dateKey.replace(/\//g, '-') : 'all'}.csv`, '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8;');
  showToast('CSV downloaded', 'success');
}

function DayItemsModal({ orders, dateKey, onClose }: { orders: AdminOrderFull[]; dateKey: string; onClose: () => void }) {
  const rows = collectDeliveredItems(orders, dateKey);
  const agg = new Map<string, { qty: number; total: number; price: number }>();
  rows.forEach((r) => {
    const a = agg.get(r.item) || { qty: 0, total: 0, price: r.price };
    a.qty += r.qty;
    a.total += r.lineTotal;
    agg.set(r.item, a);
  });
  const grandTotal = rows.reduce((s, r) => s + r.lineTotal, 0);
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);

  return (
    <AdminModal onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ color: 'var(--primary)', margin: 0 }}>📅 {dateKey}</h3>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--gray)' }}>×</button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 12 }}>Kya-kya bika us din (sirf delivered orders).</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead><tr><th>Item</th><th style={{ textAlign: 'center' }}>Qty</th><th style={{ textAlign: 'right' }}>Price</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
          <tbody>
            {[...agg.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, d]) => (
              <tr key={name}>
                <td>{name}</td>
                <td style={{ textAlign: 'center' }}>{d.qty}</td>
                <td style={{ textAlign: 'right' }}>₹{d.price}</td>
                <td style={{ textAlign: 'right' }}><strong>₹{d.total}</strong></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td><strong>Grand Total</strong></td>
              <td style={{ textAlign: 'center' }}><strong>{totalQty}</strong></td>
              <td />
              <td style={{ textAlign: 'right' }}><strong style={{ color: 'var(--primary-dark)' }}>₹{grandTotal}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" onClick={() => downloadItemsCSV(orders, dateKey)} style={{ flex: 1, padding: 10, background: '#2e7d32', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>📥 Download CSV</button>
        <button type="button" onClick={onClose} style={{ padding: '10px 20px', background: 'var(--gray)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Close</button>
      </div>
    </AdminModal>
  );
}

// Port of the original renderEarningsTab(): earnings = DELIVERED orders only.
export default function AdminEarnings() {
  const { data: all = [], isLoading } = useAdminOrders();
  const [viewDay, setViewDay] = useState<string | null>(null);

  const orders = useMemo(() => all.filter((o) => o.order_status === 'Delivered'), [all]);
  const { daily, monthly, total } = useMemo(() => {
    const d = new Map<string, { count: number; total: number }>();
    const m = new Map<string, { count: number; total: number }>();
    for (const o of orders) {
      const dk = dayKey(o.order_date);
      const mk = new Date(o.order_date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const a = d.get(dk) || { count: 0, total: 0 };
      a.count++; a.total += o.total_amount; d.set(dk, a);
      const b = m.get(mk) || { count: 0, total: 0 };
      b.count++; b.total += o.total_amount; m.set(mk, b);
    }
    return { daily: [...d.entries()].slice(0, 30), monthly: [...m.entries()], total: orders.reduce((s, o) => s + o.total_amount, 0) };
  }, [orders]);

  if (isLoading) return <p style={{ textAlign: 'center', padding: 30, color: 'var(--gray)' }}>Loading earnings...</p>;

  const openDay = (date: string) => {
    if (!collectDeliveredItems(orders, date).length) return showToast('Is din koi delivered item nahi', 'info');
    setViewDay(date);
  };

  return (
    <>
      <div style={{ marginBottom: 20, padding: 16, background: 'var(--primary-light)', borderRadius: 12, textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: 'var(--gray)' }}>Total All-Time Earning</p>
        <p style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--primary-dark)' }}>₹{total}</p>
      </div>

      <h4 style={{ marginBottom: 12 }}>📅 Monthly Earnings</h4>
      <div style={{ overflowX: 'auto', marginBottom: 24 }}>
        <table className="admin-table">
          <thead><tr><th>Month</th><th>Orders</th><th>Earning</th></tr></thead>
          <tbody>
            {monthly.map(([month, d]) => (
              <tr key={month}><td>{month}</td><td>{d.count}</td><td><strong>₹{d.total}</strong></td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>📊 Daily Breakdown</h4>
        <button type="button" onClick={() => downloadItemsCSV(orders)} title="Download every delivered item as CSV (Excel)"
          style={{ padding: '8px 16px', background: '#2e7d32', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>📥 Download CSV (all items)</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead><tr><th>Date</th><th>Orders</th><th>Earning</th><th>Action</th></tr></thead>
          <tbody>
            {daily.map(([date, d]) => (
              <tr key={date}>
                <td>{date}</td>
                <td>{d.count}</td>
                <td><strong>₹{d.total}</strong></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => openDay(date)} title="Us din kya-kya bika dekho" style={{ padding: '5px 10px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, marginRight: 4 }}>👁️ View</button>
                  <button type="button" onClick={() => downloadItemsCSV(orders, date)} title="Is din ka CSV download" style={{ padding: '5px 10px', background: '#2e7d32', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>📥 CSV</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewDay && <DayItemsModal orders={orders} dateKey={viewDay} onClose={() => setViewDay(null)} />}
    </>
  );
}
