# Order API RCA — "order se related sare API response nhi de rhae"

Status: READ-ONLY investigation. No code changed. Some conclusions need one round of
server-side command output (listed in §6) to move from "strongest hypothesis" to "proven".

---

## 1. Summary answer (most-likely root cause)

The order routes throw a **DB-level exception inside an `async` Express handler that is never
caught**, and because this API has **no async-error plumbing**, the thrown promise rejection is
**not forwarded to the Express error handler** — so instead of returning a clean `500`, the
request **hangs with no response until the client's 15s timeout fires**. That is exactly the
reported symptom: *"sare API response nhi de rhae"* (no response at all), not *"error aa raha hai"*.

Two facts make this the leading cause:

1. **Every handler in `src/routes/orders.ts` is `async` and does its DB `await`s with no
   `try/catch`.** The app imports no `express-async-errors` and wraps no handler in an
   async-catch helper (confirmed: a repo-wide search for `express-async-errors` / `asyncHandler`
   returns **zero** matches). In Express 4 (this project is `express@^4.19.2`), a rejected
   promise from an `async` handler is **silently dropped** — Express 4 does not await handler
   return values — so the response is never sent and the socket just sits open. The 4-arg error
   handler in `src/server.ts` only ever runs for **synchronous** throws or an explicit
   `next(err)`, neither of which happens here.

2. **The one order query that is most likely to throw is the customer "My Orders" path**, which
   filters a `Json` column by JSON path:
   `where: { customer: { path: '$.mobile', equals: target } }` (`src/routes/orders.ts`, the
   `GET /` handler). Prisma compiles this to a MariaDB `JSON_EXTRACT`/`JSON_UNQUOTE` comparison,
   and Prisma↔MariaDB JSON handling is a known, documented friction point (see §5). If any
   `orders.customer` row holds a value Prisma/MariaDB can't coerce for that comparison (NULL JSON,
   a non-object, a string-typed JSON column), the query throws at execution time — and per fact #1
   that throw becomes a hung request rather than a 500.

So the user-visible result is: products/categories/settings/config work (their handlers are also
async-unguarded, but their queries don't throw), while **every order call spins and times out**.

**Why "all order APIs" and not just one:** `GET /orders` (both staff and customer branches),
`GET /orders/:id`, and `POST /orders` all run unguarded `await prisma.order.*` calls. If the
failure is DB/connection-level (pool starvation, a Prisma client crash, or a JSON-column read
that fails for the whole table) rather than filter-specific, *every* order route hangs the same
way — which matches "sare" (all) rather than "customer wali".

---

## 2. Ranked causes

| Rank | Cause | Evidence strength | How to confirm (see §6) |
|------|-------|-------------------|-------------------------|
| **1** | Unhandled async rejection in order handlers → request hangs → no response (not a 500) | **Strong, code-proven.** `orders.ts` handlers are async with no try/catch; no `express-async-errors`; Express 4 drops the rejection. | curl `/api/orders` locally: if it **hangs ~15s then no body / curl's own timeout** (vs a quick `{"success":false}` 500), confirmed. |
| **2** | The underlying throw is the `customer`-JSON-path filter in `GET /orders?mobile=` (MariaDB 10.4 JSON coercion / string-vs-object) | **Medium-strong.** Known Prisma+MariaDB JSON issues (§5). But PERF-FINDINGS measured `orders.findMany` at ~5ms locally on the same MariaDB 10.4.32, so the *staff* path at least runs. | Compare curl of staff `GET /orders` (no `mobile`, plain `findMany`) vs customer `GET /orders?mobile=7543888698` (JSON-path). If staff works and customer hangs → filter is the thrower. |
| **3** | Connection-pool starvation / Prisma client wedged (the "slow response", "1-minute loader" the user kept hitting) | **Medium.** PERF-FINDINGS already identified cold-connect/pool pressure as the latency cause; the pollers (`useAllOrders` every 7s, tracking) keep hammering `/orders`. A wedged/exhausted pool makes *every* order call hang. | `pm2 describe` restart count; `pm2 logs` for `P1001`/`P2024 (pool timeout)`/`Can't reach database`; whether `SELECT 1` keep-alive is logging errors. |
| **4** | Apache proxy buffering/dropping the specific response | **Low.** `ProxyPass /api … keepalive=On` treats all `/api/*` the same; products proxy fine, so the proxy isn't order-specific. A hung Node response *looks* like a proxy stall but originates upstream. | curl `127.0.0.1:4000/api/orders` (bypasses Apache) vs `https://4astore.com/api/orders`. If **both** hang identically → not Apache; it's Node/DB. |
| **5** | Auth / JWT (token rejected) | **Low for THIS symptom.** A 401 returns immediately (`requireAuth` → `fail(res, …, 401)`, synchronous). The app also auto-refreshes on 401. A 401 would surface a *"Session expired"* toast, not a silent spinner. | curl without and with a valid token: a 401 (fast) rules auth out as the "no response" cause. |
| **6** | Deploy drift (dist out of sync with src) | **Low-medium, worth ruling out.** The JSON-path OR query **is** on `main` (commit `f90d0d9d`, ancestor of HEAD `1d205ce1`), so if `dist/routes/orders.js` was built from an *older* source it may be a *different* code path than what's in the repo. | `ls -la dist/routes/orders.js` mtime vs last build; `git log --oneline -3` on the server. |

---

## 3. Evidence from the code (file / symbol citations)

### 3.1 No async-error handling anywhere (the amplifier)
- `src/server.ts` registers a standard 4-arg error middleware
  (`app.use((err, _req, res, _next) => { … res.status(500) … })`). This fires **only** for sync
  throws or `next(err)`.
- `src/routes/orders.ts`: **every** handler is `async (req, res) => { … await prisma.order.* … }`
  with **no** `try/catch` around the awaits and **no** `.catch(next)`.
  - `GET /` → `await prisma.order.findMany(...)` (both staff and customer branches) — unguarded.
  - `GET /:orderId` → `canAccessOrder` does `prisma.order.findUnique(...).catch(() => null)`
    (guarded) **but** then returns `ok(res, { order })` after an unguarded path; the finder is
    guarded, so this route is *less* likely to hang than `GET /`.
  - `POST /` → multiple unguarded awaits (`findUnique`, `upsert`, `getSettingsRow` which does a
    raw query).
- Repo-wide search for `express-async-errors`, `asyncHandler`, `Promise.resolve(fn` → **no matches**.
- Contrast `src/routes/catalog.ts` (the routes that WORK): same async-unguarded style, but its
  queries are trivial single-row / full-table reads that don't throw, **and** several are wrapped
  in a 10s TTL cache (`cached(...)`) and now carry `Cache-Control`, so repeat calls can 304
  without touching the DB. Orders are explicitly **uncached** (correct for freshness) and hit the
  DB every time.

> Net: catalog and orders share the same latent bug; orders is where it actually fires because an
> order query actually throws / stalls.

### 3.2 The suspect query (the thrower)
`src/routes/orders.ts`, `GET /` customer branch:
```ts
const canUseOwnerId = !mobile && viewer.sub && target === viewer.mobile;
const where = canUseOwnerId
  ? { OR: [ { user_id: BigInt(viewer.sub) },
            { customer: { path: '$.mobile', equals: target } } ] }
  : { customer: { path: '$.mobile', equals: target } };
const orders = await prisma.order.findMany({ where, orderBy: { id: 'desc' } });
```
- `customer` is `Json` (not null) in `prisma/schema.prisma` (`model Order { … customer Json … }`).
- The JSON-path filter compiles to MariaDB `JSON_EXTRACT(customer,'$.mobile') = ?`. On MariaDB
  10.4 the server-side JSON type is an alias for `LONGTEXT` with a CHECK; Prisma's JSON read/compare
  path has documented bugs where MariaDB returns JSON as a **string** and the comparison / result
  decode fails (§5). A single malformed `orders.customer` row (NULL, a bare string, missing
  `mobile`) can make the whole `findMany` throw.
- `BigInt(viewer.sub)` throws synchronously if `viewer.sub` is ever a non-numeric string — a sync
  throw here WOULD reach the error handler (→ 500), so this is a *secondary* possibility, not the
  "silent hang" one.

### 3.3 The client behaviour that turns a hang into the reported UX
`mobile/src/api.ts`:
- 15s `AbortController` timeout → a hung server aborts at 15s and throws
  `"Server slow hai / timeout…"` (ApiError status 0). This is the *"slow response"* toast the user
  reported.
- GET auto-retries **once** on a network/timeout blip (`_netRetried`) → a hung `/orders` is hit
  **twice**, ~30s of spinner, then the error. Matches *"loader hi ghum rha hai"* / *"bahut der ke
  baad"*.
- `useAllOrders` polls every 7s and `useMyOrders` runs on screen focus → a wedged order route
  produces a continuous stream of hanging requests, which can further starve the pool (cause #3),
  a self-reinforcing loop.

### 3.4 Deploy / branch state (git, read-only)
- `main` HEAD = `1d205ce1` ("merge: v2 batch …"). The JSON-path OR query was introduced in
  `f90d0d9d` ("done abhi tak"), and `git merge-base --is-ancestor f90d0d9d HEAD` → **exit 0**, i.e.
  the JSON-path code **IS on `main`** and therefore expected in any build off `main`.
- Working-tree has **uncommitted** changes in `src/routes/push.ts` and `src/db.ts` (the P2002 push
  fix mentioned in the brief) plus mobile/web files — **but orders.ts is NOT modified** in the
  working tree, so the deployed order behaviour equals the committed `main` behaviour (assuming
  dist was built from main — verify in §6, cause #6).

---

## 4. What is NOT the cause (ruled out from code)
- **Not auth** as the "no response" cause: `requireAuth` returns a synchronous `fail(res, …, 401)`,
  which responds instantly; and the client silently refreshes on 401. A 401 would show
  *"Session expired"*, not an endless spinner.
- **Not Apache-specific**: `ProxyPass /api …` is route-agnostic; `/api/products` proxies fine, so
  the proxy layer is not singling out `/orders`. A hung upstream only *looks* like a proxy stall.
- **Not payload size**: PERF-FINDINGS measured orders at 5 rows, `orders.findMany` ~5ms, no base64
  blobs. Volume is not the issue (on current data).

---

## 5. External corroboration (Prisma + MariaDB JSON)

Prisma's JSON handling on MariaDB (as opposed to MySQL) has multiple open, documented defects:
MariaDB returns JSON columns as strings where MySQL returns parsed objects, and the MariaDB path
can mis-serialize JSON on read, surfacing as parse/`not valid JSON` errors. MariaDB also does not
implement MySQL's `->`/`->>` JSON operators the same way. These are the mechanisms by which a
JSON-path `where` filter can throw at query time on MariaDB 10.4 even though the identical code is
fine on MySQL.

Sources (content rephrased for compliance with licensing restrictions):
- [Prisma issue #26075 — JSON parsed on MySQL but returned as a string on MariaDB](https://github.com/prisma/prisma/issues/26075)
- [Prisma issue #28168 — MariaDB adapter mis-serializes JSON fields ("not valid JSON")](https://github.com/prisma/prisma/issues/28168)
- [Prisma issue #28143 — MariaDB adapter fails selecting a JSON field](https://github.com/prisma/prisma/issues/28143)
- [Prisma issue #8874 — some JSON array filters don't work on MariaDB](https://github.com/prisma/prisma/issues/8874)
- [StackOverflow — MariaDB does not support MySQL's `->`/`->>` JSON operators](https://stackoverflow.com/questions/67738740/how-to-query-a-json-column-using-the-operator-in-mariadb)
- [Prisma discussion #20357 — JSON-path `equals` needs the JSON-null (`DbNull`) handling, else it errors](https://github.com/prisma/prisma/discussions/20357)

Note: the running stack uses the standard `mysql` connector in `DATABASE_URL`
(`mysql://…`), **not** `@prisma/adapter-mariadb`, so the specific *adapter* bugs (#28168/#28143)
apply only if the adapter is in use — confirm the connector on the live box. The connector-level
JSON string/coercion behaviour (#26075) and the `DbNull` requirement (#20357) still apply.

---

## 6. Exact commands for the user to run on the EC2 server

Run these on the EC2 box (Linux, `ec2-user`) in order and paste the output back. Use `curl`
(NOT `curl.exe`). These are all **read-only** (login + GETs + log reads + a COUNT) — nothing is
modified.

### 6.1 Get a token (owner account)
```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:4000/api/users/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"owner","password":"owner@7543"}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
echo "token length: ${#TOKEN}"
```
Expect a non-zero length. If length is 0, print the raw body to see the login error:
```bash
curl -s -X POST http://127.0.0.1:4000/api/users/login -H 'Content-Type: application/json' -d '{"username":"owner","password":"owner@7543"}'; echo
```

### 6.2 THE decisive test — staff path vs customer path, local vs public, with timing
```bash
# A) STAFF path (plain findMany, no JSON filter) — LOCAL
curl -s -o /tmp/a.json -w 'A staff local : HTTP %{http_code}  time %{time_total}s  bytes %{size_download}\n' \
  --max-time 40 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:4000/api/orders"

# B) CUSTOMER path (JSON-path filter) — LOCAL   <-- prime suspect
curl -s -o /tmp/b.json -w 'B cust  local : HTTP %{http_code}  time %{time_total}s  bytes %{size_download}\n' \
  --max-time 40 -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:4000/api/orders?mobile=7543888698"

# C) STAFF path — PUBLIC (through Apache)
curl -s -o /tmp/c.json -w 'C staff public: HTTP %{http_code}  time %{time_total}s  bytes %{size_download}\n' \
  --max-time 40 -H "Authorization: Bearer $TOKEN" "https://4astore.com/api/orders"

# D) Working control: products (no auth) — LOCAL
curl -s -o /dev/null -w 'D prod  local : HTTP %{http_code}  time %{time_total}s\n' \
  --max-time 40 "http://127.0.0.1:4000/api/products"

echo '--- head of each body ---'
echo "A:"; head -c 300 /tmp/a.json; echo
echo "B:"; head -c 300 /tmp/b.json; echo
echo "C:"; head -c 300 /tmp/c.json; echo
```
**Read the result like this:**
- A, C return `{"success":true,"orders":[...]}` fast, but **B hangs ~15–40s / times out** →
  **confirmed: cause #2** (the `customer` JSON-path filter throws, and cause #1 turns it into a hang).
- A **and** B **and** C all hang/time out, but D (products) is fast → cause #1 + #3
  (all order routes wedged; DB/pool or client-level, not filter-specific).
- Any of them returns a quick `{"success":false,"message":"Server error"}` **500** → the throw IS
  reaching the error handler (so cause #1's "silent hang" is wrong) and the body/pm2 log names the
  real exception. Capture it.
- B (or all) returns `{"success":true,"orders":[]}` **fast** → not a crash at all; it's a
  data/filter mismatch (empty result) — pivot to §6.4.

### 6.3 pm2 health + logs (look for the actual exception)
```bash
pm2 describe 4astore-api | grep -E 'status|restarts|uptime|unstable'
pm2 logs 4astore-api --lines 200 --nostream
```
In the logs look for, around the time you ran §6.2:
- Prisma errors: `P2024` (pool timeout), `P1001`/`P1017` (can't reach / connection closed),
  `PrismaClientKnownRequestError`, `Inconsistent query result`, `not valid JSON`,
  `Invalid JSON path`, `JSON_EXTRACT`.
- `UnhandledPromiseRejection` / `unhandledRejection` — this is the **smoking gun** for cause #1.
- A spike in `restarts` or `status` not `online` → the process is crash-looping (cause #3).

### 6.4 DB sanity (is it data, not crash?)
```bash
mysql -uroot -p four_a_store -e "SELECT COUNT(*) AS n FROM orders; \
  SELECT id, order_id, order_status, JSON_VALID(customer) AS cust_valid, \
  JSON_EXTRACT(customer,'\$.mobile') AS cust_mobile FROM orders ORDER BY id DESC LIMIT 5;"
```
- `cust_valid = 0` on any row, or `JSON_EXTRACT` erroring → a malformed `customer` JSON row is
  what makes the Prisma JSON-path `findMany` throw (cause #2 proven at the data layer).
- Table empty / `n = 0` → the app's empty list is just no data, not a crash.

### 6.5 Deploy drift (rule out cause #6)
```bash
cd /var/www/html/api-node && git log --oneline -3 && ls -la dist/routes/orders.js && ls -la src/routes/orders.ts
grep -n "path: '\$.mobile'" dist/routes/orders.js || echo "JSON-path NOT in built dist (drift!)"
```
- If `dist/routes/orders.js` mtime is **older** than the last `orders.ts`/build, or the grep says
  "NOT in built dist", the running code differs from the repo — rebuild/redeploy before trusting
  any other conclusion.

---

## 7. Recommended minimal fix (do NOT apply yet — pending §6 output)

Two layers. **Fix A is mandatory regardless of §6** because it is the reason a failure becomes a
silent hang; **Fix B** targets the specific thrower if §6 confirms cause #2.

### Fix A (root, highest priority) — make async throws return a response instead of hanging
The project is Express 4, so unhandled async rejections never reach the error handler. Pick ONE:

- **Simplest, lowest-risk:** add `import 'express-async-errors';` as the **first** import in
  `src/server.ts` (and add the dep). This monkey-patches the router so any rejected async handler
  is routed to the existing 4-arg error middleware → the client gets the `500`
  `{"success":false,"message":"Server error"}` **immediately** instead of a 15s hang + retry.
  - File: `src/server.ts` (one import line) + `package.json` dependency.
  - Effect: converts every "silent spinner" across the whole API into a fast, visible error — the
    app can then show a real message and stop double-spinning. This alone fixes the "no response /
    button loader ghoomta rehta hai" UX even before the underlying query is fixed.

- **Alternative (no new dep):** wrap each order handler body in `try { … } catch (e) { next(e) }`,
  or add a small `asyncHandler(fn)` wrapper in `src/utils/http.ts` and apply it to the routes in
  `orders.ts`. More code churn; same effect.

### Fix B (the specific thrower) — harden / replace the JSON-path order filter
In `src/routes/orders.ts` `GET /`, the customer branch. Options, least-change first:

1. **Guard + fallback (minimal):** wrap the `findMany` in try/catch; on the JSON-path branch
   failing, fall back to the indexed `user_id`-only query (`where: { user_id: BigInt(viewer.sub) }`).
   Legacy null-`user_id` rows are the only ones that would be missed, and those are being
   backfilled anyway.
2. **Prefer raw, controlled SQL for the mobile match:** replace the Prisma JSON-path `where` with a
   parameterized `prisma.$queryRaw` using `JSON_UNQUOTE(JSON_EXTRACT(customer,'$.mobile')) = ?`
   and guard with `JSON_VALID(customer)`. (Note the existing code comment already warns raw JSON
   returns as a string on MariaDB — so re-map `items`/`customer` with `JSON.parse` before `ok(res)`
   to keep the response shape the client's `normalizeOrder` expects.)
3. **Drop the JSON-path entirely for the owner view:** since `POST /orders` now writes
   `user_id: BigInt(req.user!.sub)` on every new order, the `user_id` FK is the correct, indexed key.
   Use `where: { user_id: BigInt(viewer.sub) }` and backfill `orders.user_id` for legacy rows (a
   one-time `UPDATE orders o JOIN users u ON u.mobile = JSON_UNQUOTE(JSON_EXTRACT(o.customer,'$.mobile')) SET o.user_id = u.id WHERE o.user_id IS NULL`),
   then the JSON-path scan is gone for good (also resolves the latent perf item #4 in PERF-FINDINGS).

**Recommended combination:** ship **Fix A** immediately (converts hangs to fast errors app-wide),
and **Fix B option 1** (guarded fallback to `user_id`) as the surgical order fix, with the §6.4
`JSON_VALID` check deciding whether a data backfill (option 3's UPDATE) is also needed.

### Also worth confirming while here (cause #3, from PERF-FINDINGS)
PERF-FINDINGS already prescribes the tuned pool + `connection_limit`/`pool_timeout` on the LIVE
`.env` and the keep-alive in `src/db.ts` (now uncommitted in the working tree). If §6.3 shows
`P2024` pool-timeout errors, that pool fix must be deployed too, or Fix A will just surface a flood
of fast pool-timeout 500s instead of hangs.

---

## 8. One-line conclusion
Order APIs don't "fail" visibly — they **hang**, because the order route handlers are `async` with
no error plumbing (no `express-async-errors`, no try/catch) on an Express-4 app, so when an order
query throws — most plausibly the `customer` JSON-path `findMany` on MariaDB 10.4 (or a pool
timeout under the pollers) — the request produces **no response at all** until the app's 15s
timeout. Fix the async-error handling first (app-wide), then harden the JSON-path order query to
use the indexed `user_id`. Run §6 to pin cause #2 vs #3 before coding.
