# Implementation Plan — Marketing (WhatsApp) module improvements

Scope: additive polish + a prep-only WhatsApp API integration layer for the admin
Marketing Center. Keep the FREE/manual `wa.me` flow as the only active send path.
Bilingual Hindi (romanized) + English copy and the existing inline-style design
system (`card`, `btnPrimary`, `btnGhost`, `muted`, `cardTitle`, etc. defined at the
bottom of `AdminMarketing.tsx`) are preserved. No new dependencies. Edit the main
working tree at `c:\xampp\htdocs\static4a` directly — NOT a worktree.

## Design decisions (grounded in the code I read)

1. **Nudge is a dedicated banner, NOT the toast store.** `web/src/store/toast.ts`
   `show(message, type)` is fire-and-forget: 3.5s auto-dismiss, no action button, no
   persistence. It cannot carry an action or a per-day "actedOn vs dismissed" state.
   So the daily suggestion is a small dismissible banner component rendered at the top
   of `Dashboard()`, with its own localStorage persistence. Toast stays as-is for the
   existing success/error flashes.

2. **WhatsApp API config persists in a new `settings.whatsapp_api` column via the
   existing admin settings endpoint.** The `settings` table is fixed-column raw SQL
   (no JSON blob exists on it today). The repo's own pattern for additive settings
   fields is an information_schema-guarded `ALTER TABLE settings ADD COLUMN` run at
   boot (`ensureMasterPasswordColumn` in `api-node/src/services/dataImport.ts`, called
   from `server.ts`). I mirror that exactly with one nullable `whatsapp_api` TEXT/JSON
   column holding a small JSON object. It is read/written through the ADMIN settings
   path (`GET`/`POST /api/admin/settings`, `AdminSettings` type + `fetchAdminSettings`
   / `saveAdminSettings` in `web/src/lib/admin.ts`) — NOT the public `useSettings`
   (`GET /api/settings` in `catalog.ts`) which must never leak the token. The config
   UI lives in `AutoSendComingSoon.tsx` and uses `fetchAdminSettings`/`saveAdminSettings`.

3. **StatCard gets an optional `onClick`.** Cards without it stay plain divs (current
   behaviour). With it, the card becomes keyboard-accessible (`role="button"`,
   `tabIndex={0}`, Enter/Space handler, pointer cursor, hover state, `aria-label`).

4. **No web test framework exists** (no vitest/jest, no `web/src/__tests__`).
   Verification for web changes is the project's real typecheck+build:
   `npm run build` (= `tsc -b && vite build`). Do NOT introduce a test runner for this
   additive UI work. The api-node change is verified with `npm run build` (tsc) and
   its existing `npm test`.

## Build / verify commands (discovered)

- Web typecheck + build (primary verification for all frontend items):
  `npm run build` in `c:\xampp\htdocs\static4a\4astore-v2\web`
  (runs `node scripts/generate-sitemap.mjs && tsc -b && vite build`; a clean exit =
  typecheck passed and bundle built).
- Api-node typecheck/build (only for item 5): `npm run build` in
  `c:\xampp\htdocs\static4a\4astore-v2\api-node` (= `tsc -p tsconfig.json`).
- Api-node tests (optional sanity for item 5): `npm test` in `api-node`.

---

## Plan

- [ ] 1. Make `StatCard` optionally clickable (reusable, non-breaking).
      Add an optional `onClick?: () => void` and optional `ariaLabel?: string` to the
      `StatCard` props in `AdminMarketing.tsx`. When `onClick` is present: wrap in
      `role="button"`, `tabIndex={0}`, `cursor: 'pointer'`, a subtle hover (e.g.
      `onMouseEnter`/`Leave` toggling boxShadow/translate, or a CSS class — keep it
      inline-style consistent), `aria-label={ariaLabel ?? label}`, an `onKeyDown` that
      fires `onClick` on `Enter` or `Space` (preventDefault on Space). When `onClick`
      is absent, render exactly as today (plain `div`, no cursor/role). Keep `warn`
      styling untouched. Tap target stays >=40px (card padding already 14).
      Files: `web/src/pages/admin/AdminMarketing.tsx` (StatCard component only).
      Verify: `npm run build` in `web` — compiles with no TS errors.

- [ ] 2. Wire the Dashboard StatCards to their sub-tabs.
      In `Dashboard()`, pass `onClick`/`ariaLabel` to three cards:
      "Upcoming festivals / आने वाले त्योहार" → `onGoto('festivals')`;
      "Discounted products / छूट वाले" → `onGoto('promotions')`;
      "Out of stock / स्टॉक खत्म" → `onGoto('promotions')` (the Product Promotions tab
      already has an "Exclude out-of-stock" filter; no new filtered route is needed —
      landing on `promotions` is the wired target). Leave
      "Selected customers / चुने गए" non-interactive (no `onClick`). `onGoto` is the
      existing `setSub` passed into `Dashboard`; no new prop plumbing required.
      Files: `web/src/pages/admin/AdminMarketing.tsx` (Dashboard component only).
      Verify: `npm run build` in `web` — compiles; manually, clicking/Enter on the
      three cards switches sub-tab (visual check after build).

- [ ] 3. Add the daily "Aaj ke liye sujhaav" nudge banner.
      Create a small, dependency-free component `MarketingSuggestionNudge` (new file
      `web/src/pages/admin/marketing/SuggestionNudge.tsx`) and render it at the very
      top of the `Dashboard()` grid (above the StatCards). Props: the live dashboard
      `recommended` object (`festivalsSoon`, `discountedProducts`, `lowStock`) and the
      `onGoto` callback. Suggestion logic (first match wins), computed from the live
      `fetchMarketingDashboard` data already loaded in `Dashboard()`:
        - `festivalsSoon` has a festival with `festival_date` within 7 days (today ≤
          date ≤ today+7, using the existing `daysUntil` helper exported/shared from
          `AdminMarketing.tsx` — or a local copy) → message
          "🎊 Aaj festival offer bhejein / Promote a festival offer today",
          action label "→ Festivals", action → `onGoto('festivals')`.
        - else if `discountedProducts` non-empty → "🏷️ Aaj apna top discount promote
          karein / Promote your top discount today", action → `onGoto('promotions')`.
        - else if `lowStock` non-empty → "📦 Ye items out of stock hain — restock ya
          customers ko bataayein / Some items are out of stock", action →
          `onGoto('promotions')`.
        - else render nothing.
      Persistence (localStorage, keyed by calendar date):
        - Key: `` `4astore_marketing_suggestion_${YYYY-MM-DD}` `` (local date, not UTC).
        - Stored value: a small JSON `{ state: 'actedOn' | 'dismissed' }`.
        - On mount: if key exists with `state==='actedOn'`, render nothing (done for
          the day). If `state==='dismissed'` OR no key, SHOW the nudge (dismiss only
          hides for this render; re-shows on next visit/reload same day — so write
          `dismissed` is optional/no-op for re-show, but DO store it to keep the
          actedOn-vs-dismissed distinction explicit as required).
        - Action click → set `{ state: 'actedOn' }` for today's key, then call the
          action's `onGoto(...)`; do not show again that day.
        - Plain close (✕) → set `{ state: 'dismissed' }` and hide for this render;
          it re-appears on the next mount/reload that same day.
      Use existing style constants (`card`, `btnGhost`/`btnPrimary`, `muted`); friendly
      bilingual copy; include a tiny ✕ dismiss button. Guard all `localStorage` access
      in try/catch (private-mode safe). No external deps.
      Files: NEW `web/src/pages/admin/marketing/SuggestionNudge.tsx`;
      `web/src/pages/admin/AdminMarketing.tsx` (render it in `Dashboard()`; if reusing
      `daysUntil`, export it or duplicate the tiny helper).
      Verify: `npm run build` in `web` — compiles; manual: with a near festival the
      nudge shows, Action jumps tab + does not reappear after reload same day; ✕
      hides it but it returns on reload.

- [ ] 4. Polish the Dashboard as the "home" (friendly primary CTAs, mobile-friendly).
      At the top of `Dashboard()` (below the nudge, above or alongside the StatCards)
      add a compact primary-action row with 2–3 friendly deep-link buttons reusing
      existing styles: "📣 Aaj ka offer bhejein" → `onGoto('promotions')`,
      "🎊 Festival greeting" → `onGoto('festivals')`, "📤 Naya broadcast" →
      `onGoto('broadcast')`. Use `btnPrimary` for the first and `btnGhost` for the
      rest; wrap with `display:flex; gap:10; flexWrap:'wrap'` so they stack on mobile
      and keep tap targets >=40px (current button padding already yields that). Keep
      the existing "link opened ≠ message sent" disclaimer in the page header intact.
      Do NOT rename tabs, remove the free/manual model, or restructure other sections.
      Files: `web/src/pages/admin/AdminMarketing.tsx` (Dashboard component only).
      Verify: `npm run build` in `web` — compiles; manual: buttons wrap cleanly at
      narrow width and each deep-links to the right sub-tab.

- [ ] 5. Backend: add nullable `settings.whatsapp_api` column + expose it on admin
      settings GET/POST (prep-only storage; never on the public endpoint).
      - In `api-node/src/services/dataImport.ts` add `ensureWhatsappApiColumn()`
        mirroring `ensureMasterPasswordColumn()` exactly: information_schema guard for
        column `whatsapp_api` on table `settings`; if absent
        `ALTER TABLE settings ADD COLUMN whatsapp_api TEXT NULL`; swallow MySQL 1060.
      - In `api-node/src/server.ts` import and call it in the boot seeding block next
        to the other `ensure*` calls (same `.catch(console.error)` style).
      - In `api-node/src/routes/admin.ts`:
        * `settingsSchema` (POST `/settings`): add
          `whatsappApi: z.object({ provider: z.enum(['none','cloud_api','custom']),
          baseUrl: z.string().trim().max(300), token: z.string().max(500),
          phoneNumberId: z.string().trim().max(120), enabled: z.boolean() })
          .partial().optional()`. In the UPDATE, store it as JSON:
          `whatsapp_api=COALESCE(?,whatsapp_api)` with
          `s.whatsappApi ? JSON.stringify(s.whatsappApi) : null`.
        * GET `/settings`: parse and return `whatsappApi` from the row
          (`typeof row.whatsapp_api === 'string' ? JSON.parse(row.whatsapp_api) : null`,
          tolerant of null/absent → default `{ provider:'none', baseUrl:'',
          phoneNumberId:'', enabled:false }`, and MASK/omit nothing here — it's the
          authenticated admin endpoint; the token round-trips to the admin UI which
          masks it on screen). Do NOT add `whatsapp_api` to the public
          `GET /api/settings` in `catalog.ts`.
      Files: `api-node/src/services/dataImport.ts`, `api-node/src/server.ts`,
      `api-node/src/routes/admin.ts`.
      Verify: `npm run build` in `api-node` — tsc passes; `npm test` in `api-node`
      still passes. (Column auto-creates on next boot; no manual migration.)

- [ ] 6. Frontend types + admin settings client for the WhatsApp API config.
      Add a shared type and thread it through the admin settings client:
        - In `web/src/lib/admin.ts`: add
          `export interface WhatsappApiConfig { provider: 'none'|'cloud_api'|'custom';
          baseUrl: string; token: string; phoneNumberId: string; enabled: boolean }`
          and add `whatsappApi?: WhatsappApiConfig` to the `AdminSettings` interface
          (both `fetchAdminSettings` return shape and `saveAdminSettings` partial
          already pass it through since they are typed by `AdminSettings`).
      This is the type contract item 5's endpoint fulfills. No `useSettings`/public
      `Settings` change (token must not reach the public type).
      Files: `web/src/lib/admin.ts`.
      Verify: `npm run build` in `web` — compiles.

- [ ] 7. Create the dormant provider-agnostic sender `waSender.ts`.
      New file `web/src/lib/waSender.ts` exporting:
        - `export type WaMessage = { to: string; text: string };`
        - `export type WaSendResult = { ok: boolean; error?: string; detail?: unknown };`
        - `export async function sendViaApi(msg: WaMessage, cfg: WhatsappApiConfig):
          Promise<WaSendResult>` (import `WhatsappApiConfig` from `./admin`).
      Behaviour: if `!cfg || cfg.provider === 'none' || !cfg.enabled` →
      return `{ ok:false, error:'WhatsApp API not configured yet' }` (do NOT throw so
      callers can branch; a thrown variant is acceptable too but return is cleaner).
      Otherwise, leave EXACTLY ONE clearly-commented `TODO` fetch as the only
      remaining work, with the WhatsApp Cloud API request shape in the comment:
      `POST ` + "`${cfg.baseUrl}/${cfg.phoneNumberId}/messages`" + `, header
      `Authorization: Bearer ${cfg.token}`, JSON body
      `{ messaging_product:'whatsapp', to: msg.to, type:'text', text:{ body: msg.text } }`.
      For now, below the TODO, return
      `{ ok:false, error:'WhatsApp API send not implemented yet' }` so NO network
      request is made. Add a file header comment: this module is dormant; the active
      send path everywhere remains the free `wa.me` flow in `lib/whatsapp.ts`. Do NOT
      call `sendViaApi` from any existing component in this task.
      Files: NEW `web/src/lib/waSender.ts`.
      Verify: `npm run build` in `web` — compiles; no runtime wiring added.

- [ ] 8. Build the "Auto-send / WhatsApp API" settings UI in `AutoSendComingSoon.tsx`.
      Keep the honest scaffold intro, but add a config form below it (keep the file
      name). Use `fetchAdminSettings`/`saveAdminSettings` + the `WhatsappApiConfig`
      type (item 6) with react-query (`useQuery(['admin-settings'], fetchAdminSettings)`
      and a mutation calling `saveAdminSettings({ whatsappApi })`), mirroring the
      pattern in `AdminSettings.tsx`. Form fields (bilingual labels, existing
      `inp`/`lbl`/`btnPrimary`/`card`/`muted` styles — define local copies or import
      shared ones consistent with the file's current local style objects):
        - `provider` select: `none` (default, "Band / Off"), `cloud_api`
          ("WhatsApp Cloud API (Meta)"), `custom`.
        - `baseUrl` text input (placeholder e.g. `https://graph.facebook.com/v21.0`).
        - `token` input rendered as `type="password"` and shown MASKED (e.g. display
          `••••••••` or last-4 only); never render the raw token in plain text.
        - `phoneNumberId` text input ("Phone number ID / Sender ID").
        - `enabled` toggle (checkbox/switch), OFF by default.
        - Save button → persists via `saveAdminSettings`; show existing toast on
          success/error (`showToast`).
        - "Send test (coming soon when API added)" button that is DISABLED (inert)
          while `provider === 'none'` OR `enabled === false`; even when enabled it only
          calls `sendViaApi` which returns the "not implemented yet" result and shows
          that message via toast — NO real network call. Keep the existing
          "link opened ≠ sent" / honest-scaffold copy.
      Rename only the user-facing heading/idea to "Auto-send / WhatsApp API"; the
      SUB_TABS label `🤖 Auto-send / AI (soon)` in `AdminMarketing.tsx` may be updated
      to reflect this (optional, keep bilingual), but keep the `autosend` key and the
      `AutoSendComingSoon` import name unchanged.
      Files: `web/src/pages/admin/marketing/AutoSendComingSoon.tsx` (and optionally the
      one SUB_TABS label string in `AdminMarketing.tsx`).
      Verify: `npm run build` in `web` — compiles; manual: form loads current config,
      saving round-trips, token is masked, Enabled defaults OFF, test button inert when
      provider none/disabled and never fires a network request.

## Acceptance (end state)

- Three Dashboard StatCards are keyboard+mouse clickable and deep-link to their tabs;
  "Selected customers" stays non-interactive.
- A once-per-day bilingual suggestion banner appears on the Dashboard driven by live
  data; Action marks the day done, ✕ re-shows later the same day (actedOn vs dismissed).
- Dashboard has friendly primary CTAs and wraps cleanly on mobile; free/manual model
  and the "link opened ≠ sent" disclaimer are intact.
- A founder can later paste token + phone-number-id into the Auto-send / WhatsApp API
  settings, flip Enabled on, and the SINGLE commented `TODO fetch` in
  `web/src/lib/waSender.ts` is the only code left to confirm. No secret is committed;
  the token never reaches the public `/api/settings`.
- `npm run build` passes in both `web` and `api-node`; `npm test` passes in `api-node`.

## Known gaps / assumptions

- Chose a new nullable `settings.whatsapp_api` column over a non-existent JSON blob
  because the settings table is fixed-column raw SQL and this matches the repo's own
  `ensure*Column` convention; it is the least-invasive durable store and keeps the
  token off the public endpoint.
- `offer_expiry` / per-offer dates remain absent server-side (unchanged); the nudge
  uses only `festivalsSoon`/`discountedProducts`/`lowStock` which the dashboard already
  returns, so no price/date is ever invented.
- No web unit-test runner exists; verification is typecheck+build, consistent with the
  codebase. Introducing a test framework is out of scope for this additive change.
