// Input validation + building RenderOptions from the DB (products, festivals, settings).
import { z } from 'zod';
import { prisma } from '../db';
import { T } from './i18n';
import type { Lang, RenderOptions, StoreProfile, VideoFormat, VideoProduct } from './types';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colour must be #rrggbb');
const line = (max: number) => z.string().trim().max(max).optional().default('');
const storeTextSchema = z.object({
  name: z.string().trim().max(40), tagline: z.string().trim().max(80), area: z.string().trim().max(80),
  address: z.string().trim().max(200), payment: z.string().trim().max(80),
});

export const colorsSchema = z.object({ primary: hex, secondary: hex, accent: hex });

/** Admin "Create Custom Video" / auto-generate request. */
export const videoRequestSchema = z.object({
  template: z.enum(['festival', 'daily', 'general']),
  festivalId: z.string().trim().regex(/^[a-z0-9-]{1,40}$/).optional(),
  title: line(120),
  festivalName: line(60),
  greeting: line(80),
  subText: line(140),
  offerText: line(120),
  couponCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{0,20}$/, 'coupon: A-Z, 0-9, - (max 20)').optional().default(''),
  productIds: z.array(z.number().int().positive()).max(4).optional().default([]),
  colors: colorsSchema.optional(),
  emojis: z.array(z.string().trim().min(1).max(16)).max(6).optional().default([]),
  durationSec: z.union([z.literal(15), z.literal(24), z.literal(30)]).optional().default(24),
  format: z.enum(['reel', 'square', 'both']).optional().default('reel'),
  musicStyle: z.enum(['festive', 'calm', 'upbeat']).optional(), // default: festival's style, else upbeat
  lang: z.enum(['hinglish', 'hindi', 'english']).optional(), // default: settings.auto.lang
});
export const langSchema = z.enum(['hinglish', 'hindi', 'english']);
export type VideoRequest = z.infer<typeof videoRequestSchema>;

// ---- Settings (config.video_settings) ----
export const settingsSchema = z.object({
  store: z.object({
    name: z.string().trim().min(1).max(40),
    tagline: z.string().trim().max(80),
    phone: z.string().trim().regex(/^[0-9+ -]{6,20}$/),
    whatsapp: z.string().trim().regex(/^[0-9+ -]{6,20}$/),
    address: z.string().trim().max(200),
    area: z.string().trim().max(80),
    deliveryCharge: z.number().int().min(0).max(10000),
    freeAbove: z.number().int().min(0).max(1000000),
    payment: z.string().trim().max(80),
    theme: z.object({ primary: hex, dark: hex, light: hex, accent: hex, ink: hex }),
    // Per-language overrides (blank = use the main value above, which is Hinglish/Roman).
    i18n: z.object({ hindi: storeTextSchema, english: storeTextSchema }),
  }),
  auto: z.object({
    enabled: z.boolean(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), // IST HH:MM
    leadDays: z.number().int().min(0).max(7), // 0 = only on the festival day, 1 = from the day before…
    formats: z.array(z.enum(['reel', 'square'])).min(1),
    durationSec: z.union([z.literal(15), z.literal(24), z.literal(30)]),
    keepLast: z.number().int().min(1).max(500),
    notify: z.boolean(),
    lang: langSchema, // language for auto videos + default in the Create form
  }),
});
export type VideoSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: VideoSettings = {
  store: {
    name: '4astore',
    tagline: 'Aapka Apna Grocery Store',
    phone: '82108 74123',
    whatsapp: '82108 74123',
    address: 'Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301',
    area: 'Nabinagar, Aurangabad (Bihar)',
    deliveryCharge: 30,
    freeAbove: 500,
    payment: 'UPI (GPay/PhonePe/Paytm)',
    theme: { primary: '#ff6600', dark: '#e55b00', light: '#fff3e0', accent: '#d32f2f', ink: '#1a1a2e' },
    i18n: {
      hindi: { name: '', tagline: 'आपका अपना किराना स्टोर', area: 'नबीनगर, औरंगाबाद (बिहार)', address: 'गजना रोड, चंद्रगढ़, नबीनगर, औरंगाबाद, बिहार – 824301', payment: 'UPI (GPay / PhonePe / Paytm)' },
      english: { name: '', tagline: 'Your Own Grocery Store', area: '', address: '', payment: '' },
    },
  },
  auto: { enabled: false, time: '06:00', leadDays: 0, formats: ['reel'], durationSec: 24, keepLast: 30, notify: true, lang: 'hinglish' },
};

export async function getVideoSettings(): Promise<VideoSettings> {
  const row = (await prisma.$queryRawUnsafe<Array<{ video_settings: unknown }>>('SELECT video_settings FROM config WHERE id = 1'))[0];
  const raw = row?.video_settings;
  const saved = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<VideoSettings> | null;
  const merged = {
    store: {
      ...DEFAULT_SETTINGS.store, ...(saved?.store || {}),
      theme: { ...DEFAULT_SETTINGS.store.theme, ...(saved?.store?.theme || {}) },
      i18n: {
        hindi: { ...DEFAULT_SETTINGS.store.i18n.hindi, ...(saved?.store?.i18n?.hindi || {}) },
        english: { ...DEFAULT_SETTINGS.store.i18n.english, ...(saved?.store?.i18n?.english || {}) },
      },
    },
    auto: { ...DEFAULT_SETTINGS.auto, ...(saved?.auto || {}) },
  };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveVideoSettings(s: VideoSettings) {
  await prisma.$executeRawUnsafe('UPDATE config SET video_settings = ? WHERE id = 1', JSON.stringify(s));
}

// ---- Festivals ----
export interface FestivalRow {
  id: string; name: string; date: Date | string | null; date_verified: number | boolean; greeting: string; sub_text: string;
  emojis: unknown; colors: unknown; music_style: string; default_offer: string; active: number | boolean; translations?: unknown;
}
/** Per-language festival text; blank fields fall back to the main (Hinglish) value. */
export interface FestivalText { name: string; greeting: string; subText: string; defaultOffer: string }
export type FestivalTranslations = { hindi: FestivalText; english: FestivalText };
const emptyText = (): FestivalText => ({ name: '', greeting: '', subText: '', defaultOffer: '' });
const j = <T>(v: unknown, d: T): T => {
  if (v == null) return d;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return d; } }
  return v as T;
};
/** DATE column → "YYYY-MM-DD" without timezone shifting. */
const ymd = (d: Date | string | null) => {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10); // Prisma returns DATE columns as UTC midnight
};
export const toFestival = (r: FestivalRow) => ({
  id: r.id,
  name: r.name,
  date: ymd(r.date),
  dateVerified: !!r.date_verified,
  greeting: r.greeting,
  subText: r.sub_text,
  emojis: j<string[]>(r.emojis, []),
  colors: j<{ primary: string; secondary: string; accent: string } | null>(r.colors, null),
  musicStyle: r.music_style,
  defaultOffer: r.default_offer,
  active: !!r.active,
  translations: ((): FestivalTranslations => {
    const t = j<Partial<FestivalTranslations>>(r.translations, {});
    return { hindi: { ...emptyText(), ...(t.hindi || {}) }, english: { ...emptyText(), ...(t.english || {}) } };
  })(),
});

/** Festival text in the requested language (Hinglish = main columns). */
export function festivalText(f: Festival, lang: Lang): FestivalText {
  const base = { name: f.name, greeting: f.greeting, subText: f.subText, defaultOffer: f.defaultOffer };
  if (lang === 'hinglish') return base;
  const tr = f.translations[lang];
  return {
    name: tr.name || base.name,
    greeting: tr.greeting || base.greeting,
    subText: tr.subText || base.subText,
    defaultOffer: tr.defaultOffer || base.defaultOffer,
  };
}

/** Store details for one language (blank overrides → main values). */
export function localStore(store: VideoSettings['store'], lang: Lang): StoreProfile {
  if (lang === 'hinglish') return store;
  const o = store.i18n[lang];
  return {
    ...store,
    name: o.name || store.name,
    tagline: o.tagline || store.tagline,
    area: o.area || store.area,
    address: o.address || store.address,
    payment: o.payment || store.payment,
  };
}
export type Festival = ReturnType<typeof toFestival>;

export async function getFestival(id: string): Promise<Festival | null> {
  const rows = await prisma.$queryRawUnsafe<FestivalRow[]>('SELECT * FROM festivals WHERE id = ?', id);
  return rows[0] ? toFestival(rows[0]) : null;
}

// ---- Products ----
async function categoryEmojis(): Promise<Map<string, string>> {
  const cats = await prisma.category.findMany({ select: { slug: true, icon: true } });
  return new Map(cats.map((c) => [c.slug, c.icon || '🛍️']));
}

const toVideoProduct = (p: { id: bigint; name: string; weight: string | null; price: unknown; mrp: unknown; image: string | null; category: string }, emo: Map<string, string>): VideoProduct => ({
  id: Number(p.id),
  name: p.name,
  weight: p.weight || '',
  price: Number(p.price) || 0,
  mrp: Number(p.mrp) || 0,
  image: p.image || '',
  emoji: emo.get(p.category) || '🛍️',
});

export async function productsByIds(ids: number[]): Promise<VideoProduct[]> {
  if (!ids.length) return [];
  const [rows, emo] = await Promise.all([prisma.product.findMany({ where: { id: { in: ids.map((i) => BigInt(i)) } } }), categoryEmojis()]);
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  return ids.map((i) => byId.get(i)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => toVideoProduct(r, emo));
}

/** Daily deal picks: featured → biggest discount → random in-stock. */
export async function pickDailyProducts(count = 4): Promise<VideoProduct[]> {
  const [rows, emo] = await Promise.all([prisma.product.findMany({ where: { in_stock: true } }), categoryEmojis()]);
  const featured = rows.filter((r) => r.featured);
  const discounted = rows.filter((r) => !r.featured && Number(r.mrp) > Number(r.price)).sort((a, b) => b.discount - a.discount);
  const rest = rows.filter((r) => !r.featured && !(Number(r.mrp) > Number(r.price)));
  // shuffle each bucket by day so consecutive days show different deals
  const day = Math.floor(Date.now() / 86400000);
  const shuffle = <T,>(a: T[]) => a.map((v, i) => ({ v, k: Math.sin(day * 97 + i * 13.37) })).sort((x, y) => x.k - y.k).map((x) => x.v);
  const seen = new Set<string>(); // the catalogue has duplicate names (e.g. two "Aashirvaad Atta")
  return [...shuffle(featured), ...shuffle(discounted.slice(0, 12)), ...shuffle(rest)]
    .filter((r) => {
      const key = r.name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, count)
    .map((r) => toVideoProduct(r, emo));
}

/** Validated request (+ DB lookups) → RenderOptions for one format. */
export async function buildOptions(req: VideoRequest, format: VideoFormat, settings?: VideoSettings): Promise<RenderOptions> {
  const s = settings || (await getVideoSettings());
  const fest = req.festivalId ? await getFestival(req.festivalId) : null;
  const theme = s.store.theme;
  let products = await productsByIds(req.productIds);
  if (req.template === 'daily' && !products.length) products = await pickDailyProducts(4);

  const lang: Lang = req.lang || s.auto.lang || 'hinglish';
  const ft = fest ? festivalText(fest, lang) : null;
  const L = T(lang);
  const festivalName = req.festivalName || ft?.name || '';
  const colors = req.colors || fest?.colors || { primary: theme.primary, secondary: '#ff9800', accent: theme.accent };
  const title = req.title || (req.template === 'festival' ? `${festivalName || 'Festival'} Video` : req.template === 'daily' ? L.dailyTitle : `${s.store.name} Promo`);
  return {
    template: req.template,
    title,
    festivalName,
    greeting: req.greeting || ft?.greeting || (req.template === 'daily' ? L.dailyTitle : ''),
    subText: req.subText || ft?.subText || '',
    offerText: req.offerText || (req.template === 'festival' ? ft?.defaultOffer || '' : ''),
    couponCode: req.couponCode,
    featuredProducts: products,
    colors,
    emojis: req.emojis.length ? req.emojis : fest?.emojis || [],
    durationSec: req.durationSec,
    format,
    musicStyle: req.musicStyle || (fest?.musicStyle as RenderOptions['musicStyle']) || 'upbeat',
    lang,
    store: localStore(s.store, lang),
  };
}
