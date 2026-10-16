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

test('app-eligible link: builds the exact intent:// with custom scheme, package, and market:// fallback', () => {
  const intent = buildAndroidIntentUrl('/product/3');
  // The full documented shape for product 3.
  assert.equal(
    intent,
    'intent://product/3#Intent;scheme=fourastore;package=com.store4a.app;' +
      'S.browser_fallback_url=market%3A%2F%2Fdetails%3Fid%3Dcom.store4a.app;end'
  );
  // Component assertions (robust to constant changes).
  assert.ok(intent!.startsWith('intent://product/3#Intent'), 'intent host is the path without a leading slash');
  assert.ok(intent!.includes(`scheme=${APP_SCHEME}`), `intent must use the custom scheme=${APP_SCHEME}`);
  assert.ok(!/scheme=https;/.test(intent!), 'intent must NOT use scheme=https (it would open the website, not the Store)');
  assert.ok(intent!.includes(`package=${ANDROID_PACKAGE}`), 'intent must carry the app package');
  // The no-app fallback is the market:// Play Store deep-link, URL-encoded.
  assert.ok(
    intent!.includes(`S.browser_fallback_url=${encodeURIComponent(MARKET_FALLBACK_URL)}`),
    'intent must embed the encoded market:// Play Store fallback'
  );
  assert.ok(intent!.endsWith(';end'), 'intent must terminate with ;end');
});

test('app-eligible link: no meta-refresh / JS page artefacts (the 302 replaced them)', () => {
  const intent = buildAndroidIntentUrl('/product/5');
  assert.ok(!/http-equiv="refresh"/.test(intent!), 'no meta refresh — the builder emits only the intent URL');
  assert.ok(!/<a |a\.click\(\)|setTimeout\(|location\.replace/.test(intent!), 'no JS page artefacts in the intent');
});

test('non-app custom link: builder returns null so the caller redirects to the website, never the Store', () => {
  assert.equal(buildAndroidIntentUrl(null), null);
});
