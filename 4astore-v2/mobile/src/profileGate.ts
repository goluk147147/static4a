// Pure, dependency-free helper for the "Complete your profile" gate (Issue 6, mobile half).
// Kept free of React/api imports so the node:test harness (src/__tests__/register.mjs) can load it
// — it cannot render React screens, only pure-TS modules under src/__tests__.
//
// A Google user is minted on the server with a `g<digits>` placeholder mobile (see context.json),
// so any value that is not a real 10-digit Indian mobile (starts 6-9) means the profile still needs
// a real number. We mirror the server's /^[6-9]\d{9}$/ validation exactly.
export function needsRealMobile(user: { mobile?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return !/^[6-9]\d{9}$/.test(String(user.mobile || ''));
}
