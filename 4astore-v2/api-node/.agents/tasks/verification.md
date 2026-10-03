# Verification — Owner-only DB import/factory-reset tool (API + web) + mobile notification icon

Note on the pre-existing `review.json`: it describes a **different, previously-approved task**
(the Prisma pool / HTTP-caching / index-sync latency fix recorded in PERF-FINDINGS.md and
`review.md`). None of the deliverables for THIS plan (Item A DB tool, Item B notification icon)
existed in the tree, so this was implemented from scratch per `plan.md`.

## Item A — API (worktree `4astore-v2/api-node`)

Static checks:
- `npx tsc --noEmit` → exit 0 (clean).
- `npx prisma validate` → "The schema at prisma/schema.prisma is valid 🚀" (exit 0).

Runtime probes (against an ISOLATED throwaway DB `four_a_store_resettest`, created from
`4astore-v2/db/schema.sql` — the real `four_a_store` DB was never touched; reset was NOT run
against anything but the test DB). Server started with
`DATABASE_URL=…/four_a_store_resettest`, `PORT=4137`:

- **Startup auto-seed**: log printed `[seed] default owner created` on first boot of the empty DB.
- **Owner login**: `POST /api/users/login {username:"owner",password:"owner@7543"}` → 200 with token
  (confirms the bcrypt hash matches the existing login path).
- **GET /api/admin/data/status** (owner) → 200
  `{counts:{users:1,products:0,categories:0,orders:0},ownerExists:true}`.
- **No token** → `GET /api/admin/data/status` → 401.
- **Non-owner** (seeded a `customer` with a real bcrypt hash, logged in):
  `GET /api/admin/data/status` → 403; `POST /api/admin/data/reset` → 403 (requireOwner works).
- **POST /api/admin/data/reset {}** (owner, bad body) → 422 "Type RESET to confirm".
- **Import idempotency** — `POST /api/admin/data/import` run TWICE, counts identical both times:
  `{categories:14, products:90, banners:14, ads:2, settings:true, announcement:true}`.
  `status` after each import stable at `products:90, categories:14` (no duplicate rows).
- **Factory reset** — `POST /api/admin/data/reset {confirm:"RESET"}` → `{reset:true, ownerSeeded:true}`.
  `status` after reset → `{users:1, products:0, categories:0, orders:0, ownerExists:true}`
  (wiped + owner re-seeded in the same request).
- **Re-login after reset** — `POST /api/users/login` as owner → 200 with token.

Test DB dropped and all probe scripts/logs removed after verification. Real `four_a_store`
confirmed intact afterwards (90 products, 4 users).

NOTE: the test DB initially lacked the `products.seo_*`/`og_image` columns because the
checked-in `db/schema.sql` predates the SEO module; those columns were added to the TEST DB
to mirror the live schema. The live `four_a_store` already has them (the import ran clean there
historically). No code change was needed — the importer is correct.

## Item A — web (worktree `4astore-v2/web`)

- `npx tsc --noEmit` → exit 0 (clean).
- `npm run build` (`tsc -b && vite build`) → exit 0, built in ~9s, bundle emitted.
- Data/Danger-Zone UI is gated on `user?.role === 'owner'` — Import button + Danger Zone render
  only for owner; the reset button is disabled until the admin types exactly `RESET`, and a
  `showConfirm` double-confirm fires before the POST; on success it logs out and navigates to
  `/admin` (which shows the admin login).

## Item B — mobile (MAIN repo `4astore-v2/mobile`)

- Generated `assets/images/notification-icon.png` via
  `api-node/scripts/make-notification-icon.ts` (@napi-rs/canvas; no new mobile dep).
  Verified: **96×96**, 7330 transparent px + 1886 white px, **0 other-colour px** →
  white monochrome silhouette on a transparent background (correct for the Android small icon).
- `app.config.ts` `expo-notifications` plugin `icon` changed to
  `./assets/images/notification-icon.png`; `color: '#FF7A00'` and `defaultChannel: 'default'`
  unchanged. App icon / adaptive icon / splash untouched.
- `npm run typecheck` (`tsc --noEmit`) → only the KNOWN, pre-existing error remains:
  `app.config.ts(39,5): ... 'usesCleartextTraffic' does not exist in type 'Android'`.
  No new errors from this change.

## SQL

No new SQL / schema change required (Item A reuses existing tables; owner seed uses `users`).
No `prisma/*.sql` file added.
