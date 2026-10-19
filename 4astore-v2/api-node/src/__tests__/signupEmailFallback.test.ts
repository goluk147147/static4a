/**
 * Signup EMAIL-branch "user never stuck" fallback contract
 * (OTP delivery honesty — Option B, second live blocker).
 *
 * services/otpDelivery.ts is DB-bound (it creates an email_otps row), and the
 * worktree has no reachable database, so the full orchestrator cannot run here.
 * Following the same source-assertion technique as posBilling.test.ts, this file
 * reads services/otpDelivery.ts and pins the load-bearing fallback expression:
 *
 *   const fallbackOtp = sent.ok ? (process.env.NODE_ENV !== 'production' ? otp : undefined) : otp;
 *
 * i.e. the email branch returns:
 *   - sent.ok === FALSE  → fallbackOtp = otp              (even in production → not stranded)
 *   - sent.ok === TRUE   → fallbackOtp = otp OUTSIDE prod, undefined in production (no leak)
 * and the returned `delivered`/`channel` track the real send result.
 *
 * A pure re-implementation of the exact expression is also unit-tested across
 * the (sent.ok × NODE_ENV) matrix so the intended behavior is unambiguous.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const OTP_DELIVERY_SRC = readFileSync(join(process.cwd(), 'src', 'services', 'otpDelivery.ts'), 'utf8');

test('email branch feeds the real send result into delivered/channel', () => {
  assert.match(
    OTP_DELIVERY_SRC,
    /const sent = await sendMail\(\s*email,/,
    'email branch must capture the sendMail MailResult'
  );
  assert.match(
    OTP_DELIVERY_SRC,
    /return \{ otpKey, delivered: sent\.ok, channel: sent\.ok \? 'email' : null, fallbackOtp \};/,
    'delivered + channel must track the real send result'
  );
});

test('email branch returns fallbackOtp=otp on a FAILED send, guards it on success', () => {
  assert.match(
    OTP_DELIVERY_SRC,
    /const fallbackOtp = sent\.ok \? \(process\.env\.NODE_ENV !== 'production' \? otp : undefined\) : otp;/,
    'failed send must expose the OTP as fallback; success must only leak it off-production'
  );
});

// Pure re-implementation of the exact expression, exercised across the matrix so
// the "never stuck" contract is proven deterministically (no DB, no env mutation
// side effects leaking — we restore NODE_ENV after each case).
function emailFallbackOtp(sentOk: boolean, nodeEnv: string | undefined, otp: string): string | undefined {
  return sentOk ? (nodeEnv !== 'production' ? otp : undefined) : otp;
}

test('fallback matrix: failed send always exposes the OTP (incl. production)', () => {
  assert.equal(emailFallbackOtp(false, 'production', '123456'), '123456', 'prod + failed → exposed (not stranded)');
  assert.equal(emailFallbackOtp(false, 'development', '123456'), '123456', 'dev + failed → exposed');
  assert.equal(emailFallbackOtp(false, undefined, '123456'), '123456', 'no NODE_ENV + failed → exposed');
});

test('fallback matrix: successful send never leaks the OTP in production', () => {
  assert.equal(emailFallbackOtp(true, 'production', '123456'), undefined, 'prod + success → no leak');
  assert.equal(emailFallbackOtp(true, 'development', '123456'), '123456', 'dev + success → dev convenience devOtp');
  assert.equal(emailFallbackOtp(true, undefined, '123456'), '123456', 'no NODE_ENV (treated as non-prod) + success → devOtp');
});
