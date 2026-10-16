/* ------------------------------------------------------------------ *
 * Android app deep-link helpers for the universal short link — PURE
 * (DB-free, network-free, Express-free) so the Node test runner can import it
 * without pulling in prisma/db or Express. routes/link.ts re-imports these.
 * ------------------------------------------------------------------ *
 * Mobile behaviour (the only case that needs special handling):
 *   - App INSTALLED  → the custom-scheme deep link (fourastore://<path>) opens
 *     the app; the browser tab goes to the background.
 *   - App NOT present → the custom scheme does nothing; after a short delay the
 *     page is still in the foreground, so we send the user to the PLAY STORE
 *     (a plain https Play URL, which always opens the Store app or its web page).
 * Desktop / non-app custom links → the website (handled by routes/link.ts).
 *
 * Why this shape (after several intent:// attempts failed on real Chrome):
 *   - We do NOT use intent://...;scheme=https (Chrome then treats it as a web
 *     URL and opens the website, ignoring the fallback).
 *   - We do NOT rely on intent:// S.browser_fallback_url firing (it did not on
 *     the tested devices).
 *   - Instead: fire the app's OWN custom scheme (fourastore://) — which has no
 *     web equivalent, so an uninstalled device simply does nothing — then a
 *     timer that only survives if the app did NOT open (the tab stays visible)
 *     redirects to the plain https Play Store URL. Simple and device-robust.
 * ------------------------------------------------------------------ */

export const ANDROID_PACKAGE = 'com.store4a.app';
// The app's CUSTOM URL scheme (mobile/app.config.ts → `scheme: 'fourastore'`).
export const APP_SCHEME = 'fourastore';
// Plain https Play Store listing — always resolvable (opens the Store app or its
// web listing). Used as the no-app fallback. A plain https URL is more reliable
// across browsers than market:// or an intent:// fallback.
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

/**
 * Build the app's custom-scheme deep link for an app-eligible target.
 * `appPath` e.g. `/product/5` → `fourastore://product/5`. Returns `null` for a
 * non-app / custom link (caller then uses the website).
 */
export function buildAppDeepLink(appPath: string | null): string | null {
  if (!appPath) return null;
  const path = appPath.replace(/^\//, '');
  return `${APP_SCHEME}://${path}`;
}

/**
 * HTML page (for MOBILE, app-eligible links) that:
 *   1. tries to open the app via its custom scheme, then
 *   2. after a short delay, if the page is still visible (app not installed),
 *      sends the user to the Play Store.
 * If the app opened, the tab is hidden/backgrounded, so the timer's visibility
 * check skips the Play Store and leaves the user in the app. JS-less clients get
 * the <noscript> Play Store link.
 *
 * `appDeepLink` = buildAppDeepLink(appPath); `playUrl` defaults to PLAY_STORE_URL.
 */
export function appOrStorePage(appDeepLink: string, playUrl: string = PLAY_STORE_URL): string {
  const deepJs = JSON.stringify(appDeepLink);
  const playJs = JSON.stringify(playUrl);
  const safePlay = playUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opening 4A Store…</title>
<meta name="robots" content="noindex,nofollow">
</head>
<body style="font-family:system-ui,Arial,sans-serif;text-align:center;padding:40px 16px;color:#222">
<p>Opening 4A Store…</p>
<p><a id="store" href="${safePlay}">Get the 4A Store app →</a></p>
<noscript><p><a href="${safePlay}">Download the 4A Store app</a></p></noscript>
<script>
(function () {
  var app = ${deepJs};
  var play = ${playJs};
  var jumped = false;
  // If the app actually opens, the page is backgrounded; mark that so we do NOT
  // then bounce the user to the Play Store when they return.
  document.addEventListener('visibilitychange', function(){ if (document.hidden) jumped = true; });
  window.addEventListener('pagehide', function(){ jumped = true; });

  // Try to open the app via its custom scheme using a HIDDEN IFRAME. Firing the
  // scheme through an iframe (not window.location) means that if the app is NOT
  // installed, the attempt fails SILENTLY — the top page does not navigate to an
  // error and does not change URL — so our Play Store timer reliably runs.
  // If the app IS installed, Android opens it and the page is backgrounded.
  function openApp() {
    try {
      var ifr = document.createElement('iframe');
      ifr.style.display = 'none';
      ifr.src = app;
      document.body.appendChild(ifr);
    } catch (e) {}
  }
  openApp();

  // App not installed → still here & visible → go to the Play Store (plain https,
  // always resolvable). If the app opened, jumped/hidden is true → skip.
  setTimeout(function () {
    if (!jumped && !document.hidden) { window.location.href = play; }
  }, 1500);
})();
</script>
</body>
</html>`;
}
