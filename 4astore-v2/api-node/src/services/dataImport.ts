/**
 * Shared legacy-JSON importer. ONE source of truth used by BOTH the CLI script
 * (scripts/import-legacy-json.ts) and the owner-only admin route
 * (routes/admin-data.ts). Upserts the ORIGINAL 4AStore catalogue from
 * data/*.json (products, categories, homepage config, settings, announcement,
 * ad creatives) PLUS users and orders into MySQL. Idempotent: re-running
 * updates in place by fixed id / unique key — no duplicate rows.
 *
 * Users and orders ARE imported (importUsers → oldId→newId map → importOrders),
 * so a "truncate everything + reload" (admin reset then import, or the CLI)
 * restores the full legacy dataset. addresses.json is intentionally NOT
 * imported (users re-create their own addresses).
 *
 * Also exposes seedDefaultOwner() so a fresh/emptied DB always has an owner
 * login (called on API startup and right after a factory reset).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { loadFeatures } from '../seo/persist';
import { enqueueSeoJob, hasPendingCatalogueJob } from './seoQueue';
import { createShortLinkForProduct } from './shortLink';

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
    // image is a TEXT column (some legacy rows embed a 7k–15k char base64 data-URI), so any
    // length is fine. Keep a type guard only so a non-string never reaches the column.
    const image = typeof p.image === 'string' ? p.image : '';
    const data = {
      name: p.name, brand: p.brand ?? '', category: p.category, weight: p.weight ?? '',
      mrp, price, discount, image, description: p.description ?? '',
      features: Array.isArray(p.features) ? p.features : [], in_stock: p.inStock !== false,
    };
    await prisma.product.upsert({ where: { id: BigInt(p.id) }, create: { id: BigInt(p.id), ...data }, update: data });
    // Best-effort: idempotently mint each product's universal short link so bulk
    // import gets links too. Never let a link failure abort the import.
    await createShortLinkForProduct(Number(p.id)).catch(() => undefined);
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

/** Parse an ISO date string → Date, or null for falsy/invalid input. */
function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * SECURITY NOTE — DELIBERATE, OWNER-APPROVED readable-password store.
 *
 * The owner explicitly wants a plaintext copy of each customer's password kept
 * ALONGSIDE the bcrypt hash so an admin can read a rural customer their password
 * over the phone when they forget it. This is a conscious deviation from
 * best practice. `plain_password` is added as a RAW column and is intentionally
 * NOT declared in the Prisma `User` model — that way `prisma.user.find*` never
 * selects it and the existing `safeUser()` (which strips `password`) can never
 * leak it through any users/auth API. If a future dev adds it to schema.prisma,
 * they MUST also strip it in safeUser(). Keep DB access restricted and exclude
 * this column from externally-shared logs/backups.
 *
 * Idempotent + concurrency-safe: checks information_schema first and swallows
 * the MySQL duplicate-column error (1060) so re-runs never crash. Uses
 * $executeRawUnsafe — NO prisma migrate / db push.
 */
export async function ensurePlainPasswordColumn(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'plain_password'`
  );
  const present = Number(rows?.[0]?.c ?? 0) > 0;
  if (present) return;
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE users ADD COLUMN plain_password VARCHAR(255) NULL');
  } catch (e) {
    // Swallow duplicate-column (1060) in case a concurrent run added it first.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/1060|Duplicate column/i.test(msg)) throw e;
  }
}

/**
 * Ensure the `master_password_hash` column exists on the `settings` table.
 *
 * MASTER PASSWORD — OWNER-APPROVED support feature. A single bcrypt hash the
 * owner sets from the admin Settings panel; when present, that password logs
 * into ANY user account (POST /api/users/login) so support can act on a
 * customer's behalf. Null/empty = feature OFF (login unchanged). The hash is a
 * RAW column (not a Prisma field) so prisma.* never selects it, and every
 * settings GET is an explicit allow-list, so it can never leak to a client.
 *
 * Idempotent + concurrency-safe: checks information_schema first and swallows
 * the MySQL duplicate-column error (1060) so re-runs never crash. Uses
 * $executeRawUnsafe — NO prisma migrate / db push. Mirrors
 * ensurePlainPasswordColumn() and the manual prisma/master-password.sql.
 */
export async function ensureMasterPasswordColumn(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'settings' AND column_name = 'master_password_hash'`
  );
  const present = Number(rows?.[0]?.c ?? 0) > 0;
  if (present) return;
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE settings ADD COLUMN master_password_hash VARCHAR(255) NULL');
  } catch (e) {
    // Swallow duplicate-column (1060) in case a concurrent run added it first.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/1060|Duplicate column/i.test(msg)) throw e;
  }
}

/**
 * Ensure the `whatsapp_api` column exists on the `settings` table.
 *
 * WHATSAPP API CONFIG — PREP ONLY (not live). Stores the admin-configured
 * provider-agnostic WhatsApp API settings as a JSON string (provider, baseUrl,
 * access token, phone number id, enabled flag). It is a RAW column (not a Prisma
 * field) so prisma.* never selects it, and it is read/written ONLY through the
 * authenticated admin settings endpoint — it is NEVER exposed on the public
 * GET /api/settings. The free wa.me flow remains the only active send path; no
 * message is sent from this config until the dormant waSender.ts TODO is wired.
 *
 * Idempotent + concurrency-safe: checks information_schema first and swallows
 * the MySQL duplicate-column error (1060) so re-runs never crash. Uses
 * $executeRawUnsafe — NO prisma migrate / db push. Mirrors
 * ensureMasterPasswordColumn().
 */
export async function ensureWhatsappApiColumn(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'settings' AND column_name = 'whatsapp_api'`
  );
  const present = Number(rows?.[0]?.c ?? 0) > 0;
  if (present) return;
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE settings ADD COLUMN whatsapp_api TEXT NULL');
  } catch (e) {
    // Swallow duplicate-column (1060) in case a concurrent run added it first.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/1060|Duplicate column/i.test(msg)) throw e;
  }
}

/**
 * Ensure the `otp_channels` column exists on the `settings` table.
 *
 * SIGNUP OTP DELIVERY CHANNELS — admin-only. Stores the owner-chosen OTP
 * delivery policy for the mobile-only signup path as a JSON string
 * (`{ whatsapp, fcm, mode }` where mode is 'whatsapp' | 'fcm' | 'both'). It is a
 * RAW column (not a Prisma field) so prisma.* never selects it, and it is
 * read/written ONLY through the authenticated admin settings endpoint — it is
 * NEVER exposed on the public GET /api/settings. The email signup path is
 * unaffected by this setting.
 *
 * Idempotent + concurrency-safe: checks information_schema first and swallows
 * the MySQL duplicate-column error (1060) so re-runs never crash. Uses
 * $executeRawUnsafe — NO prisma migrate / db push. Mirrors
 * ensureWhatsappApiColumn() exactly.
 */
export async function ensureOtpChannelsColumn(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'settings' AND column_name = 'otp_channels'`
  );
  const present = Number(rows?.[0]?.c ?? 0) > 0;
  if (present) return;
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE settings ADD COLUMN otp_channels TEXT NULL');
  } catch (e) {
    // Swallow duplicate-column (1060) in case a concurrent run added it first.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/1060|Duplicate column/i.test(msg)) throw e;
  }
}

/**
 * Ensure the `app_version.catalog_version` column exists. This single counter
 * drives storefront/admin catalog freshness: catalog.ts emits it as the ETag on
 * GET /products + /categories, and admin.ts bumpCatalogVersion() increments it
 * after every product/category write so all clients revalidate (304) cheaply and
 * get fresh data the instant an edit happens.
 *
 * CRITICAL: without this column catalogVersion() silently falls back to a constant
 * `1`, so the ETag NEVER changes and every client is served stale cached data
 * forever (price/stock/image edits never appear). Previously this column only
 * came from the manual prisma/catalog-version.sql, which is easy to miss on a
 * deploy — hence this startup ensure. Idempotent + concurrency-safe: checks
 * information_schema first and swallows MySQL 1060. NO prisma migrate / db push.
 */
export async function ensureCatalogVersionColumn(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'app_version' AND column_name = 'catalog_version'`
  );
  const present = Number(rows?.[0]?.c ?? 0) > 0;
  if (present) return;
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE app_version ADD COLUMN catalog_version INT NOT NULL DEFAULT 1');
  } catch (e) {
    // Swallow duplicate-column (1060) in case a concurrent run added it first.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/1060|Duplicate column/i.test(msg)) throw e;
  }
}

/**
 * Ensure the notification-history tables exist. Follows the repo's no-migrate
 * convention: idempotent `CREATE TABLE IF NOT EXISTS` via $executeRawUnsafe
 * (InnoDB utf8mb4), with column types mirroring the Prisma Notification /
 * NotificationRecipient models in schema.prisma. Safe to re-run; NO prisma
 * migrate / db push. Called at startup beside seedDefaultOwner().
 */
export async function ensureNotificationTables(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS notifications (
       id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       type          VARCHAR(40)  NOT NULL,
       title         VARCHAR(255) NOT NULL,
       body          TEXT         NOT NULL,
       image         VARCHAR(500) NULL,
       link          VARCHAR(500) NULL,
       target        VARCHAR(40)  NOT NULL,
       product_id    BIGINT UNSIGNED NULL,
       order_id      VARCHAR(20)  NULL,
       sent_by       VARCHAR(64)  NULL,
       success_count INT          NOT NULL DEFAULT 0,
       failure_count INT          NOT NULL DEFAULT 0,
       created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       INDEX idx_notifications_created (created_at),
       INDEX idx_notifications_product (product_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS notification_recipients (
       id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       notification_id BIGINT UNSIGNED NOT NULL,
       user_id         BIGINT UNSIGNED NULL,
       token           VARCHAR(255) NOT NULL,
       status          VARCHAR(20)  NOT NULL,
       created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       INDEX idx_notif_recipient_notif (notification_id),
       INDEX idx_notif_recipient_user (user_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

/**
 * Ensure the Marketing Center tables + the additive users.marketing_opt_out
 * column exist. Follows the repo's no-migrate convention: idempotent
 * `CREATE TABLE IF NOT EXISTS` via $executeRawUnsafe (InnoDB utf8mb4) with
 * column types mirroring the Prisma MarketingFestival / MarketingTemplate /
 * MarketingCampaign models in schema.prisma, plus an information_schema-guarded
 * ALTER for the opt-out column (mirrors ensureMasterPasswordColumn()). Festivals
 * and templates are seeded ONLY when their table is empty; festival dates are
 * seeded NULL with needs_date_check = 1 so no wrong lunar date is ever hardcoded
 * (all data stays DB-driven). Safe to re-run; NO prisma migrate / db push.
 * Called at startup beside ensureNotificationTables(). Manual equivalent:
 * prisma/marketing.sql.
 */
export async function ensureMarketingTables(): Promise<void> {
  // --- Tables ---------------------------------------------------------------
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS marketing_festivals (
       id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       name             VARCHAR(120) NOT NULL,
       slug             VARCHAR(120) NOT NULL,
       festival_date    DATE         NULL,
       greeting_hi      VARCHAR(255) NULL,
       emoji            VARCHAR(16)  NULL,
       is_active        TINYINT(1)   NOT NULL DEFAULT 1,
       needs_date_check TINYINT(1)   NOT NULL DEFAULT 1,
       sort_order       INT          NOT NULL DEFAULT 0,
       created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       UNIQUE KEY uq_marketing_festivals_slug (slug),
       INDEX idx_marketing_festivals_date (festival_date)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS marketing_templates (
       id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       title         VARCHAR(160) NOT NULL,
       category      VARCHAR(60)  NOT NULL DEFAULT 'general',
       festival_slug VARCHAR(120) NULL,
       lang          VARCHAR(12)  NOT NULL DEFAULT 'hinglish',
       body          TEXT         NOT NULL,
       is_active     TINYINT(1)   NOT NULL DEFAULT 1,
       sort_order    INT          NOT NULL DEFAULT 0,
       created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       INDEX idx_marketing_templates_category (category)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS marketing_campaigns (
       id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       name               VARCHAR(160) NOT NULL,
       category           VARCHAR(60)  NULL,
       product_ids        JSON         NULL,
       template_id        BIGINT UNSIGNED NULL,
       customer_mobiles   JSON         NULL,
       message            TEXT         NULL,
       status             VARCHAR(24)  NOT NULL DEFAULT 'draft',
       notes              VARCHAR(500) NULL,
       share_opened       INT          NOT NULL DEFAULT 0,
       copied_count       INT          NOT NULL DEFAULT 0,
       banners_downloaded INT          NOT NULL DEFAULT 0,
       batches_prepared   INT          NOT NULL DEFAULT 0,
       created_by         VARCHAR(64)  NULL,
       created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       INDEX idx_marketing_campaigns_created (created_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // --- Additive users.marketing_opt_out column (information_schema-guarded) --
  // Mirrors ensureMasterPasswordColumn(): add only when absent, swallow the
  // MySQL duplicate-column error (1060) so re-runs never crash.
  const optOutRows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'marketing_opt_out'`
  );
  if (Number(optOutRows?.[0]?.c ?? 0) === 0) {
    try {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE users ADD COLUMN marketing_opt_out TINYINT(1) NOT NULL DEFAULT 0'
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/1060|Duplicate column/i.test(msg)) throw e;
    }
  }

  // --- Seed festivals ONLY when the table is empty --------------------------
  // festival_date is intentionally NULL + needs_date_check = 1 so no wrong
  // (lunar) date is ever hardcoded — the real date is set later from the DB.
  const festCount = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    'SELECT COUNT(*) AS c FROM marketing_festivals'
  );
  if (Number(festCount?.[0]?.c ?? 0) === 0) {
    const festivals: Array<{ name: string; slug: string; greeting: string; emoji: string }> = [
      { name: 'Makar Sankranti', slug: 'makar-sankranti', greeting: 'मकर संक्रांति की शुभकामनाएं', emoji: '🪁' },
      { name: 'Republic Day', slug: 'republic-day', greeting: 'गणतंत्र दिवस की शुभकामनाएं', emoji: '🇮🇳' },
      { name: 'Holi', slug: 'holi', greeting: 'होली की हार्दिक शुभकामनाएं', emoji: '🎨' },
      { name: 'Ram Navami', slug: 'ram-navami', greeting: 'राम नवमी की शुभकामनाएं', emoji: '🙏' },
      { name: 'Hanuman Jayanti', slug: 'hanuman-jayanti', greeting: 'हनुमान जयंती की शुभकामनाएं', emoji: '🚩' },
      { name: 'Eid', slug: 'eid', greeting: 'ईद मुबारक', emoji: '🌙' },
      { name: 'Raksha Bandhan', slug: 'raksha-bandhan', greeting: 'रक्षाबंधन की शुभकामनाएं', emoji: '🪢' },
      { name: 'Janmashtami', slug: 'janmashtami', greeting: 'जन्माष्टमी की शुभकामनाएं', emoji: '🦚' },
      { name: 'Independence Day', slug: 'independence-day', greeting: 'स्वतंत्रता दिवस की शुभकामनाएं', emoji: '🇮🇳' },
      { name: 'Ganesh Chaturthi', slug: 'ganesh-chaturthi', greeting: 'गणेश चतुर्थी की शुभकामनाएं', emoji: '🐘' },
      { name: 'Navratri', slug: 'navratri', greeting: 'नवरात्रि की शुभकामनाएं', emoji: '🪔' },
      { name: 'Dussehra', slug: 'dussehra', greeting: 'दशहरा की शुभकामनाएं', emoji: '🏹' },
      { name: 'Diwali', slug: 'diwali', greeting: 'दीपावली की हार्दिक शुभकामनाएं', emoji: '🪔' },
      { name: 'Chhath Puja', slug: 'chhath-puja', greeting: 'छठ पूजा की शुभकामनाएं', emoji: '🌅' },
      { name: 'Christmas', slug: 'christmas', greeting: 'क्रिसमस की शुभकामनाएं', emoji: '🎄' },
      { name: 'New Year', slug: 'new-year', greeting: 'नव वर्ष की शुभकामनाएं', emoji: '🎉' },
    ];
    for (const [index, f] of festivals.entries()) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO marketing_festivals
           (name, slug, festival_date, greeting_hi, emoji, is_active, needs_date_check, sort_order)
         VALUES (?, ?, NULL, ?, ?, 1, 1, ?)`,
        f.name,
        f.slug,
        f.greeting,
        f.emoji,
        index + 1
      );
    }
  }

  // --- Seed templates ONLY when the table is empty --------------------------
  const tplCount = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    'SELECT COUNT(*) AS c FROM marketing_templates'
  );
  if (Number(tplCount?.[0]?.c ?? 0) === 0) {
    const templates: Array<{ title: string; category: string; festival_slug: string | null; lang: string; body: string }> = [
      {
        title: 'Festival Greeting + Offer',
        category: 'festival',
        festival_slug: null,
        lang: 'hinglish',
        body:
          '{{festival_name}} ki {{store_name}} ki taraf se hardik shubhkamnaayein! {{product_name}} ab sirf ₹{{selling_price}} ({{discount}} OFF). Offer {{offer_expiry}} tak. Order karein: {{product_url}} | Call: {{store_phone}}',
      },
      {
        title: 'New Product Launch',
        category: 'product',
        festival_slug: null,
        lang: 'hinglish',
        body:
          'Naya aa gaya hai {{store_name}} par! {{product_name}} ab {{selling_price}} me ({{discount}} chhoot). {{service_area}} me delivery. Dekhein: {{product_url}}',
      },
      {
        title: 'Weekend Deal',
        category: 'offer',
        festival_slug: null,
        lang: 'hinglish',
        body:
          'Weekend Special at {{store_name}}! {{product_name}} sirf ₹{{selling_price}} ({{discount}} OFF). {{offer_expiry}} tak hi. Abhi order karein: {{product_url}} 📞 {{store_phone}}',
      },
      {
        title: 'App Download Nudge',
        category: 'general',
        festival_slug: null,
        lang: 'hinglish',
        body:
          '{{store_name}} ki app download karein aur ghar baithe {{service_area}} me saman mangwaayein. Download: {{app_url}}',
      },
      {
        title: 'Festival Image Share',
        category: 'festival',
        festival_slug: null,
        lang: 'hinglish',
        body:
          '{{festival_name}} 🎉 — {{product_image}} {{product_name}} par special offer sirf {{selling_price}}! {{store_name}} se order karein: {{product_url}}',
      },
    ];
    for (const [index, t] of templates.entries()) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO marketing_templates
           (title, category, festival_slug, lang, body, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        t.title,
        t.category,
        t.festival_slug,
        t.lang,
        t.body,
        index + 1
      );
    }
  }
}

/**
 * Ensure the `short_links` table exists. Follows the repo's no-migrate
 * convention: idempotent `CREATE TABLE IF NOT EXISTS` via $executeRawUnsafe
 * (InnoDB utf8mb4) with column types mirroring the Prisma ShortLink model in
 * schema.prisma. Backs the universal short-link subsystem (services/shortLink.ts,
 * routes/link.ts, routes/admin-links.ts). Safe to re-run; NO prisma migrate /
 * db push. Called at startup beside ensureMarketingTables(). Manual equivalent:
 * prisma/short-links.sql.
 */
export async function ensureShortLinkTables(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS short_links (
       id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       code       VARCHAR(16)   NOT NULL,
       target_url VARCHAR(1000) NOT NULL,
       type       VARCHAR(16)   NOT NULL,
       product_id BIGINT UNSIGNED NULL,
       created_by VARCHAR(64)   NULL,
       clicks     INT           NOT NULL DEFAULT 0,
       created_at DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       UNIQUE KEY uq_short_links_code (code),
       INDEX idx_short_links_product (product_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

/**
 * Ensure the additive OG-preview override columns exist on `short_links`.
 *
 * `og_image` / `og_title` let an admin set a custom WhatsApp/social preview
 * image + title for a CUSTOM short link (product links derive their preview from
 * the product). Both are nullable so existing rows and all other link types are
 * untouched; when empty the crawler OG card falls back to the 4A Store default
 * logo card (routes/link.ts + services/ogShare.ts). Each ALTER is
 * information_schema-guarded (add only when absent) and swallows the MySQL
 * duplicate-column error (1060) so concurrent/repeat runs never crash. Uses
 * $executeRawUnsafe — NO prisma migrate / db push. Mirrored on the Prisma
 * `ShortLink` model and the manual prisma/short-links.sql.
 */
export async function ensureShortLinkOgColumns(): Promise<void> {
  const columns: Array<{ name: string; ddl: string }> = [
    { name: 'og_image', ddl: 'ADD COLUMN og_image VARCHAR(1000) NULL' },
    { name: 'og_title', ddl: 'ADD COLUMN og_title VARCHAR(255) NULL' },
  ];
  for (const col of columns) {
    const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
      `SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'short_links' AND column_name = ?`,
      col.name
    );
    if (Number(rows?.[0]?.c ?? 0) > 0) continue;
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE short_links ${col.ddl}`);
    } catch (e) {
      // Swallow duplicate-column (1060) in case a concurrent run added it first.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/1060|Duplicate column/i.test(msg)) throw e;
    }
  }
}

/**
 * Ensure the additive POS inventory columns exist on the `products` table.
 *
 * Phase-1 POS/inventory foundation. One stock figure serves BOTH the online
 * store and the in-store counter. Every column is nullable or defaulted so
 * existing rows and the online-order flow are untouched. Mirrors
 * ensureMasterPasswordColumn() exactly: each ALTER is information_schema-guarded
 * (add only when absent) and swallows the MySQL duplicate-column error (1060) so
 * concurrent/repeat runs never crash. Uses $executeRawUnsafe — NO prisma
 * migrate / db push. Mirrored on the Prisma `Product` model (runtime-created
 * comment) and the manual prisma/pos-inventory.sql.
 *
 * SKU/barcode uniqueness is enforced in the POS service layer (SELECT-before-
 * insert), NOT by a DB unique index — a unique index added at runtime over a
 * large legacy table risks a slow ALTER and a hard failure on dirty duplicates.
 * We add plain non-unique lookup indexes idx_products_sku / idx_products_barcode.
 */
export async function ensureProductInventoryColumns(): Promise<void> {
  const columns: Array<{ name: string; ddl: string }> = [
    { name: 'sku', ddl: 'ADD COLUMN sku VARCHAR(64) NULL' },
    { name: 'barcode', ddl: 'ADD COLUMN barcode VARCHAR(64) NULL' },
    { name: 'purchase_price', ddl: 'ADD COLUMN purchase_price DECIMAL(10,2) NULL' },
    { name: 'stock', ddl: 'ADD COLUMN stock DECIMAL(10,3) NOT NULL DEFAULT 0.000' },
    { name: 'unit', ddl: "ADD COLUMN unit VARCHAR(12) NOT NULL DEFAULT 'pcs'" },
    { name: 'tax_rate', ddl: 'ADD COLUMN tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00' },
    { name: 'low_stock_threshold', ddl: 'ADD COLUMN low_stock_threshold DECIMAL(10,3) NULL' },
    { name: 'track_inventory', ddl: 'ADD COLUMN track_inventory TINYINT(1) NOT NULL DEFAULT 1' },
    { name: 'allow_negative_stock', ddl: 'ADD COLUMN allow_negative_stock TINYINT(1) NULL' },
  ];
  for (const col of columns) {
    const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
      `SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = ?`,
      col.name
    );
    if (Number(rows?.[0]?.c ?? 0) > 0) continue;
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE products ${col.ddl}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/1060|Duplicate column/i.test(msg)) throw e;
    }
  }
  // Non-unique lookup indexes (guarded against duplicate-index 1061).
  const indexes: Array<{ name: string; column: string }> = [
    { name: 'idx_products_sku', column: 'sku' },
    { name: 'idx_products_barcode', column: 'barcode' },
  ];
  for (const idx of indexes) {
    const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
      `SELECT COUNT(*) AS c FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'products' AND index_name = ?`,
      idx.name
    );
    if (Number(rows?.[0]?.c ?? 0) > 0) continue;
    try {
      await prisma.$executeRawUnsafe(`CREATE INDEX ${idx.name} ON products (${idx.column})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/1061|Duplicate key name/i.test(msg)) throw e;
    }
  }
}

/**
 * Ensure the additive `max_qty_per_order` column exists on the `products` table.
 *
 * Per-order purchase cap (Zepto/Blinkit style). DECIMAL(10,3) so weight products
 * (1kg / 0.5kg) and piece caps (3 pcs) both work; NULL = no limit (unlimited —
 * today's behavior, so existing rows are untouched). UNLIKE the owner-only POS
 * cost/inventory columns, this ONE inventory field IS public (returned by
 * PUBLIC_PRODUCT_SELECT) so the storefront can show "Max N" and disable +.
 *
 * Kept standalone (not folded into ensureProductInventoryColumns) so this
 * feature's files stay self-contained and it can be reviewed/reverted
 * independently of the POS inventory work. Mirrors ensureWhatsappApiColumn()
 * exactly: information_schema-guarded (add only when absent) and swallows the
 * MySQL duplicate-column error (1060) so concurrent/repeat runs never crash.
 * Uses $executeRawUnsafe — NO prisma migrate / db push. Mirrored on the Prisma
 * `Product` model and the manual prisma/product-max-qty.sql.
 */
export async function ensureProductMaxQtyColumn(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'max_qty_per_order'`
  );
  const present = Number(rows?.[0]?.c ?? 0) > 0;
  if (present) return;
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE products ADD COLUMN max_qty_per_order DECIMAL(10,3) NULL');
  } catch (e) {
    // Swallow duplicate-column (1060) in case a concurrent run added it first.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/1060|Duplicate column/i.test(msg)) throw e;
  }
}

/**
 * Ensure the additive `status` column exists on the `products` table.
 *
 * Admin publish/unpublish status (draft | published). A 'draft' product is
 * hidden from the public catalog (routes/catalog.ts filters `status: 'published'`)
 * while the admin can still see it via GET /api/admin/products; 'published' makes
 * it live. The column is NOT NULL DEFAULT 'published' so every EXISTING live row
 * stays visible immediately after the add (no backfill needed).
 *
 * Kept standalone (mirrors ensureProductMaxQtyColumn) so this feature's files
 * stay self-contained and it can be reviewed/reverted independently. Both the
 * column add and the lookup index are information_schema-guarded (added only
 * when absent) and swallow the MySQL duplicate errors (1060 for the column,
 * 1061 for the index) so concurrent/repeat runs never crash. Uses
 * $executeRawUnsafe — NO prisma migrate / db push. Mirrored on the Prisma
 * `Product` model.
 */
export async function ensureProductStatusColumn(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'status'`
  );
  const present = Number(rows?.[0]?.c ?? 0) > 0;
  if (!present) {
    try {
      await prisma.$executeRawUnsafe("ALTER TABLE products ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'published'");
    } catch (e) {
      // Swallow duplicate-column (1060) in case a concurrent run added it first.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/1060|Duplicate column/i.test(msg)) throw e;
    }
  }
  // Non-unique lookup index (guarded against duplicate-index 1061).
  const idxRows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
    `SELECT COUNT(*) AS c FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'products' AND index_name = 'idx_products_status'`
  );
  if (Number(idxRows?.[0]?.c ?? 0) > 0) return;
  try {
    await prisma.$executeRawUnsafe('CREATE INDEX idx_products_status ON products (status)');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/1061|Duplicate key name/i.test(msg)) throw e;
  }
}

/**
 * Ensure the per-product SEO columns the product write path depends on exist on
 * the `products` table.
 *
 * The admin product add/update write ALWAYS includes `seo_overrides` (plus
 * `seo_title` / `seo_description` / `seo_keywords` / `og_image`). On the live DB
 * these columns are created ONLY by the manual script prisma/seo-auto.sql — unlike
 * every other runtime-added products column (max_qty_per_order, status, inventory)
 * which is auto-ensured at startup. If seo-auto.sql was never run, the column is
 * missing and `prisma.product.update({ data: { seo_overrides: ... } })` throws
 * Prisma P2022 (Unknown column) — which the old blanket catch turned into a false
 * 404 "Product not found". This ensure fixes that root cause deterministically,
 * matching the existing runtime-ensure convention.
 *
 * Mirrors ensureProductMaxQtyColumn()/ensureProductStatusColumn() exactly: each
 * column is information_schema-guarded (added only when absent) and swallows the
 * MySQL duplicate-column error (1060) so concurrent/repeat runs never crash. Uses
 * $executeRawUnsafe — NO prisma migrate / db push. Column types mirror the subset
 * of prisma/seo-auto.sql that the product write path reads/writes.
 */
export async function ensureProductSeoColumns(): Promise<void> {
  const columns: Array<{ name: string; ddl: string }> = [
    { name: 'seo_overrides', ddl: 'ADD COLUMN seo_overrides JSON NULL' },
    { name: 'seo_auto_json', ddl: 'ADD COLUMN seo_auto_json JSON NULL' },
    { name: 'seo_title', ddl: 'ADD COLUMN seo_title VARCHAR(255) NULL' },
    { name: 'seo_description', ddl: 'ADD COLUMN seo_description TEXT NULL' },
    { name: 'seo_keywords', ddl: 'ADD COLUMN seo_keywords VARCHAR(500) NULL' },
    { name: 'og_image', ddl: 'ADD COLUMN og_image VARCHAR(500) NULL' },
  ];
  for (const col of columns) {
    const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
      `SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = ?`,
      col.name
    );
    if (Number(rows?.[0]?.c ?? 0) > 0) continue;
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE products ${col.ddl}`);
    } catch (e) {
      // Swallow duplicate-column (1060) in case a concurrent run added it first.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/1060|Duplicate column/i.test(msg)) throw e;
    }
  }
}

/**
 * Ensure the products.image column is MEDIUMTEXT (not TEXT).
 *
 * The admin UI stores product images as base64 data-URI STRINGS. A ~50 KB-binary
 * image becomes a ~67 KB string (base64 +33% + the data: prefix), which overflows
 * a MySQL TEXT column (64 KB) and makes prisma.product.update() fail with
 * "value too long for column: image". MEDIUMTEXT (16 MB) holds it comfortably.
 *
 * Type-guarded (not presence-guarded): the column already exists, so we read its
 * current DATA_TYPE from information_schema and only ALTER while it is still 'text',
 * making re-runs a no-op. Mirrors the other ensure* helpers: $executeRawUnsafe,
 * NO prisma migrate / db push. Mirrored on the Prisma Product model (@db.MediumText).
 */
export async function ensureProductImageColumnType(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ t: string }>>(
    `SELECT DATA_TYPE AS t FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'image'`
  );
  const type = String(rows?.[0]?.t ?? '').toLowerCase();
  // Already MEDIUMTEXT/LONGTEXT (or the row is absent) → nothing to do.
  if (type !== 'text') return;
  await prisma.$executeRawUnsafe('ALTER TABLE products MODIFY image MEDIUMTEXT NULL');
}

/**
 * Ensure the POS-wide toggle columns exist on the `settings` table and seed a
 * default store_address when blank. `settings` is a raw-SQL table (not a Prisma
 * model) — consistent with the repo. Mirrors ensureMasterPasswordColumn(): each
 * ALTER is information_schema-guarded and swallows MySQL 1060. NO prisma migrate
 * / db push. Manual equivalent: prisma/pos-settings.sql.
 */
export async function ensurePosSettingsColumns(): Promise<void> {
  const columns: Array<{ name: string; ddl: string }> = [
    { name: 'pos_allow_negative_stock', ddl: 'ADD COLUMN pos_allow_negative_stock TINYINT(1) NOT NULL DEFAULT 0' },
    { name: 'pos_sale_notifications', ddl: 'ADD COLUMN pos_sale_notifications TINYINT(1) NOT NULL DEFAULT 1' },
    { name: 'pos_bill_prefix', ddl: "ADD COLUMN pos_bill_prefix VARCHAR(8) NOT NULL DEFAULT 'INV-'" },
    { name: 'pos_next_bill_seq', ddl: 'ADD COLUMN pos_next_bill_seq BIGINT UNSIGNED NOT NULL DEFAULT 1' },
    { name: 'pos_allow_manual_items', ddl: 'ADD COLUMN pos_allow_manual_items TINYINT(1) NOT NULL DEFAULT 1' },
  ];
  for (const col of columns) {
    const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
      `SELECT COUNT(*) AS c FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'settings' AND column_name = ?`,
      col.name
    );
    if (Number(rows?.[0]?.c ?? 0) > 0) continue;
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE settings ${col.ddl}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/1060|Duplicate column/i.test(msg)) throw e;
    }
  }
  // Seed the invoice store_address default ONLY when the row exists and the
  // value is blank/null (never overwrite an owner-edited address). The romanized
  // live value is the primary default; the owner may edit it to any string.
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE settings
          SET store_address = ?
        WHERE id = 1 AND (store_address IS NULL OR store_address = '')`,
      'Gajna Road, Chandargarh, Nabinagar, Aurangabad, Bihar - 824301'
    );
  } catch {
    // Best-effort seed — never block startup on it.
  }
}

/**
 * Ensure the six new POS tables exist. Follows the repo's no-migrate convention:
 * idempotent `CREATE TABLE IF NOT EXISTS` via $executeRawUnsafe (InnoDB utf8mb4)
 * with column types mirroring the Prisma PosBill / PosBillItem / StockMovement /
 * AdminPhone / PosImportBatch / ProductChangeLog models in schema.prisma. Safe
 * to re-run; NO prisma migrate / db push. Called at startup beside
 * ensureMarketingTables(). Manual equivalent: prisma/pos-tables.sql.
 *
 * Money aggregates are DECIMAL(12,2) (a cart of many ₹100000 items cannot
 * overflow); line/product money is DECIMAL(10,2); quantity is DECIMAL(10,3).
 * bill_no and idempotency_key are UNIQUE NULL (MySQL permits multiple NULLs) so
 * held bills (no number yet) and non-idempotent rows coexist.
 */
export async function ensurePosTables(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS pos_bills (
       id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       bill_no         VARCHAR(20)  NULL,
       idempotency_key CHAR(36)     NULL,
       status          VARCHAR(16)  NOT NULL,
       customer_name   VARCHAR(120) NULL,
       customer_mobile VARCHAR(15)  NULL,
       subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
       discount        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
       tax_total       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
       grand_total     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
       amount_paid     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
       balance_due     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
       payment_method  VARCHAR(20)  NULL,
       payment_status  VARCHAR(12)  NULL,
       payments_json   JSON         NULL,
       note            VARCHAR(500) NULL,
       created_by      VARCHAR(64)  NULL,
       cancelled_by    VARCHAR(64)  NULL,
       cancel_reason   VARCHAR(255) NULL,
       created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       UNIQUE KEY uq_pos_bills_bill_no (bill_no),
       UNIQUE KEY uq_pos_bills_idem (idempotency_key),
       INDEX idx_pos_bills_created (created_at),
       INDEX idx_pos_bills_status (status),
       INDEX idx_pos_bills_mobile (customer_mobile)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS pos_bill_items (
       id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       bill_id    BIGINT UNSIGNED NOT NULL,
       product_id BIGINT UNSIGNED NULL,
       name       VARCHAR(200) NOT NULL,
       sku        VARCHAR(64)  NULL,
       unit       VARCHAR(12)  NOT NULL DEFAULT 'pcs',
       quantity   DECIMAL(10,3) NOT NULL DEFAULT 0.000,
       rate       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
       tax_rate   DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
       line_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
       is_manual  TINYINT(1)    NOT NULL DEFAULT 0,
       PRIMARY KEY (id),
       INDEX idx_pos_bill_items_bill (bill_id),
       INDEX idx_pos_bill_items_product (product_id),
       CONSTRAINT fk_pos_bill_items_bill FOREIGN KEY (bill_id)
         REFERENCES pos_bills (id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS stock_movements (
       id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       product_id    BIGINT UNSIGNED NOT NULL,
       change_qty    DECIMAL(10,3) NOT NULL,
       balance_after DECIMAL(10,3) NOT NULL,
       reason        VARCHAR(24)  NOT NULL,
       bill_no       VARCHAR(20)  NULL,
       batch_id      BIGINT UNSIGNED NULL,
       note          VARCHAR(255) NULL,
       created_by    VARCHAR(64)  NULL,
       created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       INDEX idx_stock_mov_product (product_id),
       INDEX idx_stock_mov_bill (bill_no),
       INDEX idx_stock_mov_created (created_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS admin_phones (
       id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       mobile      VARCHAR(15)  NOT NULL,
       role        VARCHAR(16)  NOT NULL,
       permissions JSON         NULL,
       name        VARCHAR(120) NULL,
       active      TINYINT(1)   NOT NULL DEFAULT 1,
       added_by    VARCHAR(64)  NULL,
       created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       UNIQUE KEY uq_admin_phones_mobile (mobile)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS pos_import_batches (
       id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       filename   VARCHAR(255) NOT NULL,
       status     VARCHAR(16)  NOT NULL,
       total_rows INT          NOT NULL DEFAULT 0,
       inserted   INT          NOT NULL DEFAULT 0,
       updated    INT          NOT NULL DEFAULT 0,
       skipped    INT          NOT NULL DEFAULT 0,
       errors     INT          NOT NULL DEFAULT 0,
       error_json JSON         NULL,
       created_by VARCHAR(64)  NULL,
       created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       INDEX idx_pos_import_batches_created (created_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS product_change_log (
       id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       product_id BIGINT UNSIGNED NULL,
       field      VARCHAR(32)  NOT NULL,
       old_val    VARCHAR(255) NULL,
       new_val    VARCHAR(255) NULL,
       source     VARCHAR(24)  NOT NULL,
       batch_id   BIGINT UNSIGNED NULL,
       actor      VARCHAR(64)  NOT NULL,
       created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       INDEX idx_pcl_product (product_id),
       INDEX idx_pcl_created (created_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

interface LegacyUser {
  id: number;
  name: string;
  mobile: string;
  username: string;
  password?: string;
  passwordHash?: string;
  registeredAt?: string;
  lastLogin?: string;
  role?: string;
  backendRider?: boolean;
  customDelivery?: number;
  recoveryEmail?: string;
  recoveryEmailVerified?: boolean;
}

export interface ImportUsersResult {
  userIdMap: Map<number, bigint>;
  imported: number;
  renamed: number;
  skipped: number;
  noReadable: number;
}

const OWNER_MOBILE = '7543888698';

/**
 * Import legacy users from data/users.json. Returns an oldId→newId map (read
 * back by UNIQUE mobile — never assumes autoincrement order) plus counts.
 *
 * Password handling (dual scheme):
 *   - plaintext `password`     → password = bcrypt.hashSync(password, 10),
 *                                plain_password = password (verbatim, readable).
 *   - `passwordHash` ($2y$...) → password = $2y$→$2b$ swap (bcryptjs rejects
 *                                $2y$; PHP emits it), plain_password = null.
 *   - neither                  → password = bcrypt of a random string,
 *                                plain_password = null (never fabricate a
 *                                readable value from a one-way hash). LOGGED.
 *
 * Owner collision: any legacy row whose mobile === OWNER_MOBILE is SKIPPED —
 * the owner login is owned by seedDefaultOwner(). Duplicate usernames (after
 * lowercasing, to match the login lookup) are deterministically renamed and
 * every rename is logged; a repeated mobile is skipped (UNIQUE guard).
 */
export async function importUsers(dataDir = DEFAULT_DATA_DIR): Promise<ImportUsersResult> {
  await ensurePlainPasswordColumn();
  const result: ImportUsersResult = { userIdMap: new Map(), imported: 0, renamed: 0, skipped: 0, noReadable: 0 };
  if (!exists(dataDir, 'users.json')) return result;

  const users = read<LegacyUser[]>(dataDir, 'users.json');
  const usedUsernames = new Set<string>();
  const usedMobiles = new Set<string>();
  // legacy id → mobile, for building the oldId→newId map after read-back.
  const idToMobile = new Map<number, string>();

  for (const u of users) {
    const mobile = String(u.mobile);

    // OWNER COLLISION: skip; seedDefaultOwner() owns this login.
    if (mobile === OWNER_MOBILE) {
      // eslint-disable-next-line no-console
      console.log(`[users] skip legacy id=${u.id} (${u.name}) — mobile ${OWNER_MOBILE} is the seeded owner`);
      result.skipped++;
      continue;
    }

    // MOBILE collision guard (mobile is UNIQUE — never crash on a dupe).
    if (usedMobiles.has(mobile)) {
      // eslint-disable-next-line no-console
      console.log(`[users] skip legacy id=${u.id} (${u.name}) — duplicate mobile ${mobile} already imported`);
      result.skipped++;
      continue;
    }

    // Login lookup is on username.toLowerCase() — store + dedup lowercased.
    let username = String(u.username).toLowerCase();
    if (usedUsernames.has(username)) {
      const base = username;
      let candidate = `${base}-${u.id}`;
      let n = 2;
      while (usedUsernames.has(candidate)) candidate = `${base}-${n++}`;
      candidate = candidate.slice(0, 64);
      // eslint-disable-next-line no-console
      console.log(`[users] rename duplicate username "${base}" → "${candidate}" (legacy id=${u.id})`);
      username = candidate;
      result.renamed++;
    }

    // Password branches (dual scheme).
    let password: string;
    let plainPassword: string | null;
    if (typeof u.password === 'string' && u.password.length > 0) {
      password = bcrypt.hashSync(u.password, 10);
      plainPassword = u.password; // readable, verbatim
    } else if (typeof u.passwordHash === 'string' && u.passwordHash.length > 0) {
      // bcryptjs verifies $2b$; PHP emits $2y$ — swap the prefix so login works.
      password = u.passwordHash.replace(/^\$2y\$/, '$2b$');
      plainPassword = null; // one-way hash — no readable value available
      result.noReadable++;
    } else {
      password = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
      plainPassword = null;
      result.noReadable++;
      // eslint-disable-next-line no-console
      console.log(`[users] legacy id=${u.id} (${u.name}, ${mobile}) had NO password — set random hash, plain_password=null`);
    }

    const role = u.role === 'rider' ? 'rider' : 'customer';
    const backendRider = u.backendRider === true ? 1 : 0;
    const customDelivery = typeof u.customDelivery === 'number' ? u.customDelivery : null;
    const recoveryEmail = u.recoveryEmail ?? null;
    const recoveryEmailVerified = u.recoveryEmailVerified === true ? 1 : 0;
    const registeredAt = parseDate(u.registeredAt);
    const lastLogin = parseDate(u.lastLogin);

    // Idempotent raw upsert keyed by UNIQUE mobile; writes plain_password (not a
    // Prisma field). email is always NULL; permissions NULL for imported users.
    await prisma.$executeRawUnsafe(
      `INSERT INTO users
         (name, mobile, username, email, recovery_email, recovery_email_verified, password, role,
          permissions, backend_rider, custom_delivery, registered_at, last_login, plain_password)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name=VALUES(name), username=VALUES(username), recovery_email=VALUES(recovery_email),
         recovery_email_verified=VALUES(recovery_email_verified), password=VALUES(password),
         role=VALUES(role), backend_rider=VALUES(backend_rider), custom_delivery=VALUES(custom_delivery),
         registered_at=VALUES(registered_at), last_login=VALUES(last_login), plain_password=VALUES(plain_password)`,
      u.name,
      mobile,
      username,
      recoveryEmail,
      recoveryEmailVerified,
      password,
      role,
      backendRider,
      customDelivery,
      registeredAt,
      lastLogin,
      plainPassword
    );

    usedUsernames.add(username);
    usedMobiles.add(mobile);
    idToMobile.set(u.id, mobile);
    result.imported++;
  }

  // Build oldId→newId by READING BACK via UNIQUE mobile (no autoincrement assumptions).
  const mobiles = [...idToMobile.values()];
  if (mobiles.length > 0) {
    const rows = await prisma.user.findMany({ where: { mobile: { in: mobiles } }, select: { id: true, mobile: true } });
    const mobileToId = new Map(rows.map((r) => [r.mobile, r.id]));
    for (const [oldId, mobile] of idToMobile) {
      const newId = mobileToId.get(mobile);
      if (newId !== undefined) result.userIdMap.set(oldId, newId);
    }
  }

  return result;
}

interface LegacyOrder {
  orderId: string;
  userId?: number | null;
  customer?: Record<string, unknown>;
  items?: unknown[];
  subtotal?: number;
  discount?: number;
  deliveryCharge?: number;
  totalAmount?: number;
  paymentMethod?: string;
  paymentReference?: string;
  orderStatus?: string;
  status?: string;
  orderDate?: string;
  deliveryAddress?: Record<string, unknown>;
}

/**
 * Import legacy orders from data/orders.json. user_id is resolved via the
 * oldId→newId map (null when the legacy user is absent — orphan orders are
 * kept, never rejected; the customer snapshot still lives in the JSON column).
 * paymentMethod is preserved (UPI/Cash), not forced. Upserts by UNIQUE order_id.
 */
export async function importOrders(dataDir = DEFAULT_DATA_DIR, userIdMap: Map<number, bigint> = new Map()): Promise<number> {
  if (!exists(dataDir, 'orders.json')) return 0;
  const orders = read<LegacyOrder[]>(dataDir, 'orders.json');
  let count = 0;

  for (const o of orders) {
    const userId = o.userId != null ? userIdMap.get(Number(o.userId)) ?? null : null;
    const customer = (o.customer ?? {}) as object;
    const items = (Array.isArray(o.items) ? o.items : []) as object;
    const subtotal = Number(o.subtotal ?? 0);
    const discount = Number(o.discount ?? 0);
    const deliveryCharge = Number(o.deliveryCharge ?? 0);
    const totalAmount = Number(o.totalAmount ?? 0);
    const paymentMethod = o.paymentMethod ?? 'UPI';
    const paymentReference = o.paymentReference ?? null;
    const orderStatus = o.orderStatus ?? o.status ?? 'Order Placed';
    const orderDate = parseDate(o.orderDate) ?? new Date();
    const deliveryAddress = (o.deliveryAddress ?? o.customer ?? null) as object | null;

    const data = {
      user_id: userId,
      customer,
      items,
      subtotal,
      discount,
      delivery_charge: deliveryCharge,
      total_amount: totalAmount,
      payment_method: paymentMethod,
      payment_reference: paymentReference,
      order_status: orderStatus,
      order_date: orderDate,
      delivery_address: deliveryAddress ?? undefined,
    };

    await prisma.order.upsert({
      where: { order_id: o.orderId },
      create: { order_id: o.orderId, ...data },
      update: data,
    });
    count++;
  }

  return count;
}

export interface ImportSummary {
  categories: number;
  products: number;
  banners: number;
  ads: number;
  settings: true;
  announcement: true;
  users: number;
  orders: number;
  usersSkipped: number;
  usersRenamed: number;
  usersNoReadable: number;
}

/**
 * Full idempotent import of the catalogue + config + settings + announcement +
 * ad creatives + users + orders. Returns per-entity counts. Re-running updates
 * in place. Users are imported BEFORE orders so orders can map old→new user ids.
 * Both the admin route (POST /api/admin/data/import) and the CLI call this, so
 * they stay in lockstep through one code path. addresses.json is NOT imported.
 */
/**
 * Enqueue a single changed-only SEO `audit` job after an import. Skipped when the
 * seoAuto master flag is off, or when an audit/optimize_all job is already pending.
 */
async function enqueueImportSeoAudit(): Promise<void> {
  const features = await loadFeatures();
  if (!features.seoAuto) return; // master kill-switch
  if (await hasPendingCatalogueJob()) return; // de-dupe with the cron sweep
  await enqueueSeoJob('audit', null, 'auto:import');
}

export async function runImport(dataDir = DEFAULT_DATA_DIR): Promise<ImportSummary> {
  if (!exists(dataDir, 'products.json')) throw new Error(`No products.json in ${dataDir}`);
  const ads = await importAdCreatives(dataDir);
  const categories = await importCategories(dataDir);
  const products = await importProducts(dataDir);
  const cfg = await importConfig(dataDir);
  await importSettings(dataDir);
  await importAnnouncement(dataDir);
  const usersResult = await importUsers(dataDir);
  const orders = await importOrders(dataDir, usersResult.userIdMap);
  // Enqueue ONE changed-only `audit` SEO job (not optimize_all) so a routine reload is a
  // near-no-op on unchanged products. Gated by the seoAuto kill-switch and de-duped
  // against any audit/optimize_all already queued/running. Never fails the import.
  await enqueueImportSeoAudit().catch(() => undefined);
  return {
    categories,
    products,
    banners: cfg.banners,
    ads,
    settings: true,
    announcement: true,
    users: usersResult.imported,
    orders,
    usersSkipped: usersResult.skipped,
    usersRenamed: usersResult.renamed,
    usersNoReadable: usersResult.noReadable,
  };
}

/**
 * Ensure a default OWNER login always exists. Idempotent: only creates when no
 * user matches username 'owner' OR mobile '7543888698'. Uses the SAME bcrypt
 * hashing as register/login (bcrypt.hashSync(pwd, 10)) so the owner can log in
 * via the existing /api/users/login route. Returns whether it created a row.
 */
export async function seedDefaultOwner(): Promise<boolean> {
  // Ensure the readable-password column exists even if a reset runs before any
  // import (reset → seedDefaultOwner → owner needs plain_password set).
  await ensurePlainPasswordColumn();
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
  // Record the owner's readable password too so phone support works for the
  // owner (login is unchanged — still bcrypt of 'owner@7543'). See the
  // ensurePlainPasswordColumn() security note for why this is owner-approved.
  await prisma.$executeRawUnsafe('UPDATE users SET plain_password = ? WHERE username = ?', 'owner@7543', 'owner');
  // eslint-disable-next-line no-console
  console.log('[seed] default owner created');
  return true;
}
