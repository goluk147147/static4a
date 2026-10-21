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
 *   - EMAIL : utils/mailer.sendMail (never throws; now REPORTS delivery via its
 *     MailResult, which feeds the `delivered` flag for the email branch).
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
import { renderOtpEmail } from '../utils/emailTemplate';
import { sendWhatsAppTemplateMessage, buildImageTextComponents } from './whatsappCloud';
import { sendToTokens, tokensForUser } from './push';
import { parseOtpChannels, resolveMobileChannelOrder } from './otpChannelPolicy';
import { upsertUnverifiedLead } from './leadUpsert';

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
  /**
   * Optional FCM token of the CURRENT device (the guest token the shipped app
   * already registers via POST /api/push/register). When present it is unioned
   * with the mobile's user tokens for the FCM attempt so the signup OTP can
   * reach this very device without a new .aab. Absent in a plain browser; the
   * email-only / mobile-only (no deviceToken) behavior is unchanged.
   */
  deviceToken?: string;
  /**
   * Optional lead NAME. When present it is persisted (with the email/mobile)
   * as an UNVERIFIED lead BEFORE any channel sends, so the lead's name+contact
   * is captured the instant a code is requested — honouring "lead is paramount"
   * even when the user abandons at the OTP step. Absent → the lead is still
   * upserted on the identifier(s), just without a name backfill.
   */
  name?: string;
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

/**
 * Try FCM push to an explicit list of device tokens. Never throws.
 *
 * SAME-DEVICE PUSH IS WEAK VERIFICATION: when `deviceToken` is the current
 * device's own guest token, the code arrives on the SAME device that is signing
 * up, so this proves possession of the device, not of the mobile number. It is a
 * CONVENIENCE channel, gated by the admin `otp_channels` policy, and the mobile
 * fallback below still applies when no token delivers — signup never breaks.
 */
async function tryFcm(tokens: string[], otp: string): Promise<boolean> {
  if (!tokens.length) return false; // no device token at all → not delivered
  try {
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

  // LEAD CAPTURE (paramount): persist the lead's NAME + contact as an UNVERIFIED
  // row (last_login IS NULL) BEFORE any channel sends, so the lead survives even
  // if the user abandons at the OTP step or every delivery channel fails. This is
  // best-effort / non-fatal — upsertUnverifiedLead never throws, so a lead-write
  // hiccup can never block OTP delivery below. register later flips it to verified.
  await upsertUnverifiedLead({ name: input.name, email, mobile });

  // ---- EMAIL path -----------------------------------------------------------
  // Store under the lowercased email key and attempt an email send. sendMail now
  // REPORTS delivery (never throws), so we feed its real result into the
  // `delivered` flag instead of optimistically claiming delivery. On a FAILED
  // send the OTP is returned as a fallback so an email-signup user is not
  // stranded (see the fallbackOtp note below); on a SUCCESSFUL send nothing is
  // leaked in production.
  if (email) {
    const otpKey = email;
    await prisma.emailOtp.create({
      data: { email: otpKey, otp, purpose: 'signup', expires_at: new Date(Date.now() + 10 * 60 * 1000) },
    });
    // Branded HTML (logo + OTP) with the SAME plain-text body as the fallback.
    const mail = renderOtpEmail({
      title: 'Verify your email',
      otp,
      note: `Your 4A Store OTP is ${otp}. It expires in 10 minutes.`,
    });
    const sent = await sendMail(
      email,
      'Your 4A Store verification code',
      mail.text,
      mail.html
    );
    // "User never stuck" fallback (mirrors the MOBILE path below): when the email
    // actually DELIVERED we never leak the OTP (fallbackOtp stays undefined except
    // the long-standing dev-only convenience). But when NO real channel delivered
    // — i.e. the SMTP send failed (sent.ok === false) — we return the OTP to the
    // client as fallbackOtp so an email-signup user is NOT stranded when outbound
    // mail is down (the exact production incident this guards). This fires ONLY on
    // a failed send; once SMTP works again, delivered=true and no OTP is exposed.
    const fallbackOtp = sent.ok ? (process.env.NODE_ENV !== 'production' ? otp : undefined) : otp;
    return { otpKey, delivered: sent.ok, channel: sent.ok ? 'email' : null, fallbackOtp };
  }

  // ---- MOBILE path (multi-channel with graceful fallback) -------------------
  const otpKey = `mobile:${mobile}`;
  await prisma.emailOtp.create({
    data: { email: otpKey, otp, purpose: 'signup', expires_at: new Date(Date.now() + 10 * 60 * 1000) },
  });

  // Build the FCM candidate tokens ONCE: the current device's own (guest) token
  // when a non-empty one was supplied, unioned with the mobile's user tokens
  // (looked up once; tolerate no row). De-duplicated and truthy-filtered. With no
  // deviceToken and no user row this is empty, so the FCM attempt behaves exactly
  // as before (not delivered → fallback). Same-device push is weak verification;
  // see tryFcm — it stays a policy-gated convenience with the fallback intact.
  const deviceToken = input.deviceToken?.trim() || '';
  const user = await prisma.user.findUnique({ where: { mobile } }).catch(() => null);
  const userTokens = user ? await tokensForUser(user.id).catch(() => [] as string[]) : [];
  const fcmTokens = [...new Set([deviceToken, ...userTokens].filter(Boolean))];

  const policy = await readOtpChannelPolicy();
  for (const channel of resolveMobileChannelOrder(policy)) {
    const delivered = channel === 'whatsapp' ? await tryWhatsApp(mobile, otp) : await tryFcm(fcmTokens, otp);
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

export interface DeliverSetMobileOtpInput {
  /**
   * The email_otps.email KEY the OTP is stored under — the SAME key
   * /users/mobile/verify reads today (the user's recovery_email || email,
   * lowercased). R1 keeps verify UNCHANGED, so the key must NOT switch to a
   * 'mobile:<n>' scheme — multi-channel + fallback are layered on top of this
   * unchanged key/purpose.
   */
  otpKey: string;
  /** The user whose device tokens are the FCM fallback target. */
  userId: bigint | number;
}

export interface DeliverSetMobileOtpResult {
  delivered: boolean;
  channel: 'email' | 'fcm' | null;
  /**
   * The OTP returned to the client so the frontend can AUTO-FILL it. Present
   * whenever NO real channel delivered — INCLUDING production — exactly mirroring
   * the blessed mobile-signup tradeoff, so a Google user with email down can
   * still verify a mobile and clear the checkout gate. Undefined once a real
   * channel delivered (no leak when mail works).
   */
  fallbackOtp?: string;
}

/**
 * Set-mobile OTP delivery for /users/mobile/send (R1).
 *
 * Removes the email-ONLY hard-503 trap that stranded Google users behind the
 * checkout gate when SMTP is down. It writes the OTP under the SAME key/purpose
 * verify already reads (`otpKey`, purpose='set_mobile') — verify is untouched —
 * then attempts delivery EMAIL first (a working mailbox still proves possession),
 * then FCM to the user's device tokens, and finally returns the OTP as
 * `fallbackOtp` (production included) when no real channel delivered so the user
 * is NEVER trapped. Email stays ONE channel but is never the sole path and never
 * hard-503s. NEVER throws out of a delivery failure.
 *
 * SECURITY TRADEOFF (product decision, same as deliverSignupOtp's mobile path):
 * exposing the OTP to the client on non-delivery defeats possession-proof of the
 * mailbox, but is the accepted "user never stuck" tradeoff. It fires ONLY when no
 * real channel delivered; once SMTP/FCM work again the fallback never fires.
 */
export async function deliverSetMobileOtp(input: DeliverSetMobileOtpInput): Promise<DeliverSetMobileOtpResult> {
  const otpKey = input.otpKey.trim().toLowerCase();
  const otp = generateOtp();

  // Store under the SAME key + purpose verify expects (unchanged lookup).
  await prisma.emailOtp.create({
    data: { email: otpKey, otp, purpose: 'set_mobile', expires_at: new Date(Date.now() + 10 * 60 * 1000) },
  });

  // Channel 1 — EMAIL (first, so a working mailbox still gets it). The otpKey IS
  // the user's recovery/primary email, so it is a valid send target.
  const mail = renderOtpEmail({
    title: 'Verify your mobile number',
    otp,
    note: `Your 4A Store code is ${otp}. It expires in 10 minutes.`,
  });
  const sent = await sendMail(
    otpKey,
    '4A Store mobile verification code',
    mail.text,
    mail.html
  );
  if (sent.ok) return { delivered: true, channel: 'email', fallbackOtp: undefined };

  // Channel 2 — FCM to the user's registered devices (reaches a Google user's
  // phone even when email is down). No tokens / nothing sent → fall through.
  const userTokens = await tokensForUser(input.userId).catch(() => [] as string[]);
  if (await tryFcm(userTokens, otp)) return { delivered: true, channel: 'fcm', fallbackOtp: undefined };

  // Channel 3 — fallback: expose the OTP so the client auto-fills it and the user
  // can clear the checkout gate even with every real channel down (prod included).
  return { delivered: false, channel: null, fallbackOtp: otp };
}
