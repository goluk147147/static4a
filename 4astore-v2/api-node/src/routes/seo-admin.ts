// Staff-gated admin router for the automatic SEO engine. Mounted in server.ts as
//   app.use('/api/admin/seo-auto', requireAuth, seoAdminRouter)
// BEFORE the generic /api/admin mount (specific path first). EVERY route additionally
// applies requireStaff('settings'); optimize/audit/rollback are rate-limited via the
// in-memory token bucket. All counters come from real queries — no fabricated numbers;
// PHASE-2 integration metrics surface as not-connected/unavailable. Secrets never leave
// the server (integrations.ts returns only non-secret refs).

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { requireStaff } from '../auth/middleware';
import { rateLimit } from '../utils/rateLimit';
import { findDuplicates } from '../seo/dedupe';
import { ATTENTION_THRESHOLD, needsAttention } from '../seo/completeness';
import { getIntegrationStatus, connect, disconnect } from '../seo/integrations';
import { runProductSeo, runCategorySeo } from '../seo/persist';
import {
  enqueueSeoJob,
  getJob,
  recentJobs,
  rollbackJob,
  type SeoJobType,
} from '../services/seoQueue';

const router = Router();

// Every route in this router requires the `settings` permission.
router.use(requireStaff('settings'));

// Shared rate limiter for the write-heavy actions (optimize/audit/rollback).
const writeLimit = rateLimit({ limit: 10, windowMs: 60_000, bucket: 'seo-auto' });

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

const parseJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

// -------------------- GET /dashboard --------------------
// Aggregate counters (all from real queries), recent audit log, job + integration status.
router.get('/dashboard', async (_req: Request, res: Response) => {
  const [productAgg, categoryAgg, dup, jobs, integrations, auditLog] = await Promise.all([
    prisma
      .$queryRawUnsafe<Array<{ total: bigint | number; generated: bigint | number; attention: bigint | number; withProblems: bigint | number; missing: bigint | number }>>(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN seo_generated_at IS NOT NULL THEN 1 ELSE 0 END) AS generated,
           SUM(CASE WHEN (seo_score IS NULL OR seo_score < ?) THEN 1 ELSE 0 END) AS attention,
           SUM(CASE WHEN (seo_problems IS NOT NULL AND JSON_LENGTH(seo_problems) > 0) THEN 1 ELSE 0 END) AS withProblems,
           SUM(CASE WHEN (seo_title IS NULL OR seo_description IS NULL) THEN 1 ELSE 0 END) AS missing
         FROM products`,
        ATTENTION_THRESHOLD,
      )
      .catch(() => []),
    prisma
      .$queryRawUnsafe<Array<{ total: bigint | number; generated: bigint | number; attention: bigint | number }>>(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN seo_generated_at IS NOT NULL THEN 1 ELSE 0 END) AS generated,
           SUM(CASE WHEN (seo_score IS NULL OR seo_score < ?) THEN 1 ELSE 0 END) AS attention
         FROM categories`,
        ATTENTION_THRESHOLD,
      )
      .catch(() => []),
    findDuplicates().catch(() => ({ titles: [], descriptions: [], slugs: [] })),
    recentJobs(10).catch(() => []),
    Promise.all([getIntegrationStatus('gsc'), getIntegrationStatus('ga4'), getIntegrationStatus('gbp')]).catch(() => []),
    prisma
      .$queryRawUnsafe<Array<{ entity_type: string; entity_id: string; action: string; field: string | null; reason: string | null; actor: string | null; created_at: Date }>>(
        'SELECT entity_type, entity_id, action, field, reason, actor, created_at FROM seo_audit_log ORDER BY id DESC LIMIT 20',
      )
      .catch(() => []),
  ]);

  const p = productAgg[0] || { total: 0, generated: 0, attention: 0, withProblems: 0, missing: 0 };
  const c = categoryAgg[0] || { total: 0, generated: 0, attention: 0 };

  return ok(res, {
    counters: {
      products: {
        total: num(p.total),
        optimized: num(p.generated),
        needingAttention: num(p.attention),
        withProblems: num(p.withProblems),
        missingMetadata: num(p.missing),
      },
      categories: {
        total: num(c.total),
        optimized: num(c.generated),
        needingAttention: num(c.attention),
      },
      duplicates: {
        titles: dup.titles.length,
        descriptions: dup.descriptions.length,
        slugs: dup.slugs.length,
      },
      // PHASE-2 metrics are surfaced as explicit unavailable — never fabricated.
      brokenLinks: 'unavailable',
      coreWebVitals: 'unavailable',
      organicPerformance: 'not_connected',
    },
    attentionThreshold: ATTENTION_THRESHOLD,
    jobs,
    integrations,
    recentChanges: auditLog.map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      field: r.field,
      reason: r.reason,
      actor: r.actor,
      at: new Date(r.created_at).toISOString(),
    })),
  });
});

// -------------------- GET /products --------------------
// Paged products with score + problems. filter = needs-attention | duplicate | all.
const productsQuery = z.object({
  filter: z.enum(['all', 'needs-attention', 'duplicate']).optional().default('all'),
  cursor: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

router.get('/products', async (req: Request, res: Response) => {
  const parsed = productsQuery.safeParse(req.query);
  if (!parsed.success) return fail(res, 'Invalid query (filter/cursor/limit)', 422);
  const { filter, cursor, limit } = parsed.data;

  let dupIds: number[] | null = null;
  if (filter === 'duplicate') {
    const dup = await findDuplicates().catch(() => ({ titles: [], descriptions: [], slugs: [] }));
    const ids = new Set<number>();
    for (const g of [...dup.titles, ...dup.descriptions, ...dup.slugs]) for (const id of g.ids) ids.add(Number(id));
    dupIds = [...ids];
    if (!dupIds.length) return ok(res, { products: [], nextCursor: null });
  }

  const where: string[] = ['id > ?'];
  const vals: unknown[] = [cursor];
  if (filter === 'needs-attention') where.push('(seo_score IS NULL OR seo_score < ? OR (seo_problems IS NOT NULL AND JSON_LENGTH(seo_problems) > 0))');
  if (filter === 'needs-attention') vals.push(ATTENTION_THRESHOLD);
  if (dupIds) {
    where.push(`id IN (${dupIds.map(() => '?').join(',')})`);
    vals.push(...dupIds);
  }

  const rows = await prisma
    .$queryRawUnsafe<Array<{ id: bigint | number; name: string; seo_title: string | null; seo_score: number | null; seo_problems: unknown; seo_slug: string | null; seo_generated_at: Date | null }>>(
      `SELECT id, name, seo_title, seo_score, seo_problems, seo_slug, seo_generated_at
         FROM products WHERE ${where.join(' AND ')} ORDER BY id ASC LIMIT ?`,
      ...vals,
      limit + 1,
    )
    .catch(() => []);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return ok(res, {
    products: page.map((r) => {
      const problems = (parseJson(r.seo_problems) as string[]) || [];
      const score = r.seo_score == null ? null : Number(r.seo_score);
      return {
        id: Number(r.id),
        name: r.name,
        title: r.seo_title,
        slug: r.seo_slug,
        score,
        problems: Array.isArray(problems) ? problems : [],
        needsAttention: needsAttention(score ?? 0, Array.isArray(problems) ? problems : []),
        generatedAt: r.seo_generated_at ? new Date(r.seo_generated_at).toISOString() : null,
      };
    }),
    nextCursor: hasMore ? Number(page[page.length - 1].id) : null,
  });
});

// -------------------- POST /optimize --------------------
const optimizeSchema = z
  .object({
    mode: z.enum(['all', 'selected', 'category']),
    productIds: z.array(z.number().int().positive()).max(1000).optional(),
    category: z.string().regex(/^[a-z0-9-]{1,120}$/).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'selected' && (!v.productIds || v.productIds.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'productIds required for mode=selected', path: ['productIds'] });
    }
    if (v.mode === 'category' && !v.category) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'category required for mode=category', path: ['category'] });
    }
  });

const MODE_TO_TYPE: Record<'all' | 'selected' | 'category', SeoJobType> = {
  all: 'optimize_all',
  selected: 'optimize_selected',
  category: 'optimize_category',
};

router.post('/optimize', writeLimit, async (req: Request, res: Response) => {
  const parsed = optimizeSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'Invalid optimize request (mode/productIds/category)', 422);
  const v = parsed.data;

  if (v.mode === 'category') {
    const cat = await prisma.category.findUnique({ where: { slug: v.category! } }).catch(() => null);
    if (!cat) return fail(res, `Category "${v.category}" not found`, 404);
  }

  const scope = v.mode === 'selected' ? { productIds: v.productIds } : v.mode === 'category' ? { category: v.category } : null;
  const jobId = await enqueueSeoJob(MODE_TO_TYPE[v.mode], scope, req.user!.username || 'admin');
  return ok(res, { jobId });
});

// -------------------- POST /audit --------------------
router.post('/audit', writeLimit, async (req: Request, res: Response) => {
  const jobId = await enqueueSeoJob('audit', null, req.user!.username || 'admin');
  return ok(res, { jobId });
});

// -------------------- GET /jobs/:id + GET /jobs --------------------
router.get('/jobs/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'Invalid job id', 422);
  const job = await getJob(id);
  if (!job) return fail(res, 'Job not found', 404);
  return ok(res, { job });
});

router.get('/jobs', async (_req: Request, res: Response) => {
  const jobs = await recentJobs(20);
  return ok(res, { jobs });
});

// -------------------- POST /rollback --------------------
const rollbackSchema = z.object({ jobId: z.number().int().positive().optional() });

router.post('/rollback', writeLimit, async (req: Request, res: Response) => {
  const parsed = rollbackSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'Invalid rollback request', 422);
  const result = await rollbackJob(parsed.data.jobId);
  if (result.backupId == null) return fail(res, 'No backup to roll back', 409);
  return ok(res, { restored: result.restored, backupId: result.backupId });
});

// -------------------- POST /override --------------------
const PRODUCT_OVERRIDE_FIELDS = ['title', 'description', 'keywords', 'slug'] as const;
const CATEGORY_OVERRIDE_FIELDS = ['title', 'description', 'keywords', 'intro'] as const;

const overrideSchema = z.object({
  entityType: z.enum(['product', 'category']),
  id: z.union([z.number().int().positive(), z.string().regex(/^[a-z0-9-]{1,120}$/)]),
  field: z.string().min(1).max(32),
  value: z.boolean(),
});

async function resolveEntityId(entityType: 'product' | 'category', id: number | string): Promise<number | null> {
  if (entityType === 'product') {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    const row = await prisma.product.findUnique({ where: { id: BigInt(n) }, select: { id: true } }).catch(() => null);
    return row ? Number(row.id) : null;
  }
  // category: id may be a numeric id or a slug.
  if (typeof id === 'number' || /^\d+$/.test(String(id))) {
    const row = await prisma.category.findUnique({ where: { id: BigInt(Number(id)) }, select: { id: true } }).catch(() => null);
    return row ? Number(row.id) : null;
  }
  const row = await prisma.category.findUnique({ where: { slug: String(id) }, select: { id: true } }).catch(() => null);
  return row ? Number(row.id) : null;
}

router.post('/override', async (req: Request, res: Response) => {
  const parsed = overrideSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'Invalid override request (entityType/id/field/value)', 422);
  const { entityType, id, field, value } = parsed.data;
  const allowed = entityType === 'product' ? PRODUCT_OVERRIDE_FIELDS : CATEGORY_OVERRIDE_FIELDS;
  if (!(allowed as readonly string[]).includes(field)) return fail(res, `Unknown SEO field "${field}"`, 422);

  const resolved = await resolveEntityId(entityType, id);
  if (resolved == null) return fail(res, `${entityType} not found`, 404);

  const table = entityType === 'product' ? 'products' : 'categories';
  const cur = (
    await prisma
      .$queryRawUnsafe<Array<{ seo_overrides: unknown }>>(`SELECT seo_overrides FROM ${table} WHERE id = ? LIMIT 1`, resolved)
      .catch(() => [])
  )[0];
  const overrides = ((parseJson(cur?.seo_overrides) as Record<string, unknown>) || {}) as Record<string, boolean>;
  if (value) overrides[field] = true;
  else delete overrides[field];
  await prisma
    .$executeRawUnsafe(`UPDATE ${table} SET seo_overrides = ? WHERE id = ?`, JSON.stringify(overrides), resolved)
    .catch(() => 0);

  return ok(res, { entityType, id: resolved, field, value });
});

// -------------------- POST /reset-auto --------------------
// Clears override flag(s) and regenerates (fire the engine entry function).
const resetSchema = z.object({
  entityType: z.enum(['product', 'category']),
  id: z.union([z.number().int().positive(), z.string().regex(/^[a-z0-9-]{1,120}$/)]),
  field: z.string().min(1).max(32).optional(),
});

router.post('/reset-auto', writeLimit, async (req: Request, res: Response) => {
  const parsed = resetSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'Invalid reset request (entityType/id/field)', 422);
  const { entityType, id, field } = parsed.data;
  const allowed = entityType === 'product' ? PRODUCT_OVERRIDE_FIELDS : CATEGORY_OVERRIDE_FIELDS;
  if (field && !(allowed as readonly string[]).includes(field)) return fail(res, `Unknown SEO field "${field}"`, 422);

  const resolved = await resolveEntityId(entityType, id);
  if (resolved == null) return fail(res, `${entityType} not found`, 404);

  const table = entityType === 'product' ? 'products' : 'categories';
  const cur = (
    await prisma
      .$queryRawUnsafe<Array<{ seo_overrides: unknown }>>(`SELECT seo_overrides FROM ${table} WHERE id = ? LIMIT 1`, resolved)
      .catch(() => [])
  )[0];
  let overrides = ((parseJson(cur?.seo_overrides) as Record<string, unknown>) || {}) as Record<string, boolean>;
  if (field) delete overrides[field];
  else overrides = {}; // clear all overrides for the entity
  await prisma
    .$executeRawUnsafe(`UPDATE ${table} SET seo_overrides = ? WHERE id = ?`, JSON.stringify(overrides), resolved)
    .catch(() => 0);

  // Regenerate now (fire-and-forget; gated by the kill-switch inside the entry fn).
  const actor = req.user!.username || 'admin';
  if (entityType === 'product') void runProductSeo(resolved, { actor });
  else void runCategorySeo(resolved, { actor });

  return ok(res, { entityType, id: resolved, cleared: field || 'all' });
});

// -------------------- GET /integrations --------------------
router.get('/integrations', async (_req: Request, res: Response) => {
  const [gsc, ga4, gbp] = await Promise.all([
    getIntegrationStatus('gsc'),
    getIntegrationStatus('ga4'),
    getIntegrationStatus('gbp'),
  ]);
  return ok(res, { integrations: [gsc, ga4, gbp] });
});

// -------------------- POST /integrations/:provider --------------------
const integrationSchema = z.object({
  action: z.enum(['connect', 'disconnect']),
  accountRef: z.string().max(190).optional(),
});

router.post('/integrations/:provider', async (req: Request, res: Response) => {
  const provider = String(req.params.provider || '').toLowerCase();
  if (!['gsc', 'ga4', 'gbp'].includes(provider)) return fail(res, 'Unknown integration provider', 404);
  const parsed = integrationSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'Invalid integration request (action/accountRef)', 422);
  const status =
    parsed.data.action === 'connect'
      ? await connect(provider, { accountRef: parsed.data.accountRef ?? null })
      : await disconnect(provider);
  return ok(res, { status });
});

export default router;
