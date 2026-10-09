# Implementation Plan — Automatic Zero-Manual-Entry SEO Engine (4A Store v2)

> Built strictly from the APPROVED `design.md` (revision 4). All paths are under the
> worktree `c:\xampp\htdocs\static4a\.worktrees\seo-auto-engine\4astore-v2`. Edit files
> under the worktree ONLY. Local only — no push, no PR.
>
> Verification gates (from the design, verified against source):
> - API: `npx tsc --noEmit` in `api-node` (no test runner is configured; type-check is the committed gate).
> - After `schema.prisma` edits: `npx prisma generate` in `api-node`.
> - Web: `npm run build` in `web` (= `tsc -b && vite build`; no lint/test script).
> - Do NOT start long-running servers.
>
> Source facts confirmed during exploration (plan depends on these):
> - `seo/localSeo.ts` `buildProductJsonLd` hardcodes `availability: 'https://schema.org/InStock'`
>   and `ProductLike` has NO `in_stock` field → the known latent bug the design fixes.
> - `routes/seo.ts` keeps ONE `Map` cache with keys `'sitemap'` and `'robots'`; `urlEntry(loc, lastmod?)`
>   already omits `<lastmod>` when null; category select is `{ slug: true }`.
> - `routes/og.ts` uses a paired HTML + image route per entity; page slug bound is `{1,80}`;
>   product JSON-LD image is `absoluteImageUrl(product.og_image || product.image) || <card>`.
> - `routes/admin.ts`: `productSchema` coerces absent SEO fields via `p.seoTitle || null`;
>   `POST /products` = `requireStaff('products')`, `POST /categories` = `requireStaff('categories')`,
>   `POST /seo` and `POST /features` = `requireStaff('settings')`; a local `slugify` exists;
>   category slug rename reruns `tx.product.updateMany`; `categorySchema.slug` = `max(120)`.
> - `utils/features.ts` `mergeFeatures` seeds from `DEFAULT_FEATURES` and flips a key OFF only on an
>   explicit stored `false`; all current keys are `true` (absent = ON). Web `isFeatureOn(features, key, def)`.
> - `video/queue.ts` is a DB-row queue (one-at-a-time `running` guard, progress every ~3%, `recoverQueue`).
>   `videoScheduler.startVideoScheduler()` calls `recoverQueue()` as its first line; `server.ts` calls
>   `startReminderJob()` + `startVideoScheduler()` from the `app.listen` callback and mounts
>   `adminDataRouter` BEFORE `adminRouter` (specific path first).
> - `services/dataImport.ts` `runImport` is the shared CLI + admin full-catalogue idempotent path;
>   `ensureNotificationTables()` is the `CREATE TABLE IF NOT EXISTS` precedent. `prisma/seo.sql` is the
>   `information_schema`-guarded `ADD COLUMN` precedent.
> - Web: `AdminApp.tsx` exports `ADMIN_TABS`; `App.tsx` declares `/admin` child routes; `getOrRenderOg(cacheKey, opts)`.
>
> No contradiction was found between `design.md` and the real source. Where the design notes a
> correction (JSON-LD availability, cache keys, category slug bound), the source confirms the
> as-is behavior the design corrects.

---

- [ ] 1. Add the guarded, idempotent raw-SQL schema file `prisma/seo-auto.sql`.
      ADD-only columns on `products` (`seo_slug`, `seo_overrides`, `seo_auto_json`, `seo_score`,
      `seo_problems`, `seo_generated_at`, `seo_source_hash`) and `categories` (`seo_title`,
      `seo_description`, `seo_keywords`, `seo_intro`, `og_image`, `seo_overrides`, `seo_auto_json`,
      `seo_score`, `seo_problems`, `seo_generated_at`, `seo_source_hash`), each wrapped in the
      `information_schema` COUNT guard + `PREPARE/EXECUTE/DEALLOCATE` exactly like `prisma/seo.sql`.
      New tables `seo_jobs`, `seo_audit_log`, `seo_backups`, `seo_integrations` via
      `CREATE TABLE IF NOT EXISTS` (InnoDB, utf8mb4) with the columns/indexes in design §4.3.
      Files: api-node/prisma/seo-auto.sql
      Verify: file parses as SQL (no execution against the live DB in CI). The design's manual gate is
      that a second apply is a no-op (guarded ADD COLUMN skipped silently; CREATE TABLE IF NOT EXISTS
      emits "already exists"). No build impact on its own.

- [ ] 2. Mirror the new columns + tables into `schema.prisma`, then regenerate the client.
      Add the new scalar fields to `model Product` and `model Category`; add models `SeoJob`,
      `SeoAuditLog`, `SeoBackup`, `SeoIntegration` with `@@map` to the new tables, mirroring how
      `Notification`/`NotificationRecipient` are declared (types match the SQL in step 1). Decision:
      declare the new columns `?`-optional so pre-SQL rows tolerate absence, matching the existing
      SEO columns.
      Files: api-node/prisma/schema.prisma
      Verify: `npx prisma generate` in api-node succeeds; `npx tsc --noEmit` passes.

- [ ] 3. Extract the slug helper to a shared util and add `defaultLang` to the SEO config.
      Create `src/utils/slug.ts` exporting the exact `slugify` currently inlined in `routes/admin.ts`
      and import it in `admin.ts` (reuse, do not duplicate). In `seo/localSeo.ts`: add
      `defaultLang: 'hi' | 'en'` to `SeoConfig`, default `'hi'` in `defaultSeoConfig`, and copy it in
      `mergeSeoConfig` (`raw.defaultLang === 'en' ? 'en' : 'hi'`). In `routes/admin.ts` `seoSchema`
      add `defaultLang: z.enum(['hi','en']).optional()`.
      Files: api-node/src/utils/slug.ts, api-node/src/seo/localSeo.ts, api-node/src/routes/admin.ts
      Verify: `npx tsc --noEmit` passes.

- [ ] 4. Fix the latent JSON-LD availability bug in `seo/localSeo.ts` (design §5.1/§6.3, finding 1).
      Add `in_stock?: boolean | null` to `ProductLike`; in `buildProductJsonLd` derive
      `availability = product.in_stock === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock'`
      (default `InStock` only when absent — parity with `web/src/lib/seo.ts`). Leave the JSON-LD `image`
      argument in `routes/og.ts` unchanged (finding 4). This is ADD-only and backward compatible.
      Files: api-node/src/seo/localSeo.ts
      Verify: `npx tsc --noEmit` passes; the builder emits `OutOfStock` when `in_stock === false`.

- [ ] 5. Add the pure generation module `src/seo/generate.ts` (design §5.1/§6.5/§6.6/§6.7).
      Pure functions (no DB): `generateProductSeo(product, cfg, categoryName?)` (title ≤60 word-boundary,
      desc ≤160, descHi/descEn, Hinglish keywords de-duped THEN capped to 500 chars on a comma boundary,
      slug via `utils/slug.ts`, imageAlt, canonical, indexing policy, JSON-LD hints with INR +
      availability-from-`in_stock`), `generateCategorySeo(category, memberProducts, cfg)` (title/desc/
      intro/keywords/slug/alt; empty-category doorway guard → no intro), the INDEXING_POLICY map, and
      `sourceHash(entity)` (SHA-1 of ordered source fields). Reuse `deriveProductSeo` shape and builders.
      Files: api-node/src/seo/generate.ts
      Verify: `npx tsc --noEmit` passes.

- [ ] 6. Add the pure validation module `src/seo/validate.ts` (design §5.2).
      `validateProductSeo(generated, product, { existingTitles, existingSlugs })` → `{ ok, problems[] }`
      with the exact stable problem codes and the banned-claims FABRICATION regex (`sabse sasta`,
      `cheapest`, `lowest price`, `#1`, `best price`, `guaranteed`, review/rating words, etc.). Recoverable
      vs fatal gates per the design table, incl. `AVAILABILITY_MISMATCH` recomputed from DB `in_stock`.
      Files: api-node/src/seo/validate.ts
      Verify: `npx tsc --noEmit` passes.

- [ ] 7. Add the pure scoring + dedupe modules (design §5.4/§5.5).
      `src/seo/completeness.ts`: exported tunable `SCORE_WEIGHTS` (sum 100) + `ATTENTION_THRESHOLD = 80`,
      `scoreProduct(...)`/`scoreCategory(...)` → `{ score, problems }`, and the single "needs attention"
      predicate (`score < ATTENTION_THRESHOLD` OR non-empty problems). `src/seo/dedupe.ts`:
      `findDuplicates()` (GROUP BY over effective title/desc/slug) and `keywordMap()` anti-cannibalization;
      GSC metrics labelled `unavailable` (never fabricated).
      Files: api-node/src/seo/completeness.ts, api-node/src/seo/dedupe.ts
      Verify: `npx tsc --noEmit` passes.

- [ ] 8. Add the integrations plumbing `src/seo/integrations.ts` (design §5.6, PHASE-2 safe no-op).
      `getIntegrationStatus(provider)`, `connect(provider, payload)`, `disconnect(provider)` reading
      `seo_integrations` + presence of server-side env creds; no-op + `disconnected` message when creds
      absent; NEVER returns secrets, NEVER fabricates GSC/GA4 numbers.
      Files: api-node/src/seo/integrations.ts
      Verify: `npx tsc --noEmit` passes.

- [ ] 9. Add the override-aware persistence orchestrator `src/seo/persist.ts` (design §5.3/§6.1).
      `runProductSeo(productId, { actor })` and `runCategorySeo(id, { actor })`, each beginning with the
      `seoAuto` master kill-switch gate (`mergeFeatures(await loadStoredFeatures())` over `config.features`;
      early-return no-op when off). `persistProductSeo`/`persistCategorySeo`: load row → store generated
      payload in `seo_auto_json` → write each engine-generated effective field only when its
      `seo_overrides[field] !== true` (og_image EXCLUDED) → compute score/problems/generated_at/source_hash
      inside ONE awaited `prisma.$transaction` keyed by id (the atomic publish) → fire-and-forget
      `seo_audit_log` rows AFTER commit. Race-safety: re-check `seo_source_hash` just before write; requeue
      on mid-flight change. Depends on steps 5-7.
      Files: api-node/src/seo/persist.ts
      Verify: `npx tsc --noEmit` passes.

- [ ] 10. Add the DB-row batch queue `src/services/seoQueue.ts` mirroring `video/queue.ts` (design §6.2).
      `enqueueSeoJob(type, scope, createdBy)` (`optimize_all|optimize_selected|optimize_category|audit`),
      `kick()` (single `running` guard, one job at a time, batches of ~50 with an `await` yield, progress
      every batch), per-entity 2× retry with backoff, bounded `log`, idempotent skip (unchanged
      `seo_source_hash` AND `seo_score >= ATTENTION_THRESHOLD` AND no `seo_problems` — the SAME constant
      from completeness.ts), backup snapshot into `seo_backups` + `seo_jobs.backup_id` before any writing
      run, and `recoverSeoQueue()` (mark interrupted `running` jobs failed, resume `queued`). Depends on step 9.
      Files: api-node/src/services/seoQueue.ts
      Verify: `npx tsc --noEmit` passes.

- [ ] 11. Add the cron audit job `src/services/seoAuditJob.ts` mirroring `reminderJob.ts`/`videoScheduler.ts` (design §6.9).
      `runAuditSweep()` begins with the SAME `seoAuto` gate; finds entities whose fresh `sourceHash` differs
      or whose `seo_generated_at` is null → enqueue a bounded (~200/sweep) idempotent `audit` job (skip if an
      `audit`/`optimize_all` is already queued/running); recompute dashboard aggregate snapshot. `startSeoAuditJob()`
      calls `recoverSeoQueue()` as its FIRST line, then `cron.schedule('*/15 * * * *', runAuditSweep)` plus a
      flagged-no-op daily `0 3 * * *` crawler stub. Depends on step 10.
      Files: api-node/src/services/seoAuditJob.ts
      Verify: `npx tsc --noEmit` passes.

- [ ] 12. Add the feature flags + `invalidateSeoCaches` + category sitemap lastmod (design §6.9/§7, findings 2 & 3).
      In `utils/features.ts`: add `seoAuto: true` and PHASE-2 keys `seoAutoGsc/seoAutoGa4/seoAutoGbp/seoAutoCrawler: false`
      to `FEATURE_KEYS` + `DEFAULT_FEATURES` with the documented inverted-convention comment (merge logic unchanged).
      In `routes/seo.ts`: export `invalidateSeoCaches()` that deletes BOTH `'sitemap'` and `'robots'` keys, and change
      the sitemap category select to `{ slug: true, seo_generated_at: true }` passing it to `urlEntry` (omits when null).
      Files: api-node/src/utils/features.ts, api-node/src/routes/seo.ts
      Verify: `npx tsc --noEmit` passes.

- [ ] 13. Add the staff-gated admin router `src/routes/seo-admin.ts` + `src/utils/rateLimit.ts` (design §7/§10).
      New router with every route `requireStaff('settings')`, zod-validated bodies, token-bucket rate limit on
      optimize/audit/rollback: `GET /dashboard`, `GET /products`, `POST /optimize`, `POST /audit`, `GET /jobs/:id`,
      `GET /jobs`, `POST /rollback`, `POST /override`, `POST /reset-auto`, `GET /integrations`,
      `POST /integrations/:provider`. Returns real data only; no secrets. Depends on steps 8-11.
      Files: api-node/src/routes/seo-admin.ts, api-node/src/utils/rateLimit.ts
      Verify: `npx tsc --noEmit` passes.

- [ ] 14. Wire the hooks into the commerce routes, import, OG, and server (design §6.1/§6.6/§7/§15).
      `routes/admin.ts` `POST /products`: set `seo_overrides[field] = true` only for non-empty-string admin SEO
      values (empty/absent clears), then fire-and-forget `runProductSeo` (never block/fail the save). `POST /categories`:
      same rule + fire-and-forget `runCategorySeo` on add/update + reprocess reassigned products on slug rename (reuse the
      existing `updateMany` tx). `routes/og.ts`: ADD `GET /api/og/category/:slug` (shareHtml with Breadcrumb +
      new `buildItemListJsonLd`, slug `^[a-z0-9-]{1,120}$`) and `GET /api/og/image/category/:slug` (reuse `getOrRenderOg`).
      `services/dataImport.ts` `runImport`: enqueue one changed-only `audit` job after completion (idempotent). `server.ts`:
      mount `app.use('/api/admin/seo-auto', requireAuth, seoAdminRouter)` BEFORE `/api/admin`, and call `startSeoAuditJob()`
      in the `app.listen` callback beside the existing start fns. Depends on steps 9-13.
      Files: api-node/src/routes/admin.ts, api-node/src/routes/og.ts, api-node/src/services/dataImport.ts, api-node/src/server.ts, api-node/src/seo/localSeo.ts (add buildItemListJsonLd)
      Verify: `npx tsc --noEmit` passes.

- [ ] 15. Add the web admin SEO dashboard + client and wire it into the shell (design §8).
      NEW `web/src/lib/seoAdmin.ts` (typed client + React-Query hooks for dashboard + job polling, mirroring `lib/admin.ts`).
      NEW `web/src/pages/admin/AdminSeo.tsx` (real-data counters, four buttons: Optimize All Eligible / Optimize Selected /
      Run Full Audit / Rollback Last Changes; PHASE-2 metrics render explicit "not available / not connected"; bilingual copy).
      EDIT `web/src/App.tsx` (add `<Route path="seo" element={<AdminSeo />} />` under `/admin`), `AdminApp.tsx` (add the
      `ADMIN_TABS` entry `{ path: 'seo', key: 'settings', icon: '🔍', label: 'SEO', title: '🔍 SEO Engine' }`),
      `web/src/types.ts` (new product/category SEO fields + `SeoConfig.defaultLang` + dashboard types),
      `web/src/lib/features.ts` (new flag keys + bilingual labels; PHASE-2 call sites pass `def=false`),
      `web/src/pages/admin/AdminSettings.tsx` (small `defaultLang` select through existing `saveSeo()`).
      Files: web/src/lib/seoAdmin.ts, web/src/pages/admin/AdminSeo.tsx, web/src/App.tsx, web/src/pages/admin/AdminApp.tsx, web/src/types.ts, web/src/lib/features.ts, web/src/pages/admin/AdminSettings.tsx
      Verify: `npm run build` in web passes (tsc -b && vite build).

- [ ] 16. Final cross-cutting verification.
      Run the full gates: `npx tsc --noEmit` in api-node, `npx prisma generate` in api-node, `npm run build` in web.
      Confirm no existing commerce route/page changed behavior (hooks are fire-and-forget, columns ADD-only). Do NOT start servers.
      Files: (none — verification only)
      Verify: all three commands exit 0.
