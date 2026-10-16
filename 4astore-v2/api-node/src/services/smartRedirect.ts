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

// Public site host (the verified App Links host). The intent uses this host with
// scheme=https so an installed app opens via its verified App Link, and an
// uninstalled device cleanly hits the market:// fallback. A bare host-less
// intent (intent://product/3) made Chrome show "site can't be reached".
export const SITE_HOST = '4astore.com';

/**
 * Build the Android intent:// URL for an App-Link-eligible target.
 *
 * `appPath` (e.g. `/product/5`) is present only for an app-eligible target.
 * Returns `null` for a non-app / custom link, signalling the caller to use the
 * website instead.
 *
 * Shape (Chrome intents syntax) — host + scheme=https so the verified App Link
 * resolves to the app when installed, and the embedded market:// fallback opens
 * the Play Store when it is not:
 *   intent://4astore.com/product/5#Intent;scheme=https;package=com.store4a.app;S.browser_fallback_url=<ENCODED market url>;end
 *
 * This MUST be fired by an in-page top-level navigation (window.location.href in
 * the page the caller returns), NOT by an HTTP 302 Location header — Chrome does
 * not reliably resolve an intent:// delivered via a 302 (it showed
 * "site can't be reached").
 */
export function buildAndroidIntentUrl(appPath: string | null): string | null {
  if (!appPath) return null;
  const path = appPath.startsWith('/') ? appPath : `/${appPath}`;
  return (
    `intent://${SITE_HOST}${path}#Intent;scheme=https;package=${ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(MARKET_FALLBACK_URL)};end`
  );
}

/**
 * Minimal HTML page that fires the Android intent via an in-page top-level
 * navigation (the reliable path, unlike a 302). The script is at the END of
 * <body> so document is ready. Non-JS clients get the <noscript> website link.
 * `intentUrl` must be pre-built (buildAndroidIntentUrl); `websiteUrl` is the
 * human-readable fallback link shown to JS-less clients.
 */
export function androidIntentPage(intentUrl: string, websiteUrl: string): string {
  const safeWebsite = websiteUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const intentJs = JSON.stringify(intentUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opening 4A Store…</title>
<meta name="robots" content="noindex,nofollow">
</head>
<body>
<p>Opening 4A Store… <a href="${safeWebsite}">Continue on the web</a></p>
<noscript><p><a href="${safeWebsite}">Open 4A Store</a></p></noscript>
<script>
  // Top-level navigation to the intent:// URL — Chrome opens the app if
  // installed, else honours the embedded market:// fallback (Play Store).
  window.location.href = ${intentJs};
</script>
</body>
</html>`;
}
