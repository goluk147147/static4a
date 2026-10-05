// Ports of the web checkout helpers (web/src/lib/checkout.ts) — identical rules.
import type { CartItem, Category, Product, Settings, User } from './types';

export interface CartTotals {
  subtotal: number;
  mrpTotal: number;
  discount: number;
  deliveryCharge: number;
  handlingCharge: number;
  total: number;
  itemCount: number;
}

/** discount = MRP total − selling total; per-user custom delivery overrides; else free above threshold. */
export function cartTotals(items: CartItem[], products: Product[], settings?: Settings, user?: User | null): CartTotals {
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  const subtotal = items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
  const mrpTotal = items.reduce((s, i) => {
    const mrp = Number(i.mrp ?? byId.get(i.id)?.mrp ?? i.price);
    return s + (mrp > 0 ? mrp : Number(i.price)) * i.quantity;
  }, 0);
  const discount = Math.max(0, mrpTotal - subtotal);

  // Delivery charge: admin can disable it entirely (deliveryChargeEnabled === false).
  // Otherwise per-user custom override, else free-above-threshold, else the flat fee.
  let deliveryCharge: number;
  const deliveryEnabled = settings?.deliveryChargeEnabled !== false; // default ON
  if (!deliveryEnabled) {
    deliveryCharge = 0;
  } else {
    const custom = user?.custom_delivery;
    if (custom !== null && custom !== undefined && Number.isFinite(Number(custom))) {
      deliveryCharge = Number(custom);
    } else {
      const freeAbove = Number(settings?.freeDeliveryAbove ?? 500);
      deliveryCharge = subtotal === 0 || subtotal >= freeAbove ? 0 : Number(settings?.deliveryCharge ?? 10);
    }
  }

  // Handling charge: a flat fee added only when the admin has enabled it (default OFF).
  const handlingCharge = settings?.handlingChargeEnabled && subtotal > 0 ? Math.max(0, Number(settings?.handlingCharge ?? 0)) : 0;

  return {
    subtotal,
    mrpTotal,
    discount,
    deliveryCharge,
    handlingCharge,
    total: subtotal + deliveryCharge + handlingCharge,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
  };
}

export function cartHasAgeRestricted(items: CartItem[], products: Product[], categories: Category[]): boolean {
  const restricted = new Set(categories.filter((c) => c.age_restricted || c.hidden).map((c) => c.slug));
  if (!restricted.size) return false;
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  return items.some((i) => restricted.has(i.category || byId.get(i.id)?.category || ''));
}

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

/** exact → partial → fuzzy (~40% typo tolerance). */
export function verifyVillage(input: string, villages: string[]): VillageCheck {
  const typed = (input || '').trim();
  if (!typed) return { status: 'invalid' };
  const tl = typed.toLowerCase();
  for (const v of villages) {
    const t = villageTokens(v);
    if (t.full.toLowerCase() === tl || t.en.toLowerCase() === tl || (t.hi && t.hi === typed)) return { status: 'exact', match: v };
  }
  for (const v of villages) {
    const t = villageTokens(v);
    const el = t.en.toLowerCase();
    if (el.includes(tl) || tl.includes(el) || (t.hi && typed.includes(t.hi))) return { status: 'suggest', match: v, typed };
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

/** Known local names → store point, else a small stable offset (web resolveDeliveryCoordinates). */
export function resolveDeliveryCoordinates(settings: Settings | undefined, address: string, city: string, pincode: string) {
  const lat = Number(settings?.storeLatitude ?? 24.580164);
  const lng = Number(settings?.storeLongitude ?? 84.114194);
  const text = `${address} ${city} ${pincode}`.toLowerCase();
  const known = ['chandargarh', 'chandragarh', 'nabinagar', 'gajana', 'gajna', 'aurangabad', 'bihar', '824301'];
  if (known.some((k) => text.includes(k))) return { lat, lng };
  const seed = text.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0);
  return {
    lat: Number((lat + ((seed % 17) - 8) / 10000).toFixed(6)),
    lng: Number((lng + ((seed % 19) - 9) / 10000).toFixed(6)),
  };
}

/** Pull the 12-digit UTR out of OCR text (labelled first, then any 12-digit run). */
export function extractUtr(text: string): string | null {
  const LABEL = /(?:UPI\s*Ref(?:erence)?|UTR|Ref(?:erence)?\s*(?:No|ID)?|Txn\s*ID|Transaction\s*ID)[^\d]*(\d{12})(?!\d)/i;
  const ANY = /(?:^|\D)(\d{12})(?!\d)/;
  // OCR sometimes splits the number ("1234 5678 9012"), so retry with digit groups joined.
  const joined = text.replace(/(\d{4})\s(?=\d{4})/g, '$1');
  for (const t of [text, joined]) {
    const labeled = t.match(LABEL);
    if (labeled) return labeled[1];
  }
  for (const t of [text, joined]) {
    const any = t.match(ANY);
    if (any) return any[1];
  }
  return null;
}

export const formatDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-';
