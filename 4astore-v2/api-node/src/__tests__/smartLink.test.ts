/**
 * Smart short-link mobile redirect helpers — PURE tests (DB-free, network-free).
 *
 * Mobile behaviour: an app-eligible link tries the app's custom scheme, and if
 * the app is not installed, the page redirects to the Play Store (plain https).
 * Non-app links yield no deep link (caller sends the website instead).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppDeepLink,
  appOrStorePage,
  ANDROID_PACKAGE,
  APP_SCHEME,
  PLAY_STORE_URL,
} from '../services/smartRedirect';

test('buildAppDeepLink: app-eligible path → custom-scheme deep link', () => {
  assert.equal(buildAppDeepLink('/product/3'), 'fourastore://product/3');
  assert.equal(buildAppDeepLink('/product/5'), `${APP_SCHEME}://product/5`);
  // Leading slash stripped so the scheme host is the path.
  assert.ok(!buildAppDeepLink('/product/3')!.includes('///'), 'no triple slash');
});

test('buildAppDeepLink: non-app/custom link → null (caller uses the website)', () => {
  assert.equal(buildAppDeepLink(null), null);
});

test('PLAY_STORE_URL is the plain https listing for the package', () => {
  assert.equal(PLAY_STORE_URL, `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`);
  assert.ok(PLAY_STORE_URL.startsWith('https://play.google.com/'), 'plain https Play URL');
});

test('appOrStorePage: tries the app scheme then falls back to the Play Store', () => {
  const html = appOrStorePage('fourastore://product/3');
  // Fires the app deep link.
  assert.ok(html.includes('fourastore://product/3'), 'page must attempt the app deep link');
  assert.ok(html.includes('window.location.href = app'), 'app open attempt present');
  // Falls back to the plain https Play Store after a delay, only if still visible.
  assert.ok(html.includes(PLAY_STORE_URL), 'page must embed the Play Store URL');
  assert.ok(/setTimeout\(/.test(html), 'delayed fallback present');
  assert.ok(html.includes('document.hidden'), 'fallback is skipped when the app opened (tab hidden)');
  // Script is in the body (document ready); no flaky intent/meta-refresh.
  assert.ok(html.indexOf('<script>') > html.indexOf('<body'), 'script after body opens');
  assert.ok(!/http-equiv="refresh"/.test(html), 'no meta refresh');
  assert.ok(!/intent:\/\//.test(html), 'no intent:// (uses custom scheme + https Play URL)');
  // JS-less clients get a Play Store link.
  assert.ok(html.includes('noscript'), 'noscript fallback present');
});
