/**
 * Sales Reports (design §7) — the dashboards (daily/weekly/monthly sales,
 * payment-method summaries, best-sellers, low-stock) are populated by FEAT-006.
 * This placeholder keeps the tab and route in place so the nav is complete and
 * gated by canAdmin('pos_reports') like every other POS tab.
 */
export default function AdminPosReports() {
  return (
    <div className="admin-pending">
      <div style={{ fontSize: 32, marginBottom: 8 }}>📈</div>
      <h3 style={{ margin: '0 0 6px' }}>Sales Reports — coming soon</h3>
      <p style={{ margin: 0, fontSize: 13 }}>
        Daily, weekly and monthly sales, payment-method summaries, best-selling and low-stock reports load here.
      </p>
    </div>
  );
}
