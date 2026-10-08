# 4A Store v2 — Login / Checkout / Address / Pages / Invoice / Google-mobile Audit

Read-only investigation of six user-reported issues in the **main tree only**
(`c:\xampp\htdocs\static4a\4astore-v2`). No source files were modified. The
Notifee rich-push worktree (`.worktrees/notifee-rich-push`) and all notification
code were left untouched, as instructed. Legacy `4AStoreApp` / PHP `/api` / root
`*.html` were ignored.

Scope read: `mobile/app/{login,checkout}.tsx`, `mobile/app/(tabs)/orders.tsx`,
`mobile/app/page/[slug].tsx`, `mobile/app/_layout.tsx`,
`mobile/src/{store/auth.ts,store/addresses.ts,queries.ts,types.ts,invoice.ts}`,
`api-node/src/routes/{users.ts,addresses.ts,orders.ts,pages.ts,otp.ts}`,
`api-node/prisma/schema.prisma`, `api-node/PERF-FINDINGS.md`.

---

## Summary (answer first)

| # | Issue | Root cause (one line) | Fix side | Rebuild? |
|---|-------|----------------------|----------|----------|
| 1 | Login should accept **email** | `POST /users/login` matches only `username` OR `mobile`, never `email`/`recovery_email` | **Server** (1 line) + optional mobile label | Server deploy; mobile only for the label |
| 2 | Checkout re-asks for **email** | Email **is** prefilled from `user.recovery_email \|\| user.email` and is **not required** — the real gap is only when the user has no email on file; no bug blocks checkout | Mostly already OK; minor mobile polish | Mobile (optional) |
| 3 | **Saved address not showing** (HIGH) | Addresses persist to the `addresses` table correctly, but the local cache + server list are keyed by **`user.id`**, and a Google login mints a *new* user row (new id) each time the email isn't matched — plus a normal mobile-login user's address only saves if they press **"Save Address"** in the editor; `proceed()` never persists | Mobile + depends on Issue 1/6 fixes | Mobile |
| 4 | **Static pages load slowly** | `GET /api/pages/:slug` has **no `Cache-Control`/ETag** (unlike products/catalog), so every open re-hits the DB over the slow EC2 connection; WebView + per-slug cache already mitigate repeat opens | **Server** (headers) | Server deploy |
| 5 | **Invoice not professional / wants 4A watermark** | `invoice.ts` builds HTML → `expo-print`; it has a clean layout but **no watermark** and a plain header | **Mobile** (edit `invoice.ts` HTML/CSS) | Mobile |
| 6 | **Google user has no real mobile** | `/social-login` writes a **placeholder** mobile `g<digits>` (schema makes `mobile` `@unique NOT NULL`), so the profile mobile is unusable; no gate asks for a real one; no endpoint exists to set it | **Server** (new endpoint) + **Mobile** (gate screen) | Mobile + server deploy |

Priority order as requested: **Issue 3** and **Issue 2** are addressed first below,
then 1, 4, 5, 6.

---

## ISSUE 3 — Saved address not showing (HIGH)

**Reported symptom:** "save mera address hai" — but every checkout asks for a new
address; the saved-address list never appears.

**How the flow actually works (evidence):**

- Checkout loads addresses on mount, local-first then server:
  `mobile/app/checkout.tsx:72-95` — `loadLocal(userId)` → `syncFromServer(userId)`
  → `flushPending(userId)`. The key is **`user.id`** (`const userId = user.id;`
  at `checkout.tsx:74`).
- Local cache key: `mobile/src/store/addresses.ts:24` —
  `` `4astore:addresses:v1:${userId}` `` (keyed by the numeric user id).
- Server list: `api-node/src/routes/addresses.ts:15-19` —
  `SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC`,
  with `userId = req.user!.sub` (`addresses.ts:23`). So GET is correctly scoped
  by **`user_id`**, not by mobile. (Not the `user_id`-vs-`mobile` filter bug the
  brief hypothesised — that part is fine.)
- Save path: `checkout.tsx:116-162` (`saveFromEditor`) writes the row locally
  (`upsertLocal`) **and** `api.post('/addresses', …)` in the background
  (`checkout.tsx:150`). The POST handler inserts into the `addresses` table
  (`addresses.ts:80-90`) scoped by `userId`. So addresses **do** persist to the
  server table — they are NOT stored only inside the order's
  `delivery_address` JSON.

**Root causes (two distinct breaks):**

1. **Addresses are only persisted when the user explicitly taps "Save Address"
   in the editor modal.** `proceed()` (the "Proceed to UPI Payment" path) does
   **not** call any save/upsert — see the explicit comment at
   `checkout.tsx:230-231`: it only `setCustomer(c); setPayOpen(true)`. A user who
   fills the inline address and taps Proceed (never opening/saving the editor)
   places the order with the address living **only** inside the order's
   `delivery_address`/`customer` JSON (`orders.ts:171-193`), and **nothing is
   written to the `addresses` table**. Next checkout → `listFor(userId)` returns
   `[]` → `else setEditorOpen(true)` (`checkout.tsx:80`) → "fill a new address".
   This is the primary reason "saved address" never shows.

2. **The cache + server list are keyed by `user.id`, and the id is unstable for
   Google users.** `/social-login` matches an existing user by
   `email`/`recovery_email` (`users.ts:246`); if the lookup misses (e.g. the
   earlier manual account used a different email casing, or the Google email
   differs from the stored one) it **creates a brand-new user row** with a new
   `id` (`users.ts:249-252` → `createGoogleUser`). A new id means a new local
   cache key (`addresses.ts:24`) and a different `user_id` server scope — the old
   saved addresses are invisible under the new identity. This compounds with
   Issue 6's placeholder-mobile churn.

**How to confirm:**
- Repro #1: log in with a mobile-number account, go to checkout, fill the inline
  address fields *without* opening the "बदलें / Edit" editor, tap Proceed and
  place an order. Then `SELECT * FROM addresses WHERE user_id = <id>` → **0 rows**,
  while the order's `delivery_address` JSON holds the address.
- Repro #2: open the editor, tap **Save Address**, confirm the toast, then
  `SELECT … FROM addresses WHERE user_id = <id>` → **1 row** and the list now
  shows on the next checkout. This proves persistence works only via the editor.

**Recommended fix (mobile; a server deploy is not required for this issue):**
- In `proceed()` (`checkout.tsx:206-233`), when the address came from the inline
  form and no `selectedId` exists, persist it the same way `saveFromEditor` does
  (optimistic `upsertLocal` + background `api.post('/addresses', …)`) *before/at*
  opening payment — so every placed order also leaves a reusable saved address.
  Reuse the existing `buildCustomer`/payload block from `saveFromEditor`
  (`checkout.tsx:143-162`) to avoid divergence.
- Alternatively (or additionally, server-side, needs a deploy): have the order
  POST upsert the delivery address into the `addresses` table when `user_id` is
  present (`orders.ts:171` already has `user_id`), so the list is populated even
  if the client never calls `/addresses`.
- Fixing Issue 1 + Issue 6 (stable identity: match email on login, stop minting
  duplicate Google users) removes break #2.

---

## ISSUE 2 — Checkout asks for email even though the user set one

**Reported symptom:** if the user already has an email on their profile,
checkout should not ask for it again.

**Evidence:**
- Checkout **does** prefill email from the user profile:
  `mobile/app/checkout.tsx:63-67` —
  `setEmail((v) => v || user.recovery_email || user.email || '')`.
- The server returns both fields on the user object: `safeUser` strips only
  `password` and returns everything else (`users.ts:69-73`), and the `User` type
  carries `email` + `recovery_email` (`mobile/src/types.ts` User interface).
- The checkout email field is **optional** — label `"Email (ईमेल)"` with no `*`
  and no validation (`checkout.tsx` editor Field for email); `proceed()`
  validation (`checkout.tsx:208-221`) checks name/mobile/city/pincode only, never
  email. So email is **not** required and does **not** block checkout.

**Root cause:** There is no bug forcing re-entry. The field is prefilled when the
user has an email and is never required. The user's complaint most likely stems
from **Issue 6 / Google accounts** where the stored value lives in `email`
(Google) vs `recovery_email` (manual signup) — the prefill already handles both,
but a *Google-created duplicate* user (Issue 3 break #2) may be a fresh row with
the email on `email` only, which still prefills. The only genuine gap: if a user
truly has *no* email on file, the field is empty (expected).

**How to confirm:** log in as a user with `recovery_email` set, open checkout —
the Email field shows the stored address (prefilled from
`user.recovery_email`). It is editable and optional; leaving/keeping it never
blocks Proceed.

**Recommended fix:** No functional change required — behaviour already matches
the request. Optional polish (mobile): when `user.recovery_email || user.email`
exists, render the email as read-only/confirmed text instead of an editable
field so the user visibly sees it is "already known" and is not prompted to type
it. No server change, no rebuild strictly needed.

---

## ISSUE 1 — Login should allow EMAIL, not only mobile/username

**Reported symptom:** login only accepts a username/mobile; email-registered (esp.
Google) users have no way to log in with their email.

**Root cause (exact, server-side):**
`api-node/src/routes/users.ts:149-151`:

```ts
const user = await prisma.user.findFirst({
  where: { OR: [{ username: username.toLowerCase() }, { mobile: username }] },
});
```

The identifier is matched against **`username` OR `mobile` only** — never
`email` or `recovery_email`. So a user who registered via Google (whose real
address is in `email`/`recovery_email` and whose `username` is a derived slug
like the email local-part, with a placeholder `mobile` `g<digits>` —
`users.ts:185-205`) cannot log in by typing their email. The login **schema**
comment even says "username OR mobile" (`users.ts:140`).

**The fix pattern already exists in the same file.** `findUserByIdentifier`
(forgot-password) already matches all four:
`api-node/src/routes/users.ts:310-318`:

```ts
OR: [{ username: lower }, { mobile: id }, { email: lower }, { recovery_email: lower }]
```

**How to confirm:** register via Google (creates a user with real `email`, slug
`username`, placeholder `mobile`). On the login screen type the Google email +
password → server returns 404 "Account not found" because neither `username` nor
`mobile` equals the email. Typing the derived `username` works, proving the
identifier gap.

**Recommended fix (server; 1-line, then deploy):**
- Change the login lookup (`users.ts:150`) to reuse the existing
  `findUserByIdentifier(username)` (or inline the same OR including
  `{ email: lower }` and `{ recovery_email: lower }`). This makes login accept
  **username OR mobile OR email**. No DB migration; `email`/`recovery_email`
  columns already exist and are indexed per PERF-FINDINGS.
- Mobile (optional, cosmetic): relabel the field at `mobile/app/login.tsx` login
  branch from `"Username or Mobile"` to `"Username, Mobile or Email"` and set
  `keyboardType="email-address"`. The value is already sent as-is
  (`auth.ts:43` → `username.trim()`), so no logic change is needed — a mobile
  rebuild is only required for the label, not for functionality.

---

## ISSUE 4 — Static pages (Help/Legal/CMS) load slowly

**Reported symptom:** CMS/static pages take a long time to load in the app.

**Evidence:**
- The page screen fetches via React Query: `mobile/app/page/[slug].tsx:31`
  (`usePage(slug)`) → `mobile/src/queries.ts` `usePage` →
  `api.get('/pages/${slug}')` with `retry: false`.
- The screen already has a per-slug local cache (`loadPageCache`/`savePageCache`,
  `[slug].tsx:36-50`) and renders through a **WebView** (`[slug].tsx:77-96`), so a
  previously opened page shows instantly; the slowness is the **first/network**
  fetch.
- Server handler: `api-node/src/routes/pages.ts:41-48` —
  `GET /pages/:slug` runs `SELECT * FROM pages WHERE slug = ? AND published = 1`
  and returns it with **no caching headers**. There is no proxy to WordPress/an
  external site — content comes straight from the local `pages` table.

**Root cause:** `GET /api/pages` and `GET /api/pages/:slug` send **no
`Cache-Control` / `ETag`**, unlike the catalog GETs that PERF-FINDINGS already
fixed (`catalog.ts` sets `public, max-age=30` on `/categories`/`/settings`/etc.,
and products get `max-age=15` with weak ETag → 304). Per PERF-FINDINGS the real
EC2 bottleneck is **connection/network latency per request**, so every
uncached page open pays that cost again. CMS content changes rarely, so it is an
ideal cache candidate; the bottleneck is `pages.ts:28-48` (no headers), not the
query itself.

**How to confirm:** `curl -i https://<api>/api/pages/privacy-policy` → response
has **no** `Cache-Control`/`ETag`. Compare with `curl -i …/api/products` which
returns `Cache-Control: public, max-age=15` + ETag and `304` on `If-None-Match`.

**Recommended fix (server; headers only, then deploy — no mobile rebuild):**
- In `api-node/src/routes/pages.ts`, set `Cache-Control: public, max-age=300`
  (CMS changes rarely) on both the list (`pages.ts:28`) and `:slug`
  (`pages.ts:41`) responses, mirroring the `catalog.ts` pattern from
  PERF-FINDINGS. Express already computes a weak ETag, so conditional requests
  return `304` and skip the DB. Response JSON is byte-identical; only headers
  are added.
- Optional further speed-up (mobile, no rebuild beyond app): prefetch the footer
  pages list (`usePages`) on app launch so taps open from cache; the per-slug
  `savePageCache` already handles warm reopens.

---

## ISSUE 5 — Invoice PDF not professional / wants a diagonal "4A" watermark

**Reported symptom:** the invoice PDF should look professional and carry a
diagonal "4A" watermark.

**Current generation method (evidence):**
- `mobile/src/invoice.ts` builds an **A4 HTML string** (`invoiceHtml`,
  `invoice.ts:11-56`) and renders it to PDF with **`expo-print`**
  (`Print.printToFileAsync({ html, width: 595, height: 842 })`,
  `invoice.ts:60`), then shares via `expo-sharing` (`invoice.ts:61-66`). It is
  **not** jsPDF on mobile — it is HTML → expo-print.
- Invoked from `mobile/app/(tabs)/orders.tsx` — the "📄 Invoice" button calls
  `downloadInvoice(o, settings?.storePhone, settings?.storeAddress)`
  (orders.tsx Invoice button, ~line 82).
- The HTML already has a reasonable layout: blue header band with "4A Store",
  INVOICE block, Bill-To, an items table, totals with a grand-total rule, and a
  footer (`invoice.ts:20-55`). What's missing: **no watermark**, no logo image,
  plain typography.

**Root cause:** purely cosmetic — the invoice HTML/CSS (`invoice.ts:20-56`) has
no watermark layer and a minimal header. This is not a bug; it's a layout
enhancement.

**How to confirm:** open any order → tap "📄 Invoice" → the generated PDF has no
background "4A" mark and a flat header.

**Recommended fix (mobile; edit `invoice.ts` HTML/CSS, then rebuild):**
Add a diagonal repeating "4A" watermark and a cleaner layout entirely within the
`invoiceHtml` template string (`invoice.ts:20-56`). Concretely:

1. **Watermark** — add a fixed, behind-content layer. Either:
   - A single large centered rotated word: a `<div class="wm">4A</div>` with
     ```css
     .wm{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-45deg);
         font-size:160px;font-weight:800;color:rgba(44,111,173,.07);z-index:0;}
     body>*:not(.wm){position:relative;z-index:1;}
     ```
   - Or a **repeating** tiled diagonal "4A" via a CSS `repeating-linear-gradient`
     is not glyph-capable, so for a true repeat use a fixed full-page SVG
     background: a `<div class="wm">` whose `background-image` is an inline
     `data:image/svg+xml` SVG that draws rotated "4A" text tiles (expo-print's
     Chromium renders SVG data URIs). This gives the "diagonal repeating 4A" the
     user asked for.
   Keep opacity low (~0.06–0.08) so table text stays readable; put it before the
   `.head` div and raise real content with `z-index`.
2. **Professional header** — add the store logo next to "4A Store". `expo-print`
   can embed an image via a `data:` URI or an `https:` URL; load the app icon
   (`mobile/assets/images/icon.png`) as base64 at call time, or reference a
   hosted logo URL, and place `<img class="logo">` in the `.head` block
   (`invoice.ts:34`).
3. **Layout polish** — the order details table, Bill-To block, and totals already
   exist (`invoice.ts:44-52`); tighten spacing, add zebra rows
   (`tbody tr:nth-child(even){background:#fafafa}`), and a thin footer rule. Keep
   `@page { size:A4; margin:0 }` so the watermark reaches page edges.

All changes are inside `invoice.ts`; `downloadInvoice`'s expo-print call is
unchanged. **Mobile rebuild required** (bundled JS change). No server/config
change.

---

## ISSUE 6 — Google user has no real mobile (post-login mobile capture + email-OTP)

**Reported symptom:** after Google sign-in the app only has the user's email;
orders/delivery need a mobile. Desired: a one-time prompt to enter a mobile,
verify it via an **email** OTP, and save it to the profile.

**Current state (evidence):**
- A Google login does **not** leave the mobile null/empty — the schema forbids it:
  `api-node/prisma/schema.prisma:17` — `mobile String @unique @db.VarChar(15)`
  (NOT NULL, UNIQUE). So `/social-login`'s `createGoogleUser` fabricates a
  **placeholder** mobile: `mobileBase = ('g' + <google sub digits>).slice(0,15)`
  (`users.ts:189`) and writes `mobile` = that placeholder (`users.ts:195, 205`).
  It is prefixed `g` specifically so it "can never match the `/^[6-9]\d{9}$/`
  register regex" (comment `users.ts:180-182`).
- Consequence: this `g…` placeholder is the **"random mobile number"** the user
  reported in Issue 1 ("mobile no random daal de raha hai login me"). It is not a
  usable phone number.
- Can a Google user still checkout? **Yes, but only by manually typing a mobile.**
  Checkout prefills `mobile` from `user.mobile` (`checkout.tsx:65`) — which would
  be the `g…` placeholder — and then both `saveFromEditor` (`checkout.tsx:117`)
  and `proceed()` (`checkout.tsx:209`) **require** a valid `/^[6-9]\d{9}$/` 10-digit
  number, rejecting the placeholder. So the user is forced to overwrite it every
  time, and the profile mobile stays fake.
- OTP infrastructure that can be reused:
  - `POST /api/otp/send { email }` → generates a 6-digit `EmailOtp`
    (`purpose:'signup'`, 10-min expiry) and emails it (`api-node/src/routes/otp.ts:12-30`).
  - `EmailOtp` model: `schema.prisma:61-68` (`email`, `otp`, `purpose`,
    `expires_at`, `consumed`).
  - A verify-and-persist pattern already exists for recovery email:
    `POST /users/recovery-email/verify` (`users.ts`, verifies an `EmailOtp` with
    `purpose:'recovery'` then updates the user) — a good template.
  - There is **no** generic "update my profile" / `PATCH /users/me` endpoint and
    **no** endpoint that sets `mobile`. The register flow is the only place a real
    mobile is written.
- Where a gate could live: `mobile/app/_layout.tsx` bootstraps the session
  (`bootstrap()` at `_layout.tsx:40-43`) and exposes `useAuth().user`; the home
  tab is `mobile/app/(tabs)/index.tsx`. A gate keyed on
  `user && !/^[6-9]\d{9}$/.test(user.mobile)` (i.e. placeholder detected) is the
  natural trigger — either a redirect from `_layout` once `ready`, or a modal on
  the home screen.

**Root cause / gap:** Google users get an un-dialable placeholder mobile, there is
no UI to collect a real one, and no server endpoint to verify + persist it.

**Recommended implementation:**

*Server (new endpoints, needs a deploy — reuse OTP infra, do NOT reuse
`/otp/send` as-is because it sets `purpose:'signup'`; add a dedicated purpose):*
- `POST /users/mobile/send` (auth-required): body `{ }`; send a 6-digit code to
  the logged-in user's `recovery_email || email`, stored as an `EmailOtp` with a
  new `purpose:'set_mobile'`. Mirror `recovery-email/send` (`users.ts`
  recovery-email block) for structure.
- `POST /users/mobile/verify` (auth-required): body `{ mobile, otp }`; validate
  `mobile` with `/^[6-9]\d{9}$/`, verify the latest unconsumed
  `purpose:'set_mobile'` `EmailOtp` for the user's email, check the mobile is not
  already taken by another user (the column is `@unique`, so a collision would
  throw P2002 — return a friendly 409), then
  `prisma.user.update({ data: { mobile } })`, mark the OTP consumed, and return
  the refreshed `safeUser`. Model on `recovery-email/verify` (`users.ts`).
- Because `mobile` is `@unique`, two Google users would currently both carry
  distinct `g…` placeholders (fine), but setting a real mobile that already
  belongs to a mobile-registered account must be handled (merge is out of scope;
  return "mobile already registered").

*Mobile (gate screen, needs a rebuild):*
- Add a "Complete your profile" screen that collects the 10-digit mobile, calls
  `POST /users/mobile/send`, shows an OTP field, then
  `POST /users/mobile/verify { mobile, otp }`, and on success calls
  `useAuth().reloadSession()` (`auth.ts:97`) so the new mobile is in state.
- Trigger it from `app/_layout.tsx` after `ready` (or from `(tabs)/index.tsx`)
  when `user.mobile` fails `/^[6-9]\d{9}$/` (placeholder detected). Reuse the
  email-OTP UI patterns already in `app/login.tsx` (`sendOtp`/OTP field,
  `login.tsx` register branch).
- This also fixes the Issue 1 "random mobile" complaint for Google users and
  removes Issue 3's duplicate-identity churn once combined with the email-login
  fix.

**Scope:** mobile-only UI + a new server endpoint → **mobile rebuild + server
deploy**. Can largely reuse existing `EmailOtp` + `sendMail`; one new
`purpose:'set_mobile'` value, two small auth-gated routes.

---

## Cross-cutting notes

- **Identity stability is the thread linking Issues 1, 3 and 6.** Making login
  match email (Issue 1) and giving Google users a real mobile (Issue 6) stops the
  app from minting duplicate user rows / unusable placeholders, which is what
  makes saved addresses and the stored email look "lost" (Issue 3 break #2).
- **No change touches notifications or the Notifee worktree.**
- **Deploy summary:** Issues 1 and 4 are server-only (1-line login OR + cache
  headers) → deploy `api-node` per `PERF-FINDINGS.md`/`DEPLOY-AWS.md`, no mobile
  rebuild. Issues 3 and 5 are mobile-only → rebuild. Issue 6 is both. Issue 2
  needs nothing functional.

*Content was rephrased for compliance where external docs were summarized; all
file:line citations are from the main-tree source read during this audit.*
