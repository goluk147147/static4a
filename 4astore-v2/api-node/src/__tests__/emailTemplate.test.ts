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
import { renderOtpEmail, renderBrandedEmail, EMAIL_LOGO_URL } from '../utils/emailTemplate';

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
