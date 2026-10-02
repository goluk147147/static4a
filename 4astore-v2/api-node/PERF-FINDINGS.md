# 4AStore API — Performance Findings

Date: diagnosis run against the LOCAL XAMPP MariaDB copy (`four_a_store`), MariaDB 10.4.32.
Goal: explain the ~1-minute app loader / slow API, and fix it WITHOUT changing any JSON response shape or business logic.

## What was measured

Row counts (local DB):

| table | rows |
|-------|------|
| products | 90 |
| categories | 14 |
| orders | 5 |

Products `image`/`description` sizes (local DB):

- `MAX(LENGTH(image))` = 123 bytes, `AVG` ≈ 53 bytes — these are short URL/paths.
- `base64_images` (image starting with `data:`) = **0**.
- `MAX(LENGTH(description))` = 93 bytes.
- Whole `/products` payload ≈ a few KB.

Prisma timing probe (local, warm process):

| step | time |
|------|------|
| `prisma.$connect()` (cold) | ~126 ms |
| `product.findMany` (first) | ~20 ms |
| `product.findMany` (warm) | ~11 ms |
| `settings` raw `WHERE id=1` (first) | ~6 ms |
| `settings` raw `WHERE id=1` (warm) | ~4 ms |
| `orders.findMany` | ~5 ms |

`EXPLAIN SELECT * FROM orders ORDER BY id DESC` → `type=index`, `key=PRIMARY` (no scan).
`SHOW INDEX FROM orders` → PRIMARY, `uq_orders_orderid`, `uq_orders_payref`, **`idx_orders_status`**, **`idx_orders_rider`** already present.

## Conclusion — the cause is NOT what it looks like

1. **Not a missing-index problem for the data as it exists.** The orders list sorts by `id DESC` and is served by the PRIMARY key; products/categories are tiny. The DB already carries `idx_orders_status`, `idx_orders_rider`, `idx_products_category`, `idx_products_instock`, `idx_users_role` (defined in `4astore-v2/db/schema.sql`). The Prisma schema just does not *declare* them — a cosmetic/drifty mismatch, see fix #4.

2. **Not a payload problem.** Images are short URLs, descriptions are short, no base64 data URIs. `/products` is only a few KB. (This must be re-checked against LIVE data — see "Caveats" — but on the current data it is not the cause.)

3. **The ~1-minute symptom is a CONNECTION / NETWORK-latency problem, not query time.** The decisive signal (from the task's own diagnostic rule): a single-row `SELECT ... WHERE id = 1` taking seconds can only be connection/handshake cost, because the query itself is ~4 ms. On the live EC2 box each request is paying a cold-connect / TLS / pool-starvation cost because:
   - `src/db.ts` creates `new PrismaClient()` with **no connection pool / timeout tuning and no `connection_limit` in `DATABASE_URL`**. Under the frequent staff/rider pollers (`/orders` every 7–12 s, `/tracking`) plus app-launch bursts (`/products`, `/categories`, `/config`, `/settings`, `/announcement` fired together), the default small pool serializes requests; a request can sit waiting for a free connection for seconds, then time out and retry — exactly the "loader spins ~1 min" behaviour.
   - There is **no HTTP caching** on the static public GETs. Every app launch and every React-Query refetch re-hits the DB for data that changes rarely (`/products`, `/categories`, `/config`, `/settings`, `/announcement`, `/version`). This multiplies the connection pressure above.

4. **Latent (will bite as `orders` grows), fix now while cheap:** the customer order list filters on a JSON path (`customer -> '$.mobile'`) which no B-tree index can serve, and there is no index on `orders.order_date` / `orders.user_id`. At 5 rows this is invisible; at tens of thousands it becomes a full scan on every customer "My Orders" open. Adding the `user_id` index + preferring `user_id` for the owner lookup is the durable fix, but it must not change the response.

## The fix (summary — full ordered steps in `.agents/tasks/plan.md`)

- **Primary:** make `PrismaClient` a tuned singleton and add a `connection_limit`/pool + `pool_timeout` to the live `DATABASE_URL`; add a lightweight gated timing middleware (`DEBUG_TIMING=1`) so the live cause is confirmable with real numbers.
- **High-leverage, zero-risk:** add `Cache-Control` (+ `ETag`, which Express already computes) to the static public GETs so repeat launches and refetches skip the DB entirely. Response bodies are byte-identical; only headers are added.
- **Durable DB:** sync `schema.prisma` `@@index` declarations to match the indexes that already exist in the live DB (prevents a future `prisma migrate` from dropping them), and ship a uniquely-named, idempotent `CREATE INDEX` `.sql` for the one genuinely-missing index (`orders.user_id`) that the user runs on the live server. MariaDB 10.4 lacks `CREATE INDEX IF NOT EXISTS`, so the `.sql` guards each add via `information_schema` so re-running is safe.

## Caveats / things to confirm on the LIVE box (cannot be measured from the local copy)

- Re-run the same probe and the `DEBUG_TIMING=1` middleware **on the live server** to confirm connect-time dominates. If a single-row `WHERE id=1` is fast there too, the latency is pure network between the app and EC2 (CDN / region / HTTP keep-alive), not the DB.
- Check LIVE `products.image`: if any live rows store base64 `data:` URIs (the local copy has none), payload becomes the issue and the plan's optional "lightweight image handling" note applies — but column-trimming `/products` is NOT allowed because the mobile app reuses the list cache for the product-detail screen (`app/product/[id].tsx` reads `description` + `features`) and the search box filters on `description`.
- Confirm the LIVE `orders` row count; if large, the `user_id` index + keeping the `id DESC` sort matter immediately.

---

## Applied — what shipped (first implementation pass)

All changes are header/config/schema-level. No API response JSON body changed; no business logic changed.

1. **Shared, tuned PrismaClient singleton** (`src/db.ts`) — the client is now stored on `globalThis` so `ts-node-dev --respawn` reloads and repeated imports reuse ONE client (one connection pool) instead of spawning extras. BigInt `toJSON` patch and the `prisma` export name are unchanged. Datasource `log` is enabled only when `DEBUG_TIMING=1`.
2. **Explicit connection pool** — appended `connection_limit=10&pool_timeout=20` to the local `.env` `DATABASE_URL` and documented the same in `.env.example`. The LIVE `.env` must get the same params (see DEPLOY).
3. **Gated timing middleware** (`src/middleware/timing.ts`, wired in `src/server.ts` after `cookieParser()`) — logs `METHOD path status durationMs` on `res.finish` ONLY when `DEBUG_TIMING=1`; a pure `next()` no-op otherwise, so production is unaffected.
4. **HTTP caching on the rarely-changing public GETs** (`src/routes/catalog.ts`) — `Cache-Control: public, max-age=30` on `/categories`, `/settings`, `/config`, `/announcement`, `/version`; `/products` gets a shorter `public, max-age=15` so admin stock/price edits appear quickly. Express's weak `ETag` yields `304 Not Modified` on conditional requests, skipping the DB. Authenticated/polled routes (`/orders`, `/tracking`) remain uncached.
5. **Prisma schema `@@index` sync** (`prisma/schema.prisma`) — declared the indexes that already exist in the live DB (so a future `prisma migrate`/`db push` won't DROP them) using their existing map names, and declared the two genuinely-useful new ones: `users(role)`, `refresh_tokens(user_id)`, `email_otps(email)`, `products(category)`, `products(in_stock)`, `addresses(user_id)`, `device_tokens(user_id)`, `orders(order_status)`, `orders(rider_id)`, and NEW `orders(user_id)` + `orders(order_date)`.
6. **Idempotent raw index script** (`prisma/perf-indexes.sql`) — adds only the two genuinely-missing indexes (`idx_orders_user`, `idx_orders_date`), each guarded via `information_schema` so re-running on MariaDB 10.4 is safe (no `CREATE INDEX IF NOT EXISTS` needed). The user runs this on the LIVE DB.
7. **Indexable customer-order lookup** (`src/routes/orders.ts`) — the customer "my orders" branch now filters on the indexed `user_id` FK (OR'd with the legacy `customer -> '$.mobile'` JSON path as a fallback so no order with a null `user_id` disappears). Staff branch (`orderBy id desc`) is unchanged. Returned array, ordering, and every field are identical.

## Verification run (local XAMPP MariaDB, this pass)

Commands run from `api-node/`:

| command | result |
|---------|--------|
| `npx prisma validate` | ✅ "The schema at prisma\schema.prisma is valid 🚀" |
| `npx tsc --noEmit` | ✅ exit 0, no errors |
| `npm run build` (`tsc -p tsconfig.json`) | ✅ exit 0 |
| `npx prisma generate` | ⚠️ EPERM renaming `query_engine-windows.dll.node` — a Windows file lock held by a running dev-server node process, NOT a schema error. `@@index` does not change the generated client's TypeScript surface, so `tsc`/`build` pass against the existing client. Re-run after stopping dev servers, or it runs cleanly on Linux/EC2. |
| `mysql four_a_store < prisma/perf-indexes.sql` (then re-run) | ✅ created `idx_orders_user` + `idx_orders_date`; second run printed "already exists" with exit 0 (idempotent) |
| single-client probe (`SELECT 1`, `SELECT * FROM settings WHERE id=1`) | ✅ `[{"x":1}]`, no BigInt / multi-client warnings |

Endpoint smoke (built server, `DEBUG_TIMING=1`, port 4055):

| endpoint | status | Cache-Control | notes |
|----------|--------|---------------|-------|
| `/api/products` | 200 | `public, max-age=15` | weak ETag present; `If-None-Match` → **304** |
| `/api/categories` | 200 | `public, max-age=30` | |
| `/api/settings` | 200 | `public, max-age=30` | |
| `/api/config` | 200 | `public, max-age=30` | |
| `/api/announcement` | 200 | `public, max-age=30` | |
| `/api/version` | 200 | `public, max-age=30` | |
| `/api/orders` (unauth) | 401 | *(none)* | business logic intact, uncached |

### Before / after (local)

The local box was never the bottleneck (diagnosis conclusion #3), so local numbers mainly prove no regression — the real win is skipping repeat DB hits on the live box via caching + a single pool.

| step | before (diagnosis) | after (this pass) |
|------|--------------------|-------------------|
| `SELECT 1` cold | ~126 ms connect | ~60 ms (warm process) |
| `settings WHERE id=1` | ~4–6 ms | ~8 ms |
| `/api/products` round-trip | n/a | ~95 ms first, **304 (no DB)** on repeat with ETag |
| `/api/settings` round-trip | n/a | ~24 ms |
| `/api/categories` round-trip | n/a | ~36 ms |

The decisive effect is on the LIVE box: repeat app launches / React-Query refetches of the six public GETs now return `304` (or hit the local HTTP cache) and never touch the DB, and all remaining requests share one tuned pool instead of fighting for connections. Re-run with `DEBUG_TIMING=1` on EC2 to capture live per-request numbers.

## DEPLOY — exact EC2 steps (pm2 app `4astore-api` at `/var/www/html/api-node`)

Do NOT git commit/push as part of this task. To ship:

1. **Upload changed files** to `/var/www/html/api-node/`:
   - `src/db.ts`
   - `src/middleware/timing.ts` (new)
   - `src/server.ts`
   - `src/routes/catalog.ts`
   - `src/routes/orders.ts`
   - `prisma/schema.prisma`
   - `prisma/perf-indexes.sql` (new)
2. **Add the pool params to the LIVE `.env`** `DATABASE_URL`, e.g. append `?connection_limit=10&pool_timeout=20` (or `&...` if the URL already has a query string). Tune `connection_limit` to the live MySQL `max_connections`.
3. **Apply the index script to the live DB** (CREATE INDEX / SELECT only, safe to re-run):
   ```bash
   mysql -u <user> -p four_a_store < /var/www/html/api-node/prisma/perf-indexes.sql
   ```
4. **Build:**
   ```bash
   cd /var/www/html/api-node
   npm run build
   ```
   (If you changed `schema.prisma` and the client needs regenerating: `npx prisma generate` — on Linux there's no Windows file-lock issue.)
5. **Restart the service:**
   ```bash
   pm2 restart 4astore-api --update-env
   ```
6. **(Optional) Confirm the live cause with real numbers:** set `DEBUG_TIMING=1` in the live `.env`, `pm2 restart 4astore-api --update-env`, watch `pm2 logs 4astore-api` while the app launches to see per-request `[timing]` lines (total vs the Prisma `query` logs), then unset it and restart to turn logging back off.
