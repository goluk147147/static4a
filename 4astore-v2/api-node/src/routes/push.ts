import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireAuth, requireStaff } from '../auth/middleware';
import { sendToTopic, sendToTokens, tokensForStaff, syncTokenTopics, clearTokenTopics, PushMessage } from '../services/push';

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

  await prisma.deviceToken.upsert({
    where: { token },
    create: { user_id: BigInt(req.user!.sub), token, platform, topics },
    update: { user_id: BigInt(req.user!.sub), platform, topics },
  });
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
});

// POST /api/push/send — staff broadcast to a segment (needs 'ads' permission).
router.post('/send', requireAuth, requireStaff('ads'), async (req: Request, res: Response) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'target, title and body required', 422);
  const { target, title, body, link } = parsed.data;
  const msg: PushMessage = { title, body, data: link ? { link } : {} };

  if (target === 'admins') {
    const tokens = await tokensForStaff('orders');
    if (tokens.length) await sendToTokens(tokens, msg);
    else await sendToTopic('admins', msg);
  } else {
    await sendToTopic(target, msg);
  }
  return ok(res, { message: 'Notification sent' });
});

export default router;
