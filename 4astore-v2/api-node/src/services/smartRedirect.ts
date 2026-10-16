/* ------------------------------------------------------------------ *
 * Smart short-link redirect HTML — PURE (DB-free, network-free, Express-free).
 * ------------------------------------------------------------------ *
 * Kept in a dependency-free module so the Node test runner can import the
 * HTML builder WITHOUT pulling in prisma/db or Express (mirrors
 * whatsappFormat.ts / pushAudience.ts). routes/link.ts re-imports these.
 *
 * Behaviour is unchanged from the previous inline version in routes/link.ts:
 *   - Android + App-Link-eligible target (`appPath` present) → attempt the
 *     installed app via intent://, and if it is NOT installed the ~1200ms
 *     timer fires location.replace(PLAY_STORE_URL) — the Play Store, NOT the
 *     website.
 *   - Any NON-app custom link (`appPath` null) → location.replace(target)
 *     straight to the website.
 *   - <meta refresh> + <noscript> keep a JS-less client reaching the site.
 * ------------------------------------------------------------------ */

import { SITE_ORIGIN } from '../seo/origin';
import { escapeHtml } from './ogShare';

// Android app deep-link constants (reference: mobile/app.config.ts — scheme
// fourastore, package com.store4a.app, verified App Link host 4astore.com,
// pathPrefix /product). The ONE place the smart redirect needs them.
export const ANDROID_PACKAGE = 'com.store4a.app';
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
// The app's CUSTOM URL scheme (mobile/app.config.ts → `scheme: 'fourastore'`).
// The intent uses this (NOT scheme=https) so that when the app is NOT installed,
// Chrome has no web URL to fall through to and instead honours the embedded
// S.browser_fallback_url (the Play Store). With scheme=https + host 4astore.com,
// Chrome treated the intent as a normal web link and opened the website instead
// of the Play Store on an uninstalled device — that was the bug.
export const APP_SCHEME = 'fourastore';

/**
 * Smart-redirect HTML for humans. `target` is the absolute website URL;
 * `appPath` (e.g. `/product/5`) is present only for an App-Link-eligible target
 * and drives the Android app-open attempt. All interpolated values are escaped
 * (reusing escapeHtml) and the raw strings are JSON-encoded for the JS context.
 * Includes <noscript> + <meta refresh> so a JS-less client still reaches the site.
 */
export function smartRedirectHtml(target: string, appPath: string | null): string {
  const safeTarget = escapeHtml(target);
  const targetJs = JSON.stringify(target);
  const playJs = JSON.stringify(PLAY_STORE_URL);
  // Build the intent with the app's CUSTOM scheme (fourastore://<path>) rather
  // than scheme=https. Reason: with scheme=https + host 4astore.com, an
  // uninstalled device let Chrome treat the intent as a plain web link and open
  // the website, skipping the Play Store. A custom scheme has no web equivalent,
  // so when the app is absent Chrome honours S.browser_fallback_url (Play Store);
  // when the app is present, its `fourastore` scheme filter opens it. `appPath`
  // starts with '/', which we strip so the host becomes e.g. product/3.
  const schemePath = appPath ? appPath.replace(/^\//, '') : '';
  const intentUrl = appPath
    ? `intent://${schemePath}#Intent;scheme=${APP_SCHEME};package=${ANDROID_PACKAGE};` +
      `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`
    : null;
  const intentJs = intentUrl ? JSON.stringify(intentUrl) : 'null';

  // IMPORTANT: there is intentionally NO <meta http-equiv="refresh"> here. A
  // 0-second meta refresh fires BEFORE the JS runs and would send every Android
  // visitor straight to the website, so the app/Play-Store intent never happens.
  // JS-less clients fall back via the <noscript> link below instead.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Redirecting… — 4A Store</title>
<meta name="robots" content="noindex,nofollow">
</head>
<body>
<p>Redirecting to <a href="${safeTarget}">4A Store</a>…</p>
<noscript><p>Click here to continue: <a href="${safeTarget}">4A Store</a></p></noscript>
<!-- Script lives at the END of <body> so document.body exists when it runs
     (the Android branch creates + clicks an anchor; a head-script would hit a
     null document.body, throw, and fall through to the website). -->
<script>
(function () {
  var target = ${targetJs};
  var play = ${playJs};
  var intent = ${intentJs};
  try {
    if (/Android/i.test(navigator.userAgent) && intent) {
      // App-eligible on Android. Fire the intent via a REAL anchor click (not
      // window.location.href): Chrome honours the embedded browser_fallback_url
      // reliably on a genuine link activation, sending an UNINSTALLED visitor to
      // the Play Store. When the app IS installed, the same click opens it.
      var a = document.createElement('a');
      a.setAttribute('href', intent);
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Safety net for old webviews that neither open the app nor honour the
      // fallback: if we're still here and visible after a moment, go to the Play
      // Store (NOT the website). If the app opened, the tab is backgrounded and
      // document.hidden is true, so we leave the user in the app.
      setTimeout(function () {
        if (!document.hidden) location.replace(play);
      }, 1500);
    } else if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && intent) {
      // iOS: Universal Links open the app automatically when installed,
      // otherwise the website target is correct.
      location.replace(target);
    } else {
      // Non-app custom link (or desktop): go straight to the website target.
      location.replace(target);
    }
  } catch (e) {
    location.replace(target);
  }
})();
</script>
</body>
</html>`;
}
