# Implementation Plan — API latency fix (no response-shape / business-logic changes)

Source of truth for the diagnosis: `api-node/PERF-FINDINGS.md`. Measured cause: connection/pool/network latency (a single-row `WHERE id=1` taking seconds while the query itself is ~4 ms), amplified by no HTTP caching on the frequently-fetched public GETs and by the staff/rider pollers. The data is tiny (90 products, 5 orders) and the orders list is already served by the PRIMARY key, so missing *indexes* are NOT the primary cause — but the live DB has latent gaps worth closing cheaply.

Hard constraints (verified during exploration — do NOT violate):
- Every endpoint's JSON body must stay byte-identical. The `{ success: true, ... }` envelope from `src/utils/http.ts` and all field names/values stay exactly as they are. Caching changes may add HTTP *headers* only.
- `/products` returns the FULL product row and MUST keep doing so. Both clients reuse the `['products']` list cache for the product-detail screen and search:
  - mobile `app/product/[id].tsx` reads `description` + `features`; mobile `app/(tabs)/products.tsx` search filters on `description`.
  - web `src/pages/ProductDetails.tsx` + `src/pages/Products.tsx` do the same; web `Product` type also carries `featured`.
  So NO column trimming / lightweight list endpoint for products.
- Build/verify command for the API: `npm run build` (runs `tsc -p tsconfig.json`) in `api-node`. There is no test framework in this project; verification is the TypeScript build plus a targeted runtime probe described per step. Do NOT add a test framework.
- DB target is MariaDB 10.4.32 → NO `CREATE INDEX IF NOT EXISTS`. Use uniquely-named indexes guarded via `information_schema` so re-running the `.sql` is safe. Only `CREATE INDEX` and `SELECT` — no destructive DB ops. The USER applies the `.sql` on the live server.
- Do not touch live secrets / live `.env`. Local `.env` edits are fine; document the live `DATABASE_URL` change as an instruction.

---

- [ ] 1. Make `PrismaClient` a tuned, reused singleton that survives dev hot-reload.
      In `src/db.ts`, keep the existing BigInt `toJSON` patch, but store the client on `globalThis` so `ts-node-dev --respawn` and repeated imports don't spawn extra clients (each extra client = extra pool = more live connections). Add datasource `log` only when `DEBUG_TIMING=1`. Do not change the export name (`prisma`) or the BigInt patch — the whole codebase imports `{ prisma }`.
      Files: `src/db.ts`
      Verify: `npm run build` compiles clean; then `node -e "const{prisma}=require('./dist/db');prisma.$queryRawUnsafe('SELECT 1 AS x').then(r=>{console.log(r);return prisma.$disconnect()})"` prints `[ { x: 1 } ]` with no "BigInt" or multiple-client warnings.

- [ ] 2. Add connection-pool + timeout tuning via `DATABASE_URL` query params (config, not code).
      Append `connection_limit` and `pool_timeout` to the local `.env` `DATABASE_URL` (e.g. `...four_a_store?charset=utf8mb4&connection_limit=10&pool_timeout=20`) so the pool is explicit rather than Prisma's host-core default, and document in `PERF-FINDINGS.md` / step output that the LIVE `.env` must get the same params (tuned to the EC2 MySQL `max_connections`). This directly addresses pool-starvation stalls under the pollers. No code change — Prisma reads these from the URL.
      Files: `api-node/.env` (local only), note for live `.env`
      Verify: restart `npm run dev`; `GET http://localhost:4000/api/health` returns `{ "success": true, ... }`; server log shows a single startup line (one client). Confirm the URL still parses (no connection error on first request to `/api/products`).

- [ ] 3. Add a gated request-timing middleware (off in production unless `DEBUG_TIMING=1`).
      Create `src/middleware/timing.ts` exporting an Express middleware that, when `process.env.DEBUG_TIMING === '1'`, records `process.hrtime.bigint()` at request start and logs `METHOD path status durationMs` on `res.on('finish')`. Wire it in `src/server.ts` immediately after `express.json(...)`/`cookieParser()` and before the routes. It must be a no-op (just `next()`) when the flag is unset so production is unaffected. This is how the LIVE cause gets confirmed with real numbers (query vs total).
      Files: `src/middleware/timing.ts`, `src/server.ts`
      Verify: `npm run build` compiles. Run `DEBUG_TIMING=1 npm run dev` (PowerShell: `$env:DEBUG_TIMING="1"; npm run dev`), hit `/api/products` and `/api/settings`, confirm a timing line is logged for each; then run `npm run dev` WITHOUT the flag and confirm NO timing lines appear.

- [ ] 4. Add `Cache-Control` + `ETag`-friendly headers to the rarely-changing public GETs.
      In `src/routes/catalog.ts`, before each `ok(res, ...)` for `/products`, `/categories`, `/config`, `/settings`, `/announcement`, `/version`, set `res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')` (announcement/version may use a shorter `max-age=30`). Express already generates a weak `ETag` for JSON bodies, so conditional requests return `304` with no DB hit. Do NOT alter the JSON passed to `ok(...)`. This is the highest-leverage, zero-risk change: repeat app launches and React-Query refetches skip the DB entirely, removing most connection pressure. (Leave authenticated/polled routes — `/orders`, `/tracking` — uncached so staff/rider always see fresh data; business logic unchanged.)
      Files: `src/routes/catalog.ts`
      Verify: `npm run build` compiles. `npm run dev`, then `curl -i http://localhost:4000/api/products` shows `Cache-Control: public, max-age=60...` and an `ETag`; re-request with `-H "If-None-Match: <that etag>"` returns `304 Not Modified` with an empty body. Confirm a normal `GET /api/products` body is unchanged vs before (same JSON).

- [ ] 5. Sync `schema.prisma` index declarations to the indexes that already exist in the live DB.
      In `prisma/schema.prisma` add `@@index` entries that mirror `4astore-v2/db/schema.sql` so a future `prisma migrate`/`db push` won't try to DROP them: `Product` → `@@index([category])`, `@@index([in_stock])`; `Order` → `@@index([order_status])`, `@@index([rider_id])`, and ADD the one genuinely-missing-but-useful `@@index([user_id])` and `@@index([order_date])`; `User` → `@@index([role])`; `RefreshToken` → `@@index([user_id])`; `Address` → `@@index([user_id])`; `DeviceToken` → `@@index([user_id])`; `EmailOtp` → `@@index([email])`. Use index names matching schema.sql where they exist (e.g. `@@index([category], map: "idx_products_category")`) so Prisma treats them as already-present. Do NOT run `prisma migrate`/`db push` against any DB in this step — this only aligns the schema file (and regenerates the client).
      Files: `prisma/schema.prisma`
      Verify: `npx prisma generate` succeeds; `npx prisma validate` reports the schema is valid. (Do NOT run migrate/db push.)

- [ ] 6. Ship a safe, idempotent `CREATE INDEX` script for the live DB (user runs it).
      Create `prisma/perf-indexes.sql` that adds only the genuinely-missing indexes — primarily `orders(user_id)` and `orders(order_date)` — each guarded for MariaDB 10.4 (no `IF NOT EXISTS`): for each index, a prepared-statement block that checks `information_schema.STATISTICS` for the uniquely-named index and runs `CREATE INDEX` only if absent, so re-running is a no-op. Include a header comment: run on the LIVE server only, `CREATE INDEX`/`SELECT` only, no destructive ops, names chosen to not collide with existing `idx_orders_*`. Do NOT execute it here.
      Files: `prisma/perf-indexes.sql`
      Verify (local, non-destructive): run the script against the local `four_a_store` with `mysql -u root four_a_store -e "SOURCE prisma/perf-indexes.sql"`, then `SHOW INDEX FROM orders;` shows `idx_orders_user` and `idx_orders_date`; run the SAME script a second time and confirm it completes with no error (idempotent) and creates no duplicates.

- [ ] 7. Prefer the indexable `user_id` for the customer order lookup WITHOUT changing the response.
      In `src/routes/orders.ts` `GET /` customer branch, when the viewer is a logged-in customer and `req.user!.sub` is available, filter by `user_id` (indexed) instead of the JSON-path `customer -> '$.mobile'` (unindexable full scan). Keep the staff `findMany({ orderBy: { id: 'desc' } })` branch exactly as-is. The returned `orders` array shape, ordering (`id desc`), and every field must stay identical — only the WHERE predicate changes from a JSON path to the FK column. If any legacy order has a null `user_id`, keep the mobile-based path as a fallback so no order silently disappears (preserve current behavior). This is the only route-logic change and must be made conservatively.
      Files: `src/routes/orders.ts`
      Verify: `npm run build` compiles. With the dev server up and a seeded customer token, `GET /api/orders?mobile=<that customer>` returns the same orders (same count, same order) as before the change; `GET /api/orders` as staff is unchanged. If no seeded auth is available, at minimum confirm the build passes and document the manual check for the implementer to run against the live/staging data.

- [ ] 8. Final build + smoke, and update findings with any live-confirmation notes.
      Run the full API build and a quick smoke of the cached public GETs; append to `PERF-FINDINGS.md` a short "applied" section listing what shipped (pool params, cache headers, timing flag, schema sync, `perf-indexes.sql`) and the exact LIVE steps the user must do: (a) add the pool params to live `DATABASE_URL`, (b) run `prisma/perf-indexes.sql` on the live DB, (c) optionally set `DEBUG_TIMING=1` briefly to capture real per-request numbers, (d) restart the Node service.
      Files: `PERF-FINDINGS.md`
      Verify: `npm run build` is clean; `curl -i` on `/api/products`, `/api/categories`, `/api/settings`, `/api/config`, `/api/announcement`, `/api/version` each return `200` with `Cache-Control` set and unchanged JSON bodies; `/api/orders` (unauth) still returns the normal auth error (business logic intact).

---

Notes / assumptions:
- `max-age=60` is a deliberate balance: long enough to collapse app-launch bursts and React-Query refetches (which already use `staleTime` of 1–10 min), short enough that admin edits appear within a minute. If the team wants instant admin reflection, drop to `max-age=15` or add a cache-busting query param on admin save — not required for the latency fix.
- No decomposition into FEAT artifacts: this is one cohesive, tightly-coupled performance pass (db client/pool + headers + timing + schema/index sync) where steps share the same files and must land together to be coherent. The existing implement-and-review loop will execute this plan; the loop stops when `.agents/tasks/review.json` has `verdict == APPROVED`.
