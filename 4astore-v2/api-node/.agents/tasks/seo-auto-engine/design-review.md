# Design Review — Automatic Zero-Manual-Entry SEO Engine (4A Store v2)

Reviewed document: `api-node/.agents/tasks/seo-auto-engine/design.md` (revision 3).
Review method: read the design cold, then verified every "existing code" claim against the
actual source under `.worktrees/seo-auto-engine/4astore-v2/api-node`. No code was written
and no build was run (judgement only, per the brief).

**Verdict: CHANGES_REQUESTED** — 2 blocking findings (0 HIGH, 2 MEDIUM) + 3 NIT.

The design is unusually well-grounded: it is a 3rd revision whose prior-review findings I
could independently confirm against source, and its headline self-correction (the
`buildProductJsonLd` hardcoded-`InStock` fabrication) is a real defect that the source
confirms. The two MEDIUM findings below are genuine internal conflicts / feasibility gaps
that a coder would hit, not nitpicks.

---

## Findings

### 1. MEDIUM — Category OG-route slug regex conflicts with the real category slug length (and with §10)

**Where:** §6.6 ("Slug validation matches the existing routes (`^[a-z0-9-]{1,80}$`; 404
otherwise)") vs §10 ("`optimize.category` … slug `^[a-z0-9-]{1,120}$`").

**Problem:** The two sections disagree on the category-slug length limit (80 vs 120), and
*neither* matches the source. Verified in `routes/admin.ts`: `categorySchema.slug =
z.string().trim().max(120)`, and the stored `slug` is `slugify(c.slug || c.name)` — so a
real category slug can be up to 120 chars. The `{1,80}` regex the design copied from the
*page* route (`routes/og.ts` `/page/:slug` and `/image/page/:slug` both use
`^[a-z0-9-]{1,80}$`, confirmed) would make the new `GET /api/og/category/:slug` and
`GET /api/og/image/category/:slug` return 404 for any legitimately-stored category whose
slug is 81–120 chars. The share HTML and share image would silently break for those
categories — a correctness gap in a route the engine itself emits as the category
`og:image`.

**Fix:** Pick one bound and make it match the data model. Use `^[a-z0-9-]{1,120}$` in
*both* new OG category routes and in the §10 `optimize.category` validator, matching
`categorySchema`'s `max(120)`:

```ts
// routes/og.ts — category share + image routes
const slug = String(req.params.slug || '').toLowerCase();
if (!/^[a-z0-9-]{1,120}$/.test(slug))
  return res.status(404).json({ success: false, message: 'Category not found' });
```

State explicitly in §6.6 that the category bound is 120 (not the page route's 80) *because*
category slugs are stored up to 120 chars, so a future reader does not "fix" it back to 80.

---

### 2. MEDIUM — The `seoAuto` master feature flag is declared but never wired to the auto-generation hooks

**Where:** §3 / §7 / §14 declare `seoAuto` (master, default `true`) as the flag that
"feature-flags high-impact automation", but §6.1 (the `POST /admin/products` and
`services/dataImport.ts` hook points), §5.3 (`runProductSeo`/`runCategorySeo`), and §6.9
(the cron sweep) never say the automation checks `seoAuto` before firing.

**Problem:** The brief requires high-impact automation to be feature-flagged (so it can be
switched off without a redeploy). The design adds the flag and the gated PHASE-2 keys, but
the actual write paths — the create/update hook, the import audit enqueue, and the 15-min
cron — are described as unconditional. As written, `seoAuto=false` would NOT disable the
automatic generation it is supposed to guard; the kill-switch is cosmetic. The merge logic
is verified (`utils/features.ts`: a key is OFF only when explicitly stored `false`, and
`seoAuto` is not currently a key, so it ships ON — correct), but nothing reads it.

**Fix:** Specify the single gate point. In the shared entry `runProductSeo` /
`runCategorySeo` (and at the top of `runAuditSweep` and the import-enqueue), read the merged
flags and no-op when the master is off:

```ts
// seo/persist.ts (or a thin wrapper the hooks call)
const features = mergeFeatures(await loadStoredFeatures());
if (!features.seoAuto) return; // master kill-switch — automation dark, commerce untouched
```

Add one line to §6.1 ("both hooks early-return when `seoAuto` is off"), §6.9 ("the sweep
early-returns when `seoAuto` is off"), and the §11 invariant table ("automation only runs
when `seoAuto` is on — owning layer `persist.ts`/`seoAuditJob.ts`"). Also name where the
flags are loaded server-side (the same `config.features` read the existing
`POST /api/admin/features` writes), since no existing helper is cited for reading them.

---

### 3. NIT — `invalidateSitemapCache()` must bust the robots entry too, not just the sitemap

**Where:** §6.9 step 2 and §13 ("busting the sitemap cache").

**Problem:** Verified in `routes/seo.ts`: the TTL cache is one `Map` holding **two** keys,
`'sitemap'` and `'robots'`, both built from DB state. A policy change (e.g. a robots/
canonical rollback, or `robotsExtra` edits flowing through) that only clears `'sitemap'`
leaves a stale `robots.txt` for up to 5 minutes. The function name implies sitemap-only.

**Fix:** Have the exported function clear both keys (or `cache.clear()`), and name it
accordingly, e.g.:

```ts
// routes/seo.ts
export function invalidateSeoCaches() { cache.delete('sitemap'); cache.delete('robots'); }
```

Reference it as `invalidateSeoCaches()` in §6.9/§13/§15.

---

### 4. NIT — JSON-LD image argument semantics are under-specified vs the real call site

**Where:** §4.1 note / §5.1 ("The engine's image-SEO outputs are the generated `imageAlt`
and the on-demand rendered card — not `og_image`").

**Problem:** The design correctly establishes that `og_image` is a human override and the
engine does not write it. But the verified `routes/og.ts` product route passes the JSON-LD
`image` as `absoluteImageUrl(product.og_image || product.image) || ogImage` — i.e. the
schema.org `Product.image` already falls back to `product.image` and then the rendered
card. The design never states whether `generateProductSeo`'s image handling should touch
this call site or leave it alone. It almost certainly should leave it alone (reuse), but
saying so prevents an implementer from "improving" the builder call and changing crawler
output.

**Fix:** Add one sentence to §5.1/§6.8: "The existing `routes/og.ts` JSON-LD `image`
resolution (`og_image || product.image || rendered card`) is left unchanged; the engine
only adds `imageAlt` as metadata and never rewrites the builder's `image` argument."

---

### 5. NIT — "needs attention" predicate and the idempotent-skip predicate use different thresholds without a stated reconciliation

**Where:** §5.4 (`ATTENTION_THRESHOLD = 80`; needs-attention = `score < 80 OR problems`)
vs §6.2 (idempotent skip = "unchanged hash AND `seo_score ≥ threshold` AND no problems").

**Problem:** Both reference a score "threshold" but the design only pins one constant
(`ATTENTION_THRESHOLD = 80`). If the queue's skip threshold is the same 80, an entity at
exactly 80 with no problems is both "not needing attention" and "skipped" — consistent. But
the design never says they are the same constant, so a coder could pick two different
numbers and produce the surprising state where an entity is skipped by the optimizer yet
still flagged "needs attention" on the dashboard (or vice-versa).

**Fix:** State explicitly that the queue skip uses the *same* `ATTENTION_THRESHOLD` (score
`≥ ATTENTION_THRESHOLD` AND no problems AND unchanged hash ⇒ skip), so the two surfaces can
never disagree. One sentence in §6.2.

---

## Verified Assumptions (checked against source — correct)

1. **`buildProductJsonLd` hardcodes `availability: 'https://schema.org/InStock'`** and its
   `ProductLike` has **no `in_stock` field** — confirmed in `seo/localSeo.ts`. The design's
   headline finding (out-of-stock products published as `InStock` on the crawler path via
   `routes/og.ts`) is real, and the proposed ADD-only fix (add `in_stock?: boolean | null`,
   derive `OutOfStock`/`InStock`, default `InStock` only when absent for parity with the
   web mirror) is correct and sufficient.
2. **`deriveProductSeo()` returns only `{ title, description, keywords }`** — confirmed; it
   does not return `og_image`. The §4.1/§5.3 treatment of `og_image` as a human-override-only
   field is accurate.
3. **`og_image` share-image resolution** is `absoluteImageUrl(product.og_image) ||
   ${API_ORIGIN}/og/image/product/${id}` — confirmed in `routes/og.ts`. The empty→render-card
   fallback is real and must be preserved.
4. **Feature-flag merge logic:** `mergeFeatures` seeds from `DEFAULT_FEATURES` and only
   flips a key OFF on an explicit stored `false`; every current key is `true` ("absent =
   ON") — confirmed in `utils/features.ts`. `seoAuto`/PHASE-2 keys are not present today, so
   the "add PHASE-2 keys as `false` in `DEFAULT_FEATURES`" approach is the correct way to
   ship them OFF. (The *wiring* of the master flag is still Finding 2.)
5. **Route permissions:** `POST /products` = `requireStaff('products')`, `POST /categories`
   = `requireStaff('categories')`, `POST /seo` = `requireStaff('settings')` — all confirmed
   in `routes/admin.ts`. The design's refusal to re-gate the commerce routes to `settings`
   is correct and avoids breaking `products`/`categories` staff.
6. **`productSchema` SEO coercion:** `seo_title: p.seoTitle || null` (and the other three)
   — confirmed. The "override only on a non-empty string" rule is sound; absent vs cleared
   is indistinguishable after `|| null` unless `req.body.product[field]` is read first, as
   the design notes.
7. **`seoSchema` / `mergeSeoConfig` have no `defaultLang`**, and `POST /seo` runs the body
   through `mergeSeoConfig` which rebuilds an explicit object (dropping unmerged keys) —
   confirmed. The 3-layer `defaultLang` wiring the design specifies is necessary and correct.
8. **Sitemap/robots:** `routes/seo.ts` category select is `{ slug: true }` (no timestamp),
   `urlEntry(loc, lastmod?)` omits `<lastmod>` on null, robots emits `Disallow: /admin` +
   `Disallow: /api/` + admin extras. There is **no** `invalidateSitemapCache` export today
   and **no** category OG route — all consistent with "to ADD". (Cache has two keys — see
   Finding 3.)
9. **Background-job patterns:** `reminderJob.ts` is a `cron.schedule('* * * * *', …)` sweep;
   `video/queue.ts` is a DB-row queue with a `running` guard, per-row progress written every
   ~3%, and `recoverQueue()` marking `rendering`→`failed` then `kick()`; `startVideoScheduler()`
   calls `recoverQueue()` as its first line and `server.ts` calls the start fns in the
   `app.listen` callback (not `recoverQueue()` directly). All confirmed — the design's
   mirroring claims (§5.3/§6.2/§6.9) are accurate.
10. **`runImport`** is the single shared CLI+admin idempotent upsert path, and
    `ensureNotificationTables()` uses `CREATE TABLE IF NOT EXISTS` (InnoDB/utf8mb4) while
    `ensurePlainPasswordColumn()` uses an `information_schema` COUNT guard + 1060 swallow —
    confirmed in `dataImport.ts`. The design's SQL-idempotence and import-hook claims hold.
11. **Category slug-rename reuse:** the `$transaction` with `tx.product.updateMany({ where:
    { category: existing.slug }, data: { category: slug } })` block exists in the category
    route — confirmed. The §6.1 "reuse the existing `updateMany` block" is real.
12. **Mount ordering:** `adminDataRouter` is mounted before `adminRouter` (specific-first) —
    confirmed; the §7 `/api/admin/seo-auto` before `/api/admin` ordering matches the
    existing convention.

## Unverified / Wrong Assumptions

- **Category slug length (WRONG as stated):** the design's §6.6 `^[a-z0-9-]{1,80}$` does not
  match the stored category slug length (`max(120)` in `categorySchema`), and conflicts with
  its own §10 (`{1,120}`). See Finding 1. The 80-char bound was correctly copied from the
  *page* route but is wrong for *categories*.
- **`seoAuto` enforcement (UNVERIFIED / GAP):** the design asserts the automation is
  feature-flagged but never specifies the read/gate point in the hooks or cron. There is no
  cited existing helper that loads the merged `features` for a server-side gate (the
  existing flag reads happen in `catalog`/client paths). See Finding 2.
- **How server-side `features` are loaded for the gate (UNSTATED):** `mergeFeatures` is
  verified, but the design does not name where the stored flag blob is read on the API side
  for the automation gate (e.g. `config.features`). This is adjacent to Finding 2 and should
  be pinned so the implementer does not invent a second source of truth.
- Not independently exercised (acceptable — behavior claims, not existing-code claims): the
  pure-generator output shapes, the completeness score math, and the `seo_source_hash`
  change-detection are new code and were judged on design, not run.

---

## Verdict rationale (mechanical)

HIGH = 0, MEDIUM = 2 (Findings 1, 2), NIT = 3 (Findings 3, 4, 5). MEDIUM count > 0 ⇒
**CHANGES_REQUESTED**. Findings 1 and 2 are concrete and localized; a quick revision that
pins the category slug bound and wires the `seoAuto` gate into the hook/cron entry points
should clear the gate.

---

## Revision 4 — APPROVED

All five revision-3 findings have been applied to `design.md` (revision 4) and re-verified
against the actual source. Finding 1: §6.6 now uses `^[a-z0-9-]{1,120}$` for both new category
OG routes with a sentence explaining the 120 bound (vs the page route's 80), matching the
verified `categorySchema.slug = max(120)`; §10 already agreed. Finding 2: the `seoAuto` master
kill-switch is now wired through a single `mergeFeatures(config.features)` gate at the top of
`runProductSeo`/`runCategorySeo`/`runAuditSweep` that early-returns when the flag is off,
referenced in §6.1, §6.1.2 (import enqueue), §6.9 (cron) and the §11 invariant table, so
`seoAuto=false` genuinely disables the create/update hook, import audit enqueue and 15-min cron
while leaving commerce untouched. Finding 3: §6.9/§13/§15 now use `invalidateSeoCaches()` which
clears both the verified `'sitemap'` and `'robots'` cache keys. Finding 4: §5.1/§6.8 state the
`routes/og.ts` JSON-LD `image` resolution is left unchanged (engine adds only `imageAlt`).
Finding 5: §6.2 ties the queue idempotent-skip to the same `ATTENTION_THRESHOLD` as the
needs-attention predicate. With 0 HIGH / 0 MEDIUM / 0 NIT outstanding, the verdict is
**APPROVED** (`approvedRevision: 4`).
