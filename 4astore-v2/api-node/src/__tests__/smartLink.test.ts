/**
 * Android intent:// builder — PURE tests (DB-free, network-free, Express-free).
 *
 * Imports ONLY the dependency-free `smartRedirect.ts`, matching the pure-import
 * pattern of whatsappFormat.test.ts. The UA branching + 302 lives in the Express
 * handler (routes/link.ts); here we pin the exact intent string the handler puts
 * in the Location header, and that a non-app link yields no intent (caller then
 * redirects to the website instead of the Play Store).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAndroidIntentUrl,
  ANDROID_PACKAGE,
  APP_SCHEME,
  MARKET_FALLBACK_URL,
} from '../services/smartRedirect';

import { androidIntentPage } from '../services/smartRedirect';

test('app-eligible link: builds the exact intent:// with custom scheme, package, and market:// fallback', () => {
  const intent = buildAndroidIntentUrl('/product/3');
  assert.equal(
    intent,
    'intent://product/3#Intent;scheme=fourastore;package=com.store4a.app;' +
      'S.browser_fallback_url=market%3A%2F%2Fdetails%3Fid%3Dcom.store4a.app;end'
  );
  assert.ok(intent!.startsWith('intent://product/3#Intent'), 'intent host is the path without a leading slash');
  assert.ok(intent!.includes(`scheme=${APP_SCHEME}`), 'intent uses the CUSTOM scheme (not https) so no-app falls to the Store');
  assert.ok(!/scheme=https/.test(intent!), 'must NOT use scheme=https (Chrome would open the website, ignoring the fallback)');
  assert.ok(intent!.includes(`package=${ANDROID_PACKAGE}`), 'intent must carry the app package');
  assert.ok(
    intent!.includes(`S.browser_fallback_url=${encodeURIComponent(MARKET_FALLBACK_URL)}`),
    'intent must embed the encoded market:// Play Store fallback'
  );
  assert.ok(intent!.endsWith(';end'), 'intent must terminate with ;end');
});

test('non-app custom link: builder returns null so the caller redirects to the website, never the Store', () => {
  assert.equal(buildAndroidIntentUrl(null), null);
});

test('androidIntentPage fires the intent via an in-page top-level navigation (not a 302 or anchor/timer)', () => {
  const intent = buildAndroidIntentUrl('/product/3')!;
  const html = androidIntentPage(intent, 'https://4astore.com/product/3');
  // The intent is fired by window.location.href inside the page (the reliable path).
  assert.ok(html.includes('window.location.href = '), 'page must fire the intent via window.location.href');
  assert.ok(html.includes(intent), 'page must embed the exact intent URL');
  // The script sits at the end of body (document ready); no flaky patterns.
  assert.ok(html.indexOf('<script>') > html.indexOf('<body>'), 'script is in the body, after it opens');
  assert.ok(!/http-equiv="refresh"/.test(html), 'no meta refresh (it would pre-empt the intent)');
  assert.ok(!/a\.click\(\)|setTimeout\(|visibilitychange/.test(html), 'no flaky anchor/timer/visibility logic');
  // JS-less clients get a website link.
  assert.ok(html.includes('href="https://4astore.com/product/3"'), 'noscript/website fallback link present');
});
