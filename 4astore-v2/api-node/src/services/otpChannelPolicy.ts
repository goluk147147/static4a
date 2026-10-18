/* ------------------------------------------------------------------ *
 * Signup OTP delivery CHANNEL POLICY — PURE helpers (DB-free, network-free).
 * ------------------------------------------------------------------ *
 * Kept in a dependency-free module so the Node test runner can import it
 * WITHOUT pulling in prisma/db or Express (mirrors the pure-import pattern of
 * whatsappFormat.ts / posLoginDecision.ts). The DB-bound orchestrator
 * `otpDelivery.ts` reads the raw `settings.otp_channels` JSON blob and feeds it
 * through `parseOtpChannels` here, then uses `resolveMobileChannelOrder` to
 * decide the attempt order for a mobile-only signup.
 *
 * `mode` is the single owner-facing switch and the authoritative source of
 * truth; the `whatsapp`/`fcm` booleans are DERIVED from it (kept for
 * forward-compat and simple reads). Default when the column is absent/garbage is
 * FCM-only ({ whatsapp:false, fcm:true, mode:'fcm' }) — the free "FCM first"
 * starting point. The email signup path is unaffected by this policy.
 * ------------------------------------------------------------------ */

export type OtpChannelMode = 'whatsapp' | 'fcm' | 'both';

export interface OtpChannelPolicy {
  whatsapp: boolean;
  fcm: boolean;
  mode: OtpChannelMode;
}

/** The FCM-only default used whenever the stored policy is missing or malformed. */
const DEFAULT_POLICY: OtpChannelPolicy = { whatsapp: false, fcm: true, mode: 'fcm' };

/** Derive the (whatsapp, fcm) booleans from the authoritative mode. */
function policyFromMode(mode: OtpChannelMode): OtpChannelPolicy {
  return {
    whatsapp: mode === 'whatsapp' || mode === 'both',
    fcm: mode === 'fcm' || mode === 'both',
    mode,
  };
}

/**
 * Tolerantly parse the raw `settings.otp_channels` value into an
 * `OtpChannelPolicy`. Accepts a JSON string (as stored in the raw column) or an
 * already-parsed object. `mode` drives the result; on any null/garbage/unknown
 * input the FCM-only default is returned so a missing or corrupt blob never
 * throws and signup always has a channel to try first. Mirrors the OFF-default
 * tolerance of whatsappCloud.readWhatsappApiConfig.
 */
export function parseOtpChannels(raw: unknown): OtpChannelPolicy {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return { ...DEFAULT_POLICY };
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return { ...DEFAULT_POLICY };
    }
  }
  if (!obj || typeof obj !== 'object') return { ...DEFAULT_POLICY };
  const mode = (obj as Record<string, unknown>).mode;
  if (mode === 'whatsapp' || mode === 'fcm' || mode === 'both') {
    return policyFromMode(mode);
  }
  return { ...DEFAULT_POLICY };
}

/**
 * Ordered list of channels to attempt for a MOBILE-only signup, derived from the
 * policy mode. WhatsApp is tried before FCM when both are enabled. The resolver
 * walks this list and stops at the first channel that actually delivers.
 */
export function resolveMobileChannelOrder(p: OtpChannelPolicy): Array<'whatsapp' | 'fcm'> {
  if (p.mode === 'both') return ['whatsapp', 'fcm'];
  if (p.mode === 'whatsapp') return ['whatsapp'];
  return ['fcm'];
}
