/* ------------------------------------------------------------------ *
 * Signup OTP delivery orchestrator (DB-bound).
 * ------------------------------------------------------------------ *
 * Single entry point for generating + delivering a signup OTP across the
 * supported channels, with a graceful fallback so a rural, mobile-only user is
 * NEVER stuck on the signup screen.
 *
 * It reuses the existing `email_otps` table (NO new tables, NO Prisma
 * migration), keyed exactly like the rest of the repo:
 *   - email identifier  → email_otps.email = <email lowercased>, purpose='signup'
 *   - mobile identifier → email_otps.email = 'mobile:' + <mobile>, purpose='signup'
 *     (mirrors routes/pos-auth.ts, which stores 'pos:<mobile>' for pos_login).
 *
 * Delivery channels (building blocks reused as-is, never reinvented):
 *   - EMAIL : utils/mailer.sendMail (best-effort, never throws) — unchanged path.
 *   - WhatsApp: services/whatsappCloud.sendWhatsAppTemplateMessage — needs a
 *     Meta PRE-APPROVED template; when none is configured it returns { ok:false }
 *     and we fall through (never throw).
 *   - FCM   : services/push.sendToTokens for the user's device tokens — a brand
 *     new signup mobile usually has NO user row / NO tokens, so this is the
 *     expected "not delivered" case that triggers the fallback.
 *
 * The pure channel-order decision lives in services/otpChannelPolicy.ts.
 * ------------------------------------------------------------------ */
import { prisma } from '../db';
import { sendMail } from '../utils/mailer';
import { sendWhatsAppTemplateMessage, buildImageTextComponents } from './whatsappCloud';
import { sendToTokens, tokensForUser } from './push';
import { parseOtpChannels, resolveMobileChannelOrder } from './otpChannelPolicy';

/**
 * Meta OTP template coordinates. A signup OTP template must be PRE-APPROVED in
 * Meta before WhatsApp can deliver; until one exists these env vars are empty,
 * so the WhatsApp attempt is skipped and the resolver falls through. Wiring an
 * approved template later is a config-only change (no code change needed).
 */
const WA_OTP_TEMPLATE = (process.env.WHATSAPP_OTP_TEMPLATE || '').trim();
const WA_OTP_TEMPLATE_LANG = (process.env.WHATSAPP_OTP_TEMPLATE_LANG || 'en').trim() || 'en';

export interface DeliverSignupOtpInput {
  email?: string;
  mobile?: string;
}

export interface DeliverSignupOtpResult {
  /** The email_otps.email key the OTP was stored under (email lowercased, or 'mobile:<mobile>'). */
  otpKey: string;
  /** True when a REAL channel confirmed delivery (email send attempted, WhatsApp ok, or FCM sent). */
  delivered: boolean;
  /** Which channel delivered (or null when nothing did and we fell back). */
  channel: 'email' | 'whatsapp' | 'fcm' | null;
  /**
   * The OTP returned to the client so the frontend can AUTO-FILL it and the user
   * proceeds. Present:
   *   - EMAIL path: only outside production (preserves today's devOtp behavior).
   *   - MOBILE path: whenever no real channel delivered — INCLUDING production
   *     (see the security-tradeoff note where it is set).
   */
  fallbackOtp?: string;
}

/** Generate a fresh 6-digit numeric OTP (same shape as routes/otp.ts & pos-auth.ts). */
function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Read the admin OTP-channel policy from the raw settings.otp_channels column (tolerant). */
async function readOtpChannelPolicy() {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ otp_channels: string | null }>>(
      'SELECT otp_channels FROM settings WHERE id = 1'
    );
    return parseOtpChannels(rows?.[0]?.otp_channels ?? null);
  } catch {
    // Missing column / DB hiccup → fall back to the FCM-only default so signup
    // still has a channel to try first and never hard-fails on config read.
    return parseOtpChannels(null);
  }
}

/** Try WhatsApp. Never throws — a missing template or Meta error = not delivered. */
async function tryWhatsApp(mobile: string, otp: string): Promise<boolean> {
  if (!WA_OTP_TEMPLATE) return false; // no pre-approved OTP template configured yet
  try {
    const res = await sendWhatsAppTemplateMessage({
      recipientPhone: mobile,
      templateName: WA_OTP_TEMPLATE,
      languageCode: WA_OTP_TEMPLATE_LANG,
      // OTP templates carry the code as the first body variable {{1}}.
      components: buildImageTextComponents({ bodyParams: [otp] }),
    });
    return !!res.ok;
  } catch {
    return false;
  }
}

/** Try FCM push to the signup mobile's existing device tokens. Never throws. */
async function tryFcm(mobile: string, otp: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({ where: { mobile } }).catch(() => null);
    if (!user) return false; // brand-new signup: no user row yet → no tokens
    const tokens = await tokensForUser(user.id).catch(() => [] as string[]);
    if (!tokens.length) return false;
    const sent = await sendToTokens(tokens, {
      title: '🔐 4A Store verification code',
      body: `Your 4A Store signup code is ${otp}. It expires in 10 minutes.`,
      data: { type: 'signup_otp' },
    }).catch(() => 0);
    return sent > 0;
  } catch {
    return false;
  }
}

/**
 * Generate + persist a signup OTP and attempt delivery, returning whether a real
 * channel delivered and whether to expose the OTP as a fallback. NEVER throws
 * out of a delivery failure — a failing channel degrades to the next fallback so
 * the request can never 500 on a delivery problem.
 */
export async function deliverSignupOtp(input: DeliverSignupOtpInput): Promise<DeliverSignupOtpResult> {
  const email = input.email?.trim().toLowerCase() || '';
  const mobile = input.mobile?.trim() || '';
  const otp = generateOtp();

  // ---- EMAIL path (unchanged behavior) --------------------------------------
  // Keeps byte-for-byte the behavior of routes/otp.ts: store under the lowercased
  // email key, best-effort email send (sendMail never throws / never reports
  // delivery), and only leak the OTP as devOtp OUTSIDE production.
  if (email) {
    const otpKey = email;
    await prisma.emailOtp.create({
      data: { email: otpKey, otp, purpose: 'signup', expires_at: new Date(Date.now() + 10 * 60 * 1000) },
    });
    await sendMail(
      email,
      'Your 4A Store verification code',
      `Your 4A Store OTP is ${otp}. It expires in 10 minutes.`
    ).catch(() => null);
    const fallbackOtp = process.env.NODE_ENV !== 'production' ? otp : undefined;
    return { otpKey, delivered: true, channel: 'email', fallbackOtp };
  }

  // ---- MOBILE path (multi-channel with graceful fallback) -------------------
  const otpKey = `mobile:${mobile}`;
  await prisma.emailOtp.create({
    data: { email: otpKey, otp, purpose: 'signup', expires_at: new Date(Date.now() + 10 * 60 * 1000) },
  });

  const policy = await readOtpChannelPolicy();
  for (const channel of resolveMobileChannelOrder(policy)) {
    const delivered = channel === 'whatsapp' ? await tryWhatsApp(mobile, otp) : await tryFcm(mobile, otp);
    if (delivered) return { otpKey, delivered: true, channel, fallbackOtp: undefined };
  }

  // SECURITY TRADEOFF (product decision — "user never stuck"): no real channel
  // could deliver the mobile OTP (no WhatsApp template, no FCM device token for a
  // brand-new signup, or every attempt failed). To honor the explicit requirement
  // that a rural mobile-only user NEVER breaks mid-signup, we return the OTP to
  // the client as `fallbackOtp` so the frontend auto-fills it and the user
  // proceeds. This applies IN PRODUCTION too for the mobile path. The OTP becomes
  // known to the client, which is acceptable per the product decision and is
  // CONTROLLABLE via the admin channel settings (once WhatsApp/FCM can really
  // deliver, that channel wins first and this fallback never fires). This gate
  // ONLY triggers when nothing above delivered.
  return { otpKey, delivered: false, channel: null, fallbackOtp: otp };
}
