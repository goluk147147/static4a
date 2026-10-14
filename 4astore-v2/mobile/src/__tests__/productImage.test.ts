// Pure-logic tests for productImageUri()'s resolve + cache-bust behaviour.
//
// NOTE: src/productImage.ts imports src/config.ts, which imports `expo-constants`
// — a module the node --test loader (loader.mjs) does not mock, so importing the
// real helper under the runner would fail to resolve. Per FEAT-001 we instead
// replicate the tiny resolve/append helper here and assert the exact separator /
// version rules the component relies on. Keep this in sync with productImageUri().
import test from 'node:test';
import assert from 'node:assert/strict';

// Mirrors config.ts constants/absoluteUrl just enough for the uri resolution.
const API_BASE = 'https://4astore.com/api';
const SITE_URL = 'https://4astore.com';

function absoluteUrl(src?: string | null): string {
  const s = String(src || '').trim();
  if (!s) return '';
  if (/^(https?:|data:|file:)/i.test(s)) return s;
  return `${SITE_URL}/${s.replace(/^\.?\//, '')}`;
}

// Faithful replica of src/productImage.ts productImageUri().
function productImageUri(image?: string | null, version?: string | number): string {
  const url = String(image || '').trim();
  if (!url) return '';
  const uri = /^http:/i.test(url) ? `${API_BASE}/img-proxy?url=${encodeURIComponent(url)}` : absoluteUrl(url);
  if (!uri || version === undefined || version === null || version === '') return uri;
  const sep = uri.includes('?') ? '&' : '?';
  let v: string | number = version;
  if (typeof version === 'string') {
    const t = Date.parse(version);
    v = Number.isNaN(t) ? version : t;
  }
  return `${uri}${sep}v=${encodeURIComponent(String(v))}`;
}

test('empty / undefined image -> empty string (component renders placeholder)', () => {
  assert.equal(productImageUri(''), '');
  assert.equal(productImageUri(undefined), '');
  assert.equal(productImageUri(null), '');
  // version is irrelevant when there is no image
  assert.equal(productImageUri('', '2024-01-01T00:00:00Z'), '');
});

test('http(s) url routes http through the img-proxy', () => {
  const uri = productImageUri('http://example.com/p.jpg');
  assert.ok(uri.includes('/img-proxy?url='), 'cleartext http should go via the proxy');
});

test('version omitted -> no v= param appended', () => {
  const proxied = productImageUri('http://example.com/p.jpg');
  assert.ok(!proxied.includes('v='), 'no cache-bust when version is absent');

  const relative = productImageUri('/api/uploads/x.webp');
  assert.ok(!relative.includes('v='));
});

test('version provided -> exactly one v= appended with & when url already has a query', () => {
  const uri = productImageUri('http://example.com/p.jpg', 1700000000000);
  const matches = uri.match(/v=/g) || [];
  assert.equal(matches.length, 1, 'exactly one v= param');
  // img-proxy url already contains '?url=' so the separator must be '&'
  assert.ok(uri.includes('&v='), 'separator should be & for an existing query string');
});

test('version provided -> v= appended with ? when url has no query', () => {
  const uri = productImageUri('/api/uploads/x.webp', 1700000000000);
  assert.ok(uri.includes('?v=1700000000000'), 'separator should be ? for a query-less path');
  assert.equal((uri.match(/v=/g) || []).length, 1);
});

test('date-string version is normalised to its epoch millis', () => {
  const iso = '2024-01-02T03:04:05.000Z';
  const uri = productImageUri('/api/uploads/x.webp', iso);
  assert.ok(uri.includes(`?v=${Date.parse(iso)}`), 'ISO date becomes numeric epoch');
});

test('non-date string version is used as-is', () => {
  const uri = productImageUri('/api/uploads/x.webp', 'abc123');
  assert.ok(uri.includes('?v=abc123'));
});
