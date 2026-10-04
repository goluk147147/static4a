# Implementation Plan — Extend legacy-JSON importer with Users + Orders (dual-password)

Scope: extend the EXISTING importer in `src/services/dataImport.ts` plus thin wiring in
`routes/admin-data.ts` (none needed — see item 6 rationale), `scripts/import-legacy-json.ts`,
and (documentation only) `prisma/schema.prisma`. No new npm dependency (reuse `bcryptjs`).
Do NOT change orders/auth/rider API behavior or response shapes.

All paths below are relative to the api-node package:
`c:\xampp\htdocs\static4a\.worktrees\legacy-users-orders-import\4astore-v2\api-node`.

---

## Grounding facts discovered during exploration (do not re-derive)

- **Build command:** `npm run build` = `tsc -p tsconfig.json`. `tsconfig.json` has `rootDir: "src"`,
  `include: ["src/**/*.ts"]`, `strict: true`. So the build typechecks `src/` ONLY; it does NOT
  compile `scripts/`. The CLI script runs via `npx ts-node --transpile-only scripts/import-legacy-json.ts`.
- **No test framework** is configured in `package.json` (scripts: dev, build, start, prisma:*, seed:festivals, video:preview). Verification is therefore: successful `npm run build` + a runtime dry-run of the importer against the worktree `data/` + DB row-count/login checks. Do NOT add a test framework for this task — the owner runs a one-shot migration on EC2; runtime verification is the project's real check here.
- **DEFAULT_DATA_DIR** = `path.resolve(__dirname, '..','..','..','..','data')` → resolves at runtime from `src/services/` to the repo-root `data/`. In the worktree that is `c:\xampp\htdocs\static4a\.worktrees\legacy-users-orders-import\data` (confirmed present: 42 users, 16 orders). On EC2 it resolves to `<repo>/data`. The CLI already accepts a positional arg to override it.
- **Login route** (`src/routes/users.ts`): looks up `OR: [{ username: username.toLowerCase() }, { mobile: username }]` and `bcrypt.compareSync(password, user.password)`. Register stores `username: username.toLowerCase()`. **Therefore importUsers MUST store usernames lowercased, and dedup MUST operate on the lowercased value**, or imported users could not log in by username.
- **`safeUser()`** strips only `password`. Because we add `plain_password` as a RAW column that is NOT added to the Prisma model (see item 1 decision), `prisma.user.find*` never selects it, so it is impossible to leak through any existing API. No change to `safeUser` is required. (If a future dev adds it to the model, they must also strip it in `safeUser`.)
- **users.json data reality (42 rows, ids 1–42):** 28 have plaintext `password`; 14 have `passwordHash` (`$2y$...`) only; 0 have neither (so the random-password branch will not fire on this data but MUST still exist). No duplicate usernames after lowercasing (dedup is defensive, won't trigger on current data but is required). Only id 5 (`chhotu`, mobile `7543888698`) collides with the seeded owner mobile.
- **orders.json data reality (16 rows):** paymentMethod is `UPI` (14) or `Cash` (2) — must be preserved, not forced to UPI. Two orders (`4A5B749F7D`, `4A59CC88FF`) reference a `userId` absent from users.json → their `user_id` must be `null`, not rejected. No `paymentReference` field present in the data → `payment_reference` null.
- **Exact DB columns** (from `prisma/schema.prisma`):
  - `users`: id, name(VarChar120), mobile(VarChar15 UNIQUE), username(VarChar64 UNIQUE), email(VarChar190 null), recovery_email(VarChar190 null), recovery_email_verified(Bool default false), password(VarChar255), role(default "customer"), permissions(Json null), backend_rider(Bool default false), custom_delivery(Int null), registered_at(DateTime null), last_login(DateTime null), created_at, updated_at. **plain_password is NOT in the schema — added by raw ALTER (item 1).**
  - `orders`: id, order_id(VarChar20 UNIQUE), user_id(UnsignedBigInt null), customer(Json), items(Json), subtotal/discount/delivery_charge/total_amount(Decimal(10,2)), payment_method(VarChar30 default "UPI"), payment_reference(VarChar12 UNIQUE null), order_status(VarChar40 default "Order Placed"), order_date(DateTime), delivery_address(Json null), rider_id/rider_name/rider_mobile(null), assigned_at/delivered_at(null), created_by(null), reminder_count(Int default 0), created_at, updated_at.

### JSON field → DB column mapping (explicit)

Users (`data/users.json` row → `users` column):
| JSON field | users column | transform |
|---|---|---|
| name | name | verbatim |
| mobile | mobile | verbatim (UNIQUE; guard collisions) |
| username | username | `.toLowerCase()`, then dedup to stay UNIQUE |
| (none) | email | always `null` |
| recoveryEmail | recovery_email | verbatim or null |
| recoveryEmailVerified | recovery_email_verified | `=== true` |
| role | role | `'rider'` if JSON `role === 'rider'`, else `'customer'` |
| backendRider | backend_rider | `=== true` |
| customDelivery | custom_delivery | number → store; else null |
| registeredAt | registered_at | parse ISO; null if absent/invalid |
| lastLogin | last_login | parse ISO; null if absent/invalid |
| password / passwordHash | password | LOGIN hash — see item 2 branches |
| password | plain_password | READABLE — plaintext verbatim, else null |

Orders (`data/orders.json` row → `orders` column):
| JSON field | orders column | transform |
|---|---|---|
| orderId | order_id | verbatim (upsert key) |
| userId | user_id | `userIdMap.get(userId)` → BigInt, else null |
| customer | customer | store whole object as JSON |
| items | items | store whole array as JSON |
| subtotal | subtotal | Number |
| discount | discount | Number (default 0) |
| deliveryCharge | delivery_charge | Number (default 0) |
| totalAmount | total_amount | Number |
| paymentMethod | payment_method | verbatim; default `'UPI'` only if absent |
| (absent) | payment_reference | null |
| orderStatus / status | order_status | orderStatus, else status, else `'Order Placed'` |
| orderDate | order_date | parse ISO (required — fallback `new Date()` if invalid) |
| customer | delivery_address | build from customer object if present, else null |
| — | rider_* / assigned_at / delivered_at / created_by | null / default |

---

## Items

- [ ] 1. Add the guarded, idempotent `plain_password` column via a new exported helper `ensurePlainPasswordColumn()` in `dataImport.ts`, and call it at the START of `importUsers`.
      Use `prisma.$executeRawUnsafe` (NO prisma migrate / db push). Guard by querying
      `information_schema.columns` for schema `DATABASE()` + table `users` + column `plain_password`;
      only run `ALTER TABLE users ADD COLUMN plain_password VARCHAR(255) NULL` when absent. Wrap the
      ALTER in try/catch that swallows MySQL duplicate-column error (code 1060 / message contains
      "Duplicate column") so concurrent/re-runs never crash. Add a prominent code comment: this is a
      DELIBERATE, OWNER-APPROVED readable-password store so an admin can tell a rural customer their
      password by phone — a conscious deviation from best practice, kept alongside the bcrypt hash.
      DECISION: do NOT add `plain_password` to `prisma/schema.prisma` as a real selectable field —
      keeping it out of the Prisma model means `prisma.user.find*` and `safeUser()` can never leak it
      through the users API. Optionally add it as a `/// doc` comment line in schema.prisma for
      documentation, but if added, do NOT run migrate/db push. State this choice in the code comment.
      Files: src/services/dataImport.ts (+ optional doc-only comment in prisma/schema.prisma)
      Verify: `npm run build` compiles clean (strict mode). Column creation is verified at runtime in item 7.

- [ ] 2. Add exported `async function importUsers(dataDir = DEFAULT_DATA_DIR)` to `dataImport.ts`.
      Signature returns `Promise<{ userIdMap: Map<number, bigint>; imported: number; renamed: number; skipped: number; noReadable: number }>`.
      Steps:
      (a) `await ensurePlainPasswordColumn()`.
      (b) Define a `LegacyUser` interface (id, name, mobile, username, password?, passwordHash?, registeredAt?, lastLogin?, role?, backendRider?, customDelivery?, recoveryEmail?, recoveryEmailVerified?). Read `users.json`.
      (c) For each row, compute password branches:
          - plaintext `password` present → `password = bcrypt.hashSync(password, 10)`, `plain_password = password` (verbatim).
          - else `passwordHash` present (`$2y$...`) → `password = passwordHash.replace(/^\$2y\$/, '$2b$')`, `plain_password = null`. (bcryptjs verifies `$2b$`; PHP emits `$2y$` which bcryptjs rejects — the swap is required for login to work.)
          - else neither → `password = bcrypt.hashSync(randomBytes(16).toString('hex'), 10)`, `plain_password = null`, increment `noReadable` and `console.log` the user id/mobile. (Won't fire on current data but must exist.)
          Also increment `noReadable` for the `$2y$` branch (no readable available).
      (d) `username = String(row.username).toLowerCase()`. Maintain an in-memory `Set<string>` of used lowercased usernames across this run; on collision, deterministically rename by appending `-<oldId>` (e.g. `chhotu kumar-35`); if STILL colliding, append `-2`, `-3`… Keep within VarChar(64). `console.log` EVERY rename (old → new, with id). Increment `renamed`. Never silently drop.
      (e) OWNER COLLISION: if `row.mobile === '7543888698'` → SKIP the row entirely, `console.log` a note, increment `skipped`, continue (owner is owned by `seedDefaultOwner()`).
      (f) MOBILE collision guard: also keep a `Set<string>` of used mobiles this run; if a non-owner row repeats a mobile already inserted, `console.log` and skip (increment `skipped`) — mobile is UNIQUE and we must not crash.
      (g) Persist each user idempotently keyed by UNIQUE `mobile`, writing `plain_password` too. Because `plain_password` is not a Prisma field, use raw SQL upsert:
          `INSERT INTO users (name, mobile, username, email, recovery_email, recovery_email_verified, password, role, permissions, backend_rider, custom_delivery, registered_at, last_login, plain_password) VALUES (?, …) ON DUPLICATE KEY UPDATE name=VALUES(name), username=VALUES(username), recovery_email=VALUES(recovery_email), recovery_email_verified=VALUES(recovery_email_verified), password=VALUES(password), role=VALUES(role), backend_rider=VALUES(backend_rider), custom_delivery=VALUES(custom_delivery), registered_at=VALUES(registered_at), last_login=VALUES(last_login), plain_password=VALUES(plain_password)` — permissions NULL for imported users; dates as JS `Date` or null; booleans as 1/0.
      (h) Build the oldId→newId map by READING BACK each inserted/updated row via its UNIQUE mobile: after the loop, `prisma.user.findMany({ where: { mobile: { in: insertedMobiles } }, select: { id: true, mobile: true } })`, then map each legacy `row.id` (number) → `user.id` (bigint) by matching mobile. Do NOT assume autoincrement order. Owner-collision-skipped legacy id 5 is intentionally absent from the map (its orders fall back to user_id null, which is correct).
      Files: src/services/dataImport.ts
      Verify: `npm run build` compiles clean. Behavior verified in item 7 runtime run (expect imported=41, skipped=1, noReadable=14 on current data).

- [ ] 3. Add exported `async function importOrders(dataDir = DEFAULT_DATA_DIR, userIdMap: Map<number, bigint>)` to `dataImport.ts`.
      Returns `Promise<number>` (count upserted). Define a `LegacyOrder` interface. Read `orders.json`.
      For each order build the row per the Orders mapping table above:
      - `user_id = userIdMap.get(Number(o.userId)) ?? null` (never reject on miss).
      - `customer` and `items` stored as JSON (pass the objects/arrays through — Prisma Json columns, or `JSON.stringify` for raw).
      - decimals via `Number(...)` with 0 fallbacks for discount/deliveryCharge.
      - `payment_method = o.paymentMethod ?? 'UPI'` (preserve `Cash`).
      - `payment_reference = o.paymentReference ?? null`.
      - `order_status = o.orderStatus ?? o.status ?? 'Order Placed'`.
      - `order_date = parseDate(o.orderDate) ?? new Date()`.
      - `delivery_address` = the customer object if present, else null.
      Upsert idempotently by UNIQUE `order_id`: `prisma.order.upsert({ where: { order_id }, create: {...}, update: {...} })` (Prisma supports all these columns; `customer`/`items`/`delivery_address` are Json). Return the processed count.
      Files: src/services/dataImport.ts
      Verify: `npm run build` compiles clean. Runtime verified in item 7 (expect 16 orders, 2 with user_id null).

- [ ] 4. Add a small shared `parseDate(v): Date | null` helper in `dataImport.ts` (returns null for falsy/invalid) and reuse it in importUsers (registered_at/last_login) and importOrders (order_date, with its own `?? new Date()` fallback). Keep it module-private.
      Files: src/services/dataImport.ts
      Verify: `npm run build` compiles clean.

- [ ] 5. After `seedDefaultOwner()` creates the owner, set the owner's readable password so phone support works for the owner too: in `seedDefaultOwner`, immediately after `prisma.user.create`, run `await prisma.$executeRawUnsafe('UPDATE users SET plain_password = ? WHERE username = ?', 'owner@7543', 'owner')`. Guard with `ensurePlainPasswordColumn()` first (so the column exists even if reset runs before any import). This keeps owner login unchanged (bcrypt of `owner@7543`) while recording the readable value.
      Files: src/services/dataImport.ts
      Verify: `npm run build` compiles clean; runtime check in item 7 confirms owner `plain_password = 'owner@7543'`.

- [ ] 6. Wire users + orders into `runImport()` so BOTH the admin route and the CLI seed them, ORDER users-before-orders.
      DECISION & RATIONALE: add `importUsers()` then `importOrders(result.userIdMap)` to the END of `runImport()` (after catalogue/config/settings/announcement). The owner's intent is an end-to-end "reset → import reloads EVERYTHING". The existing `import = catalogue only` wording in the CLI/route header comments is just documentation, not an API contract consumed elsewhere; a grep shows `runImport` is called only by `admin-data.ts` and the CLI, both of which should seed users+orders. Keeping it in `runImport` means POST `/api/admin/data/import` and the CLI stay in lockstep with ONE code path — simplest and matches the task's preferred option. Extend the `ImportSummary` interface with `users: number`, `orders: number`, `usersSkipped: number`, `usersRenamed: number`, `usersNoReadable: number`. Update the header JSDoc of `dataImport.ts` and `scripts/import-legacy-json.ts` to drop the stale "users/orders are NOT imported" claim.
      Files: src/services/dataImport.ts
      Verify: `npm run build` compiles clean (summary shape change typechecks against admin-data.ts and the CLI).

- [ ] 7. Dry-run the full importer against the worktree `data/` and confirm counts + owner login, WITHOUT changing any production data path. Requires a reachable MySQL from `DATABASE_URL` in `.env`.
      Run from api-node/: `npx ts-node --transpile-only scripts/import-legacy-json.ts` (uses DEFAULT_DATA_DIR → worktree `data/`). It is safe to re-run (idempotent). To exercise the full reset→import contract against a scratch DB, optionally point `DATABASE_URL` at a disposable schema first.
      Expected console: `categories=15 products=202 banners=<n> ... users=41 orders=16` and rename/skip logs noting the `7543888698` owner-collision skip (legacy id 5).
      Then verify via SQL (any mysql client):
      - `SELECT COUNT(*) FROM users;` → 42 (41 imported + seeded owner).
      - `SELECT COUNT(*) FROM users WHERE role='owner';` → 1.
      - `SELECT plain_password FROM users WHERE username='owner';` → `owner@7543`.
      - `SELECT COUNT(*) FROM users WHERE plain_password IS NOT NULL;` → 29 (28 plaintext users + owner).
      - `SELECT COUNT(*) FROM orders;` → 16; `SELECT COUNT(*) FROM orders WHERE user_id IS NULL;` → 2.
      - `SELECT COUNT(*) FROM categories;` → 15; `SELECT COUNT(*) FROM products;` → 202.
      - `SELECT COUNT(*) FROM addresses;` → 0 (addresses.json intentionally NOT imported).
      And confirm owner login still works (see run instructions curl).
      Files: none (verification only)
      Verify: all SQL counts match the expected values above; owner login returns a token.

- [ ] 8. Update the CLI final log in `scripts/import-legacy-json.ts` to print the new counts and refresh the header comment.
      Change the `console.log(\`Done: ...\`)` to also include `users=${r.users} orders=${r.orders} (skipped=${r.usersSkipped}, renamed=${r.usersRenamed}, noReadable=${r.usersNoReadable})`. Keep `DEFAULT_DATA_DIR = repo-root data/` and the existing positional-arg override untouched. Remove the "Users and orders are NOT imported" paragraph from the top comment and note they are now included.
      Files: scripts/import-legacy-json.ts
      Verify: `npx ts-node --transpile-only scripts/import-legacy-json.ts` prints the users/orders counts line (confirmed during item 7's run).

- [ ] 9. Write the EC2 run instructions to `.agents/tasks/RUN-ON-EC2.md` (new file). Must contain, in order:
      1. **Backup first:** `mysqldump -u <user> -p <dbname> > ~/4astore-backup-$(date +%F-%H%M).sql` (and note how to restore).
      2. **Resolve the data dir:** DEFAULT_DATA_DIR resolves from `src/services/` up to `<repo>/data`. Show how to override: positional arg `npx ts-node --transpile-only scripts/import-legacy-json.ts /abs/path/to/data`, and remind that only `data/` (NOT `data1/`) is correct.
      3. **Build:** `cd <repo>/4astore-v2/api-node && npm ci && npm run build` (build typechecks src/; the CLI runs via ts-node).
      4. **Option A — CLI (recommended for the one-shot migration):** `npx ts-node --transpile-only scripts/import-legacy-json.ts`. Note it does NOT truncate; to get the clean "truncate everything then reload" use the API reset first (Option B) or truncate manually.
      5. **Option B — owner-only API (full reset + import):**
         - Get owner token: `curl -s -X POST https://<host>/api/users/login -H 'Content-Type: application/json' -d '{"username":"owner","password":"owner@7543"}'` → copy `token`.
         - Reset (DESTRUCTIVE — wipes all tables incl. users/orders/addresses, re-seeds owner): `curl -X POST https://<host>/api/admin/data/reset -H "Authorization: Bearer <TOKEN>" -H 'Content-Type: application/json' -d '{"confirm":"RESET"}'`.
         - Import (reloads catalogue + config + banners + NOW users + orders): `curl -X POST https://<host>/api/admin/data/import -H "Authorization: Bearer <TOKEN>"`.
         - Status: `curl https://<host>/api/admin/data/status -H "Authorization: Bearer <TOKEN>"`.
      6. **Verification SELECTs:** the exact queries from item 7.
      7. **Owner login re-check:** repeat the login curl after reset+import; expect HTTP 200 with a token.
      8. **SECURITY CAVEAT (prominent):** `plain_password` stores customer passwords in CLEARTEXT by explicit owner request (phone support for rural customers). This is a deliberate deviation from best practice. Restrict DB access, never expose this column via any API (it is intentionally kept out of the Prisma model so `safeUser`/user endpoints cannot return it), exclude it from logs/backups shared externally, and consider dropping it once phone support is no longer needed.
      Files: .agents/tasks/RUN-ON-EC2.md
      Verify: file exists and contains all 8 sections with concrete, runnable commands.

---

## Notes / assumptions

- No decomposition into FEAT artifacts: this is one tightly-coupled change inside a single service file (importUsers → userIdMap → importOrders → runImport wiring + ALTER ordering). Splitting would cut artificial seams through one file with no independent-verifiability gain. The existing implement-and-review loop runs this plan.
- `payment_reference` is VARCHAR(12) UNIQUE but nullable; MySQL allows multiple NULLs, so leaving it null for all 16 orders is safe.
- The two "orphan" orders (`4A5B749F7D`, `4A59CC88FF`) keep `user_id = null` by design — their customer snapshot is still stored in the `customer` JSON column, so no order data is lost.
- Current data produces: users imported=41, skipped=1 (owner mobile), renamed=0, noReadable=14 (the `$2y$` hash-only accounts). These are the expected item-7 numbers; the dedup/mobile-guard/random-password branches are required for correctness but will not fire on this dataset.
