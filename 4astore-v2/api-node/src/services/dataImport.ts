/**
 * Shared legacy-JSON importer. ONE source of truth used by BOTH the CLI script
 * (scripts/import-legacy-json.ts) and the owner-only admin route
 * (routes/admin-data.ts). Upserts the ORIGINAL 4AStore catalogue from
 * data/*.json (products, categories, homepage config, settings, announcement,
 * ad creatives) into MySQL. Idempotent: re-running updates in place by fixed id
 * / fixed row ids — no duplicate rows.
 *
 * Also exposes seedDefaultOwner() so a fresh/emptied DB always has an owner
 * login (called on API startup and right after a factory reset).
 */
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';

/** Default data dir resolves to the repo-root `data/` folder (c:\xampp\htdocs\static4a\data). */
export const DEFAULT_DATA_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'data');

const read = <T>(dir: string, file: string): T => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const exists = (dir: string, file: string) => fs.existsSync(path.join(dir, file));

interface LegacyProduct {
  id: number; name: string; brand?: string; category: string; weight?: string;
  mrp?: number; price?: number; discount?: number; image?: string; description?: string;
  features?: string[]; inStock?: boolean;
}
interface LegacyCategory {
  id: number; name: string; slug: string; icon?: string; image?: string;
  hidden?: boolean; ageRestricted?: boolean; warning?: string;
}

export async function importCategories(dataDir = DEFAULT_DATA_DIR) {
  const cats = read<LegacyCategory[]>(dataDir, 'categories.json');
  for (const [index, c] of cats.entries()) {
    const data = {
      name: c.name, slug: c.slug, icon: c.icon ?? null, image: c.image ?? null,
      hidden: !!c.hidden, age_restricted: !!c.ageRestricted, warning: c.warning ?? null, sort_order: index + 1,
    };
    await prisma.category.upsert({ where: { id: BigInt(c.id) }, create: { id: BigInt(c.id), ...data }, update: data });
  }
  return cats.length;
}

export async function importProducts(dataDir = DEFAULT_DATA_DIR) {
  const items = read<LegacyProduct[]>(dataDir, 'products.json');
  for (const p of items) {
    const mrp = Number(p.mrp) || 0;
    const price = Number(p.price) || 0;
    const discount = p.discount !== undefined ? Math.trunc(Number(p.discount)) : mrp > 0 && price <= mrp ? Math.round(((mrp - price) / mrp) * 100) : 0;
    const data = {
      name: p.name, brand: p.brand ?? '', category: p.category, weight: p.weight ?? '',
      mrp, price, discount, image: p.image ?? '', description: p.description ?? '',
      features: Array.isArray(p.features) ? p.features : [], in_stock: p.inStock !== false,
    };
    await prisma.product.upsert({ where: { id: BigInt(p.id) }, create: { id: BigInt(p.id), ...data }, update: data });
  }
  return items.length;
}

export async function importConfig(dataDir = DEFAULT_DATA_DIR) {
  const cfg = read<Record<string, unknown>>(dataDir, 'config.json');
  const json = (v: unknown) => JSON.stringify(v ?? null);
  await prisma.$executeRawUnsafe(
    `INSERT INTO config (id, banners, festival_ads, festival_categories, ads, social_proof_messages, social_proof_names, current_festival)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE banners=VALUES(banners), festival_ads=VALUES(festival_ads), festival_categories=VALUES(festival_categories),
       ads=VALUES(ads), social_proof_messages=VALUES(social_proof_messages), social_proof_names=VALUES(social_proof_names),
       current_festival=VALUES(current_festival)`,
    json(cfg.banners ?? []), json(cfg.festivalAds ?? {}), json(cfg.festivalCategories ?? {}), json(cfg.ads ?? []),
    json(cfg.socialProofMessages ?? []), json(cfg.socialProofNames ?? []), String(cfg.currentFestival ?? '')
  );
  return { banners: (cfg.banners as unknown[] | undefined)?.length ?? 0, ads: (cfg.ads as unknown[] | undefined)?.length ?? 0 };
}

export async function importSettings(dataDir = DEFAULT_DATA_DIR) {
  const s = read<Record<string, unknown>>(dataDir, 'settings.json');
  await prisma.$executeRawUnsafe(
    `INSERT INTO settings (id, store_email, delivery_charge, free_delivery_above, upi_id, upi_name, hide_mrp, store_phone,
       store_address, store_latitude, store_longitude, serviceable_villages)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE store_email=VALUES(store_email), delivery_charge=VALUES(delivery_charge),
       free_delivery_above=VALUES(free_delivery_above), upi_id=VALUES(upi_id), upi_name=VALUES(upi_name), hide_mrp=VALUES(hide_mrp),
       store_phone=VALUES(store_phone), store_address=VALUES(store_address), store_latitude=VALUES(store_latitude),
       store_longitude=VALUES(store_longitude), serviceable_villages=VALUES(serviceable_villages)`,
    s.storeEmail ?? null, Number(s.deliveryCharge ?? 10), Number(s.freeDeliveryAbove ?? 500), s.upiId ?? null, s.upiName ?? null,
    s.hideMrp ? 1 : 0, s.storePhone ?? null, s.storeAddress ?? null, s.storeLatitude ?? null, s.storeLongitude ?? null,
    s.serviceableVillages ?? null
  );
}

export async function importAnnouncement(dataDir = DEFAULT_DATA_DIR) {
  if (!exists(dataDir, 'announcement.json')) return;
  const a = read<Record<string, unknown>>(dataDir, 'announcement.json');
  const target = ['all', 'customers', 'riders', 'admins'].includes(String(a.target)) ? String(a.target) : 'all';
  // Old links pointed at the PHP site (e.g. http://localhost/static4a/product-details?id=8) → SPA route.
  const link = String(a.ctaLink ?? '').replace(/^.*product-details(\.html)?\?id=(\d+).*$/, '/product/$2');
  await prisma.$executeRawUnsafe(
    `INSERT INTO announcements (row_id, id, text, image, target, cta_text, cta_link, enabled) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id=VALUES(id), text=VALUES(text), image=VALUES(image), target=VALUES(target),
       cta_text=VALUES(cta_text), cta_link=VALUES(cta_link), enabled=VALUES(enabled)`,
    Number(a.id ?? 0), a.text ?? '', a.image ?? '', target, a.ctaText ?? '', link, a.enabled ? 1 : 0
  );
}

// Admin "Ads & Social" poster library (data/ads.json). Keeps the original ids; re-runs update in place.
export async function importAdCreatives(dataDir = DEFAULT_DATA_DIR) {
  if (!exists(dataDir, 'ads.json')) return 0;
  const ads = read<Array<Record<string, unknown>>>(dataDir, 'ads.json');
  for (const a of ads) {
    const { id, createdAt, updatedAt, ...data } = a;
    const ts = (v: unknown) => (v ? new Date(String(v)) : new Date());
    await prisma.$executeRawUnsafe(
      `INSERT INTO ad_creatives (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE data=VALUES(data), updated_at=VALUES(updated_at)`,
      Number(id), JSON.stringify(data), ts(createdAt), ts(updatedAt)
    );
  }
  return ads.length;
}

export interface ImportSummary {
  categories: number;
  products: number;
  banners: number;
  ads: number;
  settings: true;
  announcement: true;
}

/**
 * Full idempotent import of the catalogue + config + settings + announcement +
 * ad creatives. Returns per-entity counts. Re-running updates in place.
 */
export async function runImport(dataDir = DEFAULT_DATA_DIR): Promise<ImportSummary> {
  if (!exists(dataDir, 'products.json')) throw new Error(`No products.json in ${dataDir}`);
  const ads = await importAdCreatives(dataDir);
  const categories = await importCategories(dataDir);
  const products = await importProducts(dataDir);
  const cfg = await importConfig(dataDir);
  await importSettings(dataDir);
  await importAnnouncement(dataDir);
  return { categories, products, banners: cfg.banners, ads, settings: true, announcement: true };
}

/**
 * Ensure a default OWNER login always exists. Idempotent: only creates when no
 * user matches username 'owner' OR mobile '7543888698'. Uses the SAME bcrypt
 * hashing as register/login (bcrypt.hashSync(pwd, 10)) so the owner can log in
 * via the existing /api/users/login route. Returns whether it created a row.
 */
export async function seedDefaultOwner(): Promise<boolean> {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: 'owner' }, { mobile: '7543888698' }] },
  });
  if (existing) return false;
  await prisma.user.create({
    data: {
      name: 'Owner',
      username: 'owner',
      mobile: '7543888698',
      password: bcrypt.hashSync('owner@7543', 10),
      role: 'owner',
      permissions: ['*'],
      registered_at: new Date(),
    },
  });
  // eslint-disable-next-line no-console
  console.log('[seed] default owner created');
  return true;
}
