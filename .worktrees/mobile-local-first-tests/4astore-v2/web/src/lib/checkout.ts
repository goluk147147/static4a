// Ports of the original 4AStore checkout helpers (assets/js/app.js + checkout.html).
import type { CartItem, Category, Product, Settings, User } from '../types';

export interface CartTotals {
  subtotal: number;
  mrpTotal: number;
  discount: number;
  deliveryCharge: number;
  total: number;
  itemCount: number;
}

/**
 * Same rules as the original getCartTotal():
 * - discount = MRP total − selling total
 * - per-user custom delivery (set by admin) overrides the global rule
 * - otherwise free above `freeDeliveryAbove`, else `deliveryCharge`
 */
export function cartTotals(items: CartItem[], products: Product[], settings?: Settings, user?: User | null): CartTotals {
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  const subtotal = items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
  const mrpTotal = items.reduce((s, i) => {
    const mrp = Number(i.mrp ?? byId.get(i.id)?.mrp ?? i.price);
    return s + (mrp > 0 ? mrp : Number(i.price)) * i.quantity;
  }, 0);
  const discount = Math.max(0, mrpTotal - subtotal);

  let deliveryCharge: number;
  const custom = user?.custom_delivery;
  if (custom !== null && custom !== undefined && Number.isFinite(Number(custom))) {
    deliveryCharge = Number(custom); // fixed per-user fee, no free-above rule
  } else {
    const freeAbove = Number(settings?.freeDeliveryAbove ?? 500);
    deliveryCharge = subtotal === 0 || subtotal >= freeAbove ? 0 : Number(settings?.deliveryCharge ?? 10);
  }

  return {
    subtotal,
    mrpTotal,
    discount,
    deliveryCharge,
    total: subtotal + deliveryCharge,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
  };
}

/** Does the cart contain an item from an age-restricted (18+) or hidden category? */
export function cartHasAgeRestricted(items: CartItem[], products: Product[], categories: Category[]): boolean {
  const restricted = new Set(categories.filter((c) => c.age_restricted || c.hidden).map((c) => c.slug));
  if (!restricted.size) return false;
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  return items.some((i) => restricted.has(i.category || byId.get(i.id)?.category || ''));
}

// ---------------- Villages ----------------

export function getServiceableVillages(settings?: Settings): string[] {
  return String(settings?.serviceableVillages || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function villageTokens(v: string) {
  const full = v.trim();
  const m = full.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m ? { full, en: m[1].trim(), hi: m[2].trim() } : { full, en: full, hi: '' };
}

function levenshtein(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

export type VillageCheck =
  | { status: 'exact'; match: string }
  | { status: 'suggest'; match: string; typed: string }
  | { status: 'invalid' };

/** Original verifyVillage(): exact → partial → fuzzy (~40% typo tolerance). */
export function verifyVillage(input: string, villages: string[]): VillageCheck {
  const typed = (input || '').trim();
  if (!typed) return { status: 'invalid' };
  const tl = typed.toLowerCase();

  for (const v of villages) {
    const t = villageTokens(v);
    if (t.full.toLowerCase() === tl || t.en.toLowerCase() === tl || (t.hi && t.hi === typed)) {
      return { status: 'exact', match: v };
    }
  }
  for (const v of villages) {
    const t = villageTokens(v);
    const el = t.en.toLowerCase();
    if (el.includes(tl) || tl.includes(el) || (t.hi && typed.includes(t.hi))) {
      return { status: 'suggest', match: v, typed };
    }
  }
  let best: string | null = null;
  let bestDist = Infinity;
  for (const v of villages) {
    const dist = levenshtein(tl, villageTokens(v).en.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = v;
    }
  }
  if (best) {
    const tol = Math.max(2, Math.floor(villageTokens(best).en.length * 0.4));
    if (bestDist <= tol) return { status: 'suggest', match: best, typed };
  }
  return { status: 'invalid' };
}

// ---------------- Location ----------------

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------- Hindi voice guide ----------------

interface AndroidBridge {
  speak?: (text: string) => void;
}

/** Pick the most natural Hindi voice available (same intent as the app's native hi-IN voice). */
function pickHindiVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const hindi = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('hi'));
  if (!hindi.length) return undefined;
  // Prefer Google's हिन्दी voice (clearest), then any hi-IN, then any Hindi.
  return (
    hindi.find((v) => /google/i.test(v.name) && /hi/i.test(v.lang)) ||
    hindi.find((v) => v.lang === 'hi-IN') ||
    hindi[0]
  );
}

export function speakHindi(message: string) {
  const android = (window as unknown as { AndroidApp?: AndroidBridge }).AndroidApp;
  if (android?.speak) {
    try {
      android.speak(message);
      return;
    } catch {
      /* fall back to browser voice */
    }
  }
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const run = () => {
      const u = new SpeechSynthesisUtterance(message);
      u.lang = 'hi-IN';
      u.rate = 0.9; // match the app's calmer pace
      u.pitch = 1;
      u.volume = 1;
      const voice = pickHindiVoice();
      if (voice) u.voice = voice;
      window.speechSynthesis.speak(u);
    };
    // Voices load lazily in most browsers — the first call often has an empty list, which is why
    // the web voice sounded wrong/robotic. Wait for them so we actually pick the Hindi voice.
    if (window.speechSynthesis.getVoices().length === 0) {
      let done = false;
      const fire = () => { if (done) return; done = true; run(); };
      window.speechSynthesis.onvoiceschanged = fire;
      setTimeout(fire, 500); // fallback if the event never arrives
    } else {
      run();
    }
  } catch {
    /* speech not available */
  }
}

// ---------------- Images ----------------

/** Downscale + JPEG-compress a data URI (original compressImage: 1000px, q=0.7). */
export function compressImage(dataUri: string, maxSize = 1000, quality = 0.7): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > h && w > maxSize) {
        h = Math.round((h * maxSize) / w);
        w = maxSize;
      } else if (h > maxSize) {
        w = Math.round((w * maxSize) / h);
        h = maxSize;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}

/** Pull the 12-digit UTR out of OCR text (labelled first, then any 12-digit run). */
export function extractUtr(text: string): string | null {
  const labeled = text.match(/(?:UPI\s*Ref|UTR|Ref|Txn\s*ID)[^\d]*(\d{12})/i);
  if (labeled) return labeled[1];
  return text.match(/\b\d{12}\b/)?.[0] ?? null;
}
