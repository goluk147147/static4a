/**
 * Lead-capture-before-verification contract (R2).
 *
 * "Lead capture is paramount": the user's NAME + contact must be persisted the
 * INSTANT a signup code is requested, as an UNVERIFIED lead (last_login IS NULL,
 * NO new column / NO migration), and register must FLIP that lead to verified
 * WITHOUT creating a duplicate and WITHOUT weakening the 409 uniqueness guards.
 *
 * The worktree has no reachable DB, so (per signupEmailFallback.test.ts) these
 * are source-assertion checks over the load-bearing lines.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');
const OTP_ROUTE_SRC = SRC('routes', 'otp.ts');
const OTP_DELIVERY_SRC = SRC('services', 'otpDelivery.ts');
const LEAD_UPSERT_SRC = SRC('services', 'leadUpsert.ts');
const USERS_ROUTE_SRC = SRC('routes', 'users.ts');

// (a) otp.ts accepts an optional name and forwards it to deliverSignupOtp.
test('otp/send schema accepts an optional name and forwards it', () => {
  assert.match(OTP_ROUTE_SRC, /name: z\.string\(\)\.min\(1\)\.max\(120\)\.optional\(\)/, 'sendSchema must accept optional name');
  assert.match(
    OTP_ROUTE_SRC,
    /deliverSignupOtp\(\{ email, mobile, deviceToken, name \}\)/,
    'otp/send must thread name into deliverSignupOtp'
  );
});

// (b) otpDelivery.ts upserts the lead BEFORE any channel sends.
test('deliverSignupOtp upserts the unverified lead BEFORE sending any channel', () => {
  assert.match(
    OTP_DELIVERY_SRC,
    /await upsertUnverifiedLead\(\{ name: input\.name, email, mobile \}\);/,
    'deliverSignupOtp must call upsertUnverifiedLead with the name+contact'
  );
  const upsertIdx = OTP_DELIVERY_SRC.indexOf('await upsertUnverifiedLead(');
  const mailIdx = OTP_DELIVERY_SRC.indexOf('const sent = await sendMail(');
  const loopIdx = OTP_DELIVERY_SRC.indexOf('resolveMobileChannelOrder(policy)');
  assert.ok(upsertIdx > -1, 'upsert call must exist');
  assert.ok(upsertIdx < mailIdx, 'lead upsert must run before the email send');
  assert.ok(upsertIdx < loopIdx, 'lead upsert must run before the mobile channel loop');
});

// (c) leadUpsert.ts creates the UNVERIFIED lead with the right shape and keys the
//     lookup on the same identifiers register uses.
test('leadUpsert creates an unverified (last_login null) customer lead with a random password', () => {
  assert.match(LEAD_UPSERT_SRC, /last_login: null/, 'new lead must set last_login: null (unverified signal)');
  assert.match(LEAD_UPSERT_SRC, /role: 'customer'/, 'new lead must be role customer');
  assert.match(
    LEAD_UPSERT_SRC,
    /bcrypt\.hashSync\(crypto\.randomBytes\(24\)\.toString\('hex'\), 10\)/,
    'new lead must get a random bcrypt password'
  );
});

test('leadUpsert keys the lookup on email / recovery_email / mobile (no duplicate leads)', () => {
  assert.match(LEAD_UPSERT_SRC, /\{ email \}, \{ recovery_email: email \}/, 'must look up by email and recovery_email');
  assert.match(LEAD_UPSERT_SRC, /\{ mobile \}/, 'must look up by mobile');
  assert.match(LEAD_UPSERT_SRC, /findFirst\(\{ where: \{ OR: or \} \}\)/, 'must findFirst on the OR of identifiers');
});

test('leadUpsert is best-effort (never throws) and never overwrites an existing name', () => {
  // Wrapped in try/catch so a lead-write failure can never break OTP delivery.
  assert.match(LEAD_UPSERT_SRC, /try \{/, 'must be wrapped in try/catch');
  // Only backfills a name when the existing one is empty.
  assert.match(LEAD_UPSERT_SRC, /if \(name && !String\(existing\.name \|\| ''\)\.trim\(\)\)/, 'must only backfill a missing name');
});

// (d) register flips last_login (verified), keeps the 409 dup guard, never deletes.
test('register flips the lead to verified (sets last_login) via update, keeping create as fallback', () => {
  assert.match(USERS_ROUTE_SRC, /user = await prisma\.user\.update\(\{\s*where: \{ id: lead\.id \}/, 'register must update the existing lead row');
  assert.match(USERS_ROUTE_SRC, /last_login: new Date\(\),/, 'register must set last_login (the verified flip)');
});

test('register retains the 409 uniqueness guard and never deletes the lead', () => {
  assert.match(
    USERS_ROUTE_SRC,
    /if \(dupUser && \(!lead \|\| dupUser\.id !== lead\.id\)\) \{/,
    'dup guard must still reject a username/mobile belonging to a DIFFERENT user id'
  );
  assert.match(
    USERS_ROUTE_SRC,
    /dupUser\.mobile === mobile \? 'Mobile number already registered' : 'Username already taken', 409/,
    'the 409 messages/guard must be preserved'
  );
  // register must not delete a user row anywhere.
  const registerSlice = USERS_ROUTE_SRC.slice(
    USERS_ROUTE_SRC.indexOf("router.post('/register'"),
    USERS_ROUTE_SRC.indexOf("router.post('/login'")
  );
  assert.doesNotMatch(registerSlice, /prisma\.user\.delete/, 'register must never delete the lead row');
});
