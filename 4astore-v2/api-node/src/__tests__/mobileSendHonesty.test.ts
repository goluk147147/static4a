/**
 * SEND-endpoint honesty contract (OTP delivery honesty — Option B).
 *
 * The worktree has no reachable database, so the full HTTP round-trip of
 * POST /api/users/mobile/send cannot run here. Following the same
 * source-assertion technique as posBilling.test.ts, this file reads
 * routes/users.ts and pins the load-bearing lines that make the delivery
 * failure HONEST:
 *   - a FAILED send (sendMail → { ok:false }) returns HTTP 503 with the
 *     support-contact message, NOT a false 200 'Code sent';
 *   - a SUCCESSFUL send keeps the 200 'Code sent' response;
 *   - devOtp stays guarded behind config.env !== 'production';
 *   - the auth-gated recovery-email/send gets the SAME honest 503;
 *   - forgot-password/send KEEPS its generic-200 enumeration-safe shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const USERS_ROUTE_SRC = readFileSync(join(process.cwd(), 'src', 'routes', 'users.ts'), 'utf8');

test('mobile/send maps a failed send to 503 with the support message', () => {
  // The send result is captured (no .catch — sendMail no longer throws) and a
  // failed delivery returns 503 instead of a false 200.
  assert.match(
    USERS_ROUTE_SRC,
    /const sent = await sendMail\(target, '4A Store mobile verification code'/,
    'mobile/send must capture the sendMail result'
  );
  assert.match(
    USERS_ROUTE_SRC,
    /if \(!sent\.ok\) return fail\(res, "We couldn't send your verification code by email right now\. Please try again shortly or contact support\.", 503\);/,
    'mobile/send must return 503 with the support message on a failed send'
  );
});

test('mobile/send keeps 200 Code sent on success with devOtp guarded off-production', () => {
  // The success 200 and the production-guarded devOtp must be preserved.
  assert.match(
    USERS_ROUTE_SRC,
    /return ok\(res, \{ message: 'Code sent', devOtp: config\.env !== 'production' \? otp : undefined \}\);/,
    'success path must keep 200 Code sent and only leak devOtp off-production'
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
  // It must NOT return a 503 anywhere in the forgot-password handler path: the
  // only 503s in this file belong to mobile/send and recovery-email/send.
  const count503 = (USERS_ROUTE_SRC.match(/, 503\)/g) || []).length;
  assert.equal(count503, 2, 'exactly two 503 returns: mobile/send and recovery-email/send');
});
