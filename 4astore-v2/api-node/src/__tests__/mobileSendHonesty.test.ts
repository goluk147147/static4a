/**
 * SEND-endpoint honesty / failsafe contract (OTP delivery — R1 + Option B).
 *
 * The worktree has no reachable database, so the full HTTP round-trip of
 * POST /api/users/mobile/send cannot run here. Following the same
 * source-assertion technique as posBilling.test.ts, this file reads
 * routes/users.ts and pins the load-bearing lines:
 *   - R1: /users/mobile/send NO LONGER hard-503s — it routes through the
 *     multi-channel deliverSetMobileOtp (EMAIL → FCM → fallbackOtp) and returns
 *     the fallback OTP as devOtp so a Google user is never trapped behind the
 *     checkout gate when email is down;
 *   - the auth-gated recovery-email/send KEEPS its honest 503 (optional profile
 *     hardening, not an access gate);
 *   - forgot-password/send KEEPS its generic-200 enumeration-safe shape;
 *   - exactly ONE 503 remains in the file (recovery-email/send only).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const USERS_ROUTE_SRC = readFileSync(join(process.cwd(), 'src', 'routes', 'users.ts'), 'utf8');

test('mobile/send routes through multi-channel deliverSetMobileOtp (no email-only trap)', () => {
  assert.match(
    USERS_ROUTE_SRC,
    /const result = await deliverSetMobileOtp\(\{ otpKey: target\.toLowerCase\(\), userId: user\.id \}\);/,
    'mobile/send must call deliverSetMobileOtp with the email-target key (verify-match preserved)'
  );
});

test('mobile/send never hard-503s — returns the fallback OTP as devOtp instead', () => {
  // No 503 dead-end in the mobile/send handler anymore.
  assert.doesNotMatch(
    USERS_ROUTE_SRC,
    /We couldn't send your verification code by email right now/,
    'mobile/send must no longer carry the email-only 503 message'
  );
  assert.match(
    USERS_ROUTE_SRC,
    /return ok\(res, \{ message: 'Code sent', devOtp: result\.fallbackOtp \}\);/,
    'mobile/send must return the fallback OTP so the client auto-fills it (never a 503 dead-end)'
  );
});

test('recovery-email/send gets the same honest 503 on a failed send', () => {
  assert.match(
    USERS_ROUTE_SRC,
    /const sent = await sendMail\(email, '4A Store recovery email code'/,
    'recovery-email/send must capture the sendMail result'
  );
  assert.match(
    USERS_ROUTE_SRC,
    /if \(!sent\.ok\) return fail\(res, "We couldn't send the verification code by email right now\. Please try again shortly or contact support\.", 503\);/,
    'recovery-email/send must return 503 on a failed send'
  );
});

test('forgot-password/send stays enumeration-safe (generic 200, no delivery status leaked)', () => {
  // It must still ALWAYS return the generic 200, and only log a failed send.
  assert.match(
    USERS_ROUTE_SRC,
    /return ok\(res, \{ message: RESET_GENERIC \}\);/,
    'forgot-password must still return the generic 200'
  );
  assert.match(
    USERS_ROUTE_SRC,
    /\[forgot-password\] mail send failed \(not surfaced to keep enumeration-safety\)/,
    'forgot-password must only log a failed send, never surface a status'
  );
  // Exactly ONE 503 remains in this file now: recovery-email/send. R1 removed the
  // mobile/send 503 dead-end (it now returns a fallback OTP instead).
  const count503 = (USERS_ROUTE_SRC.match(/, 503\)/g) || []).length;
  assert.equal(count503, 1, 'exactly one 503 return remains: recovery-email/send (mobile/send no longer 503s)');
});
