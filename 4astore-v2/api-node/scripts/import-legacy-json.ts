/**
 * One-off importer: copies the ORIGINAL 4AStore catalogue from ../../data/*.json
 * (products, categories, homepage config, settings, announcement) into MySQL.
 *
 * Runs through Prisma/Node so Hindi text and emoji stay intact (no shell pipes).
 * Users and orders are NOT imported (passwords/order history need a separate,
 * reviewed migration).
 *
 * Usage (from api-node/):  npx ts-node --transpile-only scripts/import-legacy-json.ts [path-to-data-dir]
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/db';

// Optional flag: --only=ads  (import just the admin poster library)
const dirArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const dataDir = path.resolve(dirArg || path.join(__dirname, '..', '..', '..', 'data'));
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
const exists = (file: string) => fs.existsSync(path.join(dataDir, file));

interface LegacyProduct {
  id: number; name: string; brand?: string; category: string; weight?: string;
  mrp?: number; price?: number; discount?: number; image?: string; description?: string;
  features?: string[]; inStock?: boolean;
}
interface LegacyCategory {
  id: number; name: string; slug: string; icon?: string; image?: string;
  hidden?: boolean; ageRestricted?: boolean; warning?: string;
}

async function importCategories() {
  const cats = read<LegacyCategory[]>('categories.json');
  for (const [index, c] of cats.entries()) {
    const data = {
      name: c.name, slug: c.slug, icon: c.icon ?? null, image: c.image ?? null,
      hidden: !!c.hidden, age_restricted: !!c.ageRestricted, warning: c.warning ?? null, sort_order: index + 1,
    };
    await prisma.category.upsert({ where: { id: BigInt(c.id) }, create: { id: BigInt(c.id), ...data }, update: data });
  }
  return cats.length;
}

async function importProducts() {
  const items = read<LegacyProduct[]>('products.json');
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

async function importConfig() {
  const cfg = read<Record<string, unknown>>('config.json');
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

async function importSettings() {
  const s = read<Record<string, unknown>>('settings.json');
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

async function importAnnouncement() {
  if (!exists('announcement.json')) return;
  const a = read<Record<string, unknown>>('announcement.json');
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
async function importAdCreatives() {
  if (!exists('ads.json')) return 0;
  const ads = read<Array<Record<string, unknown>>>('ads.json');
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

async function main() {
  if (process.argv.includes('--only=ads')) {
    console.log(`Imported ad creatives: ${await importAdCreatives()}`);
    return;
  }
  if (!exists('products.json')) throw new Error(`No products.json in ${dataDir}`);
  console.log(`Importing from ${dataDir}`);
  await importAdCreatives();
  const categories = await importCategories();
  const products = await importProducts();
  const cfg = await importConfig();
  await importSettings();
  await importAnnouncement();
  console.log(`Done: categories=${categories} products=${products} banners=${cfg.banners} ads=${cfg.ads} (+ settings, announcement)`);
}

main()
  .catch((e) => {
    console.error('Import failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
