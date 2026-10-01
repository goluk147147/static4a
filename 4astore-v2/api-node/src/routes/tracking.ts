import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireAuth, hasPermission } from '../auth/middleware';
import { roadRoute, validCoordinate } from '../utils/osrm';
import { config } from '../config';
import { notifyCustomerStatus } from '../services/push';

const router = Router();

// 'Rider Assigned' is one of the rider console buttons, so it must be accepted too.
const ALLOWED_STATUS = ['Order Placed', 'Confirmed', 'Packed', 'Rider Assigned', 'Out for Delivery', 'Delivered', 'Cancelled'];

async function getStoreLocation() {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'SELECT store_latitude, store_longitude, store_address FROM settings WHERE id = 1'
  );
  const row = rows[0] || {};
  return {
    latitude: Number(row.store_latitude ?? config.store.lat),
    longitude: Number(row.store_longitude ?? config.store.lng),
    name: '4A Store',
    address: row.store_address ?? '',
  };
}

async function getTrackingRow(orderId: string): Promise<Record<string, unknown> | null> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'SELECT * FROM tracking WHERE order_id = ?',
    orderId
  );
  return rows[0] || null;
}

// GET /api/tracking?orderId=... — live payload with OSRM route + ETA.
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const viewer = req.user!;
  const orderId = String(req.query.orderId || '').trim();

  const staff = hasPermission(viewer, 'riderTracking') || (viewer.role === 'rider' && (viewer.mode || 'rider') === 'rider');

  if (!orderId) {
    if (!staff) return fail(res, 'Staff access required', 403);
    const all = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM tracking');
    return ok(res, { all });
  }

  const order = await prisma.order.findUnique({ where: { order_id: orderId } }).catch(() => null);
  if (!order) return fail(res, 'Order not found', 404);

  // Ownership check for customers.
  if (!staff) {
    const cust = (order.customer || {}) as { mobile?: string };
    if (cust.mobile !== viewer.mobile) return fail(res, 'Access denied', 403);
  }

  const store = await getStoreLocation();
  const t = (await getTrackingRow(orderId)) || {};
  const dest = (order.delivery_address || {}) as { latitude?: number; longitude?: number };
  const destLat = dest.latitude ?? null;
  const destLng = dest.longitude ?? null;

  const riderHasGps = t.source === 'device_gps' && validCoordinate(t.lat, t.lng);
  const riderLocation = riderHasGps
    ? { latitude: Number(t.lat), longitude: Number(t.lng), heading: t.heading ?? null, speed: t.speed ?? null, accuracy: t.accuracy ?? null, updated_at: t.updated_at ?? null }
    : null;

  const originLat = riderLocation ? riderLocation.latitude : store.latitude;
  const originLng = riderLocation ? riderLocation.longitude : store.longitude;
  const route = riderLocation && destLat != null && destLng != null
    ? await roadRoute(originLat, originLng, Number(destLat), Number(destLng))
    : null;

  return ok(res, {
    tracking: {
      order_id: orderId,
      status: t.status ?? order.order_status,
      rider: {
        id: order.rider_id ?? null,
        name: t.rider_name ?? order.rider_name ?? '',
        phone: t.rider_mobile ?? order.rider_mobile ?? '',
        location: riderLocation,
      },
      customer: { latitude: destLat, longitude: destLng },
      store,
      route,
      updatedAt: t.updated_at ?? order.assigned_at ?? null,
    },
  });
});

// Ensure a tracking row exists for a rider-owned, open order.
async function ensureTrackingRow(orderId: string, riderKey: string): Promise<Record<string, unknown> | null> {
  const order = await prisma.order.findUnique({ where: { order_id: orderId } }).catch(() => null);
  if (!order) return null;
  if (String(order.rider_id ?? '') !== riderKey) return null;
  if (['Delivered', 'Cancelled'].includes(order.order_status)) return null;

  const existing = await getTrackingRow(orderId);
  if (!existing) {
    const dest = (order.delivery_address || {}) as { latitude?: number; longitude?: number };
    await prisma.$executeRawUnsafe(
      'INSERT INTO tracking (order_id, status, dest_lat, dest_lng, assigned_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
      orderId,
      order.order_status,
      dest.latitude ?? null,
      dest.longitude ?? null
    );
  }
  return order as unknown as Record<string, unknown>;
}

const locSchema = z.object({
  orderId: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().min(0).max(1000).optional(),
  heading: z.number().optional(),
  speed: z.number().min(0).optional(),
});

// POST /api/tracking/location — rider pushes GPS.
router.post('/location', requireAuth, async (req: Request, res: Response) => {
  if (req.user!.role !== 'rider') return fail(res, 'Delivery mode required', 403);
  const parsed = locSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Valid non-zero lat/lng required', 422);
  const { orderId, latitude, longitude, accuracy, heading, speed } = parsed.data;
  if (!validCoordinate(latitude, longitude)) return fail(res, 'Valid non-zero lat/lng required', 422);

  const riderKey = String(req.user!.sub);
  const order = await ensureTrackingRow(orderId, riderKey);
  if (!order) return fail(res, 'This order is not assigned to you', 403);

  await prisma.$executeRawUnsafe(
    `UPDATE tracking SET lat=?, lng=?, accuracy=?, heading=?, speed=?, source='device_gps',
       rider_name=?, rider_mobile=?,
       status = CASE WHEN status = 'Delivered' THEN status ELSE 'Out for Delivery' END,
       updated_at = NOW()
     WHERE order_id = ?`,
    latitude,
    longitude,
    accuracy ?? null,
    heading ?? null,
    speed ?? null,
    req.user!.name,
    req.user!.mobile,
    orderId
  );
  return ok(res, { message: 'Location updated' });
});

const statusSchema = z.object({ orderId: z.string().min(1), status: z.string() });

// POST /api/tracking/status — rider updates delivery status.
router.post('/status', requireAuth, async (req: Request, res: Response) => {
  if (req.user!.role !== 'rider') return fail(res, 'Delivery mode required', 403);
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success || !ALLOWED_STATUS.includes(parsed.data.status)) return fail(res, 'bad status', 422);
  const { orderId, status } = parsed.data;

  const riderKey = String(req.user!.sub);
  const order = await ensureTrackingRow(orderId, riderKey);
  if (!order) return fail(res, 'This order is not assigned to you', 403);

  await prisma.$executeRawUnsafe('UPDATE tracking SET status=?, updated_at=NOW() WHERE order_id=?', status, orderId);
  const updated = await prisma.order.update({
    where: { order_id: orderId },
    data: { order_status: status, ...(status === 'Delivered' ? { delivered_at: new Date() } : {}) },
  });
  notifyCustomerStatus({ order_id: orderId, customer: updated.customer, order_status: status, user_id: updated.user_id }).catch(() => null);
  return ok(res, { message: 'Status set' });
});

export default router;
