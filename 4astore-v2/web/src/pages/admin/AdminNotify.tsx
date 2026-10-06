import { useEffect, useMemo, useRef, useState } from 'react';
import { sendBroadcast, uploadBannerImage, fetchNotifications, AdminNotification } from '../../lib/admin';
import { apiError } from '../../lib/api';
import { useConfig, useProducts } from '../../lib/queries';
import { isFeatureOn } from '../../lib/features';
import { showToast } from '../../store/toast';
import EmojiPicker from '../../components/EmojiPicker';

// Push payload soft limits — keep titles/bodies within what FCM shows on a
// notification shade so the message is not silently truncated on the device.
const TITLE_MAX = 65;
const BODY_MAX = 240;
const PAGE_SIZE = 50;

const SEGMENTS: [string, string][] = [
  ['all', 'Everyone / सभी'],
  ['customers', 'Customers / ग्राहक'],
  ['riders', 'Riders / राइडर'],
  ['admins', 'Admins & Staff / एडमिन'],
];

const DEEP_LINK_EXAMPLES = ['/products', '/products?festival=diwali', '/product/12', '/orders'];

type FieldRef = HTMLInputElement | HTMLTextAreaElement | null;

/**
 * Insert `ins` at the current caret of a text field, respecting the max length.
 * FCM notification title/body are plain strings, so we compose with plain
 * text + emoji only (no HTML) — exactly what gets sent and what the app shows.
 */
function insertAtCaret(el: FieldRef, value: string, ins: string, max: number): { next: string; caret: number } {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const next = (value.slice(0, start) + ins + value.slice(end)).slice(0, max);
  const caret = Math.min(start + ins.length, next.length);
  return { next, caret };
}

function fmtDate(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v || '-';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function targetLink(n: AdminNotification): React.ReactNode {
  if (n.productId != null) return <a href={`/product/${n.productId}`} target="_blank" rel="noreferrer">Product #{n.productId}</a>;
  if (n.orderId) return <span>Order {n.orderId}</span>;
  if (n.link) return <span style={{ wordBreak: 'break-all' }}>{n.link}</span>;
  return <span style={{ color: 'var(--gray)' }}>—</span>;
}

/* ---------- Notification History List ---------- */

function NotificationList({ onCompose }: { onCompose: () => void }) {
  const [rows, setRows] = useState<AdminNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [userIdInput, setUserIdInput] = useState('');
  const [productIdInput, setProductIdInput] = useState('');
  const [applied, setApplied] = useState<{ userId: string; productId: string }>({ userId: '', productId: '' });

  const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--primary-dark)', marginBottom: 4 };
  const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '2px solid var(--border)', borderRadius: 8, fontSize: 13 };

  async function load(cursor: string | null, reset: boolean) {
    setLoading(true);
    setErr(null);
    try {
      const page = await fetchNotifications({
        userId: applied.userId || undefined,
        productId: applied.productId || undefined,
        limit: PAGE_SIZE,
        cursor: cursor || undefined,
      });
      setRows((prev) => (reset ? page.notifications : [...prev, ...page.notifications]));
      setNextCursor(page.nextCursor);
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setApplied({ userId: userIdInput.trim(), productId: productIdInput.trim() });
  }

  function clearFilters() {
    setUserIdInput('');
    setProductIdInput('');
    setApplied({ userId: '', productId: '' });
  }

  return (
    <>
      {/* Header with compose button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div>
          <h4 style={{ margin: '0 0 4px' }}>🔔 Push Notifications</h4>
          <p style={{ fontSize: 13, color: 'var(--gray)', margin: 0 }}>Bheji gayi sabhi notifications ka record — kis user/product ke liye, kitni success/fail hui.</p>
        </div>
        <button type="button" onClick={onCompose}
          style={{ padding: '10px 22px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
          📣 Send Push
        </button>
      </div>

      {/* Filters */}
      <form onSubmit={applyFilters} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16, maxWidth: 640 }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={lbl} htmlFor="notif_user">User ID (optional)</label>
          <input id="notif_user" value={userIdInput} inputMode="numeric" onChange={(e) => setUserIdInput(e.target.value.replace(/[^0-9]/g, ''))} placeholder="e.g. 42" style={inp} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={lbl} htmlFor="notif_prod">Product ID (optional)</label>
          <input id="notif_prod" value={productIdInput} inputMode="numeric" onChange={(e) => setProductIdInput(e.target.value.replace(/[^0-9]/g, ''))} placeholder="e.g. 12" style={inp} />
        </div>
        <button type="submit" style={{ padding: '9px 18px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>🔍 Filter</button>
        {(applied.userId || applied.productId) && (
          <button type="button" onClick={clearFilters} style={{ padding: '9px 16px', background: '#666', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Clear</button>
        )}
      </form>

      {err && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: 10, borderRadius: 8, marginBottom: 12, maxWidth: 640 }}>{err}</div>
      )}

      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid var(--border)', borderRadius: 12 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Title</th><th>Type</th><th>Target</th><th>Link / Product</th><th>Success</th><th>Fail</th><th>Sent by</th><th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((n) => (
                <tr key={n.id}>
                  <td>
                    <strong>{n.title || '-'}</strong>
                    {n.body ? <div style={{ fontSize: 11, color: 'var(--gray)', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.body}</div> : null}
                    {n.image ? <img src={n.image} alt="" style={{ marginTop: 4, width: 48, height: 32, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} /> : null}
                  </td>
                  <td>{n.type || '-'}</td>
                  <td>{n.target || '-'}</td>
                  <td>{targetLink(n)}</td>
                  <td style={{ color: '#2e7d32', fontWeight: 600 }}>{n.successCount}</td>
                  <td style={{ color: n.failureCount ? '#c62828' : '#999', fontWeight: 600 }}>{n.failureCount}</td>
                  <td>{n.sentBy || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(n.createdAt)}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--gray)' }}>{loading ? 'Loading…' : 'Abhi tak koi notification nahi bheji gayi.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        {nextCursor && (
          <button type="button" onClick={() => load(nextCursor, false)} disabled={loading}
            style={{ padding: '9px 20px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
        {rows.length > 0 && <span style={{ fontSize: 12, color: 'var(--gray)' }}>{rows.length} shown</span>}
      </div>
    </>
  );
}

/* ---------- Compose Form ---------- */

function ComposeForm({ onBack }: { onBack: () => void }) {
  const products = useProducts().data ?? [];

  const [target, setTarget] = useState('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [image, setImage] = useState('');
  const [productId, setProductId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<'title' | 'body'>('body');

  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickProduct(id: string) {
    setProductId(id);
    if (!id) return;
    const p = products.find((x) => String(x.id) === id);
    if (!p) return;
    setLink(`/product/${id}`);
    if (p.image) setImage(p.image);
  }

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

  const canSend = useMemo(() => !busy && title.trim().length > 0 && body.trim().length > 0, [busy, title, body]);

  function pickEmoji(emoji: string) {
    if (active === 'title') {
      const { next, caret } = insertAtCaret(titleRef.current, title, emoji, TITLE_MAX);
      setTitle(next);
      requestAnimationFrame(() => { const el = titleRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret); } });
    } else {
      const { next, caret } = insertAtCaret(bodyRef.current, body, emoji, BODY_MAX);
      setBody(next);
      requestAnimationFrame(() => { const el = bodyRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret); } });
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    try {
      const r = await sendBroadcast(target, title.trim(), body.trim(), link.trim() || undefined, image.trim() || undefined, productId.trim() || undefined);
      showToast(r.message || '✅ Notification sent successfully!', 'success');
      // Go back to list — the list will refetch and show the new notification.
      onBack();
    } catch (err) {
      showToast(apiError(err), 'error');
      // Re-enable button so admin can retry
      setBusy(false);
    }
  }

  const lblStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
  const countStyle: React.CSSProperties = { fontSize: 11, color: 'var(--gray)', fontWeight: 400 };

  return (
    <>
      {/* Back button header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button type="button" onClick={onBack}
          style={{ padding: '8px 16px', background: '#f1f5f9', color: 'var(--primary-dark)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          ← Back
        </button>
        <h4 style={{ margin: 0 }}>📣 Compose Push Notification</h4>
      </div>

      <form onSubmit={send} style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow)', maxWidth: 520 }}>
        <p style={{ fontSize: 12, color: 'var(--gray)', margin: '0 0 16px' }}>Ek message sabhi (ya ek segment ke) users ko bhejein — app notification + deep link. Emoji add kar sakte hain (Hindi + English + emoji sab chalega).</p>

        <div className="field">
          <label>Send to / Kise bhejein</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <div className="field">
          <label style={lblStyle}><span>Title / शीर्षक</span><span style={countStyle}>{title.length}/{TITLE_MAX}</span></label>
          <input ref={titleRef} value={title} maxLength={TITLE_MAX} onFocus={() => setActive('title')} onChange={(e) => setTitle(e.target.value)} placeholder="Aaj ka offer!" required />
        </div>

        <div className="field">
          <label style={lblStyle}><span>Message / संदेश</span><span style={countStyle}>{body.length}/{BODY_MAX}</span></label>
          <textarea ref={bodyRef} rows={3} value={body} maxLength={BODY_MAX} onFocus={() => setActive('body')} onChange={(e) => setBody(e.target.value)} placeholder="Sabhi hari sabziyon par 20% OFF." required />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <EmojiPicker onPick={pickEmoji} />
            <span style={{ fontSize: 11, color: 'var(--gray)' }}>Emoji {active === 'title' ? 'Title' : 'Message'} me add hoga (jis field me cursor ho).</span>
          </div>
        </div>

        <div className="field">
          <label>Product (optional) / प्रोडक्ट</label>
          <select value={productId} onChange={(e) => pickProduct(e.target.value)}>
            <option value="">— Koi product nahi (manual link) —</option>
            {products.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </select>
          <p style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>
            Product chunne par link <code>/product/&lt;id&gt;</code> ho jaayega aur uski image auto-fill ho jaayegi.
          </p>
        </div>

        <div className="field">
          <label>Deep link (optional) / लिंक</label>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="/products?festival=diwali" />
          <p style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>
            Push pe click karte hi user is page pe khulega. Examples: {DEEP_LINK_EXAMPLES.join(' · ')}
          </p>
        </div>

        <div className="field">
          <label>Image (optional) / तस्वीर</label>
          <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://… (poster / product image)" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} style={{ display: 'none' }} id="notifImageUpload" />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              style={{ padding: '7px 14px', background: 'var(--secondary)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: uploading ? 'default' : 'pointer' }}>
              {uploading ? 'Uploading…' : '📤 Upload image'}
            </button>
            {image && <button type="button" onClick={() => setImage('')} style={{ padding: '7px 12px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>✕ Hataayein</button>}
          </div>
          <p style={{ fontSize: 11, color: 'var(--gray)', marginTop: 4 }}>
            Big-picture push me ye image dikhegi. URL de sakte hain ya upload kar sakte hain.
            {!image.trim() && ' Khaali chhodne par notification clean text-only dikhega (sirf title + message, koi banner nahi).'}
          </p>
        </div>

        {/* Live preview of how the notification will look on a device. */}
        <div className="field">
          <label>Preview / पूर्वावलोकन</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#f1f5f9', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🛒</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--gray)', marginBottom: 2 }}>4A Store · now</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{title || 'Title yahan dikhega'}</div>
              <div style={{ fontSize: 13, color: '#334155', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{body || 'Message yahan dikhega'}</div>
              {image.trim() ? (
                <img src={image.trim()} alt="Push preview" style={{ marginTop: 8, maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
              ) : (
                <div style={{ fontSize: 10, color: 'var(--gray)', marginTop: 4 }}>No image — clean text-only notification</div>
              )}
            </div>
          </div>
        </div>

        <button className="btn btn-block" disabled={!canSend}>
          {busy ? '⏳ Bhej rahe hain…' : '📣 Send Push Notification'}
        </button>
      </form>
    </>
  );
}

/* ---------- Main Page (combined list + compose) ---------- */

export default function AdminNotify() {
  const features = useConfig().data?.features;
  const enabled = isFeatureOn(features, 'bulkPushEnabled');

  // 'list' = default view showing history, 'compose' = send form
  const [view, setView] = useState<'list' | 'compose'>('list');

  // A counter to force-remount the list when we come back from compose (triggers refetch).
  const [listKey, setListKey] = useState(0);

  function handleBack() {
    setListKey((k) => k + 1);
    setView('list');
  }

  if (!enabled) {
    return (
      <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, padding: 20, maxWidth: 520 }}>
        <h4 style={{ margin: '0 0 6px', color: '#8d5d00' }}>📣 Bulk Push (band hai)</h4>
        <p style={{ margin: 0, fontSize: 13, color: '#8d5d00' }}>
          Bulk push / broadcast abhi disabled hai. Settings → Features me &quot;Bulk push&quot; toggle on karein.
        </p>
      </div>
    );
  }

  return view === 'compose'
    ? <ComposeForm onBack={handleBack} />
    : <NotificationList key={listKey} onCompose={() => setView('compose')} />;
}
