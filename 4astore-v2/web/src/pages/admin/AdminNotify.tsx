import { useMemo, useRef, useState } from 'react';
import { sendBroadcast, uploadBannerImage } from '../../lib/admin';
import { apiError } from '../../lib/api';
import { useConfig, useProducts } from '../../lib/queries';
import { isFeatureOn } from '../../lib/features';
import EmojiPicker from '../../components/EmojiPicker';

// Push payload soft limits — keep titles/bodies within what FCM shows on a
// notification shade so the message is not silently truncated on the device.
const TITLE_MAX = 65;
const BODY_MAX = 240;

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

export default function AdminNotify() {
  const features = useConfig().data?.features;
  const enabled = isFeatureOn(features, 'bulkPushEnabled');
  const products = useProducts().data ?? [];

  const [target, setTarget] = useState('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [image, setImage] = useState('');
  const [productId, setProductId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Which field the emoji should insert into (last focused composer field).
  const [active, setActive] = useState<'title' | 'body'>('body');

  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Picking a product sets a /product/<id> deep link and auto-fills the image
  // from that product (unless the admin already typed an image URL).
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
    if (fileRef.current) fileRef.current.value = ''; // allow re-selecting the same file
    if (!file) return;
    setUploading(true);
    setMsg(null);
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
      setMsg({ kind: 'err', text: apiError(err) });
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
    setMsg(null);
    try {
      // Send plain text + emoji only — push payloads can't carry HTML.
      const r = await sendBroadcast(target, title.trim(), body.trim(), link.trim() || undefined, image.trim() || undefined, productId.trim() || undefined);
      setMsg({ kind: 'ok', text: r.message || 'Notification sent' });
      setTitle('');
      setBody('');
      setLink('');
      setImage('');
      setProductId('');
    } catch (err) {
      setMsg({ kind: 'err', text: apiError(err) });
    } finally {
      setBusy(false);
    }
  }

  const lbl: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
  const count: React.CSSProperties = { fontSize: 11, color: 'var(--gray)', fontWeight: 400 };

  if (!enabled) {
    return (
      <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, padding: 20, maxWidth: 520 }}>
        <h4 style={{ margin: '0 0 6px', color: '#8d5d00' }}>📣 Bulk Push (band hai)</h4>
        <p style={{ margin: 0, fontSize: 13, color: '#8d5d00' }}>
          Bulk push / broadcast abhi disabled hai. Settings → Features me "Bulk push" toggle on karein.
        </p>
      </div>
    );
  }

  return (
    <>
      {msg && (
        <div style={{ background: msg.kind === 'ok' ? '#dcfce7' : '#fee2e2', color: msg.kind === 'ok' ? '#166534' : '#b91c1c', padding: 10, borderRadius: 8, marginBottom: 12, maxWidth: 520 }}>
          {msg.text}
        </div>
      )}
      <form onSubmit={send} style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow)', maxWidth: 520 }}>
        <h4 style={{ margin: '0 0 4px' }}>📣 Bulk Push / Broadcast</h4>
        <p style={{ fontSize: 12, color: 'var(--gray)', margin: '0 0 16px' }}>Ek message sabhi (ya ek segment ke) users ko bhejein — app notification + deep link. Emoji add kar sakte hain (Hindi + English + emoji sab chalega).</p>

        <div className="field">
          <label>Send to / Kise bhejein</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <div className="field">
          <label style={lbl}><span>Title / शीर्षक</span><span style={count}>{title.length}/{TITLE_MAX}</span></label>
          <input ref={titleRef} value={title} maxLength={TITLE_MAX} onFocus={() => setActive('title')} onChange={(e) => setTitle(e.target.value)} placeholder="Aaj ka offer!" required />
        </div>

        <div className="field">
          <label style={lbl}><span>Message / संदेश</span><span style={count}>{body.length}/{BODY_MAX}</span></label>
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

        <button className="btn btn-block" disabled={!canSend}>{busy ? 'Bhej rahe hain…' : 'Send Push Notification'}</button>
      </form>
    </>
  );
}
