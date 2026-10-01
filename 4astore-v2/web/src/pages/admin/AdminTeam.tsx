import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchTeam, teamAction, assignRole, PERMISSION_OPTIONS, AdminUser } from '../../lib/admin';
import { apiError } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { showToast } from '../../store/toast';
import { showConfirm } from '../../store/confirm';
import AdminModal from './AdminModal';

const fieldStyle: React.CSSProperties = { padding: 9, border: '1px solid var(--border)', borderRadius: 7, minWidth: 0 };

function PermChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <>
      {PERMISSION_OPTIONS.map(([key, label]) => (
        <label key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, margin: '4px 10px 4px 0' }}>
          <input type="checkbox" checked={value.includes(key)} onChange={() => toggle(key)} /> {label}
        </label>
      ))}
    </>
  );
}

function EditAdminModal({ admin, onClose, onSaved }: { admin: AdminUser; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(admin.name || '');
  const [password, setPassword] = useState('');
  const [perms, setPerms] = useState<string[]>(admin.permissions || []);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await teamAction('update', { id: admin.id, name: name.trim(), password, permissions: perms });
      showToast('Permissions updated', 'success');
      onSaved();
      onClose();
    } catch (e) {
      showToast(apiError(e) || 'Permission update failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 9, border: '1px solid var(--border)', borderRadius: 7 };
  return (
    <AdminModal onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0, color: 'var(--primary)' }}>✏️ Edit Admin Permissions</h3>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 0, fontSize: 22, cursor: 'pointer' }}>×</button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--gray)' }}>Username: <strong>{admin.username}</strong> · Mobile: <strong>{admin.mobile}</strong></p>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, margin: '10px 0 5px' }}>Name
        <input value={name} onChange={(e) => setName(e.target.value)} style={input} />
      </label>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, margin: '10px 0 5px' }}>New password <small style={{ color: 'var(--gray)' }}>(optional)</small>
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} style={input} />
      </label>
      <div style={{ margin: '12px 0' }}><PermChecks value={perms} onChange={setPerms} /></div>
      <button type="button" onClick={save} disabled={busy} style={{ width: '100%', padding: 10, background: '#2e7d32', color: '#fff', border: 0, borderRadius: 7, fontWeight: 700, cursor: 'pointer' }}>
        {busy ? 'Saving…' : 'Save Permissions'}
      </button>
    </AdminModal>
  );
}

// Port of the original renderTeamTab() + createAdminAccount / editAdminAccount / deleteAdminAccount.
export default function AdminTeam() {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const isOwner = me?.role === 'owner' || me?.role === 'superadmin';
  const { data: admins, isLoading, error } = useQuery({ queryKey: ['admin-team'], queryFn: fetchTeam });
  const [f, setF] = useState({ username: '', name: '', mobile: '', password: '' });
  const [perms, setPerms] = useState<string[]>([]);
  const [edit, setEdit] = useState<AdminUser | null>(null);
  const [grant, setGrant] = useState({ mobile: '', perms: ['orders'] as string[] });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-team'] });
    qc.invalidateQueries({ queryKey: ['admin-users'] });
  };

  async function createAdmin() {
    try {
      await teamAction('create', { username: f.username.trim(), name: f.name.trim(), mobile: f.mobile.trim(), password: f.password, permissions: perms });
      showToast('Admin account created', 'success');
      setF({ username: '', name: '', mobile: '', password: '' });
      setPerms([]);
      refresh();
    } catch (e) {
      showToast(apiError(e) || 'Admin creation failed', 'error');
    }
  }

  async function removeAdmin(a: AdminUser) {
    const ok = await showConfirm(`Delete this admin account (${a.username})?\n\nAdmin access hat jayega; account normal customer ban jayega aur order history safe rahegi.`, { title: 'Delete admin account', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await teamAction('delete', { id: a.id });
      showToast('Admin account deleted', 'success');
      refresh();
    } catch (e) {
      showToast(apiError(e) || 'Delete failed', 'error');
    }
  }

  async function grantExisting() {
    if (!/^[6-9]\d{9}$/.test(grant.mobile)) return showToast('Valid 10-digit mobile daalo', 'error');
    if (!grant.perms.length) return showToast('Kam se kam ek permission chuno', 'error');
    try {
      const res = await assignRole(grant.mobile, 'admin', grant.perms);
      showToast(res.message || 'Admin access given', 'success');
      setGrant({ mobile: '', perms: ['orders'] });
      refresh();
    } catch (e) {
      showToast(apiError(e) || 'Failed', 'error');
    }
  }

  if (isLoading) return <p style={{ color: 'var(--gray)' }}>Loading team access...</p>;
  if (error) return <p style={{ color: '#c62828' }}>{apiError(error)}</p>;

  return (
    <>
      <div style={{ padding: 16, background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 12px', color: '#8d5d00' }}>Create admin account</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8 }}>
          <input placeholder="Username" aria-label="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} style={fieldStyle} />
          <input placeholder="Name" aria-label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={fieldStyle} />
          <input placeholder="Mobile (10-digit)" aria-label="Mobile" inputMode="numeric" maxLength={10} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/\D/g, '') })} style={fieldStyle} />
          <input type="password" placeholder="Password (8+ chars)" aria-label="Password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} style={fieldStyle} />
        </div>
        <div style={{ margin: '10px 0' }}><PermChecks value={perms} onChange={setPerms} /></div>
        <button type="button" onClick={createAdmin} style={{ padding: '9px 14px', background: '#2e7d32', color: '#fff', border: 0, borderRadius: 7, fontWeight: 700, cursor: 'pointer' }}>Create Admin</button>
      </div>

      {isOwner && (
        <div style={{ padding: 16, background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 12, marginBottom: 18 }}>
          <h3 style={{ margin: '0 0 6px', color: '#1565c0' }}>Give access to existing user (by mobile)</h3>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#555' }}>Jis customer ka account pehle se hai, uske mobile number pe admin role do. Unko app me naye orders ka push bhi milega.</p>
          <input placeholder="Mobile (10-digit)" aria-label="Existing user mobile" inputMode="numeric" maxLength={10} value={grant.mobile}
            onChange={(e) => setGrant({ ...grant, mobile: e.target.value.replace(/\D/g, '') })} style={{ ...fieldStyle, minWidth: 200 }} />
          <div style={{ margin: '10px 0' }}><PermChecks value={grant.perms} onChange={(p) => setGrant({ ...grant, perms: p })} /></div>
          <button type="button" onClick={grantExisting} style={{ padding: '9px 14px', background: '#1565c0', color: '#fff', border: 0, borderRadius: 7, fontWeight: 700, cursor: 'pointer' }}>Give Admin Access</button>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead><tr><th>Username</th><th>Name</th><th>Mobile</th><th>Permissions</th><th>Action</th></tr></thead>
          <tbody>
            {(admins || []).map((a) => (
              <tr key={a.id}>
                <td>{a.username}</td>
                <td>{a.name}</td>
                <td>{a.mobile}</td>
                <td>{a.role === 'admin' ? (a.permissions || []).join(', ') : 'all'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {a.role !== 'admin' ? 'Owner account' : (
                    <>
                      <button type="button" onClick={() => setEdit(a)} style={{ padding: '5px 9px', background: '#0891b2', color: '#fff', border: 0, borderRadius: 5, cursor: 'pointer', marginRight: 5 }}>Edit</button>
                      {Number(a.id) !== Number(me?.id) && (
                        <button type="button" onClick={() => removeAdmin(a)} style={{ padding: '5px 9px', background: '#e53935', color: '#fff', border: 0, borderRadius: 5, cursor: 'pointer' }}>Delete</button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && <EditAdminModal admin={edit} onClose={() => setEdit(null)} onSaved={refresh} />}
    </>
  );
}
