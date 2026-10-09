// Duplicate-metadata detection + keyword cannibalization map for the SEO engine.
//
// findDuplicates() runs GROUP BY queries over the products' effective SEO columns to
// feed the dashboard "duplicate metadata" counters and the TITLE_DUP/DESC_DUP/SLUG_DUP
// gates. keywordMap() picks the single best page per primary keyword and demotes the
// weaker competitors (anti-cannibalization). GSC-derived volume/position/competition
// are reported as `unavailable` and NEVER fabricated.

import { prisma } from '../db';

export interface DuplicateGroup {
  value: string;
  ids: string[];
}

export interface DuplicateReport {
  titles: DuplicateGroup[];
  descriptions: DuplicateGroup[];
  slugs: DuplicateGroup[];
}

interface DupRow {
  val: string | null;
  ids: string | null;
}

const toGroups = (rows: DupRow[]): DuplicateGroup[] =>
  rows
    .filter((r) => r.val != null && r.val !== '')
    .map((r) => ({ value: String(r.val), ids: String(r.ids || '').split(',').filter(Boolean) }))
    .filter((g) => g.ids.length > 1);

/**
 * Groups of product ids that share an identical effective title / description / slug.
 * Only groups with 2+ members are returned. Reads the effective columns directly, so
 * it reflects what crawlers actually see.
 */
export async function findDuplicates(): Promise<DuplicateReport> {
  const q = (col: string) =>
    prisma.$queryRawUnsafe<DupRow[]>(
      `SELECT ${col} AS val, GROUP_CONCAT(id) AS ids
         FROM products
        WHERE ${col} IS NOT NULL AND ${col} <> ''
        GROUP BY ${col}
       HAVING COUNT(*) > 1`,
    );

  const [titles, descriptions, slugs] = await Promise.all([
    q('seo_title').catch(() => [] as DupRow[]),
    q('seo_description').catch(() => [] as DupRow[]),
    q('seo_slug').catch(() => [] as DupRow[]),
  ]);

  return {
    titles: toGroups(titles),
    descriptions: toGroups(descriptions),
    slugs: toGroups(slugs),
  };
}

export interface KeywordWinner {
  keyword: string;
  bestProductId: string;
  demotedProductIds: string[];
  // GSC metrics are never fabricated — labelled unavailable until GSC connects.
  volume: 'unavailable';
  position: 'unavailable';
  competition: 'unavailable';
}

interface KwRow {
  id: bigint | number | string;
  name: string | null;
  category: string | null;
  seo_keywords: string | null;
}

/**
 * For each primary keyword, pick the single best-matching page (exact name match beats
 * category match) and demote the weaker competitors. Returns one entry per contested
 * keyword. GSC volume/position/competition are returned as `unavailable`.
 */
export async function keywordMap(): Promise<KeywordWinner[]> {
  const rows = await prisma
    .$queryRawUnsafe<KwRow[]>(
      `SELECT id, name, category, seo_keywords FROM products WHERE seo_keywords IS NOT NULL AND seo_keywords <> ''`,
    )
    .catch(() => [] as KwRow[]);

  // keyword -> candidate pages with a relevance rank (2 = exact name, 1 = category, 0 = other)
  const byKeyword = new Map<string, Array<{ id: string; rank: number }>>();
  for (const r of rows) {
    const id = String(r.id);
    const name = String(r.name || '').toLowerCase();
    const category = String(r.category || '').toLowerCase();
    const primary = String(r.seo_keywords || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)[0];
    if (!primary) continue;
    const kw = primary.toLowerCase();
    const rank = name === kw ? 2 : category === kw ? 1 : 0;
    const list = byKeyword.get(kw) || [];
    list.push({ id, rank });
    byKeyword.set(kw, list);
  }

  const winners: KeywordWinner[] = [];
  for (const [keyword, list] of byKeyword) {
    if (list.length < 2) continue; // not contested
    list.sort((a, b) => b.rank - a.rank);
    winners.push({
      keyword,
      bestProductId: list[0].id,
      demotedProductIds: list.slice(1).map((x) => x.id),
      volume: 'unavailable',
      position: 'unavailable',
      competition: 'unavailable',
    });
  }
  return winners;
}
