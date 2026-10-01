import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useConfig } from '../../lib/queries';
import { saveBanners, uploadBannerImage } from '../../lib/admin';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';
import { showConfirm } from '../../store/confirm';
import type { Banner } from '../../types';
import AdminModal from './AdminModal';

type Draft = Required<Pick<Banner, 'title' | 'subtitle' | 'btnText' | 'btnLink' | 'image' | 'festival' | 'active'>> & { gradient: [string, string] };

const isUrl = (v: string) => /^https?:\/\//i.test(v);
/** Stored paths are "data/banners/x.webp" (legacy) or "/api/uploads/banners/x.webp". */
const imageSrc = (v: string) => (!v || isUrl(v) || v.startsWith('data:') || v.startsWith('/') ? v : `/${v}`);

const normalize = (b: Banner): Draft => ({
  title: b.title || '', subtitle: b.subtitle || '', btnText: b.btnText || '', btnLink: b.btnLink || '',
  gradient: Array.isArray(b.gradient) && b.gradient.length === 2 ? [b.gradient[0], b.gradient[1]] : ['#ff6600', '#ff9800'],
  image: b.image || '', festival: b.festival || '', active: b.active !== false,
});

/** Original compressBannerImage(): ≤1600×1000, WEBP (JPEG fallback), shrink until ≤900 KB. */
async function compressBannerImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('Could not read the selected image.')); });
    let w = Math.round(img.naturalWidth * Math.min(1, 1600 / img.naturalWidth, 1000 / img.naturalHeight));
    let h = Math.round((img.naturalHeight * w) / img.naturalWidth);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available');
    let type = 'image/webp';
    let quality = 0.82;
    let blob: Blob | null = null;
    for (;;) {
      canvas.width = w;
      canvas.height = h;
      if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality));
      if (type === 'image/webp' && (!blob || blob.type !== 'image/webp')) { type = 'image/jpeg'; quality = 0.82; continue; }
      if (!blob || blob.size <= 900 * 1024) break;
      if (quality > 0.5) quality = Math.max(0.5, quality - 0.12);
      else if (w > 640) { w = Math.round(w * 0.8); h = Math.round(h * 0.8); quality = 0.78; }
      else break;
    }
    if (!blob) throw new Error('Could not prepare the selected image.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const blobToDataUri = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the image'));
    r.readAsDataURL(b);
  });

function BannerPreview({ b, onClose }: { b: Draft; onClose: () => void }) {
  const bg = b.image
    ? `linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.35)), url('${imageSrc(b.image)}') center/cover no-repeat`
    : `linear-gradient(135deg,${b.gradient[0]},${b.gradient[1]})`;
  return createPortal(
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 600 }}>
        <div style={{ background: bg, borderRadius: 14, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 30, color: '#fff' }}>
          <div>
            <h1 style={{ fontSize: '1.6rem', margin: '0 0 8px' }}>{b.title}</h1>
            <p style={{ margin: 0 }}>{b.subtitle}</p>
            {b.btnText && b.btnLink && <span style={{ display: 'inline-block', marginTop: 12, padding: '10px 26px', background: '#fff', color: b.gradient[0], borderRadius: 30, fontWeight: 700, fontSize: 14 }}>{b.btnText}</span>}
          </div>
        </div>
        <button type="button" onClick={onClose} style={{ display: 'block', margin: '14px auto 0', padding: '10px 30px', background: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>Close Preview</button>
      </div>
    </div>,
    document.body
  );
}

// Port of the original Banners tab: edit a DRAFT, preview, then Publish.
export default function AdminBanners() {
  const qc = useQueryClient();
  const config = useConfig();
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [editing, setEditing] = useState<{ index: number; form: Draft; mode: 'url' | 'local' } | null>(null);
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState<Draft | null>(null);
  const [publishing, setPublishing] = useState(false);

  // Start the draft from the live banners once (later refetches must not wipe edits).
  useEffect(() => {
    if (draft === null && config.data) setDraft(config.data.banners.map(normalize));
  }, [config.data, draft]);

  if (config.isLoading || draft === null) return <p style={{ textAlign: 'center', padding: 30, color: 'var(--gray)' }}>Loading banners...</p>;
  if (config.isError) return <p style={{ textAlign: 'center', padding: 30, color: '#c62828' }}>Banners could not be loaded. {apiError(config.error)}</p>;

  const openEdit = (index: number, list = draft) => {
    const form = { ...list[index], gradient: [...list[index].gradient] as [string, string] };
    setStatus(form.image && !isUrl(form.image) ? `Stored image: ${form.image}` : 'JPG, PNG or WEBP up to 8 MB');
    setEditing({ index, form, mode: form.image && !isUrl(form.image) ? 'local' : 'url' });
  };

  function addBanner() {
    const next = [...draft!, normalize({ title: 'New Banner', subtitle: '', btnText: 'Shop Now →', btnLink: 'products.html', gradient: ['#ff6600', '#ff9800'], image: '', active: true, festival: '' })];
    setDraft(next);
    openEdit(next.length - 1, next);
  }

  async function removeBanner(i: number) {
    const ok = await showConfirm('Delete this banner from the draft?', { title: 'Delete banner', confirmText: 'Delete', danger: true });
    if (ok) setDraft(draft!.filter((_, idx) => idx !== i));
  }

  const setField = <K extends keyof Draft>(k: K, v: Draft[K]) => setEditing((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return showToast('Only PNG, JPG or WEBP images are supported.', 'error');
    if (file.size > 8 * 1024 * 1024) return showToast('Banner image must be 8 MB or smaller.', 'error');
    try {
      setStatus('Compressing image for server upload...');
      const blob = await compressBannerImage(file);
      setStatus(`Uploading optimized image (${Math.round(blob.size / 1024)} KB)...`);
      const url = await uploadBannerImage(await blobToDataUri(blob));
      setField('image', url);
      setStatus(`Uploaded to server: ${url}`);
      showToast('Banner image uploaded. Save to Draft next.', 'success');
    } catch (err) {
      setStatus('Upload failed.');
      showToast(apiError(err) || 'Banner upload failed.', 'error');
    }
  }

  function saveToDraft() {
    if (!editing) return;
    const next = [...draft!];
    next[editing.index] = { ...editing.form, image: editing.form.image.trim(), festival: editing.form.festival.trim() };
    setDraft(next);
    setEditing(null);
    showToast('Saved to draft. Click Publish to go live.', 'success');
  }

  async function publish() {
    const ok = await showConfirm('Publish these banners to the live website?', { title: 'Publish banners', confirmText: 'Publish' });
    if (!ok) return;
    setPublishing(true);
    try {
      const res = await saveBanners(draft!);
      qc.invalidateQueries({ queryKey: ['config'] });
      showToast(`🚀 Banners published! (${res.count}) Live on website.`, 'success');
    } catch (e) {
      showToast(apiError(e) || 'Publish failed', 'error');
    } finally {
      setPublishing(false);
    }
  }

  const f = editing?.form;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <p style={{ fontSize: 13, color: 'var(--gray)' }}>Homepage banners — edit, preview, then publish.</p>
        <div>
          <button type="button" onClick={addBanner} className="btn-add-product" style={{ marginRight: 6 }}>➕ Add Banner</button>
          <button type="button" onClick={publish} disabled={publishing} style={{ padding: '10px 18px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {publishing ? '⏳ Publishing…' : '🚀 Publish'}
          </button>
        </div>
      </div>
      <p style={{ fontSize: 11, color: '#e65100', marginBottom: 14 }}>⚠️ Changes are a draft until you click <strong>Publish</strong>. "Preview" dikhata hai website pe kaisa lagega.</p>

      {draft.length ? draft.map((b, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ position: 'relative', flexShrink: 0, width: 90, height: 54, borderRadius: 8, background: `linear-gradient(135deg,${b.gradient[0]},${b.gradient[1]})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, textAlign: 'center', padding: 2, overflow: 'hidden' }}>
            {b.image && <img src={imageSrc(b.image)} alt={b.title || 'Banner'} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
            <span style={{ position: 'relative', zIndex: 1, textShadow: '0 1px 3px #000' }}>{b.title.slice(0, 22)}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{b.title || '(no title)'}</div>
            <div style={{ fontSize: 11, color: 'var(--gray)' }}>{b.subtitle}</div>
            <div style={{ fontSize: 11, color: 'var(--primary)' }}>
              {b.active ? '✅ Active' : '⛔ Hidden'}{b.image ? ' · 🖼️ image' : ''}{b.btnText ? ` · 🔘 ${b.btnText}` : ''}{b.festival ? ` · 🎉 ${b.festival}` : ''}
            </div>
          </div>
          <div style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
            <button type="button" onClick={() => openEdit(i)} aria-label={`Edit banner ${i + 1}`} style={{ padding: '5px 10px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, cursor: 'pointer', marginRight: 4 }}>✏️</button>
            <button type="button" onClick={() => removeBanner(i)} aria-label={`Delete banner ${i + 1}`} style={{ padding: '5px 10px', background: '#e53935', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>🗑️</button>
          </div>
        </div>
      )) : (
        <p style={{ color: 'var(--gray)', padding: '16px 0' }}>No banners yet.</p>
      )}

      {editing && f && (
        <AdminModal onClose={() => setEditing(null)}>
          <h3 style={{ color: 'var(--primary)', marginBottom: 14 }}>🖼️ Edit Banner</h3>
          <div className="prod-form-grid">
            <div className="full"><label htmlFor="bTitle">Title</label><input id="bTitle" value={f.title} onChange={(e) => setField('title', e.target.value)} /></div>
            <div className="full"><label htmlFor="bSub">Subtitle</label><input id="bSub" value={f.subtitle} onChange={(e) => setField('subtitle', e.target.value)} /></div>
            <div><label htmlFor="bBtnText">Button Text</label><input id="bBtnText" value={f.btnText} onChange={(e) => setField('btnText', e.target.value)} /></div>
            <div><label htmlFor="bBtnLink">Button Link</label><input id="bBtnLink" value={f.btnLink} onChange={(e) => setField('btnLink', e.target.value)} /></div>
            <div><label htmlFor="bG1">Gradient Color 1</label><input id="bG1" type="color" value={f.gradient[0]} onChange={(e) => setField('gradient', [e.target.value, f.gradient[1]])} style={{ height: 40, padding: 2 }} /></div>
            <div><label htmlFor="bG2">Gradient Color 2</label><input id="bG2" type="color" value={f.gradient[1]} onChange={(e) => setField('gradient', [f.gradient[0], e.target.value])} style={{ height: 40, padding: 2 }} /></div>
            <div className="full">
              <label htmlFor="bImageMode">Banner Image Source</label>
              <select id="bImageMode" value={editing.mode} onChange={(e) => setEditing({ ...editing, mode: e.target.value as 'url' | 'local' })}>
                <option value="url">Image URL</option>
                <option value="local">Upload Local Image</option>
              </select>
            </div>
            {editing.mode === 'url' ? (
              <div className="full"><label htmlFor="bImageUrl">Background Image URL</label><input id="bImageUrl" type="url" value={isUrl(f.image) ? f.image : ''} onChange={(e) => setField('image', e.target.value)} placeholder="https://..." /></div>
            ) : (
              <div className="full">
                <label htmlFor="bImageFile">Upload Local Image</label>
                <input id="bImageFile" type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} />
                <small role="status" style={{ display: 'block', marginTop: 5, color: 'var(--gray)' }}>{status}</small>
              </div>
            )}
            {f.image && (
              <div className="full" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img src={imageSrc(f.image)} alt="" style={{ width: 80, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                <button type="button" onClick={() => setField('image', '')} style={{ padding: '6px 10px', background: '#fff', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>✕ Remove image</button>
              </div>
            )}
            <div><label htmlFor="bFestival">Festival (blank = always)</label><input id="bFestival" value={f.festival} onChange={(e) => setField('festival', e.target.value)} placeholder="diwali / holi / blank" /></div>
            <div>
              <label htmlFor="bActive">Active?</label>
              <select id="bActive" value={f.active ? '1' : '0'} onChange={(e) => setField('active', e.target.value === '1')}>
                <option value="1">✅ Show</option>
                <option value="0">⛔ Hide</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setPreview(f)} style={{ flex: 1, padding: 11, background: 'var(--secondary)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>👁️ Preview</button>
            <button type="button" onClick={saveToDraft} style={{ flex: 1, padding: 11, background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>💾 Save to Draft</button>
            <button type="button" onClick={() => setEditing(null)} style={{ padding: '11px 18px', background: 'var(--gray)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Close</button>
          </div>
        </AdminModal>
      )}

      {preview && <BannerPreview b={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
