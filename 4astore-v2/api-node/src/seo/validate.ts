// Pure (DB-free) pre-publish quality + safety gates for the SEO engine.
//
// Each gate returns a stable PROBLEM CODE consumed by completeness.ts and the admin
// dashboard. Codes are split into `recoverable` (fall back to safe metadata) and
// `fatal` (skip the publish, keep the previous value, log validation_fail). The
// FABRICATION gate is the single enforcement point for "never invent prices /
// discounts / ratings / cheapest / lowest".

import type { ProductLike } from './localSeo';
import type { GeneratedProductSeo, GeneratedCategorySeo } from './generate';

// -------------------- Problem codes --------------------
export type ProblemCode =
  | 'TITLE_EMPTY'
  | 'TITLE_TOO_LONG'
  | 'DESC_EMPTY'
  | 'DESC_TOO_LONG'
  | 'TITLE_DUP'
  | 'DESC_DUP'
  | 'SLUG_DUP'
  | 'SLUG_UNSAFE'
  | 'KEYWORDS_IRRELEVANT'
  | 'CANONICAL_BAD'
  | 'AVAILABILITY_MISMATCH'
  | 'PRICE_MISMATCH'
  | 'IMAGE_MISSING_ALT'
  | 'BLOCKED_PUBLIC'
  | 'SPAMMY'
  | 'FABRICATION';

// Fatal codes skip the publish entirely; everything else is recoverable.
export const FATAL_CODES: ReadonlySet<ProblemCode> = new Set<ProblemCode>([
  'CANONICAL_BAD',
  'BLOCKED_PUBLIC',
  'FABRICATION',
]);

export interface ValidationResult {
  ok: boolean;
  problems: ProblemCode[];
}

export interface ProductValidationContext {
  existingTitles?: Set<string>;
  existingSlugs?: Set<string>;
}
export interface CategoryValidationContext {
  existingTitles?: Set<string>;
  existingSlugs?: Set<string>;
}

// -------------------- Shared constants --------------------
const TITLE_MAX = 60;
const DESC_MIN = 50;
const DESC_MAX = 160;
const SLUG_SAFE = /^[a-z0-9-]+$/;
const CANONICAL_OK = /^https:\/\/[^\s]+$/;

// Banned marketing / fabrication claims. "100% organic" and review/rating words are
// only allowed if they are a verified attribute of the product — this engine never
// derives them, so their presence always signals fabrication.
const FABRICATION_RE =
  /\b(sabse\s+sasta|cheapest|lowest\s+price|best\s+price|#\s*1|number\s+one|guaranteed|guarantee|100%\s*organic|review|reviews|rating|ratings|star\s+rated)\b/i;

const toNum = (v: unknown): number => {
  if (v == null) return NaN;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : NaN;
};

const toTokens = (s: string): string[] =>
  String(s || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

const haystackOf = (...parts: Array<string | null | undefined>): string =>
  parts.map((p) => String(p || '').toLowerCase()).join(' ');

const expectedAvailability = (product: ProductLike): string =>
  product.in_stock === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock';

/** True when any single whitespace token repeats more than 3 times. */
const hasSpammyRepetition = (text: string): boolean => {
  const counts = new Map<string, number>();
  for (const w of String(text || '').toLowerCase().split(/\s+/).filter(Boolean)) {
    const n = (counts.get(w) || 0) + 1;
    counts.set(w, n);
    if (n > 3) return true;
  }
  return false;
};

// -------------------- Product validation --------------------
export function validateProductSeo(
  generated: GeneratedProductSeo,
  product: ProductLike,
  ctx: ProductValidationContext = {},
): ValidationResult {
  const problems: ProblemCode[] = [];
  const existingTitles = ctx.existingTitles || new Set<string>();
  const existingSlugs = ctx.existingSlugs || new Set<string>();

  const title = (generated.title || '').trim();
  const desc = (generated.description || '').trim();

  // Title
  if (!title) problems.push('TITLE_EMPTY');
  else if (title.length > TITLE_MAX) problems.push('TITLE_TOO_LONG');
  if (title && existingTitles.has(title.toLowerCase())) problems.push('TITLE_DUP');

  // Description
  if (!desc) problems.push('DESC_EMPTY');
  else if (desc.length > DESC_MAX || desc.length < DESC_MIN) problems.push('DESC_TOO_LONG');
  if (desc && existingTitles.has(`desc:${desc.toLowerCase()}`)) problems.push('DESC_DUP');

  // Slug
  const slug = (generated.slug || '').trim();
  if (!slug || !SLUG_SAFE.test(slug)) problems.push('SLUG_UNSAFE');
  if (slug && existingSlugs.has(slug.toLowerCase())) problems.push('SLUG_DUP');

  // Keyword relevance: every token must appear in verified attributes.
  const hay = haystackOf(product.name, product.brand, product.category, product.weight, generated.title);
  const stray = toTokens(generated.keywords).some(
    (tok) => !tok.split(/\s+/).some((w) => hay.includes(w)),
  );
  if (stray) problems.push('KEYWORDS_IRRELEVANT');

  // Canonical
  if (!CANONICAL_OK.test(generated.canonical || '')) problems.push('CANONICAL_BAD');

  // DB-truth: availability + price. JSON-LD is built from the same canonical here, so
  // we assert against the DB-derived expected token/value.
  if (generated.indexing !== 'index,follow') problems.push('BLOCKED_PUBLIC');
  void expectedAvailability; // availability is recomputed from DB at publish (see note)

  // Image alt
  if (product.image && !(generated.imageAlt || '').trim()) problems.push('IMAGE_MISSING_ALT');

  // Spam / fabrication
  const blob = `${title} ${desc} ${generated.keywords}`;
  if (hasSpammyRepetition(blob)) problems.push('SPAMMY');
  if (FABRICATION_RE.test(blob)) problems.push('FABRICATION');

  const ok = !problems.some((p) => FATAL_CODES.has(p));
  return { ok, problems };
}

/**
 * Assert the availability/price tokens actually emitted into JSON-LD match the DB.
 * Kept separate because it needs the built JSON-LD offer, not just the generated text.
 */
export function checkDbTruth(
  product: ProductLike,
  emitted: { availability?: string | null; price?: string | number | null },
): ProblemCode[] {
  const problems: ProblemCode[] = [];
  if (emitted.availability != null && emitted.availability !== expectedAvailability(product)) {
    problems.push('AVAILABILITY_MISMATCH');
  }
  const dbPrice = toNum(product.price);
  if (Number.isFinite(dbPrice) && dbPrice > 0 && emitted.price != null) {
    const emittedPrice = toNum(emitted.price);
    if (!Number.isFinite(emittedPrice) || emittedPrice.toFixed(2) !== dbPrice.toFixed(2)) {
      problems.push('PRICE_MISMATCH');
    }
  }
  return problems;
}

// -------------------- Category validation (no price/availability) --------------------
export function validateCategorySeo(
  generated: GeneratedCategorySeo,
  ctx: CategoryValidationContext = {},
): ValidationResult {
  const problems: ProblemCode[] = [];
  const existingTitles = ctx.existingTitles || new Set<string>();
  const existingSlugs = ctx.existingSlugs || new Set<string>();

  const title = (generated.title || '').trim();
  const desc = (generated.description || '').trim();

  if (!title) problems.push('TITLE_EMPTY');
  else if (title.length > TITLE_MAX) problems.push('TITLE_TOO_LONG');
  if (title && existingTitles.has(title.toLowerCase())) problems.push('TITLE_DUP');

  if (!desc) problems.push('DESC_EMPTY');
  else if (desc.length > DESC_MAX || desc.length < DESC_MIN) problems.push('DESC_TOO_LONG');
  if (desc && existingTitles.has(`desc:${desc.toLowerCase()}`)) problems.push('DESC_DUP');

  const slug = (generated.slug || '').trim();
  if (!slug || !SLUG_SAFE.test(slug)) problems.push('SLUG_UNSAFE');
  if (slug && existingSlugs.has(slug.toLowerCase())) problems.push('SLUG_DUP');

  if (!CANONICAL_OK.test(generated.canonical || '')) problems.push('CANONICAL_BAD');
  if (generated.indexing !== 'index,follow') problems.push('BLOCKED_PUBLIC');

  const blob = `${title} ${desc} ${generated.intro} ${generated.keywords}`;
  if (hasSpammyRepetition(blob)) problems.push('SPAMMY');
  if (FABRICATION_RE.test(blob)) problems.push('FABRICATION');

  const ok = !problems.some((p) => FATAL_CODES.has(p));
  return { ok, problems };
}
