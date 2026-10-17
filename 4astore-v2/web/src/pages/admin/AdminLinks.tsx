import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchShortLinks, createShortLink, updateShortLink, ShortLink } from '../../lib/admin';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';

// Public site origin — short links resolve at https://4astore.com/link/<code>
// (the /link reverse-proxy rule reaches the Node /api/link route). Fall back to
// the known canonical when running on localhost. Mirrors AdminMarketing.SITE_ORIGIN.
const SITE_ORIGIN =
  (typeof window !== 'undefined' && window.location.origin && !/localhost|127\.0\.0\.1/.test(window.location.origin))
    ? window.location.origin
    : 'https://4astore.com';

function shortUrl(code: string): string {
  return `${SITE_ORIGIN}/link/${code}`;
}

function fmtDateTime(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function copyText(text: string, label = 'Link copied') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`✅ ${label}`, 'success');
  } catch {
    showToast('Copy failed — please copy manually', 'error');
  }
}

export default function AdminLinks() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-links'], queryFn: fetchShortLinks });

  const [targetUrl, setTargetUrl] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [customImage, setCustomImage] = useState('');
  const [previewTitle, setPreviewTitle] = useState('');
  const [busy, setBusy] = useState(false);

  // Inline per-row edit state — scoped to og_image/og_title only.
  const [editCode, setEditCode] = useState<string | null>(null);
  const [editImage, setEditImage] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const links = q.data ?? [];

  function startEdit(l: ShortLink) {
    setEditCode(l.code);
    setEditImage(l.og_image || '');
    setEditTitle(l.og_title || '');
  }

  function cancelEdit() {
    setEditCode(null);
    setEditImage('');
    setEditTitle('');
  }

  async function saveEdit(code: string) {
    setEditBusy(true);
    try {
      await updateShortLink(code, { ogImage: editImage.trim(), ogTitle: editTitle.trim() });
      await qc.invalidateQueries({ queryKey: ['admin-links'] });
      showToast('✅ Updated / अपडेट हो gaya', 'success');
      cancelEdit();
    } catch (err) {
      showToast(apiError(err) || 'Could not update', 'error');
    } finally {
      setEditBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const target = targetUrl.trim();
    if (!target) { showToast('Target URL zaroori hai / enter a URL', 'error'); return; }
    setBusy(true);
    try {
      await createShortLink({
        targetUrl: target,
        code: customCode.trim() || undefined,
        ogImage: customImage.trim() || undefined,
        ogTitle: previewTitle.trim() || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['admin-links'] });
      showToast('✅ Short link ban gaya / link created', 'success');
      setTargetUrl('');
      setCustomCode('');
      setCustomImage('');
      setPreviewTitle('');
    } catch (err) {
      // 409 → duplicate custom code; surface the server message.
      showToast(apiError(err) || 'Could not create link', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 980, display: 'grid', gap: 16 }}>
      <div>
        <h4 style={{ margin: '0 0 4px' }}>🔗 Short Links</h4>
        <p style={muted}>
          Universal short links — koi bhi URL ka <code>{SITE_ORIGIN}/link/&lt;code&gt;</code> ban jaata hai. Product
          links auto ban-te hain; yahan se kisi bhi URL ke liye custom link bana sakte hain.
        </p>
      </div>

      <form onSubmit={submit} style={card}>
        <strong style={cardTitle}>➕ Create link / नया लिंक</strong>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={lbl}>Target URL / लक्ष्य URL</label>
            <input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              style={inp}
              placeholder="https://4astore.com/product/123"
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={lbl}>Custom code (optional)</label>
            <input
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              style={inp}
              placeholder="auto"
            />
          </div>
          <button type="submit" disabled={busy} style={btnPrimary}>{busy ? '⏳ Creating…' : 'Create'}</button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={lbl}>Custom image URL (optional) / कस्टम इमेज URL</label>
            <input
              value={customImage}
              onChange={(e) => setCustomImage(e.target.value)}
              style={inp}
              placeholder="https://4astore.com/uploads/my-banner.jpg"
            />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={lbl}>Preview title (optional) / प्रीव्यू टाइटल</label>
            <input
              value={previewTitle}
              onChange={(e) => setPreviewTitle(e.target.value)}
              style={inp}
              placeholder="4A Store"
            />
          </div>
        </div>
        <p style={{ ...muted, marginTop: 8 }}>
          WhatsApp par share karne par yeh image/title dikhega. Khaali chhodne par 4A Store ka logo aayega.
        </p>
      </form>

      <div style={card}>
        <strong style={cardTitle}>📋 All links / सभी लिंक</strong>
        {q.isError && <div style={errBox}>{apiError(q.error)}</div>}
        <div style={{ ...tableWrap, marginTop: 10 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Target / लक्ष्य</th>
                <th>Type</th>
                <th>Preview / प्रीव्यू</th>
                <th>Clicks</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {links.length ? links.map((l: ShortLink) => (
                <tr key={l.code}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{l.code}</td>
                  <td style={{ fontSize: 12, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.target_url}>{l.target_url}</td>
                  <td style={{ fontSize: 12 }}>{l.type}</td>
                  <td style={{ fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {l.og_image
                        ? <img src={l.og_image} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                        : <span style={muted}>4A Store logo (default)</span>}
                      <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.og_title || <span style={muted}>—</span>}
                      </span>
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>{l.clicks}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDateTime(l.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => copyText(shortUrl(l.code))} style={btnGhost}>📋 Copy</button>
                      <a href={shortUrl(l.code)} target="_blank" rel="noopener noreferrer" style={{ ...btnGhost, textDecoration: 'none' }}>↗ Open</a>
                      <button type="button" onClick={() => startEdit(l)} style={btnGhost}>✏️ Edit / संपादित करें</button>
                    </div>
                  </td>
                </tr>
              )).concat(
                editCode
                  ? (() => {
                      const editing = links.find((l) => l.code === editCode);
                      if (!editing) return [];
                      return [
                        <tr key={`${editCode}-editor`}>
                          <td colSpan={7} style={{ background: '#f8fafc' }}>
                            <div style={{ display: 'grid', gap: 10, padding: '4px 2px' }}>
                              <strong style={cardTitle}>✏️ Edit preview / प्रीव्यू संपादित करें — <code>{editing.code}</code></strong>
                              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                <div style={{ flex: 1, minWidth: 220 }}>
                                  <label style={lbl}>Custom image URL (optional) / कस्टम इमेज URL</label>
                                  <input value={editImage} onChange={(e) => setEditImage(e.target.value)} style={inp} placeholder="https://4astore.com/uploads/my-banner.jpg" />
                                </div>
                                <div style={{ flex: 1, minWidth: 220 }}>
                                  <label style={lbl}>Preview title (optional) / प्रीव्यू टाइटल</label>
                                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={inp} placeholder="4A Store" />
                                </div>
                                <button type="button" disabled={editBusy} onClick={() => saveEdit(editing.code)} style={btnPrimary}>{editBusy ? '⏳ Saving…' : '💾 Save / सेव करें'}</button>
                                <button type="button" disabled={editBusy} onClick={cancelEdit} style={btnGhost}>Cancel / रद्द करें</button>
                              </div>
                              <p style={muted}>Khaali chhodne par 4A Store ka logo aayega / leave empty for the 4A Store default card.</p>
                            </div>
                          </td>
                        </tr>,
                      ];
                    })()
                  : [],
              ) : (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--gray)' }}>
                  {q.isLoading ? 'Loading…' : 'Koi link nahi / no links yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Shared inline-style tokens — mirror AdminMarketing.tsx so the page matches the admin look.
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--primary-dark)', marginBottom: 4 };
const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '2px solid var(--border)', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { padding: '9px 18px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { padding: '7px 12px', background: '#f1f5f9', color: 'var(--primary-dark)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const errBox: React.CSSProperties = { background: '#fee2e2', color: '#b91c1c', padding: 10, borderRadius: 8, marginBottom: 12 };
const tableWrap: React.CSSProperties = { overflowX: 'auto', background: '#fff', border: '1px solid var(--border)', borderRadius: 12 };
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow)' };
const cardTitle: React.CSSProperties = { fontSize: 14, color: 'var(--primary-dark)', display: 'block' };
const muted: React.CSSProperties = { fontSize: 12, color: 'var(--gray)' };
