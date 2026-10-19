/**
 * Mailer honesty tests (OTP delivery honesty — Option B).
 *
 * sendMail now REPORTS delivery via a MailResult `{ ok, reason? }` and NEVER
 * throws. The real send is delegated to a pure, injectable helper `deliverWith`
 * so the three branches can be proven WITHOUT opening a real SMTP socket or
 * adding a mocking dependency (matches the repo's "import a pure function"
 * convention, e.g. posLoginDecision / otpChannelPolicy):
 *   - transport RESOLVES          → { ok: true }
 *   - transport THROWS            → { ok: false, reason } (never throws out)
 *   - not configured (contract)   → { ok: false }  (driven via a rejecting send)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverWith, type MailMessage, type MailResult } from '../utils/mailer';

const MSG: MailMessage = {
  from: 'noreply@4astore.test',
  to: 'user@example.com',
  subject: 'Your 4A Store verification code',
  text: 'Your 4A Store OTP is 123456. It expires in 10 minutes.',
};

test('deliverWith reports ok:true when the transport accepts the message', async () => {
  let received: MailMessage | null = null;
  const result: MailResult = await deliverWith(async (m) => {
    received = m;
    return { accepted: [m.to] };
  }, MSG);
  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);
  assert.deepEqual(received, MSG);
});

test('deliverWith reports ok:false with a reason when the transport throws (never throws out)', async () => {
  const result = await deliverWith(async () => {
    throw new Error('ECONNREFUSED smtp.example.com:587');
  }, MSG);
  assert.equal(result.ok, false);
  assert.ok(result.reason && result.reason.includes('ECONNREFUSED'), 'reason carries the server-side cause');
});

test('deliverWith does not throw even when the transport rejects (not-configured contract)', async () => {
  // Documents the "not configured = not delivered" contract: the real
  // not-configured path in sendMail returns the SAME { ok:false } shape without
  // ever reaching a transport. Here we drive deliverWith with a rejecting send
  // to prove the no-throw guarantee holds for a failed delivery.
  let threw = false;
  let result: MailResult = { ok: true };
  try {
    result = await deliverWith(async () => Promise.reject(new Error('no transport')), MSG);
  } catch {
    threw = true;
  }
  assert.equal(threw, false, 'deliverWith must never throw to the caller');
  assert.equal(result.ok, false);
});
