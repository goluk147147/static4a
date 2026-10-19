/**
 * POS login FCM-down fallback contract (R6).
 *
 * routes/pos-auth.ts /otp/send only exposed devOtp off-production, so in prod a
 * POS owner with no registered FCM device could not read the login code. R6
 * exposes the OTP in production too WHEN the push reached no device
 * (delivered < 1), AFTER the active-allowlist check — so an unauthorised number
 * never gets a code — while keeping the rate-limit, enumeration-safety, the
 * pos:<mobile>/pos_login storage key, and the no-downgrade guard intact.
 *
 * Source-assertion over pos-auth.ts (no reachable DB) + a pure matrix check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const POS_SRC = readFileSync(join(process.cwd(), 'src', 'routes', 'pos-auth.ts'), 'utf8');

test('pos /otp/send captures the delivered count and exposes OTP when delivery < 1 (prod included)', () => {
  assert.match(
    POS_SRC,
    /const devOtp = config\.env !== 'production' \|\| delivered < 1 \? otp : undefined;/,
    'devOtp must be exposed off-prod OR whenever no device received the push'
  );
  assert.match(POS_SRC, /const delivered = staffTokens\.length/, 'must capture the delivered count');
});

test('pos /otp/send keeps the allowlist gate, rate-limit, enumeration-safety and storage key', () => {
  // Fallback fires only AFTER the active-allowlist check passed.
  assert.match(POS_SRC, /const phone = await findActivePhone\(mobile\);/, 'allowlist check preserved');
  assert.match(POS_SRC, /return ok\(res, \{ message: SEND_GENERIC \}\);/, 'enumeration-safe generic 200 preserved for unauthorised numbers');
  assert.match(POS_SRC, /rateLimit\(\{ limit: 5, windowMs: 60_000, bucket: 'pos_otp_send' \}\)/, 'rate-limit middleware preserved');
  assert.match(POS_SRC, /email: `pos:\$\{mobile\}`,[\s\S]*?purpose: 'pos_login'/, 'pos:<mobile> / pos_login storage key preserved');
});

// Pure matrix: the devOtp decision across (env, delivered).
function posDevOtp(env: string, delivered: number, otp: string): string | undefined {
  return env !== 'production' || delivered < 1 ? otp : undefined;
}

test('fallback matrix: prod + no device gets the OTP; prod + delivered hides it', () => {
  assert.equal(posDevOtp('production', 0, '123456'), '123456', 'prod + 0 delivered → exposed');
  assert.equal(posDevOtp('production', 1, '123456'), undefined, 'prod + delivered → hidden');
  assert.equal(posDevOtp('development', 1, '123456'), '123456', 'dev always exposes');
});
