import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireAuth } from '../auth/middleware';
import { serviceableVillage, currentLocationServiceable } from '../utils/serviceability';
import { notifyStaffNewOrder } from '../services/push';

const router = Router();

function isStaff(role: string, perms: string[]): boolean {
  if (role === 'owner' || role === 'superadmin') return true;
  if (role === 'admin') return perms.includes('*') || perms.includes('orders');
  return false;
}

async function getSettingsRow(): Promise<Record<string, unknown>> {
  const s = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM settings WHERE id = 1');
  return s[0] || {};
}

// GET /api/orders — customer sees own (by mobile); staff/rider see all.
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const viewer = req.user!;
  const staff = isStaff(viewer.role, viewer.permissions) || (viewer.role === 'rider' && (viewer.mode || 'rider') === 'rider');
  const mobile = (req.query.mobile as string) || '';

  if (!mobile && !staff) return fail(res, 'User mobile or staff access required', 403);
  if (mobile && !staff && viewer.mobile !== mobile) return fail(res, 'Access denied', 403);

  if (staff && !mobile) {
    // Opt-in keyset pagination: when EITHER limit or cursor is present, page by
    // descending id and return { orders, nextCursor }. When BOTH are absent the
    // behaviour and response shape are exactly the original unpaginated list.
    const limitRaw = Number(req.query.limit);
    const cursorRaw = String(req.query.cursor || '').trim();
    const hasLimit = Number.isFinite(limitRaw);
    const hasCursor = /^\d+$/.test(cursorRaw);
    try {
      if (hasLimit || hasCursor) {
        const take = hasLimit ? Math.min(200, Math.max(1, Math.trunc(limitRaw))) : 50;
        const orders = await prisma.order.findMany({
          where: hasCursor ? { id: { lt: BigInt(cursorRaw) } } : {},
          orderBy: { id: 'desc' },
          take,
        });
        const nextCursor = orders.length === take ? orders[orders.length - 1].id.toString() : null;
        return ok(res, { orders, nextCursor });
      }
      const orders = await prisma.order.findMany({ orderBy: { id: 'desc' } });
      return ok(res, { orders });
    } catch {
      return fail(res, 'Could not load orders', 500);
    }
  }
  const target = mobile || viewer.mobile;
  // Prefer the indexed owner FK (user_id) over the unindexable JSON-path
  // `customer -> '$.mobile'` scan. When the viewer is the logged-in owner
  // (no explicit `mobile` override), match either their user_id OR the mobile
  // JSON-path so legacy orders with a null user_id still show up — the result
  // set, ordering (id desc) and JSON shape are unchanged.
  // Prisma JSON-path filter (not raw SQL): raw queries return JSON columns as
  // strings, which broke `items.map` on the client.
  // The app always sends ?mobile=<own mobile>, so also use the owner id when the
  // requested mobile IS the viewer's own — otherwise orders placed with a different
  // delivery phone would never appear in My Orders.
  const canUseOwnerId = !!viewer.sub && target === viewer.mobile;
  const where = canUseOwnerId
    ? {
        OR: [
          { user_id: BigInt(viewer.sub) },
          { customer: { path: '$.mobile', equals: target } },
        ],
      }
    : { customer: { path: '$.mobile', equals: target } };
  try {
    const orders = await prisma.order.findMany({
      where,
      orderBy: { id: 'desc' },
    });
    return ok(res, { orders });
  } catch {
    return fail(res, 'Could not load orders', 500);
  }
});

// POST /api/orders — place an order (customer).
const itemSchema = z.object({
  id: z.number(),
  name: z.string(),
  weight: z.string().optional().default(''),
  price: z.number(),
  quantity: z.number().min(1).max(999),
});

const saveSchema = z.object({
  order: z.object({
    orderId: z.string().optional(),
    customer: z.object({
      name: z.string().min(1),
      mobile: z.string().regex(/^[6-9]\d{9}$/),
      address: z.string().optional().default(''),
      city: z.string().optional().default(''),
      landmark: z.string().optional().default(''),
      pincode: z.string().optional().default(''),
      deliverySource: z.enum(['manual', 'current']).optional().default('manual'),
      deliveryLat: z.number().nullable().optional(),
      deliveryLng: z.number().nullable().optional(),
      email: z.string().optional().default(''),
    }),
    addressLabel: z.enum(['Home', 'Work', 'Other']).optional().default('Other'),
    items: z.array(itemSchema).min(1),
    subtotal: z.number(),
    discount: z.number().optional().default(0),
    deliveryCharge: z.number().optional().default(0),
    handlingCharge: z.number().optional().default(0),
    totalAmount: z.number(),
    paymentMethod: z.string().optional().default('UPI'),
    paymentReference: z.string(),
  }),
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Invalid order data', 422);
  const o = parsed.data.order;
  const c = o.customer;

  // 12-digit UTR required + unique.
  const utr = (o.paymentReference || '').replace(/\D+/g, '');
  if (!/^\d{12}$/.test(utr)) return fail(res, 'A valid 12-digit payment reference is required', 422);
  const dup = await prisma.order.findUnique({ where: { payment_reference: utr } }).catch(() => null);
  if (dup) return fail(res, 'This payment reference has already been used', 409);

  // Ownership is the logged-in account (user_id = JWT sub), NOT the delivery phone.
  // customer.mobile is the receiver's phone from the address form and may legitimately
  // differ from the account mobile (saved address for family, Google users whose account
  // mobile is a `g<digits>` placeholder, a JWT minted before /users/mobile/verify).
  // Comparing them blocked valid orders with "Order owner mismatch".
  // Guard instead against re-saving (upserting) an orderId that belongs to someone else.
  if (o.orderId) {
    const existing = await prisma.order.findUnique({ where: { order_id: o.orderId } }).catch(() => null);
    if (existing && req.user!.role !== 'superadmin' && existing.user_id != null && existing.user_id !== BigInt(req.user!.sub)) {
      return fail(res, 'Order owner mismatch', 403);
    }
  }

  // Serviceability: PIN 824301 OR serviceable village OR current GPS within 100km.
  const settings = await getSettingsRow();
  const isCurrent = c.deliverySource === 'current';
  if (!isCurrent) {
    if (String(c.pincode) !== '824301') return fail(res, 'Delivery is available only in PIN code 824301', 422);
    if (!serviceableVillage(c.city, String(settings.serviceable_villages || ''))) {
      return fail(res, 'This village is outside the 4A Store delivery area. Please select a village from the available list.', 422);
    }
  } else if (!currentLocationServiceable(c.deliveryLat, c.deliveryLng, Number(settings.store_latitude), Number(settings.store_longitude))) {
    return fail(res, 'Current location is outside the 4A Store delivery area. Please enter a manual Chandrargarh delivery address.', 422);
  }

  const orderId = o.orderId || '4A' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const deliveryAddress = {
    label: o.addressLabel,
    receiver_name: c.name,
    phone: c.mobile,
    house_no: c.address || '',
    landmark: c.landmark || '',
    full_address: [c.address, c.city, c.pincode].filter(Boolean).join(', '),
    city: c.city || '',
    state: 'Bihar',
    pincode: c.pincode || '',
    latitude: c.deliveryLat ?? null,
    longitude: c.deliveryLng ?? null,
    captured_at: new Date().toISOString(),
  };

  const created = await prisma.order.upsert({
    where: { order_id: orderId },
    create: {
      order_id: orderId,
      user_id: BigInt(req.user!.sub),
      customer: c,
      items: o.items,
      subtotal: o.subtotal,
      discount: o.discount,
      delivery_charge: o.deliveryCharge,
      total_amount: o.totalAmount,
      payment_method: o.paymentMethod,
      payment_reference: utr,
      order_status: 'Order Placed',
      order_date: new Date(),
      delivery_address: deliveryAddress,
    },
    update: {
      customer: c,
      items: o.items,
      total_amount: o.totalAmount,
      payment_reference: utr,
      delivery_address: deliveryAddress,
    },
  });

  // Notify admin/staff about the new order (topic 'admins' + direct staff tokens).
  // Only on first placement, not on idempotent re-saves of the same orderId.
  if (created.order_status === 'Order Placed' && created.reminder_count === 0) {
    notifyStaffNewOrder({
      order_id: created.order_id,
      customer: created.customer,
      items: created.items,
      total_amount: created.total_amount,
    }).catch(() => null);
  }
  return ok(res, { message: 'Order saved', order: created });
});

// POST /api/orders/accept — rider claims an unassigned order.
router.post('/accept', requireAuth, async (req: Request, res: Response) => {
  if (req.user!.role !== 'rider') return fail(res, 'Delivery mode required', 403);
  const orderId = String(req.body?.orderId || '').trim();
  if (!orderId) return fail(res, 'Order ID required', 422);

  const order = await prisma.order.findUnique({ where: { order_id: orderId } }).catch(() => null);
  if (!order) return fail(res, 'Order not found', 404);
  const riderKey = String(req.user!.sub);
  if (order.rider_id && order.rider_id !== riderKey) return fail(res, 'This order has already been assigned', 409);

  const updated = await prisma.order.update({
    where: { order_id: orderId },
    data: {
      rider_id: riderKey,
      rider_name: req.user!.name,
      rider_mobile: req.user!.mobile,
      assigned_at: order.assigned_at ?? new Date(),
      order_status: 'Rider Assigned',
    },
  });
  return ok(res, { message: 'Order accepted', order: updated });
});

// ---------------- Payment screenshots ----------------
// Stored outside any public/static folder; only the order owner or staff can read them.
const SCREENSHOT_DIR = path.join(process.cwd(), 'uploads', 'screenshots');
const SAFE_ORDER_ID = /^[A-Za-z0-9_-]{1,20}$/;

async function canAccessOrder(req: Request, orderId: string) {
  const order = await prisma.order.findUnique({ where: { order_id: orderId } }).catch(() => null);
  if (!order) return { order: null, allowed: false };
  const viewer = req.user!;
  const cust = (order.customer || {}) as { mobile?: string };
  const isOwnerById = order.user_id != null && viewer.sub != null && order.user_id === BigInt(viewer.sub);
  const allowed = isStaff(viewer.role, viewer.permissions) || isOwnerById || (!!viewer.mobile && cust.mobile === viewer.mobile);
  return { order, allowed };
}

// GET /api/orders/:orderId — one order (owner or staff with `orders`). Used by the app when a
// new-order push is tapped, so staff see who ordered and where it goes without loading all orders.
router.get('/:orderId', requireAuth, async (req: Request, res: Response) => {
  const orderId = req.params.orderId;
  if (!SAFE_ORDER_ID.test(orderId)) return fail(res, 'Invalid order id', 422);
  const { order, allowed } = await canAccessOrder(req, orderId);
  if (!order) return fail(res, 'Order not found', 404);
  if (!allowed) return fail(res, 'Access denied', 403);
  return ok(res, { order });
});

// POST /api/orders/:orderId/screenshot  { image: "data:image/jpeg;base64,..." }
router.post('/:orderId/screenshot', requireAuth, async (req: Request, res: Response) => {
  const orderId = req.params.orderId;
  if (!SAFE_ORDER_ID.test(orderId)) return fail(res, 'Invalid order id', 422);
  const { order, allowed } = await canAccessOrder(req, orderId);
  if (!order) return fail(res, 'Order not found', 404);
  if (!allowed) return fail(res, 'Access denied', 403);

  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
  if (!match) return fail(res, 'A JPG, PNG or WEBP image is required', 422);
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 4 * 1024 * 1024) return fail(res, 'Screenshot is too large (max 4 MB)', 413);

  const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
  await fs.promises.mkdir(SCREENSHOT_DIR, { recursive: true });
  // Remove any older screenshot for this order with a different extension.
  for (const e of ['jpeg', 'png', 'webp']) {
    await fs.promises.rm(path.join(SCREENSHOT_DIR, `${orderId}.${e}`), { force: true });
  }
  await fs.promises.writeFile(path.join(SCREENSHOT_DIR, `${orderId}.${ext}`), buffer);
  return ok(res, { message: 'Screenshot saved' });
});

// GET /api/orders/:orderId/screenshot — returns the image (owner or staff only)
router.get('/:orderId/screenshot', requireAuth, async (req: Request, res: Response) => {
  const orderId = req.params.orderId;
  if (!SAFE_ORDER_ID.test(orderId)) return fail(res, 'Invalid order id', 422);
  const { order, allowed } = await canAccessOrder(req, orderId);
  if (!order) return fail(res, 'Order not found', 404);
  if (!allowed) return fail(res, 'Access denied', 403);
  for (const e of ['jpeg', 'png', 'webp']) {
    const file = path.join(SCREENSHOT_DIR, `${orderId}.${e}`);
    if (fs.existsSync(file)) {
      res.setHeader('Cache-Control', 'private, no-store');
      return res.type(`image/${e}`).sendFile(file);
    }
  }
  return fail(res, 'No screenshot uploaded', 404);
});

export default router;
