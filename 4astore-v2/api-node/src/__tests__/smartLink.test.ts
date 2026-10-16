/**
 * Smart short-link redirect HTML — PURE builder tests (DB-free, network-free).
 *
 * Imports ONLY the dependency-free `smartRedirect.ts`, matching the pure-import
 * pattern of whatsappFormat.test.ts. Pins the no-app fallback behaviour:
 *   - App-eligible link (appPath present) → Play Store fallback.
 *   - Non-app custom link (appPath null)  → website target (NOT the Play Store).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartRedirectHtml, PLAY_STORE_URL, ANDROID_PACKAGE } from '../services/smartRedirect';

test('app-eligible link: intent:// targets the app package AND no-app fallback is the Play Store', () => {
  const html = smartRedirectHtml('https://4astore.com/product/5', '/product/5');
  // intent var is the app deep-link, not null.
  assert.ok(html.includes(`package=${ANDROID_PACKAGE}`), 'intent must carry the app package');
  assert.ok(html.includes('intent://'), 'app-eligible link must build an intent:// URL');
  assert.ok(!/var intent = null;/.test(html), 'intent must NOT be null for an app-eligible link');
  // Fallback goes to the Play Store URL.
  assert.ok(html.includes(PLAY_STORE_URL), 'play var must be the Play Store listing URL');
  assert.ok(
    html.includes('play.google.com/store/apps/details?id=com.store4a.app'),
    'Play Store fallback URL must be present'
  );
  assert.ok(html.includes('location.replace(play)'), 'no-app timer safety net must replace with the Play Store');
  // The intent:// carries S.browser_fallback_url=<Play Store> — Chrome's official,
  // reliable no-app fallback (navigates to the Play Store itself when the app is
  // absent, no JS race). This replaced the old meta-refresh + bare-timer approach.
  assert.ok(
    html.includes(`S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)}`),
    'intent must embed the Play Store as browser_fallback_url'
  );
  // A JS safety-net timer still backs older webviews that ignore the fallback.
  assert.ok(/setTimeout\(function \(\) \{ if \(!fired\) location\.replace\(play\); \}, 1500\)/.test(html), 'safety-net timer present');
  // There must be NO 0-second meta refresh (it would fire before the intent runs
  // and send every Android visitor to the website instead of the app/Play Store).
  assert.ok(!/http-equiv="refresh"/.test(html), 'must NOT have a meta refresh (it defeats the intent)');
});

test('non-app custom link: intent is null and the fallback is the website, never the Play Store', () => {
  const html = smartRedirectHtml('https://4astore.com/some-custom', null);
  assert.ok(/var intent = null;/.test(html), 'non-app link must have a null intent var');
  assert.ok(html.includes('location.replace(target)'), 'non-app branch must replace with the website target');
  // intent is null, so `/Android/ && intent` is false at runtime → the else branch
  // (location.replace(target), the website) runs and the Play Store timer is never armed.
  assert.ok(!html.includes('intent://'), 'non-app link must not build an intent:// URL');
  assert.ok(html.includes('location.replace(play)'), 'the play-fallback code is present but gated behind a null intent');
});

test('<noscript> points at the escaped website target and there is no meta refresh', () => {
  const html = smartRedirectHtml('https://4astore.com/page/about?a=1&b=2', null);
  // escapeHtml turns & into &amp; in the HTML attribute/anchor context.
  // The <noscript> link is the JS-less fallback (the meta refresh was removed so
  // it no longer pre-empts the intent:// on Android).
  assert.ok(html.includes('href="https://4astore.com/page/about?a=1&amp;b=2"'));
  assert.ok(!/http-equiv="refresh"/.test(html), 'no meta refresh — it would defeat the Android intent');
});
