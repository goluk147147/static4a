import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError } from '../../../lib/api';
import { fetchFestivals, saveFestival, deleteFestival, Festival, MusicStyle } from '../../../lib/videos';
import { showToast } from '../../../store/toast';
import { showConfirm } from '../../../store/confirm';
import AdminModal from '../AdminModal';

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const blank = (): Festival => ({
  id: '', name: '', date: null, dateVerified: false, greeting: '', subText: '', emojis: ['🎉'],
  colors: { primary: '#ff6600', secondary: '#ff9800', accent: '#d32f2f' }, musicStyle: 'festive', defaultOffer: '', active: true,
});
const refresh = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['video-festivals'] });
  qc.invalidateQueries({ queryKey: ['video-today'] });
};

function FestivalEditor({ initial, isNew, onClose }: { initial: Festival; isNew: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Festival>(initial);
  const [emojis, setEmojis] = useState(initial.emojis.join(' '));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Festival>(k: K, v: Festival[K]) => setF((s) => ({ ...s, [k]: v }));
  const colors = f.colors || blank().colors!;

  async function save() {
    const payload: Festival = { ...f, id: isNew ? slug(f.id || f.name) : f.id, name: f.name.trim(), emojis: emojis.split(/\s+/).filter(Boolean).slice(0, 6), colors };
    if (!payload.name) return showToast('Festival name zaroori hai', 'error');
    if (!payload.id) return showToast('ID (slug) zaroori hai', 'error');
    setBusy(true);
    try {
      await saveFestival(isNew ? 'add' : 'update', payload);
      showToast(isNew ? 'Festival added' : 'Festival updated', 'success');
      refresh(qc);
      onClose();
    } catch (e) {
      showToast(apiError(e) || 'Failed to save festival', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminModal onClose={onClose} maxWidth={720}>
      <h3 style={{ color: 'var(--primary)', marginBottom: 14 }}>{isNew ? '➕ Add Festival' : `✏️ ${initial.name}`}</h3>
      <div className="va-grid">
        <div className="va-field"><label htmlFor="fe_name">Name *</label><input id="fe_name" value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} /></div>
        {isNew && <div className="va-field"><label htmlFor="fe_id">ID (auto)</label><input id="fe_id" value={f.id} placeholder={slug(f.name) || 'diwali'} onChange={(e) => set('id', e.target.value.toLowerCase())} /></div>}
        <div className="va-field">
          <label htmlFor="fe_date">Date (is saal)</label>
          <input id="fe_date" type="date" value={f.date || ''} onChange={(e) => setF((s) => ({ ...s, date: e.target.value || null, dateVerified: false }))} />
          <small>Panchang / calendar se check karke daalein</small>
        </div>
        <div className="va-field">
          <label htmlFor="fe_ver">Date verified?</label>
          <select id="fe_ver" value={f.dateVerified ? '1' : '0'} disabled={!f.date} onChange={(e) => set('dateVerified', e.target.value === '1')}>
            <option value="0">⚠️ Needs verification</option>
            <option value="1">✅ Verified</option>
          </select>
        </div>
        <div className="va-field"><label htmlFor="fe_greet">Greeting</label><input id="fe_greet" value={f.greeting} maxLength={120} onChange={(e) => set('greeting', e.target.value)} placeholder="Happy Diwali!" /></div>
        <div className="va-field"><label htmlFor="fe_sub">Sub text</label><input id="fe_sub" value={f.subText} maxLength={200} onChange={(e) => set('subText', e.target.value)} /></div>
        <div className="va-field"><label htmlFor="fe_offer">Default offer</label><input id="fe_offer" value={f.defaultOffer} maxLength={120} onChange={(e) => set('defaultOffer', e.target.value)} /></div>
        <div className="va-field"><label htmlFor="fe_emo">Emojis (space se alag)</label><input id="fe_emo" value={emojis} onChange={(e) => setEmojis(e.target.value)} /></div>
        <div className="va-field">
          <label>Colours</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['primary', 'secondary', 'accent'] as const).map((k) => (
              <input key={k} type="color" value={colors[k]} aria-label={`${k} colour`} title={k} onChange={(e) => set('colors', { ...colors, [k]: e.target.value })} style={{ width: 52, height: 38, padding: 2 }} />
            ))}
          </div>
        </div>
        <div className="va-field">
          <label htmlFor="fe_music">Music</label>
          <select id="fe_music" value={f.musicStyle} onChange={(e) => set('musicStyle', e.target.value as MusicStyle)}>
            <option value="festive">🎉 Festive</option><option value="upbeat">🎵 Upbeat</option><option value="calm">🌙 Calm</option>
          </select>
        </div>
        <div className="va-field">
          <label htmlFor="fe_active">Active?</label>
          <select id="fe_active" value={f.active ? '1' : '0'} onChange={(e) => set('active', e.target.value === '1')}>
            <option value="1">✅ Active</option><option value="0">🚫 Off (auto video nahi banega)</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="va-btn" onClick={save} disabled={busy}>💾 {busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="va-btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </AdminModal>
  );
}

/** Festival calendar — stored in MySQL `festivals`; dates are entered/verified by the admin. */
export default function VideoCalendar() {
  const qc = useQueryClient();
  const { data: list = [], isLoading, error } = useQuery({ queryKey: ['video-festivals'], queryFn: fetchFestivals });
  const [edit, setEdit] = useState<{ f: Festival; isNew: boolean } | null>(null);

  async function remove(f: Festival) {
    if (!(await showConfirm(`Delete festival "${f.name}"?`, { title: 'Delete festival', confirmText: 'Delete', danger: true }))) return;
    try {
      await deleteFestival(f.id);
      showToast('Festival deleted', 'success');
      refresh(qc);
    } catch (e) {
      showToast(apiError(e) || 'Delete failed', 'error');
    }
  }

  if (isLoading) return <p style={{ color: 'var(--gray)' }}>Loading calendar...</p>;
  if (error) return <div className="va-error">{apiError(error)}</div>;
  const pending = list.filter((f) => f.active && (!f.date || !f.dateVerified)).length;

  return (
    <>
      <div className="va-note">
        ⚠️ Zyada-tar tyohar chandra calendar (panchang) se chalte hain, isliye unki date har saal badalti hai. Isliye saari dates <strong>"needs verification"</strong> hain — sirf fixed-date wale (1 Jan, 14 Jan, 26 Jan, 15 Aug, 25 Dec) pehle se bhare hain. Har saal date check karke ✅ Verified karein.
        {pending > 0 && <> Abhi <strong>{pending}</strong> festivals baaki hain.</>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button type="button" className="va-btn" onClick={() => setEdit({ f: blank(), isNew: true })}>➕ Add Festival</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead><tr><th>Festival</th><th>Date</th><th>Status</th><th>Colours</th><th>Music</th><th>Action</th></tr></thead>
          <tbody>
            {list.map((f) => (
              <tr key={f.id} style={f.active ? undefined : { opacity: 0.55 }}>
                <td><span style={{ fontSize: 20 }}>{f.emojis.slice(0, 3).join('')}</span> <strong>{f.name}</strong><div style={{ fontSize: 11, color: 'var(--gray)' }}>{f.greeting}</div></td>
                <td style={{ whiteSpace: 'nowrap' }}>{f.date || <span style={{ color: '#b45309' }}>— date daalein —</span>}</td>
                <td>
                  {!f.active ? <span className="va-badge" style={{ background: '#9ca3af' }}>Off</span>
                    : f.date && f.dateVerified ? <span className="va-badge" style={{ background: '#059669' }}>✅ Verified</span>
                    : <span className="va-badge" style={{ background: '#f59e0b' }}>⚠️ Verify</span>}
                </td>
                <td>{f.colors && (['primary', 'secondary', 'accent'] as const).map((k) => <span key={k} className="va-swatch" style={{ background: f.colors![k] }} title={f.colors![k]} />)}</td>
                <td style={{ textTransform: 'capitalize' }}>{f.musicStyle}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="va-mini" onClick={() => setEdit({ f, isNew: false })}>✏️ Edit</button>{' '}
                  <button type="button" className="va-mini" style={{ background: '#fee2e2', color: '#b91c1c' }} onClick={() => remove(f)} aria-label={`Delete ${f.name}`}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <FestivalEditor initial={edit.f} isNew={edit.isNew} onClose={() => setEdit(null)} />}
    </>
  );
}
