// Pure push-registration gate decision (no native imports) so it can be unit-tested
// with node:test, mirroring src/pushPayload.ts. registerForPush() calls this.
//
// GUEST PUSH: registration no longer requires a logged-in access token. A freshly
// installed app registers its FCM token (user_id null server-side) so it receives
// store-wide broadcast/promo pushes before the user ever logs in. The only gates
// are: push is enabled for this build (HAS_PUSH / google-services present) and we're
// on a real device (not a simulator, where FCM tokens aren't issued).
export function shouldRegisterPush(opts: { hasPush: boolean; isDevice: boolean }): boolean {
  return opts.hasPush && opts.isDevice;
}
