/**
 * Short-link custom OG card + validators — PURE tests (DB-free, network-free).
 *
 * Guarantees the WhatsApp/social preview is NEVER blank:
 *   - CUSTOM link with an admin image → that absolute image appears in og:image.
 *   - CUSTOM link with no image → cfg.defaultOgImage (the 4A Store default logo
 *     card) appears instead of a blank image.
 *   - Title falls back to the store name when no custom title is given.
 *
 * The PRODUCT no-image case is handled UPSTREAM, not here: buildProductShareHtml
 * sets image = `${API_ORIGIN}/og/image/product/<id>`, and that dynamic generator
 * (services/og.ts → renderProductHeroImage) draws the 4A Store logo when the
 * product photo is missing (`else if (logo) drawHeroPhoto(ctx, logo, true)`), so
 * a product with no image still renders the branded logo card — never blank. That
 * path needs canvas + a real product row, so it is covered by the og.ts logic and
 * asserted for structure in the API's product-OG route rather than re-rendered
 * here. These tests cover the substantive NEW logic: the custom-link card.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomShareHtml, type CustomShareArgs } from '../services/ogShare';
import { normaliseOgImage, normaliseOgTitle } from '../services/shortLink';

// Minimal SeoConfig stub satisfying only the fields buildCustomShareHtml reads.
const cfg = {
  defaultOgImage: 'https://4astore.com/assets/og-default.png',
  defaultDescription: '4A Store — grocery in minutes.',
  business: { name: '4A Store' },
} as unknown as CustomShareArgs['cfg'];

test('buildCustomShareHtml: admin image → that absolute image is the og:image', () => {
  const img = 'https://4astore.com/uploads/my-banner.jpg';
  const html = buildCustomShareHtml({ code: 'abc123', target: 'https://example.com', ogImage: img, ogTitle: null, cfg });
  assert.ok(html.includes(`<meta property="og:image" content="${img}">`), 'og:image is the admin image');
  assert.ok(html.includes(`<meta name="twitter:image" content="${img}">`), 'twitter:image is the admin image');
});

test('buildCustomShareHtml: no image → falls back to cfg.defaultOgImage (NEVER blank)', () => {
  for (const empty of [null, undefined, '', '   '] as (string | null | undefined)[]) {
    const html = buildCustomShareHtml({ code: 'abc123', target: 'https://example.com', ogImage: empty, ogTitle: null, cfg });
    assert.ok(html.includes(`content="${cfg.defaultOgImage}"`), `empty image (${JSON.stringify(empty)}) → default card`);
    assert.ok(!/content=""/.test(html), 'image meta is never blank');
  }
});

test('buildCustomShareHtml: title falls back to the store name, else uses the given title', () => {
  const noTitle = buildCustomShareHtml({ code: 'abc123', target: 'https://example.com', ogImage: null, ogTitle: null, cfg });
  assert.ok(noTitle.includes('<meta property="og:title" content="4A Store">'), 'no title → store name');

  const withTitle = buildCustomShareHtml({ code: 'abc123', target: 'https://example.com', ogImage: null, ogTitle: 'Diwali Sale', cfg });
  assert.ok(withTitle.includes('<meta property="og:title" content="Diwali Sale">'), 'given title is used');
});

test('buildCustomShareHtml: short links are noindex (not canonical SEO pages)', () => {
  const html = buildCustomShareHtml({ code: 'abc123', target: 'https://example.com', ogImage: null, ogTitle: null, cfg });
  assert.ok(html.includes('<meta name="robots" content="noindex,nofollow">'), 'robots noindex,nofollow');
});

test('normaliseOgImage: empty → null, valid https → unchanged, non-http → throws', () => {
  assert.equal(normaliseOgImage(undefined), null);
  assert.equal(normaliseOgImage(null), null);
  assert.equal(normaliseOgImage('   '), null);
  assert.equal(normaliseOgImage('https://4astore.com/a.jpg'), 'https://4astore.com/a.jpg');
  assert.equal(normaliseOgImage('  http://x.test/a.png  '), 'http://x.test/a.png');
  assert.throws(() => normaliseOgImage('/uploads/a.jpg'), /http\(s\) URL/);
  assert.throws(() => normaliseOgImage('javascript:alert(1)'), /http\(s\) URL/);
  assert.throws(() => normaliseOgImage(`https://x.test/${'a'.repeat(1000)}.jpg`), /http\(s\) URL/);
});

test('normaliseOgTitle: trims, empty → null, clamps to 255', () => {
  assert.equal(normaliseOgTitle(undefined), null);
  assert.equal(normaliseOgTitle('   '), null);
  assert.equal(normaliseOgTitle('  Diwali Sale  '), 'Diwali Sale');
  assert.equal(normaliseOgTitle('x'.repeat(300))?.length, 255);
});
