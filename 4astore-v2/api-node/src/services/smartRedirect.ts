/* ------------------------------------------------------------------ *
 * Android app deep-link constants + intent:// builder — PURE
 * (DB-free, network-free, Express-free).
 * ------------------------------------------------------------------ *
 * Kept in a dependency-free module so the Node test runner can import the
 * builder WITHOUT pulling in prisma/db or Express (mirrors
 * whatsappFormat.ts / pushAudience.ts). routes/link.ts re-imports these.
 *
 * Mechanism (Chrome-documented server-redirect pattern): routes/link.ts issues
 * an HTTP 302 whose Location header is the intent:// URL this module builds.
 * A top-level navigation to an intent:// URL is Chrome's reliable firing path:
 *   - App installed  → Chrome opens the app via its `fourastore` scheme filter.
 *   - App NOT present → Chrome honours the embedded S.browser_fallback_url,
 *     which is the `market://` Play Store deep-link (opens the Store app /
 *     listing), NOT the website.
 *
 * This replaced the previous JS/HTML page (anchor .click() + setTimeout +
 * visibilitychange) which, on real Chrome, landed uninstalled devices on the
 * website instead of the Play Store — a JS race the 302 removes entirely.
 * ------------------------------------------------------------------ */

// Android app deep-link constants (reference: mobile/app.config.ts — scheme
// fourastore, package com.store4a.app, verified App Link host 4astore.com,
// pathPrefix /product). The ONE place the smart redirect needs them.
export const ANDROID_PACKAGE = 'com.store4a.app';
// The app's CUSTOM URL scheme (mobile/app.config.ts → `scheme: 'fourastore'`).
// The intent uses this (NOT scheme=https) so that when the app is NOT installed,
// Chrome has no web URL to fall through to and instead honours the embedded
// S.browser_fallback_url (the Play Store).
export const APP_SCHEME = 'fourastore';
// `market://` Play Store deep-link used as the no-app fallback. market:// is more
// reliable than the https Play URL for triggering the Store app on an uninstalled
// device (the https URL can be intercepted as a plain web link).
export const MARKET_FALLBACK_URL = `market://details?id=${ANDROID_PACKAGE}`;

/**
 * Build the Android intent:// URL for an App-Link-eligible target.
 *
 * `appPath` (e.g. `/product/5`) is present only for an app-eligible target and
 * becomes the intent host/path (leading slash stripped → `product/5`). Returns
 * `null` for a non-app / custom link (`appPath == null`), signalling the caller
 * to redirect to the website instead.
 *
 * Shape (Chrome intents syntax):
 *   intent://<path>#Intent;scheme=fourastore;package=com.store4a.app;S.browser_fallback_url=<ENCODED market url>;end
 */
export function buildAndroidIntentUrl(appPath: string | null): string | null {
  if (!appPath) return null;
  const schemePath = appPath.replace(/^\//, '');
  return (
    `intent://${schemePath}#Intent;scheme=${APP_SCHEME};package=${ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(MARKET_FALLBACK_URL)};end`
  );
}
