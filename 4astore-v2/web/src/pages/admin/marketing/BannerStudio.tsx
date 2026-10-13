import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useProducts, useSettings } from '../../../lib/queries';
import { fetchFestivals, createCampaign, updateCampaign, MarketingFestival } from '../../../lib/admin';
import { apiError } from '../../../lib/api';
import { showToast } from '../../../store/toast';
import type { Product } from '../../../types';
import { ensureCanvasFont, CANVAS_FONT_STACK } from './canvasFont';

/* ------------------------------------------------------------------ *
 * Client-side Banner / Image Studio
 * ------------------------------------------------------------------ *
 * Everything renders in the browser on an HTML <canvas> — no server
 * render, no paid service. Output downloads as PNG / JPG at the five
 * required sizes using the REAL product price/discount, the 4A logo,
 * a festival title and an editable Hindi message. Product images are
 * loaded with crossOrigin='anonymous' so the canvas is NOT tainted
 * and export (toBlob/toDataURL) works.
 * ------------------------------------------------------------------ */

const LOGO_SRC = '/legacy/images/logo.png'; // same-origin raster logo (safe for canvas export)

interface CreativeSize {
  key: string;
  label: string;
  w: number;
  h: number;
}

// The five required creative sizes.
const SIZES: CreativeSize[] = [
  { key: 'status', label: 'WhatsApp Status 1080×1920', w: 1080, h: 1920 },
  { key: 'square', label: 'Square 1080×1080', w: 1080, h: 1080 },
  { key: 'portrait', label: 'Portrait 1080×1350', w: 1080, h: 1350 },
  { key: 'website', label: 'Website 1280×720', w: 1280, h: 720 },
  { key: 'landscape', label: 'Landscape 1200×628', w: 1200, h: 628 },
];

interface Template {
  key: string;
  label: string;
  bg: string;      // background base colour
  bgEnd: string;   // gradient end colour
  accent: string;  // ribbon / price pill colour
  text: string;    // primary text colour
}

// Fixed-but-good templates (editable colours below).
const TEMPLATES: Template[] = [
  { key: 'festive', label: '🎊 Festive', bg: '#7b1fa2', bgEnd: '#e91e63', accent: '#ffc107', text: '#ffffff' },
  { key: 'fresh', label: '🌿 Fresh Green', bg: '#0b7a3b', bgEnd: '#13b85a', accent: '#ffd54f', text: '#ffffff' },
  { key: 'sale', label: '🔥 Hot Sale', bg: '#b71c1c', bgEnd: '#ff5722', accent: '#ffeb3b', text: '#ffffff' },
  { key: 'classic', label: '🏪 Classic', bg: '#102a43', bgEnd: '#1d4e89', accent: '#f0b429', text: '#ffffff' },
];

interface DraftColors {
  bg: string;
  bgEnd: string;
  accent: string;
  text: string;
}

/** Load an image with crossOrigin so the canvas stays exportable. Resolves null on failure. */
function loadImage(src: string, crossOrigin = true): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Word-wrap + auto-shrink helper. Wraps `text` to `maxWidth` at `startFont`
 * and shrinks the font until the wrapped block fits within `maxLines`, so
 * Devanagari (or any) text never overflows the creative width.
 * Returns the chosen lines and font size.
 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startFont: number,
  minFont: number,
  maxLines: number,
  weight: number,
): { lines: string[]; font: number } {
  let font = startFont;
  const build = (f: number): string[] => {
    ctx.font = `${weight} ${f}px ${CANVAS_FONT_STACK}`;
    const lines: string[] = [];
    for (const paragraph of String(text).split('\n')) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); continue; }
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width <= maxWidth || !line) {
          line = test;
        } else {
          lines.push(line);
          line = word;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  };
  let lines = build(font);
  while (lines.length > maxLines && font > minFont) {
    font -= 2;
    lines = build(font);
  }
  // Hard clamp: if still too many lines at the minimum, truncate with an ellipsis.
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines[maxLines - 1];
    ctx.font = `${weight} ${font}px ${CANVAS_FONT_STACK}`;
    let truncated = last;
    while (truncated && ctx.measureText(`${truncated}…`).width > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    lines[maxLines - 1] = `${truncated}…`;
  }
  return { lines, font };
}

/** Rounded-rectangle path helper. */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export default function BannerStudio() {
  const products = useProducts().data ?? [];
  const settings = useSettings().data;
  const hideMrp = !!settings?.hideMrp;
  const [festivals, setFestivals] = useState<MarketingFestival[]>([]);

  const [productId, setProductId] = useState<string>('');
  const [sizeKey, setSizeKey] = useState<string>('status');
  const [templateKey, setTemplateKey] = useState<string>('festive');
  const [festivalSlug, setFestivalSlug] = useState<string>('');
  const [titleText, setTitleText] = useState<string>('महा बचत ऑफर');
  const [messageText, setMessageText] = useState<string>('आज ही ऑर्डर करें — घर बैठे तेज़ डिलीवरी!');
  const [colors, setColors] = useState<DraftColors>(() => pickColors('festive'));
  const [fontReady, setFontReady] = useState(false);
  const [imgWarn, setImgWarn] = useState(false);
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Cache loaded images so we don't re-fetch on every redraw.
  const logoRef = useRef<HTMLImageElement | null>(null);
  const productImgRef = useRef<{ src: string; img: HTMLImageElement | null }>({ src: '', img: null });

  const size = useMemo(() => SIZES.find((s) => s.key === sizeKey) || SIZES[0], [sizeKey]);
  const product = useMemo<Product | null>(
    () => products.find((p) => String(p.id) === productId) || null,
    [products, productId],
  );
  const festival = useMemo<MarketingFestival | null>(
    () => festivals.find((f) => f.slug === festivalSlug) || null,
    [festivals, festivalSlug],
  );

  function pickColorsAndSet(key: string) {
    setTemplateKey(key);
    setColors(pickColors(key));
  }

  // Load festivals (best-effort; the Studio works without them).
  useEffect(() => {
    let alive = true;
    fetchFestivals().then((f) => { if (alive) setFestivals(f); }).catch(() => { /* optional */ });
    return () => { alive = false; };
  }, []);

  // Preload the Devanagari web font before the first draw.
  useEffect(() => {
    let alive = true;
    ensureCanvasFont().then(() => { if (alive) setFontReady(true); });
    return () => { alive = false; };
  }, []);

  /** The full draw routine. Returns true when it painted with an exportable (untainted) canvas. */
  const draw = useCallback(async (): Promise<boolean> => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    canvas.width = size.w;
    canvas.height = size.h;
    const { w, h } = size;
    const pad = Math.round(w * 0.07);

    // Ensure font is ready so Devanagari paints correctly on the first frame.
    await ensureCanvasFont();

    // --- Background gradient ---
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, colors.bg);
    grad.addColorStop(1, colors.bgEnd);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle darkening vignette at the bottom for text legibility.
    const vg = ctx.createLinearGradient(0, h * 0.45, 0, h);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    let exportable = true;

    // --- Product image (crossOrigin so the canvas isn't tainted) ---
    const imgSrc = product?.image || '';
    if (imgSrc) {
      if (productImgRef.current.src !== imgSrc) {
        const loaded = await loadImage(imgSrc, true);
        productImgRef.current = { src: imgSrc, img: loaded };
      }
      const pimg = productImgRef.current.img;
      if (pimg) {
        // Fit the product image into a centred rounded card in the upper area.
        const boxW = w - pad * 2;
        const boxTop = Math.round(h * 0.16);
        const boxH = Math.round(h * 0.42);
        const scale = Math.min(boxW / pimg.width, boxH / pimg.height);
        const dw = Math.round(pimg.width * scale);
        const dh = Math.round(pimg.height * scale);
        const dx = Math.round((w - dw) / 2);
        const dy = Math.round(boxTop + (boxH - dh) / 2);
        ctx.save();
        roundRect(ctx, dx - 16, dy - 16, dw + 32, dh + 32, 28);
        ctx.fillStyle = 'rgba(255,255,255,0.96)';
        ctx.fill();
        ctx.clip();
        try {
          ctx.drawImage(pimg, dx, dy, dw, dh);
        } catch {
          exportable = false;
        }
        ctx.restore();
      } else {
        // Image failed to load cross-origin — mark export risk and show placeholder.
        exportable = false;
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // --- Festival title ribbon (top) ---
    const festLabel = festival ? `${festival.emoji ? festival.emoji + ' ' : ''}${festival.name}` : '';
    if (festLabel) {
      const fFit = fitText(ctx, festLabel, w - pad * 2, Math.round(w * 0.05), 20, 1, 700);
      ctx.font = `700 ${fFit.font}px ${CANVAS_FONT_STACK}`;
      const tw = ctx.measureText(fFit.lines[0]).width;
      const ribbonH = fFit.font + 24;
      const ribbonW = Math.min(w - pad, tw + 64);
      roundRect(ctx, (w - ribbonW) / 2, pad * 0.5, ribbonW, ribbonH, ribbonH / 2);
      ctx.fillStyle = colors.accent;
      ctx.fill();
      ctx.fillStyle = contrastColor(colors.accent);
      ctx.fillText(fFit.lines[0], w / 2, pad * 0.5 + 12);
    }

    // --- Headline title (editable, Devanagari-safe) ---
    let y = Math.round(h * 0.62);
    if (titleText.trim()) {
      const tFit = fitText(ctx, titleText, w - pad * 2, Math.round(w * 0.085), 28, 2, 700);
      ctx.font = `700 ${tFit.font}px ${CANVAS_FONT_STACK}`;
      ctx.fillStyle = colors.text;
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 8;
      const lh = tFit.font * 1.18;
      for (const line of tFit.lines) { ctx.fillText(line, w / 2, y); y += lh; }
      ctx.shadowBlur = 0;
      y += Math.round(h * 0.01);
    }

    // --- Message (editable, Devanagari-safe) ---
    if (messageText.trim()) {
      const mFit = fitText(ctx, messageText, w - pad * 2, Math.round(w * 0.05), 18, 3, 400);
      ctx.font = `400 ${mFit.font}px ${CANVAS_FONT_STACK}`;
      ctx.fillStyle = colors.text;
      const lh = mFit.font * 1.25;
      for (const line of mFit.lines) { ctx.fillText(line, w / 2, y); y += lh; }
      y += Math.round(h * 0.015);
    }

    // --- REAL price / discount pill (only when valid) ---
    if (product) {
      const showMrp = !hideMrp && product.mrp > product.price;
      const hasDiscount = product.discount > 0 && showMrp;
      const priceMain = `₹${product.price}`;
      const sub = hasDiscount
        ? `MRP ₹${product.mrp} • ${product.discount}% OFF`
        : (showMrp ? `MRP ₹${product.mrp}` : '');

      const priceFont = Math.round(w * 0.075);
      ctx.font = `700 ${priceFont}px ${CANVAS_FONT_STACK}`;
      const pMainW = ctx.measureText(priceMain).width;
      const subFont = Math.round(w * 0.035);
      ctx.font = `700 ${subFont}px ${CANVAS_FONT_STACK}`;
      const pSubW = sub ? ctx.measureText(sub).width : 0;
      const pillW = Math.min(w - pad, Math.max(pMainW, pSubW) + 80);
      const pillH = priceFont + (sub ? subFont + 28 : 24);
      roundRect(ctx, (w - pillW) / 2, y, pillW, pillH, 24);
      ctx.fillStyle = colors.accent;
      ctx.fill();
      const pillText = contrastColor(colors.accent);
      ctx.fillStyle = pillText;
      ctx.font = `700 ${priceFont}px ${CANVAS_FONT_STACK}`;
      ctx.fillText(priceMain, w / 2, y + 10);
      if (sub) {
        ctx.font = `700 ${subFont}px ${CANVAS_FONT_STACK}`;
        ctx.fillText(sub, w / 2, y + 10 + priceFont + 4);
      }
      y += pillH + Math.round(h * 0.015);

      // Product name under the pill.
      const nFit = fitText(ctx, product.name, w - pad * 2, Math.round(w * 0.045), 16, 2, 700);
      ctx.font = `700 ${nFit.font}px ${CANVAS_FONT_STACK}`;
      ctx.fillStyle = colors.text;
      const lh = nFit.font * 1.15;
      for (const line of nFit.lines) { ctx.fillText(line, w / 2, y); y += lh; }
    }

    // --- 4A logo (bottom-left) + brand text (bottom-right) ---
    const logo = logoRef.current;
    const logoH = Math.round(h * 0.06);
    const by = h - pad * 0.65 - logoH;
    if (logo) {
      const ratio = logo.width / logo.height || 1;
      const logoW = Math.round(logoH * ratio);
      try { ctx.drawImage(logo, pad * 0.6, by, logoW, logoH); } catch { /* logo is same-origin; ignore */ }
    }
    ctx.textAlign = 'right';
    ctx.font = `700 ${Math.round(w * 0.032)}px ${CANVAS_FONT_STACK}`;
    ctx.fillStyle = colors.text;
    ctx.fillText('4A Store', w - pad * 0.6, by + logoH * 0.1);
    if (settings?.storePhone) {
      ctx.font = `400 ${Math.round(w * 0.024)}px ${CANVAS_FONT_STACK}`;
      ctx.fillText(`📞 ${settings.storePhone}`, w - pad * 0.6, by + logoH * 0.1 + Math.round(w * 0.038));
    }
    ctx.textAlign = 'center';

    setImgWarn(!exportable);
    return exportable;
  }, [size, colors, product, hideMrp, festival, titleText, messageText, settings]);

  // Keep a stable ref to the latest draw fn for the async logo loader callback.
  const drawRef = useRef<typeof draw>();
  drawRef.current = draw;

  // Preload the (same-origin) logo once, then redraw so it appears.
  useEffect(() => {
    let alive = true;
    loadImage(LOGO_SRC, false).then((img) => {
      if (!alive) return;
      logoRef.current = img;
      void drawRef.current?.();
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw whenever inputs change (and once the font is ready).
  useEffect(() => {
    void draw();
  }, [draw, fontReady]);

  // Record a banner download against a campaign counter (best-effort, non-blocking).
  async function recordDownload(fmt: string) {
    try {
      const c = await createCampaign({
        name: `Banner — ${size.label} (${fmt.toUpperCase()})`,
        category: 'banner',
        product_ids: product ? [product.id] : [],
        message: [titleText, messageText].filter(Boolean).join('\n'),
        status: 'prepared',
        notes: `Client-side ${fmt.toUpperCase()} banner at ${size.w}×${size.h}${product ? ` for "${product.name}"` : ''}.`,
      });
      await updateCampaign(c.id, { increments: { banners_downloaded: 1 } });
    } catch { /* counter is best-effort */ }
  }

  async function download(fmt: 'png' | 'jpg') {
    setBusy(true);
    try {
      const exportable = await draw();
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!exportable) {
        showToast('Product image CORS block — image is skipped so the file still exports. Use a product with a same-origin/CORS-enabled image.', 'error');
      }
      const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
      const safeName = `4astore-${size.key}-${(product?.name || titleText || 'banner').replace(/[^\w]+/g, '-').slice(0, 40) || 'banner'}.${fmt}`;
      const finish = (href: string, revoke?: () => void) => {
        const a = document.createElement('a');
        a.href = href;
        a.download = safeName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (revoke) revoke();
        showToast(`✅ ${fmt.toUpperCase()} downloaded`, 'success');
        void recordDownload(fmt);
      };
      // Prefer toBlob (memory-friendly for large canvases); fall back to data URL.
      if (canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (!blob) { showToast('Export failed', 'error'); return; }
          const url = URL.createObjectURL(blob);
          finish(url, () => setTimeout(() => URL.revokeObjectURL(url), 2000));
        }, mime, fmt === 'jpg' ? 0.92 : undefined);
      } else {
        finish(canvas.toDataURL(mime, fmt === 'jpg' ? 0.92 : undefined));
      }
    } catch (err) {
      showToast(apiError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Preview is scaled down to fit the panel while the canvas stays full-res.
  const previewMaxW = 300;
  const scale = Math.min(1, previewMaxW / size.w);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ background: '#eef6ff', border: '1px solid #bcdcff', borderRadius: 12, padding: 14 }}>
        <strong style={{ color: '#1e40af', fontSize: 13 }}>🎨 Banner / Image Studio — 100% FREE (browser me banta hai)</strong>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#1e40af' }}>
          Product chunein, template + colour + Hindi text set karein, aur PNG/JPG download karein. Koi server render / paid tool nahi.
          Price/discount asli product se aata hai — invent nahi hota.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* ---------- Controls ---------- */}
        <div style={{ flex: 1, minWidth: 300, display: 'grid', gap: 14 }}>
          <div style={card}>
            <strong style={cardTitle}>1️⃣ Product + size</strong>
            <div style={{ marginTop: 10 }}>
              <label style={lbl}>Product / प्रोडक्ट</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} style={inp}>
                <option value="">— none (text-only banner) —</option>
                {products.map((p) => <option key={p.id} value={String(p.id)}>{p.name} — ₹{p.price}</option>)}
              </select>
              {product && (
                <p style={{ ...muted, margin: '6px 0 0' }}>
                  Real price: ₹{product.price}
                  {!hideMrp && product.mrp > product.price ? ` • MRP ₹${product.mrp}${product.discount > 0 ? ` • ${product.discount}% off` : ''}` : ''}
                  {!product.in_stock ? ' • ❌ out of stock' : ''}
                </p>
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={lbl}>Size / आकार</label>
              <select value={sizeKey} onChange={(e) => setSizeKey(e.target.value)} style={inp}>
                {SIZES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={lbl}>Festival title (optional)</label>
              <select value={festivalSlug} onChange={(e) => setFestivalSlug(e.target.value)} style={inp}>
                <option value="">— none —</option>
                {festivals.map((f) => <option key={f.id} value={f.slug}>{f.emoji ? `${f.emoji} ` : ''}{f.name}</option>)}
              </select>
            </div>
          </div>

          <div style={card}>
            <strong style={cardTitle}>2️⃣ Template</strong>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => pickColorsAndSet(t.key)}
                  style={{
                    ...btnChip,
                    background: templateKey === t.key ? 'var(--primary)' : 'var(--primary-light)',
                    color: templateKey === t.key ? '#fff' : 'var(--primary-dark)',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
              <ColorField label="Background" value={colors.bg} onChange={(v) => setColors({ ...colors, bg: v })} />
              <ColorField label="Gradient end" value={colors.bgEnd} onChange={(v) => setColors({ ...colors, bgEnd: v })} />
              <ColorField label="Accent" value={colors.accent} onChange={(v) => setColors({ ...colors, accent: v })} />
              <ColorField label="Text" value={colors.text} onChange={(v) => setColors({ ...colors, text: v })} />
            </div>
          </div>

          <div style={card}>
            <strong style={cardTitle}>3️⃣ Text (Hindi / English)</strong>
            <div style={{ marginTop: 10 }}>
              <label style={lbl}>Title / शीर्षक</label>
              <input value={titleText} onChange={(e) => setTitleText(e.target.value)} style={inp} placeholder="महा बचत ऑफर" />
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={lbl}>Message / संदेश</label>
              <textarea rows={3} value={messageText} onChange={(e) => setMessageText(e.target.value)}
                style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} placeholder="आज ही ऑर्डर करें…" />
            </div>
            <p style={{ ...muted, margin: '8px 0 0' }}>
              Hindi (देवनागरी) text auto wrap + shrink hota hai taaki overflow na ho.
              {!fontReady && ' Font load ho raha hai…'}
            </p>
          </div>
        </div>

        {/* ---------- Preview + download ---------- */}
        <div style={{ ...card, width: previewMaxW + 32, flexShrink: 0, position: 'sticky', top: 12 }}>
          <strong style={cardTitle}>📱 Mobile preview</strong>
          <div style={{
            marginTop: 10, display: 'flex', justifyContent: 'center',
            background: '#0f172a', borderRadius: 12, padding: 10,
          }}>
            <div style={{ width: size.w * scale, height: size.h * scale, overflow: 'hidden', borderRadius: 8 }}>
              <canvas
                ref={canvasRef}
                style={{ width: size.w * scale, height: size.h * scale, display: 'block' }}
              />
            </div>
          </div>
          {imgWarn && (
            <p style={{ ...muted, color: '#b45309', margin: '8px 0 0', fontSize: 11 }}>
              ⚠️ Product image CORS-blocked — download me image skip hogi (baaki banner export hota hai).
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" onClick={() => download('png')} disabled={busy} style={{ ...btnPrimary, flex: 1 }}>⬇️ PNG</button>
            <button type="button" onClick={() => download('jpg')} disabled={busy} style={{ ...btnWa, flex: 1 }}>⬇️ JPG</button>
          </div>
          <p style={{ ...muted, margin: '8px 0 0', fontSize: 11, textAlign: 'center' }}>
            {size.w}×{size.h}px • WhatsApp / web ready
          </p>
        </div>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--primary-dark)' }}>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: 48, height: 32, padding: 0, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }} />
    </label>
  );
}

/** Default colour set for a template key. */
function pickColors(key: string): DraftColors {
  const t = TEMPLATES.find((x) => x.key === key) || TEMPLATES[0];
  return { bg: t.bg, bgEnd: t.bgEnd, accent: t.accent, text: t.text };
}

/** Choose black or white text for best contrast against a hex background. */
function contrastColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#000000';
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255, g = (int >> 8) & 255, b = int & 255;
  // Relative luminance (sRGB).
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111111' : '#ffffff';
}

/* ---------- shared styles (match AdminMarketing look) ---------- */
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--primary-dark)', marginBottom: 4 };
const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '2px solid var(--border)', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { padding: '10px 18px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' };
const btnWa: React.CSSProperties = { padding: '10px 14px', background: '#25D366', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' };
const btnChip: React.CSSProperties = { padding: '8px 14px', background: 'var(--primary-light)', color: 'var(--primary-dark)', border: '1px solid var(--border)', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow)' };
const cardTitle: React.CSSProperties = { fontSize: 14, color: 'var(--primary-dark)', display: 'block' };
const muted: React.CSSProperties = { fontSize: 12, color: 'var(--gray)' };
