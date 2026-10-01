import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireAuth } from '../auth/middleware';

// Saved delivery addresses — mirrors the original api/addresses.php.
// Every query is scoped to the logged-in user's id.
const router = Router();
router.use(requireAuth);

type Row = Record<string, unknown>;

async function listFor(userId: number): Promise<Row[]> {
  return prisma.$queryRawUnsafe<Row[]>(
    'SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC',
    userId
  );
}

// GET /api/addresses — my saved addresses (default first)
router.get('/', async (req: Request, res: Response) => {
  return ok(res, { addresses: await listFor(req.user!.sub) });
});

const addressSchema = z.object({
  id: z.number().int().positive().optional(),
  label: z.enum(['Home', 'Work', 'Other']).catch('Other'),
  receiver_name: z.string().trim().min(1),
  phone: z.string().transform((v) => v.replace(/\D+/g, '')).pipe(z.string().regex(/^[6-9]\d{9}$/)),
  house_no: z.string().trim().min(1),
  landmark: z.string().trim().optional().default(''),
  city: z.string().trim().min(1),
  district: z.string().trim().optional().default('Aurangabad'),
  state: z.string().trim().optional().default('Bihar'),
  pincode: z.literal('824301'),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  full_address: z.string().trim().optional().default(''),
  is_default: z.boolean().optional(),
});

// POST /api/addresses  { action: 'create' | 'update' | 'delete', ... }
router.post('/', async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const action = String(req.body?.action || 'create');

  if (action === 'delete') {
    const id = Number(req.body?.id || 0);
    const removed = await prisma.$executeRawUnsafe('DELETE FROM addresses WHERE id = ? AND user_id = ?', id, userId);
    if (!removed) return fail(res, 'Address not found', 404);
    return ok(res);
  }

  if (action !== 'create' && action !== 'update') return fail(res, 'Invalid action', 400);

  const parsed = addressSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Complete address and serviceable pincode are required', 422);
  const a = parsed.data;
  const fullAddress = a.full_address || [a.house_no, a.city, a.district, a.state, a.pincode].filter(Boolean).join(', ');
  const values = [
    a.label, a.receiver_name, a.phone, a.house_no, a.landmark, fullAddress,
    a.city, a.district, a.state, a.pincode, a.latitude ?? null, a.longitude ?? null,
  ];

  let id: number;
  if (action === 'update') {
    if (!a.id) return fail(res, 'Address id required', 422);
    const changed = await prisma.$executeRawUnsafe(
      `UPDATE addresses SET label=?, receiver_name=?, phone=?, house_no=?, landmark=?, full_address=?,
         city=?, district=?, state=?, pincode=?, latitude=?, longitude=? WHERE id=? AND user_id=?`,
      ...values, a.id, userId
    );
    // MySQL reports 0 affected rows when nothing changed, so confirm ownership explicitly.
    if (!changed) {
      const exists = await prisma.$queryRawUnsafe<Row[]>('SELECT id FROM addresses WHERE id=? AND user_id=?', a.id, userId);
      if (!exists.length) return fail(res, 'Address not found', 404);
    }
    id = a.id;
  } else {
    // Same connection for INSERT + LAST_INSERT_ID (the pool could otherwise hand us another one).
    id = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO addresses (user_id, label, receiver_name, phone, house_no, landmark, full_address,
           city, district, state, pincode, latitude, longitude) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        userId, ...values
      );
      const last = await tx.$queryRawUnsafe<Array<{ id: bigint }>>('SELECT LAST_INSERT_ID() AS id');
      return Number(last[0].id);
    });
  }

  // First address (or an explicit request) becomes the default.
  const defaults = await prisma.$queryRawUnsafe<Row[]>('SELECT id FROM addresses WHERE user_id=? AND is_default=1', userId);
  if (a.is_default || defaults.length === 0) {
    await prisma.$executeRawUnsafe('UPDATE addresses SET is_default = (id = ?) WHERE user_id = ?', id, userId);
  }

  const saved = await prisma.$queryRawUnsafe<Row[]>('SELECT * FROM addresses WHERE id=?', id);
  return ok(res, { address: saved[0] });
});

export default router;
