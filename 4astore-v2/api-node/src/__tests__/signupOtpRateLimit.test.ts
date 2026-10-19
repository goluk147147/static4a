/**
 * Signup OTP rate-limit contract (R3).
 *
 * routes/otp.ts POST /send had NO rate limit, letting anyone seed unverified
 * leads unbounded now that /send upserts a lead. This source-assertion test
 * (same technique as mobileSendHonesty.test.ts — the worktree has no reachable
 * DB) pins that:
 *   - otp.ts imports rateLimit from utils/rateLimit;
 *   - it applies the middleware on POST /send with limit:5, windowMs:60_000;
 *   - it uses a DISTINCT bucket label so it never shares pos-auth's counters.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const OTP_ROUTE_SRC = readFileSync(join(process.cwd(), 'src', 'routes', 'otp.ts'), 'utf8');

test('otp.ts imports the shared rateLimit helper', () => {
  assert.match(
    OTP_ROUTE_SRC,
    /import \{ rateLimit \} from '\.\.\/utils\/rateLimit';/,
    'otp.ts must import rateLimit from utils/rateLimit (same helper pos-auth uses)'
  );
});

test('POST /send is rate-limited 5/min with a distinct signup bucket', () => {
  assert.match(
    OTP_ROUTE_SRC,
    /router\.post\(\s*'\/send',\s*rateLimit\(\{ limit: 5, windowMs: 60_000, bucket: 'signup_otp_send' \}\)/,
    'POST /send must apply rateLimit({ limit:5, windowMs:60_000, bucket:signup_otp_send }) as middleware'
  );
});

test('signup bucket label is distinct from the pos bucket (no shared counters)', () => {
  assert.match(OTP_ROUTE_SRC, /bucket: 'signup_otp_send'/, 'must use the signup_otp_send bucket');
  assert.doesNotMatch(OTP_ROUTE_SRC, /bucket: 'pos_otp_send'/, 'must NOT reuse the pos bucket');
});
