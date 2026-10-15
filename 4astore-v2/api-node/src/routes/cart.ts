import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { qtyLimitMessage } from '../utils/qtyLimit';

const router = Router();

/**
 * POST /api/cart/validate — PUBLIC (no auth), read-only.
 *
 * The storefront cart is client-side only (Zustand + localStorage); this
 * endpoint lets the storefront confirm each line against the AUTHORITATIVE
 * per-product `max_qty_per_order` cap read fresh from the DB. It NEVER trusts a
 * client-sent limit — only the requested quantity is read from the body; the
 * cap always comes from the DB. The bilingual message matches the server-side
 * order-placement enforcement (shared qtyLimitMessage()).
 *
 * Body: [{ id, quantity }, ...]
 * Response: { success:true, lines: [{ id, name, unit, maxQty, requested, ok, allowed, message }] }
 *   maxQty  — the authoritative cap (null = no limit / unlimited)
 *   ok      — true when within the limit (or unlimited)
 *   allowed — the quantity the client should clamp to (min(requested, maxQty))
 *   message — bilingual "Max N allowed / सिर्फ N तक" when over the cap, else null
 */
const validateSchema = z
  .array(z.object({ id: z.number().int().positive(), quantity: z.number().positive() }))
  .min(1)
  .max(50);

router.post('/validate', async (req: Request, res: Response) => {
  const parsed = validateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'A non-empty list of { id, quantity } is required', 422);
  const lines = parsed.data;

  const ids = [...new Set(lines.map((l) => l.id))];
  const products = await prisma.product.findMany({
    where: { id: { in: ids.map((id) => BigInt(id)) } },
    select: { id: true, name: true, unit: true, max_qty_per_order: true },
  });
  const byId = new Map(products.map((p) => [Number(p.id), p]));

  const result = lines.map((l) => {
    const p = byId.get(l.id);
    if (!p) {
      // Unknown product — treat as unlimited (no cap to enforce), ok:true.
      return { id: l.id, name: null, unit: null, maxQty: null, requested: l.quantity, ok: true, allowed: l.quantity, message: null };
    }
    const unit = p.unit || 'pcs';
    const maxQty = p.max_qty_per_order == null ? null : Number(p.max_qty_per_order);
    const within = maxQty == null || l.quantity <= maxQty;
    return {
      id: l.id,
      name: p.name,
      unit,
      maxQty,
      requested: l.quantity,
      ok: within,
      allowed: maxQty == null ? l.quantity : Math.min(l.quantity, maxQty),
      message: within ? null : qtyLimitMessage(maxQty as number, unit),
    };
  });

  return ok(res, { lines: result });
});

export default router;
