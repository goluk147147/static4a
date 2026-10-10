# Data-only default FCM push so the colour large icon + tap link come back

The default push path in `push.ts` was previously forced through the OS-drawn notification-type message (a `notification` block), which made Android/FCM draw the tray entry itself and skipped the shipped app's Notifee presenter — so the right-side colour logo and `data.link` tap routing were lost on every normal push. This change restores the default to a DATA-ONLY message (no top-level `notification` block, no `android.notification` block) for both `sendToTopic()` and `sendToTokens()`, routed through a new `dataOnlyPayload` helper and a `buildMessage` dispatcher. With no notification block, the app's Notifee handler runs in every app state and redraws the push with the colour large icon and tap routing. The latency-critical staff "new order" path (`msg.reliable === true`) is untouched and still goes through `notificationTypeMessage` for guaranteed background wake-up.

Watch for: nothing blocking. All data keys the shipped app reads map cleanly (confirmed), the reliable path is byte-identical (confirmed), tsc verification is recorded in the commit message (confirmed), and only `push.ts` changed (confirmed).

**Verdict**: APPROVED

## High-level view

The design keeps two send shapes behind one dispatcher: `buildMessage(msg)` returns `dataOnlyPayload(msg)` by default and `notificationTypeMessage(msg)` only when `msg.reliable` is set. Both `sendToTopic` and `sendToTokens` now spread `buildMessage(msg)` instead of hardcoding the notification-type payload, so the gating is consistent across both entry points and no call site had to change.

The data-only payload carries every flat key the shipped mobile app reads — `title`, `body`, `channelId`, `link` (when the caller supplied one), `largeIcon` (= `NOTIFICATION_LOGO_URL`), `image` (when present), plus the caller's existing `data` fields such as `type` and `orderId`. All values are coerced to strings, which FCM requires for the `data` map. Delivery urgency is set with `android.priority: 'high'` and `apns-priority: 10`.

The key contract is the one thing worth checking, and it holds: `normalizePush` in `mobile/src/pushPayload.ts` and `drawRich`/`displayPush` in `mobile/src/push.ts` consume exactly these flat keys. The colour icon specifically depends on `data.largeIcon` being an absolute `https://` URL, which `NOTIFICATION_LOGO_URL` always is.

The reliable staff path is the known, deliberate trade-off: it keeps the OS-drawn notification for guaranteed wake-up and accepts the loss of the colour large icon. That behavior is unchanged here.

<details>
<summary>Issues (0)</summary>

No blocking or actionable findings.

</details>

<details>
<summary>Details</summary>

### Default vs reliable gating

`buildMessage` is the single branch point:

```ts
function buildMessage(msg: PushMessage) {
  return msg.reliable ? notificationTypeMessage(msg) : dataOnlyPayload(msg);
}
```

Both send sites spread it the same way — `admin.messaging().send({ topic, ...buildMessage(msg) })` and `sendEachForMulticast({ tokens: batch, ...buildMessage(msg) })` — so topic and token sends can never diverge on which payload shape they pick. `notificationTypeMessage` is unmodified, so every `reliable` caller keeps its exact prior wire format and guaranteed-wake-up behavior. No call site passes anything new, matching the requirement that reliable callers stay untouched.

### Data-only payload and the mobile key contract

```ts
const data: Record<string, string> = {
  ...withLargeIcon(msg.data),
  title: String(msg.title ?? ''),
  body: String(msg.body ?? ''),
  channelId: String(msg.channelId || 'default'),
  ...(msg.data?.link ? { link: String(msg.data.link) } : {}),
  ...(msg.image ? { image: absolutePublicUrl(msg.image) } : {}),
};
```

The ordering matters and is correct: `withLargeIcon(msg.data)` spreads first (injecting `largeIcon` = `NOTIFICATION_LOGO_URL` plus the caller's `type`/`orderId`/`link`/etc.), then the explicit `title`/`body`/`channelId` override any same-named caller keys with coerced strings. `link` is only re-emitted (as a coerced string) when the caller provided one; since `withLargeIcon` already copied `msg.data.link`, the net effect is a guaranteed-string `link` when present and no key when absent. Every value is a string, satisfying the FCM data-map constraint.

Cross-checking the shipped app:

```
server data key   ->  mobile consumer
----------------------------------------------------
title             ->  normalizePush: out.title = src.title || ...
body              ->  normalizePush: out.body  = src.body  || ...
channelId         ->  normalizePush + drawRich android.channelId
link              ->  onPress / getInitialNotification: if (data.link) onLink(...)
largeIcon         ->  drawRich: absolute https URL -> android.largeIcon (colour logo)
image             ->  drawRich: BIGPICTURE style
type, orderId     ->  passed through PushData, used by onData / vibration
```

`drawRich` only uses the server `largeIcon` when it matches `^https?://`, otherwise it falls back to the bundled native drawable:

```ts
const largeIcon = (data.largeIcon && /^https?:\/\//.test(data.largeIcon)) ? data.largeIcon : LARGE_ICON_RESOURCE;
```

`NOTIFICATION_LOGO_URL` is derived from `SITE_ORIGIN` (default `https://.../notification-logo.png`), so it always passes that test and the colour logo resolves. No key mismatch exists on any field — the colour icon and tap link both resolve.

### Verification evidence

The commit message records `npx tsc --noEmit in 4astore-v2/api-node -> exit 0, no errors`. Per instructions this was read rather than re-run. The change is server-side only and takes effect on the next backend deploy; no new APK is required, which is consistent with no mobile file being modified.

</details>

<details>
<summary>File map</summary>

- `4astore-v2/api-node/src/services/push.ts` — adds `dataOnlyPayload` + `buildMessage`; both `sendToTopic` and `sendToTokens` now default to the data-only payload and keep the reliable path on `notificationTypeMessage`.

Full diff: `git show 6da1f5db -- 4astore-v2/api-node/src/services/push.ts`

</details>
