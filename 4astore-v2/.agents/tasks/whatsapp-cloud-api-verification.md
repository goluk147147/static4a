# WhatsApp Cloud API (Meta) — LIVE integration: verification note

This turns the dormant WhatsApp prep layer into a REAL, SERVER-SIDE Meta Cloud
API integration that sends marketing/promotional TEMPLATE messages (image
header + dynamic text body) — including to customers who never saved the store
number (that is what approved templates allow). Purely additive: the free wa.me
manual share flow is untouched and remains the default manual path.

## Service API

`api-node/src/services/whatsappFormat.ts` (pure, DB-free, network-free — so the
Node test runner imports it without pulling in prisma/Express):

- `sanitizeMsisdn(input: string): string` — strips all non-digits; a 10-digit
  number starting 6-9 → prefixed `91`; a 12-digit number starting `91` → kept
  as-is; anything else → `''` (caller skips/logs).
- `buildImageTextComponents({ imageUrl?, bodyParams? }): unknown[]` — returns the
  Meta `components` array: an image `header` only when `imageUrl` is non-empty,
  and a `body` with one `{type:'text',text}` per param only when `bodyParams` is
  a non-empty array. Text-only or body-less templates still produce valid output.

`api-node/src/services/whatsappCloud.ts` (live, reads DB) re-exports the two pure
helpers and adds:

- `sendWhatsAppTemplateMessage({ recipientPhone, templateName, languageCode, components }): Promise<SendResult>`
  - Reads config FRESH from `settings.whatsapp_api` on every call (no module-global
    cache) via an internal tolerant JSON parse mirroring admin.ts GET /settings.
  - If `provider !== 'cloud_api'` OR `enabled` is false OR token/phoneNumberId
    missing → resolves `{ ok:false, error:'WhatsApp Cloud API not configured' }`.
  - Sanitizes the recipient; invalid → `{ ok:false, error:'Invalid mobile number' }`.
  - POSTs to `${baseUrl || 'https://graph.facebook.com/v20.0'}/${phoneNumberId}/messages`
    with `Authorization: Bearer <token>` + `Content-Type: application/json` and body
    `{ messaging_product:'whatsapp', to, type:'template', template:{ name, language:{ code }, components } }`
    using the global `fetch` (Node 18+, zero new deps).
  - Parses Meta JSON: success → `{ ok:true, messageId: messages[0].id }`; error →
    `{ ok:false, error: error.message, code: error.code }` and `console.error('[whatsapp] …')`.
    Reference codes noted in comments: `#132001` template mismatch, `#190` invalid
    token, `#80007`/`#131048` rate limit.
  - NEVER throws — network/parse failures resolve as `{ ok:false, error }`.

## Endpoints (staff-gated, mounted on the existing marketing router)

Both live under `/api/admin/marketing` which is already
`requireAuth + requireStaff('ads')` — no new auth wiring.

- `POST /whatsapp/test` `{ recipientPhone, templateName, languageCode, imageUrl?, bodyParams? }`
  — builds components, sends ONE template message, returns `ok({ result })` or
  `fail(res, "<error> (code <n>)", 400)`.
- `POST /whatsapp/broadcast` `{ templateName, languageCode, imageUrl?, bodyParams?, recipients[], delayMs? }`
  — **rate-limited / batched**: batch capped at **500** (over → HTTP 422);
  recipients iterated **sequentially**; each number is `sanitizeMsisdn`-validated
  (invalid → recorded `{ ok:false, error:'Invalid number' }`, no network call); a
  `delayMs` sleep (**default 1000ms**, range 0–10000) runs **between network sends
  only** (not after the last, not after skipped invalids). Returns
  `{ total, sent, failed, results:[{ mobile, ok, error? }] }`.

Campaign recording was intentionally NOT wired into the send (kept non-blocking
per the plan); the existing campaign mechanism is unchanged.

## GET /whatsapp/templates — SKIPPED

Not implemented (out of scope per the plan). The admin types the approved
template name directly. `wabaId` is stored for reference / future template
listing but no Meta Graph template-list proxy was built.

## How the token stays server-side

- The token lives only inside the admin-only `settings.whatsapp_api` JSON blob.
- It is NEVER added to the public `GET /api/settings` payload (unchanged — it was
  never there). The admin GET `/api/admin/settings` still returns it only to
  authenticated staff, and the UI masks it (shows only the last 4, never renders
  the raw value back; a new token is sent only when the admin types one).
- The send calls (`/whatsapp/test`, `/whatsapp/broadcast`) carry NO token — the
  Node backend reads it from the DB per batch. The browser never transmits it on
  a send.

## Settings fields added

Added `wabaId` (optional string) to BOTH the zod schema and the GET `/settings`
parse defaults in `api-node/src/routes/admin.ts`. All WhatsApp fields remain
optional and tolerant; existing persisted configs keep working (missing fields
fall back to OFF defaults). The POST persist path (`whatsapp_api=COALESCE(...)`
with `JSON.stringify`) needed no change — `wabaId` flows through automatically.
No new DB column (it lives inside the existing `whatsapp_api` TEXT blob), so no
prisma migrate and no change to `ensureWhatsappApiColumn()`.

Frontend `WhatsappApiConfig` (`web/src/lib/admin.ts`) gained optional `wabaId?`.

## Frontend

- `web/src/pages/admin/marketing/AutoSendComingSoon.tsx` relabelled to
  "WhatsApp API (Cloud API — LIVE)" with bilingual Hindi(romanized)+English copy
  and the existing inline-style design system. Adds a `wabaId` field, a working
  **Send test** card (recipient, template, language, optional image URL, body
  params → `POST /whatsapp/test`, Meta result/error shown inline), and a
  **Send WhatsApp campaign (paid API)** section that reuses the existing reach
  list (`fetchReach`) with search + select-all/clear → `POST /whatsapp/broadcast`,
  rendering total/sent/failed + per-recipient errors. Token stays masked and is
  never sent on a send call. A clear note states templates must be pre-approved
  in Meta and the image must be a public https URL.
- `web/src/lib/admin.ts` added `sendWhatsAppTest` and `sendWhatsAppBroadcast`
  typed client functions.
- The free wa.me Broadcast Helper and all existing marketing tabs are untouched.
- `web/src/lib/waSender.ts` left dormant (not deleted) — now simply unused.

## Build / test results (actually run)

- `cd 4astore-v2/api-node && npm run build` → tsc exit 0 (clean).
- `cd 4astore-v2/api-node && npm test` → 58 tests pass, 0 fail (includes the new
  `whatsappFormat.test.ts`: sanitizeMsisdn + buildImageTextComponents cases). No
  network was hit — only the payload SHAPE is pinned via the pure builder.
- `cd 4astore-v2/web && npm run build` → sitemap + `tsc -b` + `vite build` all
  succeed, 0 TS errors (pre-existing chunk-size >500kB warning only).

---

## ⚠️ WHERE TO PASTE META CREDENTIALS (for the 4A Store founder)

Open the admin panel → **Marketing Center → 🤖 Auto-send / WhatsApp API** tab.
In the **WhatsApp API settings** card fill:

1. **Provider** → select **WhatsApp Cloud API (Meta)**.
2. **Base URL** → `https://graph.facebook.com/v20.0` (leave blank to use this default).
3. **Phone number ID** → from Meta → WhatsApp → API Setup (the "Phone number ID",
   NOT the phone number itself).
4. **Access token** → your Meta Cloud API access token (use a permanent/system-user
   token for production; a temporary token expires in ~24h). It is stored on the
   SERVER and shown masked — it never leaves the backend on a send.
5. **WABA ID** (optional) → your WhatsApp Business Account id, for reference.
6. **Enabled** → turn **ON**.
7. Click **💾 Save config**.

Before sending you MUST:

- Create a **MARKETING** message template in Meta Business Manager and get it
  **APPROVED**, with an **IMAGE header** and a **body using `{{1}}`, `{{2}}`…**
  variables. Use that template's **exact name** and **language code** (e.g. `en`)
  in the Send test / campaign forms.
- Host the header image at a **public https URL** that Meta can fetch (e.g. a
  product/banner image on your site). Paste that URL in the Image URL field.

Then use **🧪 Send test** to send to one number, and **📣 Send WhatsApp campaign**
to broadcast to selected customers from the reach list.

Account notes:

- Meta requires a **verified business**. The free tier allows roughly **1000
  conversations/month**, then it is **paid** per conversation.
- **GST is not strictly required**, but Meta may request **business verification**.
- The free wa.me manual share (other Marketing tabs) stays available and free; this
  Cloud API path is the ADDITIONAL paid option for automated template sends.
