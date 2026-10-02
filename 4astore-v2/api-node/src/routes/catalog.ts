import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { ok } from '../utils/http';

const router = Router();

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
  const s = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM settings WHERE id = 1');
  const row = s[0] || {};
  const publicSettings = {
    deliveryCharge: row.delivery_charge,
    freeDeliveryAbove: row.free_delivery_above,
    upiId: row.upi_id,
    upiName: row.upi_name,
    hideMrp: !!row.hide_mrp,
    storePhone: row.store_phone,
    storeAddress: row.store_address,
    storeLatitude: row.store_latitude,
    storeLongitude: row.store_longitude,
    serviceableVillages: row.serviceable_villages,
  };
  res.setHeader('Cache-Control', STATIC_CACHE);
  return ok(res, { settings: publicSettings });
});

// GET /api/config — homepage merchandising (banners, ads, festivals, social proof)
router.get('/config', async (_req: Request, res: Response) => {
  const c = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM config WHERE id = 1');
  const row = c[0] || {};
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v ?? null);
  res.setHeader('Cache-Control', STATIC_CACHE);
  return ok(res, {
    config: {
      banners: parse(row.banners) || [],
      festivalAds: parse(row.festival_ads) || {},
      festivalCategories: parse(row.festival_categories) || {},
      ads: parse(row.ads) || [],
      socialProofMessages: parse(row.social_proof_messages) || [],
      socialProofNames: parse(row.social_proof_names) || [],
      currentFestival: row.current_festival || '',
      footer: parse(row.footer) || null, // null → web uses its built-in default footer
    },
  });
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
