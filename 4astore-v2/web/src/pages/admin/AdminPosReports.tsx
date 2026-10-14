import { useState } from 'react';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';
import { exportReportXlsx, usePosReport, type ReportPeriod } from '../../lib/pos';
import { formatDate } from './adminData';

const money = (n: number) => `₹${Number(n).toFixed(2)}`;
const qtyFmt = (n: number) => String(Math.round(Number(n) * 1000) / 1000);

const PERIODS: Array<{ key: ReportPeriod; label: string }> = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

/**
 * Sales Reports (design §7 / §9.3) — totals, discounts/refunds, payment-method
 * summary, best-sellers (pos_bill_items join) and low/out-of-stock lists, with
 * Excel export. Fed by GET /api/admin/pos/reports (requireStaff('pos_reports')).
 * The tab is gated by canAdmin('pos_reports'); the server is the real boundary.
 */
export default function AdminPosReports() {
  const [period, setPeriod] = useState<ReportPeriod>('day');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);

  const useRange = Boolean(from && to);
  const filters = useRange ? { from, to } : { period };
  const { data, isLoading, isError, error } = usePosReport(filters);

  async function doExport() {
    setExporting(true);
    try {
      await exportReportXlsx(filters);
    } catch (e) {
      showToast(apiError(e), 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div style={styles.controls}>
        <div style={styles.tabs}>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => { setPeriod(p.key); setFrom(''); setTo(''); }}
              style={{ ...styles.tab, ...(!useRange && period === p.key ? styles.tabActive : {}) }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div style={styles.rangeRow}>
          <label style={styles.rangeLabel}>From</label>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={styles.dateInput} />
          <label style={styles.rangeLabel}>To</label>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={styles.dateInput} />
          {useRange && (
            <button type="button" onClick={() => { setFrom(''); setTo(''); }} style={styles.clearBtn}>Clear</button>
          )}
        </div>
        <button type="button" onClick={doExport} disabled={exporting || isLoading} style={styles.exportBtn}>
          {exporting ? 'Exporting…' : '⬇️ Export Excel'}
        </button>
      </div>

      {isLoading ? (
        <p style={styles.muted}>Loading report…</p>
      ) : isError ? (
        <p style={{ ...styles.muted, color: '#c62828' }}>{apiError(error)}</p>
      ) : !data ? (
        <p style={styles.muted}>No report data.</p>
      ) : (
        <>
          <div style={styles.statsGrid}>
            <Stat icon="💰" value={money(data.totals.sales)} label="Total Sales" accent="#059669" />
            <Stat icon="🧾" value={data.totals.bills} label="Bills" accent="#3b82f6" />
            <Stat icon="🏷️" value={money(data.totals.discounts)} label="Discounts" accent="#f59e0b" />
            <Stat icon="↩️" value={money(data.totals.refunds)} label={`Refunds (${data.totals.refundBills})`} accent="#c62828" />
          </div>

          <div style={styles.panels}>
            <Panel title="💳 Payment Methods">
              {data.paymentSummary.length ? (
                <table className="admin-table">
                  <thead><tr><th>Method</th><th>Bills</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                  <tbody>
                    {data.paymentSummary.map((p) => (
                      <tr key={p.method}>
                        <td style={{ textTransform: 'capitalize' }}>{p.method}</td>
                        <td>{p.bills}</td>
                        <td style={{ textAlign: 'right' }}>{money(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p style={styles.muted}>No sales in this period.</p>}
            </Panel>

            <Panel title="🔥 Best Sellers">
              {data.bestSellers.length ? (
                <table className="admin-table">
                  <thead><tr><th>Product</th><th>Qty</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                  <tbody>
                    {data.bestSellers.map((b, i) => (
                      <tr key={`${b.product_id ?? 'm'}-${i}`}>
                        <td>{b.name}</td>
                        <td>{qtyFmt(b.quantity)}</td>
                        <td style={{ textAlign: 'right' }}>{money(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p style={styles.muted}>No sales in this period.</p>}
            </Panel>
          </div>

          <div style={styles.panels}>
            <Panel title={`⚠️ Low Stock (${data.lowStock.length})`}>
              {data.lowStock.length ? (
                <table className="admin-table">
                  <thead><tr><th>Product</th><th style={{ textAlign: 'right' }}>Stock</th><th style={{ textAlign: 'right' }}>Threshold</th></tr></thead>
                  <tbody>
                    {data.lowStock.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td style={{ textAlign: 'right' }}>{qtyFmt(p.stock)} {p.unit}</td>
                        <td style={{ textAlign: 'right' }}>{p.low_stock_threshold != null ? qtyFmt(p.low_stock_threshold) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p style={styles.muted}>No low-stock products. ✅</p>}
            </Panel>

            <Panel title={`⛔ Out of Stock (${data.outOfStock.length})`}>
              {data.outOfStock.length ? (
                <table className="admin-table">
                  <thead><tr><th>Product</th><th style={{ textAlign: 'right' }}>Stock</th></tr></thead>
                  <tbody>
                    {data.outOfStock.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td style={{ textAlign: 'right' }}>{qtyFmt(p.stock)} {p.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p style={styles.muted}>All products in stock. ✅</p>}
            </Panel>
          </div>

          <p style={styles.rangeNote}>Range: {formatDate(data.range.from)} → {formatDate(data.range.to)} (exclusive)</p>
        </>
      )}
    </div>
  );
}

function Stat({ icon, value, label, accent }: { icon: string; value: React.ReactNode; label: string; accent?: string }) {
  return (
    <div className="stat-card" style={{ borderLeftColor: accent || 'var(--primary)' }}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.panel}>
      <h4 style={styles.panelTitle}>{title}</h4>
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  controls: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 18 },
  tabs: { display: 'flex', gap: 6 },
  tab: { padding: '7px 14px', border: '1px solid var(--border)', background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#444' },
  tabActive: { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' },
  rangeRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rangeLabel: { fontSize: 12, color: 'var(--gray)' },
  dateInput: { padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 },
  clearBtn: { padding: '6px 10px', border: '1px solid var(--border)', background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 12 },
  exportBtn: { marginLeft: 'auto', padding: '8px 16px', background: '#087a3d', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14, marginBottom: 20 },
  panels: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16, marginBottom: 16 },
  panel: { background: '#fff', border: '1px solid var(--border)', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  panelTitle: { margin: '0 0 14px', color: 'var(--primary-dark)', fontSize: 15 },
  muted: { fontSize: 13, color: 'var(--gray)', padding: 8 },
  rangeNote: { fontSize: 12, color: 'var(--gray)', marginTop: 8 },
};
