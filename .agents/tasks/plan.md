# Implementation Plan — POS login must never downgrade an existing account

## Context (what I read, and the decisions I made)

- **Bug location** — `4astore-v2/api-node/src/routes/pos-auth.ts`, handler `POST /otp/verify` (mounted at `/api/pos/auth`). After OTP verification it derives `role`/`permissions` from the `admin_phones` allowlist row and, for an **existing** user, does `prisma.user.update({ ... data: { role, permissions, last_login } })`. That blindly overwrites role + permissions, so an owner whose number sits in `admin_phones` as a `staff`/limited entry is demoted on POS login. This happened in production (owner became `role=admin`, `permissions=["orders","dashboard"]`).

- **Role model** — `src/auth/middleware.ts`: `STAFF_ROLES = ['owner','superadmin','admin']`. `hasPermission` grants ALL permissions to `owner`/`superadmin`; `admin` is gated by its `permissions[]` (with `'*'` meaning all). So the privilege order that matters here is **owner/superadmin (full) > admin (perms-gated) > everything else**.

- **Allowlist can only ever express `owner` or `admin`** — `pos-auth.ts` computes `role = isOwner ? 'owner' : 'admin'` (there is no `superadmin` path from the allowlist). So the allowlist-derived role is always one of `owner` | `admin`. The existing user's role, however, can be anything already in the DB (`owner`, `superadmin`, `admin`, `rider`, `customer`).

- **Response shape is role/perms-independent of my change** — `src/auth/session.ts`: the route returns `safeUser(user)` + tokens, and `issueTokens`/`toClaims` read whatever is on the final `user` object. As long as I set `user` to the persisted row, the returned shape and the OTP-consume + `issueTokens` flow stay byte-for-byte identical. No change needed there.

- **Test harness** — `src/__tests__/` runs with `node --import ./src/__tests__/register.mjs --test "src/__tests__/**/*.test.ts"` (script `npm test`). Tests use `node:test` + `node:assert/strict` and import **pure functions** from `src/` (see `posBilling.test.ts` importing from `../services/posBilling`, and `catalog-leak.test.ts`). There is **no reachable DB** in the worktree, so the decision logic must be a pure function to be unit-testable — which matches the task's testability requirement.

- **`node_modules` is MISSING in this worktree** (confirmed). `npm test` needs no third-party packages (pure `node:test` + the local TS loader), but it will still fail to resolve the many `import` statements in sibling route files — however the **unit test only imports the new pure-function module plus `node:*`**, so it runs without a DB and without most deps. The `tsc` **build** needs devDependencies (`typescript`) and `@prisma/client`. Therefore step 0 installs dependencies.

### Design decisions (rationale, one line each)

1. **Rank mapping** — `owner = superadmin = 3`, `admin = 2`, anything else (`rider`/`customer`/unknown) `= 1`. owner and superadmin are equal-top because `hasPermission` treats them identically (both get all permissions). Chosen over a finer scale because only the "is the existing account already staff-or-higher than the allowlist role" question matters here.

2. **Decision rule — "POS login may raise or keep privileges, never reduce them":**
   - If `rank(existingRole) > rank(allowlistRole)` → **keep** existing role AND existing permissions unchanged (only `last_login` updates). This is the fix: an existing `owner`/`superadmin` logging in through a `staff` allowlist entry stays owner/superadmin.
   - If `rank(allowlistRole) > rank(existingRole)` → **upgrade**: persist the allowlist role + permissions (today's behaviour; a plain `customer`/new-staff gets staff access).
   - If ranks are **equal** (both resolve to `admin`) → keep role `admin` and persist the **union** of existing perms and allowlist perms (never shrink). `'*'` on either side collapses to `['*']`.

3. **Owner/superadmin permissions when kept** — do not fabricate a perms array; keep exactly what the existing row has (owner/superadmin ignore `permissions[]` at authorization time anyway via `hasPermission`). For the upgrade-to-owner case keep today's `['*']`.

4. **Pure function placement** — new file `src/auth/pos-login-decision.ts` (co-located with the other auth helpers like `session.ts`/`middleware.ts`). Keeps the route thin and the logic importable by the test with no DB.

5. **Permission-union semantics** — union is order-insensitive and de-duplicated; if either side contains `'*'` the result is `['*']` (superset). This guarantees the admin-equal case can only ever keep or grow the permission set.

---

## Plan

- [ ] 0. Install api-node dependencies so the build and tests can run (worktree has no `node_modules`).
      Files: none (installs into `4astore-v2/api-node/node_modules`).
      Verify: `cd 4astore-v2/api-node && npm install` exits 0; `npx tsc -p tsconfig.json --noEmit` runs (it may report PRE-EXISTING errors unrelated to this task — capture the baseline output now so step 3 can confirm no NEW errors were introduced). If `@prisma/client` needs generating, run `npm run prisma:generate`.

- [ ] 1. Add the pure decision function in a new file `src/auth/pos-login-decision.ts`.
      Export `roleRank(role: string): number` (owner/superadmin → 3, admin → 2, else → 1), `unionPerms(a: string[], b: string[]): string[]` (de-duped union; returns `['*']` if either contains `'*'`), and `decidePosLogin({ existingRole, existingPermissions, allowlistRole, allowlistPermissions }): { role: string; permissions: string[] }` implementing decision rule #2 above. Add a header comment stating the no-downgrade rule ("POS login may raise or keep privileges, never reduce them") and referencing the production incident (owner demoted to admin with ["orders","dashboard"]). All inputs/outputs are plain values — no Prisma, no `req`.
      Files: `4astore-v2/api-node/src/auth/pos-login-decision.ts` (new).
      Verify: `cd 4astore-v2/api-node && npx tsc -p tsconfig.json --noEmit` shows no NEW errors referencing this file (compare against the step 0 baseline).

- [ ] 2. Add unit tests for the decision function.
      Cover: (a) existing `owner` + allowlist `adm`/limited perms → stays `owner`, perms unchanged (the production-incident regression); (b) existing `superadmin` + allowlist `admin` → stays `superadmin`; (c) existing `customer` + allowlist `admin` with perms → upgraded to `admin` with those perms; (d) existing `admin` perms `["orders"]` + allowlist `admin` perms `["dashboard"]` → `admin` with union `["orders","dashboard"]` (no shrink); (e) `'*'` on either side of the equal-admin case → `['*']`; (f) new/plain user path unaffected (allowlist strictly higher upgrades). Follow the `node:test` + `node:assert/strict` import-a-pure-function pattern from `posBilling.test.ts`.
      Files: `4astore-v2/api-node/src/__tests__/posLoginDecision.test.ts` (new).
      Verify: `cd 4astore-v2/api-node && npm test` — the new `posLoginDecision` tests pass (and existing tests still pass).

- [ ] 3. Wire the decision function into the existing-user branch of `POST /otp/verify`, changing ONLY that branch.
      In `src/routes/pos-auth.ts`: after loading `existing`, when `existing` is truthy call `decidePosLogin({ existingRole: existing.role, existingPermissions: Array.isArray(existing.permissions) ? existing.permissions as string[] : normalizePerms(existing.permissions), allowlistRole: role, allowlistPermissions: permissions })` and use the returned `{ role, permissions }` in `prisma.user.update(... data: { role, permissions, last_login: new Date() })`. Leave the computation of `isOwner`/`role`/`permissions` from the allowlist, the NEW-user `create` branch, the OTP-consume (`emailOtp.update consumed`), and the `issueTokens`/`safeUser` response untouched. Add a short inline comment at the update site referencing the no-downgrade rule and the incident. Note: `isMobileClient`/token flow and returned shape are unchanged because they read the final `user` object (confirmed in `session.ts`).
      Files: `4astore-v2/api-node/src/routes/pos-auth.ts`.
      Verify: `cd 4astore-v2/api-node && npx tsc -p tsconfig.json --noEmit` shows no NEW errors vs. the step 0 baseline, and `npm test` passes.

- [ ] 4. (Optional, only if trivial) Defensive guard in `src/routes/admin-pos.ts` so the owner's own owner-number cannot be saved as a non-owner `staff` entry.
      In the `POST /phones` handler, before the INSERT, if `mobile === OWNER_MOBILE` and `role !== 'owner'`, return `fail(res, 'The owner number must stay role=owner.', 422)`. This is a two-line guard reusing the existing `OWNER_MOBILE` constant and `MOBILE_RE`-validated `mobile`. If anything about it turns out non-trivial (e.g. owner number is configurable, not the hard-coded constant), SKIP and record it as a follow-up in the final summary instead.
      Files: `4astore-v2/api-node/src/routes/admin-pos.ts`.
      Verify: `cd 4astore-v2/api-node && npx tsc -p tsconfig.json --noEmit` shows no NEW errors; `npm test` still passes.

- [ ] 5. Final build + test gate.
      Files: none.
      Verify: `cd 4astore-v2/api-node && npx tsc -p tsconfig.json --noEmit` has no NEW errors relative to the step 0 baseline, and `npm test` passes all tests including the new `posLoginDecision` suite. Confirm `git diff --stat` touches only `src/auth/pos-login-decision.ts`, `src/__tests__/posLoginDecision.test.ts`, `src/routes/pos-auth.ts`, and (if step 4 was done) `src/routes/admin-pos.ts`.

## Notes / assumptions

- The returned response shape, OTP consume, and `issueTokens` flow are intentionally left exactly as-is; the only behavioural change is that the existing-user branch can no longer lower an account's role/permissions.
- If `npm install`/`npm test` cannot run in the environment (network or Prisma generate blocked), the implementer should still make the code edits and report the exact failure; the unit test imports only the new pure module + `node:*`, so it is the most likely command to run even in a constrained environment.
- Step 4 is optional and must be skipped (with a follow-up note) if not obviously trivial.
