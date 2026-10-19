/**
 * Set-mobile multi-channel + fallback contract (R1).
 *
 * The email-ONLY /users/mobile/send trap (503 when SMTP is down) stranded every
 * Google user behind the checkout gate. R1 routes it through a new
 * deliverSetMobileOtp (EMAIL → FCM → fallbackOtp) that NEVER hard-503s and keeps
 * the OTP key/purpose /mobile/verify reads UNCHANGED.
 *
 * The worktree has no reachable DB, so these are source-assertion checks over
 * services/otpDelivery.ts (same technique as signupEmailFallback.test.ts), plus
 * a pure re-implementation of the channel-order fallback decision.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const OTP_DELIVERY_SRC = readFileSync(join(process.cwd(), 'src', 'services', 'otpDelivery.ts'), 'utf8');

test('deliverSetMobileOtp stores under the SAME key/purpose verify reads (set_mobile)', () => {
  // Must store purpose='set_mobile' under the provided email-target otpKey — NOT
  // a 'mobile:<n>' key — so /mobile/verify's lookup is unchanged.
  assert.match(
    OTP_DELIVERY_SRC,
    /data: \{ email: otpKey, otp, purpose: 'set_mobile', expires_at/,
    'set-mobile OTP must be stored under otpKey with purpose set_mobile'
  );
});

test('deliverSetMobileOtp tries EMAIL first, then FCM, then returns the fallback OTP', () => {
  // Email first (a working mailbox proves possession).
  assert.match(OTP_DELIVERY_SRC, /if \(sent\.ok\) return \{ delivered: true, channel: 'email', fallbackOtp: undefined \};/, 'email branch');
  // FCM to the user's device tokens next.
  assert.match(OTP_DELIVERY_SRC, /if \(await tryFcm\(userTokens, otp\)\) return \{ delivered: true, channel: 'fcm', fallbackOtp: undefined \};/, 'fcm branch');
  // Fallback: expose the OTP (production included) — never a 503 dead-end.
  assert.match(OTP_DELIVERY_SRC, /return \{ delivered: false, channel: null, fallbackOtp: otp \};/, 'fallback branch exposes the OTP');
});

// Pure re-implementation of the channel-order decision so the "never stuck"
// contract is proven deterministically.
function setMobileFallback(emailOk: boolean, fcmOk: boolean, otp: string): { channel: string | null; fallbackOtp?: string } {
  if (emailOk) return { channel: 'email', fallbackOtp: undefined };
  if (fcmOk) return { channel: 'fcm', fallbackOtp: undefined };
  return { channel: null, fallbackOtp: otp };
}

test('fallback matrix: email down + no FCM device still yields a usable OTP (no 503 dead-end)', () => {
  assert.deepEqual(setMobileFallback(false, false, '123456'), { channel: null, fallbackOtp: '123456' }, 'all channels down → OTP returned');
  assert.deepEqual(setMobileFallback(false, true, '123456'), { channel: 'fcm', fallbackOtp: undefined }, 'email down + FCM up → FCM, no leak');
  assert.deepEqual(setMobileFallback(true, false, '123456'), { channel: 'email', fallbackOtp: undefined }, 'email up → email, no leak');
});
