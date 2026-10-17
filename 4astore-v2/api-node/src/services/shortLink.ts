// Universal short-link service — the ONE place short codes are generated and
// resolved. Backs:
//   - auto-create on single product create   (routes/admin.ts)
//   - auto-create on bulk import              (services/dataImport.ts importProducts)
//   - admin-created custom links for any URL  (routes/admin-links.ts)
//   - the public on-demand resolver           (routes/catalog.ts /products/:id/short-link)
//   - the redirect route                      (routes/link.ts GET /:code)
//
// The `short_links` table is created at runtime by ensureShortLinkTables()
// (services/dataImport.ts) — this service only reads/writes rows via the
// prisma.shortLink delegate. All product auto-create paths are best-effort and
// must NEVER throw, so a short-link failure can never block a product save.

import crypto from 'crypto';
import { prisma } from '../db';

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generate a random base62 short code. Defaults to 7 chars (62^7 ≈ 3.5e12 — ample
 * for this catalogue) and never exceeds the 16-char `code` column. Uses
 * crypto.randomBytes for unbiased, collision-resistant codes.
 */
export function generateCode(length = 7): string {
  const n = Math.max(6, Math.min(8, Math.trunc(length)));
  const bytes = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += BASE62[bytes[i] % 62];
  return out;
}

/**
 * Normalise a target into a storable value: a bare SPA path (`/product/5`) is
 * kept as-is; a full http(s) URL is kept as-is; anything else is coerced to a
 * leading-slash path. Trimmed and clamped to the column width (1000).
 */
function normaliseTarget(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return '/';
  const value = /^https?:\/\//i.test(t) || t.startsWith('/') ? t : `/${t}`;
  return value.slice(0, 1000);
}

/**
 * Idempotently ensure a short link for a product. Returns the existing row's
 * code when one already exists (so re-running on the same product never makes a
 * duplicate), otherwise inserts a new row (retrying on a UNIQUE code collision).
 * Best-effort: returns null instead of throwing so callers can fire-and-forget.
 */
export async function createShortLinkForProduct(productId: number): Promise<string | null> {
  const id = Number(productId);
  if (!Number.isFinite(id) || id <= 0) return null;
  try {
    const existing = await prisma.shortLink.findFirst({
      where: { product_id: BigInt(id), type: 'product' },
      select: { code: true },
    });
    if (existing) return existing.code;

    const targetUrl = `/product/${id}`;
    // Retry a few times on the (rare) UNIQUE code collision.
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = generateCode();
      try {
        await prisma.shortLink.create({
          data: { code, target_url: targetUrl, type: 'product', product_id: BigInt(id) },
        });
        return code;
      } catch (e) {
        // A concurrent create may have inserted the product's link between our
        // findFirst and create — return that one instead of looping forever.
        const dup = await prisma.shortLink
          .findFirst({ where: { product_id: BigInt(id), type: 'product' }, select: { code: true } })
          .catch(() => null);
        if (dup) return dup.code;
        // Otherwise assume a code collision and try a fresh code.
        const msg = e instanceof Error ? e.message : String(e);
        if (!/unique|duplicate|P2002/i.test(msg)) break; // non-collision error → give up quietly
      }
    }
    return null;
  } catch {
    return null;
  }
}

export interface CreateCustomShortLinkInput {
  targetUrl: string;
  type?: string;
  code?: string;
  createdBy?: string | null;
  /** Optional custom OG preview image (CUSTOM links only). Empty → null → 4A Store default card. */
  ogImage?: string | null;
  /** Optional custom OG preview title (CUSTOM links only). Empty → null → brand default. */
  ogTitle?: string | null;
}

export interface CreateCustomShortLinkResult {
  code: string;
  target_url: string;
  type: string;
  og_image: string | null;
  og_title: string | null;
}

/**
 * Validate/normalise a custom OG image URL. Empty/undefined → null (the OG card
 * then falls back to the 4A Store default). A non-empty value must be an http(s)
 * URL (so the crawler can fetch it) and fit the 1000-char column, else throws.
 */
export function normaliseOgImage(raw?: string | null): string | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t) || t.length > 1000) {
    throw new Error('Custom image must be an http(s) URL');
  }
  return t;
}

/** Trim a custom OG title; empty → null; clamp to the 255-char column. */
export function normaliseOgTitle(raw?: string | null): string | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  return t.slice(0, 255);
}

/** Error thrown when a caller-supplied custom code is already taken (→ HTTP 409). */
export class ShortCodeTakenError extends Error {
  constructor(code: string) {
    super(`Short code "${code}" is already in use`);
    this.name = 'ShortCodeTakenError';
  }
}

/** Error thrown when an edit targets a code that does not exist (→ HTTP 404). */
export class ShortLinkNotFoundError extends Error {
  constructor(code: string) {
    super(`Short link "${code}" was not found`);
    this.name = 'ShortLinkNotFoundError';
  }
}

/**
 * Create a short link for ANY url (admin-created). An optional custom `code` is
 * validated (base62, ≤16) and checked for uniqueness — a clash throws
 * ShortCodeTakenError so the route can return 409. With no custom code a random
 * one is generated (retrying on collision). Unlike the product helper this DOES
 * throw on failure so the admin route can surface a real error.
 */
export async function createCustomShortLink(
  input: CreateCustomShortLinkInput
): Promise<CreateCustomShortLinkResult> {
  const target_url = normaliseTarget(input.targetUrl);
  const type = (input.type || 'custom').slice(0, 16);
  const createdBy = input.createdBy ? String(input.createdBy).slice(0, 64) : null;
  // Validate the optional OG overrides up front so a bad image URL surfaces before
  // any DB write (and consistently across both the custom-code and auto branches).
  const og_image = normaliseOgImage(input.ogImage);
  const og_title = normaliseOgTitle(input.ogTitle);

  const custom = String(input.code || '').trim();
  if (custom) {
    if (!/^[A-Za-z0-9]{1,16}$/.test(custom)) {
      throw new Error('Custom code must be 1–16 letters or digits');
    }
    const clash = await prisma.shortLink.findUnique({ where: { code: custom }, select: { id: true } });
    if (clash) throw new ShortCodeTakenError(custom);
    await prisma.shortLink.create({ data: { code: custom, target_url, type, created_by: createdBy, og_image, og_title } });
    return { code: custom, target_url, type, og_image, og_title };
  }

  // Auto-generate a code, retrying on the rare UNIQUE collision.
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateCode();
    try {
      await prisma.shortLink.create({ data: { code, target_url, type, created_by: createdBy, og_image, og_title } });
      return { code, target_url, type, og_image, og_title };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/unique|duplicate|P2002/i.test(msg)) throw e;
    }
  }
  throw new Error('Could not generate a unique short code, please retry');
}

/**
 * Edit an existing short link's custom OG preview overrides (image/title) ONLY.
 * target_url/type are immutable so every existing redirect keeps working. The
 * OG overrides are validated/normalised through the SAME normaliseOgImage/
 * normaliseOgTitle validators used on create (empty → null → 4A Store default
 * card). Throws a clear Error on a bad code, ShortLinkNotFoundError when the row
 * is missing (→ route 404), and the image validator's Error on a bad image URL
 * (→ route 422). Returns the CreateCustomShortLinkResult shape.
 */
export async function updateCustomShortLink(
  code: string,
  input: { ogImage?: string | null; ogTitle?: string | null }
): Promise<CreateCustomShortLinkResult> {
  const trimmed = String(code || '').trim();
  if (!/^[A-Za-z0-9]{1,16}$/.test(trimmed)) {
    throw new Error('Custom code must be 1–16 letters or digits');
  }
  // Validate the OG overrides up front (a bad image URL throws before any DB read).
  const og_image = normaliseOgImage(input.ogImage);
  const og_title = normaliseOgTitle(input.ogTitle);

  const row = await prisma.shortLink.findUnique({
    where: { code: trimmed },
    select: { target_url: true, type: true },
  });
  if (!row) throw new ShortLinkNotFoundError(trimmed);

  await prisma.shortLink.update({ where: { code: trimmed }, data: { og_image, og_title } });
  return { code: trimmed, target_url: row.target_url, type: row.type, og_image, og_title };
}
