import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../store/auth';
import { useProducts, useCategories } from '../../lib/queries';
import { fetchAdminStats } from '../../lib/admin';
import { usePosDashboard } from '../../lib/pos';
import { useAdminOrders, useAdminUsers, statusColor, canAdmin } from './adminData';

// Port of the original renderDashboardTab().
function StatCard({ icon, value, label, accent }: { icon: string; value: ReactNode; label: string; accent?: string }) {
  return (
    <div className="stat-card" style={{ borderLeftColor: accent || 'var(--primary)' }}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <h4 style={{ margin: '0 0 14px', color: 'var(--primary-dark)', fontSize: 15 }}>{title}</h4>
      {children}
    </div>
  );
}

function QuickLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ padding: '9px 14px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
    >
      {label}
    </button>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const { data: orders = [], isLoading } = useAdminOrders();
  const { data: users = [] } = useAdminUsers(canAdmin(user?.role, user?.permissions, 'users'));
  const prods = useProducts().data ?? [];
  const cats = useCategories().data ?? [];
  // SQL-aggregated summary (GET /api/admin/stats). On error we fall back to the
  // client-side computation from useAdminOrders() below, so the dashboard never
  // breaks if the stats endpoint is unavailable.
  const { data: stats } = useQuery({ queryKey: ['admin-stats'], queryFn: fetchAdminStats, staleTime: 30_000, retry: false });
  // POS summary strip (FEAT-006). Gated by the `dashboard` permission (the same
  // the server requires) and retry:false so the counter subsystem never breaks
  // the main dashboard if the endpoint is unavailable.
  const canPos = canAdmin(user?.role, user?.permissions, 'pos');
  const { data: pos } = usePosDashboard(canAdmin(user?.role, user?.permissions, 'dashboard'));

  if (isLoading) return <p style={{ textAlign: 'center', padding: 30, color: 'var(--gray)' }}>Loading dashboard...</p>;

  const now = new Date();
  const today = now.toDateString();
  const month = now.getMonth();
  const year = now.getFullYear();
  const isDelivered = (s: string) => s === 'Delivered';

  const delivered = orders.filter((o) => isDelivered(o.order_status));
  const cRevToday = delivered.filter((o) => new Date(o.order_date).toDateString() === today).reduce((s, o) => s + o.total_amount, 0);
  const cRevMonth = delivered
    .filter((o) => { const d = new Date(o.order_date); return d.getMonth() === month && d.getFullYear() === year; })
    .reduce((s, o) => s + o.total_amount, 0);
  const cRevAll = delivered.reduce((s, o) => s + o.total_amount, 0);
  const pendingValue = orders.filter((o) => !isDelivered(o.order_status) && o.order_status !== 'Cancelled').reduce((s, o) => s + o.total_amount, 0);

  const cStatusCounts: Record<string, number> = {};
  orders.forEach((o) => { const st = o.order_status || 'Order Placed'; cStatusCounts[st] = (cStatusCounts[st] || 0) + 1; });

  const qtyMap: Record<string, number> = {};
  orders.forEach((o) => o.items.forEach((it) => { const key = it.name || `#${it.id}`; qtyMap[key] = (qtyMap[key] || 0) + it.quantity; }));
  const cTopProducts = Object.entries(qtyMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const cOutOfStock = prods.filter((p) => !p.in_stock).length;

  // Prefer SQL-aggregated stats; fall back to the client-side numbers above.
  const revToday = stats ? stats.revenue.today : cRevToday;
  const revMonth = stats ? stats.revenue.month : cRevMonth;
  const revAll = stats ? stats.revenue.allTime : cRevAll;
  const deliveredCount = stats ? stats.deliveredOrders : delivered.length;
  const totalOrders = stats ? stats.totalOrders : orders.length;
  const avgOrder = deliveredCount ? Math.round(revAll / deliveredCount) : 0;
  const statusCounts = stats ? stats.statusCounts : cStatusCounts;
  const topProducts: [string, number][] = stats
    ? stats.topProducts.map((p) => [p.name || (p.productId != null ? `#${p.productId}` : '-'), p.quantity] as [string, number])
    : cTopProducts;
  const maxQty = topProducts.length ? topProducts[0][1] : 1;
  const outOfStock = stats ? stats.outOfStock : cOutOfStock;
  const inStock = Math.max(0, prods.length - outOfStock);
  const recent = orders.slice(0, 5);

  return (
    <>
      {pos && (
        <div style={{ marginBottom: 22 }}>
          <div className="stats-grid" style={{ marginBottom: 12 }}>
            <StatCard icon="🧾" value={`₹${pos.today.sales}`} label="Today's POS Sales" accent="#087a3d" />
            <StatCard icon="📄" value={pos.today.bills} label="POS Bills Today" accent="#3b82f6" />
            <StatCard icon="⚠️" value={pos.lowStock} label="Low Stock" accent="#f59e0b" />
            <StatCard icon="⛔" value={pos.outOfStock} label="Out of Stock" accent="#c62828" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
            <Panel title="🕒 Recent POS Bills">
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table">
                  <thead><tr><th>Bill</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
                  <tbody>
                    {pos.recentBills.length ? (
                      pos.recentBills.map((b, i) => (
                        <tr key={b.bill_no || `pos-${i}`}>
                          <td><strong>{b.bill_no || '-'}</strong></td>
                          <td>{b.customer_name || '-'}</td>
                          <td>₹{b.grand_total}</td>
                          <td style={{ textTransform: 'capitalize' }}>{b.status || '-'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={4} style={{ textAlign: 'center', padding: 16, color: 'var(--gray)' }}>No POS bills yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="⚡ Quick Actions">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {canPos && <QuickLink label="🧾 New Bill" onClick={() => navigate('/admin/pos')} />}
                {canPos && <QuickLink label="📒 Billing History" onClick={() => navigate('/admin/pos-history')} />}
                {canAdmin(user?.role, user?.permissions, 'inventory') && <QuickLink label="📦 Inventory" onClick={() => navigate('/admin/inventory')} />}
                {canAdmin(user?.role, user?.permissions, 'inventory') && <QuickLink label="⬆️ Excel Import" onClick={() => navigate('/admin/pos-import')} />}
                {canAdmin(user?.role, user?.permissions, 'pos_reports') && <QuickLink label="📈 Sales Reports" onClick={() => navigate('/admin/pos-reports')} />}
              </div>
            </Panel>
          </div>
        </div>
      )}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard icon="💵" value={`₹${revToday}`} label="Today's Revenue" accent="#059669" />
        <StatCard icon="📅" value={`₹${revMonth}`} label="This Month" accent="#3b82f6" />
        <StatCard icon="🏆" value={`₹${revAll}`} label="All-time (Delivered)" accent="#8b5cf6" />
        <StatCard icon="⏳" value={`₹${pendingValue}`} label="Pending Pipeline" accent="#f59e0b" />
        <StatCard icon="🧾" value={`₹${avgOrder}`} label="Avg Order Value" accent="#0ea5e9" />
      </div>

      <div className="stats-grid" style={{ marginBottom: 22 }}>
        <StatCard icon="📦" value={totalOrders} label="Total Orders" />
        <StatCard icon="✅" value={deliveredCount} label="Delivered" accent="#059669" />
        <StatCard icon="👥" value={users.length} label="Registered Users" accent="#6a1b9a" />
        <StatCard icon="🛍️" value={prods.length} label="Products" accent="#ef6c00" />
        <StatCard icon="🗂️" value={cats.length} label="Categories" accent="#0891b2" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16, marginBottom: 16 }}>
        <Panel title="📊 Order Status Breakdown">
          {Object.keys(statusCounts).length ? (
            Object.entries(statusCounts).map(([st, c]) => (
              <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: statusColor(st), flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, color: '#333' }}>{st}</span>
                <strong style={{ fontSize: 13, color: 'var(--primary-dark)' }}>{c}</strong>
              </div>
            ))
          ) : (
            <p style={{ fontSize: 13, color: 'var(--gray)' }}>No orders yet</p>
          )}
        </Panel>

        <Panel title="🔥 Top Selling Products">
          {topProducts.length ? (
            topProducts.map(([name, q]) => (
              <div key={name} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: '#333' }}>{name}</span><strong style={{ color: 'var(--primary-dark)' }}>{q} sold</strong>
                </div>
                <div style={{ height: 7, background: '#eee', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round((q / maxQty) * 100)}%`, background: 'var(--primary)' }} />
                </div>
              </div>
            ))
          ) : (
            <p style={{ fontSize: 13, color: 'var(--gray)' }}>No sales data yet</p>
          )}
        </Panel>

        <Panel title="📦 Stock Health">
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1, textAlign: 'center', background: '#e8f5e9', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#2e7d32' }}>{inStock}</div>
              <div style={{ fontSize: 12, color: '#2e7d32' }}>In Stock</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center', background: '#ffebee', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#c62828' }}>{outOfStock}</div>
              <div style={{ fontSize: 12, color: '#c62828' }}>Out of Stock</div>
            </div>
          </div>
          {outOfStock ? (
            <p style={{ fontSize: 12, color: '#c62828', marginTop: 12 }}>⚠️ {outOfStock} product(s) out of stock. Restock soon.</p>
          ) : (
            <p style={{ fontSize: 12, color: '#2e7d32', marginTop: 12 }}>✅ All products in stock.</p>
          )}
        </Panel>
      </div>

      <Panel title="🕒 Recent Orders">
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table">
            <thead><tr><th>Order ID</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              {recent.length ? (
                recent.map((o) => (
                  <tr key={o.order_id}>
                    <td><strong>{o.order_id}</strong></td>
                    <td>{o.customer?.name || '-'}</td>
                    <td>₹{o.total_amount}</td>
                    <td><span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 12, color: '#fff', background: statusColor(o.order_status) }}>{o.order_status}</span></td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: 'var(--gray)' }}>No orders yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={() => navigate('/admin/orders')} style={{ padding: '8px 16px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>View all orders →</button>
        </div>
      </Panel>
    </>
  );
}
