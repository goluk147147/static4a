import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ok, fail } from '../utils/http';
import { rateLimit } from '../utils/rateLimit';
import { deliverSignupOtp } from '../services/otpDelivery';

const router = Router();

// Accept EITHER an email OR a 10-digit mobile. At least one is required.
// Email signups keep the exact same shape/behavior as before; mobile-only
// signups route through the multi-channel resolver with graceful fallback so a
// rural user with no email is never stuck.
const sendSchema = z
  .object({
    email: z.string().email().optional(),
    mobile: z.string().regex(/^[6-9]\d{9}$/).optional(),
    // Optional current-device (guest) FCM token so the mobile-path OTP can be
    // pushed to THIS device's own registered token. Omitted today in a plain
    // browser; threaded through unchanged when present. The email-or-mobile
    // refine below is unaffected by it.
    deviceToken: z.string().min(1).max(4096).optional(),
    // Optional lead NAME captured the instant a code is requested. When present
    // the lead's name + contact is persisted BEFORE verification (see
    // deliverSignupOtp → upsertUnverifiedLead) so "lead is paramount" holds even
    // if the user abandons at the OTP step. Additive + safe when absent.
    name: z.string().min(1).max(120).optional(),
  })
  .refine((v) => !!v.email || !!v.mobile, { message: 'Email or mobile required' });

// POST /api/otp/send — generates a 6-digit signup OTP (10 min expiry) and delivers it.
// EMAIL: emailed (unchanged); devOtp only outside production.
// MOBILE: WhatsApp/FCM per admin policy, else a fallback OTP so signup never stalls.
// Rate-limited (5/min per IP — unauthenticated signup) with a distinct bucket so
// it never shares counters with pos-auth; a soft abuse guard that still allows
// legitimate resend/retry (mirrors routes/pos-auth.ts).
router.post('/send', rateLimit({ limit: 5, windowMs: 60_000, bucket: 'signup_otp_send' }), async (req: Request, res: Response) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Valid email or 10-digit mobile required', 422);
  const { email, mobile, deviceToken, name } = parsed.data;

  const result = await deliverSignupOtp({ email, mobile, deviceToken, name });

  // The frontend already auto-fills from `data.devOtp`, so we return the
  // fallback OTP in that same field (email: dev-only; mobile: whenever no real
  // channel delivered). The message reflects which identifier was used without
  // leaking account existence beyond today's behavior.
  const message = email ? 'OTP sent to your email' : 'Verification code sent';
  return ok(res, { message, devOtp: result.fallbackOtp });
});

export default router;
