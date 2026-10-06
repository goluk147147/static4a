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
