# Implementation Plan — FCM same-device signup OTP + order item weight/unit everywhere

Two independent changes for the 4A Store project. Backend (api-node) + web (React) only. NO new Android `.aab`, NO Prisma migration, NO new DB table/column (order `items` is a JSON column, so new line fields need no schema change).

Worktree root: `c:\xampp\htdocs\static4a\.worktrees\fcm-signup-and-order-weight\4astore-v2`. All paths below are relative to that root. Use `git -C <root>` for git.

## Verified baseline (ran during exploration)

- `api-node`: `npm run build` (tsc) passes; `npm test` passes (95 tests). NOTE: `prisma generate` cannot reach `binaries.prisma.sh` in this sandbox (TLS/403). The generated Prisma client was copied from the sibling main repo `c:\xampp\htdocs\static4a\4astore-v2\api-node\node_modules\.prisma\client` into the worktree so `tsc` has real `PrismaClient` types. If a coder step hits "Untyped function calls may not accept type arguments" on `prisma.$queryRawUnsafe<...>`, re-copy that `.prisma/client` folder — do NOT run `prisma generate` (it will fail here).
- `web`: `npm run build` (tsc -b && vite build) passes.

## Design decisions (made here, grounded in the code)

- **Task 1 FCM:** `services/otpDelivery.ts` `tryFcm` currently resolves tokens ONLY via `tokensForUser(user.id)`, and a brand-new signup has no user row, so FCM never fires. Decision: accept an OPTIONAL `deviceToken` on `POST /api/otp/send`, thread it to `deliverSignupOtp` and into the FCM attempt, and build the candidate token list as `[deviceToken?] ∪ tokensForUser(user?.id)`, de-duplicated. Rationale: the shipped app already registers a guest FCM token (`POST /api/push/register`, user_id null) and already renders data-only pushes, so delivering to a token the device already owns needs NO app change. Keep WhatsApp-before-FCM order and the admin `otp_channels` policy semantics unchanged.
- **Task 1 web token source:** `web/src` has NO push-token mechanism and NO native WebView→web token bridge (`window.AndroidApp` exists only for `saveBase64File` in `lib/invoice.ts`; it exposes no FCM token). Decision: thread the optional `deviceToken` through the frontend defensively — send it ONLY if a token is readily available (it is not in a plain browser today), never block the OTP request on it, and document that native same-device delivery would need a future app change. The guest-token path + the existing fallback already satisfy "user never stuck". Do NOT invent a bridge.
- **Task 1 WhatsApp wiring:** already COMPLETE and correct — `tryWhatsApp` calls `whatsappCloud.sendWhatsAppTemplateMessage` with the OTP as body `{{1}}`, reads Meta creds from the admin-only `settings.whatsapp_api` blob, and falls through cleanly when `WHATSAPP_OTP_TEMPLATE` is unset or the provider is off. Admin UI is also COMPLETE: `web/src/pages/admin/marketing/AutoSendComingSoon.tsx` has both the WhatsApp API config form AND the OTP-channel selector (`OtpChannelCard`, modes FCM/WhatsApp/Both), wired via `fetchAdminSettings`/`saveAdminSettings`. No new backend/admin wiring is required for Task 1 beyond `deviceToken`. The plan only VERIFIES this (no changes).
- **Task 2 capture:** `weight` is ALREADY captured onto each order line — `web/src/pages/checkout/Checkout.tsx` sends `weight: i.weight ?? ''` in both the pending and confirm POSTs, and `routes/orders.ts` `itemSchema` already has `weight: z.string().optional().default('')`. `unit` (e.g. 'pcs') is NOT captured. Decision: additively capture `unit` too (zod field + Checkout payload) so 'pcs' products get "3 pcs" and weight products get "250g". `items` is a JSON column → no migration. Old orders keep empty weight/unit (expected).
- **Task 2 display label:** add ONE shared defensive helper (new `web/src/lib/orderItemLabel.ts`) that turns a line `{ name, weight?, unit?, quantity }` into a compact label. Rule: prefer non-empty `weight` (e.g. `250g`); else if `unit` is present and not the default `pcs`-noise case show `<qty> <unit>`; when neither is meaningful show just the name — NEVER a blank `()` or `undefined`. Use it in all four display sites so the format is consistent and the empty-order defense lives in one place.

---

- [ ] 1. Thread an optional `deviceToken` through signup OTP delivery so FCM can target the CURRENT device's own (guest) token. In `api-node/src/routes/otp.ts` add `deviceToken: z.string().min(1).max(4096).optional()` to `sendSchema` and pass it into `deliverSignupOtp({ email, mobile, deviceToken })`. In `api-node/src/services/otpDelivery.ts`: add `deviceToken?: string` to `DeliverSignupOtpInput`; change `tryFcm` to accept the candidate token list; build that list in the mobile path as `[deviceToken (if non-empty)] ∪ tokensForUser(user?.id)` de-duplicated (look up the user row once, tolerate no row), call `sendToTokens(tokens, { title/body with OTP, data:{ type:'signup_otp' } })`, treat `sent>0` as delivered, and keep the never-throws → fallback contract. Add a short comment that same-device push is weak verification (code arrives on the same device), is a convenience channel gated by the admin `otp_channels` policy, and the fallback still applies when no token delivers. Keep email-only and mobile-only (no deviceToken) behavior byte-identical, and keep WhatsApp-before-FCM order + policy semantics unchanged.
      Files: api-node/src/routes/otp.ts, api-node/src/services/otpDelivery.ts
      Verify: `npm run build` in api-node (tsc) passes; `npm test` in api-node passes (otpChannelPolicy + existing suites). FCM live delivery to a real device is NOT verifiable here (needs real FCM creds + a registered device) — reasoned-through only.

- [ ] 2. Pass the device push token from the web register-mode OTP request when one is available, defensively. In `web/src/pages/Login.tsx` `sendOtp()`, when the identifier is MOBILE (the `!emailFilled && mobileValid` branch), include `deviceToken` in the `/otp/send` body ONLY if a token is readily obtainable client-side; in a plain browser none exists today, so omit it and rely on the backend fallback. Do NOT block or delay the OTP request on token availability. Add a brief comment that native same-device FCM delivery would require a future app change to expose the device token to the WebView, and that the guest-token path + fallback cover the requirement now.
      Files: web/src/pages/Login.tsx
      Verify: `npm run build` in web passes (tsc -b && vite build). Behavior check (reasoned): with no token the request body is unchanged from today, so email + mobile flows are unaffected.

- [ ] 3. Verify (no code change expected) the WhatsApp OTP wiring and admin UI are complete. Confirm `tryWhatsApp` in otpDelivery.ts passes the OTP as the template body param via `buildImageTextComponents({ bodyParams:[otp] })`, reads creds only from the admin-only `settings.whatsapp_api` blob (never hardcoded), and returns not-delivered when `WHATSAPP_OTP_TEMPLATE` is empty or provider!=cloud_api/disabled. Confirm `AutoSendComingSoon.tsx` renders the WhatsApp API form (provider/baseUrl/token masked/phoneNumberId/wabaId/enabled) and the OTP-channel selector, both saving via `saveAdminSettings`; and that `routes/admin.ts` GET/POST `/settings` persist/return `whatsappApi` + `otpChannels` while the public `GET /api/settings` never exposes them. If and only if a gap is found, fix it minimally following the existing pattern; otherwise record "verified complete, no change".
      Files: (verify only) api-node/src/services/otpDelivery.ts, api-node/src/services/whatsappCloud.ts, api-node/src/routes/admin.ts, web/src/pages/admin/marketing/AutoSendComingSoon.tsx
      Verify: `npm run build` + `npm test` in api-node still pass; `npm run build` in web passes. Live WhatsApp send is NOT verifiable here (needs owner's Meta creds + approved template) — reasoned-through only.

- [ ] 4. Capture each line item's `unit` onto the order (additive; JSON column, no migration). In `api-node/src/routes/orders.ts` add `unit: z.string().optional().default('')` to `itemSchema` (next to `weight`). In `web/src/pages/checkout/Checkout.tsx` add `unit: i.unit ?? ''` to BOTH `items.map(...)` payloads (the pending POST ~line 411 and the confirm POST ~line 435). `weight` is already captured — leave it. This item depends on nothing and leaves the build green on its own.
      Files: api-node/src/routes/orders.ts, web/src/pages/checkout/Checkout.tsx
      Verify: `npm run build` + `npm test` in api-node pass; `npm run build` in web passes.

- [ ] 5. Add a shared, defensive order-item label helper. Create `web/src/lib/orderItemLabel.ts` exporting `orderItemLabel(item: { name: string; weight?: string; unit?: string; quantity?: number }): string` and a companion `orderItemSuffix(...)` (the weight/pack part only, or '' when none). Rule: trimmed non-empty `weight` wins (e.g. `250g`); else a trimmed non-empty `unit` yields `<quantity> <unit>` (e.g. `3 pcs`); else empty. The full label appends the suffix in parentheses to the name ONLY when the suffix is non-empty — never a blank `()` or `undefined`. Add 1 small unit note in a comment; no new test framework exists on web, so correctness is covered by the type-checked build + reuse at call sites.
      Files: web/src/lib/orderItemLabel.ts
      Verify: `npm run build` in web passes (helper is imported by items 6–9).

- [ ] 6. Show weight/unit per line in the customer order view. In `web/src/pages/Orders.tsx` import the helper and render the item name plus the weight/pack suffix (e.g. `Mircha — 250g`, `Jharu 3 pcs`) in the `order.items.map(...)` row (currently `{item.name} × {item.quantity}`). Keep the price column unchanged. Empty weight/unit → name only, no blank parens.
      Files: web/src/pages/Orders.tsx
      Verify: `npm run build` in web passes.

- [ ] 7. Show weight/unit per line in the admin order view. In `web/src/pages/admin/AdminOrders.tsx` `OrderDetail`, use the helper in the `order.items.map(...)` row (currently `{item.name} × {item.quantity}`) so each item shows its weight/pack. `AdminOrderFull extends MyOrder`, whose `items` already carries `weight?`; the helper reads `unit` defensively when present. Keep the amount column unchanged.
      Files: web/src/pages/admin/AdminOrders.tsx
      Verify: `npm run build` in web passes.

- [ ] 8. Include weight/unit in the PDF invoice item cell. In `web/src/lib/invoice.ts`, append the weight/pack suffix to the item name text in the per-item loop (either `name (250g)` or a smaller secondary line), using the same helper logic (reuse `orderItemSuffix`). Keep the existing jsPDF layout, ASCII-only output (`Rs. `, no ₹/Devanagari), and the `splitTextToSize` row-height handling. Old orders with empty weight → name only.
      Files: web/src/lib/invoice.ts
      Verify: `npm run build` in web passes. The rendered PDF layout is reasoned-through (no headless PDF rendering here).

- [ ] 9. Include weight/unit in the WhatsApp order message. In `web/src/pages/checkout/OrderSuccess.tsx` widen `PlacedOrder.items` to `{ name: string; quantity: number; weight?: string; unit?: string }` (the Checkout payload already supplies weight, and item 4 adds unit, so `items: payload.order.items` carries both). In `sendOrderWhatsApp()` build each itemized line as `${i+1}. <label> × <quantity>` using the shared suffix helper (e.g. `Mircha 250g x1`, `Jharu 3 pcs x2`). Empty weight/unit → bare name. Leave the paid server-side WhatsApp template path untouched (there is no server-side order WhatsApp builder — the order WhatsApp text is only this client-side `wa.me` share).
      Files: web/src/pages/checkout/OrderSuccess.tsx
      Verify: `npm run build` in web passes.

- [ ] 10. Final cross-change verification. Run the full api-node build + tests and the web build together and confirm all green; remove any stray temp files. State explicitly which functional checks are reasoned-through and NOT verifiable in this environment: (a) live FCM push to a real device, (b) live WhatsApp Cloud send (both need real creds/devices), (c) the visual PDF/invoice rendering.
      Files: (none — verification only)
      Verify: `cd api-node; npm run build; npm test` all pass; `cd web; npm run build` passes.

## Notes / assumptions

- `unit` default string is `pcs`; the label helper treats a weight string as the primary display and only falls back to `<qty> <unit>` so a plain "pcs" product still reads sensibly (e.g. `3 pcs`). If the owner later wants to suppress a bare `pcs` with no explicit quantity emphasis, that is a one-line tweak in the helper.
- No change to the mobile app, no DB migration, no new column. The WhatsApp/FCM live behavior turns on only once the owner fills the admin WhatsApp config + sets `WHATSAPP_OTP_TEMPLATE`/`WHATSAPP_OTP_TEMPLATE_LANG` (Task 1) — code-side is ready.
