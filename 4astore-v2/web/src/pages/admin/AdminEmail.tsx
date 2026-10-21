import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  sendEmailBroadcast,
  uploadBannerImage,
  searchEmailRecipients,
  fetchEmailHistory,
  SearchedEmailRecipient,
  EmailBroadcastRecord,
} from '../../lib/admin';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';

// The branded email logo (PNG — Gmail/Outlook block SVG). Shown in the preview
// so the admin sees the real header before sending.
const EMAIL_LOGO_URL = 'https://4astore.com/legacy/images/logo.png';

// Soft field caps mirror the server zod schema (title 1..160, description 1..5000).
const TITLE_MAX = 160;
const DESC_MAX = 5000;

// Composer targets. 'selected' switches on the email-only search + multi-select.
const TARGETS: [string, string][] = [
  ['all', 'All customers / सभी ग्राहक'],
  ['customers', 'Customers only / केवल ग्राहक'],
  ['selected', 'Specific users / चुने हुए users'],
];

function fmtDate(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v || '-';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ---------- Email-only user search + multi-select (plain React, no new dep) ---------- */

function RecipientPicker({
  selected,
  onChange,
}: {
  selected: SearchedEmailRecipient[];
  onChange: (next: SearchedEmailRecipient[]) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchedEmailRecipient[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search (~300 ms via a setTimeout ref — no new dependency). The
  // endpoint only returns users WITH a real email, so the dropdown inherently
  // lists only emailable users.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLoading(true);
      searchEmailRecipients(q.trim())
        .then((r) => setResults(r))
        .catch((e) => showToast(apiError(e), 'error'))
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  const visible = results.filter((r) => !selectedIds.has(r.id));

  function add(r: SearchedEmailRecipient) {
    if (selectedIds.has(r.id)) return;
    onChange([...selected, r]);
    setQ('');
    setResults([]);
    setOpen(false);
  }
  function remove(id: number) {
    onChange(selected.filter((s) => s.id !== id));
  }

  const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '2px solid var(--border)', borderRadius: 8, fontSize: 14 };

  return (
    <div className="field">
      <label>Recipients / प्राप्तकर्ता (sirf email wale users)</label>

      {/* Selected chips + count */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {selected.map((s) => (
            <span key={s.id}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff3e6', color: 'var(--primary-dark)', border: '1px solid #ffd7ad', borderRadius: 999, padding: '4px 8px 4px 10px', fontSize: 12, maxWidth: 260 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.name ? `${s.name} · ` : ''}{s.email}
              </span>
              <button type="button" aria-label={`Remove ${s.email}`} onClick={() => remove(s.id)}
                style={{ border: 'none', background: '#ffd7ad', color: 'var(--primary-dark)', borderRadius: '50%', width: 18, height: 18, lineHeight: '16px', cursor: 'pointer', fontSize: 12, padding: 0 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 6 }}>
        {selected.length} recipient{selected.length === 1 ? '' : 's'} selected
      </div>

      {/* Search box + results dropdown */}
      <div style={{ position: 'relative' }}>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Naam, email ya mobile se search karein…"
          style={inp}
        />
        {open && (q.trim() !== '' || visible.length > 0) && (
          <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: 'calc(100% + 4px)', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.12)', maxHeight: 240, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 12, fontSize: 13, color: 'var(--gray)' }}>Searching…</div>
            ) : visible.length ? (
              visible.map((r) => (
                <button key={r.id} type="button" onClick={() => add(r)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid #f1f5f9', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>{r.name || '(no name)'}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray)' }}>{r.email}{r.mobile ? ` · ${r.mobile}` : ''}</div>
                </button>
              ))
            ) : (
              <div style={{ padding: 12, fontSize: 13, color: 'var(--gray)' }}>
                {q.trim() ? 'Koi email wala user nahi mila.' : 'Type karke search karein.'}
              </div>
            )}
          </div>
        )}
      </div>
      <p style={{ fontSize: 11, color: 'var(--gray)', marginTop: 6 }}>
        Sirf wahi users dikhte hain jinke paas email hai. Multi-select — kai users chun sakte hain.
      </p>
    </div>
  );
}

/* ---------- Compose view ---------- */

function ComposeForm({ onSent }: { onSent: () => void }) {
  const [target, setTarget] = useState<'all' | 'customers' | 'selected'>('all');
  const [recipients, setRecipients] = useState<SearchedEmailRecipient[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const url = await uploadBannerImage(dataUri);
      setImage(url);
    } catch (err) {
      showToast(apiError(err), 'error');
    } finally {
      setUploading(false);
    }
  }

  const canSend = useMemo(() => {
    if (busy || title.trim().length === 0 || description.trim().length === 0) return false;
    // "Specific users" needs at least one selected recipient.
    if (target === 'selected' && recipients.length === 0) return false;
    return true;
  }, [busy, title, description, target, recipients]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    try {
      const r = await sendEmailBroadcast({
        title: title.trim(),
        description: description.trim(),
        imageUrl: image.trim() || undefined,
        target,
        userIds: target === 'selected' ? recipients.map((x) => x.id) : undefined,
      });
      const summary = `✅ Email: ${r.sent}/${r.total} sent${r.failed ? `, ${r.failed} failed` : ''}`;
      showToast(r.message || summary, r.failed && !r.sent ? 'error' : 'success');
      // Return to the history list so the admin sees the new sent record.
      onSent();
    } catch (err) {
      showToast(apiError(err), 'error');
      setBusy(false);
    }
  }

  const lblStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
  const countStyle: React.CSSProperties = { fontSize: 11, color: 'var(--gray)', fontWeight: 400 };

  return (
    <form onSubmit={send} style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow)', maxWidth: 560 }}>
      <div className="field">
        <label>Send to / Kise bhejein</label>
        <select value={target} onChange={(e) => setTarget(e.target.value as 'all' | 'customers' | 'selected')}>
          {TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {target === 'selected' && <RecipientPicker selected={recipients} onChange={setRecipients} />}

      <div className="field">
        <label style={lblStyle}><span>Title / शीर्षक</span><span style={countStyle}>{title.length}/{TITLE_MAX}</span></label>
        <input value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder="Diwali Dhamaka Sale!" required />
      </div>

      <div className="field">
        <label style={lblStyle}><span>Description / विवरण</span><span style={countStyle}>{description.length}/{DESC_MAX}</span></label>
        <textarea rows={6} value={description} maxLength={DESC_MAX} onChange={(e) => setDescription(e.target.value)} placeholder="Aaj sabhi products par 20% OFF. Abhi order karein!" required />
      </div>

      <div className="field">
        <label>Image (optional) / तस्वीर</label>
        <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://… (poster / product image)" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} style={{ display: 'none' }} id="emailImageUpload" />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            style={{ padding: '7px 14px', background: 'var(--secondary)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: uploading ? 'default' : 'pointer' }}>
            {uploading ? 'Uploading…' : '📤 Upload image'}
          </button>
          {image && <button type="button" onClick={() => setImage('')} style={{ padding: '7px 12px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>✕ Hataayein</button>}
        </div>
        <p style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>
          Email me ye image dikhegi. URL de sakte hain ya upload kar sakte hain. (PNG/JPG, absolute URL.)
        </p>
      </div>

      {/* Live preview of the branded email (logo + title + description + image). */}
      <div className="field">
        <label>Preview / पूर्वावलोकन</label>
        <div style={{ background: '#f4f4f5', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
          <div style={{ maxWidth: 420, margin: '0 auto', background: '#fff', border: '1px solid #eee', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ background: '#ff7a00', padding: '16px 20px', textAlign: 'center' }}>
              <img src={EMAIL_LOGO_URL} alt="4A Store" width={110} style={{ display: 'inline-block', maxWidth: 110, height: 'auto' }} />
            </div>
            <div style={{ padding: '20px 20px 24px', fontFamily: 'Arial, Helvetica, sans-serif', color: '#222' }}>
              <h1 style={{ margin: '0 0 14px', fontSize: 18, lineHeight: 1.3, color: '#222', wordBreak: 'break-word' }}>{title || 'Title yahan dikhega'}</h1>
              {image.trim() ? (
                <img src={image.trim()} alt={title || 'Email image'} style={{ display: 'block', maxWidth: '100%', height: 'auto', borderRadius: 8, margin: '0 0 16px' }} />
              ) : null}
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#333', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{description || 'Description yahan dikhega'}</p>
            </div>
          </div>
        </div>
      </div>

      <button className="btn btn-block" disabled={!canSend}>
        {busy ? '⏳ Bhej rahe hain…' : '✉️ Send Email'}
      </button>
    </form>
  );
}

/* ---------- Sent emails (history) view ---------- */

function HistoryList() {
  const [rows, setRows] = useState<EmailBroadcastRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    fetchEmailHistory({ limit: 50 })
      .then((r) => setRows(r))
      .catch((e) => setErr(apiError(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      {err && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: 10, borderRadius: 8, marginBottom: 12, maxWidth: 720 }}>{err}</div>
      )}
      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid var(--border)', borderRadius: 12 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Title</th><th>When</th><th>Target</th><th>Sent</th><th>Failed</th><th>Total</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((b) => (
                <Fragment key={b.id}>
                  <tr>
                    <td><strong>{b.title || '-'}</strong></td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(b.createdAt)}</td>
                    <td>{b.target}</td>
                    <td style={{ color: '#2e7d32', fontWeight: 600 }}>{b.sent}</td>
                    <td style={{ color: b.failed ? '#c62828' : '#999', fontWeight: 600 }}>{b.failed}</td>
                    <td>{b.total}</td>
                    <td>
                      <button type="button" onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                        style={{ padding: '5px 10px', background: '#f1f5f9', color: 'var(--primary-dark)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {expanded === b.id ? 'Hide' : `Recipients (${b.recipients.length})`}
                      </button>
                    </td>
                  </tr>
                  {expanded === b.id && (
                    <tr>
                      <td colSpan={7} style={{ background: '#fafafa' }}>
                        {b.recipients.length ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 2px' }}>
                            {b.recipients.map((r, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                                <span style={{ display: 'inline-block', minWidth: 54, textAlign: 'center', padding: '2px 8px', borderRadius: 999, fontWeight: 600, color: '#fff', background: r.status === 'sent' ? '#2e7d32' : '#c62828' }}>
                                  {r.status === 'sent' ? 'Sent' : 'Failed'}
                                </span>
                                <span style={{ fontWeight: 600, color: '#0f172a' }}>{r.name || '(no name)'}</span>
                                <span style={{ color: 'var(--gray)' }}>{r.email}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ padding: 8, fontSize: 12, color: 'var(--gray)' }}>No recipient details recorded.</div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            ) : (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--gray)' }}>{loading ? 'Loading…' : 'Abhi tak koi email nahi bheji gayi.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray)' }}>{rows.length} shown</div>}
    </>
  );
}

/* ---------- Main Page (Compose / Sent emails) ---------- */

/**
 * Admin "Send Email" — a two-view page (Compose / Sent emails) mirroring
 * AdminNotify's list+compose split. COMPOSE: title + description + optional
 * image (reusing uploadBannerImage), target segment, plus an email-only search +
 * multi-select for "Specific users". SENT EMAILS: the broadcast history with a
 * per-recipient sent/failed breakdown. Renders inside the 'ads'-gated
 * /admin/email route (same permission as Push / Marketing).
 */
export default function AdminEmail() {
  const [view, setView] = useState<'compose' | 'history'>('compose');
  // Force-remount the history list when switching to it so it refetches.
  const [listKey, setListKey] = useState(0);

  function showHistory() {
    setListKey((k) => k + 1);
    setView('history');
  }

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '8px 18px',
    background: active ? 'var(--primary)' : '#f1f5f9',
    color: active ? '#fff' : 'var(--primary-dark)',
    border: active ? 'none' : '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div>
          <h4 style={{ margin: '0 0 4px' }}>✉️ Send Email</h4>
          <p style={{ fontSize: 13, color: 'var(--gray)', margin: 0 }}>
            Sabhi ya chune hue customers ko branded email bhejein. Jinhone unsubscribe kiya hai unhe nahi jayega.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={tabBtn(view === 'compose')} onClick={() => setView('compose')}>📣 Compose</button>
          <button type="button" style={tabBtn(view === 'history')} onClick={showHistory}>📜 Sent emails</button>
        </div>
      </div>

      {view === 'compose'
        ? <ComposeForm onSent={showHistory} />
        : <HistoryList key={listKey} />}
    </>
  );
}
