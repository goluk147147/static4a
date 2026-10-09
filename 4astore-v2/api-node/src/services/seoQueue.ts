// DB-row SEO batch queue — mirrors video/queue.ts's model: jobs live in MySQL
// (seo_jobs), a single in-process `running` guard means one job at a time, progress is
// written back to the row every batch, and recoverSeoQueue() marks interrupted jobs
// failed on start. No new queue dependency.
//
// Job types: optimize_all | optimize_selected | optimize_category | audit.
//   - audit: changed-only (import hook + cron). Regenerate only entities whose source
//     hash changed or that were never generated; everything else is skipped.
//   - optimize_*: operator-forced runs. Still apply the idempotent skip below.
//
// Idempotent skip (design §6.2) uses the SAME ATTENTION_THRESHOLD the dashboard uses:
// an entity is skipped when seo_source_hash is unchanged AND seo_score >= threshold AND
// it has no seo_problems. Per-entity failures retry up to 2x and never abort the job.
// Before any write, affected rows' seo_* columns are snapshotted into seo_backups and
// seo_jobs.backup_id is set, enabling rollback.

import { prisma } from '../db';
import { ATTENTION_THRESHOLD } from '../seo/completeness';
import {
  loadFeatures,
  loadSeoConfig,
  persistProductSeo,
  persistCategorySeo,
  type PersistOutcome,
} from '../seo/persist';
import {
  productSourceHash,
  categorySourceHash,
  type CategoryLike,
} from '../seo/generate';
import type { ProductLike } from '../seo/localSeo';
import { invalidateSeoCaches } from '../routes/seo';

export type SeoJobType = 'optimize_all' | 'optimize_selected' | 'optimize_category' | 'audit';
export type SeoJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface SeoJobScope {
  productIds?: number[];
  category?: string;
}

interface SeoJobRow {
  id: bigint | number;
  type: string;
  status: string;
  scope: unknown;
  total: number;
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  progress: number;
  backup_id: bigint | number | null;
  log: unknown;
  error: string | null;
  created_by: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface SeoJobView {
  id: number;
  type: SeoJobType;
  status: SeoJobStatus;
  scope: SeoJobScope | null;
  total: number;
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  progress: number;
  backupId: number | null;
  log: Array<Record<string, unknown>>;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

const BATCH_SIZE = 50;
const MAX_LOG = 200;
const MAX_RETRIES = 2;

const parseJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

export function toJobView(r: SeoJobRow): SeoJobView {
  const scope = parseJson(r.scope) as SeoJobScope | null;
  const log = (parseJson(r.log) as Array<Record<string, unknown>>) || [];
  return {
    id: Number(r.id),
    type: r.type as SeoJobType,
    status: r.status as SeoJobStatus,
    scope: scope && typeof scope === 'object' ? scope : null,
    total: Number(r.total) || 0,
    processed: Number(r.processed) || 0,
    updated: Number(r.updated) || 0,
    skipped: Number(r.skipped) || 0,
    failed: Number(r.failed) || 0,
    progress: Number(r.progress) || 0,
    backupId: r.backup_id == null ? null : Number(r.backup_id),
    log: Array.isArray(log) ? log : [],
    error: r.error || null,
    createdBy: r.created_by || null,
    createdAt: new Date(r.created_at).toISOString(),
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  };
}

async function loadJob(id: number): Promise<SeoJobRow | null> {
  const rows = await prisma
    .$queryRawUnsafe<SeoJobRow[]>('SELECT * FROM seo_jobs WHERE id = ? LIMIT 1', id)
    .catch(() => [] as SeoJobRow[]);
  return rows[0] || null;
}

export async function getJob(id: number): Promise<SeoJobView | null> {
  const row = await loadJob(id);
  return row ? toJobView(row) : null;
}

export async function recentJobs(limit = 20): Promise<SeoJobView[]> {
  const rows = await prisma
    .$queryRawUnsafe<SeoJobRow[]>('SELECT * FROM seo_jobs ORDER BY id DESC LIMIT ?', Math.max(1, Math.min(100, limit)))
    .catch(() => [] as SeoJobRow[]);
  return rows.map(toJobView);
}

/** True when an audit/optimize_all job is already queued or running (import de-dupe). */
export async function hasPendingCatalogueJob(): Promise<boolean> {
  const rows = await prisma
    .$queryRawUnsafe<Array<{ n: bigint | number }>>(
      "SELECT COUNT(*) AS n FROM seo_jobs WHERE status IN ('queued','running') AND type IN ('audit','optimize_all')",
    )
    .catch(() => [] as Array<{ n: bigint | number }>);
  return Number(rows[0]?.n || 0) > 0;
}

/** Insert a seo_jobs row and start the queue. Returns the new job id. */
export async function enqueueSeoJob(
  type: SeoJobType,
  scope: SeoJobScope | null,
  createdBy: string,
): Promise<number> {
  const row = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO seo_jobs (type, status, scope, created_by, created_at)
       VALUES (?, 'queued', ?, ?, NOW(3))`,
      type,
      scope ? JSON.stringify(scope) : null,
      createdBy.slice(0, 64),
    );
    return (await tx.$queryRawUnsafe<SeoJobRow[]>('SELECT * FROM seo_jobs WHERE id = LAST_INSERT_ID()'))[0];
  });
  void kick();
  return Number(row.id);
}

// -------------------- processing --------------------

let running = false;

/** Starts the next queued job if nothing is running (single-flight guard). */
export async function kick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = (
        await prisma
          .$queryRawUnsafe<SeoJobRow[]>("SELECT * FROM seo_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1")
          .catch(() => [] as SeoJobRow[])
      )[0];
      if (!next) break;
      await processJob(next).catch((e) => {
        void prisma
          .$executeRawUnsafe(
            "UPDATE seo_jobs SET status = 'failed', error = ?, finished_at = NOW(3) WHERE id = ?",
            String((e as Error)?.message || 'queue error').slice(0, 2000),
            Number(next.id),
          )
          .catch(() => 0);
      });
    }
  } finally {
    running = false;
  }
}

interface ProductScanRow {
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
  seo_score: number | null;
  seo_problems: unknown;
  seo_source_hash: string | null;
  seo_generated_at: Date | null;
}

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

const toProductLike = (r: ProductScanRow): ProductLike => ({
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

const problemCount = (v: unknown): number => {
  const arr = parseJson(v);
  return Array.isArray(arr) ? arr.length : 0;
};

/** Idempotent skip: unchanged hash AND good score AND no problems (design §6.2). */
function canSkip(storedHash: string | null, freshHash: string, score: number | null, problems: unknown, generatedAt: Date | null): boolean {
  if (generatedAt == null) return false; // never generated
  if (!storedHash || storedHash !== freshHash) return false; // changed
  if ((score ?? 0) < ATTENTION_THRESHOLD) return false;
  if (problemCount(problems) > 0) return false;
  return true;
}

interface JobCounters {
  total: number;
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  log: Array<Record<string, unknown>>;
}

async function flushCounters(jobId: number, c: JobCounters): Promise<void> {
  const progress = c.total > 0 ? Math.min(100, Math.round((c.processed / c.total) * 100)) : 100;
  await prisma
    .$executeRawUnsafe(
      'UPDATE seo_jobs SET total = ?, processed = ?, updated = ?, skipped = ?, failed = ?, progress = ?, log = ? WHERE id = ?',
      c.total,
      c.processed,
      c.updated,
      c.skipped,
      c.failed,
      progress,
      JSON.stringify(c.log.slice(-MAX_LOG)),
      jobId,
    )
    .catch(() => 0);
}

const pushLog = (c: JobCounters, entry: Record<string, unknown>) => {
  c.log.push(entry);
  if (c.log.length > MAX_LOG) c.log = c.log.slice(-MAX_LOG);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function processJob(row: SeoJobRow): Promise<void> {
  const jobId = Number(row.id);
  const type = row.type as SeoJobType;
  const scope = (parseJson(row.scope) as SeoJobScope | null) || {};
  const actor = row.created_by || 'auto:cron';

  // The whole job is gated by the kill-switch: if seoAuto is off, mark done (no-op).
  const features = await loadFeatures();
  if (!features.seoAuto) {
    await prisma
      .$executeRawUnsafe(
        "UPDATE seo_jobs SET status = 'done', progress = 100, error = ?, started_at = NOW(3), finished_at = NOW(3) WHERE id = ?",
        'seoAuto master kill-switch is off — no-op',
        jobId,
      )
      .catch(() => 0);
    return;
  }

  const cfg = await loadSeoConfig();
  await prisma
    .$executeRawUnsafe("UPDATE seo_jobs SET status = 'running', started_at = NOW(3), error = NULL WHERE id = ?", jobId)
    .catch(() => 0);

  // Resolve the product id set for the scope.
  const whereParts: string[] = [];
  const whereVals: unknown[] = [];
  if (type === 'optimize_selected' && Array.isArray(scope.productIds) && scope.productIds.length) {
    whereParts.push(`id IN (${scope.productIds.map(() => '?').join(',')})`);
    whereVals.push(...scope.productIds.map((n) => Number(n)));
  } else if (type === 'optimize_category' && scope.category) {
    whereParts.push('category = ?');
    whereVals.push(scope.category);
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const productRows = await prisma
    .$queryRawUnsafe<ProductScanRow[]>(
      `SELECT id, name, brand, category, weight, price, mrp, image, description, in_stock,
              seo_score, seo_problems, seo_source_hash, seo_generated_at
         FROM products ${whereSql} ORDER BY id ASC`,
      ...whereVals,
    )
    .catch(() => [] as ProductScanRow[]);

  // Categories: optimize_all / audit cover all categories; optimize_category covers the one.
  let categoryRows: Array<{ id: bigint | number; name: string; slug: string; image: string | null; og_image: string | null; seo_score: number | null; seo_problems: unknown; seo_source_hash: string | null; seo_generated_at: Date | null }> = [];
  if (type === 'optimize_all' || type === 'audit' || type === 'optimize_category') {
    const catWhere = type === 'optimize_category' && scope.category ? 'WHERE slug = ?' : '';
    const catVals = type === 'optimize_category' && scope.category ? [scope.category] : [];
    categoryRows = await prisma
      .$queryRawUnsafe<typeof categoryRows>(
        `SELECT id, name, slug, image, og_image, seo_score, seo_problems, seo_source_hash, seo_generated_at
           FROM categories ${catWhere} ORDER BY id ASC`,
        ...catVals,
      )
      .catch(() => [] as typeof categoryRows);
  }

  const changedOnly = type === 'audit';

  const counters: JobCounters = {
    total: productRows.length + categoryRows.length,
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    log: [],
  };

  // Snapshot affected rows BEFORE writing (rollback enabler).
  const backupId = await snapshotBackup(jobId, actor, productRows, categoryRows);
  if (backupId != null) {
    await prisma.$executeRawUnsafe('UPDATE seo_jobs SET backup_id = ? WHERE id = ?', backupId, jobId).catch(() => 0);
  }

  await flushCounters(jobId, counters);

  let anyPublished = false;
  let batchInBatch = 0;

  const handleOutcome = (kind: 'product' | 'category', id: number, outcome: PersistOutcome | 'skip') => {
    counters.processed += 1;
    if (outcome === 'skip') {
      counters.skipped += 1;
      return;
    }
    if (outcome.status === 'published') {
      counters.updated += 1;
      anyPublished = true;
      pushLog(counters, { entityType: kind, id, action: 'publish', score: outcome.score, problems: outcome.problems });
    } else if (outcome.status === 'skipped' || outcome.status === 'race' || outcome.status === 'skipped_off') {
      counters.skipped += 1;
    } else {
      counters.failed += 1;
      pushLog(counters, { entityType: kind, id, action: 'not_found' });
    }
  };

  const runWithRetry = async (fn: () => Promise<PersistOutcome>, kind: 'product' | 'category', id: number): Promise<PersistOutcome | null> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (attempt < MAX_RETRIES) await sleep(100 * (attempt + 1));
      }
    }
    counters.failed += 1;
    pushLog(counters, { entityType: kind, id, action: 'error', problem: String((lastErr as Error)?.message || 'error').slice(0, 200) });
    return null;
  };

  // Products
  for (const pr of productRows) {
    const id = Number(pr.id);
    if (changedOnly || type.startsWith('optimize')) {
      const fresh = productSourceHash(toProductLike(pr));
      if (canSkip(pr.seo_source_hash, fresh, pr.seo_score, pr.seo_problems, pr.seo_generated_at)) {
        handleOutcome('product', id, 'skip');
        batchInBatch++;
      } else {
        const out = await runWithRetry(() => persistProductSeo(id, cfg, { actor, jobId }), 'product', id);
        if (out) handleOutcome('product', id, out);
        else counters.processed += 1;
        batchInBatch++;
      }
    }
    if (batchInBatch >= BATCH_SIZE) {
      await flushCounters(jobId, counters);
      await sleep(0); // yield the event loop between batches
      batchInBatch = 0;
    }
  }

  // Categories
  for (const cr of categoryRows) {
    const id = Number(cr.id);
    if (changedOnly || type.startsWith('optimize')) {
      const memberNames = await prisma
        .$queryRawUnsafe<Array<{ name: string }>>('SELECT name FROM products WHERE category = ? ORDER BY name ASC', cr.slug)
        .catch(() => [] as Array<{ name: string }>);
      const catLike: CategoryLike = { id: Number(cr.id), name: cr.name, slug: cr.slug, image: cr.image, og_image: cr.og_image };
      const fresh = categorySourceHash(catLike, memberNames.map((m) => ({ name: m.name })));
      if (canSkip(cr.seo_source_hash, fresh, cr.seo_score, cr.seo_problems, cr.seo_generated_at)) {
        handleOutcome('category', id, 'skip');
        batchInBatch++;
      } else {
        const out = await runWithRetry(() => persistCategorySeo(id, cfg, { actor, jobId }), 'category', id);
        if (out) handleOutcome('category', id, out);
        else counters.processed += 1;
        batchInBatch++;
      }
    }
    if (batchInBatch >= BATCH_SIZE) {
      await flushCounters(jobId, counters);
      await sleep(0);
      batchInBatch = 0;
    }
  }

  await flushCounters(jobId, counters);
  await prisma
    .$executeRawUnsafe("UPDATE seo_jobs SET status = 'done', progress = 100, finished_at = NOW(3) WHERE id = ?", jobId)
    .catch(() => 0);

  if (anyPublished) invalidateSeoCaches();
}

// -------------------- backups + rollback --------------------

interface BackupEntity {
  entityType: 'product' | 'category';
  id: number;
  columns: Record<string, unknown>;
}

const PRODUCT_SEO_COLS = ['seo_title', 'seo_description', 'seo_keywords', 'seo_slug', 'seo_auto_json', 'seo_score', 'seo_problems', 'seo_generated_at', 'seo_source_hash'];
const CATEGORY_SEO_COLS = ['seo_title', 'seo_description', 'seo_keywords', 'seo_intro', 'seo_auto_json', 'seo_score', 'seo_problems', 'seo_generated_at', 'seo_source_hash'];

async function snapshotBackup(
  jobId: number,
  actor: string,
  productRows: Array<{ id: bigint | number }>,
  categoryRows: Array<{ id: bigint | number }>,
): Promise<number | null> {
  if (!productRows.length && !categoryRows.length) return null;
  const entities: BackupEntity[] = [];
  if (productRows.length) {
    const ids = productRows.map((r) => Number(r.id));
    const rows = await prisma
      .$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT id, ${PRODUCT_SEO_COLS.join(', ')} FROM products WHERE id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
      )
      .catch(() => [] as Array<Record<string, unknown>>);
    for (const r of rows) {
      const columns: Record<string, unknown> = {};
      for (const c of PRODUCT_SEO_COLS) columns[c] = r[c] ?? null;
      entities.push({ entityType: 'product', id: Number(r.id), columns });
    }
  }
  if (categoryRows.length) {
    const ids = categoryRows.map((r) => Number(r.id));
    const rows = await prisma
      .$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT id, ${CATEGORY_SEO_COLS.join(', ')} FROM categories WHERE id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
      )
      .catch(() => [] as Array<Record<string, unknown>>);
    for (const r of rows) {
      const columns: Record<string, unknown> = {};
      for (const c of CATEGORY_SEO_COLS) columns[c] = r[c] ?? null;
      entities.push({ entityType: 'category', id: Number(r.id), columns });
    }
  }
  if (!entities.length) return null;

  const inserted = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO seo_backups (job_id, entity_type, scope, snapshot, created_by, created_at)
       VALUES (?, 'mixed', ?, ?, ?, NOW(3))`,
      jobId,
      JSON.stringify({ products: productRows.length, categories: categoryRows.length }),
      JSON.stringify(entities),
      actor.slice(0, 64),
    );
    return (await tx.$queryRawUnsafe<Array<{ id: bigint | number }>>('SELECT id FROM seo_backups WHERE id = LAST_INSERT_ID()'))[0];
  });
  return inserted ? Number(inserted.id) : null;
}

export interface RollbackResult {
  restored: number;
  backupId: number | null;
}

/**
 * Restore the most recent backup (optionally for a given job) in a transaction, then
 * bust the SEO caches. Effective columns are restored; seo_overrides is NOT touched.
 */
export async function rollbackJob(jobId?: number): Promise<RollbackResult> {
  const where = jobId ? 'WHERE job_id = ?' : '';
  const vals = jobId ? [jobId] : [];
  const backupRows = await prisma
    .$queryRawUnsafe<Array<{ id: bigint | number; snapshot: string }>>(
      `SELECT id, snapshot FROM seo_backups ${where} ORDER BY id DESC LIMIT 1`,
      ...vals,
    )
    .catch(() => [] as Array<{ id: bigint | number; snapshot: string }>);
  const backup = backupRows[0];
  if (!backup) return { restored: 0, backupId: null };

  const entities = (parseJson(backup.snapshot) as BackupEntity[]) || [];
  if (!Array.isArray(entities) || !entities.length) return { restored: 0, backupId: Number(backup.id) };

  let restored = 0;
  await prisma.$transaction(async (tx) => {
    for (const e of entities) {
      const cols = Object.keys(e.columns);
      if (!cols.length) continue;
      const table = e.entityType === 'product' ? 'products' : 'categories';
      const setSql = cols.map((c) => `${c} = ?`).join(', ');
      const vals2 = cols.map((c) => {
        const v = e.columns[c];
        // JSON columns were read back as objects/arrays — re-stringify for the raw write.
        if (v != null && typeof v === 'object') return JSON.stringify(v);
        return v ?? null;
      });
      const n = await tx.$executeRawUnsafe(`UPDATE ${table} SET ${setSql} WHERE id = ?`, ...vals2, e.id).catch(() => 0);
      if (n) restored += 1;
      await tx.$executeRawUnsafe(
        `INSERT INTO seo_audit_log (entity_type, entity_id, action, reason, actor) VALUES (?, ?, 'rollback', ?, 'auto:rollback')`,
        e.entityType,
        String(e.id),
        `restored from backup #${Number(backup.id)}`,
      ).catch(() => 0);
    }
  });

  invalidateSeoCaches();
  return { restored, backupId: Number(backup.id) };
}

// -------------------- recovery --------------------

/** On start: mark any job left `running` (interrupted by a restart) as failed; resume. */
export async function recoverSeoQueue(): Promise<void> {
  await prisma
    .$executeRawUnsafe(
      "UPDATE seo_jobs SET status = 'failed', error = 'Server restarted during the job — re-run it from the SEO dashboard', finished_at = NOW(3) WHERE status = 'running'",
    )
    .catch(() => 0);
  void kick();
}
