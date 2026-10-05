import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usersAction, adminCreateOrder } from '../../lib/admin';
import { apiError } from '../../lib/api';
import { useProducts } from '../../lib/queries';
import { showToast } from '../../store/toast';
import { showConfirm } from '../../store/confirm';
import { useAdminOrders, useAdminUsers, formatDate, ADMIN_ORDERS_KEY, AdminUserRow } from './adminData';
import AdminModal from './AdminModal';
import PasswordInput from '../../components/PasswordInput';

const STAFF = ['owner', 'superadmin', 'admin'];
const MOBILE_RE = /^[6-9]\d{9}$/;
const DAY = 1000 * 60 * 60 * 24;

const btn = (bg: string): React.CSSProperties => ({ padding: '5px 8px', background: bg, color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 });
const riderInput: React.CSSProperties = { padding: 9, border: '1px solid var(--border)', borderRadius: 7, minWidth: 0 };
const orderInput: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 9, border: '1px solid var(--border)', borderRadius: 8, marginTop: 4 };

type Modal =
  | { kind: 'edit'; user: AdminUserRow }
  | { kind: 'order'; name: string; mobile: string }
  | null;

/** Per-user delivery fee cell (original deliv_<mobile> input + ✔ / ↺ buttons). */
function DeliveryCell({ user, onSave }: { user: AdminUserRow; onSave: (mobile: string, value: number | null) => void }) {
  const current = user.custom_delivery ?? '';
  const [val, setVal] = useState(String(current));
  useEffect(() => setVal(String(user.custom_delivery ?? '')), [user.custom_delivery]);
  return (
    <td style={{ whiteSpace: 'nowrap' }}>
      <input type="number" min={0} placeholder="Global" value={val} onChange={(e) => setVal(e.target.value)} aria-label={`Delivery fee for ${user.name}`}
        style={{ width: 60, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11 }} />{' '}
      <button type="button" title="Set delivery fee" onClick={() => {
        const v = val.trim();
        if (v === '' || Number.isNaN(Number(v))) return showToast('Enter a valid amount (0 for free)', 'error');
        onSave(user.mobile, Number(v));
      }} style={{ ...btn('var(--primary)'), padding: '4px 8px', borderRadius: 5 }}>✔</button>{' '}
      <button type="button" title="Use global fee" onClick={() => onSave(user.mobile, null)} style={{ ...btn('#888'), padding: '4px 8px', borderRadius: 5 }}>↺</button>
    </td>
  );
}

function EditUserModal({ user, onClose, onSaved }: { user: AdminUserRow; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: user.name || '', mobile: user.mobile || '', username: user.username || '', role: user.role === 'rider' ? 'rider' : 'customer', password: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      await usersAction('updateUser', { id: user.id, name: f.name.trim(), mobile: f.mobile.trim(), username: f.username.trim().toLowerCase(), role: f.role, password: f.password });
      showToast('User updated', 'success');
      onSaved();
      onClose();
    } catch (e) {
      showToast(apiError(e) || 'User update failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminModal onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0, color: 'var(--primary)' }}>✏️ Edit User</h3>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 0, fontSize: 22, cursor: 'pointer' }}>×</button>
      </div>
      <div className="prod-form-grid">
        <label>Name<input value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label>Mobile<input inputMode="numeric" maxLength={10} value={f.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, ''))} /></label>
        <label>Username<input value={f.username} onChange={(e) => set('username', e.target.value)} /></label>
        <label>Role
          <select value={f.role} onChange={(e) => set('role', e.target.value)}>
            <option value="customer">Customer</option>
            <option value="rider">Delivery Boy</option>
          </select>
        </label>
        <label className="full">New password <small style={{ color: 'var(--gray)' }}>(leave blank to keep current)</small>
          <PasswordInput autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} />
        </label>
      </div>
      <button type="button" onClick={save} disabled={busy} style={{ width: '100%', marginTop: 16, padding: 11, background: 'var(--primary)', color: '#fff', border: 0, borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
        {busy ? 'Saving…' : 'Save User'}
      </button>
    </AdminModal>
  );
}

function AddOrderModal({ name, mobile, onClose, onSaved }: { name: string; mobile: string; onClose: () => void; onSaved: () => void }) {
  const products = (useProducts().data ?? []).filter((p) => p.in_stock !== false);
  const [cName, setCName] = useState(name);
  const [cMobile, setCMobile] = useState(mobile);
  const [pid, setPid] = useState<number | ''>('');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);

  const productId = pid === '' ? products[0]?.id : pid;
  const product = products.find((p) => p.id === productId);
  const quantity = Math.max(1, Number(qty) || 1);

  async function save() {
    if (!cName.trim() || !MOBILE_RE.test(cMobile.trim()) || !product) return showToast('Enter customer name, valid mobile and product', 'error');
    setBusy(true);
    try {
      const res = await adminCreateOrder({ name: cName.trim(), mobile: cMobile.trim() }, [{ id: product.id, quantity }]);
      showToast(`Order ${res.order.order_id} created`, 'success');
      onSaved();
      onClose();
    } catch (e) {
      showToast(apiError(e) || 'Order creation failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminModal onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0, color: 'var(--primary)' }}>➕ Add Order</h3>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 0, fontSize: 22, cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary-dark)' }}>Customer name
          <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Customer name" style={orderInput} />
        </label>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary-dark)' }}>Mobile number
          <input value={cMobile} onChange={(e) => setCMobile(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={10} placeholder="10-digit mobile" style={orderInput} />
        </label>
      </div>
      <label htmlFor="adminOrderProduct" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--primary-dark)', marginBottom: 5 }}>Product</label>
      <select id="adminOrderProduct" value={productId ?? ''} onChange={(e) => setPid(Number(e.target.value))} style={{ width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
        {products.map((p) => (
          <option key={p.id} value={p.id}>{p.name}{p.weight ? ` - ${p.weight}` : ''} (₹{Number(p.price) || 0})</option>
        ))}
      </select>
      <label htmlFor="adminOrderQty" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--primary-dark)', margin: '12px 0 5px' }}>Quantity</label>
      <input id="adminOrderQty" type="number" min={1} max={999} value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid var(--border)', borderRadius: 8 }} />
      <p style={{ textAlign: 'right', fontSize: 18, fontWeight: 800, color: 'var(--primary-dark)', margin: '14px 0' }}>Total: ₹{product ? (Number(product.price) || 0) * quantity : 0}</p>
      <button type="button" onClick={save} disabled={busy} style={{ width: '100%', padding: 11, background: '#2e7d32', color: '#fff', border: 0, borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
        {busy ? 'Creating…' : 'Create Order'}
      </button>
    </AdminModal>
  );
}

// Port of the original renderUsersTab() and its helpers.
export default function AdminUsers() {
  const qc = useQueryClient();
  const { data: allUsers = [], isLoading } = useAdminUsers();
  const { data: orders = [] } = useAdminOrders();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [riderOpen, setRiderOpen] = useState(false);
  const [rider, setRider] = useState({ name: '', mobile: '', username: '', password: '' });
  const [modal, setModal] = useState<Modal>(null);

  // Staff accounts live in the Team Access tab (original kept admins in a separate store).
  const users = useMemo(() => allUsers.filter((u) => !STAFF.includes(u.role)).sort((a, b) => Number(a.id) - Number(b.id)), [allUsers]);
  const refreshUsers = () => qc.invalidateQueries({ queryKey: ['admin-users'] });

  const stats = useMemo(() => {
    const m = new Map<string, { count: number; spent: number }>();
    for (const o of orders) {
      const k = o.customer?.mobile || '';
      const cur = m.get(k) || { count: 0, spent: 0 };
      cur.count += 1;
      cur.spent += o.total_amount;
      m.set(k, cur);
    }
    return m;
  }, [orders]);

  const q = search.trim().toLowerCase();
  const filtered = q ? users.filter((u) => [u.name, u.username, u.mobile].some((v) => String(v || '').toLowerCase().includes(q))) : users;
  const pageSize = q ? Math.max(filtered.length, 1) : 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, pageCount);
  const pageUsers = filtered.slice((curPage - 1) * pageSize, curPage * pageSize);
  const customers = users.filter((u) => u.role !== 'rider');

  function applySearch(v: string) {
    setSearch(v || '');
    setPage(1);
  }

  async function saveDelivery(mobile: string, value: number | null) {
    try {
      await usersAction('setDelivery', { mobile, customDelivery: value });
      showToast(value === null ? 'Delivery set to global' : `Delivery set to ₹${value}`, 'success');
      refreshUsers();
    } catch (e) {
      showToast(apiError(e) || 'Failed to update delivery', 'error');
    }
  }

  function fillRiderFromCustomer(id: string) {
    const c = users.find((u) => String(u.id) === id);
    if (!c) return;
    setRider((r) => ({ ...r, name: c.name || '', mobile: c.mobile || '', username: c.username || '' }));
  }

  async function createDeliveryBoy() {
    const name = rider.name.trim();
    const mobile = rider.mobile.trim();
    const username = rider.username.trim().toLowerCase();
    if (!name || !MOBILE_RE.test(mobile) || username.length < 3 || rider.password.length < 4) {
      return showToast('Enter name, valid mobile, username and 4+ character password.', 'error');
    }
    try {
      const res = await usersAction('createRider', { name, mobile, username, password: rider.password });
      showToast(res.message || 'Delivery boy account created.', 'success');
      setRider({ name: '', mobile: '', username: '', password: '' });
      refreshUsers();
    } catch (e) {
      showToast(apiError(e) || 'Delivery boy account was not created.', 'error');
    }
  }

  async function deleteUser(u: AdminUserRow) {
    const ok = await showConfirm(`Delete user "${u.name}" (${u.mobile})? This cannot be undone!`, { title: 'Delete user', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await usersAction('delete', { mobile: u.mobile });
      showToast(`User "${u.name}" deleted`, 'success');
      refreshUsers();
    } catch (e) {
      showToast(apiError(e) || 'Delete failed', 'error');
    }
  }

  const lastActive = (u: AdminUserRow) => u.last_login || u.registered_at || null;

  async function deleteInactiveUsers() {
    const now = Date.now();
    const inactive = users.filter((u) => {
      const t = lastActive(u);
      return !t || now - new Date(t).getTime() >= 30 * DAY;
    });
    if (!inactive.length) return showToast('No inactive users to delete', 'info');
    const ok = await showConfirm(`Delete ${inactive.length} users who haven't logged in for 30+ days? This cannot be undone!`, { title: 'Delete inactive users', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      const res = await usersAction('deleteInactive', { days: 30 });
      showToast(`${res.deleted} inactive users deleted`, 'success');
      refreshUsers();
    } catch (e) {
      showToast(apiError(e) || 'Delete failed', 'error');
    }
  }

  if (isLoading) return <p style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>Loading users...</p>;
  if (users.length === 0 && !riderOpen) {
    return (
      <>
        <p style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>No registered users</p>
        <div style={{ textAlign: 'center' }}>
          <button type="button" onClick={() => setRiderOpen(true)} style={{ padding: '8px 16px', background: '#0891b2', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>🛵 New Delivery Boy</button>
        </div>
      </>
    );
  }

  const now = Date.now();

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <p style={{ fontSize: 13, color: 'var(--gray)', margin: 0 }}>Showing: <strong>{filtered.length}</strong> of {users.length} users</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setModal({ kind: 'order', name: '', mobile: '' })} style={{ padding: '8px 16px', background: '#2e7d32', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>➕ New Customer Order</button>
          <button type="button" onClick={() => setRiderOpen((o) => !o)} style={{ padding: '8px 16px', background: '#0891b2', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>🛵 New Delivery Boy</button>
          <button type="button" onClick={deleteInactiveUsers} style={{ padding: '8px 16px', background: '#e53935', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>🗑️ Delete 30+ Days Inactive</button>
        </div>
      </div>

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input value={searchInput} aria-label="Search users"
          onChange={(e) => { setSearchInput(e.target.value); if (!e.target.value.trim()) applySearch(''); }}
          onKeyDown={(e) => e.key === 'Enter' && applySearch(searchInput)}
          placeholder="Search name, username or mobile"
          style={{ flex: 1, minWidth: 220, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }} />
        <button type="button" onClick={() => applySearch(searchInput)} style={{ padding: '10px 14px', border: 0, borderRadius: 8, background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Search</button>
      </div>

      {riderOpen && (
        <div style={{ marginBottom: 18, padding: 16, background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
            <h3 style={{ margin: 0, color: '#2e7d32', fontSize: 16 }}>Delivery Boy Account</h3>
            <button type="button" onClick={() => setRiderOpen(false)} title="Close form" style={{ padding: '5px 10px', border: '1px solid #a5d6a7', borderRadius: 7, background: '#fff', color: '#2e7d32', fontWeight: 700, cursor: 'pointer' }}>✕ Close</button>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: '#555' }}>Admin sets name, mobile, username and password. This login opens only the Rider page.</p>
          <select defaultValue="" onChange={(e) => fillRiderFromCustomer(e.target.value)} aria-label="Convert an existing customer"
            style={{ width: '100%', padding: 9, border: '1px solid var(--border)', borderRadius: 7, marginBottom: 10 }}>
            <option value="">Convert an existing customer (optional)</option>
            {customers.map((u) => <option key={u.id} value={u.id}>{u.name || 'Unnamed'} - {u.mobile || ''}</option>)}
          </select>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8, alignItems: 'end' }}>
            <input type="text" placeholder="Name" aria-label="Rider name" value={rider.name} onChange={(e) => setRider({ ...rider, name: e.target.value })} style={riderInput} />
            <input type="tel" inputMode="numeric" maxLength={10} placeholder="Mobile number" aria-label="Rider mobile" value={rider.mobile} onChange={(e) => setRider({ ...rider, mobile: e.target.value.replace(/\D/g, '') })} style={riderInput} />
            <input type="text" placeholder="Username" aria-label="Rider username" value={rider.username} onChange={(e) => setRider({ ...rider, username: e.target.value })} style={riderInput} />
            <input type="text" placeholder="Password" aria-label="Rider password" autoComplete="new-password" value={rider.password} onChange={(e) => setRider({ ...rider, password: e.target.value })} style={riderInput} />
            <button type="button" onClick={createDeliveryBoy} style={{ padding: '10px 14px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Create Rider</button>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th><th>Name</th><th>Username</th><th>Mobile</th><th>Role</th><th>Password</th><th>Registered</th>
              <th>Last Login</th><th>Inactive</th><th>Orders</th><th>Spent</th><th>Delivery ₹</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pageUsers.length ? pageUsers.map((u) => {
              const st = stats.get(u.mobile) || { count: 0, spent: 0 };
              const days = u.last_login ? Math.floor((now - new Date(u.last_login).getTime()) / DAY) : 999;
              return (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td><strong>{u.name}</strong></td>
                  <td>{u.username || '-'}</td>
                  <td><a href={`tel:${u.mobile}`}>{u.mobile}</a></td>
                  <td>{u.role === 'rider' ? 'Delivery Boy' : 'Customer'}</td>
                  {/* Passwords are hashed in v2, so they can only be reset, never shown. */}
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>Hidden - edit to reset</td>
                  <td>{u.registered_at ? formatDate(u.registered_at) : '-'}</td>
                  <td>{u.last_login ? formatDate(u.last_login) : 'Never'}</td>
                  <td style={days >= 30 ? { color: '#e53935', fontWeight: 700 } : { color: '#2e7d32' }}>{days >= 999 ? 'Never' : `${days} days`}</td>
                  <td>{st.count}</td>
                  <td><strong>₹{st.spent}</strong></td>
                  <DeliveryCell user={u} onSave={saveDelivery} />
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => setModal({ kind: 'edit', user: u })} title="Edit user" aria-label={`Edit ${u.name}`} style={btn('#0891b2')}>✏️</button>{' '}
                    <button type="button" onClick={() => setModal({ kind: 'order', name: u.name, mobile: u.mobile })} title="Add order" style={btn('#2e7d32')}>➕ Order</button>{' '}
                    <button type="button" onClick={() => deleteUser(u)} title="Delete user" aria-label={`Delete ${u.name}`} style={btn('#e53935')}>🗑️</button>
                  </td>
                </tr>
              );
            }) : (
              <tr><td colSpan={13} style={{ textAlign: 'center', padding: 24, color: 'var(--gray)' }}>No customer found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        <button type="button" onClick={() => setPage(curPage - 1)} disabled={curPage <= 1} style={{ padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 7, background: '#fff', cursor: 'pointer' }}>← Prev</button>
        <span style={{ fontSize: 12, color: 'var(--gray)' }}>Page {curPage} of {pageCount}</span>
        <button type="button" onClick={() => setPage(curPage + 1)} disabled={curPage >= pageCount} style={{ padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 7, background: '#fff', cursor: 'pointer' }}>Next →</button>
      </div>

      {modal?.kind === 'edit' && <EditUserModal user={modal.user} onClose={() => setModal(null)} onSaved={refreshUsers} />}
      {modal?.kind === 'order' && (
        <AddOrderModal name={modal.name} mobile={modal.mobile} onClose={() => setModal(null)} onSaved={() => qc.invalidateQueries({ queryKey: ADMIN_ORDERS_KEY })} />
      )}
    </>
  );
}
