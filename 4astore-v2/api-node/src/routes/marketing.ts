import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireAuth, requireStaff } from '../auth/middleware';
import {
  sendWhatsAppTemplateMessage,
  buildImageTextComponents,
  sanitizeMsisdn,
} from '../services/whatsappCloud';

const router = Router();

// Every Marketing Center route is staff-gated on the "ads" permission.
router.use(requireAuth, requireStaff('ads'));

// App-wide "real mobile" regex: drops NULL account mobiles and legacy Google
// placeholder mobiles (`g…`) plus any non 10-digit Indian number, so every
// reachable row is WhatsApp-reachable. (Same rule as auth/mobileGate.isRealMobile;
// kept inline here because every call site already String()-coerces first.)
const REAL_MOBILE = /^[6-9]\d{9}$/;

// ---------------- Marketing: customer reach list (read-only) ----------------
// GET /api/admin/marketing/reach — one row per real mobile, merged from the
// `users` table (accounts) and every order's `customer` JSON (covers guests who
// ordered without an account). Accounts that opted out of marketing
// (users.marketing_opt_out = true) are excluded. NOTE: opt-out is stored per
// account only, so a guest who ordered without an account cannot be matched to
// an opt-out flag and therefore cannot be excluded here. FREE/manual outreach
// only — this endpoint just reads; nothing is sent server-side.
//
// Optional query params:
//   ?days=N  → only mobiles that ordered in the last N days (by lastOrderAt)
//   ?q=text  → case-insensitive search on name or mobile
router.get('/reach', async (req: Request, res: Response) => {
  interface ReachRow {
    name: string;
    mobile: string;
    orders: number;
    spent: number;
    lastOrderAt: string | null;
    source: 'account' | 'guest' | 'both';
  }

  const byMobile = new Map<string, ReachRow>();

  // 1) Accounts (customers only — staff/riders are excluded from outreach).
  //    Opted-out accounts are excluded at the query level.
  const users = await prisma.user.findMany({
    where: { role: 'customer', marketing_opt_out: false },
    select: { name: true, mobile: true },
  });
  for (const u of users) {
    const mobile = String(u.mobile || '');
    if (!REAL_MOBILE.test(mobile)) continue;
    byMobile.set(mobile, {
      name: String(u.name || '').trim() || 'Customer',
      mobile,
      orders: 0,
      spent: 0,
      lastOrderAt: null,
      source: 'account',
    });
  }

  // 2) Orders — aggregate count / spent / last-order date per customer mobile.
  const orders = await prisma.order.findMany({
    select: { customer: true, total_amount: true, order_date: true },
    orderBy: { order_date: 'desc' },
  });
  for (const o of orders) {
    const c = (o.customer || {}) as { name?: unknown; mobile?: unknown };
    const mobile = String(c.mobile || '').replace(/\D/g, '');
    if (!REAL_MOBILE.test(mobile)) continue;
    const name = String(c.name || '').trim();
    const amount = Number(o.total_amount) || 0;
    const when = o.order_date ? new Date(o.order_date).toISOString() : null;

    const existing = byMobile.get(mobile);
    if (existing) {
      existing.orders += 1;
      existing.spent += amount;
      if (when && (!existing.lastOrderAt || when > existing.lastOrderAt)) existing.lastOrderAt = when;
      if (existing.source === 'account') existing.source = 'both';
      // Prefer a non-empty account name; otherwise keep latest order name.
      if ((!existing.name || existing.name === 'Customer') && name) existing.name = name;
    } else {
      byMobile.set(mobile, {
        name: name || 'Customer',
        mobile,
        orders: 1,
        spent: amount,
        lastOrderAt: when,
        source: 'guest',
      });
    }
  }

  let reach = Array.from(byMobile.values());

  // Optional filter: ordered within the last N days.
  const days = Number(req.query.days);
  if (Number.isFinite(days) && days > 0) {
    const cutoff = Date.now() - days * 86400000;
    reach = reach.filter((r) => r.lastOrderAt != null && new Date(r.lastOrderAt).getTime() >= cutoff);
  }

  // Optional filter: search by name or mobile.
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) {
    reach = reach.filter((r) => r.name.toLowerCase().includes(q) || r.mobile.includes(q));
  }

  // Most recent / most engaged first: last order date, then order count.
  reach.sort((a, b) => {
    const at = a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : 0;
    const bt = b.lastOrderAt ? new Date(b.lastOrderAt).getTime() : 0;
    if (bt !== at) return bt - at;
    return b.orders - a.orders;
  });

  return ok(res, { reach });
});

// ---------------- WhatsApp Cloud API — LIVE paid-API send (server-side) ----------------
// These two endpoints are the ADDITIONAL paid-API path. The free wa.me
// click-to-share flow stays untouched and remains the default manual outreach.
// The Meta access token NEVER reaches the browser: `sendWhatsAppTemplateMessage`
// reads it fresh from the admin-only `settings.whatsapp_api` blob on every call.
// Marketing TEMPLATE messages let us reach customers who have NOT saved our
// number — the template must be PRE-APPROVED in Meta and any header image must
// be a public HTTPS URL that Meta can fetch.

const WA_MAX_BATCH = 500; // cap a single broadcast to a sane batch size
const WA_DEFAULT_DELAY_MS = 1000; // delay between network sends (rate-limit)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// POST /api/admin/marketing/whatsapp/test — send ONE template message.
const whatsappTestBody = z.object({
  recipientPhone: z.string().min(1),
  templateName: z.string().min(1).max(512),
  languageCode: z.string().min(1).max(12),
  imageUrl: z.string().url().optional(),
  bodyParams: z.array(z.string()).max(20).optional(),
});

router.post('/whatsapp/test', async (req: Request, res: Response) => {
  const parsed = whatsappTestBody.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.issues[0]?.message || 'Invalid request', 400);
  const { recipientPhone, templateName, languageCode, imageUrl, bodyParams } = parsed.data;

  const components = buildImageTextComponents({ imageUrl, bodyParams });
  const result = await sendWhatsAppTemplateMessage({
    recipientPhone,
    templateName,
    languageCode,
    components,
  });

  if (!result.ok) {
    const msg = result.code ? `${result.error} (code ${result.code})` : result.error || 'Send failed';
    return fail(res, msg, 400);
  }
  return ok(res, { result });
});

// POST /api/admin/marketing/whatsapp/broadcast — send to many, rate-limited.
const whatsappBroadcastBody = z.object({
  templateName: z.string().min(1).max(512),
  languageCode: z.string().min(1).max(12),
  imageUrl: z.string().url().optional(),
  bodyParams: z.array(z.string()).max(20).optional(),
  recipients: z.array(z.string()).min(1),
  delayMs: z.number().int().min(0).max(10000).optional(),
});

router.post('/whatsapp/broadcast', async (req: Request, res: Response) => {
  const parsed = whatsappBroadcastBody.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.issues[0]?.message || 'Invalid request', 400);
  const { templateName, languageCode, imageUrl, bodyParams, recipients } = parsed.data;

  if (recipients.length > WA_MAX_BATCH) {
    return fail(res, `Too many recipients — max ${WA_MAX_BATCH} per batch`, 422);
  }

  const delayMs = parsed.data.delayMs ?? WA_DEFAULT_DELAY_MS;
  const components = buildImageTextComponents({ imageUrl, bodyParams });

  const results: Array<{ mobile: string; ok: boolean; error?: string }> = [];
  for (let i = 0; i < recipients.length; i++) {
    const raw = recipients[i];
    const to = sanitizeMsisdn(raw);
    if (!to) {
      // Invalid numbers are skipped and counted as failed — never hit the network.
      results.push({ mobile: raw, ok: false, error: 'Invalid number' });
      continue;
    }

    const result = await sendWhatsAppTemplateMessage({
      recipientPhone: to,
      templateName,
      languageCode,
      components,
    });
    results.push({
      mobile: to,
      ok: result.ok,
      error: result.ok ? undefined : result.code ? `${result.error} (code ${result.code})` : result.error,
    });

    // Rate-limit between NETWORK sends only (not after the last, not after skips).
    if (delayMs > 0 && i < recipients.length - 1) await sleep(delayMs);
  }

  const total = results.length;
  const sent = results.filter((r) => r.ok).length;
  const failed = total - sent;
  return ok(res, { total, sent, failed, results });
});

// ---------------- Dashboard (live data only) ----------------
// GET /api/admin/marketing/dashboard — everything here is read from live tables;
// nothing (prices, stock, discounts, dates) is ever invented.
router.get('/dashboard', async (_req: Request, res: Response) => {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);

  const [festivalsSoon, discountedProducts, lowStock, upcomingFestivals, recentCampaigns] =
    await Promise.all([
      // Festivals with a real date inside the next 30 days (NULL dates excluded).
      prisma.marketingFestival.findMany({
        where: { is_active: true, festival_date: { not: null, gte: now, lte: in30 } },
        orderBy: { festival_date: 'asc' },
      }),
      // Products currently carrying a discount (discount>0 OR mrp>price).
      prisma.product.findMany({
        where: { OR: [{ discount: { gt: 0 } }, { mrp: { gt: prisma.product.fields.price } }] },
        orderBy: { discount: 'desc' },
        take: 50,
      }),
      // Out-of-stock products.
      prisma.product.findMany({
        where: { in_stock: false },
        orderBy: { updated_at: 'desc' },
        take: 50,
      }),
      // Active festivals with a known date first (asc), then undated ones.
      prisma.marketingFestival.findMany({
        where: { is_active: true },
        orderBy: [{ festival_date: { sort: 'asc', nulls: 'last' } }, { sort_order: 'asc' }],
        take: 12,
      }),
      // Last 10 campaigns.
      prisma.marketingCampaign.findMany({
        orderBy: { created_at: 'desc' },
        take: 10,
      }),
    ]);

  return ok(res, {
    recommended: { festivalsSoon, discountedProducts, lowStock },
    upcomingFestivals,
    selectedCount: 0, // client tracks the current selection
    recentCampaigns,
    expiringOffers: [], // no offer_expiry metadata is tracked server-side yet
  });
});

// ---------------- Festivals CRUD ----------------
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, 'festival_date must be an ISO date (YYYY-MM-DD)');

const festivalBody = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(120),
  festival_date: isoDate.nullable().optional(),
  greeting_hi: z.string().max(255).nullable().optional(),
  emoji: z.string().max(16).nullable().optional(),
  is_active: z.boolean().optional(),
  needs_date_check: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

const festivalPatch = festivalBody.partial();

/** Shape the festival create/update payload for Prisma, honouring the
 *  "a real date clears needs_date_check" rule. */
function festivalData(input: z.infer<typeof festivalPatch>) {
  const data: Record<string, unknown> = { ...input };
  if ('festival_date' in input) {
    const d = input.festival_date;
    data.festival_date = d ? new Date(d) : null;
    // When an admin sets a real date, stop flagging it for a date check.
    if (d) data.needs_date_check = false;
  }
  return data;
}

router.get('/festivals', async (_req: Request, res: Response) => {
  const festivals = await prisma.marketingFestival.findMany({
    orderBy: [{ sort_order: 'asc' }, { festival_date: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
  });
  return ok(res, { festivals });
});

router.post('/festivals', async (req: Request, res: Response) => {
  const parsed = festivalBody.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.issues[0]?.message || 'Invalid festival', 400);
  try {
    const festival = await prisma.marketingFestival.create({
      data: festivalData(parsed.data) as never,
    });
    return ok(res, { festival }, 201);
  } catch {
    return fail(res, 'Could not create festival (slug may already exist)', 409);
  }
});

router.put('/festivals/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return fail(res, 'Invalid id', 400);
  const parsed = festivalPatch.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.issues[0]?.message || 'Invalid festival', 400);
  try {
    const festival = await prisma.marketingFestival.update({
      where: { id },
      data: festivalData(parsed.data) as never,
    });
    return ok(res, { festival });
  } catch {
    return fail(res, 'Festival not found', 404);
  }
});

router.delete('/festivals/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return fail(res, 'Invalid id', 400);
  try {
    await prisma.marketingFestival.delete({ where: { id } });
    return ok(res, {});
  } catch {
    return fail(res, 'Festival not found', 404);
  }
});

// ---------------- Templates CRUD ----------------
const templateBody = z.object({
  title: z.string().min(1).max(160),
  category: z.string().min(1).max(60).optional(),
  festival_slug: z.string().max(120).nullable().optional(),
  lang: z.string().min(1).max(12).optional(),
  body: z.string().min(1),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

const templatePatch = templateBody.partial();

router.get('/templates', async (req: Request, res: Response) => {
  const where: Record<string, unknown> = {};
  const category = String(req.query.category || '').trim();
  const festivalSlug = String(req.query.festival_slug || '').trim();
  if (category) where.category = category;
  if (festivalSlug) where.festival_slug = festivalSlug;
  const templates = await prisma.marketingTemplate.findMany({
    where,
    orderBy: [{ sort_order: 'asc' }, { title: 'asc' }],
  });
  return ok(res, { templates });
});

router.post('/templates', async (req: Request, res: Response) => {
  const parsed = templateBody.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.issues[0]?.message || 'Invalid template', 400);
  const template = await prisma.marketingTemplate.create({ data: parsed.data });
  return ok(res, { template }, 201);
});

router.put('/templates/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return fail(res, 'Invalid id', 400);
  const parsed = templatePatch.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.issues[0]?.message || 'Invalid template', 400);
  try {
    const template = await prisma.marketingTemplate.update({ where: { id }, data: parsed.data });
    return ok(res, { template });
  } catch {
    return fail(res, 'Template not found', 404);
  }
});

router.delete('/templates/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return fail(res, 'Invalid id', 400);
  try {
    await prisma.marketingTemplate.delete({ where: { id } });
    return ok(res, {});
  } catch {
    return fail(res, 'Template not found', 404);
  }
});

// ---------------- Campaigns ----------------
const campaignBody = z.object({
  name: z.string().min(1).max(160),
  category: z.string().max(60).nullable().optional(),
  product_ids: z.array(z.number().int()).optional(),
  template_id: z.number().int().nullable().optional(),
  customer_mobiles: z.array(z.string()).optional(),
  message: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  status: z.string().max(24).optional(),
});

// PUT accepts a status/notes update plus optional atomic counter increments.
const campaignUpdate = z.object({
  status: z.string().max(24).optional(),
  notes: z.string().max(500).nullable().optional(),
  increments: z
    .object({
      share_opened: z.number().int().optional(),
      copied_count: z.number().int().optional(),
      banners_downloaded: z.number().int().optional(),
      batches_prepared: z.number().int().optional(),
    })
    .optional(),
});

router.get('/campaigns', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const campaigns = await prisma.marketingCampaign.findMany({
    orderBy: { created_at: 'desc' },
    take: limit,
  });
  return ok(res, { campaigns });
});

router.post('/campaigns', async (req: Request, res: Response) => {
  const parsed = campaignBody.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.issues[0]?.message || 'Invalid campaign', 400);
  const { product_ids, customer_mobiles, ...rest } = parsed.data;
  const campaign = await prisma.marketingCampaign.create({
    data: {
      ...rest,
      status: rest.status || 'draft',
      product_ids: product_ids ?? undefined,
      customer_mobiles: customer_mobiles ?? undefined,
      created_by: req.user?.username || req.user?.name || null,
    },
  });
  return ok(res, { campaign }, 201);
});

router.put('/campaigns/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return fail(res, 'Invalid id', 400);
  const parsed = campaignUpdate.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.issues[0]?.message || 'Invalid update', 400);

  const data: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;

  // Atomically bump the action counters (share_opened / copied_count /
  // banners_downloaded / batches_prepared) when increments are supplied.
  const inc = parsed.data.increments;
  if (inc) {
    for (const key of ['share_opened', 'copied_count', 'banners_downloaded', 'batches_prepared'] as const) {
      const by = inc[key];
      if (typeof by === 'number' && by !== 0) data[key] = { increment: by };
    }
  }

  try {
    const campaign = await prisma.marketingCampaign.update({ where: { id }, data });
    return ok(res, { campaign });
  } catch {
    return fail(res, 'Campaign not found', 404);
  }
});

// GET /api/admin/marketing/reports — aggregates across all campaigns.
// NOTE: waLinksOpened (share_opened) counts WhatsApp links OPENED from the
// admin UI — NOT messages sent or delivered. Outreach is manual click-to-share.
router.get('/reports', async (_req: Request, res: Response) => {
  const [agg, campaigns] = await Promise.all([
    prisma.marketingCampaign.aggregate({
      _count: { _all: true },
      _sum: {
        banners_downloaded: true,
        copied_count: true,
        share_opened: true,
        batches_prepared: true,
      },
    }),
    prisma.marketingCampaign.findMany({ select: { product_ids: true } }),
  ]);

  // Distinct product ids promoted across every campaign.
  const promoted = new Set<number>();
  for (const c of campaigns) {
    const ids = Array.isArray(c.product_ids) ? c.product_ids : [];
    for (const pid of ids) {
      const n = Number(pid);
      if (Number.isFinite(n)) promoted.add(n);
    }
  }

  return ok(res, {
    reports: {
      campaignsCreated: agg._count._all,
      bannersDownloaded: agg._sum.banners_downloaded || 0,
      messagesCopied: agg._sum.copied_count || 0,
      waLinksOpened: agg._sum.share_opened || 0, // links opened, NOT sent/delivered
      productsPromoted: promoted.size,
      batchesPrepared: agg._sum.batches_prepared || 0,
    },
  });
});

// ---------------- Consent opt-out ----------------
const optOutBody = z.object({
  mobile: z.string().regex(/^[6-9]\d{9}$/),
  optOut: z.boolean(),
});

router.post('/opt-out', async (req: Request, res: Response) => {
  const parsed = optOutBody.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.issues[0]?.message || 'Invalid request', 400);
  try {
    await prisma.user.update({
      where: { mobile: parsed.data.mobile },
      data: { marketing_opt_out: parsed.data.optOut },
    });
    return ok(res, {});
  } catch {
    return fail(res, 'No account found for that mobile', 404);
  }
});

export default router;
