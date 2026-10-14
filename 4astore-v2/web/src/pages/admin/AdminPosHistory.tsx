import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';
import { formatDate } from './adminData';
import { PosBill, useCancelBill, usePosBill, usePosBills, useRefundBill } from '../../lib/pos';

const money = (n: number) => `₹${Number(n).toFixed(2)}`;

const STATUS_COLOR: Record<string, string> = {
  completed: '#087a3d',
  held: '#b96500',
  cancelled: '#c62828',
  refunded: '#6d28d9',
};

/**
 * Billing history (design §7) — searchable list of bills with a detail view.
 * The five share actions (WhatsApp / PDF / Print / Native share / Copy) are
 * wired onto the detail view by FEAT-005; this screen renders the bill and the
 * controlled cancel / refund actions that reverse stock server-side.
 */
export default function AdminPosHistory() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [billNoFilter, setBillNoFilter] = useState('');
  const [mobile, setMobile] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const filters = {
    ...(status ? { status } : {}),
    ...(billNoFilter.trim() ? { billNo: billNoFilter.trim() } : {}),
    ...(mobile.trim() ? { mobile: mobile.trim() } : {}),
  };
  const { data, isLoading } = usePosBills(filters, 30);
  const bills = data?.bills ?? [];

  if (selected) {
    return <BillDetail billNo={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div>
      <div style={styles.filters}>
        <input
          value={billNoFilter}
          onChange={(e) => setBillNoFilter(e.target.value)}
          placeholder="🔎 Bill no (e.g. INV-000001)"
          style={styles.input}
          aria-label="Search by bill number"
        />
        <input
          value={mobile}
          onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
          placeholder="Customer mobile"
          maxLength={10}
          inputMode="numeric"
          style={styles.input}
          aria-label="Filter by customer mobile"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={styles.input} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="held">Held</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
        </select>
      </div>

      {isLoading ? (
        <p style={styles.hint}>Loading bills…</p>
      ) : bills.length === 0 ? (
        <p style={styles.hint}>No bills found.</p>
      ) : (
        <div style={styles.list}>
          {bills.map((b) => (
            <button
              key={b.id}
              type="button"
              style={styles.row}
              onClick={() => (b.status === 'held' ? navigate(`/admin/pos?reopen=${b.id}`) : setSelected(b.bill_no!))}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{b.bill_no || `Held #${b.id}`}</strong>
                <span style={{ ...styles.chip, background: `${STATUS_COLOR[b.status] || '#999'}22`, color: STATUS_COLOR[b.status] || '#555' }}>
                  {b.status}
                </span>
                <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>
                  {b.customer_name || 'Walk-in'}{b.customer_mobile ? ` · ${b.customer_mobile}` : ''} · {formatDate(b.created_at)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800 }}>{money(b.grand_total)}</div>
                <small style={{ color: 'var(--gray)' }}>{b.items.length} item{b.items.length === 1 ? '' : 's'}</small>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BillDetail({ billNo, onBack }: { billNo: string; onBack: () => void }) {
  const { data: bill, isLoading } = usePosBill(billNo);
  const cancel = useCancelBill();
  const refund = useRefundBill();

  async function doReverse(kind: 'cancel' | 'refund') {
    const reason = window.prompt(`Reason for ${kind} (optional):`) ?? undefined;
    try {
      if (kind === 'cancel') await cancel.mutateAsync({ billNo, reason });
      else await refund.mutateAsync({ billNo, reason });
      showToast(`Bill ${kind === 'cancel' ? 'cancelled' : 'refunded'} — stock restored`, 'success');
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  return (
    <div>
      <button type="button" onClick={onBack} style={styles.linkBtn}>← Back to history</button>
      {isLoading || !bill ? (
        <p style={styles.hint}>Loading bill…</p>
      ) : (
        <BillCard bill={bill} onReverse={doReverse} reversing={cancel.isPending || refund.isPending} />
      )}
    </div>
  );
}

/**
 * Renders a single bill. The share-action toolbar (WhatsApp / Download PDF /
 * Print / Share / Copy) is injected by FEAT-005 via the optional `actions`
 * slot so this component stays the single source of truth for the bill layout.
 */
export function BillCard({
  bill,
  onReverse,
  reversing,
  actions,
}: {
  bill: PosBill;
  onReverse?: (kind: 'cancel' | 'refund') => void;
  reversing?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div style={{ ...styles.row, flexDirection: 'column', alignItems: 'stretch', cursor: 'default', marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: 0 }}>{bill.bill_no || `Held #${bill.id}`}</h3>
          <div style={{ fontSize: 12, color: 'var(--gray)' }}>{formatDate(bill.created_at)} · by {bill.created_by || '—'}</div>
        </div>
        <span style={{ ...styles.chip, background: `${STATUS_COLOR[bill.status] || '#999'}22`, color: STATUS_COLOR[bill.status] || '#555' }}>
          {bill.status}
        </span>
      </div>

      {(bill.customer_name || bill.customer_mobile) && (
        <div style={{ fontSize: 13, marginTop: 8 }}>
          👤 {bill.customer_name || 'Walk-in'}{bill.customer_mobile ? ` · ${bill.customer_mobile}` : ''}
        </div>
      )}

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Item</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Qty</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Rate</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {bill.items.map((it) => (
            <tr key={it.id ?? `${it.name}-${it.rate}`}>
              <td style={styles.td}>{it.name}{it.is_manual ? ' ✎' : ''}</td>
              <td style={{ ...styles.td, textAlign: 'right' }}>{it.quantity} {it.unit}</td>
              <td style={{ ...styles.td, textAlign: 'right' }}>{money(it.rate)}</td>
              <td style={{ ...styles.td, textAlign: 'right' }}>{money(it.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginLeft: 'auto', width: 240, marginTop: 10 }}>
        <div style={styles.totalRow}><span>Subtotal</span><span>{money(bill.subtotal)}</span></div>
        {bill.discount > 0 && <div style={styles.totalRow}><span>Discount</span><span>− {money(bill.discount)}</span></div>}
        {bill.tax_total > 0 && <div style={styles.totalRow}><span>Tax</span><span>{money(bill.tax_total)}</span></div>}
        <div style={{ ...styles.totalRow, fontWeight: 800, color: 'var(--primary-dark)' }}><span>Grand Total</span><span>{money(bill.grand_total)}</span></div>
        <div style={{ ...styles.totalRow, fontSize: 12, color: 'var(--gray)' }}>
          <span>{(bill.payment_method || 'cash').toUpperCase()} · {bill.payment_status}</span>
          <span>Paid {money(bill.amount_paid)}</span>
        </div>
      </div>

      {actions && <div style={{ marginTop: 12 }}>{actions}</div>}

      {onReverse && bill.status === 'completed' && (
        <div style={{ display: 'flex', gap: 10, marginTop: 14, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
          <button type="button" disabled={reversing} onClick={() => onReverse('cancel')} style={styles.cancelBtn}>Cancel bill</button>
          <button type="button" disabled={reversing} onClick={() => onReverse('refund')} style={styles.refundBtn}>Refund</button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  filters: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 },
  input: { flex: '1 1 180px', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14 },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: { display: 'flex', gap: 12, alignItems: 'center', width: '100%', textAlign: 'left', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'white', cursor: 'pointer', font: 'inherit', boxShadow: 'var(--shadow)' },
  chip: { marginLeft: 8, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'capitalize' },
  hint: { padding: 24, textAlign: 'center', color: 'var(--gray)' },
  linkBtn: { border: 0, background: 'none', color: 'var(--primary-dark)', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0 },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 12, fontSize: 13 },
  th: { textAlign: 'left', borderBottom: '2px solid var(--border)', padding: '6px 4px', color: 'var(--gray)', fontSize: 12 },
  td: { borderBottom: '1px solid #f0f0f0', padding: '6px 4px' },
  totalRow: { display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 14 },
  cancelBtn: { padding: '9px 14px', border: '1px solid #c62828', borderRadius: 8, background: 'white', color: '#c62828', fontWeight: 700, cursor: 'pointer' },
  refundBtn: { padding: '9px 14px', border: '1px solid #6d28d9', borderRadius: 8, background: 'white', color: '#6d28d9', fontWeight: 700, cursor: 'pointer' },
};
