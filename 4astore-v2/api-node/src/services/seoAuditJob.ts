// Scheduled SEO audit sweep — mirrors reminderJob.ts (cron) + videoScheduler.ts
// (recover-on-start). Every 15 minutes runAuditSweep() finds entities whose freshly
// computed source hash differs from the stored one (or that were never generated) and
// enqueues ONE changed-only `audit` job — the SAME idempotent work the import hook
// enqueues, so a recent import and the next tick never double-process. A separate daily
// crawler cron is shipped as a flagged no-op (PHASE-2).
//
// recoverSeoQueue() is the FIRST line of startSeoAuditJob() (mirrors videoScheduler),
// and startSeoAuditJob() is called once from server.ts's app.listen callback.

import cron from 'node-cron';
import { prisma } from '../db';
import { loadFeatures } from '../seo/persist';
import { productSourceHash, categorySourceHash, type CategoryLike } from '../seo/generate';
import type { ProductLike } from '../seo/localSeo';
import {
  recoverSeoQueue,
  enqueueSeoJob,
  hasPendingCatalogueJob,
} from './seoQueue';
import { invalidateSeoCaches } from '../routes/seo';

const AUDIT_CAP = 200;

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

interface ProductHashRow {
  id: bigint | number;
  name: string;
  brand: string | null;
  category: string | null;
  weight: string | null;
  price: unknown;
  mrp: unknown;
  image: string | null;
  description: string | null;
  in_stock: boolean | number | null;
  seo_source_hash: string | null;
  seo_generated_at: Date | null;
}

const toProductLike = (r: ProductHashRow): ProductLike => ({
  id: Number(r.id),
  name: r.name,
  brand: r.brand,
  category: r.category,
  weight: r.weight,
  price: num(r.price),
  mrp: num(r.mrp),
  image: r.image,
  description: r.description,
  in_stock: r.in_stock == null ? null : !!r.in_stock,
});

/** Count products/categories that are stale (hash moved or never generated). */
async function countChanged(): Promise<number> {
  const products = await prisma
    .$queryRawUnsafe<ProductHashRow[]>(
      `SELECT id, name, brand, category, weight, price, mrp, image, description, in_stock, seo_source_hash, seo_generated_at
         FROM products ORDER BY id ASC`,
    )
    .catch(() => [] as ProductHashRow[]);
  let changed = 0;
  for (const p of products) {
    if (p.seo_generated_at == null || p.seo_source_hash !== productSourceHash(toProductLike(p))) {
      changed += 1;
      if (changed >= AUDIT_CAP) return changed;
    }
  }
  const cats = await prisma
    .$queryRawUnsafe<Array<{ id: bigint | number; name: string; slug: string; image: string | null; og_image: string | null; seo_source_hash: string | null; seo_generated_at: Date | null }>>(
      'SELECT id, name, slug, image, og_image, seo_source_hash, seo_generated_at FROM categories ORDER BY id ASC',
    )
    .catch(() => [] as Array<{ id: bigint | number; name: string; slug: string; image: string | null; og_image: string | null; seo_source_hash: string | null; seo_generated_at: Date | null }>);
  for (const c of cats) {
    const members = await prisma
      .$queryRawUnsafe<Array<{ name: string }>>('SELECT name FROM products WHERE category = ? ORDER BY name ASC', c.slug)
      .catch(() => [] as Array<{ name: string }>);
    const catLike: CategoryLike = { id: Number(c.id), name: c.name, slug: c.slug, image: c.image, og_image: c.og_image };
    if (c.seo_generated_at == null || c.seo_source_hash !== categorySourceHash(catLike, members.map((m) => ({ name: m.name })))) {
      changed += 1;
      if (changed >= AUDIT_CAP) return changed;
    }
  }
  return changed;
}

/**
 * Enqueue a changed-only audit job when anything is stale. Idempotent (skips when an
 * audit/optimize_all job is already queued/running). Gated by the seoAuto kill-switch.
 */
export async function runAuditSweep(): Promise<{ enqueued: boolean; jobId?: number; changed?: number }> {
  const features = await loadFeatures();
  if (!features.seoAuto) return { enqueued: false }; // master kill-switch

  if (await hasPendingCatalogueJob()) return { enqueued: false }; // de-dupe

  const changed = await countChanged();
  if (changed <= 0) return { enqueued: false, changed: 0 };

  const jobId = await enqueueSeoJob('audit', null, 'auto:cron');
  // The queue busts the caches when it publishes; nothing to flush here beyond a
  // defensive bust so a crawler never serves stale sitemap/robots after a sweep tick.
  invalidateSeoCaches();
  return { enqueued: true, jobId, changed };
}

/**
 * Start the scheduler. recoverSeoQueue() runs FIRST (mirrors startVideoScheduler),
 * then a 15-min audit sweep and a flagged-no-op daily crawler stub.
 */
export function startSeoAuditJob(): void {
  void recoverSeoQueue().catch((e) => console.error('[seo] queue recovery failed:', (e as Error).message));

  cron.schedule('*/15 * * * *', () => {
    runAuditSweep().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[seo] audit sweep failed:', (e as Error).message);
    });
  });

  // PHASE-2 daily crawler (broken-link/HTTP-status/orphan/duplicate-content). Shipped
  // as a flagged no-op: it only runs when seoAutoCrawler is explicitly enabled.
  cron.schedule('0 3 * * *', async () => {
    try {
      const features = await loadFeatures();
      if (!features.seoAuto || !features.seoAutoCrawler) return; // dark until enabled
      // PHASE-2: technical crawler checks land here behind the flag.
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[seo] crawler stub error:', (e as Error).message);
    }
  });

  // eslint-disable-next-line no-console
  console.log('[seo] audit job scheduled (every 15 min; daily crawler stub flagged off).');
}
