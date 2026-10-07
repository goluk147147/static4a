// Pure decision logic for the in-app update channel (used by components/UpdateCheck.tsx).
// Kept free of any React/React-Native/Expo imports so it can be unit-tested in plain Node.

export interface VersionInfo {
  versionCode: number;
  versionName: string;
  url: string;
  message: string;
  forceUpdate: boolean;
}

/**
 * Decide whether the update modal should appear.
 *
 * - A FORCED update (server says forceUpdate) must NEVER be silently suppressed by a
 *   broken/unknown installed versionCode. If the installed code can't be determined
 *   (0 / NaN / non-finite — e.g. expo-application's nativeBuildVersion came back null
 *   or non-numeric), we still show the forced prompt so a garbled local version can't
 *   disable a release the owner marked mandatory. When the installed code IS known, the
 *   forced prompt shows only when the server is actually ahead (serverCode > installed),
 *   so a user already on the latest build is never nagged.
 * - A NORMAL (optional) update shows only when both the server and installed codes are
 *   finite numbers AND the server is strictly ahead.
 */
export function shouldShowUpdate(server: VersionInfo | null | undefined, installedCode: number): boolean {
  if (!server) return false;
  const serverCode = Number(server.versionCode);
  if (!Number.isFinite(serverCode)) return false; // server payload garbled → nothing to compare against

  const haveInstalled = Number.isFinite(installedCode) && installedCode > 0;

  if (server.forceUpdate) {
    // Honour a forced update even when the installed version is unknown (0/NaN).
    return !haveInstalled || serverCode > installedCode;
  }

  // Optional update: only when we can trust both numbers and the server is ahead.
  return haveInstalled && serverCode > installedCode;
}
