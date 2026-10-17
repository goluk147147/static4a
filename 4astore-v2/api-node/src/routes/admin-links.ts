// Admin short-links API — staff-gated management of the universal short-link
// subsystem (see services/shortLink.ts). Mounted at /api/admin/links in
// server.ts BEFORE the generic /api/admin router.
//
//   GET  /api/admin/links  → newest-first list of links (bounded)
//   POST /api/admin/links  → create a short link for ANY url; 409 on a
//                            duplicate custom code.
//   PATCH /api/admin/links/:code → edit an existing link's custom OG
//                            image/title ONLY (target_url/type immutable);
//                            404 on an unknown code, 422 on a bad image URL.
//
// Gating mirrors routes/marketing.ts: every route requires a logged-in staff
// member with the "ads" permission.

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireAuth, requireStaff } from '../auth/middleware';
import { createCustomShortLink, updateCustomShortLink, ShortCodeTakenError, ShortLinkNotFoundError } from '../services/shortLink';

const router = Router();

// Every admin-links route is staff-gated on the "ads" permission.
router.use(requireAuth, requireStaff('ads'));

// GET /api/admin/links — newest-first, bounded. Returns the client-useful
// fields only (never the internal numeric id).
router.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const rows = await prisma.shortLink.findMany({
    orderBy: { id: 'desc' },
    take: limit,
    select: { code: true, target_url: true, type: true, clicks: true, created_at: true, og_image: true, og_title: true },
  });
  return ok(res, { links: rows });
});

const createSchema = z.object({
  targetUrl: z.string().min(1).max(1000),
  type: z.string().max(16).optional(),
  code: z
    .string()
    .regex(/^[A-Za-z0-9]{1,16}$/, 'Custom code must be 1–16 letters or digits')
    .optional(),
  // Optional OG preview overrides (CUSTOM links only). Empty strings are allowed;
  // the service validator enforces the http(s) rule and converts empty → null, so
  // a bad image URL surfaces here as a 422 via the catch below.
  ogImage: z.string().max(1000).optional(),
  ogTitle: z.string().max(255).optional(),
});

// POST /api/admin/links — create a short link for ANY url. A duplicate custom
// code returns 409; any other validation problem returns 422.
router.post('/', async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'A valid target URL is required', 422);

  const createdBy = req.user?.username || 'admin';
  try {
    const link = await createCustomShortLink({ ...parsed.data, createdBy });
    return ok(res, { message: 'Short link created', link });
  } catch (e) {
    if (e instanceof ShortCodeTakenError) return fail(res, e.message, 409);
    const msg = e instanceof Error ? e.message : 'Could not create short link';
    return fail(res, msg, 422);
  }
});

// PATCH /api/admin/links/:code — edit an existing link's custom OG preview
// (image/title) ONLY; target_url/type stay immutable. An unknown code returns
// 404; a bad image URL (or other validation problem) returns 422.
const updateSchema = z.object({
  ogImage: z.string().max(1000).optional(),
  ogTitle: z.string().max(255).optional(),
});

router.patch('/:code', async (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'Invalid preview fields', 422);

  try {
    const link = await updateCustomShortLink(req.params.code, parsed.data);
    return ok(res, { message: 'Short link updated', link });
  } catch (e) {
    if (e instanceof ShortLinkNotFoundError) return fail(res, e.message, 404);
    const msg = e instanceof Error ? e.message : 'Could not update short link';
    return fail(res, msg, 422);
  }
});

export default router;
