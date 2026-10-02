# Latency fix: Prisma pool singleton, HTTP caching, and index sync

The change targets the ~1-minute app-loader symptom by attacking connection/pool pressure rather than query time (the diagnosis in PERF-FINDINGS.md established that single-row `WHERE id=1` reads are ~4ms locally, so the cost is handshake/pool contention on the live box). It makes `PrismaClient` a process-wide singleton, adds explicit `connection_limit`/`pool_timeout` to `DATABASE_URL`, puts `Cache-Control` + weak ETag on the six rarely-changing public GETs so repeat launches return `304` and skip the DB, syncs `schema.prisma` `@@index` declarations to the indexes already live in `db/schema.sql` (so a future `prisma migrate`/`db push` won't drop them), ships a guarded idempotent `CREATE INDEX` script for the two genuinely-missing order indexes, and rewrites the customer "my orders" lookup to prefer the indexed `user_id` FK over an unindexable JSON-path scan. A gated no-op timing middleware is added for live diagnosis.

Watch for: the customer `/orders` filter widened from a single mobile match to `user_id OR mobile` — this is an intentional superset that returns the same-or-more owner orders (confirmed), with field/order shape unchanged; no shrinkage risk. All response bodies are byte-identical; only headers were added.

**Verdict**: APPROVED

## High-level view

The response-shape constraint holds. The catalog routes only call `res.setHeader('Cache-Control', ...)` before the existing `ok(res, {...})` payloads — no body construction changed, so `/products`, `/categories`, `/settings`, `/config`, `/announcement`, `/version` return identical JSON. The orders route keeps its staff branch (`orderBy id desc`, all orders) untouched; the customer branch changes only the `where` predicate, not the selected fields or ordering.

The orders filter change is a behavioral widening, not a shape change. Previously a customer saw orders whose `customer->'$.mobile'` equals their mobile. Now, when the viewer is the logged-in owner with no explicit `?mobile=` override, they see orders matching `user_id OR the mobile JSON-path`. This can only add rows (owner's orders that were saved with a null/legacy `user_id` still match via the JSON path; owner's orders saved under their id now also match). The explicit `?mobile=` lookup and the staff path keep the exact old predicate.

The index work is internally consistent. Every pre-existing `@@index` map name in `schema.prisma` matches a `KEY` in `db/schema.sql` one-for-one, so declaring them is pure drift-correction that protects them from a future migrate. The two new indexes (`idx_orders_user` on `user_id`, `idx_orders_date` on `order_date`) are the only entries in `perf-indexes.sql`, and both columns are actually used: `user_id` by the new orders filter, `order_date` by the reminder job's `WHERE order_date <= cutoff ORDER BY order_date asc`.

The SQL script is non-destructive and MariaDB-safe. It contains only `SELECT`/`CREATE INDEX`, each add guarded by an `information_schema.STATISTICS` count so re-running is a no-op rather than an error (MariaDB 10.4 lacks `CREATE INDEX IF NOT EXISTS`). No drops, no data changes.

The pool and caching posture match the constraints. `src/db.ts` is now a `globalThis.__prisma` singleton. Caching lands only on static GETs; `/products` gets a shorter 15s TTL so admin stock/price edits surface quickly, and authenticated/polled routes (`/orders`, `/tracking`) stay uncached.

<details>
<summary>Issues (2)</summary>

1. **Orders filter widening (non-blocking, confirmed)** — the owner `/orders` branch now matches `user_id OR mobile` instead of mobile alone; it can only return a superset of the prior rows, never fewer, and shape/order are unchanged. Confirm the product intent is "show all orders I own" (it is the sensible reading); no code change required.
2. **Public cache TTL on `/settings` and `/config` (non-blocking, possible)** — a 30s `max-age` means admin changes to settings/config/announcement can take up to 30s to appear on already-loaded clients. This matches the stated "rarely-changing" intent, but confirm 30s staleness is acceptable for announcement/store-config edits.

</details>

<details>
<summary>Details</summary>

### Response-shape invariance on catalog GETs

Each of the six public handlers inserts a single `res.setHeader('Cache-Control', ...)` immediately before the pre-existing `ok(res, {...})` return. The payload objects (`{ products }`, `{ categories }`, the hand-mapped `publicSettings`, the parsed `config`, `announcement`, and the `version*` fields) are unchanged in the diff. Bodies are byte-identical; only a header and Express's weak ETag are added, so conditional requests short-circuit to `304` without touching the DB.

`/products` is deliberately held to `public, max-age=15` versus `30` for the rest, so admin stock/price edits appear quickly — consistent with the constraint to keep `/products` fresh. The weak ETag path means even within the TTL window a changed body yields a new validator, so a client that revalidates won't be served stale product data beyond its own cache window.

### Orders owner-lookup: indexed FK with JSON-path fallback

```
viewer is owner, no ?mobile override
        │
        ▼
  OR ─┬─ user_id = BigInt(viewer.sub)        ← indexed (idx_orders_user)
      └─ customer->'$.mobile' = viewer.mobile ← legacy/null-user_id orders
```

The staff branch (`findMany({ orderBy: { id: 'desc' } })`) is untouched. The explicit `?mobile=` branch keeps the exact original JSON-path-only predicate. Only the owner-no-override branch gains the `OR`. Because it is a union with the original predicate, the result set is a superset of the old one — the fallback leg guarantees no order that previously showed up can disappear, and `orderBy: { id: 'desc' }` plus the returned fields are identical. `BigInt(viewer.sub)` is guarded by the `viewer.sub` truthiness check in `canUseOwnerId`, so no `BigInt(undefined)` throw.

The one judgement call is semantic: an owner now also sees orders tied to their `user_id` even if those were stored under a different mobile. That is the correct reading of "my orders" and strictly additive, but it is a behavior change worth naming.

### Index declarations vs. live schema

The nine pre-existing `@@index(map: ...)` entries added to `schema.prisma` each correspond one-for-one to a `KEY` in `db/schema.sql` (verified: `idx_users_role`, `idx_refresh_user`, `idx_otp_email`, `idx_products_category`, `idx_products_instock`, `idx_addresses_user`, `idx_orders_status`, `idx_orders_rider`, `idx_device_user`). Declaring them corrects schema drift so a future `prisma migrate`/`db push` won't drop indexes the live DB depends on — a real, non-cosmetic safety fix. The two new declarations (`idx_orders_user`, `idx_orders_date`) match the SQL script exactly in name and column.

Both new indexes target columns that are actually filtered/sorted: `user_id` by the new owner-orders `OR`, and `order_date` by `services/reminderJob.ts` (`where: { order_date: { lte: cutoff } }, orderBy: { order_date: 'asc' }`). Neither is a speculative index.

### perf-indexes.sql: non-destructive and re-runnable on MariaDB 10.4

The script contains only `SET`/`SELECT`/`PREPARE`/`CREATE INDEX` — no `DROP`, `ALTER … DROP`, `DELETE`, `UPDATE`, or `TRUNCATE`. Each `CREATE INDEX` is gated by a count against `information_schema.STATISTICS` scoped to `DATABASE()`, so a second run resolves to a harmless `SELECT '… already exists'` instead of the duplicate-key error a bare `CREATE INDEX` would raise on 10.4 (which has no `IF NOT EXISTS`). The index names are distinct from the already-present `idx_orders_*`, so no collision. Scoping to `DATABASE()` means it acts on whichever schema the connection targets, which matches the documented `mysql … four_a_store < perf-indexes.sql` invocation.

### Prisma singleton and pool

`src/db.ts` stashes the client on `globalThis.__prisma` and reuses it, which prevents `ts-node-dev --respawn` from leaking an extra client (and pool) per hot-reload — one of the named causes of live connection pressure. The BigInt `toJSON` patch and the `prisma` export name are preserved. The live `.env` must receive the same `connection_limit`/`pool_timeout` params as `.env.example` for the pool fix to take effect — correctly flagged in PERF-FINDINGS DEPLOY, but it is a manual deploy step, so the fix is inert until that happens.

### Verification evidence

PERF-FINDINGS.md records `npx prisma validate` ✅, `npx tsc --noEmit` exit 0, `npm run build` exit 0, and an idempotency check of the SQL script (second run printed "already exists", exit 0), plus an endpoint smoke table showing the `Cache-Control` values and a `304` on `If-None-Match` for `/products`, and `/orders` unauth → `401` (business logic intact). The one `npx prisma generate` EPERM is a Windows file lock on the engine DLL, not a schema fault, and `@@index` additions don't alter the generated client's TypeScript surface — consistent with `tsc`/`build` passing against the existing client. Evidence is sufficient; no re-run warranted.

</details>

<details>
<summary>File map</summary>

- `src/db.ts` — PrismaClient becomes a `globalThis` singleton; `log` gated on `DEBUG_TIMING`.
- `src/middleware/timing.ts` (new) — gated no-op request-timing logger.
- `src/server.ts` — wires `timing` middleware after `cookieParser()`.
- `src/routes/catalog.ts` — `Cache-Control` headers on the six public GETs (`/products` 15s, rest 30s); bodies unchanged.
- `src/routes/orders.ts` — owner "my orders" branch filters on `user_id OR mobile`; staff and explicit-mobile branches unchanged.
- `prisma/schema.prisma` — nine drift-correcting `@@index` + two new (`idx_orders_user`, `idx_orders_date`).
- `prisma/perf-indexes.sql` (new) — guarded, idempotent `CREATE INDEX` for the two missing order indexes.
- `.env.example` — documents `connection_limit`/`pool_timeout` on `DATABASE_URL`.

Full diff: `git -C 4astore-v2/api-node diff main`.

</details>
