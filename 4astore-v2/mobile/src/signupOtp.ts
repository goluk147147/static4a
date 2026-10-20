// Pure, dependency-free helper for the signup OTP request payload.
// Kept free of React/api imports so the node:test harness (src/__tests__/register.mjs) can load it
// — it cannot render React screens, only pure-TS modules under src/__tests__.
//
// The backend keys the signup OTP EXACTLY like /register verifies it
// (routes/users.ts: otpKey = email ? email.toLowerCase() : `mobile:${mobile}`).
// So /otp/send must carry the SAME identifier /register will check against:
//   - user gave an email  → send `email` (email path, unchanged behaviour)
//   - mobile-only signup  → send `mobile` (routes through the multi-channel
//     resolver whose fallbackOtp the app auto-fills, so a rural, mobile-only
//     user is never stuck when SMTP/FCM are down).
// Any one of email/mobile is enough; the name is threaded so the backend
// captures the lead the instant a code is requested ("lead is paramount").
export interface SignupOtpInput {
  email?: string;
  mobile?: string;
  name?: string;
}

export interface SignupOtpPayload {
  email?: string;
  mobile?: string;
  name?: string;
}

/** Matches a real 10-digit Indian mobile — same rule as the server (/^[6-9]\d{9}$/). */
export function isValidMobile(mobile: string | null | undefined): boolean {
  return /^[6-9]\d{9}$/.test(String(mobile || '').trim());
}

/**
 * Build the POST /otp/send body for signup. When an email is present it is used
 * (email-first, matching /register's otpKey); otherwise the trimmed mobile is
 * sent so the mobile fallback path (auto-fillable devOtp) kicks in. The name is
 * added only when non-empty.
 */
export function buildSignupOtpPayload(input: SignupOtpInput): SignupOtpPayload {
  const email = (input.email || '').trim();
  const mobile = (input.mobile || '').trim();
  const name = (input.name || '').trim();
  const payload: SignupOtpPayload = email ? { email } : { mobile };
  if (name) payload.name = name;
  return payload;
}
