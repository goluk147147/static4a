import { useMemo, useRef, useState } from 'react';
import { sendEmailBroadcast, uploadBannerImage } from '../../lib/admin';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';

// The branded email logo (PNG — Gmail/Outlook block SVG). Shown in the preview
// so the admin sees the real header before sending.
const EMAIL_LOGO_URL = 'https://4astore.com/legacy/images/logo.png';

// Soft field caps mirror the server zod schema (title 1..160, description 1..5000).
const TITLE_MAX = 160;
const DESC_MAX = 5000;

const TARGETS: [string, string][] = [
  ['all', 'All customers / सभी ग्राहक'],
  ['customers', 'Customers only / केवल ग्राहक'],
];

/**
 * Admin "Send Email" composer — mirrors AdminNotify's compose UX. Admin fills a
 * title + description + optional image (reusing the same uploadBannerImage
 * control as Push/Banners), picks a target segment, previews the branded email,
 * and sends. The returned sent/failed/total summary is shown in a toast.
 *
 * Renders inside the 'ads'-gated /admin/email route (same permission as Push /
 * Marketing), so no extra feature flag is needed here.
 */
export default function AdminEmail() {
  const [target, setTarget] = useState<'all' | 'customers'>('all');
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

  const canSend = useMemo(
    () => !busy && title.trim().length > 0 && description.trim().length > 0,
    [busy, title, description],
  );

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
      });
      const summary = `✅ Email: ${r.sent}/${r.total} sent${r.failed ? `, ${r.failed} failed` : ''}`;
      showToast(r.message || summary, r.failed && !r.sent ? 'error' : 'success');
    } catch (err) {
      showToast(apiError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const lblStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
  const countStyle: React.CSSProperties = { fontSize: 11, color: 'var(--gray)', fontWeight: 400 };

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: '0 0 4px' }}>✉️ Send Email</h4>
        <p style={{ fontSize: 13, color: 'var(--gray)', margin: 0 }}>
          Sabhi customers ko ek branded email bhejein (title + description + optional image). Jinhone unsubscribe kiya hai unhe nahi jayega.
        </p>
      </div>

      <form onSubmit={send} style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow)', maxWidth: 560 }}>
        <div className="field">
          <label>Send to / Kise bhejein</label>
          <select value={target} onChange={(e) => setTarget(e.target.value as 'all' | 'customers')}>
            {TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

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
    </>
  );
}
