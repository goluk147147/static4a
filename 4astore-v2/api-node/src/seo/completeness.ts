// Pure (DB-free) completeness scoring for the SEO engine.
//
// Score = weighted sum of satisfied checks (0..100). Weights live in SCORE_WEIGHTS
// (tunable, summing to 100) and the single "needs attention" predicate (score below
// ATTENTION_THRESHOLD OR any unresolved problem) is shared by the dashboard and the
// optimizer skip logic so they can never disagree.

import type { ProductLike } from './localSeo';
import type { GeneratedProductSeo, GeneratedCategorySeo } from './generate';
import type { ProblemCode } from './validate';

// -------------------- Tunable constants (design §5.4) --------------------
export const SCORE_WEIGHTS = {
  title: 20, // present + ≤60 + unique
  description: 20, // present + 50–160 + unique
  dbTruth: 15, // JSON-LD price/availability match DB
  keywords: 10, // present + relevant
  slug: 10, // unique + safe
  image: 10, // image present + non-empty alt
  canonical: 10, // absolute https, matches route
  indexing: 5, // not wrongly noindexed
} as const;

export const ATTENTION_THRESHOLD = 80;

// Category scoring drops dbTruth (no price/availability) and reallocates its 15
// points to the two SERP elements the crawler shows.
const CATEGORY_WEIGHTS = {
  title: 28,
  description: 27,
  keywords: 10,
  slug: 10,
  image: 10,
  canonical: 10,
  indexing: 5,
} as const;

export interface ScoreResult {
  score: number;
  problems: string[];
}

type AnyProblem = ProblemCode;

const has = (problems: AnyProblem[], ...codes: AnyProblem[]): boolean =>
  codes.some((c) => problems.includes(c));

/**
 * Single "needs attention" predicate shared by the dashboard and the optimizer skip
 * logic: a low score OR any unresolved problem.
 */
export function needsAttention(score: number, problems: string[] | null | undefined): boolean {
  return score < ATTENTION_THRESHOLD || (!!problems && problems.length > 0);
}

// -------------------- Product scoring --------------------
export function scoreProduct(
  product: ProductLike,
  generated: GeneratedProductSeo,
  problems: AnyProblem[],
): ScoreResult {
  let score = 0;
  const w = SCORE_WEIGHTS;

  if (!has(problems, 'TITLE_EMPTY', 'TITLE_TOO_LONG', 'TITLE_DUP')) score += w.title;
  if (!has(problems, 'DESC_EMPTY', 'DESC_TOO_LONG', 'DESC_DUP')) score += w.description;
  if (!has(problems, 'PRICE_MISMATCH', 'AVAILABILITY_MISMATCH')) score += w.dbTruth;
  if (!has(problems, 'KEYWORDS_IRRELEVANT')) score += w.keywords;
  if (!has(problems, 'SLUG_DUP', 'SLUG_UNSAFE')) score += w.slug;
  // Image check: full credit when there is no image, or image + alt present.
  if (!product.image || !has(problems, 'IMAGE_MISSING_ALT')) score += w.image;
  if (!has(problems, 'CANONICAL_BAD')) score += w.canonical;
  if (!has(problems, 'BLOCKED_PUBLIC')) score += w.indexing;

  return { score: Math.max(0, Math.min(100, score)), problems: [...new Set(problems.map(String))] };
}

// -------------------- Category scoring --------------------
export function scoreCategory(
  generated: GeneratedCategorySeo,
  problems: AnyProblem[],
  hasImage = false,
): ScoreResult {
  let score = 0;
  const w = CATEGORY_WEIGHTS;

  if (!has(problems, 'TITLE_EMPTY', 'TITLE_TOO_LONG', 'TITLE_DUP')) score += w.title;
  if (!has(problems, 'DESC_EMPTY', 'DESC_TOO_LONG', 'DESC_DUP')) score += w.description;
  if (!has(problems, 'KEYWORDS_IRRELEVANT')) score += w.keywords;
  if (!has(problems, 'SLUG_DUP', 'SLUG_UNSAFE')) score += w.slug;
  if (!hasImage || !has(problems, 'IMAGE_MISSING_ALT')) score += w.image;
  if (!has(problems, 'CANONICAL_BAD')) score += w.canonical;
  if (!has(problems, 'BLOCKED_PUBLIC')) score += w.indexing;

  return { score: Math.max(0, Math.min(100, score)), problems: [...new Set(problems.map(String))] };
}
