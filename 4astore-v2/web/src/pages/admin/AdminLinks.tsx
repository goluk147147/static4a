import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchShortLinks, createShortLink, ShortLink } from '../../lib/admin';
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

  const links = q.data ?? [];

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
                  <td style={{ fontSize: 12 }}>{l.clicks}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDateTime(l.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => copyText(shortUrl(l.code))} style={btnGhost}>📋 Copy</button>
                      <a href={shortUrl(l.code)} target="_blank" rel="noopener noreferrer" style={{ ...btnGhost, textDecoration: 'none' }}>↗ Open</a>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--gray)' }}>
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
