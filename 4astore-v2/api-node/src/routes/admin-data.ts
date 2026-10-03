/**
 * Owner-only DB tools (mounted under /api/admin):
 *   POST /api/admin/data/import  → idempotent import of root data/*.json (shared with the CLI)
 *   POST /api/admin/data/reset   → FACTORY RESET (destructive) + re-seed default owner
 *   GET  /api/admin/data/status  → row counts + ownerExists
 *
 * Every route is guarded by requireAuth + requireOwner (role === 'owner' only —
 * NOT superadmin/admin). The import logic is the single source of truth in
 * ../services/dataImport (also used by scripts/import-legacy-json.ts).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireAuth, requireOwner } from '../auth/middleware';
import { runImport, seedDefaultOwner } from '../services/dataImport';

const router = Router();

router.use(requireAuth, requireOwner);

// ---------- POST /api/admin/data/import ----------
router.post('/data/import', async (_req: Request, res: Response) => {
  try {
    const summary = await runImport();
    return ok(res, { summary });
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Import failed', 500);
  }
});

// ---------- POST /api/admin/data/reset ----------
const resetSchema = z.object({ confirm: z.literal('RESET') });

router.post('/data/reset', async (req: Request, res: Response) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Type RESET to confirm', 422);

  try {
    // FK cascades exist, but TRUNCATE on FK-parent tables fails under MariaDB
    // unless FK checks are off. Toggle them so the wipe is clean regardless.
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
    try {
      // Business + auth data.
      await prisma.$executeRawUnsafe('TRUNCATE TABLE tracking');
      await prisma.$executeRawUnsafe('TRUNCATE TABLE orders');
      await prisma.$executeRawUnsafe('TRUNCATE TABLE addresses');
      await prisma.$executeRawUnsafe('TRUNCATE TABLE device_tokens');
      await prisma.$executeRawUnsafe('TRUNCATE TABLE email_otps');
      await prisma.$executeRawUnsafe('TRUNCATE TABLE refresh_tokens');
      await prisma.$executeRawUnsafe('TRUNCATE TABLE products');
      await prisma.$executeRawUnsafe('TRUNCATE TABLE categories');
      await prisma.$executeRawUnsafe('TRUNCATE TABLE ad_creatives');
      // Delete ALL users (including the owner) — a fresh owner is re-seeded below.
      await prisma.$executeRawUnsafe('TRUNCATE TABLE users');
      // Reset singleton CMS/config rows to empty defaults.
      await prisma.$executeRawUnsafe('DELETE FROM config');
      await prisma.$executeRawUnsafe(
        `INSERT INTO config (id, banners, festival_ads, festival_categories, ads, social_proof_messages, social_proof_names, current_festival, footer)
         VALUES (1, '[]', '{}', '{}', '[]', '[]', '[]', '', NULL)`
      );
      await prisma.$executeRawUnsafe('DELETE FROM settings');
      await prisma.$executeRawUnsafe('INSERT INTO settings (id) VALUES (1)');
      await prisma.$executeRawUnsafe('DELETE FROM announcements');
      await prisma.$executeRawUnsafe(
        `INSERT INTO announcements (row_id, id, text, image, target, cta_text, cta_link, enabled)
         VALUES (1, 0, '', '', 'all', '', '', 0)`
      );
    } finally {
      await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
    }

    // Never leave the system without a login.
    const ownerSeeded = await seedDefaultOwner();
    return ok(res, { reset: true, ownerSeeded });
  } catch (e) {
    // Best-effort re-enable in case we threw before the finally ran.
    await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1').catch(() => null);
    return fail(res, e instanceof Error ? e.message : 'Reset failed', 500);
  }
});

// ---------- GET /api/admin/data/status ----------
router.get('/data/status', async (_req: Request, res: Response) => {
  const [users, products, categories, orders, owners] = await Promise.all([
    prisma.user.count(),
    prisma.product.count(),
    prisma.category.count(),
    prisma.order.count(),
    prisma.user.count({ where: { role: 'owner' } }),
  ]);
  return ok(res, { counts: { users, products, categories, orders }, ownerExists: owners > 0 });
});

export default router;
