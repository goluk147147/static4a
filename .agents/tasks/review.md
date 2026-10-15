# POS login must never downgrade an existing account

The POS phone-OTP verify handler used to blindly overwrite an existing user's `role` and `permissions` with whatever the `admin_phones` allowlist entry resolved to. In production this demoted a real owner to `role=admin` / `permissions=["orders","dashboard"]` because the owner's number sat in the allowlist as a limited `staff` row. The fix extracts the role/permission decision into a pure, unit-tested function (`decidePosLogin`) that ranks roles (owner = superadmin > admin > rest) and refuses to lower an existing account: it keeps the higher role when the existing user outranks the allowlist, upgrades when the allowlist outranks, and unions permissions on an equal-admin login. A small guard in `admin-pos.ts` additionally blocks saving the owner's own number as a non-owner row.

Watch for: the diff bundles unrelated festival-ad-template and plan.md changes alongside the auth fix (confirmed) — those are out of scope for this review and were not evaluated.

**Verdict**: APPROVED

## High-level view

The core invariant — "a POS login may raise or keep privileges, never reduce them" — is enforced by comparing role ranks before persisting. The existing-user branch no longer writes the raw allowlist role/permissions; it writes the output of `decidePosLogin`, which returns the existing role+perms untouched whenever the existing account outranks the allowlist entry. That closes the owner-demotion path end to end: the owner-via-staff-entry case resolves to the keep branch and only `last_login` changes.

The decision logic lives in a dependency-free module (no Prisma, no Express), so it is exercised directly by a 9-case unit suite that pins the production incident, the upgrade paths, and the equal-admin permission-union behavior. The equal-admin case unions permissions and collapses to `['*']` if either side is `['*']`, so an equal login can only keep or grow the permission set.

The create branch for brand-new POS numbers is unchanged, and the OTP-consume, `issueTokens`, `safeUser`, and `isMobileClient` response flow are all untouched — the final persisted `user` row feeds them exactly as before. A header comment on the module and an inline comment on the route both document the no-downgrade rule and the incident so it is not refactored back into a blind overwrite.

<details>
<summary>Issues (1)</summary>

1. **Unrelated changes bundled** — the diff includes festival-ad-template verification files, `admin-ads.js`, and `plan.md` edits unrelated to the privilege fix. Not blocking; consider splitting them out so the auth change lands on its own.

</details>

<details>
<summary>Details</summary>

### No-downgrade enforcement on the existing branch

The allowlist mapping is unchanged: `isOwner = String(phone.role) === 'owner'` yields `role='owner', permissions=['*']` for an owner row and `role='admin', permissions=normalizePerms(...)` otherwise. What changed is that the existing-user branch no longer feeds that pair straight into `prisma.user.update`. It builds `decidePosLogin({ existingRole, existingPermissions, allowlistRole, allowlistPermissions })` and persists the returned `{ role, permissions }` instead.

The decision is a strict rank comparison (confirmed by reading `pos-login-decision.ts`):

```
rank(existing) > rank(allowlist)  → keep existing role + existing permissions
rank(allowlist) > rank(existing)  → take allowlist role + allowlist permissions
equal (both admin)                → role 'admin', unionPerms(existing, allowlist)
```

`roleRank` maps owner and superadmin to 3, admin to 2, and everything else (rider/customer/unknown) to 1. For the production case — existing `owner`/`['*']`, allowlist `admin`/`['orders','dashboard']` — `3 > 2` takes the keep branch and returns the existing role and permissions verbatim; the update writes those back plus a fresh `last_login`. There is no code path on the existing branch that can lower a role or shrink permissions: the keep branch returns existing values, the upgrade branch only applies when the allowlist strictly outranks, and the equal branch unions rather than replaces. The one subtlety worth noting (confirmed): the equal-admin branch returns `allowlistRole` as the role, which is sound only because that branch is reached exclusively when both ranks are equal — i.e. both already resolve to `admin` — so the role value is identical either way.

### Permission union can only grow, never shrink

`unionPerms` concatenates both lists, and if either contains `'*'` it collapses to `['*']`; otherwise it de-dupes via a `Set`. This guarantees the equal-admin login never removes a permission the user already held, which the `existing broad perms are not reduced by a narrower allowlist` test pins directly. The `'*'`-collapse matches the authorization model in `middleware.ts` where `'*'` means all admin permissions.

One detail handled correctly in the route (confirmed): existing permissions are read defensively — `Array.isArray(existing.permissions) ? (…).map(String) : normalizePerms(existing.permissions)` — so a non-array stored value still becomes a clean string list before the decision runs.

### Owner-number guard in admin-pos.ts

`POST /phones` now rejects with 409 when `mobile === OWNER_MOBILE && role !== 'owner'`. `OWNER_MOBILE` is the existing hard-coded constant (line 41) already used by the DELETE handler's owner-number guard (line 142), so the new guard mirrors an established pattern rather than introducing a new source of truth. It stops the exact misconfiguration that caused the incident — the owner's number being saved as a limited `staff` row — from being created at all. The verification note correctly flags that if `OWNER_MOBILE` ever becomes configurable, both guards should read from the same source.

### Preserved flow and create branch

The new-user `create` branch still writes the raw allowlist `role`/`permissions` — correct, since a brand-new number has no privileges to protect. The OTP consume, `issueTokens`, `safeUser(user)`, and `isMobileClient` response assembly are untouched and operate on the final persisted `user`, so the response shape (`user` + `token` + optional `refreshToken`) is identical to before.

### Test coverage

The new suite `posLoginDecision.test.ts` has 9 cases covering `roleRank` ordering, `unionPerms` de-dup and `'*'` collapse, the production incident (owner stays owner), superadmin-stays-superadmin, both upgrade directions, and three equal-admin permission-merge variants. I ran this single file as a spot-check on the core regression and all 9 passed. The verification note records the full suite at 46/46 and the build at 180 pre-existing Prisma-client TS errors with zero new errors (identical count with the edits stashed), which is the known blocked-CDN env limitation and not a regression.

Not tested: there is no route-level integration test exercising `decidePosLogin` through the actual `prisma.user.update` call — the decision function is tested in isolation, so the wiring in `pos-auth.ts` (correct field mapping, defensive permission read) rests on code review rather than an automated assertion. Given the Prisma-client env limitation this is a reasonable boundary, but worth noting as the untested seam.

</details>

<details>
<summary>File map</summary>

- `src/auth/pos-login-decision.ts` (new) — pure `roleRank` / `unionPerms` / `decidePosLogin` with no-downgrade rule and incident documented in header.
- `src/__tests__/posLoginDecision.test.ts` (new) — 9 unit tests pinning the rule and the production incident.
- `src/routes/pos-auth.ts` — existing-user branch now persists `decidePosLogin(...)` output; import + inline no-downgrade comment added.
- `src/routes/admin-pos.ts` — two-line 409 guard blocking the owner number from being saved as a non-owner row.
- Also in the diff but out of scope: festival-ad-template verification docs, `web/public/legacy/js/admin-ads.js`, and `.agents/tasks/plan.md` edits.

Full diff: `git diff main` on branch `pos-login-no-downgrade`.

</details>
