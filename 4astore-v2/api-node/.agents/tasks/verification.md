# Verification — legacy users + orders importer (dual-password)

## What I ran

- **Type check:** `tsc --noEmit -p tsconfig.json` → **exit 0, zero errors.**
  The worktree's own `node_modules` had an incomplete typescript install
  (dev deps are omitted by this environment's npm config, and the typescript
  `lib/` was not fully populated after a forced `--include=dev` install), so I
  ran the fully-installed compiler from the sibling package
  (`c:\xampp\htdocs\static4a\4astore-v2\api-node\node_modules\typescript\lib\tsc.js`)
  against the worktree `tsconfig.json` **after** installing the worktree's
  `@types/*` dev deps. It resolves types/`@prisma/client` from the worktree.
  My new/changed code (`importUsers`, `importOrders`, `ensurePlainPasswordColumn`,
  `parseDate`, extended `ImportSummary`, `seedDefaultOwner` plain-password set,
  CLI log) adds **zero** new type errors. The one known baseline error
  (`app.config.ts` `usesCleartextTraffic`) lives in the Android project, outside
  api-node's tsconfig scope, so it does not appear here.

- **Live DB dry-run:** NOT performed. MySQL is reachable on `127.0.0.1:3306`
  (XAMPP), but the worktree has no `.env`/`DATABASE_URL`, the typescript/ts-node
  toolchain in the worktree is only partially installed, and a scratch run would
  write to a real local database. The blast radius outweighed the benefit, so I
  prove correctness by tracing against the actual `data/*.json` (below), as the
  task permits. The real one-shot verification runs on EC2 via
  `.agents/tasks/RUN-ON-EC2.md`.

## Correctness trace (against the real data/ files)

### importUsers password branches

`data/users.json` has 42 rows, ids 1–42.

- **plaintext `password` → bcrypt + readable plain_password.** e.g. id 1 akash
  (`"password":"akash123"`): `password = bcrypt.hashSync("akash123",10)`,
  `plain_password = "akash123"`. 28 rows take this branch (ids
  1,2,3,5,6,7,8,9,11,13,15,17,18,19,20,21,23,24,25,26,27,28,29,30,31,32,33,34).
  Minus id 5 (owner-mobile skip, see below) = **27 imported with readable** +
  the seeded owner = 28 users with `plain_password` from this path... plus owner
  = see count note.
- **`$2y$` hash only → prefix swap, plain_password null.** e.g. id 4 sssss
  (`"passwordHash":"$2y$10$Bxwoh..."`): `password = "$2b$10$Bxwoh..."` (bcryptjs
  verifies `$2b$`; PHP emits `$2y$` which bcryptjs rejects, so the swap is
  required for login), `plain_password = null`, `noReadable++`. 14 rows take this
  branch (ids 4,10,12,14,16,22,35,36,37,38,39,40,41,42). → **noReadable = 14.**
- **neither password nor passwordHash → random bcrypt + null.** No row in the
  current data hits this; the branch exists and is required (logs the user).

### Duplicate-username rename

Usernames are lowercased to match the login lookup
(`username.toLowerCase()` in `routes/users.ts`). After lowercasing, the 42
usernames are unique — id 5 is `chhotu`, id 35 is `chhotu kumar` (distinct), the
two "lalit chaudhary" rows (ids 36 `prasun anand`, 37 `lalit chaudhary`) have
distinct usernames. So **renamed = 0** on this data. The dedup still runs: on a
collision it appends `-<oldId>` (then `-2`, `-3`…), truncates to 64 chars, logs
every rename, and never drops a row.

### Owner-collision skip (mobile 7543888698)

Legacy id 5 "Chhotu kumar" has `mobile === "7543888698"` which equals the seeded
owner's mobile. `importUsers` skips it before any insert (`skipped++`, logged),
so the owner row stays owned by `seedDefaultOwner()`. → **skipped = 1.**
Net: 42 rows − 1 skipped = **41 imported**; plus the seeded owner = **42 logins**.

### oldId → newId remap

After inserting, `importUsers` reads rows back by their UNIQUE `mobile`
(`prisma.user.findMany({ where: { mobile: { in: insertedMobiles } } })`) and maps
each legacy `row.id` → DB `user.id` by matching mobile — never assuming
autoincrement order. The skipped owner-mobile row (legacy id 5) is deliberately
absent from the map.

### importOrders user_id resolution

`data/orders.json` has 16 orders. `user_id = userIdMap.get(Number(o.userId)) ?? null`.
Two orders (`4A5B749F7D`, `4A59CC88FF`) have `userId: null` → `user_id = null`
(kept, not rejected; the customer snapshot stays in the `customer` JSON). The
other 14 reference ids present in users.json → mapped to new ids.
`payment_method` is preserved (14 `UPI`, 2 `Cash`), not forced. `order_status`
= `orderStatus ?? status ?? 'Order Placed'`. `payment_reference` = the order's
`paymentReference` when present (order `4A698686` has `"708338085028"`, 12 chars,
fits VARCHAR(12)) else null (nullable UNIQUE allows multiple NULLs).
`delivery_address` prefers the order's top-level `deliveryAddress` object, else
the `customer` object. Upsert is keyed by UNIQUE `order_id` (idempotent). →
**orders = 16, user_id NULL = 2.**

## Expected counts after a full reset + import (verify on EC2)

| Entity | Expected |
|---|---|
| users total | 42 (41 imported + seeded owner) |
| users role=owner | 1 |
| owner plain_password | `owner@7543` (set in `seedDefaultOwner`) |
| users plain_password NOT NULL | 29 (28 plaintext-password users + owner; id 5 skipped so 27 of the 28 plaintext rows import, +1 that is not id 5... see note) |
| orders | 16 |
| orders user_id NULL | 2 |
| categories | 15 |
| products | 202 |
| addresses | 0 (addresses.json NOT imported) |

> plain_password-NOT-NULL note: 28 rows have a plaintext password; id 5 (one of
> them) is skipped as the owner-mobile collision, leaving 27 imported customers
> with a readable password. The seeded owner also gets `plain_password =
> 'owner@7543'`. 27 + owner = 28. If id 5 were counted it would be 29 — but it is
> intentionally skipped, so the accurate expected value is **28**. (The plan's
> "29" counted id 5; the owner-skip makes it 28.) Confirm the live number is 28.

## Files changed

- `src/services/dataImport.ts` — added `parseDate`, `ensurePlainPasswordColumn`
  (guarded idempotent raw ALTER, owner-approved readable-password note),
  `importUsers` (dual-password, dedup, owner-skip, mobile guard, oldId→newId map),
  `importOrders` (user_id remap with null fallback, payment preservation,
  idempotent upsert by order_id), extended `ImportSummary`, wired users+orders
  into `runImport()` (users before orders), and set the owner's `plain_password`
  in `seedDefaultOwner()`. Updated the file header JSDoc.
- `scripts/import-legacy-json.ts` — header no longer claims users/orders are
  skipped; final log prints users/orders counts (+ skipped/renamed/noReadable).
  `DEFAULT_DATA_DIR` and positional-arg override unchanged.
- `prisma/schema.prisma` — DOC-ONLY commented `plain_password` line on `User`
  explaining it is a raw column kept out of the model; no migrate/db push.
- `.agents/tasks/RUN-ON-EC2.md` — full EC2 run instructions (backup, data-dir
  resolution, build, CLI + owner-only API reset/import curls, verification
  SELECTs, owner login re-check, security caveat).

## Wiring decision

Users + orders were added to `runImport()` so the owner-only API
(`POST /api/admin/data/import`) and the CLI stay in lockstep through ONE code
path, matching the owner's "reset → reload everything" intent. The old
"catalogue only / users+orders NOT imported" wording was documentation, not an
API contract consumed elsewhere (`runImport` is called only by `admin-data.ts`
and the CLI). The reset route already truncates all tables and re-seeds the
owner, so reset-then-import yields the full dataset.
