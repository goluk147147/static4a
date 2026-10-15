# Verification — POS login must never downgrade an existing account

## The bug

File: `4astore-v2/api-node/src/routes/pos-auth.ts`, handler `POST /otp/verify`
(mounted at `/api/pos/auth`). After OTP verification the route derives
`role`/`permissions` from the `admin_phones` allowlist row:

```ts
const isOwner = String(phone.role) === 'owner';
const role = isOwner ? 'owner' : 'admin';
const permissions = isOwner ? ['*'] : normalizePerms(phone.permissions);
```

The EXISTING-user branch then blindly overwrote role + permissions:

```ts
if (existing) {
  user = await prisma.user.update({
    where: { mobile },
    data: { role, permissions, last_login: new Date() },   // <-- blind overwrite
  });
}
```

So an account that already outranks the allowlist entry gets DEMOTED on POS
login. This happened in production: an **owner** whose number was present in
`admin_phones` as a limited `staff` entry became `role=admin` with
`permissions=["orders","dashboard"]`.

Authorization model (`src/auth/middleware.ts`): `STAFF_ROLES =
['owner','superadmin','admin']`; `hasPermission` grants ALL permissions to
`owner`/`superadmin`, while `admin` is gated by its `permissions[]` list (`'*'`
meaning all).

## The rank rule — "POS login may raise or keep privileges, never reduce them"

Rank mapping (`roleRank`): `owner = superadmin = 3` (both get all permissions
via `hasPermission`, so they are equal-top) `> admin = 2 > rider/customer/
unknown = 1`.

Decision (`decidePosLogin`):

- `rank(existing) > rank(allowlist)` → **keep** the existing role AND the
  existing permissions unchanged (only `last_login` updates). This is the fix:
  an existing owner/superadmin logging in through a `staff` entry stays as they
  are.
- `rank(allowlist) > rank(existing)` → **upgrade** to the allowlist role +
  permissions (unchanged from today's behaviour — a plain customer/new staff
  gets staff access).
- EQUAL rank (both resolve to `admin`) → keep role `admin` and persist the
  **union** of existing + allowlist permissions. `unionPerms` de-dupes and
  collapses to `['*']` if either side has `'*'`, so an equal login can only keep
  or grow the permission set, never shrink it.

The NEW-user (`create`) branch is UNCHANGED — a brand-new POS number still gets
exactly the allowlist role/permissions. The response shape
(`safeUser(user) + token + refreshToken on mobile`), the OTP-consume
(`emailOtp.update consumed`), and the `issueTokens`/`isMobileClient` flow are
untouched; they read the final persisted `user` object.

## Pure-function design (testability)

New file `src/auth/pos-login-decision.ts` (co-located with `session.ts` /
`middleware.ts`). It exports plain-value functions with no Prisma / Express
dependency, so they unit-test without a database (matching the
`posBilling.test.ts` import-a-pure-function pattern):

- `roleRank(role: string): number`
- `unionPerms(a: string[], b: string[]): string[]`
- `decidePosLogin({ existingRole, existingPermissions, allowlistRole, allowlistPermissions }): { role, permissions }`

A header comment states the no-downgrade rule and the production incident so it
is not "simplified" back into a blind overwrite. The route's existing-user
branch calls `decidePosLogin(...)` and uses the returned `{ role, permissions }`
in `prisma.user.update(...)`, with an inline comment referencing the incident.

## Defensive guard (step 4 — DONE, trivial)

`src/routes/admin-pos.ts`, `POST /phones`: before the INSERT, if
`mobile === OWNER_MOBILE && role !== 'owner'` the request is rejected with 409
("The owner's own number must stay role=owner."). This is a two-line guard
reusing the existing hard-coded `OWNER_MOBILE` constant and mirrors the
pre-existing owner-number guard in the DELETE handler, so it was obviously
trivial and was applied. It stops the exact misconfiguration (owner number saved
as a limited `staff` row) that triggered the incident from being created in the
first place.

## Test result

Command: `npm test`
(`node --import ./src/__tests__/register.mjs --test "src/__tests__/**/*.test.ts"`)

Result: **PASS** — `tests 46, pass 46, fail 0`.

New suite `src/__tests__/posLoginDecision.test.ts` (9 tests), all passing:

- `roleRank: owner === superadmin > admin > rest`
- `unionPerms: de-duped union, with "*" collapsing to ["*"]`
- `PRODUCTION INCIDENT: existing owner + limited staff allowlist entry STAYS owner`
- `existing superadmin + allowlist admin STAYS superadmin`
- `existing customer + allowlist admin UPGRADES to admin with allowlist perms`
- `existing customer + allowlist owner UPGRADES to owner`
- `EQUAL admin: permissions are UNIONED, never shrunk`
- `EQUAL admin: "*" on either side keeps full access`
- `EQUAL admin: existing broad perms are not reduced by a narrower allowlist`

All pre-existing suites (catalog-leak, dataImport, posBilling, etc.) still pass.

## Build result

Command: `npm run build` (`tsc -p tsconfig.json`), after `npm install`
(node_modules was missing in the worktree; install succeeded, `@prisma/client`
and `typescript` present).

Result: **180 `error TS…` lines — ALL pre-existing baseline, ZERO new.**

These are the KNOWN env limitation: the Prisma engine CDN is blocked here, so
the generated client is stale/untyped and every `prisma.<model>` /
`$queryRawUnsafe<…>` / `$transaction` call reports `TS2347 Untyped function calls
may not accept type arguments` or `TS7006 implicitly any`. This is NOT a
regression from this task.

Evidence that the change adds zero new errors:

- `npm run build` error count with my route edits APPLIED: **180**.
- `npm run build` error count with `pos-auth.ts` + `admin-pos.ts` edits STASHED
  (files at HEAD): **180**. Identical.
- The only build errors touching the two files I edited are at lines
  `pos-auth.ts(58, …)` (the `$queryRawUnsafe<AdminPhoneRow[]>` in
  `findActivePhone`) and `admin-pos.ts(67/73/176/187/200/213)` (the raw-SQL
  report/list queries) — all pre-existing Prisma-client lines I did not touch.
- `src/auth/pos-login-decision.ts` and `src/__tests__/posLoginDecision.test.ts`
  produce **no** errors in the build output (the decision module uses only plain
  TS, and the `[...new Set(...)]` spread matches the existing project pattern in
  `pos-auth.ts normalizePerms` / `admin-pos.ts cleanPerms`, compiled fine by the
  project tsconfig).

So `pos-auth.ts` itself compiles with no new TS errors beyond the baseline.

## Owner-stays-owner trace (the fix, end to end)

Scenario: the owner's number is in `admin_phones` as a limited `staff` entry
(`role='staff'`, `permissions=["orders","dashboard"]`), and a `users` row for
that mobile already exists with `role='owner'`, `permissions=['*']`.

1. `POST /otp/verify` validates mobile + OTP; `findActivePhone` returns the
   staff row.
2. Allowlist mapping: `isOwner = String(phone.role) === 'owner'` → `false`
   (the row says `staff`), so `role='admin'`, `permissions=['orders','dashboard']`.
3. `existing = prisma.user.findUnique({ where: { mobile } })` → the owner row
   (`role='owner'`, `permissions=['*']`).
4. `decidePosLogin({ existingRole:'owner', existingPermissions:['*'],
   allowlistRole:'admin', allowlistPermissions:['orders','dashboard'] })`:
   `roleRank('owner')=3 > roleRank('admin')=2` → returns
   `{ role:'owner', permissions:['*'] }` (keep branch).
5. `prisma.user.update(... data:{ role:'owner', permissions:['*'],
   last_login: now })` — role and permissions UNCHANGED; only `last_login`
   refreshes.
6. `issueTokens` / `safeUser` run on this persisted row, so the JWT claims carry
   `role=owner` and the response shape is identical to before.

Result: **the owner REMAINS owner with full permissions (`['*']`) after a POS
login, regardless of the limited `staff` allowlist entry.** The production
downgrade can no longer occur. The matching unit test
`PRODUCTION INCIDENT: existing owner + limited staff allowlist entry STAYS owner`
asserts exactly this.

## Files changed

- `4astore-v2/api-node/src/auth/pos-login-decision.ts` (new — pure decision fns)
- `4astore-v2/api-node/src/__tests__/posLoginDecision.test.ts` (new — 9 tests)
- `4astore-v2/api-node/src/routes/pos-auth.ts` (existing-user branch now calls
  `decidePosLogin`; import added; inline no-downgrade comment)
- `4astore-v2/api-node/src/routes/admin-pos.ts` (two-line owner-number guard in
  `POST /phones`)

Not pushed. Worktree not deleted.

## Follow-ups / notes

- The Prisma generated-client build errors are a pre-existing env limitation
  (blocked CDN), not addressed here and out of scope.
- `OWNER_MOBILE` is hard-coded in `admin-pos.ts`; if it later becomes
  configurable the step-4 guard should read from the same source as the DELETE
  guard (which uses the same constant), so they stay consistent.
