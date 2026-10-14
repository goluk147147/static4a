import { useState } from 'react';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';
import { showConfirm } from '../../store/confirm';
import { formatDate } from './adminData';
import { useAuth } from '../../store/auth';
import { usePosPhones, useRemovePhone, useUpsertPhone } from '../../lib/pos';

// POS/inventory permission keys a staff number may carry (keep in sync with
// ALLOWED_PERMS in routes/admin-pos.ts).
const PERMISSIONS: [string, string][] = [
  ['pos', 'Billing / POS'],
  ['inventory', 'Inventory & Excel'],
  ['pos_reports', 'Sales Reports'],
  ['orders', 'Online Orders'],
  ['products', 'Products'],
  ['dashboard', 'Dashboard'],
];

/**
 * POS Access (design §1, owner-only) — manage the mobile-number allowlist that
 * governs who can obtain a staff JWT via POS phone-OTP login. Removing a number
 * revokes it server-side (demotes the user + revokes refresh tokens), so this is
 * the real access control, not a frontend hide.
 */
export default function AdminPosAccess() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner' || user?.role === 'superadmin';

  const { data: phones = [], isLoading } = usePosPhones();
  const upsert = useUpsertPhone();
  const remove = useRemovePhone();

  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'owner' | 'staff'>('staff');
  const [perms, setPerms] = useState<Set<string>>(new Set(['pos']));

  if (!isOwner) {
    return <p style={{ textAlign: 'center', padding: 40, color: '#c62828' }}>Only the store owner can manage POS access.</p>;
  }

  function togglePerm(p: string) {
    setPerms((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }

  async function add() {
    if (!/^[6-9]\d{9}$/.test(mobile)) return showToast('Enter a valid 10-digit mobile number.', 'error');
    if (role === 'staff' && perms.size === 0) return showToast('Select at least one permission for staff.', 'error');
    try {
      const r = await upsert.mutateAsync({
        mobile,
        role,
        permissions: role === 'staff' ? [...perms] : undefined,
        name: name.trim() || undefined,
      });
      showToast(r.message, 'success');
      setMobile('');
      setName('');
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  async function revoke(m: string) {
    const okConfirm = await showConfirm(`Revoke access for ${m}? They will be signed out and demoted to customer.`, {
      title: 'Revoke access?',
      confirmText: 'Revoke',
    });
    if (!okConfirm) return;
    try {
      const r = await remove.mutateAsync(m);
      showToast(r.message, 'success');
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  return (
    <div>
      <div style={styles.card}>
        <h3 style={{ margin: '0 0 10px' }}>➕ Authorise a mobile number</h3>
        <div style={styles.fieldRow}>
          <label style={styles.label}>Mobile number
            <input value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} maxLength={10} inputMode="numeric" style={styles.input} />
          </label>
          <label style={styles.label}>Name (optional)
            <input value={name} onChange={(e) => setName(e.target.value)} style={styles.input} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
          {(['staff', 'owner'] as const).map((r) => (
            <button key={r} type="button" onClick={() => setRole(r)} style={{ ...styles.roleBtn, ...(role === r ? styles.roleBtnActive : {}) }}>
              {r === 'owner' ? '👑 Owner' : '👤 Staff'}
            </button>
          ))}
        </div>

        {role === 'staff' && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ ...styles.label, marginBottom: 6 }}>Permissions</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PERMISSIONS.map(([key, label]) => {
                const on = perms.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => togglePerm(key)}
                    style={{ ...styles.permChip, ...(on ? styles.permChipActive : {}) }}
                    aria-pressed={on}
                  >
                    {on ? '✓ ' : ''}{label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {role === 'owner' && (
          <p style={{ fontSize: 12, color: 'var(--gray)', margin: '0 0 10px' }}>Owner numbers get full access to every section.</p>
        )}

        <button type="button" onClick={add} disabled={upsert.isPending} style={styles.saveBtn}>
          {upsert.isPending ? '⏳ Saving…' : 'Authorise number'}
        </button>
      </div>

      <div style={{ ...styles.card, marginTop: 16 }}>
        <h3 style={{ margin: '0 0 10px' }}>🔐 Authorised numbers</h3>
        {isLoading ? (
          <p style={styles.hint}>Loading…</p>
        ) : phones.length === 0 ? (
          <p style={styles.hint}>No numbers authorised yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Mobile</th>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Role</th>
                <th style={styles.th}>Permissions</th>
                <th style={styles.th}>Added</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {phones.map((p) => (
                <tr key={p.id} style={!p.active ? { opacity: 0.5 } : undefined}>
                  <td style={styles.td}>{p.mobile}</td>
                  <td style={styles.td}>{p.name || '—'}</td>
                  <td style={styles.td}>{p.role}</td>
                  <td style={styles.td}>{p.role === 'owner' ? 'All' : p.permissions.join(', ') || '—'}</td>
                  <td style={styles.td}>{formatDate(p.created_at)}</td>
                  <td style={styles.td}>
                    {p.active && (
                      <button type="button" onClick={() => revoke(p.mobile)} style={styles.revokeBtn}>Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 14, boxShadow: 'var(--shadow)' },
  fieldRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  label: { flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--gray)', fontWeight: 600 },
  input: { padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14 },
  roleBtn: { flex: 1, padding: '10px', border: '1px solid var(--border)', borderRadius: 8, background: 'white', cursor: 'pointer', fontWeight: 600 },
  roleBtnActive: { background: 'var(--primary-light)', borderColor: 'var(--primary)', color: 'var(--primary-dark)' },
  permChip: { padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 20, background: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  permChipActive: { background: 'var(--primary)', borderColor: 'var(--primary)', color: 'white' },
  saveBtn: { padding: '10px 18px', border: 0, borderRadius: 8, background: 'var(--primary)', color: 'white', fontWeight: 700, cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', borderBottom: '2px solid var(--border)', padding: '7px 6px', color: 'var(--gray)', fontSize: 12 },
  td: { borderBottom: '1px solid #f0f0f0', padding: '7px 6px' },
  revokeBtn: { padding: '6px 12px', border: '1px solid #c62828', borderRadius: 6, background: 'white', color: '#c62828', fontWeight: 600, cursor: 'pointer', fontSize: 12 },
  hint: { padding: 20, textAlign: 'center', color: 'var(--gray)', margin: 0 },
};
