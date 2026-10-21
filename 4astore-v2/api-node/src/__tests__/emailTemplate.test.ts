/**
 * Branded email template contract (logo + OTP, text fallback).
 *
 * emailTemplate.ts is a PURE module (no DB, no network), so it runs directly in
 * the node:test harness. These tests pin the load-bearing guarantees of the new
 * branded HTML:
 *   - the HTML embeds the PNG logo URL (NOT the .svg — Gmail/Outlook block SVG);
 *   - the HTML contains the OTP and is non-empty;
 *   - the plain-text fallback still contains the OTP (deliverability + non-HTML
 *     clients keep a usable body).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOtpEmail, renderBrandedEmail, renderBroadcastEmail, EMAIL_LOGO_URL } from '../utils/emailTemplate';

test('renderOtpEmail embeds the PNG logo URL (never the .svg)', () => {
  const { html } = renderOtpEmail({ title: 'Verify your email', otp: '123456', note: 'Your 4A Store OTP is 123456.' });
  assert.ok(html.includes('https://4astore.com/legacy/images/logo.png'), 'html must reference the PNG logo');
  assert.ok(!html.includes('logo.svg'), 'html must NOT reference the SVG logo (blocked by Gmail/Outlook)');
  assert.ok(html.includes(EMAIL_LOGO_URL), 'html must use the exported logo URL constant');
});

test('renderOtpEmail HTML contains the OTP and is non-empty', () => {
  const { html } = renderOtpEmail({ title: 'Verify your email', otp: '654321', note: 'Your 4A Store OTP is 654321.' });
  assert.ok(html.length > 0, 'html must be non-empty');
  assert.ok(html.includes('654321'), 'html must display the OTP');
  assert.ok(html.includes('<img'), 'html must include the logo image tag');
});

test('renderOtpEmail text fallback still contains the OTP', () => {
  const note = 'Your 4A Store OTP is 777888. It expires in 10 minutes.';
  const { text } = renderOtpEmail({ title: 'Verify your email', otp: '777888', note });
  assert.equal(text, note, 'text fallback must be the exact note passed in (unchanged meaning)');
  assert.ok(text.includes('777888'), 'text fallback must contain the OTP');
});

test('renderBrandedEmail returns the plain-text body as the text fallback', () => {
  const { text, html } = renderBrandedEmail({
    heading: 'Hello',
    bodyHtml: '<p>Body</p>',
    bodyText: 'Body plain text',
  });
  assert.equal(text, 'Body plain text', 'text must be the bodyText fallback');
  assert.ok(html.includes('Body') && html.includes('Hello'), 'html must contain the heading and body');
});

/* ---------- renderBroadcastEmail (admin email broadcast) ---------- */

test('renderBroadcastEmail HTML contains title, description, image URL and the PNG logo (not svg)', () => {
  const { html } = renderBroadcastEmail({
    title: 'Diwali Dhamaka',
    description: 'Flat 20% off on everything today!',
    imageUrl: 'https://4astore.com/api/uploads/banners/sale.png',
  });
  assert.ok(html.includes('Diwali Dhamaka'), 'html must contain the title');
  assert.ok(html.includes('Flat 20% off on everything today!'), 'html must contain the description');
  assert.ok(html.includes('https://4astore.com/api/uploads/banners/sale.png'), 'html must embed the image URL');
  assert.ok(html.includes('<img'), 'html must include an image tag for the banner');
  assert.ok(html.includes('https://4astore.com/legacy/images/logo.png'), 'html must reference the PNG logo');
  assert.ok(!html.includes('logo.svg'), 'html must NOT reference the SVG logo');
});

test('renderBroadcastEmail text fallback contains the title and description', () => {
  const { text } = renderBroadcastEmail({ title: 'Big Sale', description: 'Up to 50% off.' });
  assert.ok(text.includes('Big Sale'), 'text fallback must contain the title');
  assert.ok(text.includes('Up to 50% off.'), 'text fallback must contain the description');
});

test('renderBroadcastEmail embeds the unsubscribe link in BOTH html and text when given', () => {
  const unsubscribeUrl = 'https://4astore.com/api/users/unsubscribe?u=42';
  const { html, text } = renderBroadcastEmail({
    title: 'Hello',
    description: 'A message.',
    unsubscribeUrl,
  });
  assert.ok(html.includes(unsubscribeUrl), 'html must contain the unsubscribe URL');
  assert.ok(text.includes(unsubscribeUrl), 'text fallback must contain the unsubscribe URL');
});

test('renderBroadcastEmail never embeds a data: or empty image as an <img src>', () => {
  const dataUri = renderBroadcastEmail({ title: 'T', description: 'D', imageUrl: 'data:image/png;base64,AAAA' });
  assert.ok(!dataUri.html.includes('<img src="data:'), 'must not embed a data: URI image');
  const none = renderBroadcastEmail({ title: 'T', description: 'D', imageUrl: '' });
  // The logo <img> is always present, but there must be no body banner image.
  assert.ok(!none.html.includes('alt="T"'), 'empty imageUrl must not render a banner image');
});
