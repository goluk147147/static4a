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
  // intent:// URL opens the verified app and, when the app is absent, lets the
  // page's setTimeout fall back to the Play Store.
  const intentJs = appPath
    ? JSON.stringify(
        `intent://${SITE_ORIGIN.replace(/^https?:\/\//i, '')}${appPath}#Intent;scheme=https;package=${ANDROID_PACKAGE};end`
      )
    : 'null';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Redirecting… — 4A Store</title>
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="refresh" content="0; url=${safeTarget}">
<script>
(function () {
  var target = ${targetJs};
  var play = ${playJs};
  var intent = ${intentJs};
  try {
    if (/Android/i.test(navigator.userAgent) && intent) {
      // App-eligible link: try to open the installed app; if it ISN'T installed the
      // timeout fires and we land on the PLAY STORE (not the website).
      var fallback = setTimeout(function () { location.replace(play); }, 1200);
      // If the app opens, the page is backgrounded and the timeout is paused;
      // on return to the browser we still want the site, so clear on hide.
      window.addEventListener('pagehide', function () { clearTimeout(fallback); });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) clearTimeout(fallback);
      });
      window.location.href = intent;
    } else {
      // Non-app custom link (or non-Android): go straight to the website target.
      location.replace(target);
    }
  } catch (e) {
    location.replace(target);
  }
})();
</script>
</head>
<body>
<p>Redirecting to <a href="${safeTarget}">4A Store</a>…</p>
<noscript><p>Click here to continue: <a href="${safeTarget}">4A Store</a></p></noscript>
</body>
</html>`;
}
