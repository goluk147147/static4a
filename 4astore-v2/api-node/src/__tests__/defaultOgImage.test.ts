/**
 * Default OG image source — PURE test (DB-free, network-free).
 *
 * BUG #1 fix: the global default OG image must point at the dynamic branded-logo-card
 * endpoint (GET /api/og/image/default → `${API_ORIGIN}/og/image/default`), NOT the
 * old static `${SITE_ORIGIN}/assets/og-default.png` file that does not exist on the
 * server (it returned the SPA HTML fallback, so the social preview was blank/404).
 * mergeSeoConfig still lets an admin-saved defaultOgImage override win — that is not
 * asserted here; this guards the baked-in default only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSeoConfig } from '../seo/localSeo';
import { API_ORIGIN } from '../seo/origin';

test('defaultSeoConfig: defaultOgImage is the dynamic default OG endpoint', () => {
  assert.equal(defaultSeoConfig().defaultOgImage, `${API_ORIGIN}/og/image/default`);
});

test('defaultSeoConfig: defaultOgImage no longer points at the broken static PNG', () => {
  assert.ok(
    !defaultSeoConfig().defaultOgImage.includes('/assets/og-default.png'),
    'must not reference the removed static /assets/og-default.png',
  );
});
