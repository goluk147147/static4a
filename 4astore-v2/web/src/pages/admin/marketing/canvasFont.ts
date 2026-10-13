// Devanagari web-font loader for the client-side Banner Studio canvas.
//
// Hindi (Devanagari) must render correctly on <canvas>. Canvas text draws with
// whatever fonts the document has already loaded, so we must:
//   1. register an OPEN (OFL-licensed, free) Devanagari web font via the FontFace
//      API — here Noto Sans Devanagari from Google Fonts' static woff2 host,
//   2. explicitly `document.fonts.load(...)` the exact size/family we draw with,
//   3. await `document.fonts.ready` before the first draw,
// otherwise the first paint falls back to a non-Devanagari glyph set (tofu).
//
// No paid fonts are used. If the font host is unreachable (offline), we fall
// back to the system font — Devanagari still renders on devices that ship an
// Indic font; nothing is faked.

export const DEVANAGARI_FAMILY = "'Noto Sans Devanagari'";
// Latin fallback is appended so English/emoji still look right in the same string.
export const CANVAS_FONT_STACK = `${DEVANAGARI_FAMILY}, 'Segoe UI', system-ui, Arial, sans-serif`;

// Google Fonts static woff2 (OFL). Weights used by the templates: 400 + 700.
const FONT_SOURCES: { weight: number; url: string }[] = [
  { weight: 400, url: 'https://fonts.gstatic.com/s/notosansdevanagari/v26/TuGoUUFzXI5FBtUq5a8bjKYTZjtRU6Sgv3NaV_SNmI0b8QQCQmHn6B2OHjbL_08AlXQ.woff2' },
  { weight: 700, url: 'https://fonts.gstatic.com/s/notosansdevanagari/v26/TuGoUUFzXI5FBtUq5a8bjKYTZjtRU6Sgv3NaV_SNmI0b8QQCQmHn6B2OHjbL08HAlXQ.woff2' },
];

let loadPromise: Promise<void> | null = null;

/**
 * Register + load the Devanagari web font and wait until the document's fonts
 * are ready. Idempotent and best-effort: a network failure resolves (never
 * rejects) so the Studio keeps working with the system fallback font.
 */
export async function ensureCanvasFont(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      if (typeof document === 'undefined' || !('fonts' in document) || typeof FontFace === 'undefined') return;
      const name = 'Noto Sans Devanagari';
      for (const { weight, url } of FONT_SOURCES) {
        // Skip if an identical face is already registered.
        const already = Array.from(document.fonts).some(
          (f) => f.family.replace(/['"]/g, '') === name && String(f.weight) === String(weight),
        );
        if (already) continue;
        try {
          const face = new FontFace(name, `url(${url}) format('woff2')`, { weight: String(weight), style: 'normal' });
          const loaded = await face.load();
          document.fonts.add(loaded);
        } catch {
          /* one weight failing is non-fatal — fall back to system font */
        }
      }
      // Explicitly prime the sizes we draw with so the first canvas paint is correct.
      try {
        await Promise.all([
          document.fonts.load(`700 64px ${DEVANAGARI_FAMILY}`),
          document.fonts.load(`400 40px ${DEVANAGARI_FAMILY}`),
        ]);
      } catch { /* ignore */ }
      try { await document.fonts.ready; } catch { /* ignore */ }
    } catch {
      /* never throw — rendering falls back to the system font */
    }
  })();
  return loadPromise;
}
