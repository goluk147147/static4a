import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import bcrypt from 'bcryptjs';
import { requireAuth, requireStaff, hasPermission } from '../auth/middleware';
import { notifyCustomerStatus } from '../services/push';
import { toPage, PageRow } from './pages';
import { FEATURE_KEYS, mergeFeatures } from '../utils/features';
import { mergeSeoConfig, type SettingsRow } from '../seo/localSeo';

const router = Router();

function computeDiscount(mrp: number, price: number, provided?: number): number {
  if (provided !== undefined && !Number.isNaN(provided)) return Math.trunc(provided);
  if (mrp > 0 && price >= 0 && price <= mrp) return Math.round(((mrp - price) / mrp) * 100);
  return 0;
}

// ---------------- Products ----------------
const productSchema = z.object({
  name: z.string().min(1),
  brand: z.string().optional().default(''),
  category: z.string().optional().default(''), // original admin allowed "— Select category —"
  weight: z.string().optional().default(''),
  mrp: z.number().default(0),
  price: z.number().default(0),
  discount: z.number().optional(),
  image: z.string().optional().default(''),
  description: z.string().optional().default(''),
  features: z.array(z.string()).optional().default([]),
  inStock: z.boolean().optional().default(true),
  featured: z.boolean().optional().default(false), // daily "Aaj ka Special" video
  // Optional per-product SEO overrides (ADD-only — unset falls back to derived defaults).
  seoTitle: z.string().max(255).optional(),
  seoDescription: z.string().max(5000).optional(),
  seoKeywords: z.string().max(500).optional(),
  ogImage: z.string().max(500).optional(),
});

router.post('/products', requireAuth, requireStaff('products'), async (req: Request, res: Response) => {
  const action = String(req.body?.action || '');

  if (action === 'add' || action === 'update') {
    const parsed = productSchema.safeParse(req.body.product);
    if (!parsed.success) return fail(res, 'Product name and a valid selling price are required', 422);
    const p = parsed.data;
    const data = {
      name: p.name,
      brand: p.brand,
      category: p.category,
      weight: p.weight,
      mrp: p.mrp,
      price: p.price,
      discount: computeDiscount(p.mrp, p.price, p.discount),
      image: p.image,
      description: p.description,
      features: p.features,
      in_stock: p.inStock,
      featured: p.featured,
      seo_title: p.seoTitle || null,
      seo_description: p.seoDescription || null,
      seo_keywords: p.seoKeywords || null,
      og_image: p.ogImage || null,
    };
    if (action === 'add') {
      const product = await prisma.product.create({ data });
      return ok(res, { message: 'Product added', product });
    }
    const id = Number(req.body.product?.id || req.body.id || 0);
    if (!id) return fail(res, 'Product id is required', 422);
    const product = await prisma.product.update({ where: { id: BigInt(id) }, data }).catch(() => null);
    if (!product) return fail(res, 'Product not found', 404);
    return ok(res, { message: 'Product updated', product });
  }

  if (action === 'delete') {
    const id = Number(req.body?.id || 0);
    if (!id) return fail(res, 'Product id is required', 422);
    await prisma.product.delete({ where: { id: BigInt(id) } }).catch(() => null);
    return ok(res, { message: 'Product deleted' });
  }

  return fail(res, 'Invalid action', 400);
});

// ---------------- Categories ----------------
// Mirrors the original api/categories.php: slug auto-generated from the name,
// optional hidden / ageRestricted / warning flags.
const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

const categorySchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(120).optional().default(''),
  icon: z.string().trim().max(16).optional().default(''),
  image: z.string().trim().max(500).optional().default(''),
  hidden: z.boolean().optional().default(false),
  ageRestricted: z.boolean().optional().default(false),
  warning: z.string().trim().max(255).optional().default(''),
});

router.post('/categories', requireAuth, requireStaff('categories'), async (req: Request, res: Response) => {
  const action = String(req.body?.action || '');

  if (action === 'delete') {
    const id = Number(req.body?.id || 0);
    if (!id) return fail(res, 'Category id required', 422);
    const removed = await prisma.category.delete({ where: { id: BigInt(id) } }).catch(() => null);
    if (!removed) return fail(res, 'Category not found', 404);
    return ok(res, { message: 'Category deleted' });
  }
  if (action !== 'add' && action !== 'update') return fail(res, 'Invalid action', 400);

  const parsed = categorySchema.safeParse(req.body?.category);
  if (!parsed.success) return fail(res, 'Category name is required', 422);
  const c = parsed.data;
  const slug = slugify(c.slug || c.name);
  if (!slug) return fail(res, 'Could not make a slug from this name — enter one manually', 422);

  const clash = await prisma.category.findUnique({ where: { slug } });
  if (clash && (action === 'add' || Number(clash.id) !== c.id)) return fail(res, `Slug "${slug}" is already used by "${clash.name}"`, 409);

  const data = {
    name: c.name, slug, icon: c.icon || null, image: c.image || null,
    hidden: c.hidden, age_restricted: c.ageRestricted, warning: c.warning || null,
  };

  if (action === 'add') {
    const max = await prisma.category.aggregate({ _max: { sort_order: true } });
    const category = await prisma.category.create({ data: { ...data, sort_order: (max._max.sort_order ?? 0) + 1 } });
    return ok(res, { message: 'Category added', category });
  }
  if (!c.id) return fail(res, 'Category id required', 422);
  const existing = await prisma.category.findUnique({ where: { id: BigInt(c.id) } });
  if (!existing) return fail(res, 'Category not found', 404);
  const category = await prisma.$transaction(async (tx) => {
    const updated = await tx.category.update({ where: { id: BigInt(c.id!) }, data });
    // Keep products attached when the slug is renamed.
    if (existing.slug !== slug) await tx.product.updateMany({ where: { category: existing.slug }, data: { category: slug } });
    return updated;
  });
  return ok(res, { message: 'Category updated', category });
});

// ---------------- Settings ----------------
const settingsSchema = z.object({
  storeEmail: z.union([z.literal(''), z.string().trim().email().max(190)]).optional(),
  deliveryCharge: z.coerce.number().int().min(0).max(10000).optional(),
  freeDeliveryAbove: z.coerce.number().int().min(0).max(1000000).optional(),
  handlingCharge: z.coerce.number().int().min(0).max(10000).optional(),
  deliveryChargeEnabled: z.boolean().optional(),
  handlingChargeEnabled: z.boolean().optional(),
  staffOrderAlertsEnabled: z.boolean().optional(),
  upiId: z.string().trim().max(120).optional(),
  upiName: z.string().trim().max(120).optional(),
  hideMrp: z.boolean().optional(),
  storePhone: z.string().trim().max(15).optional(),
  storeAddress: z.string().trim().max(500).optional(),
  storeLatitude: z.coerce.number().min(-90).max(90).optional(),
  storeLongitude: z.coerce.number().min(-180).max(180).optional(),
  serviceableVillages: z.string().trim().max(5000).optional(),
});

const bool01 = (v: boolean | undefined) => (v === undefined ? null : v ? 1 : 0);

router.post('/settings', requireAuth, requireStaff('settings'), async (req: Request, res: Response) => {
  const parsed = settingsSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'Please check the settings values (email, amounts, latitude/longitude)', 422);
  const s = parsed.data;
  await prisma.$executeRawUnsafe(
    `UPDATE settings SET
       store_email=COALESCE(?,store_email), delivery_charge=COALESCE(?,delivery_charge),
       free_delivery_above=COALESCE(?,free_delivery_above),
       handling_charge=COALESCE(?,handling_charge),
       delivery_charge_enabled=COALESCE(?,delivery_charge_enabled),
       handling_charge_enabled=COALESCE(?,handling_charge_enabled),
       staff_order_alerts_enabled=COALESCE(?,staff_order_alerts_enabled),
       upi_id=COALESCE(?,upi_id),
       upi_name=COALESCE(?,upi_name), hide_mrp=COALESCE(?,hide_mrp), store_phone=COALESCE(?,store_phone),
       store_address=COALESCE(?,store_address), store_latitude=COALESCE(?,store_latitude),
       store_longitude=COALESCE(?,store_longitude), serviceable_villages=COALESCE(?,serviceable_villages)
     WHERE id=1`,
    s.storeEmail ?? null,
    s.deliveryCharge ?? null,
    s.freeDeliveryAbove ?? null,
    s.handlingCharge ?? null,
    bool01(s.deliveryChargeEnabled),
    bool01(s.handlingChargeEnabled),
    bool01(s.staffOrderAlertsEnabled),
    s.upiId ?? null,
    s.upiName ?? null,
    bool01(s.hideMrp),
    s.storePhone ?? null,
    s.storeAddress ?? null,
    s.storeLatitude ?? null,
    s.storeLongitude ?? null,
    s.serviceableVillages ?? null
  );
  return ok(res, { message: 'Settings saved' });
});

// ---------------- Banners (config) ----------------
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const bannerSchema = z.object({
  title: z.string().max(300).optional().default(''),
  subtitle: z.string().max(300).optional().default(''),
  btnText: z.string().max(80).optional().default(''),
  btnLink: z.string().max(500).optional().default(''),
  gradient: z.tuple([hexColor, hexColor]).catch(['#ff6600', '#ff9800']),
  // http(s) URL, or a path we serve ourselves (legacy data/banners/* or new /api/uploads/banners/*)
  image: z.string().max(500).refine((v) => v === '' || /^https?:\/\//i.test(v) || /^\/?(data\/banners|api\/uploads\/banners)\/[\w.-]+$/.test(v), 'bad image').optional().default(''),
  festival: z.string().max(40).optional().default(''),
  active: z.boolean().optional().default(true),
});

router.post('/banners', requireAuth, requireStaff('banners'), async (req: Request, res: Response) => {
  const parsed = z.array(bannerSchema).max(50).safeParse(req.body?.banners);
  if (!parsed.success) return fail(res, 'Invalid banner data (check image URL and colours)', 422);
  await prisma.$executeRawUnsafe('UPDATE config SET banners = ? WHERE id = 1', JSON.stringify(parsed.data));
  return ok(res, { count: parsed.data.length });
});

// Banner image upload (original api/upload-banner.php). Body: { image: "data:image/webp;base64,..." }
export const BANNER_DIR = path.join(process.cwd(), 'uploads', 'banners');

function sniffImage(buf: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

router.post('/banners/upload', requireAuth, requireStaff('banners'), async (req: Request, res: Response) => {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
  if (!m) return fail(res, 'Valid PNG, JPG or WEBP image required', 422);
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) return fail(res, 'Image is larger than 4 MB after compression', 413);
  const ext = sniffImage(buf); // trust the bytes, not the declared type
  if (!ext) return fail(res, 'Unsupported image format', 422);
  await fs.promises.mkdir(BANNER_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const name = `banner_${stamp}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  await fs.promises.writeFile(path.join(BANNER_DIR, name), buf);
  return ok(res, { url: `/api/uploads/banners/${name}` });
});

// ---------------- Announcement ----------------
const announcementSchema = z.object({
  text: z.string().max(2000).optional(),
  image: z.string().trim().max(500).refine((v) => v === '' || /^https?:\/\//i.test(v) || /^\/?[\w./-]+$/.test(v), 'bad image').optional(),
  target: z.string().trim().refine((v) => v === 'all' || /^[6-9]\d{9}$/.test(v), 'target').optional(),
  ctaText: z.string().max(120).optional(),
  ctaLink: z.string().trim().max(500).refine((v) => !/^\s*javascript:/i.test(v), 'link').optional(),
  enabled: z.boolean().optional(),
});

// Announcement lives in the Settings tab in the original admin; Ads permission also allowed.
router.post('/announcement', requireAuth, async (req: Request, res: Response) => {
  if (!hasPermission(req.user, 'settings') && !hasPermission(req.user, 'ads')) return fail(res, 'Permission required: settings', 403);
  const parsed = announcementSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'Invalid announcement ("Kise bhejein" must be "all" or a 10-digit mobile)', 422);
  const a = parsed.data as Record<string, unknown>;
  // Bump id when content changes so clients treat it as new.
  const cur = (await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM announcements WHERE row_id = 1'))[0] || {};
  const changed = ['text', 'image', 'ctaText', 'ctaLink', 'target'].some((k) => {
    const map: Record<string, string> = { text: 'text', image: 'image', ctaText: 'cta_text', ctaLink: 'cta_link', target: 'target' };
    return a[k] !== undefined && a[k] !== cur[map[k]];
  });
  const newId = (Number(cur.id) || 0) + (changed ? 1 : 0);
  await prisma.$executeRawUnsafe(
    `UPDATE announcements SET id=?, text=COALESCE(?,text), image=COALESCE(?,image), target=COALESCE(?,target),
       cta_text=COALESCE(?,cta_text), cta_link=COALESCE(?,cta_link), enabled=COALESCE(?,enabled) WHERE row_id=1`,
    newId,
    a.text ?? null,
    a.image ?? null,
    a.target ?? null,
    a.ctaText ?? null,
    a.ctaLink ?? null,
    a.enabled === undefined ? null : a.enabled ? 1 : 0
  );
  const row = (await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM announcements WHERE row_id = 1'))[0] || {};
  return ok(res, {
    message: 'Announcement saved',
    id: newId,
    announcement: {
      id: Number(row.id ?? newId), text: row.text ?? '', image: row.image ?? '', target: row.target ?? 'all',
      ctaText: row.cta_text ?? '', ctaLink: row.cta_link ?? '', enabled: !!row.enabled,
    },
  });
});

// ---------------- Users: list + assignRole by mobile ----------------
router.get('/users', requireAuth, requireStaff('users'), async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({ orderBy: { id: 'desc' } });
  const list = users.map((u) => {
    const { password, ...rest } = u;
    void password;
    return rest;
  });
  return ok(res, { users: list });
});

const assignSchema = z.object({
  mobile: z.string().regex(/^[6-9]\d{9}$/),
  role: z.enum(['admin', 'rider', 'customer']),
  permissions: z.array(z.string()).optional().default([]),
});

const ALLOWED_PERMS = ['dashboard', 'orders', 'riderTracking', 'products', 'categories', 'banners', 'ads', 'users', 'earnings', 'settings', 'team'];

// POST /api/admin/assignRole — owner/superadmin gives a role to a user by mobile number.
router.post('/assignRole', requireAuth, async (req: Request, res: Response) => {
  if (!['owner', 'superadmin'].includes(req.user!.role)) return fail(res, 'Owner access required', 403);
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Valid mobile and role required', 422);
  const { mobile, role } = parsed.data;
  const permissions = parsed.data.permissions.filter((p) => ALLOWED_PERMS.includes(p));
  if (role === 'admin' && permissions.length === 0) return fail(res, 'At least one permission required for admin', 422);

  const user = await prisma.user.findUnique({ where: { mobile } }).catch(() => null);
  if (!user) return fail(res, 'User not found for this mobile number', 404);

  const updated = await prisma.user.update({
    where: { mobile },
    data: {
      role,
      permissions: role === 'admin' ? permissions : [],
      backend_rider: role === 'rider',
    },
  });
  const { password, ...safe } = updated;
  void password;
  return ok(res, { message: `Role '${role}' assigned to ${mobile}`, user: safe });
});

// ---------------- Orders: admin update status ----------------
router.post('/orders/status', requireAuth, requireStaff('orders'), async (req: Request, res: Response) => {
  const orderId = String(req.body?.orderId || '');
  const status = String(req.body?.status || '');
  if (!orderId || !status) return fail(res, 'Order ID and status required', 422);
  const updated = await prisma.order
    .update({ where: { order_id: orderId }, data: { order_status: status, ...(status === 'Delivered' ? { delivered_at: new Date() } : {}) } })
    .catch(() => null);
  if (!updated) return fail(res, 'Order not found', 404);
  // Keep the customer's live-tracking status in sync (original syncTrackingStatus()).
  await prisma.$executeRawUnsafe('UPDATE tracking SET status = ?, updated_at = NOW() WHERE order_id = ?', status, orderId).catch(() => null);
  notifyCustomerStatus({ order_id: orderId, customer: updated.customer, order_status: status, user_id: updated.user_id }).catch(() => null);
  return ok(res, { message: 'Status updated' });
});

// ---------------- Orders: admin delete (fake / test orders) ----------------
router.post('/orders/delete', requireAuth, requireStaff('orders'), async (req: Request, res: Response) => {
  const orderId = String(req.body?.orderId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!orderId) return fail(res, 'Order ID required', 422);
  // tracking rows go with the order (FK ON DELETE CASCADE)
  const removed = await prisma.order.delete({ where: { order_id: orderId } }).catch(() => null);
  if (!removed) return fail(res, 'Order not found', 404);
  const dir = path.join(process.cwd(), 'uploads', 'screenshots');
  for (const ext of ['jpeg', 'png', 'webp']) {
    await fs.promises.rm(path.join(dir, `${orderId}.${ext}`), { force: true }).catch(() => null);
  }
  return ok(res, { message: 'Order deleted' });
});

// ---------------- Orders: admin creates an order for a customer ----------------
// Original api/orders.php action=adminCreate: Cash order, no delivery fee, "Order Placed".
// Prices are taken from the products table, never from the request body.
const adminOrderSchema = z.object({
  customer: z.object({ name: z.string().trim().min(1).max(120), mobile: z.string().regex(/^[6-9]\d{9}$/) }),
  items: z.array(z.object({ id: z.number().int().positive(), quantity: z.number().int().min(1).max(999) })).min(1).max(50),
});

router.post('/orders/create', requireAuth, requireStaff('orders'), async (req: Request, res: Response) => {
  const parsed = adminOrderSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Customer name, valid mobile and at least one item required', 422);
  const { customer, items } = parsed.data;

  const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => BigInt(i.id)) } } });
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  const clean: Array<{ id: number; name: string; weight: string; price: number; quantity: number }> = [];
  for (const it of items) {
    const p = byId.get(it.id);
    if (!p) return fail(res, `Product #${it.id} not found`, 422);
    if (!p.in_stock) return fail(res, `${p.name} is out of stock`, 422);
    clean.push({ id: it.id, name: p.name, weight: p.weight || '', price: Number(p.price) || 0, quantity: it.quantity });
  }
  const total = clean.reduce((s, i) => s + i.price * i.quantity, 0);
  const owner = await prisma.user.findUnique({ where: { mobile: customer.mobile } }).catch(() => null);

  const order = await prisma.order.create({
    data: {
      order_id: '4A' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      user_id: owner ? owner.id : null,
      customer: { name: customer.name, mobile: customer.mobile, email: '', address: '', city: '', pincode: '824301' },
      items: clean,
      subtotal: total,
      discount: 0,
      delivery_charge: 0,
      total_amount: total,
      payment_method: 'Cash',
      order_status: 'Order Placed',
      order_date: new Date(),
      created_by: req.user!.username || 'admin',
    },
  });
  return ok(res, { message: 'Order created', order });
});

// ---------------- Users tab (customers + delivery boys) ----------------
// Original api/users.php actions: setDelivery, updateUser, createRider, delete, deleteInactive.
// Staff accounts (owner/admin) are managed in the Team tab and are protected here.
const STAFF = ['owner', 'superadmin', 'admin'];
const usernameRe = /^[a-z0-9._-]{3,32}$/;
const mobileRe = /^[6-9]\d{9}$/;
const strip = <T extends { password: string }>(u: T) => {
  const { password, ...rest } = u;
  void password;
  return rest;
};

router.post('/users', requireAuth, requireStaff('users'), async (req: Request, res: Response) => {
  const b = req.body || {};
  const action = String(b.action || '');

  if (action === 'setDelivery') {
    const mobile = String(b.mobile || '');
    const raw = b.customDelivery;
    const value = raw === null || raw === undefined || raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 1000)) return fail(res, 'Enter a valid amount (0 for free)', 422);
    const u = await prisma.user.update({ where: { mobile }, data: { custom_delivery: value } }).catch(() => null);
    if (!u) return fail(res, 'User not found', 404);
    return ok(res, { message: 'Delivery updated', user: strip(u) });
  }

  if (action === 'updateUser') {
    const id = Number(b.id || 0);
    const name = String(b.name || '').trim();
    const mobile = String(b.mobile || '').replace(/\D+/g, '');
    const username = String(b.username || '').trim().toLowerCase();
    const role = b.role === 'rider' ? 'rider' : 'customer';
    const password = String(b.password || '');
    if (!id || !name || !mobileRe.test(mobile) || !usernameRe.test(username)) return fail(res, 'Valid name, mobile and username required', 422);
    if (password && password.length < 4) return fail(res, 'Password must be at least 4 characters', 422);
    const target = await prisma.user.findUnique({ where: { id: BigInt(id) } });
    if (!target) return fail(res, 'User not found', 404);
    if (STAFF.includes(target.role)) return fail(res, 'Admin accounts are edited in the Team Access tab', 403);
    const clash = await prisma.user.findFirst({ where: { id: { not: BigInt(id) }, OR: [{ mobile }, { username }] } });
    if (clash) return fail(res, 'Mobile or username already used', 409);
    const u = await prisma.user.update({
      where: { id: BigInt(id) },
      data: { name, mobile, username, role, backend_rider: role === 'rider', ...(password ? { password: bcrypt.hashSync(password, 10) } : {}) },
    });
    if (password || target.role !== role) await prisma.refreshToken.updateMany({ where: { user_id: u.id }, data: { revoked: true } });
    return ok(res, { message: 'User updated', user: strip(u) });
  }

  if (action === 'createRider') {
    const name = String(b.name || '').trim();
    const mobile = String(b.mobile || '').replace(/\D+/g, '');
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!name || !mobileRe.test(mobile) || !usernameRe.test(username) || password.length < 4) {
      return fail(res, 'Enter name, valid mobile, username and 4+ character password.', 422);
    }
    const byUsername = await prisma.user.findUnique({ where: { username } });
    if (byUsername && byUsername.mobile !== mobile) {
      return fail(res, `This username is already registered as a ${byUsername.role === 'rider' ? 'delivery boy' : 'customer'}`, 409);
    }
    const byMobile = await prisma.user.findUnique({ where: { mobile } });
    const hash = bcrypt.hashSync(password, 10);
    if (byMobile) {
      if (byMobile.role === 'rider') return fail(res, 'This mobile number is already registered as a delivery boy', 409);
      if (STAFF.includes(byMobile.role)) return fail(res, 'This mobile belongs to an admin account', 409);
      const u = await prisma.user.update({ where: { mobile }, data: { name, username, password: hash, role: 'rider', backend_rider: true } });
      await prisma.refreshToken.updateMany({ where: { user_id: u.id }, data: { revoked: true } });
      return ok(res, { message: 'Customer account converted to delivery boy', user: strip(u) });
    }
    const u = await prisma.user.create({
      data: { name, mobile, username, password: hash, role: 'rider', backend_rider: true, registered_at: new Date(), last_login: null },
    });
    return ok(res, { message: 'Delivery boy account created', user: strip(u) });
  }

  if (action === 'delete') {
    const mobile = String(b.mobile || '');
    const target = await prisma.user.findUnique({ where: { mobile } });
    if (!target) return fail(res, 'User not found', 404);
    if (STAFF.includes(target.role)) return fail(res, 'Admin accounts cannot be deleted from the Users tab', 403);
    await prisma.user.delete({ where: { mobile } });
    return ok(res, { message: 'User deleted' });
  }

  if (action === 'deleteInactive') {
    const days = Math.max(1, Math.min(3650, Number(b.days) || 30));
    const cutoff = new Date(Date.now() - days * 86400000);
    // Last activity = last login, else registration (a just-created rider who has not logged in yet is kept).
    const all = await prisma.user.findMany({ where: { role: { notIn: STAFF } }, select: { id: true, last_login: true, registered_at: true, created_at: true } });
    const ids = all.filter((u) => (u.last_login || u.registered_at || u.created_at) < cutoff).map((u) => u.id);
    const result = ids.length ? await prisma.user.deleteMany({ where: { id: { in: ids } } }) : { count: 0 };
    return ok(res, { deleted: result.count });
  }

  return fail(res, 'Invalid action', 400);
});

// ---------------- Team Access (admin accounts) ----------------
// Original adminList / adminCreate / adminUpdate / adminDelete. In v2 admins are rows
// in `users` with role=admin, so each admin also needs a mobile number.
router.get('/team', requireAuth, requireStaff('team'), async (_req: Request, res: Response) => {
  const admins = await prisma.user.findMany({ where: { role: { in: STAFF } }, orderBy: { id: 'asc' } });
  return ok(res, { admins: admins.map(strip) });
});

const cleanPerms = (p: unknown) => (Array.isArray(p) ? [...new Set(p.map(String))].filter((x) => ALLOWED_PERMS.includes(x)) : []);

router.post('/team', requireAuth, requireStaff('team'), async (req: Request, res: Response) => {
  const b = req.body || {};
  const action = String(b.action || '');

  if (action === 'create') {
    const username = String(b.username || '').trim().toLowerCase();
    const name = String(b.name || '').trim();
    const mobile = String(b.mobile || '').replace(/\D+/g, '');
    const password = String(b.password || '');
    const permissions = cleanPerms(b.permissions);
    if (!usernameRe.test(username) || !name || !mobileRe.test(mobile) || password.length < 8 || !permissions.length) {
      return fail(res, 'Username, name, mobile, 8+ character password and permission required', 422);
    }
    const clash = await prisma.user.findFirst({ where: { OR: [{ username }, { mobile }] } });
    if (clash) {
      return fail(res, clash.username === username ? 'Username already exists' : 'This mobile already has an account — use "Give access to existing user" below', 409);
    }
    const u = await prisma.user.create({
      data: { name, mobile, username, password: bcrypt.hashSync(password, 10), role: 'admin', permissions, registered_at: new Date() },
    });
    return ok(res, { message: 'Admin account created', admin: strip(u) });
  }

  if (action === 'update') {
    const id = Number(b.id || 0);
    const name = String(b.name || '').trim();
    const password = String(b.password || '');
    const permissions = cleanPerms(b.permissions);
    if (!id || !name || !permissions.length) return fail(res, 'Name and at least one permission required', 422);
    if (password && password.length < 8) return fail(res, 'Password must be at least 8 characters', 422);
    const target = await prisma.user.findUnique({ where: { id: BigInt(id) } });
    if (!target || !STAFF.includes(target.role)) return fail(res, 'Admin account not found', 404);
    if (target.role !== 'admin') return fail(res, 'Owner account permissions are fixed', 403);
    const u = await prisma.user.update({
      where: { id: BigInt(id) },
      data: { name, permissions, ...(password ? { password: bcrypt.hashSync(password, 10) } : {}) },
    });
    if (password) await prisma.refreshToken.updateMany({ where: { user_id: u.id }, data: { revoked: true } });
    return ok(res, { message: 'Permissions updated', admin: strip(u) });
  }

  if (action === 'delete') {
    const id = Number(b.id || 0);
    if (id === Number(req.user!.sub)) return fail(res, 'You cannot delete your own account', 422);
    const target = await prisma.user.findUnique({ where: { id: BigInt(id) } });
    if (!target || !STAFF.includes(target.role)) return fail(res, 'Admin account not found', 404);
    if (target.role !== 'admin') return fail(res, 'Owner account cannot be deleted', 403);
    // Remove admin access (account stays as a normal customer; order history is kept) and end sessions.
    await prisma.user.update({ where: { id: target.id }, data: { role: 'customer', permissions: [] } });
    await prisma.refreshToken.updateMany({ where: { user_id: target.id }, data: { revoked: true } });
    return ok(res, { message: 'Admin access removed' });
  }

  return fail(res, 'Invalid action', 400);
});

// ---------------- Ads & Social (poster editor library) ----------------
// Port of api/ads.php. The editor state is stored as-is under `creative` so a design
// can be reopened. Uploaded images arrive as data: URLs; they are written to
// uploads/ads and replaced by same-origin URLs (keeps rows small, canvas untainted).
export const ADS_DIR = path.join(process.cwd(), 'uploads', 'ads');
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/;

async function extractDataUrls(value: unknown, depth = 0): Promise<unknown> {
  if (depth > 8) return value;
  if (typeof value === 'string') {
    const m = DATA_URL_RE.exec(value);
    if (!m) return value.startsWith('data:') ? '' : value; // drop other data: payloads (svg/html)
    const buf = Buffer.from(m[2], 'base64');
    const ext = sniffImage(buf);
    if (!ext || buf.length > 5 * 1024 * 1024) return '';
    await fs.promises.mkdir(ADS_DIR, { recursive: true });
    const name = `ad_${Date.now()}_${crypto.randomBytes(5).toString('hex')}.${ext}`;
    await fs.promises.writeFile(path.join(ADS_DIR, name), buf);
    return `/api/uploads/ads/${name}`;
  }
  if (Array.isArray(value)) return Promise.all(value.map((v) => extractDataUrls(v, depth + 1)));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await extractDataUrls(v, depth + 1);
    return out;
  }
  return value;
}

type AdRow = { id: number; data: string | Record<string, unknown>; created_at: Date; updated_at: Date };
const parseAd = (r: AdRow) => {
  const d = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as Record<string, unknown>;
  return { ...d, id: Number(r.id), createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString() };
};
const txt = (v: unknown, max: number, dflt = '') => (v === undefined || v === null ? dflt : String(v).slice(0, max));

function normalizeAd(a: Record<string, unknown>, ex: Record<string, unknown> = {}) {
  const pick = (k: string, max: number, dflt = '') => txt(a[k] ?? ex[k], max, dflt);
  const creative = a.creative !== undefined ? a.creative : ex.creative;
  return {
    name: pick('name', 200, 'Untitled Ad'),
    campaign: pick('campaign', 200),
    offerTitle: pick('offerTitle', 300),
    productId: a.productId !== undefined ? a.productId : (ex.productId ?? null),
    productName: pick('productName', 200),
    format: ['1:1', '4:5', '9:16', '16:9'].includes(String(a.format ?? ex.format)) ? String(a.format ?? ex.format) : '1:1',
    platform: pick('platform', 40, 'all'),
    status: ['draft', 'ready', 'scheduled', 'published', 'failed'].includes(String(a.status ?? ex.status)) ? String(a.status ?? ex.status) : 'draft',
    template: pick('template', 60, 'todays-offer'),
    creative: creative && typeof creative === 'object' ? creative : {},
    caption: pick('caption', 5000),
    hashtags: pick('hashtags', 2000),
    image: pick('image', 500),
    ctaLink: pick('ctaLink', 500),
  };
}

// INSERT + LAST_INSERT_ID() must run on the same pooled connection → interactive transaction.
const insertAd = (data: unknown) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('INSERT INTO ad_creatives (data) VALUES (?)', JSON.stringify(data));
    return (await tx.$queryRawUnsafe<AdRow[]>('SELECT * FROM ad_creatives WHERE id = LAST_INSERT_ID()'))[0];
  });

router.get('/ads', requireAuth, requireStaff('ads'), async (req: Request, res: Response) => {
  if (req.query.id !== undefined) {
    const rows = await prisma.$queryRawUnsafe<AdRow[]>('SELECT * FROM ad_creatives WHERE id = ?', Number(req.query.id) || 0);
    if (!rows[0]) return fail(res, 'Ad not found', 404);
    return ok(res, { ad: parseAd(rows[0]) });
  }
  const rows = await prisma.$queryRawUnsafe<AdRow[]>('SELECT * FROM ad_creatives ORDER BY id ASC');
  return ok(res, { ads: rows.map(parseAd) });
});

router.post('/ads', requireAuth, requireStaff('ads'), async (req: Request, res: Response) => {
  const action = String(req.body?.action || '');
  const load = async (id: number) => (await prisma.$queryRawUnsafe<AdRow[]>('SELECT * FROM ad_creatives WHERE id = ?', id))[0];

  if (action === 'add' || action === 'update') {
    const payload = req.body?.ad;
    if (!payload || typeof payload !== 'object') return fail(res, 'Ad data required', 422);
    const clean = (await extractDataUrls(payload)) as Record<string, unknown>;
    if (action === 'add') {
      const row = await insertAd(normalizeAd(clean));
      return ok(res, { message: 'Ad saved', ad: parseAd(row) });
    }
    const id = Number(clean.id || req.body?.id || 0);
    const row = id ? await load(id) : undefined;
    if (!row) return fail(res, 'Ad not found', 404);
    const ad = normalizeAd(clean, parseAd(row));
    await prisma.$executeRawUnsafe('UPDATE ad_creatives SET data = ? WHERE id = ?', JSON.stringify(ad), id);
    return ok(res, { message: 'Ad updated', ad: { ...ad, id } });
  }

  if (action === 'delete') {
    const id = Number(req.body?.id || 0);
    const n = await prisma.$executeRawUnsafe('DELETE FROM ad_creatives WHERE id = ?', id);
    if (!n) return fail(res, 'Ad not found', 404);
    return ok(res, { message: 'Ad deleted' });
  }

  if (action === 'duplicate') {
    const id = Number(req.body?.id || 0);
    const row = id ? await load(id) : undefined;
    if (!row) return fail(res, 'Ad not found', 404);
    const orig = parseAd(row) as Record<string, unknown>;
    const copy = { ...normalizeAd(orig), name: `${txt(orig.name, 190, 'Ad')} (Copy)`, status: 'draft' };
    const created = await insertAd(copy);
    return ok(res, { message: 'Ad duplicated', ad: parseAd(created) });
  }

  return fail(res, 'Invalid action', 400);
});

// ---------------- Pages (CMS: Privacy / Terms / Help / Delete Account ...) ----------------
const pageSchema = z.object({
  id: z.number().int().positive().optional(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  title: z.string().trim().min(1).max(200),
  metaDescription: z.string().trim().max(300).optional().default(''),
  metaKeywords: z.string().trim().max(500).optional().default(''),
  // HTML; sanitised again with DOMPurify wherever it is rendered.
  content: z.string().max(200_000).optional().default(''),
  showInFooter: z.boolean().optional().default(true),
  published: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(9999).optional().default(0),
});
// Routes the SPA already owns — a CMS page must not shadow them.
const RESERVED_SLUGS = ['admin', 'api', 'products', 'product', 'cart', 'checkout', 'orders', 'track', 'login', 'profile', 'rider', 'page', 'legacy', 'legacy-pages'];
// Cheap server-side strip of active content; the renderer sanitises fully.
const stripActive = (html: string) =>
  html
    .replace(/<\s*(script|iframe|object|embed|style|link|meta|base|form)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');

router.get('/pages', requireAuth, requireStaff('settings'), async (_req: Request, res: Response) => {
  const rows = await prisma.$queryRawUnsafe<PageRow[]>('SELECT * FROM pages ORDER BY sort_order ASC, id ASC');
  return ok(res, { pages: rows.map(toPage) });
});

router.post('/pages', requireAuth, requireStaff('settings'), async (req: Request, res: Response) => {
  const action = String(req.body?.action || '');

  if (action === 'delete') {
    const id = Number(req.body?.id || 0);
    const n = await prisma.$executeRawUnsafe('DELETE FROM pages WHERE id = ?', id);
    if (!n) return fail(res, 'Page not found', 404);
    return ok(res, { message: 'Page deleted' });
  }
  if (action !== 'add' && action !== 'update') return fail(res, 'Invalid action', 400);

  const parsed = pageSchema.safeParse(req.body?.page);
  if (!parsed.success) return fail(res, 'Title and a valid slug (a-z, 0-9, -) are required', 422);
  const p = parsed.data;
  if (RESERVED_SLUGS.includes(p.slug)) return fail(res, `Slug "${p.slug}" is reserved`, 422);
  const clash = await prisma.$queryRawUnsafe<Array<{ id: number }>>('SELECT id FROM pages WHERE slug = ?', p.slug);
  if (clash[0] && (action === 'add' || Number(clash[0].id) !== p.id)) return fail(res, `Slug "${p.slug}" is already used`, 409);

  const values = [p.slug, p.title, p.metaDescription || null, p.metaKeywords || null, stripActive(p.content), p.showInFooter ? 1 : 0, p.published ? 1 : 0, p.sortOrder];
  if (action === 'add') {
    await prisma.$executeRawUnsafe(
      'INSERT INTO pages (slug, title, meta_description, meta_keywords, content, show_in_footer, published, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ...values
    );
  } else {
    if (!p.id) return fail(res, 'Page id required', 422);
    const n = await prisma.$executeRawUnsafe(
      'UPDATE pages SET slug=?, title=?, meta_description=?, meta_keywords=?, content=?, show_in_footer=?, published=?, sort_order=? WHERE id=?',
      ...values, p.id
    );
    if (!n) return fail(res, 'Page not found', 404);
  }
  const row = (await prisma.$queryRawUnsafe<PageRow[]>('SELECT * FROM pages WHERE slug = ?', p.slug))[0];
  return ok(res, { message: action === 'add' ? 'Page added' : 'Page updated', page: toPage(row) });
});

// ---------------- Settings tab extras ----------------
router.get('/settings', requireAuth, requireStaff('settings'), async (_req: Request, res: Response) => {
  const s = (await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM settings WHERE id = 1'))[0] || {};
  return ok(res, {
    settings: {
      storeEmail: s.store_email ?? '',
      deliveryCharge: Number(s.delivery_charge ?? 0),
      freeDeliveryAbove: Number(s.free_delivery_above ?? 0),
      handlingCharge: Number(s.handling_charge ?? 0),
      // New toggle columns: default to delivery ON / handling OFF / alerts ON when the column
      // doesn't exist yet (before charges-settings.sql is applied).
      deliveryChargeEnabled: s.delivery_charge_enabled == null ? true : !!s.delivery_charge_enabled,
      handlingChargeEnabled: s.handling_charge_enabled == null ? false : !!s.handling_charge_enabled,
      staffOrderAlertsEnabled: s.staff_order_alerts_enabled == null ? true : !!s.staff_order_alerts_enabled,
      upiId: s.upi_id ?? '',
      upiName: s.upi_name ?? '',
      hideMrp: !!s.hide_mrp,
      storePhone: s.store_phone ?? '',
      storeAddress: s.store_address ?? '',
      storeLatitude: s.store_latitude ?? null,
      storeLongitude: s.store_longitude ?? null,
      serviceableVillages: s.serviceable_villages ?? '',
    },
  });
});

// Common site footer (every storefront page). Legal links come from the `pages` table.
const footerUrl = z.string().trim().max(500).refine((v) => /^(\/(?!\/)|https?:\/\/|tel:|mailto:)/i.test(v), 'url');
const footerSchema = z.object({
  aboutTitle: z.string().trim().max(80),
  aboutText: z.string().trim().max(1000),
  addressTitle: z.string().trim().max(80),
  addressText: z.string().trim().max(500), // multi-line
  phone: z.string().trim().regex(/^[0-9+ -]{0,20}$/),
  linksTitle: z.string().trim().max(80),
  links: z.array(z.object({ label: z.string().trim().min(1).max(60), url: footerUrl })).max(12),
  legalTitle: z.string().trim().max(80),
  deliveryTitle: z.string().trim().max(80),
  deliveryLines: z.array(z.string().trim().max(200)).max(8), // {{upiId}} → admin UPI ID
  copyright: z.string().trim().max(200),
});

router.post('/footer', requireAuth, requireStaff('settings'), async (req: Request, res: Response) => {
  if (req.body?.reset === true) {
    await prisma.$executeRawUnsafe('UPDATE config SET footer = NULL WHERE id = 1');
    return ok(res, { message: 'Footer reset to default', footer: null });
  }
  const parsed = footerSchema.safeParse(req.body?.footer);
  if (!parsed.success) {
    const bad = parsed.error.issues[0]?.path.join('.') || 'footer';
    return fail(res, `Please check "${bad}" (links must start with /, https://, tel: or mailto:)`, 422);
  }
  await prisma.$executeRawUnsafe('UPDATE config SET footer = ? WHERE id = 1', JSON.stringify(parsed.data));
  return ok(res, { message: 'Footer saved', footer: parsed.data });
});

export const FESTIVALS = ['', 'diwali', 'navratri', 'eid', 'christmas', 'holi', 'ipl', 'rakhi', 'independence'];

router.post('/festival', requireAuth, requireStaff('settings'), async (req: Request, res: Response) => {
  const festival = String(req.body?.festival ?? '');
  if (!FESTIVALS.includes(festival)) return fail(res, 'Unknown festival', 422);
  await prisma.$executeRawUnsafe('UPDATE config SET current_festival = ? WHERE id = 1', festival || null);
  return ok(res, { message: 'Festival updated', festival });
});

// Original api/bump-cache.php: every client reloads fresh code when assetVersion changes.
router.post('/cache/bump', requireAuth, requireStaff('settings'), async (_req: Request, res: Response) => {
  await prisma.$executeRawUnsafe('UPDATE app_version SET asset_version = asset_version + 1 WHERE id = 1');
  const row = (await prisma.$queryRawUnsafe<Array<{ asset_version: number }>>('SELECT asset_version FROM app_version WHERE id = 1'))[0];
  return ok(res, { assetVersion: Number(row?.asset_version ?? 1) });
});

// ---------------- Feature flags ----------------
// Admin toggles for optional app/web features. Stored as a JSON object in the
// `config.features` LONGTEXT column (added by prisma/features-column.sql). Every
// known key is a boolean; an absent key means ON (see src/utils/features.ts).
// Only the known keys are accepted and only booleans are stored.
const featuresSchema = z.object({
  features: z.record(z.boolean()),
});

router.post('/features', requireAuth, requireStaff('settings'), async (req: Request, res: Response) => {
  const parsed = featuresSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'Each feature flag must be true or false', 422);
  const incoming = parsed.data.features;
  const unknown = Object.keys(incoming).filter((k) => !(FEATURE_KEYS as string[]).includes(k));
  if (unknown.length) return fail(res, `Unknown feature flag(s): ${unknown.join(', ')}`, 422);
  // Merge onto the current stored flags so a partial save only changes the sent keys.
  const cur = (await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT features FROM config WHERE id = 1'))[0] || {};
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v ?? null);
  const merged = { ...mergeFeatures(parse(cur.features)), ...incoming };
  const features = mergeFeatures(merged);
  await prisma.$executeRawUnsafe('UPDATE config SET features = ? WHERE id = 1', JSON.stringify(features));
  return ok(res, { message: 'Features saved', features });
});

// ---------------- Global SEO config ----------------
// Mirrors SeoConfig in src/seo/localSeo.ts. Stored as JSON in config.seo LONGTEXT
// (added by prisma/seo.sql). Partial payloads are fine — mergeSeoConfig fills any
// missing field from the settings-derived local defaults before saving.
const seoSchema = z.object({
  titleTemplate: z.string().trim().max(120).optional(),
  defaultDescription: z.string().trim().max(500).optional(),
  defaultKeywords: z.string().trim().max(1000).optional(),
  defaultOgImage: z.string().trim().max(500).optional(),
  robotsExtra: z.string().max(2000).optional(),
  social: z
    .object({
      whatsapp: z.string().trim().max(300).optional().default(''),
      instagram: z.string().trim().max(300).optional().default(''),
      facebook: z.string().trim().max(300).optional().default(''),
    })
    .optional(),
  business: z
    .object({
      name: z.string().trim().max(120).optional(),
      address: z.string().trim().max(500).optional(),
      phone: z.string().trim().max(20).optional(),
      geo: z
        .object({
          lat: z.coerce.number().min(-90).max(90).optional(),
          lng: z.coerce.number().min(-180).max(180).optional(),
        })
        .optional(),
      openingHours: z.string().trim().max(120).optional(),
      priceRange: z.string().trim().max(20).optional(),
      areaServed: z.array(z.string().trim().max(80)).max(30).optional(),
    })
    .optional(),
});

router.post('/seo', requireAuth, requireStaff('settings'), async (req: Request, res: Response) => {
  const parsed = seoSchema.safeParse(req.body?.seo ?? req.body ?? {});
  if (!parsed.success) return fail(res, 'Please check the SEO values (template, keywords, business details)', 422);
  // Read the settings row so business defaults stay in sync, then persist the merged blob.
  const settingsRows = await prisma
    .$queryRawUnsafe<SettingsRow[]>('SELECT * FROM settings WHERE id = 1')
    .catch(() => [] as SettingsRow[]);
  const seo = mergeSeoConfig(parsed.data, settingsRows[0] || null);
  await prisma.$executeRawUnsafe('UPDATE config SET seo = ? WHERE id = 1', JSON.stringify(seo));
  return ok(res, { message: 'SEO settings saved', seo });
});

export default router;
