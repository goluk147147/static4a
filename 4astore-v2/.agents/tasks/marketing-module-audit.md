# Marketing Module — Audit & Build Plan (Option A: semi-auto, FREE WhatsApp)

**Scope:** New "Marketing" admin tab in the 4A Store v2 web admin (`web/`), with one small
customer-reach API endpoint added to `api-node/`. **No paid WhatsApp Business API.** Everything
is manual click-to-share via `wa.me` / `web.whatsapp.com` links the owner sends from their own
phone. **No mobile app rebuild** — web admin + api only, server-deploy only.

Repo audited: `c:\xampp\htdocs\static4a\4astore-v2` (web + api-node). Legacy `4AStoreApp` / old PHP ignored.

---

## 1) Summary answer (what we build)

A single **Marketing** tab registered exactly like the existing `AdminNotify` ("Push Notifications")
tab — same `ADMIN_TABS` entry, same `App.tsx` nested route, same `canAdmin(..., 'ads')` gating. Inside
it, a sub-tab UI (local `useState`, no new routes needed) with four sections:

1. **Customer Reach List** — dedupe-by-mobile list of real customers (name, mobile, orders, spent,
   last-order date) with per-row "Copy number" and "WhatsApp" (`wa.me/<91number>`) buttons + filters.
2. **Promo Composer** — bilingual Hindi/English message box + quick templates + optional product/
   category/store deep link, with a one-click group share (`wa.me/?text=…` / `web.whatsapp.com`).
3. **Broadcast Helper** — pick message + segment, render one `wa.me/<number>?text=…` link per
   customer so the owner taps-send in batches (clearly labelled MANUAL / free).
4. **Shareable Promo Links** — ready-to-copy links to a product/category/store that preview richly,
   reusing the existing OG share routes.
5. *(Optional, note only)* referral/coupon idea — **not supported by the current schema** (see §2).

The reach data needs **one new read-only endpoint** `GET /api/admin/marketing/reach` because no
existing endpoint merges orders + users and dedupes by mobile. Everything else reuses code that
already exists.

---

## 2) What already exists that we reuse (evidence)

### Admin tab registration pattern (copy this exactly)
- **Tab list:** `web/src/pages/admin/AdminApp.tsx` — `ADMIN_TABS` array (lines ~19–33). Each entry is
  `{ path, key, icon, label, title }`. The sidebar renders only tabs the user is allowed:
  `ADMIN_TABS.filter((t) => canAdmin(user?.role, user?.permissions, t.key))` (line ~219). The active
  tab's content gates again on `canAdmin(..., current.key)` → otherwise "You do not have permission"
  (lines ~162, ~262). **`AdminNotify` uses `key: 'ads'`** (line ~32) — Marketing should do the same so
  the owner's existing "Ads & Social" permission already grants it.
- **Route registration:** `web/src/App.tsx` — nested routes under `<Route path="/admin" element={<AdminApp/>}>`
  (lines ~60–78). `notify` → `<AdminNotify/>` (line ~75) is the template to copy.
- **Permission helper (web):** `web/src/pages/admin/adminData.ts` — `canAdmin(role, permissions, perm)`
  (bottom of file): `owner`/`superadmin` → always true; `admin` → `permissions` includes `'*'` or the key.

### Permission gating (server)
- `api-node/src/auth/middleware.ts` — `requireAuth`, `requireStaff(permission)` (checks staff role +
  `hasPermission`), `hasPermission(user, perm)` (owner/superadmin always; admin needs `'*'` or the key),
  `requireOwner`. The new endpoint should use `requireAuth, requireStaff('ads')` to match AdminNotify's
  gate (push send is staff + "ads").

### Customer data sources (two, must be merged + deduped)
- **Users list:** `GET /api/admin/users` → `api-node/src/routes/admin.ts` `router.get('/users', requireAuth,
  requireStaff('users'), …)` (the "Users tab" section). Returns every user row minus `password`:
  `id, name, mobile, username, role, permissions, custom_delivery, registered_at, last_login`
  (shape typed in `web/src/pages/admin/adminData.ts` as `AdminUserRow`). Web hook: `useAdminUsers()`
  (same file) + `fetchUsers()` in `web/src/lib/admin.ts`.
- **Orders:** `GET /api/orders` → `api-node/src/routes/orders.ts` `router.get('/', requireAuth, …)` —
  staff see all orders. Each order carries a JSON `customer` object `{ name, mobile, city, pincode, … }`
  (see order create, `customer: c`, and admin create `customer: { name, mobile, …, pincode:'824301' }`
  in `admin.ts`). Web type `AdminOrderFull` + hook `useAdminOrders()` in `adminData.ts`.
- **Existing per-mobile aggregation to copy:** `web/src/pages/admin/AdminUsers.tsx` already builds a
  `Map<mobile, { count, spent }>` from `orders` (the `stats` `useMemo`) and shows Orders/Spent per user.
  The reach list reuses this exact idea, adding **last-order date** and **dedupe by mobile**.
- **Google placeholder mobiles (must be hidden/flagged):** created in
  `api-node/src/routes/users.ts` `createGoogleUser()` — mobile is `('g' + sub digits)` and can never
  match the real-mobile regex `^[6-9]\d{9}$/`. So **"real WhatsApp number" = `/^[6-9]\d{9}$/`**; filter
  out anything starting with `g` or failing that regex. This same regex is used throughout
  (`register`, `assignRole`, `updateUser`, order `customer.mobile`).

### Working `wa.me` share pattern (already in web — copy verbatim)
- `web/src/pages/checkout/OrderSuccess.tsx` `sendOrderWhatsApp()`:
  - builds the message, `encodeURIComponent(msg)`,
  - normalizes the number: `digits = number.replace(/\D/g,'')`, then `digits.length === 10 ? '91'+digits : digits`,
  - **mobile UA** → `window.location.href = https://wa.me/<storeNumber>?text=<encoded>`,
  - **desktop UA** → `window.open('https://web.whatsapp.com/send?phone=<storeNumber>&text=<encoded>')`.
  This is the canonical helper to extract into a tiny `web/src/lib/whatsapp.ts` and reuse everywhere.
- **No reusable `wa.me` helper exists today** — it is inlined only in `OrderSuccess.tsx`. (The mobile
  app's old `openWhatsApp` is not present in current `mobile/src`; grep found only WhatsApp *display*
  strings in `api-node/src/video/*` and a `whatsapp` theme colour. Nothing to reuse from mobile.)

**Correct `wa.me` URL formats (documented for the implementer):**
- Specific customer, prefilled text: `https://wa.me/91XXXXXXXXXX?text=<URL-encoded>` (country code `91`, no `+`, no spaces).
- Group / no fixed recipient (owner picks chat in WhatsApp): `https://wa.me/?text=<URL-encoded>`
  (desktop fallback: `https://web.whatsapp.com/send?text=<URL-encoded>`).
- Store's own number from Settings: `store_phone` (admin.ts settings) / SEO `social.whatsapp` — default
  `8210874123` (as hard-coded fallback in `OrderSuccess.tsx`).

### OG share / rich link previews (reuse, do not rebuild)
- `api-node/src/routes/og.ts` serves crawler share HTML with OG/Twitter meta + 1200×630 image:
  - `GET /api/og/product/:id`, `GET /api/og/category/:slug`, `GET /api/og/page/:slug` (+ matching
    `/image/...` routes). All redirect humans to the SPA canonical URL.
- Public origins: `api-node/src/seo/origin.ts` — `SITE_ORIGIN` (default `https://4astore.com`) and
  `API_ORIGIN` (`<site>/api`). **Shareable links should point at the SPA canonical** (e.g.
  `https://4astore.com/product/:id`) — WhatsApp's crawler hits it, nginx rewrites crawler UAs to the
  `/api/og/...` route (see comment at top of `og.ts` + `OG-SETUP.md`), so the preview "just works".
  The Marketing UI only needs to build `${SITE_ORIGIN}/product/:id` etc. — no new OG code.

### Product / category pickers to mirror
- **Product picker:** `AdminNotify.tsx` `ComposeForm` uses `useProducts()` (from `web/src/lib/queries`)
  to populate a `<select>`, and on pick sets `link = /product/<id>` and auto-fills the image. The
  Promo Composer copies this to attach a product deep link.
- **Categories:** `useCategories`/`useProducts` live in `web/src/lib/queries` (used across admin). Use the
  same hooks for the category deep-link picker.
- **Push broadcast reference (segments + compose UX):** `AdminNotify.tsx` + `sendBroadcast()` in
  `web/src/lib/admin.ts` (`POST /api/push/send`). The Marketing composer imitates its layout
  (segment select, bilingual templates, live preview) but produces `wa.me` links instead of calling push.

---

## 3) What's missing (must be added)

1. **A merged, deduped customer-reach endpoint.** No endpoint today returns one row per *mobile* across
   both `users` and `orders` with order count / spent / last-order date. `/api/admin/users` is users-only
   (misses guests who ordered without an account) and `/api/orders` is raw orders (not deduped). → add
   `GET /api/admin/marketing/reach`.
2. **A reusable `wa.me` helper** — the logic exists only inline in `OrderSuccess.tsx`. → extract to
   `web/src/lib/whatsapp.ts`.
3. **The Marketing page + tab/route wiring** — none exists.
4. **Coupon/referral support — NOT in schema.** Order create hard-codes `discount: 0` (both customer and
   admin create in `orders.ts` / `admin.ts`); there is no coupon table, no discount-code field, no
   referral column anywhere in the routes read. So §5 stays a **note only** — building real coupons would
   need a schema migration + checkout changes, out of scope for a FREE/manual marketing tab.

---

## 4) Concrete, minimal build plan

Ordered by dependency. Each item leaves the tree buildable. **No test framework is configured** in either
`web/package.json` or `api-node/package.json` (no vitest/jest), so verification = TypeScript compile +
Vite build for web, `tsc` build for api. Commands below are the project's real ones.

### Item 1 — Reusable WhatsApp link helper (web)
- **Do:** Create `web/src/lib/whatsapp.ts` exporting:
  `normalizeWa(num: string): string` (strip non-digits, prefix `91` when 10 digits),
  `waLink(number: string | null, text: string): string` (number → `https://wa.me/91…?text=…`;
  empty number → `https://wa.me/?text=…`), and `openWhatsApp(number, text)` that mirrors
  `OrderSuccess.tsx` (mobile `wa.me`, desktop `web.whatsapp.com/send`). All text `encodeURIComponent`-d.
- **Files:** `web/src/lib/whatsapp.ts` (new). Optionally refactor `OrderSuccess.tsx` to call it (not required).
- **Verify:** `cd web && npx tsc -b` — typechecks clean.

### Item 2 — Customer-reach API endpoint (api-node)
- **Do:** Add `GET /api/admin/marketing/reach` gated `requireAuth, requireStaff('ads')`. Query `users`
  (role `customer`, exclude staff/rider) and all `orders`; build a `Map` keyed by **real mobile**
  (`/^[6-9]\d{9}$/` only — drop `g…` Google placeholders). For each mobile return
  `{ name, mobile, orders, spent, lastOrderAt, source: 'account'|'guest'|'both' }`. Prefer the account
  name when present, else the latest order's `customer.name`. Return `{ reach: [...] }`.
  Register it **before** the generic `app.use('/api/admin', adminRouter)` line OR add it inside
  `admin.ts` next to `GET /users` (simplest — reuses the same router + Prisma import).
- **Files:** `api-node/src/routes/admin.ts` (add route near the existing `router.get('/users', …)`).
  No new mount needed (the path lives under the already-mounted `/api/admin` router).
- **Verify:** `cd api-node && npm run build` (`tsc -p tsconfig.json`) — compiles clean. Manual smoke
  (optional, non-destructive): `GET /api/admin/marketing/reach` with a staff cookie returns deduped rows.

### Item 3 — Web API client + types for reach
- **Do:** In `web/src/lib/admin.ts` add `export interface ReachCustomer { name; mobile; orders; spent;
  lastOrderAt: string | null; source }` and `export async function fetchReach(): Promise<ReachCustomer[]>`
  → `(await api.get('/admin/marketing/reach')).data.reach`. (Follows the existing `fetchUsers` /
  `fetchAdminStats` pattern in the same file.)
- **Files:** `web/src/lib/admin.ts`.
- **Verify:** `cd web && npx tsc -b` — typechecks.

### Item 4 — Marketing page with four sub-sections (web)
- **Do:** Create `web/src/pages/admin/AdminMarketing.tsx` as the tab's single component with an internal
  sub-tab `useState<'reach'|'composer'|'broadcast'|'links'>`:
  - **Reach:** `useQuery`/`fetchReach()`; table of name/mobile/orders/spent/last-order; filters
    (ordered-in-last-N-days using `lastOrderAt`; text search on name/mobile; area via order `city`/
    pincode `824301`); per-row **Copy** (`navigator.clipboard`) + **WhatsApp** (`openWhatsApp` from Item 1).
  - **Composer:** bilingual textarea + quick templates (`'Aaj ka offer'`, `'New products'`,
    `'Free delivery today'`), optional product/category picker (reuse `useProducts`/`useCategories` from
    `web/src/lib/queries`, mirror `AdminNotify` `pickProduct`) appending `${SITE_ORIGIN}/product/<id>`,
    and a **Share on WhatsApp** button → `waLink(null, text)` (group share). Reuse `EmojiPicker`.
  - **Broadcast:** segment select (reuse AdminNotify's `all/customers/riders/admins` idea, but driven by
    the reach list) + the composed message → render a scrollable list of `waLink(mobile, text)` anchors,
    one per customer, with a prominent "यह manual भेजना है / this is manual, FREE — WhatsApp opens, you tap Send" note.
  - **Links:** build+copy `${SITE_ORIGIN}/product/:id`, `/category/:slug`, and store root with a prefilled
    caption; show that WhatsApp preview is handled by existing OG. Read `SITE_ORIGIN` on the web side from
    `window.location.origin` (prod serves SPA + API same host) or a small constant.
- **Files:** `web/src/pages/admin/AdminMarketing.tsx` (new). Optional: a tiny shared constant for the site
  origin if not using `window.location.origin`.
- **Verify:** `cd web && npm run build` — Vite build succeeds; load `/admin/marketing` in the dev server
  and confirm the four sub-sections render and WhatsApp buttons open the correct `wa.me` URL.

### Item 5 — Register the tab + route (web)
- **Do:** Add to `ADMIN_TABS` in `web/src/pages/admin/AdminApp.tsx`:
  `{ path: 'marketing', key: 'ads', icon: '📣', label: 'Marketing', title: '📣 Marketing (WhatsApp)' }`
  (place near the `notify` entry). Add the route in `web/src/App.tsx`:
  `<Route path="marketing" element={<AdminMarketing />} />` + the import. `key: 'ads'` reuses the
  owner/ads permission exactly like AdminNotify, so no new permission key is needed in `ALLOWED_PERMS`
  (`admin.ts`) or `PERMISSION_OPTIONS` (`web/src/lib/admin.ts`).
- **Files:** `web/src/pages/admin/AdminApp.tsx`, `web/src/App.tsx`.
- **Verify:** `cd web && npm run build`; sign in as owner, confirm the "📣 Marketing" tab appears, is
  permission-gated, and renders `AdminMarketing`.

### Item 6 — Final build gate (both packages)
- **Do:** Full typecheck + build of both packages.
- **Verify:** `cd web && npm run build` **and** `cd api-node && npm run build` both succeed with no TS
  errors. (Deployment is server-only via the existing `deploy.sh`; no app store release.)

---

## 5) Deployment & constraints notes

- **Web-admin + api only.** Item 2 is the sole API change; items 1,3,4,5 are web. **No `mobile/` changes,
  no app rebuild/release.** Ship by building `web` + `api-node` and deploying to the server (existing
  `deploy.sh`), which the owner confirmed is live in production — so keep changes additive and read-only
  on the server side (the new endpoint only reads `users`/`orders`).
- **FREE / manual by design.** Every "send" is a `wa.me` / `web.whatsapp.com` click that opens WhatsApp
  with text prefilled; the owner taps Send from their own phone. **This is explicitly NOT the paid
  WhatsApp Business/Cloud API** — no outbound messaging from the server, no message templates approval, no
  per-message cost. The Broadcast section must say so in the UI.
- **Targeting the 824301 area:** admin-created orders default `pincode: '824301'` and orders carry
  `customer.city`; use these for the area filter. Real reach is limited to customers who have a valid
  10-digit mobile (`/^[6-9]\d{9}$/`); Google-only accounts (`g…` mobile) are shown greyed/hidden with a
  "no WhatsApp number" note.

---

## 6) Decisions made (one-line rationale)

- **Sub-tabs via local state, not new routes** — the four sections are one cohesive tool; a single page
  with `useState` sub-tabs matches `AdminNotify`'s list/compose toggle and avoids touching routing beyond
  one tab. (Chosen over four separate `/admin/marketing/*` routes, which add nav complexity for no gain.)
- **Gate on `key: 'ads'`** — reuses the owner's existing "Ads & Social" permission like AdminNotify, so no
  new permission needs seeding in `ALLOWED_PERMS`/`PERMISSION_OPTIONS`. (Chosen over a new `marketing`
  permission key, which would require DB/permission updates for existing admins.)
- **One new endpoint, placed in `admin.ts`** — reuses the mounted `/api/admin` router + Prisma + `requireStaff`;
  avoids a new router file and `server.ts` mount ordering risk. (Chosen over a standalone router.)
- **Reach dedupe by real-mobile regex** — `/^[6-9]\d{9}$/` is already the app-wide definition of a valid
  mobile and automatically excludes `g…` Google placeholders, so it doubles as the "has a real WhatsApp
  number" test.
- **Coupon/referral deferred to a note** — the schema has no discount/coupon/referral fields (`discount`
  is hard-coded `0`); real support needs a migration + checkout work, out of scope for a free/manual tool.
```
