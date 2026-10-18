/**
 * Signup OTP channel-policy pure-helper tests — network/DB-free.
 *
 * Imports ONLY the dependency-free `otpChannelPolicy.ts` (no prisma/db, no
 * Express), matching the pure-import pattern of whatsappFormat.test.ts. These
 * pin the channel-order decision + the tolerant parse without needing a DB.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOtpChannels, resolveMobileChannelOrder } from '../services/otpChannelPolicy';

test('parseOtpChannels: null/undefined/garbage falls back to FCM-only default', () => {
  const def = { whatsapp: false, fcm: true, mode: 'fcm' as const };
  assert.deepEqual(parseOtpChannels(null), def);
  assert.deepEqual(parseOtpChannels(undefined), def);
  assert.deepEqual(parseOtpChannels(''), def);
  assert.deepEqual(parseOtpChannels('   '), def);
  assert.deepEqual(parseOtpChannels('not-json{'), def);
  assert.deepEqual(parseOtpChannels(42), def);
  assert.deepEqual(parseOtpChannels({ mode: 'sms' }), def); // unknown mode
  assert.deepEqual(parseOtpChannels('{}'), def); // no mode key
});

test('parseOtpChannels: mode=both derives both booleans true', () => {
  assert.deepEqual(parseOtpChannels('{"mode":"both"}'), { whatsapp: true, fcm: true, mode: 'both' });
  assert.deepEqual(parseOtpChannels({ mode: 'both' }), { whatsapp: true, fcm: true, mode: 'both' });
});

test('parseOtpChannels: mode=whatsapp derives whatsapp true, fcm false', () => {
  assert.deepEqual(parseOtpChannels({ mode: 'whatsapp' }), { whatsapp: true, fcm: false, mode: 'whatsapp' });
});

test('parseOtpChannels: mode=fcm derives fcm true, whatsapp false', () => {
  assert.deepEqual(parseOtpChannels({ mode: 'fcm' }), { whatsapp: false, fcm: true, mode: 'fcm' });
});

test('parseOtpChannels: mode is authoritative — stored booleans are ignored', () => {
  // Even if the blob carries contradictory booleans, mode wins (single source of truth).
  assert.deepEqual(parseOtpChannels({ mode: 'fcm', whatsapp: true, fcm: false }), {
    whatsapp: false,
    fcm: true,
    mode: 'fcm',
  });
});

test('resolveMobileChannelOrder: both tries WhatsApp before FCM', () => {
  assert.deepEqual(resolveMobileChannelOrder({ whatsapp: true, fcm: true, mode: 'both' }), ['whatsapp', 'fcm']);
});

test('resolveMobileChannelOrder: whatsapp-only / fcm-only return a single channel', () => {
  assert.deepEqual(resolveMobileChannelOrder({ whatsapp: true, fcm: false, mode: 'whatsapp' }), ['whatsapp']);
  assert.deepEqual(resolveMobileChannelOrder({ whatsapp: false, fcm: true, mode: 'fcm' }), ['fcm']);
});
