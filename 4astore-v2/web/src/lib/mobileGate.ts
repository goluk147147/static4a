// Mirrors api-node/src/auth/mobileGate.ts isRealMobile exactly: a real Indian mobile
// is a 10-digit number starting 6-9. Google sign-in accounts carry mobile: null until
// the user adds+verifies one; only a real number may place an order (checkout gate).
export const hasRealMobile = (u: { mobile?: string | null } | null | undefined): boolean =>
  /^[6-9]\d{9}$/.test(String(u?.mobile ?? ''));
