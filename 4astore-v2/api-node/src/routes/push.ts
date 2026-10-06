import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireAuth, requireStaff } from '../auth/middleware';
import { sendToTopic, sendToTokens, tokensForStaff, tokensForTopic, syncTokenTopics, clearTokenTopics, recordNotification, PushMessage } from '../services/push';

const router = Router();

/** Topics a user should be subscribed to, based on role/permissions. */
function topicsForUser(role: string, permissions: string[]): string[] {
  const topics = ['all'];
  if (role === 'rider') topics.push('riders');
  else topics.push('customers');
  if (role === 'owner' || role === 'superadmin') topics.push('admins');
  else if (role === 'admin' && (permissions.includes('*') || permissions.includes('orders'))) topics.push('admins');
  return topics;
}

const registerSchema = z.object({
  token: z.string().min(10),
  platform: z.enum(['android', 'ios', 'web']),
});

// POST /api/push/register — save/update this device's FCM token + topics.
router.post('/register', requireAuth, async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'token and platform required', 422);
  const { token, platform } = parsed.data;
  const topics = topicsForUser(req.user!.role, req.user!.permissions || []);

  // App launch + login can fire two near-simultaneous registrations for the SAME token, which
  // races Prisma's upsert and throws P2002 (unique token). Fall back to a plain update on conflict
  // so the register is reliable and the error log stays clean.
  try {
    await prisma.deviceToken.upsert({
      where: { token },
      create: { user_id: BigInt(req.user!.sub), token, platform, topics },
      update: { user_id: BigInt(req.user!.sub), platform, topics },
    });
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'P2002') {
      await prisma.deviceToken.update({
        where: { token },
        data: { user_id: BigInt(req.user!.sub), platform, topics },
      }).catch(() => null);
    } else {
      throw e;
    }
  }
  // FCM topics must be subscribed per token; do it server-side so role changes take effect
  // the next time the app registers (every launch/login).
  if (platform !== 'web') await syncTokenTopics(token, topics).catch(() => null);
  return ok(res, { topics });
});

// POST /api/push/unregister — remove a token (logout on device).
router.post('/unregister', requireAuth, async (req: Request, res: Response) => {
  const token = String(req.body?.token || '');
  if (token) {
    await prisma.deviceToken.deleteMany({ where: { token, user_id: BigInt(req.user!.sub) } });
    await clearTokenTopics(token).catch(() => null);
  }
  return ok(res);
});

const sendSchema = z.object({
  target: z.enum(['all', 'customers', 'riders', 'admins']).default('all'),
  title: z.string().min(1),
  body: z.string().min(1),
  link: z.string().optional(),
  image: z.string().optional(),
  productId: z.union([z.number(), z.string()]).optional(),
});

// POST /api/push/send — staff broadcast to a segment (needs 'ads' permission).
router.post('/send', requireAuth, requireStaff('ads'), async (req: Request, res: Response) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'target, title and body required', 422);
  const { target, title, body, link, productId } = parsed.data;
  // Keep the existing data.link passthrough unchanged (mobile already routes /product/:id).
  // Image only when the admin explicitly provides one — text-only pushes stay clean (title + body,
  // no big-picture banner), like Flipkart's minimal notifications.
  const image = parsed.data.image?.trim() || undefined;
  const msg: PushMessage = { title, body, data: link ? { link } : {}, image };
  const productIdBig = productId != null && String(productId).trim() !== '' ? BigInt(String(productId).trim()) : null;

  // Prefer an explicit-token multicast for every segment so the history row records a REAL
  // per-device success count (and prunes dead tokens). Fall back to a topic send only when no
  // tokens are subscribed in the DB (e.g. topic-only web devices), and when that topic send is a
  // no-op (FCM disabled → sendToTopic returns false) record the row as failed so the admin can
  // tell nothing actually went out instead of a misleading 0/0 "sent".
  const tokens =
    target === 'admins' ? await tokensForStaff('orders') : await tokensForTopic(target);
  let successCount = 0;
  let failureCount = 0;
  if (tokens.length) {
    successCount = await sendToTokens(tokens, msg);
    failureCount = tokens.length - successCount;
  } else {
    const delivered = await sendToTopic(target, msg);
    // No tokens to count: mark the row failed when the topic send didn't go out (FCM disabled/threw).
    failureCount = delivered ? 0 : 1;
  }
  // Best-effort history write — never blocks the push.
  await recordNotification(
    {
      type: 'broadcast',
      title,
      body,
      image,
      link: link ?? null,
      target,
      product_id: productIdBig,
      sent_by: req.user!.username || String(req.user!.sub),
    },
    tokens,
    successCount,
    failureCount
  ).catch(() => null);
  return ok(res, { message: 'Notification sent' });
});

// GET /api/admin/notifications — notification history (needs 'ads' permission).
// Keyset pagination by descending id; optional userId / productId filters.
// Mounted on its own router so the path is /api/admin/notifications (see server.ts).
export const adminNotificationsRouter = Router();
adminNotificationsRouter.get(
  '/notifications',
  requireAuth,
  requireStaff('ads'),
  async (req: Request, res: Response) => {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.trunc(limitRaw))) : 50;
    const cursorRaw = String(req.query.cursor || '').trim();
    const cursor = /^\d+$/.test(cursorRaw) ? cursorRaw : null;
    const userIdRaw = String(req.query.userId || '').trim();
    const userId = /^\d+$/.test(userIdRaw) ? userIdRaw : null;
    const productIdRaw = String(req.query.productId || '').trim();
    const productId = /^\d+$/.test(productIdRaw) ? productIdRaw : null;

    const where: string[] = [];
    const params: Array<string | number> = [];
    if (cursor) {
      where.push('n.id < ?');
      params.push(cursor);
    }
    if (productId) {
      where.push('n.product_id = ?');
      params.push(productId);
    }
    // userId filter narrows to notifications that reached that recipient.
    let joinUser = '';
    if (userId) {
      joinUser = 'JOIN notification_recipients nr ON nr.notification_id = n.id AND nr.user_id = ?';
      params.push(userId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);

    const rows = await prisma
      .$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT DISTINCT n.id, n.type, n.title, n.body, n.image, n.link, n.target,
                n.product_id, n.order_id, n.sent_by, n.success_count, n.failure_count, n.created_at
           FROM notifications n
           ${joinUser}
           ${whereSql}
          ORDER BY n.id DESC
          LIMIT ?`,
        ...params
      )
      .catch(() => [] as Array<Record<string, unknown>>);

    const notifications = rows.map((r) => ({
      id: Number(r.id),
      type: r.type ?? '',
      title: r.title ?? '',
      body: r.body ?? '',
      image: r.image ?? null,
      link: r.link ?? null,
      target: r.target ?? '',
      productId: r.product_id != null ? Number(r.product_id) : null,
      orderId: r.order_id ?? null,
      sentBy: r.sent_by ?? null,
      successCount: Number(r.success_count ?? 0),
      failureCount: Number(r.failure_count ?? 0),
      createdAt: r.created_at,
    }));
    const nextCursor = notifications.length === limit ? String(notifications[notifications.length - 1].id) : null;
    return ok(res, { notifications, nextCursor });
  }
);

export default router;
