import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { ok } from '../utils/http';
import { mergeFeatures } from '../utils/features';
import { mergeSeoConfig, type SettingsRow } from '../seo/localSeo';

const router = Router();

// Tiny in-memory TTL cache for the two hottest public reads (/config, /settings).
// They change rarely (admin edits) yet every app launch / React-Query refetch hits
// them, so a ~10s cache removes most of their DB pressure. The cached value is the
// already-shaped response object, so the JSON body stays byte-identical and the
// same Cache-Control headers are still set on every response.
const TTL_MS = 10_000;
const ttlCache = new Map<string, { data: unknown; at: number }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = ttlCache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.data as T;
  const data = await load();
  ttlCache.set(key, { data, at: now });
  return data;
}

// Static-ish public GETs change rarely (admin edits). A short Cache-Control lets
// repeat app launches and React-Query refetches return 304 (Express computes a
// weak ETag on the JSON body) and skip the DB, removing most connection
// pressure. Only HTTP headers are added — the JSON body stays byte-identical.
const STATIC_CACHE = 'public, max-age=30';
// Keep /products fresher so admin stock/price edits appear quickly.
const PRODUCTS_CACHE = 'public, max-age=15';

// GET /api/products — public product list (hidden/age-restricted handled by category flags on the client)
router.get('/products', async (_req: Request, res: Response) => {
  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } });
  res.setHeader('Cache-Control', PRODUCTS_CACHE);
  return ok(res, { products });
});

// GET /api/products/:id
router.get('/products/:id', async (req: Request, res: Response) => {
  const product = await prisma.product.findUnique({ where: { id: BigInt(req.params.id) } }).catch(() => null);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  return ok(res, { product });
});

// GET /api/categories — public
router.get('/categories', async (_req: Request, res: Response) => {
  const categories = await prisma.category.findMany({ orderBy: { sort_order: 'asc' } });
  res.setHeader('Cache-Control', STATIC_CACHE);
  return ok(res, { categories });
});

// GET /api/settings — public subset (never leak internal-only fields)
router.get('/settings', async (_req: Request, res: Response) => {
  const publicSettings = await cached('settings', async () => {
    const s = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM settings WHERE id = 1');
    const row = s[0] || {};
    return {
      deliveryCharge: row.delivery_charge,
      freeDeliveryAbove: row.free_delivery_above,
      handlingCharge: Number(row.handling_charge ?? 0),
      // Default delivery ON / handling OFF when the toggle columns don't exist yet
      // (before charges-settings.sql has been applied on the live DB).
      deliveryChargeEnabled: row.delivery_charge_enabled == null ? true : !!row.delivery_charge_enabled,
      handlingChargeEnabled: row.handling_charge_enabled == null ? false : !!row.handling_charge_enabled,
      staffOrderAlertsEnabled: row.staff_order_alerts_enabled == null ? true : !!row.staff_order_alerts_enabled,
      upiId: row.upi_id,
      upiName: row.upi_name,
      hideMrp: !!row.hide_mrp,
      storePhone: row.store_phone,
      storeAddress: row.store_address,
      storeLatitude: row.store_latitude,
      storeLongitude: row.store_longitude,
      serviceableVillages: row.serviceable_villages,
    };
  });
  res.setHeader('Cache-Control', STATIC_CACHE);
  return ok(res, { settings: publicSettings });
});

// GET /api/config — homepage merchandising (banners, ads, festivals, social proof)
router.get('/config', async (_req: Request, res: Response) => {
  const config = await cached('config', async () => {
    const c = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM config WHERE id = 1');
    const row = c[0] || {};
    const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v ?? null);
    // SEO config needs the business defaults derived from the settings row. Tolerant
    // of the `seo` column not existing yet (ADD-only — mergeSeoConfig fills defaults).
    const settingsRows = await prisma
      .$queryRawUnsafe<SettingsRow[]>('SELECT * FROM settings WHERE id = 1')
      .catch(() => [] as SettingsRow[]);
    return {
      banners: parse(row.banners) || [],
      festivalAds: parse(row.festival_ads) || {},
      festivalCategories: parse(row.festival_categories) || {},
      ads: parse(row.ads) || [],
      socialProofMessages: parse(row.social_proof_messages) || [],
      socialProofNames: parse(row.social_proof_names) || [],
      currentFestival: row.current_festival || '',
      footer: parse(row.footer) || null, // null → web uses its built-in default footer
      // Feature flags (ADD-only; absent column → all defaults ON). Clients default
      // ON when `features` is undefined, so this is safe to ship before the SQL runs.
      features: mergeFeatures(parse(row.features)),
      // Global SEO config (ADD-only; absent column → settings-derived local defaults).
      seo: mergeSeoConfig(parse(row.seo), settingsRows[0] || null),
    };
  });
  res.setHeader('Cache-Control', STATIC_CACHE);
  return ok(res, { config });
});

// GET /api/announcement — active announcement banner
router.get('/announcement', async (_req: Request, res: Response) => {
  const a = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM announcements WHERE row_id = 1');
  const row = a[0] || {};
  res.setHeader('Cache-Control', STATIC_CACHE);
  return ok(res, {
    announcement: {
      id: row.id ?? 0,
      text: row.text ?? '',
      image: row.image ?? '',
      target: row.target ?? 'all',
      ctaText: row.cta_text ?? '',
      ctaLink: row.cta_link ?? '',
      enabled: !!row.enabled,
    },
  });
});

// GET /api/version — app update channel
router.get('/version', async (_req: Request, res: Response) => {
  const v = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM app_version WHERE id = 1');
  const row = v[0] || {};
  res.setHeader('Cache-Control', STATIC_CACHE);
  return ok(res, {
    versionCode: row.version_code ?? 1,
    versionName: row.version_name ?? '1.0.0',
    url: row.url ?? '',
    message: row.message ?? '',
    forceUpdate: !!row.force_update,
    assetVersion: row.asset_version ?? 1,
  });
});

export default router;
