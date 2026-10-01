import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ok, fail } from '../utils/http';
import { sendMail } from '../utils/mailer';

const router = Router();

const sendSchema = z.object({ email: z.string().email() });

// POST /api/otp/send — generates a 6-digit signup OTP (10 min expiry) and emails it.
router.post('/send', async (req: Request, res: Response) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Valid email required', 422);
  const email = parsed.data.email.toLowerCase();

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  await prisma.emailOtp.create({
    data: { email, otp, purpose: 'signup', expires_at: new Date(Date.now() + 10 * 60 * 1000) },
  });

  await sendMail(email, 'Your 4A Store verification code', `Your 4A Store OTP is ${otp}. It expires in 10 minutes.`).catch(
    () => null
  );

  // In dev (no mail configured) return the OTP so testing is possible.
  const devOtp = process.env.NODE_ENV !== 'production' ? otp : undefined;
  return ok(res, { message: 'OTP sent to your email', devOtp });
});

export default router;
