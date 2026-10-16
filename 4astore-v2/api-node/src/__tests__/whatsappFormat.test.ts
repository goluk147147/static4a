/**
 * WhatsApp Cloud API pure-helper tests — network/DB-free.
 *
 * Imports ONLY the dependency-free `whatsappFormat.ts` (no prisma/db, no
 * Express), matching the pure-import pattern of posLoginDecision.test.ts.
 * The live sender is NOT exercised here — we only pin the request SHAPE via
 * the components builder and the number normaliser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMsisdn, buildImageTextComponents } from '../services/whatsappFormat';

test('sanitizeMsisdn: 10-digit 6-9 number gets the 91 country code', () => {
  assert.equal(sanitizeMsisdn('9876543210'), '919876543210');
  assert.equal(sanitizeMsisdn('6000000000'), '916000000000');
});

test('sanitizeMsisdn: strips spaces / symbols before validating', () => {
  assert.equal(sanitizeMsisdn('98765 43210'), '919876543210');
  assert.equal(sanitizeMsisdn('+91 98765-43210'), '919876543210');
  assert.equal(sanitizeMsisdn('(98765) 43210'), '919876543210');
});

test('sanitizeMsisdn: already 91-prefixed 12-digit number is kept', () => {
  assert.equal(sanitizeMsisdn('919876543210'), '919876543210');
});

test('sanitizeMsisdn: rejects numbers starting 0-5, wrong length, or letters', () => {
  assert.equal(sanitizeMsisdn('5876543210'), ''); // leading 5
  assert.equal(sanitizeMsisdn('0876543210'), ''); // leading 0
  assert.equal(sanitizeMsisdn('98765432'), ''); // too short
  assert.equal(sanitizeMsisdn('98765432100'), ''); // 11 digits
  assert.equal(sanitizeMsisdn('9198765432100'), ''); // 13 digits
  assert.equal(sanitizeMsisdn('921234567890'), ''); // 12 digits but not 91…
  assert.equal(sanitizeMsisdn('abcdefghij'), '');
  assert.equal(sanitizeMsisdn(''), '');
});

test('buildImageTextComponents: image + body → both parts in order', () => {
  const components = buildImageTextComponents({
    imageUrl: 'https://cdn.example.com/promo.jpg',
    bodyParams: ['Ramesh', '20%'],
  });
  assert.deepEqual(components, [
    {
      type: 'header',
      parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/promo.jpg' } }],
    },
    {
      type: 'body',
      parameters: [
        { type: 'text', text: 'Ramesh' },
        { type: 'text', text: '20%' },
      ],
    },
  ]);
});

test('buildImageTextComponents: no image → body only', () => {
  const components = buildImageTextComponents({ bodyParams: ['Diwali'] });
  assert.deepEqual(components, [
    { type: 'body', parameters: [{ type: 'text', text: 'Diwali' }] },
  ]);
});

test('buildImageTextComponents: no body → header only', () => {
  const components = buildImageTextComponents({ imageUrl: 'https://cdn.example.com/x.jpg' });
  assert.deepEqual(components, [
    { type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/x.jpg' } }] },
  ]);
});

test('buildImageTextComponents: neither → empty array', () => {
  assert.deepEqual(buildImageTextComponents({}), []);
  assert.deepEqual(buildImageTextComponents({ imageUrl: '', bodyParams: [] }), []);
});

test('buildImageTextComponents: coerces body params to { type:text, text } strings', () => {
  const components = buildImageTextComponents({
    bodyParams: [42 as unknown as string, 'ok'],
  });
  assert.deepEqual(components, [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: '42' },
        { type: 'text', text: 'ok' },
      ],
    },
  ]);
});
