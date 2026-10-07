// Unit tests for the in-app update-channel decision logic (src/updatePolicy.ts).
// Proves the force-update prompt is NEVER silently suppressed by a broken/unknown
// installed versionCode (the original bug: `if (current && ...)` short-circuited to
// false whenever `current` was 0), while a normal (optional) update stays gated on
// a finite server code that is strictly ahead of a finite installed code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowUpdate, type VersionInfo } from '../updatePolicy.ts';

function version(over: Partial<VersionInfo> = {}): VersionInfo {
  return {
    versionCode: 21,
    versionName: '2.0.0 (21)',
    url: 'https://4astore.example.com/4AStore.apk',
    message: 'A new update is available.',
    forceUpdate: false,
    ...over,
  };
}

// --- Normal (optional) update: strict server > installed, both finite ---------
test('optional update shows when server is ahead of a known installed code', () => {
  assert.equal(shouldShowUpdate(version({ versionCode: 21 }), 20), true);
});

test('optional update hidden when installed equals server (already latest)', () => {
  assert.equal(shouldShowUpdate(version({ versionCode: 21 }), 21), false);
});

test('optional update hidden when installed is ahead of server', () => {
  assert.equal(shouldShowUpdate(version({ versionCode: 21 }), 22), false);
});

test('optional update hidden when installed code is unknown (0)', () => {
  // No force → we cannot trust a 0/unknown installed code, so stay quiet.
  assert.equal(shouldShowUpdate(version({ versionCode: 21 }), 0), false);
});

test('optional update hidden when installed code is NaN', () => {
  assert.equal(shouldShowUpdate(version({ versionCode: 21 }), Number.NaN), false);
});

// --- Forced update: must never be suppressed by a broken installed code -------
test('forced update shows when server is ahead of a known installed code', () => {
  assert.equal(shouldShowUpdate(version({ versionCode: 21, forceUpdate: true }), 20), true);
});

test('forced update SHOWS when installed code is unknown (0) — the original bug', () => {
  // Regression guard: the old `if (current && ...)` made current=0 falsy and skipped
  // the whole check, so a forced release never appeared on a device whose
  // nativeBuildVersion came back null/non-numeric. It must show now.
  assert.equal(shouldShowUpdate(version({ versionCode: 21, forceUpdate: true }), 0), true);
});

test('forced update SHOWS when installed code is NaN', () => {
  assert.equal(shouldShowUpdate(version({ versionCode: 21, forceUpdate: true }), Number.NaN), true);
});

test('forced update hidden when installed already equals server (no needless nag)', () => {
  assert.equal(shouldShowUpdate(version({ versionCode: 21, forceUpdate: true }), 21), false);
});

test('forced update hidden when installed is ahead of server', () => {
  assert.equal(shouldShowUpdate(version({ versionCode: 21, forceUpdate: true }), 22), false);
});

// --- Garbled / missing server payload is safe --------------------------------
test('no modal when server payload is null', () => {
  assert.equal(shouldShowUpdate(null, 20), false);
});

test('no modal when server versionCode is not a finite number', () => {
  assert.equal(shouldShowUpdate(version({ versionCode: Number.NaN, forceUpdate: true }), 20), false);
  // undefined coerces to NaN → still safe
  assert.equal(shouldShowUpdate(version({ versionCode: undefined as unknown as number }), 20), false);
});
