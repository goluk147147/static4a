# 4AStore Android short-link redirect — verification note

## The bug
Opening `https://4astore.com/link/<code>` in **Chrome on Android** with the app
**uninstalled** opened the *website* instead of the **Google Play Store**. The
installed-app case worked. The goal: app installed → open the app; app absent →
open the Play Store.

## Research findings & decision
There was no research-doc file in the repo. The parent session supplied the
research outcome, confirmed against Chrome's official intents documentation and
the Chrome-recommended **server-redirect** pattern:

- Chrome reliably fires an `intent://` URL on a **top-level navigation** (e.g. an
  HTTP `Location:` header from a 302), honouring the embedded
  `S.browser_fallback_url` when the target app is not installed.
- Firing the intent from **JavaScript** (anchor `.click()`, `location.href`, or a
  `setTimeout` race) is unreliable on real Chrome — on an uninstalled device it
  commonly falls through to the website. This is exactly what the previous three
  attempts did (git commits `5a3db593`, `9532ad21`, `5022c485`), and why the bug
  persisted.
- `market://details?id=<pkg>` is a more reliable no-app fallback than the
  `https://play.google.com/...` listing URL, because the https URL can be
  intercepted as an ordinary web link; `market://` directly targets the Store app.

**Chosen mechanism: Option A — server-side HTTP 302 to the `intent://` URL.**
This removes every JS race condition; the intent is fired by the browser's own
top-level navigation.

Sources (Chrome intents + server-redirect pattern): Chrome Developers docs on
Android intents and the `S.browser_fallback_url` / server-redirect guidance.
*Content was rephrased for compliance with licensing restrictions.*

## What changed (backend-only, api-node)
- `src/services/smartRedirect.ts` — now a **pure** module exporting
  `buildAndroidIntentUrl(appPath)`, plus `ANDROID_PACKAGE`, `APP_SCHEME`,
  `MARKET_FALLBACK_URL`. All the flaky HTML/JS (`smartRedirectHtml`, anchor click,
  `setTimeout`, `visibilitychange`, meta-refresh) was **deleted**.
- `src/routes/link.ts` — the human (non-crawler) path now branches on
  User-Agent and issues a **302**:
  - Android **and** app-eligible (`appPath != null`, i.e. a product) → `Location`
    is the `intent://` URL.
  - Everything else (iOS, desktop, non-app/custom links) → `Location` is the
    website `target`.
  - The **crawler** branch is UNCHANGED (still returns the OG HTML).
- `src/__tests__/smartLink.test.ts` — rewritten to unit-test the pure
  `buildAndroidIntentUrl` (exact intent string, encoded `market://` fallback, and
  `null` for non-app links). Tests stay pure (no network, no Express).

## Exact output per case
GET `/link/<code>` (or `/api/link/<code>`), human (non-crawler):

- **Android, app-eligible (product 3)** → `HTTP 302`, `Location:`
  `intent://product/3#Intent;scheme=fourastore;package=com.store4a.app;S.browser_fallback_url=market%3A%2F%2Fdetails%3Fid%3Dcom.store4a.app;end`
- **iOS** → `HTTP 302`, `Location:` the website `target`
  (e.g. `https://4astore.com/product/3`). Universal Links open the app
  automatically when it is installed.
- **Desktop / non-app custom link** → `HTTP 302`, `Location:` the website `target`.
- **Crawler UA** (WhatsApp/Facebook/etc.) → UNCHANGED: `200` OG HTML from
  `services/ogShare.ts`.

### What Chrome does with the Android output
Given a top-level navigation to the `intent://...;S.browser_fallback_url=market://...;end`:
- **App installed** → Chrome matches the `fourastore` scheme filter and opens the
  app at `/product/3`.
- **App NOT installed** → Chrome honours `S.browser_fallback_url` and navigates to
  `market://details?id=com.store4a.app`, which opens the Play Store app/listing.

(Real Chrome-on-Android could not be driven in this environment. The above is the
documented Chrome behaviour for this exact output; verification here is the unit
test pinning the precise 302 `Location` string the server emits.)

## Build + test results (ran from `4astore-v2/api-node`)
- `npm run build` → **PASS** (tsc, exit 0).
- `npm test` → **PASS**, green suite: **67 tests, 0 failures**, including the 3 new
  `smartLink.test.ts` cases.

## How to test on the phone
1. Install the latest build **on the server** first: the founder must run
   `bash deploy.sh` — this change only takes effect after the Node app is
   redeployed. It is backend-only; nothing to rebuild in the mobile app.
2. On an Android phone, open `https://4astore.com/link/<code>` for a **product**
   link in **Chrome** (the real browser) — NOT the WhatsApp in-app browser
   (in-app webviews do not honour Chrome's intent/fallback behaviour).
3. **App installed** → the app opens on the product.
4. **App uninstalled** → the **Google Play Store** opens (not the website).
5. A non-product / custom link always goes to the website.

## Reminder
This is a backend-only change in `api-node`. It is live only after the founder
deploys on the server (`bash deploy.sh`). Do not push from here.
