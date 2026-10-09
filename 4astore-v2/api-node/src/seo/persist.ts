// Override-aware persistence orchestrator for the automatic SEO engine.
//
// This is the single write path for all generation (design §5.3 / §11). Every entry
// funnels through the `seoAuto` master kill-switch gate: when the flag is OFF the
// functions early-return and automation stays dark while commerce is untouched.
//
// Flow per entity:
//   1. load the current row,
//   2. generate the fresh payload (pure, from DB truth) and ALWAYS store it in
//      seo_auto_json,
//   3. for each engine-generated EFFECTIVE field (seo_title/seo_description/
//      seo_keywords/seo_slug — og_image EXCLUDED) write only when the matching
//      seo_overrides flag is not `true` (else record a skip_override audit),
//   4. compute score/problems/generated_at/source_hash,
//   5. do the effective-column writes + score/flags inside ONE awaited transaction
//      (the atomic publish), then write seo_audit_log rows AFTER it commits,
//      fire-and-forget (a logging failure never rolls back or blocks the publish).
//
// Race safety: the source hash is recomputed just before the write; if it moved
// mid-flight the entity is skipped (requeued by the next sweep) rather than writing
// stale output.

import { prisma } from '../db';
import {
  mergeSeoConfig,
  type SeoConfig,
  type ProductLike,
  type SettingsRow,
} from './localSeo';
import {
  generateProductSeo,
  generateCategorySeo,
  productSourceHash,
  categorySourceHash,
  type GeneratedProductSeo,
  type GeneratedCategorySeo,
  type CategoryLike,
} from './generate';
import {
  validateProductSeo,
  validateCategorySeo,
  checkDbTruth,
  type ProblemCode,
} from './validate';
import { scoreProduct, scoreCategory } from './completeness';
import { mergeFeatures, type Features } from '../utils/features';

// -------------------- shared config/flag loaders --------------------

/** Read the stored feature-flag blob from config.features (tolerant of absence). */
export async function loadStoredFeatures(): Promise<unknown> {
  const rows = await prisma
    .$queryRawUnsafe<Array<{ features?: unknown }>>('SELECT features FROM config WHERE id = 1')
    .catch(() => [] as Array<{ features?: unknown }>);
  const raw = rows[0]?.features;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw ?? null;
}

/** Merged feature flags — the single source for the seoAuto kill-switch gate. */
export async function loadFeatures(): Promise<Features> {
  return mergeFeatures(await loadStoredFeatures());
}

/** Merged SEO config (config.seo blob + settings-derived business defaults). */
export async function loadSeoConfig(): Promise<SeoConfig> {
  const parse = (v: unknown) => {
    if (typeof v !== 'string') return v ?? null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };
  const [cfgRows, setRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ seo?: unknown }>>('SELECT seo FROM config WHERE id = 1').catch(() => []),
    prisma.$queryRawUnsafe<SettingsRow[]>('SELECT * FROM settings WHERE id = 1').catch(() => [] as SettingsRow[]),
  ]);
  return mergeSeoConfig(parse(cfgRows[0]?.seo), setRows[0] || null);
}

// -------------------- shared types --------------------

export interface RunOptions {
  actor?: string;
  jobId?: number | null;
}

export interface PersistOutcome {
  status: 'published' | 'skipped' | 'skipped_off' | 'not_found' | 'race';
  score?: number;
  problems?: string[];
  sourceHash?: string;
  wrote?: string[];
}

type OverrideMap = Record<string, boolean>;

const asOverrides = (v: unknown): OverrideMap => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const out: OverrideMap = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = val === true;
    return out;
  }
  return {};
};

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// Fire-and-forget audit writer: never part of the awaited publish transaction.
interface AuditRow {
  entityType: 'product' | 'category';
  entityId: string;
  action: 'publish' | 'skip_override' | 'validation_fail' | 'generate';
  field?: string | null;
  before?: string | null;
  after?: string | null;
  reason?: string | null;
  jobId?: number | null;
  actor?: string | null;
}

function writeAuditRows(rows: AuditRow[]): void {
  if (!rows.length) return;
  // Run AFTER the publish transaction; swallow errors so logging can never break commerce.
  void (async () => {
    for (const r of rows) {
      await prisma
        .$executeRawUnsafe(
          `INSERT INTO seo_audit_log (entity_type, entity_id, action, field, before_val, after_val, reason, job_id, actor)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          r.entityType,
          r.entityId,
          r.action,
          r.field ?? null,
          r.before == null ? null : String(r.before).slice(0, 65000),
          r.after == null ? null : String(r.after).slice(0, 65000),
          r.reason == null ? null : String(r.reason).slice(0, 255),
          r.jobId ?? null,
          r.actor ? String(r.actor).slice(0, 64) : 'auto:hook',
        )
        .catch(() => 0);
    }
  })();
}

// -------------------- Product --------------------

interface ProductRow {
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
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string | null;
  seo_slug: string | null;
  og_image: string | null;
  seo_overrides: unknown;
  seo_source_hash: string | null;
}

const toProductLike = (r: ProductRow): ProductLike => ({
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

/**
 * Generate + validate + persist SEO for a single product (override-aware). Gated by
 * the seoAuto master kill-switch.
 */
export async function persistProductSeo(
  productId: number,
  cfg: SeoConfig,
  opts: RunOptions = {},
): Promise<PersistOutcome> {
  const rows = await prisma
    .$queryRawUnsafe<ProductRow[]>('SELECT * FROM products WHERE id = ? LIMIT 1', productId)
    .catch(() => [] as ProductRow[]);
  const row = rows[0];
  if (!row) return { status: 'not_found' };

  const product = toProductLike(row);
  const overrides = asOverrides(row.seo_overrides);
  const generated: GeneratedProductSeo = generateProductSeo(product, cfg, product.category || undefined);

  // Validate against the current catalogue (dup detection) — effective columns only.
  const [titleRows, slugRows] = await Promise.all([
    prisma
      .$queryRawUnsafe<Array<{ seo_title: string | null; seo_description: string | null }>>(
        'SELECT seo_title, seo_description FROM products WHERE id <> ? AND (seo_title IS NOT NULL OR seo_description IS NOT NULL)',
        productId,
      )
      .catch(() => []),
    prisma
      .$queryRawUnsafe<Array<{ seo_slug: string | null }>>(
        'SELECT seo_slug FROM products WHERE id <> ? AND seo_slug IS NOT NULL',
        productId,
      )
      .catch(() => []),
  ]);
  const existingTitles = new Set<string>();
  for (const t of titleRows) {
    if (t.seo_title) existingTitles.add(String(t.seo_title).toLowerCase());
    if (t.seo_description) existingTitles.add(`desc:${String(t.seo_description).toLowerCase()}`);
  }
  const existingSlugs = new Set<string>(slugRows.map((s) => String(s.seo_slug).toLowerCase()));

  const result = validateProductSeo(generated, product, { existingTitles, existingSlugs });
  // DB-truth check against the Offer we would emit (price + availability from DB).
  const price = num(product.price);
  const dbTruth: ProblemCode[] = checkDbTruth(product, {
    availability: product.in_stock === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
    price: price > 0 ? price : null,
  });
  const problems = [...new Set<ProblemCode>([...result.problems, ...dbTruth])];
  const { score } = scoreProduct(product, generated, problems);

  // Race-safety: recompute the source hash just before write; skip if it moved.
  const freshHash = productSourceHash(product);

  // Which effective fields are engine-owned (og_image EXCLUDED).
  const fieldWrites: Array<{ col: string; genKey: keyof GeneratedProductSeo; before: string | null }> = [
    { col: 'seo_title', genKey: 'title', before: row.seo_title },
    { col: 'seo_description', genKey: 'description', before: row.seo_description },
    { col: 'seo_keywords', genKey: 'keywords', before: row.seo_keywords },
    { col: 'seo_slug', genKey: 'slug', before: row.seo_slug },
  ];
  const overrideKey: Record<string, string> = {
    seo_title: 'title',
    seo_description: 'description',
    seo_keywords: 'keywords',
    seo_slug: 'slug',
  };

  const audits: AuditRow[] = [];
  const setCols: string[] = [];
  const setVals: unknown[] = [];
  const wrote: string[] = [];
  const fatal = !result.ok;

  for (const fw of fieldWrites) {
    if (overrides[overrideKey[fw.col]] === true) {
      audits.push({
        entityType: 'product',
        entityId: String(productId),
        action: 'skip_override',
        field: fw.col,
        reason: 'human override set',
        jobId: opts.jobId,
        actor: opts.actor,
      });
      continue;
    }
    if (fatal) continue; // fatal validation: keep previous effective values
    const value = String(generated[fw.genKey] ?? '');
    setCols.push(`${fw.col} = ?`);
    setVals.push(value || null);
    wrote.push(fw.col);
    audits.push({
      entityType: 'product',
      entityId: String(productId),
      action: 'publish',
      field: fw.col,
      before: fw.before,
      after: value,
      jobId: opts.jobId,
      actor: opts.actor,
    });
  }

  if (fatal) {
    audits.push({
      entityType: 'product',
      entityId: String(productId),
      action: 'validation_fail',
      reason: problems.filter((p) => ['CANONICAL_BAD', 'BLOCKED_PUBLIC', 'FABRICATION'].includes(p)).join(','),
      jobId: opts.jobId,
      actor: opts.actor,
    });
  }

  // Always refresh seo_auto_json + score/flags/hash (metadata, never override-gated).
  const published = await prisma
    .$transaction(async (tx) => {
      // Re-read the hash inside the transaction; if it changed since we loaded, bail.
      const cur = (
        await tx.$queryRawUnsafe<Array<{ seo_source_hash: string | null }>>(
          'SELECT seo_source_hash FROM products WHERE id = ? LIMIT 1',
          productId,
        )
      )[0];
      if (cur && cur.seo_source_hash !== row.seo_source_hash) return false; // moved mid-flight → requeue
      const cols = [
        ...setCols,
        'seo_auto_json = ?',
        'seo_score = ?',
        'seo_problems = ?',
        'seo_generated_at = NOW(3)',
        'seo_source_hash = ?',
      ];
      const vals = [
        ...setVals,
        JSON.stringify(generated),
        Math.max(0, Math.min(255, Math.round(score))),
        JSON.stringify(problems),
        freshHash,
        productId,
      ];
      await tx.$executeRawUnsafe(`UPDATE products SET ${cols.join(', ')} WHERE id = ?`, ...vals);
      return true;
    })
    .catch(() => false);

  if (!published) return { status: 'race', sourceHash: freshHash };

  writeAuditRows(audits);
  return { status: 'published', score, problems, sourceHash: freshHash, wrote };
}

/** Entry hook for a single product — begins with the seoAuto kill-switch gate. */
export async function runProductSeo(productId: number, opts: RunOptions = {}): Promise<PersistOutcome> {
  const features = await loadFeatures();
  if (!features.seoAuto) return { status: 'skipped_off' };
  const cfg = await loadSeoConfig();
  return persistProductSeo(productId, cfg, opts);
}

// -------------------- Category --------------------

interface CategoryRow {
  id: bigint | number;
  name: string;
  slug: string;
  image: string | null;
  og_image: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string | null;
  seo_intro: string | null;
  seo_overrides: unknown;
  seo_source_hash: string | null;
}

/**
 * Generate + validate + persist SEO for a single category (override-aware). Gated by
 * the seoAuto master kill-switch via runCategorySeo.
 */
export async function persistCategorySeo(
  categoryId: number,
  cfg: SeoConfig,
  opts: RunOptions = {},
): Promise<PersistOutcome> {
  const rows = await prisma
    .$queryRawUnsafe<CategoryRow[]>('SELECT * FROM categories WHERE id = ? LIMIT 1', categoryId)
    .catch(() => [] as CategoryRow[]);
  const row = rows[0];
  if (!row) return { status: 'not_found' };

  const members = await prisma
    .$queryRawUnsafe<Array<{ name: string }>>(
      'SELECT name FROM products WHERE category = ? ORDER BY name ASC',
      row.slug,
    )
    .catch(() => [] as Array<{ name: string }>);
  const memberProducts: ProductLike[] = members.map((m) => ({ name: m.name }));

  const category: CategoryLike = {
    id: Number(row.id),
    name: row.name,
    slug: row.slug,
    image: row.image,
    og_image: row.og_image,
  };
  const overrides = asOverrides(row.seo_overrides);
  const generated: GeneratedCategorySeo = generateCategorySeo(category, memberProducts, cfg);

  const [titleRows, slugRows] = await Promise.all([
    prisma
      .$queryRawUnsafe<Array<{ seo_title: string | null; seo_description: string | null }>>(
        'SELECT seo_title, seo_description FROM categories WHERE id <> ? AND (seo_title IS NOT NULL OR seo_description IS NOT NULL)',
        categoryId,
      )
      .catch(() => []),
    // Category slug uniqueness is checked against the categories.slug column.
    prisma
      .$queryRawUnsafe<Array<{ slug: string | null }>>('SELECT slug FROM categories WHERE id <> ?', categoryId)
      .catch(() => []),
  ]);
  const existingTitles = new Set<string>();
  for (const t of titleRows) {
    if (t.seo_title) existingTitles.add(String(t.seo_title).toLowerCase());
    if (t.seo_description) existingTitles.add(`desc:${String(t.seo_description).toLowerCase()}`);
  }
  const existingSlugs = new Set<string>(slugRows.map((s) => String(s.slug).toLowerCase()));

  const result = validateCategorySeo(generated, { existingTitles, existingSlugs });
  const problems = [...new Set<ProblemCode>(result.problems)];
  const { score } = scoreCategory(generated, problems, !!(row.image || row.og_image));
  const freshHash = categorySourceHash(category, memberProducts);

  const fieldWrites: Array<{ col: string; genKey: keyof GeneratedCategorySeo; ovKey: string; before: string | null }> = [
    { col: 'seo_title', genKey: 'title', ovKey: 'title', before: row.seo_title },
    { col: 'seo_description', genKey: 'description', ovKey: 'description', before: row.seo_description },
    { col: 'seo_keywords', genKey: 'keywords', ovKey: 'keywords', before: row.seo_keywords },
    { col: 'seo_intro', genKey: 'intro', ovKey: 'intro', before: row.seo_intro },
  ];

  const audits: AuditRow[] = [];
  const setCols: string[] = [];
  const setVals: unknown[] = [];
  const wrote: string[] = [];
  const fatal = !result.ok;

  for (const fw of fieldWrites) {
    if (overrides[fw.ovKey] === true) {
      audits.push({
        entityType: 'category',
        entityId: String(categoryId),
        action: 'skip_override',
        field: fw.col,
        reason: 'human override set',
        jobId: opts.jobId,
        actor: opts.actor,
      });
      continue;
    }
    if (fatal) continue;
    const value = String(generated[fw.genKey] ?? '');
    setCols.push(`${fw.col} = ?`);
    setVals.push(value || null);
    wrote.push(fw.col);
    audits.push({
      entityType: 'category',
      entityId: String(categoryId),
      action: 'publish',
      field: fw.col,
      before: fw.before,
      after: value,
      jobId: opts.jobId,
      actor: opts.actor,
    });
  }

  if (fatal) {
    audits.push({
      entityType: 'category',
      entityId: String(categoryId),
      action: 'validation_fail',
      reason: problems.filter((p) => ['CANONICAL_BAD', 'BLOCKED_PUBLIC', 'FABRICATION'].includes(p)).join(','),
      jobId: opts.jobId,
      actor: opts.actor,
    });
  }

  const published = await prisma
    .$transaction(async (tx) => {
      const cur = (
        await tx.$queryRawUnsafe<Array<{ seo_source_hash: string | null }>>(
          'SELECT seo_source_hash FROM categories WHERE id = ? LIMIT 1',
          categoryId,
        )
      )[0];
      if (cur && cur.seo_source_hash !== row.seo_source_hash) return false;
      const cols = [
        ...setCols,
        'seo_auto_json = ?',
        'seo_score = ?',
        'seo_problems = ?',
        'seo_generated_at = NOW(3)',
        'seo_source_hash = ?',
      ];
      const vals = [
        ...setVals,
        JSON.stringify(generated),
        Math.max(0, Math.min(255, Math.round(score))),
        JSON.stringify(problems),
        freshHash,
        categoryId,
      ];
      await tx.$executeRawUnsafe(`UPDATE categories SET ${cols.join(', ')} WHERE id = ?`, ...vals);
      return true;
    })
    .catch(() => false);

  if (!published) return { status: 'race', sourceHash: freshHash };

  writeAuditRows(audits);
  return { status: 'published', score, problems, sourceHash: freshHash, wrote };
}

/** Entry hook for a single category — begins with the seoAuto kill-switch gate. */
export async function runCategorySeo(categoryId: number, opts: RunOptions = {}): Promise<PersistOutcome> {
  const features = await loadFeatures();
  if (!features.seoAuto) return { status: 'skipped_off' };
  const cfg = await loadSeoConfig();
  return persistCategorySeo(categoryId, cfg, opts);
}
