import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError } from '../../../lib/api';
import { useProducts } from '../../../lib/queries';
import {
  fetchToday, fetchFestivals, generateVideo, previewVideo, copyText, Festival, VideoRequest, Template, MusicStyle, Colors, VideoSettings,
} from '../../../lib/videos';
import { showToast } from '../../../store/toast';
import { VIDEOS_KEY } from './VideoLibrary';

const HEX = /^#[0-9a-fA-F]{6}$/;
const TEMPLATES: [Template, string, string][] = [
  ['festival', '🪔 Festival', 'Tyohar ki badhai + offer + products + call-to-action'],
  ['daily', '🔥 Aaj ka Special', 'Deal of the day: 3–4 products, MRP vs offer price'],
  ['general', '🛒 Brand Promo', '4astore ka general promo (original video)'],
];

interface Form {
  template: Template;
  festivalId: string;
  festivalName: string;
  title: string;
  greeting: string;
  subText: string;
  offerText: string;
  couponCode: string;
  productIds: number[];
  colors: Colors;
  emojis: string;
  durationSec: 15 | 24 | 30;
  format: 'reel' | 'square' | 'both';
  musicStyle: MusicStyle;
}

const fmtDay = (ymd: string) => new Date(ymd + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export default function VideoCreate({ settings, onQueued }: { settings: VideoSettings | undefined; onQueued: () => void }) {
  const qc = useQueryClient();
  const theme = settings?.store.theme;
  const defaultColors: Colors = { primary: theme?.primary || '#ff6600', secondary: '#ff9800', accent: theme?.accent || '#d32f2f' };
  const today = useQuery({ queryKey: ['video-today'], queryFn: fetchToday, refetchInterval: 5 * 60_000 });
  const festivals = useQuery({ queryKey: ['video-festivals'], queryFn: fetchFestivals }).data ?? [];
  const products = (useProducts().data ?? []).filter((p) => p.in_stock !== false);

  const [f, setF] = useState<Form>({
    template: 'festival', festivalId: '', festivalName: '', title: '', greeting: '', subText: '', offerText: '', couponCode: '',
    productIds: [], colors: defaultColors, emojis: '', durationSec: 24, format: 'reel', musicStyle: 'festive',
  });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<'' | 'preview' | 'generate'>('');
  const [preview, setPreview] = useState<{ format: string; frames: { t: number; src: string }[]; caption: string } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  // Settings arrive after first render → sync default colours / duration once.
  useEffect(() => {
    if (!settings) return;
    setF((s) => ({ ...s, durationSec: settings.auto.durationSec, colors: s.festivalId ? s.colors : defaultColors }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  /** Selecting a festival fills its greeting/colours/emojis/offer/music (all still editable). */
  function pickFestival(id: string) {
    const fe = festivals.find((x) => x.id === id);
    setF((s) => ({
      ...s,
      festivalId: id,
      festivalName: fe?.name || s.festivalName,
      greeting: fe?.greeting || '',
      subText: fe?.subText || '',
      offerText: fe?.defaultOffer || '',
      colors: fe?.colors || defaultColors,
      emojis: (fe?.emojis || []).join(' '),
      musicStyle: fe?.musicStyle || 'festive',
      title: '',
    }));
    setPreview(null);
  }

  function setTemplate(t: Template) {
    setF((s) => ({
      ...s,
      template: t,
      musicStyle: t === 'festival' ? s.musicStyle : 'upbeat',
      ...(t !== 'festival' ? { festivalId: '', festivalName: '', greeting: t === 'daily' ? 'Aaj ka Special' : '', subText: '', emojis: '', colors: defaultColors } : {}),
    }));
    setPreview(null);
  }

  const featured = useMemo(() => products.filter((p) => p.featured).slice(0, 4).map((p) => p.id), [products]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (q ? products.filter((p) => `${p.name} ${p.brand || ''} ${p.category}`.toLowerCase().includes(q)) : products).slice(0, 60);
  }, [products, search]);

  function toggleProduct(id: number) {
    setF((s) => {
      if (s.productIds.includes(id)) return { ...s, productIds: s.productIds.filter((x) => x !== id) };
      if (s.productIds.length >= 4) {
        showToast('Maximum 4 products', 'info');
        return s;
      }
      return { ...s, productIds: [...s.productIds, id] };
    });
  }

  function buildRequest(format = f.format): VideoRequest | null {
    if (f.template === 'festival' && !f.festivalId && !f.festivalName.trim()) {
      showToast('Festival chuniye ya custom festival ka naam likhiye', 'error');
      return null;
    }
    if (![f.colors.primary, f.colors.secondary, f.colors.accent].every((c) => HEX.test(c))) {
      showToast('Colours #rrggbb format me hone chahiye', 'error');
      return null;
    }
    if (f.couponCode && !/^[A-Za-z0-9-]{1,20}$/.test(f.couponCode)) {
      showToast('Coupon code: sirf A-Z, 0-9, - (max 20)', 'error');
      return null;
    }
    return {
      template: f.template,
      ...(f.festivalId ? { festivalId: f.festivalId } : {}),
      title: f.title.trim(),
      festivalName: f.festivalName.trim(),
      greeting: f.greeting.trim(),
      subText: f.subText.trim(),
      offerText: f.offerText.trim(),
      couponCode: f.couponCode.trim().toUpperCase(),
      productIds: f.productIds,
      colors: f.colors,
      emojis: f.emojis.split(/\s+/).filter(Boolean).slice(0, 6),
      durationSec: f.durationSec,
      format,
      musicStyle: f.musicStyle,
    };
  }

  async function doPreview() {
    const req = buildRequest(f.format === 'square' ? 'square' : 'reel');
    if (!req) return;
    setBusy('preview');
    try {
      setPreview(await previewVideo(req));
    } catch (e) {
      showToast(apiError(e) || 'Preview failed', 'error');
    } finally {
      setBusy('');
    }
  }

  async function doGenerate(req: VideoRequest | null) {
    if (!req) return;
    setBusy('generate');
    try {
      const r = await generateVideo(req);
      showToast(`${r.message} — Library me progress dekhein`, 'success');
      qc.invalidateQueries({ queryKey: VIDEOS_KEY });
      onQueued();
    } catch (e) {
      showToast(apiError(e) || 'Could not queue the video', 'error');
    } finally {
      setBusy('');
    }
  }

  /** Section A one-click festival video (settings formats + featured products). */
  function quickFestival(fe: Festival) {
    const formats = settings?.auto.formats || ['reel'];
    void doGenerate({
      template: 'festival', festivalId: fe.id, productIds: featured, durationSec: settings?.auto.durationSec || 24,
      format: formats.length > 1 ? 'both' : formats[0],
      ...(fe.colors ? { colors: fe.colors } : {}), emojis: fe.emojis, musicStyle: fe.musicStyle,
    });
  }
  function quickDaily() {
    const formats = settings?.auto.formats || ['reel'];
    void doGenerate({ template: 'daily', productIds: featured, durationSec: settings?.auto.durationSec || 24, format: formats.length > 1 ? 'both' : formats[0], musicStyle: 'upbeat' });
  }

  const t = today.data;
  const chosen = f.productIds.map((id) => products.find((p) => p.id === id)).filter(Boolean);

  return (
    <>
      {/* ---------- Section A: Today ---------- */}
      <div className="va-card">
        <h4>📅 Today {t ? `— ${fmtDay(t.today)}` : ''}</h4>
        {t && t.needsVerification > 0 && (
          <div className="va-note">⚠️ {t.needsVerification} festivals ki date abhi verify nahi hui (ya khaali hai). "📅 Festival Calendar" me is saal ki sahi date daalein — tyohar ki date har saal badalti hai.</div>
        )}
        {today.isLoading && <p style={{ color: 'var(--gray)' }}>Loading...</p>}
        {t && t.upcoming.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--gray)' }}>Aaj ya agle 7 din me koi festival nahi (jinki date calendar me hai).</span>
            <button type="button" className="va-btn" disabled={!!busy} onClick={quickDaily}>🔥 Generate "Aaj ka Special"</button>
          </div>
        )}
        {t?.upcoming.map((fe) => (
          <div key={fe.id} className="va-fest" style={{ background: fe.colors ? `linear-gradient(90deg, ${fe.colors.primary}18, #fff)` : undefined }}>
            <span className="va-emo" aria-hidden="true">{fe.emojis[0] || '🎉'}</span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <strong>{fe.name}</strong>{' '}
              <span className="va-badge" style={{ background: fe.daysAway === 0 ? '#e53935' : '#0891b2' }}>{fe.daysAway === 0 ? 'Aaj!' : `${fe.daysAway} din baad`}</span>{' '}
              {!fe.dateVerified && <span className="va-badge" style={{ background: '#f59e0b' }}>date verify karein</span>}
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>{fe.date ? fmtDay(fe.date) : ''} · {fe.greeting}</div>
            </div>
            <button type="button" className="va-btn" disabled={!!busy} onClick={() => quickFestival(fe)}>🎬 Generate Festival Video</button>
            <button type="button" className="va-btn ghost" onClick={() => { setTemplate('festival'); pickFestival(fe.id); document.getElementById('va-custom')?.scrollIntoView({ behavior: 'smooth' }); }}>✏️ Customize</button>
          </div>
        ))}
      </div>

      {/* ---------- Section B: Custom video ---------- */}
      <div className="va-card" id="va-custom">
        <h4>🎨 Create Custom Video</h4>
        <div className="va-subnav" role="radiogroup" aria-label="Template">
          {TEMPLATES.map(([k, label, hint]) => (
            <button key={k} type="button" role="radio" aria-checked={f.template === k} title={hint} className={`va-pill${f.template === k ? ' active' : ''}`} onClick={() => setTemplate(k)}>{label}</button>
          ))}
        </div>

        <div className="va-grid">
          {f.template === 'festival' && (
            <>
              <div className="va-field">
                <label htmlFor="va_fest">Festival (calendar se)</label>
                <select id="va_fest" value={f.festivalId} onChange={(e) => pickFestival(e.target.value)}>
                  <option value="">— Custom festival —</option>
                  {festivals.filter((x) => x.active).map((x) => (
                    <option key={x.id} value={x.id}>{x.emojis[0] || '🎉'} {x.name}{x.date ? ` (${x.date})` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="va-field">
                <label htmlFor="va_fname">Festival name</label>
                <input id="va_fname" value={f.festivalName} maxLength={60} onChange={(e) => set('festivalName', e.target.value)} placeholder="e.g. Diwali" />
              </div>
            </>
          )}
          <div className="va-field">
            <label htmlFor="va_title">Video title (library)</label>
            <input id="va_title" value={f.title} maxLength={120} onChange={(e) => set('title', e.target.value)} placeholder="auto" />
          </div>
          {f.template !== 'general' && (
            <>
              <div className="va-field">
                <label htmlFor="va_greet">{f.template === 'daily' ? 'Heading' : 'Greeting'}</label>
                <input id="va_greet" value={f.greeting} maxLength={80} onChange={(e) => set('greeting', e.target.value)} placeholder={f.template === 'daily' ? 'Aaj ka Special' : 'Happy Diwali!'} />
                <small>Hinglish ya हिंदी dono chalega</small>
              </div>
              <div className="va-field">
                <label htmlFor="va_sub">Sub text / wishes</label>
                <input id="va_sub" value={f.subText} maxLength={140} onChange={(e) => set('subText', e.target.value)} placeholder="Deepawali ki hardik Shubhkamnayein" />
              </div>
            </>
          )}
          <div className="va-field">
            <label htmlFor="va_offer">Offer text (optional)</label>
            <input id="va_offer" value={f.offerText} maxLength={120} onChange={(e) => set('offerText', e.target.value)} placeholder="Mithai & dry fruits par 10% off" />
          </div>
          <div className="va-field">
            <label htmlFor="va_coupon">Coupon code (optional)</label>
            <input id="va_coupon" value={f.couponCode} maxLength={20} onChange={(e) => set('couponCode', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} placeholder="DIWALI50" />
          </div>
          {f.template === 'festival' && (
            <div className="va-field">
              <label htmlFor="va_emo">Emojis (space se alag, max 6)</label>
              <input id="va_emo" value={f.emojis} onChange={(e) => set('emojis', e.target.value)} placeholder="🪔 ✨ 🎆" />
            </div>
          )}
          <div className="va-field">
            <label>Colours</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['primary', 'secondary', 'accent'] as const).map((k) => (
                <input key={k} type="color" value={f.colors[k]} aria-label={`${k} colour`} title={k} onChange={(e) => set('colors', { ...f.colors, [k]: e.target.value })} style={{ width: 52, height: 38, padding: 2 }} />
              ))}
            </div>
            <small>Primary · Secondary · Accent</small>
          </div>
          <div className="va-field">
            <label htmlFor="va_dur">Duration</label>
            <select id="va_dur" value={f.durationSec} onChange={(e) => set('durationSec', Number(e.target.value) as Form['durationSec'])}>
              <option value={15}>15 sec</option>
              <option value={24}>24 sec</option>
              <option value={30}>30 sec</option>
            </select>
          </div>
          <div className="va-field">
            <label htmlFor="va_fmt">Format</label>
            <select id="va_fmt" value={f.format} onChange={(e) => set('format', e.target.value as Form['format'])}>
              <option value="reel">📱 Reel / Story (1080×1920)</option>
              <option value="square">⬛ Square post (1080×1080)</option>
              <option value="both">Both (2 videos)</option>
            </select>
          </div>
          <div className="va-field">
            <label htmlFor="va_music">Music</label>
            <select id="va_music" value={f.musicStyle} onChange={(e) => set('musicStyle', e.target.value as MusicStyle)}>
              <option value="festive">🎉 Festive</option>
              <option value="upbeat">🎵 Upbeat</option>
              <option value="calm">🌙 Calm</option>
            </select>
          </div>
        </div>

        {f.template !== 'general' && (
          <div className="va-field" style={{ marginTop: 14 }}>
            <label htmlFor="va_psearch">Featured products (max 4){f.template === 'daily' ? ' — khaali chhodein to ⭐ featured / offer wale apne aap' : ''}</label>
            <div>{chosen.map((p) => p && (
              <span key={p.id} className="va-chip">{p.name}{p.weight ? ` ${p.weight}` : ''}<button type="button" aria-label={`Remove ${p.name}`} onClick={() => toggleProduct(p.id)}>✕</button></span>
            ))}</div>
            <input id="va_psearch" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search products…" style={{ marginBottom: 6 }} />
            <div className="va-products">
              {filtered.map((p) => (
                <label key={p.id}>
                  <input type="checkbox" checked={f.productIds.includes(p.id)} onChange={() => toggleProduct(p.id)} />
                  <span style={{ flex: 1 }}>{p.featured ? '⭐ ' : ''}{p.name}{p.weight ? ` · ${p.weight}` : ''}</span>
                  <span style={{ color: 'var(--gray)', fontSize: 12 }}>{p.mrp > p.price ? <s>₹{p.mrp}</s> : null} ₹{p.price}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" className="va-btn secondary" disabled={!!busy} onClick={doPreview}>👁️ {busy === 'preview' ? 'Preview ban raha hai…' : 'Preview'}</button>
          <button type="button" className="va-btn" disabled={!!busy} onClick={() => doGenerate(buildRequest())}>🎬 {busy === 'generate' ? 'Queue ho raha hai…' : f.format === 'both' ? 'Generate Videos (Reel + Square)' : 'Generate Video'}</button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--gray)', marginTop: 6 }}>Video background me banti hai (ek time pe ek). Reel ~3–4 min, Square ~2–3 min lagti hai — tab tak aap baaki kaam kar sakte hain.</p>
      </div>

      {preview && (
        <div className="va-card">
          <h4>👁️ Preview ({preview.format === 'square' ? 'Square' : 'Reel'}) — still frames</h4>
          <div className={`va-frames${preview.format === 'square' ? ' square' : ''}`}>
            {preview.frames.map((fr) => <img key={fr.t} src={fr.src} alt={`Frame at ${fr.t}s`} />)}
          </div>
          <div className="va-field" style={{ marginTop: 12 }}>
            <label htmlFor="va_cap">Auto caption (video banne ke baad Library me edit kar sakte hain)</label>
            <textarea id="va_cap" readOnly rows={8} value={preview.caption} />
          </div>
          <button type="button" className="va-mini" style={{ marginTop: 6 }} onClick={async () => showToast((await copyText(preview.caption)) ? 'Caption copied' : 'Copy failed', 'success')}>📋 Copy caption</button>
        </div>
      )}
    </>
  );
}
