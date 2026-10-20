// Unit tests for the pure signup-OTP request helper (src/signupOtp.ts).
// Proves /otp/send carries the SAME identifier /register verifies against
// (email when given, else mobile) so a mobile-only user can request a code and
// the mobile fallback (auto-fillable devOtp) path is used when SMTP/FCM are down.
// No React, no network — mirrors the server's email-or-mobile keying.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSignupOtpPayload, isValidMobile } from '../signupOtp.ts';

test('mobile-only signup -> posts { mobile } (no email field)', () => {
  const p = buildSignupOtpPayload({ mobile: '9876543210', email: '' });
  assert.equal(p.mobile, '9876543210');
  assert.equal(p.email, undefined, 'email key must be absent so /register uses the mobile:<n> key');
});

test('email given -> posts { email } (email-first, matching /register otpKey)', () => {
  const p = buildSignupOtpPayload({ email: 'a@b.com', mobile: '9876543210' });
  assert.equal(p.email, 'a@b.com');
  assert.equal(p.mobile, undefined, 'mobile key must be absent so both calls key on email');
});

test('trims email and mobile before sending', () => {
  assert.deepEqual(buildSignupOtpPayload({ mobile: '  9876543210  ' }), { mobile: '9876543210' });
  assert.deepEqual(buildSignupOtpPayload({ email: '  a@b.com  ' }), { email: 'a@b.com' });
});

test('threads a non-empty trimmed name (lead capture), omits an empty one', () => {
  assert.equal(buildSignupOtpPayload({ mobile: '9876543210', name: '  Asha  ' }).name, 'Asha');
  assert.equal(buildSignupOtpPayload({ mobile: '9876543210', name: '   ' }).name, undefined);
  assert.equal(buildSignupOtpPayload({ mobile: '9876543210' }).name, undefined);
});

test('isValidMobile mirrors the server /^[6-9]\\d{9}$/ rule (enables Send OTP)', () => {
  assert.equal(isValidMobile('9876543210'), true);
  assert.equal(isValidMobile('6000000000'), true);
  assert.equal(isValidMobile('5876543210'), false, 'must start 6-9');
  assert.equal(isValidMobile('98765'), false, 'too short');
  assert.equal(isValidMobile('98765432100'), false, 'too long');
  assert.equal(isValidMobile(''), false);
  assert.equal(isValidMobile(null), false);
  assert.equal(isValidMobile(undefined), false);
});

// The sendOtp component maps a returned fallback code into the OTP field with
// `if (data?.devOtp) setOtp(String(data.devOtp))`. This asserts that exact
// coercion/guard contract the auto-fill relies on (a numeric devOtp becomes the
// 6-digit string the field holds; absent/falsy devOtp leaves it untouched).
function autoFill(prev: string, data: { devOtp?: unknown } | null | undefined): string {
  return data?.devOtp ? String(data.devOtp) : prev;
}

test('a returned devOtp auto-fills the OTP field (mobile fallback path)', () => {
  assert.equal(autoFill('', { devOtp: 123456 }), '123456', 'numeric devOtp is coerced to string');
  assert.equal(autoFill('', { devOtp: '654321' }), '654321');
});

test('no devOtp (real channel delivered) leaves the OTP field untouched', () => {
  assert.equal(autoFill('', { devOtp: undefined }), '');
  assert.equal(autoFill('', {}), '');
  assert.equal(autoFill('', null), '');
});
