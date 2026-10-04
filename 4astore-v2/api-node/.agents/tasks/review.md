# Legacy users + orders import with dual-password scheme

The change extends the existing shared legacy-JSON importer (`src/services/dataImport.ts`) so a full reset-and-reload now also seeds users and orders, not just the catalogue. Users get a dual-password treatment: a bcrypt hash for login plus an owner-approved readable `plain_password` column (added by a guarded raw ALTER, kept out of the Prisma model) for phone support. Orders are remapped to the new user ids via an old→new map read back by unique mobile, with orphan orders kept at `user_id = null`. Users are imported before orders inside `runImport()`, so the admin API and the CLI share one path; the catalogue importers are untouched and addresses are intentionally not imported. The evidence (`verification.md`) records a clean `tsc --noEmit` (exit 0) and a correctness trace against the real `data/*.json`; no live DB run was done in the worktree, which is acceptable given the one-shot EC2 migration path.

Watch for: one off-by-one in the EC2 runbook's verification SELECT comment (`plain_password NOT NULL → 29`, actual is 28 because the owner-mobile row is skipped) — **confirmed**, documentation-only, non-blocking. Everything else — password branches, dedup/guards, owner skip, id remap, order mapping, idempotency, no new dependency, no API/response-shape change — checks out against the data and the schema.

**Verdict**: APPROVED

## High-level view

The readable-password store is handled the right way for a deliberate security exception. `ensurePlainPasswordColumn()` adds `plain_password` with a guarded, idempotent raw ALTER (information_schema check plus a swallow of MySQL error 1060) and no prisma migrate. The column is deliberately absent from the Prisma `User` model, so `prisma.user.find*` never selects it and the existing `safeUser()` cannot leak it through any API — a clean way to honor the owner's request without widening the API surface. The security caveat is spelled out in both the code and the EC2 runbook.

The user import covers every password branch the task requires, even the ones the current data never exercises. Plaintext passwords become bcrypt(10) with the plaintext mirrored into `plain_password`; PHP `$2y$` hashes get the `$2b$` prefix swap bcryptjs needs and a null readable; a missing password produces a random bcrypt hash, null readable, and a log line. Username dedup runs on the lowercased value (matching the login lookup), logs every rename, and never drops a row; a repeated mobile is skipped; the `7543888698` owner row is skipped so `seedDefaultOwner()` stays authoritative. The old→new id map is built by reading rows back on unique mobile rather than trusting autoincrement order.

Order import resolves `user_id` through that map, keeps orphans at null rather than rejecting them, stores customer/items as JSON, preserves the real payment method (UPI/Cash), captures the one real 12-char `paymentReference` present in the data (and nulls it otherwise), and upserts idempotently by `order_id`.

The wiring puts users before orders in `runImport()` and leaves the catalogue importers and all orders/auth/rider API behavior untouched. No npm dependency was added (`crypto` is a Node builtin, `bcryptjs` already present). The one defect is a stale expected-count comment in the runbook; the code and the trace both land on the correct value.

<details>
<summary>Issues (2)</summary>

1. **Runbook count off by one** — `.agents/tasks/RUN-ON-EC2.md` §6 states `SELECT COUNT(*) FROM users WHERE plain_password IS NOT NULL; -- 29 (28 plaintext users + owner)`. The owner-mobile row (legacy id 5, a plaintext user) is skipped, so 27 imported customers + owner = **28**. `verification.md` already corrected this to 28; update the runbook SELECT comment to match so the operator doesn't read a correct import as a failure. Non-blocking.
2. **`delivery_address` left stale on re-import if a future order drops its customer** — in `importOrders`, `delivery_address: deliveryAddress ?? undefined` means "don't update this column" on the upsert's UPDATE branch when both `deliveryAddress` and `customer` are absent. All 16 current orders carry a customer object so this never fires today; it's a latent edge, not a current bug. Possible — worth a null (not undefined) if you want re-imports to be able to clear the field. Non-blocking.

</details>

<details>
<summary>Details</summary>

### plain_password: guarded column, kept off the Prisma model

`ensurePlainPasswordColumn()` queries `information_schema.columns` under `DATABASE()` and only runs `ALTER TABLE users ADD COLUMN plain_password VARCHAR(255) NULL` when absent, inside a try/catch that rethrows anything that is not a duplicate-column error (`/1060|Duplicate column/i`) — idempotent and safe under a concurrent second runner. It is called at the top of both `importUsers` and `seedDefaultOwner`, so the column exists whether or not a reset seeds the owner before any import runs.

The decision not to add `plain_password` to the Prisma `User` model is the load-bearing security control: because the model does not declare it, `prisma.user.find*` never selects it and `safeUser()` (which strips only `password`) has nothing to strip — the readable value cannot escape through the users or auth endpoints. The schema carries a doc-only commented line instructing that anyone who later promotes it to a real field MUST also strip it in `safeUser()`. The exception is narrow, documented, and structurally prevented from leaking rather than relying on every future query remembering to exclude the column.

### Password branches

```
plaintext password  -> password = bcrypt.hashSync(pwd, 10);  plain_password = pwd
$2y$ hash only       -> password = pwd.replace(/^\$2y\$/, '$2b$');  plain_password = null;  noReadable++
neither              -> password = bcrypt(random 16 bytes hex);  plain_password = null;  noReadable++;  logged
```

The `$2y$`→`$2b$` swap is required, not cosmetic: bcryptjs rejects the `$2y$` prefix PHP emits, so without the swap those 14 accounts could never log in. The branch order checks `password` (plaintext) before `passwordHash`, which matches the data — no row carries both in a way that would conflict. The random-password branch never fires on the current 42 rows (0 have neither) but is present and logs the affected id, as required. Against the real file this yields 28 plaintext, 14 hash-only, 0 neither, so `noReadable = 14`.

### Dedup, mobile guard, and owner skip

Usernames are lowercased before both the dedup check and the insert, which is correct because the login route looks users up by `username.toLowerCase()`; deduping on the raw value would let a casing variant slip past and then fail at the unique index. On a collision the code appends `-<legacyId>`, then `-2`, `-3`… if still colliding, truncates to 64 chars, logs the rename, and never drops the row.

Worth noting against the task framing: the "duplicates" in the data are name-level, not username-level. Legacy id 5 ("Chhotu kumar", username `chhotu`) and id 35 ("Avinash Gupta", username `chhotu kumar`) are distinct usernames; the two "lalit chaudhary" rows (id 36 username `prasun anand`, id 37 username `lalit chaudhary`) also differ at the username level. All 42 lowercased usernames are unique, so `renamed = 0` on this data. Deduping on username rather than name is the correct call here precisely because login is username-based — the name collisions are irrelevant to login uniqueness.

The owner-mobile skip fires on exactly one row: legacy id 5 has mobile `7543888698`, equal to the seeded owner, so it is skipped before any insert (`skipped = 1`) and `seedDefaultOwner()` stays authoritative for that login. The mobile-collision guard (a `Set` of used mobiles) protects the unique index against a repeat; no repeat exists in the data, so it is defensive. Net: 41 imported + seeded owner = 42 logins.

### oldId → newId map by read-back

After the insert loop, the map is built by `prisma.user.findMany({ where: { mobile: { in: insertedMobiles } }, select: { id, mobile } })` and matching legacy `row.id` to the DB id via mobile. This avoids assuming autoincrement order, which matters because an upsert against existing rows would not produce sequential ids. The owner-skipped legacy id 5 is deliberately absent from the map, so its orders correctly fall through to `user_id = null`.

### Order mapping and idempotency

`user_id = o.userId != null ? userIdMap.get(Number(o.userId)) ?? null : null` keeps orphan orders rather than rejecting them — the two orders with a null `userId` (`4A5B749F7D`, `4A59CC88FF`) land at `user_id = null` with their customer snapshot preserved in the `customer` JSON column. `payment_method` is `o.paymentMethod ?? 'UPI'`, so the 14 UPI and 2 Cash values are preserved rather than forced. `payment_reference` is `o.paymentReference ?? null`; the one order that carries a reference (`4A698686` → `708338085028`, exactly 12 chars) fits the `VARCHAR(12)` unique column, and the nullable unique column tolerates the 15 nulls. `order_status` falls back `orderStatus ?? status ?? 'Order Placed'`, and `order_date` uses `parseDate(...) ?? new Date()`. The upsert is keyed on the unique `order_id`, so re-runs update in place. `customer`/`items` are required `Json` columns and are always supplied; `delivery_address` is `Json?` and is omitted via `undefined` when absent (see issue 2 for the one latent edge).

### Wiring, scope, and constraints

`runImport()` runs the catalogue/config/settings/announcement importers unchanged, then `importUsers()` and `importOrders(usersResult.userIdMap)` — users strictly before orders so the id map exists when orders are mapped. The `ImportSummary` interface gained `users`, `orders`, `usersSkipped`, `usersRenamed`, `usersNoReadable`, and the CLI prints them. The contract decision is stated in both the file header and the verification notes: the old "users/orders NOT imported" wording was documentation, not a consumed API contract, and `runImport` is called only by the admin route and the CLI, so folding users+orders into the single path keeps them in lockstep — a reasonable, clearly-justified choice. addresses.json is not imported, as required. No npm dependency was added: `package.json` is untouched by the commit, `bcryptjs` was already a dependency, and `crypto` is a Node builtin. The commit touches only the importer, the CLI, the schema comment, and task docs — orders/tracking/rider/auth routes and response shapes are not modified.

### Verification evidence

`verification.md` records `tsc --noEmit` exit 0 with zero new type errors (run via the sibling package's fully-installed compiler against the worktree tsconfig, because the worktree's own typescript install was incomplete) and a line-by-line correctness trace against the real data files, including the id-5 owner-skip count correction (plan said 29, trace corrects to 28). No live DB dry-run was performed because the worktree has no `.env`/`DATABASE_URL` and a scratch run would write a real local DB; the trace plus the EC2 runbook stand in for runtime verification, which is acceptable for this one-shot migration. The EC2 instructions are concrete and copy-paste-ready: backup, data-dir resolution (with the `data/` not `data1/` reminder), build, CLI option, owner-only reset+import API option with exact curls, verification SELECTs, owner login re-check, and a prominent security caveat. The spot-checks I ran against `data/users.json` and `data/orders.json` confirm the counts the trace relies on (42 users / 28 plaintext / 14 hash-only / 0 neither; 16 orders / 2 null userId / UPI 14 / Cash 2 / one 12-char payment reference).

</details>

<details>
<summary>File map</summary>

- `src/services/dataImport.ts` — adds `parseDate`, `ensurePlainPasswordColumn`, `importUsers`, `importOrders`; extends `ImportSummary`; wires users-before-orders into `runImport`; sets owner `plain_password` in `seedDefaultOwner`; header JSDoc updated.
- `scripts/import-legacy-json.ts` — header no longer claims users/orders are skipped; final log prints users/orders/skipped/renamed/noReadable; positional-arg override and `DEFAULT_DATA_DIR` unchanged.
- `prisma/schema.prisma` — doc-only commented `plain_password` line on `User` explaining the raw column kept out of the model; no migrate/db push.
- `.agents/tasks/RUN-ON-EC2.md` — full EC2 runbook (backup, data-dir, build, CLI + API reset/import, verification SELECTs, owner login, security caveat). See issue 1 for the one stale count comment.

Full diff: `git show HEAD` on branch `legacy-users-orders-import` (commit `498ebcc`, scoped to the five files above).

</details>
