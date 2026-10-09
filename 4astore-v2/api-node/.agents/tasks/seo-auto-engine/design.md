# Design — Automatic Zero-Manual-Entry SEO Engine (4A Store v2)

> Scope: build an **automatic SEO engine** on top of the existing admin-managed SEO
> foundation inside `4astore-v2` (the live app). All code lives under
> `.worktrees/seo-auto-engine/4astore-v2`. The legacy static HTML/PHP site at the repo
> root is **out of scope**.
>
> Iteration: **revision 4** — revision 3's review (`design-review.json`, verdict
> `CHANGES_REQUESTED`, 0 HIGH + 2 MEDIUM + 3 NIT) was raised against the actual source. All 5
> of those findings are resolved against re-verified source in this revision; see the
> **Responses to design review (revision 4)** section at the end of this document. (The
> revision-3 and revision-2 response tables are retained below it for history.)

---

## 1. Overview

4A Store v2 already ships a solid, admin-*managed* SEO foundation: per-product override
columns (`seo_title`/`seo_description`/`seo_keywords`/`og_image`), a global
`config.seo` blob, `deriveProductSeo()` + JSON-LD builders in `seo/localSeo.ts`, a
crawler-facing OG/share pipeline (`routes/og.ts` + `services/og.ts`), a dynamic
sitemap/robots router (`routes/seo.ts`), an admin SEO sub-tab, and mirrored web
builders (`web/src/lib/seo.ts`, `components/Seo.tsx`). What it does **not** have is
*automation*: today SEO fields are blank until a human types them, nothing fires on
product create/update/import, there is no bulk optimizer, no audit job, no completeness
score, no dashboard, and no backup/rollback.

This design turns that foundation into an engine where the admin never types any SEO
field. Everything is **derived from real product/category/store data**, validated,
persisted into the existing `seo_*` columns, and published through the existing crawler
routes. Every generated field stays an **editable optional override**: a per-field
`override` flag means regeneration never clobbers a human edit. We **reuse**
`deriveProductSeo`, the OG image pipeline, the JSON-LD builders, and the
cron-every-minute background-job pattern from `reminderJob.ts` / `videoScheduler.ts` —
no new queue dependency.

The engine is a thin orchestration layer over existing primitives:
- a **generation module** (pure functions, extends `localSeo.ts`) producing per-product
  and per-category SEO payloads from DB truth;
- a **validation module** (zod-style gates) that blocks fabricated or unsafe output;
- a **persistence module** writing to `seo_*` columns + two new audit/job tables via
  guarded raw SQL;
- **hook points** on `POST /admin/products` and `services/dataImport.ts`;
- a **background audit/batch job** (one `node-cron` sweep, one in-process queue mirroring
  `video/queue.ts`'s DB-row model);
- new **permission-gated endpoints** and a new **admin dashboard page**.

**Technology stack (locked):** Node 18 + TypeScript + Express + Prisma + MariaDB 10.4
on the API; React + Vite + TypeScript + react-helmet-async + @tanstack/react-query on
the web. Background scheduling via the already-present **`node-cron`** (no BullMQ/Redis).
Schema changes ship as **guarded idempotent raw-SQL files** + `schema.prisma` edits +
`npx prisma generate` — never `prisma migrate`. Type-check gate: `npx tsc --noEmit` in
`api-node`; build gate: `npm run build` in `web`.

---

## 2. What already exists vs. what to ADD

### Already exists (reuse, do NOT rebuild)

| Area | Existing asset |
| --- | --- |
| Per-product SEO columns | `products.seo_title`, `seo_description`, `seo_keywords`, `og_image` (seo.sql + schema.prisma) |
| Per-product SEO derivation | `deriveProductSeo()` in `seo/localSeo.ts` (override-first → generated local line) |
| JSON-LD builders | `buildProductJsonLd`, `buildBreadcrumbJsonLd`, `buildOrganizationJsonLd`, `buildLocalBusinessJsonLd` |
| Global SEO config | `config.seo` LONGTEXT + `defaultSeoConfig`/`mergeSeoConfig` (settings-derived business defaults) |
| OG image pipeline | `services/og.ts` `getOrRenderOg`/`renderOgImage` (≤100 KB), `routes/og.ts` share HTML + `/api/og/image/*` |
| Crawler meta | `routes/og.ts` `shareHtml()` (title/desc/keywords/robots/canonical/OG/Twitter + JSON-LD) |
| Sitemap + robots | `routes/seo.ts` `/api/sitemap.xml` + `/api/robots.txt` (5-min cache, never flag-gated) |
| CMS page SEO | `pages.meta_keywords`, `routes/pages.ts`, `routes/og.ts` page share |
| Admin SEO UI | Settings → 🔎 SEO sub-tab, `web/src/lib/admin.ts` `saveSeo()`, `web/src/lib/seo.ts` mirror builders, `components/Seo.tsx` |
| Feature flags | `utils/features.ts` + `web/src/lib/features.ts` (`seoModule`; verified: a key is OFF only when explicitly stored `false`, missing → `DEFAULT_FEATURES` value, all current keys `true` = "absent = ON") |
| Background jobs | `services/reminderJob.ts` (cron sweep), `services/videoScheduler.ts` + `video/queue.ts` (DB-row job queue, recover-on-start, one-at-a-time) |
| Auth | `requireAuth`, `requireStaff('settings')`, `hasPermission` in `auth/middleware.ts` |
| Import | `services/dataImport.ts` `importProducts`/`importCategories`/`runImport` (idempotent upsert by id) |

### To ADD

| New | Purpose |
| --- | --- |
| `prisma/seo-auto.sql` | guarded ADD-only columns: product/category auto-SEO metadata + override flags + score; new tables `seo_jobs`, `seo_audit_log`, `seo_backups`, `seo_integrations` |
| `schema.prisma` edits | new `Product`/`Category` columns; `SeoJob`, `SeoAuditLog`, `SeoBackup`, `SeoIntegration` models |
| `src/seo/generate.ts` | pure per-product + per-category SEO generators (extends `localSeo.ts`), keyword engine, description generator, alt-text, slug |
| `src/seo/validate.ts` | pre-publish quality/safety gates (relevance, dedupe, slug safety, DB-truth checks) |
| `src/seo/persist.ts` | override-aware write of generated fields into `seo_*` columns + score + audit + backup |
| `src/seo/completeness.ts` | per-product/category completeness score + unresolved-problem list |
| `src/seo/dedupe.ts` | duplicate title/description/slug detection + keyword cannibalization map |
| `src/seo/integrations.ts` | GSC/GA4/GBP connect/disconnect/status plumbing (safe no-op when disconnected) |
| `src/services/seoQueue.ts` | DB-row batch queue (mirrors `video/queue.ts`): enqueue/kick/recover/progress |
| `src/services/seoAuditJob.ts` | cron sweep (mirrors `reminderJob.ts`): scheduled audit + reprocess-on-change |
| `src/routes/seo-admin.ts` | staff-gated endpoints: optimize all/selected/category, audit, rollback, status, score, integrations |
| `web/src/lib/seoAdmin.ts` | typed client for the new endpoints |
| `web/src/pages/admin/AdminSeo.tsx` | new SEO dashboard page (buttons + real counters) |
| `web/src/App.tsx`, `AdminApp.tsx` edits | route + nav entry for the dashboard |
| category SEO columns + category share routes | automatic category-page SEO: new HTML share route `GET /api/og/category/:slug` **and** its paired image route `GET /api/og/image/category/:slug` (mirrors the product/page two-route pattern) |

---

## 3. Capability decisions — MUST-HAVE-NOW vs. PHASE-2

Each of the 14 areas is resolved below. "MUST-HAVE-NOW" ships in this engine;
"PHASE-2" ships the *plumbing/status* now and the full behavior later, with the reason.

| # | Capability | Decision | Justification |
| --- | --- | --- | --- |
| 1 | Automatic per-product SEO on create/update/import | **MUST-HAVE-NOW** | Core goal; all primitives exist (`deriveProductSeo`, columns, OG). |
| 2 | 'Auto SEO Optimize' bulk feature | **MUST-HAVE-NOW** | Needed to backfill the existing catalogue; queue pattern already exists. |
| 3 | Dynamic price/stock/offer sync | **MUST-HAVE-NOW** | DB is already single source of truth; `in_stock`/`price`/`mrp` already drive JSON-LD. Offer-validity + pack/variant are **PHASE-2 within this item** (no DB fields for them yet — see §6.3). |
| 4 | Keyword engine (anti-cannibalization) | **MUST-HAVE-NOW** (derivation + dedupe map); GSC-signal weighting **PHASE-2** | Derivation from real taxonomy is deterministic; volume/position metrics require GSC (unavailable → labelled). |
| 5 | Automatic description generation (Hindi + English) | **MUST-HAVE-NOW** | Template-based, verified-attribute-only; no model dependency. |
| 6 | Automatic category SEO | **MUST-HAVE-NOW** | Mirrors product path; needs new category columns + share route. |
| 7 | Global/static page SEO defaults + fallbacks | **MUST-HAVE-NOW** | Mostly a correctness policy (indexing map, no-noindex guard); low new code. |
| 8 | Technical SEO maintenance (sitemap/robots/canonical/redirects/link checks) | Sitemap/robots freshness + canonical + indexing policy **MUST-HAVE-NOW**; broken-link + HTTP-status + orphan-page + duplicate-content crawler + redirect-manager **PHASE-2** | Freshness is a cache-bust (cheap). A full site crawler is a separate subsystem with network/time budget risk; ship the audit *framework* now, crawler checks later. |
| 9 | Schema + social metadata | **MUST-HAVE-NOW** | Builders exist; add Category/ItemList/Article/VideoObject reuse + dedupe guard. |
| 10 | Local SEO from verified business config | **MUST-HAVE-NOW** (NAP/schema/area); GBP API **PHASE-2** (status + manual instructions) | LocalBusiness JSON-LD already built from `config.seo.business`; GBP needs OAuth creds. |
| 11 | GSC + GA4 integrations | **PHASE-2** (connect/disconnect/status plumbing + safe no-op NOW) | Cannot build data import without live OAuth credentials; ship status plumbing + "not connected" per the brief. |
| 12 | Quality/safety validation before publish | **MUST-HAVE-NOW** | Non-negotiable guardrail; blocks fabrication. |
| 13 | SEO admin dashboard | **MUST-HAVE-NOW** | Required operator surface; all counters come from real queries. |
| 14 | Completeness score + unresolved-problems list | **MUST-HAVE-NOW** | Derived from validation output; cheap and high-value. |

**Nothing is silently dropped.** PHASE-2 items ship their data model + status surface now
so a later iteration only fills behavior behind an already-wired flag/endpoint.

**Flag-default correction (verified against `utils/features.ts` / `web/src/lib/features.ts`).**
The existing flag system has exactly one rule: `mergeFeatures` starts from
`DEFAULT_FEATURES` and only flips a key when it is *explicitly stored* `false`; a missing
key resolves to its default, and every current key in `DEFAULT_FEATURES` is `true`
("absent = ON"). A new key added naively therefore ships **ON**, which is the opposite of
what the PHASE-2 automation needs. We resolve this with **option (a): carry the OFF in the
default itself.** The new PHASE-2 keys are added to `DEFAULT_FEATURES` as `false`, so a
missing (never-stored) key resolves to `false` — PHASE-2 automation stays dark until an
admin explicitly stores `true`. `mergeFeatures` needs no change (it already seeds from
`DEFAULT_FEATURES`, and a stored `true` turns the key on). On the web, `isFeatureOn` takes
a per-call `def`; PHASE-2 call sites pass `def=false` so a web client with an older API
(no `features` object) also treats them as OFF. The master `seoAuto` key keeps the normal
`true` default (the automatic engine itself ships ON). This inverted convention for the
PHASE-2 keys is documented in a comment next to the new keys in both files. See §7 for the
exact key list and §14 for the compliance note.

---

## 4. Database changes

All changes are **ADD-only, backward-compatible, idempotent, re-runnable**, following the
exact `seo.sql` / `charges-settings.sql` pattern (information_schema guard before
`ALTER TABLE ... ADD COLUMN`, `PREPARE/EXECUTE/DEALLOCATE`). New tables use
`CREATE TABLE IF NOT EXISTS` (InnoDB, utf8mb4) exactly like `ensureNotificationTables()`.

New file: **`api-node/prisma/seo-auto.sql`**. Also mirror every new column/table into
`schema.prisma`, then run `npx prisma generate`. The engine code tolerates the columns
being absent (COALESCE / `SELECT *` / try-catch) so it is safe before the SQL runs — same
discipline as the current SEO foundation.

### 4.1 `products` — new columns

Reuse the existing `seo_title`/`seo_description`/`seo_keywords`/`og_image` for the
*effective* values (so the crawler + web keep reading one place). Add metadata ONLY where
the existing columns cannot carry it:

| Column | Type | Purpose |
| --- | --- | --- |
| `seo_slug` | `VARCHAR(200) NULL` | unique, URL-safe slug derived from name (routes stay `/product/:id`; slug used in canonical display + feeds + sitemap optional) |
| `seo_overrides` | `JSON NULL` | per-field human-edit flags, e.g. `{"title":true,"description":false,...}`; a `true` field is NEVER regenerated |
| `seo_auto_json` | `JSON NULL` | last **generated** payload (title/desc/keywords/altText/descEn/descHi/jsonLdHints) — lets us diff, roll back, and show "auto vs override" |
| `seo_score` | `TINYINT UNSIGNED NULL` | completeness score 0–100 |
| `seo_problems` | `JSON NULL` | unresolved-problem codes for this product |
| `seo_generated_at` | `DATETIME(3) NULL` | last successful auto-generation timestamp |
| `seo_source_hash` | `CHAR(40) NULL` | SHA-1 of the source fields used (name/brand/category/weight/price/mrp/in_stock/description/image) → cheap change-detection for reprocess |

> Note: `deriveProductSeo()` returns **only** `{ title, description, keywords }` — those
> three effective columns (`seo_title`/`seo_description`/`seo_keywords`) are what it
> produces, and the engine writes generated values **into** those columns only when the
> matching `seo_overrides` flag is not `true`. `seo_auto_json` keeps the generated copy
> regardless, so an override can be reverted to auto.
>
> **`og_image` is NOT an engine-generated effective field (finding 2, revision 3).**
> `deriveProductSeo()` does not return `og_image`; `routes/og.ts` resolves the share image
> as `absoluteImageUrl(product.og_image) || ${API_ORIGIN}/og/image/product/${id}` — i.e.
> `og_image` is a pure human override that, when empty, falls back to the on-demand rendered
> card. The engine therefore **never writes `og_image` from generation**: it is written only
> via the human override path (keeping its existing override-or-render-card semantics
> untouched), so the empty→render-card fallback and any admin-uploaded share image are never
> stomped. The engine's image-SEO outputs are the generated **`imageAlt`** and the on-demand
> rendered card — not `og_image`.

### 4.2 `categories` — new columns

Categories currently have **no** SEO columns. Add (mirroring products):

| Column | Type | Purpose |
| --- | --- | --- |
| `seo_title` | `VARCHAR(255) NULL` | effective category title |
| `seo_description` | `TEXT NULL` | effective meta description |
| `seo_keywords` | `VARCHAR(500) NULL` | effective keywords |
| `seo_intro` | `TEXT NULL` | short intro paragraph derived from actual products in the category |
| `og_image` | `VARCHAR(500) NULL` | optional override share image |
| `seo_overrides` | `JSON NULL` | per-field human-edit flags |
| `seo_auto_json` | `JSON NULL` | last generated payload |
| `seo_score` | `TINYINT UNSIGNED NULL` | completeness score |
| `seo_problems` | `JSON NULL` | unresolved-problem codes |
| `seo_generated_at` | `DATETIME(3) NULL` | last generation time |
| `seo_source_hash` | `CHAR(40) NULL` | change-detection hash (category name + member product set signature) |

### 4.3 New tables

**`seo_jobs`** (batch/optimize jobs — mirrors `video_jobs` row model):

```
id BIGINT UNSIGNED AUTO_INCREMENT PK
type         VARCHAR(32)  NOT NULL   -- 'optimize_all' | 'optimize_selected' | 'optimize_category' | 'audit'
status       VARCHAR(16)  NOT NULL   -- 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
scope        JSON         NULL        -- {productIds?:[], category?:string}
total        INT          NOT NULL DEFAULT 0
processed    INT          NOT NULL DEFAULT 0
updated      INT          NOT NULL DEFAULT 0
skipped      INT          NOT NULL DEFAULT 0
failed       INT          NOT NULL DEFAULT 0
progress     TINYINT UNSIGNED NOT NULL DEFAULT 0
backup_id    BIGINT UNSIGNED NULL     -- FK-ish to seo_backups for rollback
log          JSON         NULL        -- bounded array of {entityType,id,action,problem?}
error        TEXT         NULL
created_by   VARCHAR(64)  NULL
created_at   DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3)
started_at   DATETIME(3)  NULL
finished_at  DATETIME(3)  NULL
INDEX(status), INDEX(created_at)
```

**`seo_audit_log`** (every automatic change — audit logging requirement):

```
id BIGINT UNSIGNED AUTO_INCREMENT PK
entity_type  VARCHAR(16)  NOT NULL   -- 'product' | 'category' | 'global' | 'page'
entity_id    VARCHAR(64)  NOT NULL   -- product/category id or slug
action       VARCHAR(32)  NOT NULL   -- 'generate' | 'publish' | 'skip_override' | 'validation_fail' | 'rollback'
field        VARCHAR(32)  NULL        -- which field changed
before_val   TEXT         NULL
after_val    TEXT         NULL
reason       VARCHAR(255) NULL
job_id       BIGINT UNSIGNED NULL
actor        VARCHAR(64)  NULL        -- 'auto:hook' | 'auto:cron' | admin username
created_at   DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3)
INDEX(entity_type, entity_id), INDEX(job_id), INDEX(created_at)
```

**`seo_backups`** (rollback snapshots for high-impact changes):

```
id BIGINT UNSIGNED AUTO_INCREMENT PK
job_id       BIGINT UNSIGNED NULL
entity_type  VARCHAR(16)  NOT NULL
scope        JSON         NULL        -- what the backup covers
snapshot     LONGTEXT     NOT NULL    -- JSON array of pre-change rows (seo_* columns only)
created_by   VARCHAR(64)  NULL
created_at   DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3)
INDEX(job_id), INDEX(created_at)
```

**`seo_integrations`** (GSC/GA4/GBP connection state — never stores secrets in the client):

```
id BIGINT UNSIGNED AUTO_INCREMENT PK
provider     VARCHAR(16)  NOT NULL   -- 'gsc' | 'ga4' | 'gbp'
status       VARCHAR(16)  NOT NULL DEFAULT 'disconnected'  -- 'connected' | 'disconnected' | 'error'
account_ref  VARCHAR(190) NULL        -- site URL / property id / location id (non-secret)
last_sync_at DATETIME(3)  NULL
last_error   VARCHAR(255) NULL
updated_at   DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
UNIQUE(provider)
```

> **Credential storage:** OAuth client secrets / refresh tokens live in **env or a
> git-ignored config file on the server only** (e.g. `SEO_GSC_CLIENT_SECRET`,
> `SEO_GA4_PROPERTY_ID`, a git-ignored `config/seo-integrations.json`). `seo_integrations`
> stores only non-secret references + status. Secrets are **never** returned by any
> endpoint, never put in `config.seo`, never shipped in the client bundle, never
> committed. This satisfies the hard constraint.

### 4.4 schema.prisma edits

Add the new scalar fields to `model Product` and `model Category`, and add four new
models (`SeoJob`, `SeoAuditLog`, `SeoBackup`, `SeoIntegration`) with `@@map` to the new
tables, mirroring how `Notification`/`NotificationRecipient` are declared for runtime-
created tables. Then `npx prisma generate`. No `prisma migrate` / `db push`.

---

## 5. New modules (API)

### 5.1 `src/seo/generate.ts` — pure generators

Extends, does not replace, `localSeo.ts`. All functions are **pure** (input → payload),
so they are unit-testable without a DB.

- `generateProductSeo(product, cfg, categoryName?)` → `GeneratedProductSeo`:
  - **title**: `${name}${weight?` ${weight}`:''}${price>0?` - ₹${price}`:''} | ${storeName}`,
    clamped ≤ 60 chars (truncate on word boundary). Reuses `deriveProductSeo` shape.
  - **description (default-lang)**: natural sentence from verified attributes only
    (name, brand, category, weight, price/MRP if >0, in_stock). ≤ 160 chars.
  - **descHi / descEn**: Hindi + English variants (default language from `config.seo` —
    add `defaultLang: 'hi'|'en'` to the SeoConfig default; see §6.5). Transliterated-Hindi
    (Hinglish) keywords where relevant (reuse the existing Hinglish seed style already in
    `localSeo.ts`).
  - **keywords**: primary (name, brand, category) + secondary (keyword seeds + areaServed)
    + Hindi/transliterated variants. De-dup runs **first** (so the most valuable tokens
    survive), then the comma-joined string is capped to **500 characters** to match the
    `seo_keywords VARCHAR(500)` column (utf8mb4 counts characters, not bytes, so a 500-char
    cap always fits even with multi-byte Hindi tokens). Truncation happens on a **comma
    boundary — never mid-token**: drop whole trailing tokens until the joined string is
    ≤ 500 chars, rather than slicing a token in half.
  - **slug**: `slugify(name)` using the existing `slugify` already in `admin.ts`
    (extract to a shared util `utils/slug.ts` and import in both places — reuse, not
    duplicate); collision-resolved with `-2`, `-3`… against existing `seo_slug`.
  - **imageAlt**: `${name}${brand?` ${brand}`:''}${weight?` ${weight}`:''} — ${storeName}`
    (only from real attributes; empty when no image). **JSON-LD image argument is left
    unchanged (finding 4, revision 4):** the verified `routes/og.ts` product route resolves
    the schema.org `Product.image` as `absoluteImageUrl(product.og_image || product.image) ||
    <rendered card>`. The engine does **not** touch this call site — it only adds `imageAlt`
    as metadata and never rewrites the builder's `image` argument, so crawler image output is
    preserved exactly as today.
  - **canonical**: `${SITE_ORIGIN}/product/${id}` (unchanged route).
  - **indexing policy**: `index,follow` for in-catalogue products; the engine never emits
    `noindex` for a valid public product (see §6.7 guard).
  - **jsonLd hints**: pass-through to existing `buildProductJsonLd` /
    `buildBreadcrumbJsonLd`; `price` strictly from `price`; `priceCurrency: 'INR'`;
    `availability` strictly from `in_stock`. **Builder correction required (finding 1,
    revision 3):** the existing API builder `buildProductJsonLd` in `localSeo.ts` currently
    **hardcodes** `availability: 'https://schema.org/InStock'` for any priced product and
    its `ProductLike` interface has **no `in_stock` field** — so an out-of-stock product is
    presently published to crawlers as `InStock` via `routes/og.ts`
    `GET /api/og/product/:id`. This is a real fabricated-availability defect, not an
    existing guarantee. The fix (ADD-only, named in §2/§6.3/§15): add
    `in_stock?: boolean | null` to `ProductLike`, and derive
    `availability = product.in_stock === false ? 'https://schema.org/OutOfStock' :
    'https://schema.org/InStock'` (default to `InStock` only when the field is genuinely
    absent — parity with the already-correct web mirror in `web/src/lib/seo.ts`). Only
    after this correction is the "availability from `in_stock`" guarantee actually true.
    Never injects rating/review/discount claims.
- `generateCategorySeo(category, memberProducts, cfg)` → `GeneratedCategorySeo`:
  title/description/intro/keywords/slug/alt, where `intro` lists real sample product names
  and the real product count ("Chandargarh me 4A Store par <N> <category> products…");
  never writes an intro for an empty category (see §6.6 doorway guard).
- `sourceHash(product|category)` → SHA-1 of the ordered source fields; drives reprocessing.

### 5.2 `src/seo/validate.ts` — pre-publish gates (capability 12)

`validateProductSeo(generated, product, { existingTitles, existingSlugs })` → `{ ok, problems[] }`.
Each gate returns a stable **problem code** used by the completeness score and dashboard:

| Code | Rule | Failure behavior |
| --- | --- | --- |
| `TITLE_EMPTY` / `TITLE_TOO_LONG` | title non-empty, ≤ 60 | fall back to safe `name | store` |
| `DESC_EMPTY` / `DESC_TOO_LONG` | 50–160 chars | regenerate shorter / fall back |
| `TITLE_DUP` / `DESC_DUP` | not identical to another product's | append weight/brand to disambiguate |
| `SLUG_DUP` / `SLUG_UNSAFE` | unique + `^[a-z0-9-]+$` | suffix `-id` |
| `KEYWORDS_IRRELEVANT` | every keyword token appears in name/brand/category/attributes | drop the stray token |
| `CANONICAL_BAD` | absolute https, matches route | fatal → skip publish, log |
| `AVAILABILITY_MISMATCH` | recompute the expected availability token from DB `in_stock` (`in_stock === false → OutOfStock`, else `InStock`) and assert the builder emitted exactly that token | regenerate from DB (meaningful only after the §5.1 builder correction lands) |
| `PRICE_MISMATCH` | JSON-LD price == DB price | regenerate from DB |
| `IMAGE_MISSING_ALT` | if image present, alt non-empty | generate alt |
| `BLOCKED_PUBLIC` | product page not accidentally `noindex`/robots-blocked | fatal → skip, log |
| `SPAMMY` | no token repeated > 3× ; no banned claim words (see list) | strip/fallback |
| `FABRICATION` | description/keywords contain only verified attributes; banned-claims regex (`sabse sasta`, `cheapest`, `lowest price`, `#1`, `best price`, `guaranteed`, `100% organic` unless a verified attribute, review/rating words) | fatal → fall back to minimal safe metadata, log `validation_fail` |

**On failure:** recoverable problems trigger one regeneration attempt with the offending
field corrected; if still failing, the engine **falls back to safe metadata built only
from verified fields** (never publishes fabricated facts) and records the problem code in
`seo_problems`. Fatal gates (`CANONICAL_BAD`, `BLOCKED_PUBLIC`, unresolved `FABRICATION`)
skip the publish for that field, keep the previous value, and write a `validation_fail`
audit row. The banned-claims regex is the single enforcement point for "never invent
prices/discounts/ratings/cheapest/lowest".

### 5.3 `src/seo/persist.ts` — override-aware write

`persistProductSeo(productId, generated, { actor, jobId, backup })`:
1. Load current row (`seo_title/description/keywords/og_image/seo_slug/seo_overrides/seo_auto_json`).
2. Always store the fresh generated payload in `seo_auto_json`.
3. For each **engine-generated effective field** — `seo_title`, `seo_description`,
   `seo_keywords`, `seo_slug` (plus the stored `imageAlt`) — if `seo_overrides[field] ===
   true` → **skip** (log `skip_override`), else write the generated value into the effective
   column. **`og_image` is explicitly excluded from this loop** (finding 2): it is never
   written from generation, only via the human override path, so its empty→render-card
   fallback and any uploaded share image are preserved.
4. Compute `seo_score` + `seo_problems` via `completeness.ts`, set `seo_generated_at`,
   `seo_source_hash`.
5. Write per-field `seo_audit_log` rows (`before_val`/`after_val`). These rows are written
   **after** the step-6 transaction commits, fire-and-forget style like the existing push
   logging — they are **not** part of the awaited transaction, so a logging failure can
   never roll back the publish or block the response (finding 4, revision 3).
6. **Race safety:** the effective-column writes (step 3) **plus** the `seo_score`/
   `seo_problems`/`seo_generated_at`/`seo_source_hash` writes (step 4) all happen inside a
   single awaited `prisma.$transaction`, keyed by `id` — this is the atomic publish. The
   fire-and-forget `seo_audit_log` writes (step 5) run only after that transaction has
   committed and are deliberately outside it. The batch queue processes one entity at a time
   per job and the cron sweep skips entities whose row is locked / whose `updated_at`
   moved during generation (compare `seo_source_hash` just before write — if the source
   changed mid-flight, requeue instead of writing stale output). This prevents the import
   path and the cron from clobbering each other during bulk price changes.

**Override flag write path:** when an admin edits a field in the existing Settings → SEO
per-product panel, the save sets `seo_overrides[field] = true` server-side **inside the
existing `routes/admin.ts` `POST /products` handler** (see §7). A "Reset to auto" action
sets it back to `false` and regenerates. This is the mechanism that guarantees
"regeneration never clobbers a human edit".

**Permission note:** this override write happens inside the existing `POST /products`
handler, which is gated `requireAuth, requireStaff('products')` — it **inherits that
route's `products` permission**, NOT `settings`. The category override write inside
`POST /categories` likewise inherits that route's `requireStaff('categories')`. Only the
standalone `/api/admin/seo-auto/*` endpoints (§7) use `requireStaff('settings')`. Do **not**
add a `settings` check to the product/category routes — that would break staff who have
`products`/`categories` but not `settings`. Reset-to-auto and standalone override toggles
exposed on the new SEO dashboard go through `/api/admin/seo-auto/override` /
`/reset-auto`, which are `settings`-gated; the in-place writes on the commerce routes keep
their own permissions.

### 5.4 `src/seo/completeness.ts` — score + problems (capability 14)

`scoreProduct(product, generated, problems)` → `{ score: 0..100, problems: string[] }`.
Score = weighted sum of satisfied checks. The weights are **tunable constants** declared at
the top of `completeness.ts` (`SCORE_WEIGHTS` + `ATTENTION_THRESHOLD`), not magic numbers
scattered through logic, so an implementer can reproduce and adjust them. The initial
weights sum to **100** and are grouped so the two fields a crawler shows (title,
description) carry the most weight, DB-truth correctness is a hard-fail-ish heavy check,
and the rest are lighter hygiene checks:

| Check | Weight | Rationale |
| --- | --- | --- |
| Title present + ≤60 + unique | 20 | primary SERP element |
| Description present + 50–160 + unique | 20 | primary SERP element |
| JSON-LD price/availability match DB | 15 | truth correctness; a mismatch is near-fatal |
| Keywords present + relevant (no stray tokens) | 10 | relevance signal |
| Slug unique + safe | 10 | canonical/URL hygiene |
| Image present + non-empty alt | 10 | accessibility + image SEO |
| Canonical valid (absolute https, matches route) | 10 | indexation hygiene |
| Indexing policy correct (not wrongly noindexed) | 5 | indexation safety |
| **Total** | **100** | |

A failed check contributes 0 for its weight. Category scoring uses the same table minus
`price/availability` (reallocated to title/description/intro). `ATTENTION_THRESHOLD`
defaults to **80** (a product missing one 20-weight SERP element, or any fatal mismatch,
falls below it) and is a tunable constant. **"Needs attention" has one definition:**
`seo_score < ATTENTION_THRESHOLD` **OR** non-empty `seo_problems` — the dashboard and the
`audit`/skip logic both use this single predicate.

### 5.5 `src/seo/dedupe.ts` — duplicate + cannibalization (capabilities 2, 4)

- `findDuplicates()` → sets of product ids sharing an identical effective title / desc /
  slug (single `GROUP BY` queries over `products`). Feeds the dashboard "duplicate
  metadata" counters and the `TITLE_DUP`/`SLUG_DUP` gates.
- `keywordMap()` → for each primary keyword, the single best-matching page (highest
  relevance: exact name match > category match). When two products compete for the same
  primary keyword, the engine demotes the weaker one's primary keyword to secondary
  (anti-cannibalization). **Volumes/positions/competition are NEVER fabricated** — they
  are only populated when GSC is connected (PHASE-2); until then the dashboard shows the
  metric as `unavailable`.

### 5.6 `src/seo/integrations.ts` — GSC/GA4/GBP (capabilities 10 GBP, 11)

Pure plumbing now; data import PHASE-2. API surface:
- `getIntegrationStatus(provider)` → reads `seo_integrations` + presence of server-side
  creds; returns `connected|disconnected|error` + non-secret `account_ref`.
- `connect(provider, payload)` / `disconnect(provider)` → write status rows; actual OAuth
  exchange is behind the `seoAutoGsc`/`seoAutoGa4` flags and a **no-op when creds absent**
  (returns `disconnected` with a clear message). When disconnected, every consumer
  (keyword weighting, dashboard "organic performance") **safely no-ops** and shows "not
  connected" — never fabricates GSC/GA4 numbers or claims indexing.
- GBP: no API call unless authorized+configured; otherwise the dashboard shows status +
  manual verification instructions.

---

## 6. Capability specifics

### 6.1 Automatic per-product SEO (capability 1) — hook points

Two hook points, both calling one shared entry `runProductSeo(productId, { actor })` in
`persist.ts`:

**Master kill-switch gate (finding 2, revision 4).** `runProductSeo`, `runCategorySeo`, and
`runAuditSweep` (the per-entity and sweep entry functions) **all begin with a single gate**
that reads the merged server-side feature flags and **early-returns (no-op) when `seoAuto` is
off**. The flags are loaded from the same `config.features` blob that `POST /api/admin/features`
writes, run through the existing `mergeFeatures(...)` (so a never-stored key resolves to its
`DEFAULT_FEATURES` value — `seoAuto` defaults `true`):

```ts
// seo/persist.ts — top of runProductSeo / runCategorySeo / runAuditSweep
const features = mergeFeatures(await loadStoredFeatures()); // reads config.features
if (!features.seoAuto) return; // master kill-switch: automation dark, commerce untouched
```

Because every automation path funnels through these three entry functions, this one gate
disables **all** of it when `seoAuto=false`: the `POST /admin/products` create/update hook
(below), the import audit enqueue (§6.1.2), and the 15-min cron sweep (§6.9). No redeploy is
needed — flipping the stored flag off halts generation immediately while leaving every commerce
operation untouched. See §6.9 and the §11 invariant table.

1. **`POST /admin/products`** (`routes/admin.ts`, actions `add` + `update`): after the
   existing `prisma.product.create/update`, call `runProductSeo(product.id, {actor: username})`
   **fire-and-forget** (do not block the admin response; errors logged, never surfaced as
   a product-save failure). On `update`, if the admin supplied `seoTitle`/`seoDescription`/
   etc., set the corresponding `seo_overrides[field] = true` first (human edit wins).
2. **`services/dataImport.ts` `runImport`**: after the upsert loop, do **not** run
   generation inline per row (large catalogues would stall the import). `runImport` is the
   single idempotent full-catalogue path shared by the CLI and the owner-only admin
   import, so it fires on routine reloads. To avoid re-optimizing (and re-rendering OG
   cards for) unchanged products on every reload, the import enqueues a **single `audit`
   (changed-only) `seo_jobs` row**, not `optimize_all`. The `audit` job iterates the
   catalogue and only (re)generates entities whose freshly computed `seo_source_hash`
   differs from the stored one (or whose `seo_generated_at` is null) — unchanged rows are
   counted `skipped` and never touch OG. Enqueue is idempotent: if an `audit` or
   `optimize_all` job is already `queued`/`running`, skip. The import audit enqueue is itself behind the `seoAuto` gate
   (the enqueue is skipped — and any already-queued job no-ops via the `runAuditSweep` gate —
   when `seoAuto` is off, finding 2). This is the race-safe path
   during imports and is the **same trigger** the §6.9 cron uses, so the two do not queue
   duplicate work — see §6.2 and the overlap note in §6.9. (`optimize_all` remains
   available only as an explicit operator action from the dashboard, where a full forced
   re-optimization is intended.)

The engine also hooks category changes: `POST /admin/categories` add/update enqueues the
affected category + reprocesses products whose category slug changed (reuse the existing
`tx.product.updateMany` block already in the category route).

### 6.2 Bulk 'Auto SEO Optimize' (capability 2)

Backed by `seo_jobs` + `src/services/seoQueue.ts` (mirrors `video/queue.ts`):
- **Enqueue** `optimize_all` | `optimize_selected` (ids) | `optimize_category` (slug) |
  `audit`. Job-type semantics:
  - `audit` — **changed-only**: iterates the scope but regenerates only entities whose
    `seo_source_hash` changed or that were never generated; everything else is `skipped`.
    This is what the import hook (§6.1.2) and the §6.9 cron enqueue, so a routine reload is
    a near-no-op on unchanged products.
  - `optimize_all` / `optimize_selected` / `optimize_category` — operator-initiated forced
    runs from the dashboard. These still apply the idempotent skip below (unchanged hash +
    good score + no problems ⇒ skipped), so even a forced "Optimize All" does not re-render
    OG for already-good unchanged products.
  Before a run that will write, snapshot the affected rows' `seo_*` columns into
  `seo_backups` and link `seo_jobs.backup_id` → enables rollback.
- **kick()** processes one job at a time; within a job it iterates entities in batches
  (default 50) with a short `await` yield between batches to avoid event-loop starvation /
  request timeouts — the queue runs **out-of-band** from the HTTP request (the endpoint
  returns the job id immediately; the client polls status).
- **Idempotent:** the queue skip uses the **same `ATTENTION_THRESHOLD` constant** defined in
  `completeness.ts` (§5.4) as the "needs attention" predicate — there is no second threshold
  (finding 5, revision 4). An entity is **skipped** (counted in `skipped`) when
  `seo_source_hash` is unchanged **AND** `seo_score ≥ ATTENTION_THRESHOLD` **AND** no
  `seo_problems`. Because both surfaces read the one constant, an entity can never be skipped
  by the optimizer while still flagged "needs attention" on the dashboard (or vice-versa).
  Re-running the same job is a no-op on already-good entities.
- **Retries:** per-entity failure retries up to 2× with backoff; persistent failure is
  recorded in the job `log` + `failed` count and does not abort the whole job.
- **Progress + logs:** `progress`/`processed`/`updated`/`skipped`/`failed` written every
  batch (like `video/queue.ts` writing progress every ~3%). The `log` JSON holds a bounded
  (last ~200) list of per-entity outcomes + failure details.
- **Recover-on-start:** `recoverSeoQueue()` marks any `running` job interrupted by a
  restart as `failed` with a clear message and resumes `queued` jobs. Wiring mirrors
  `videoScheduler.ts` exactly (verified: `startVideoScheduler()` calls `recoverQueue()` as
  its first line; `server.ts` does **not** call `recoverQueue()` directly). So:
  `recoverSeoQueue()` is invoked at the **top of `startSeoAuditJob()`** (in
  `services/seoAuditJob.ts`), and `startSeoAuditJob()` is called from `server.ts`'s
  `app.listen` callback beside `startReminderJob()` / `startVideoScheduler()`. Nothing is
  added to `server.ts` other than that one start call.
- **Avoid duplicate/conflicting processing:** a single in-process `running` guard (same as
  `video/queue.ts`) means only one job runs at a time; the import hook de-dupes queued
  `optimize_all` rows.

### 6.3 Dynamic price/stock/offer sync (capability 3)

- Price/stock/availability already flow live at request time: `routes/og.ts` and
  `web/src/lib/seo.ts` read `product.price`/`in_stock` on each request, so **there is no
  stored stale copy** — JSON-LD is always computed from the current row. One correction is
  required here (finding 1, revision 3): today only the **web** mirror
  (`web/src/lib/seo.ts`) derives `availability` from `in_stock`; the **API** builder
  `buildProductJsonLd` in `localSeo.ts` still **hardcodes** `InStock` (and its `ProductLike`
  has no `in_stock` field), so the crawler path publishes out-of-stock products as
  `InStock`. This revision therefore **corrects** the API builder to derive `availability`
  from `in_stock` (`in_stock === false → OutOfStock`, else `InStock`), bringing it into
  parity with the web mirror; `price` already comes from the DB. Only after this fix does
  the §11 invariant "Published JSON-LD price/availability == DB" actually hold on the
  crawler path. The engine's job is then only to (re)generate the
  *text* fields (title/description) when price/stock changes materially: the
  `seo_source_hash` includes `price`/`mrp`/`in_stock`, so a price edit flips the hash and
  the cron sweep (§6.9) regenerates the title/description that embed the price.
- **MUST-HAVE-NOW:** regular price, MRP, availability (InStock/OutOfStock), currency INR.
- **PHASE-2 (within this item):** sale-price vs regular-price split, offer validity
  windows, pack size/variants, GTIN/MPN identifiers, product feeds (Merchant Center) —
  the DB has no columns for these today (adding them is a larger commerce change outside
  "ADD-only SEO"). Decision: ship availability+price now; design the feed/offer fields as
  a PHASE-2 ADD-only migration. **Expired offer info is removed automatically** by never
  storing an offer end-date we cannot honour — until offer fields exist, no offer/sale
  claim is emitted at all (prevents fabricating discounts).

### 6.4 Keyword engine (capability 4)

Derivation in `generate.ts` + cannibalization map in `dedupe.ts` (see §5.5). Metrics
(volume/position/competition) are **labelled unavailable** until GSC connects. Optional
site-search signal hook is a PHASE-2 no-op stub.

### 6.5 Automatic description generation (capability 5)

Template sentences assembled from verified attributes only, in Hindi + English + Hinglish
variants. Default language read from a new `config.seo.defaultLang` (`'hi'` default). To be
genuinely admin-editable (and not silently reset by `mergeSeoConfig`, which drops keys it
does not explicitly copy), `defaultLang` is wired through **all three** layers, verified
against the current code:
1. `defaultSeoConfig` in `localSeo.ts` gains `defaultLang: 'hi'`.
2. `mergeSeoConfig` explicitly copies `defaultLang` from the raw blob, falling back to
   `'hi'` when absent/invalid (`raw.defaultLang === 'en' ? 'en' : 'hi'`).
3. The admin `seoSchema` in `routes/admin.ts` `POST /seo` gains
   `defaultLang: z.enum(['hi','en']).optional()` so the admin can actually set it (today
   the schema has no such field and `POST /seo` runs the body through `mergeSeoConfig`, so
   an unmerged key would be dropped). It is surfaced as a small select in the web SEO
   sub-tab (§8).
Kept in sync via `seo_source_hash` change-detection. **Banned-claims regex**
(§5.2 `FABRICATION`) runs on every generated description before publish, so no fabricated
ingredients/origin/expiry/reviews can ship.

### 6.6 Automatic category SEO (capability 6)

New category columns (§4.2) + `generateCategorySeo` (§5.1). Mirroring the verified
product/page pattern in `routes/og.ts` (each entity has a **HTML** route plus a separate
**image** route that `getOrRenderOg` renders and the HTML's `og:image` points at), add
**two** routes:
- `GET /api/og/category/:slug` — share HTML (`shareHtml()` with title/desc/keywords/
  canonical/robots/OG/Twitter + `buildBreadcrumbJsonLd` + a new `buildItemListJsonLd` for
  the product list). Its `og:image` is set to `${API_ORIGIN}/og/image/category/:slug`.
- `GET /api/og/image/category/:slug` — the share card, rendered via the existing
  `getOrRenderOg` (reuse, do NOT add a second OG pipeline); card uses the category's
  `og_image` override if set, else a logo-or-sample-product card, mirroring
  `/image/page/:slug`.
Slug validation uses `^[a-z0-9-]{1,120}$` (404 otherwise). **The category bound is 120,
not the page route's 80 (finding 1, revision 4):** `categorySchema.slug` in `routes/admin.ts`
is `z.string().trim().max(120)` and the stored slug is `slugify(c.slug || c.name)`, so a real
category slug can be 81–120 chars. The `{1,80}` bound copied from the page route (`routes/og.ts`
`/page/:slug` + `/image/page/:slug`, where page slugs are capped at 80) would 404 any
legitimately-stored long-slug category and silently break its share HTML and share image — the
very `og:image` the engine emits for that category. Both new category OG routes
(`GET /api/og/category/:slug` and `GET /api/og/image/category/:slug`) therefore use
`^[a-z0-9-]{1,120}$`, matching `categorySchema`'s `max(120)`; see also the §10
`optimize.category` validator, which uses the same `{1,120}` bound.
Sitemap already includes non-hidden categories; the engine adds category `<lastmod>`
sourced from `categories.seo_generated_at` (see §4.2 — the only timestamp a category has;
omit `<lastmod>` when null) and keeps category metadata fresh when the member-product set
changes (`seo_source_hash` includes the member signature). Concretely, the §6.9 sweep's
sitemap read changes the category select from `{ slug: true }` to
`{ slug: true, seo_generated_at: true }` and calls
`urlEntry(`${SITE_ORIGIN}/category/${c.slug}`, c.seo_generated_at)` (the existing
`urlEntry(loc, lastmod?)` already omits `<lastmod>` when the date is null). **Doorway/empty guard:** a category
with zero visible products gets **no generated intro and is excluded from richer schema**
(still crawlable, but not padded with fake content); no mass location pages are generated.

### 6.7 Global/static page SEO (capability 7)

A single **indexing policy map** (constant in `seo/generate.ts`) is the source of truth:

| Page type | Indexing |
| --- | --- |
| home, about, contact, delivery, policies, offers, blog, product, category | `index,follow` |
| cart, checkout, account/profile, admin, internal search, order/track | `noindex,nofollow` (enforced; admin already emits `noindex` in `AdminApp.tsx`) |

Enforcement: the `BLOCKED_PUBLIC` gate (§5.2) refuses to emit `noindex` for any page in the
first group; the second group is hard-coded `noindex`. **No new `robots.txt` disallow
lines are added:** the verified `routes/seo.ts` robots emits `Disallow: /admin` +
`Disallow: /api/` plus admin-editable extras, and cart/checkout/account/track are SPA
client routes with no server-rendered HTML to disallow — they are kept out of the index via
the per-page `noindex` meta (the hard-coded second group above), not robots. Adding robots
lines for them would be redundant and ineffective. No duplicate/conflicting
title/canonical/robots: the engine is the single writer, and the web `<Seo>` component
already emits exactly one canonical + one robots tag per page.

### 6.8 Schema + social metadata (capability 9)

Reuse all existing builders; ADD `buildItemListJsonLd` (category) and reuse
`VideoObject`/`Article` only where real data exists (video jobs already produce real
assets; blog/CMS pages → `Article`/`BlogPosting` from real title/updated_at). **Dedup
guard:** `routes/og.ts` builds the JSON-LD array in one place per route, so no duplicate
or contradictory `@type` blocks. The brief's "never claim guaranteed rich results" is
honoured in the dashboard copy (schema is "valid" not "guaranteed to show rich results").
**JSON-LD `image` resolution unchanged (finding 4):** the existing `routes/og.ts` image
argument (`absoluteImageUrl(product.og_image || product.image) || <rendered card>`) is left
as-is; the engine adds only `imageAlt` and never rewrites that argument (see §5.1).

### 6.9 Background audit job (capability 8 freshness, reprocess-on-change)

`src/services/seoAuditJob.ts` mirrors `reminderJob.ts`:
- `cron.schedule('*/15 * * * *', …)` (every 15 min) runs `runAuditSweep()`. **`runAuditSweep`
  early-returns when `seoAuto` is off** (finding 2 — same `mergeFeatures(loadStoredFeatures())`
  gate as `runProductSeo`/`runCategorySeo`), so the kill-switch halts the cron as well as the
  hooks:
  1. Find products/categories whose current `seo_source_hash` ≠ a freshly computed hash
     (data changed since last generation) OR whose `seo_generated_at` is null → enqueue a
     bounded reprocess (cap ~200/sweep to avoid long runs; the rest picked up next sweep).
     This is the **same changed-only `audit` work the import hook (§6.1.2) enqueues**; the
     enqueue is idempotent (skip if an `audit`/`optimize_all` job is already
     `queued`/`running`), so an import that just ran and the next cron tick do not create
     duplicate jobs or double-process the same rows.
  2. Bust the in-memory cache in `routes/seo.ts` when any entity published, so both the
     sitemap **and** robots are fresh on publish/change/remove. **The cache is one `Map`
     holding two keys, `'sitemap'` and `'robots'` (finding 3, revision 4):** clearing only
     `'sitemap'` would leave `robots.txt` stale for up to 5 min after a robots/canonical
     policy change. Export and call a function that clears **both** keys:
     ```ts
     // routes/seo.ts
     export function invalidateSeoCaches() { cache.delete('sitemap'); cache.delete('robots'); }
     ```
     Referenced as `invalidateSeoCaches()` in §13 and §15.
  3. Recompute dashboard aggregate counters into a small cached snapshot (duplicates,
     missing metadata, invalid canonicals) so the dashboard reads are cheap.
- A separate daily cron (`0 3 * * *`) runs the PHASE-2 crawler checks **when enabled**
  (broken-link/HTTP-status/orphan/duplicate-content). Shipped as a flagged no-op now.
- **Backups + rollback for high-impact technical changes:** any sweep that would change
  robots/canonical policy writes a `seo_backups` row first; `Rollback Last Changes`
  restores the most recent backup for the scope.

### 6.10 Local SEO (capability 10)

`buildLocalBusinessJsonLd` already derives NAP + area + geo from `config.seo.business`
(verified admin config). The engine never invents branches/locations/reviews. Service-area
pages are generated **only** for `areaServed` entries that already exist in verified
config and only when genuinely useful (gated; default off to avoid doorway pages). GBP =
status + manual instructions until authorized (PHASE-2).

---

## 7. New / edited API endpoints

All new endpoints are mounted in a new router `src/routes/seo-admin.ts`, registered in
`server.ts` as `app.use('/api/admin/seo-auto', requireAuth, seoAdminRouter)` **before**
the generic `/api/admin` mount (specific path first, matching the existing
`adminDataRouter` ordering). Every route additionally applies `requireStaff('settings')`.
Input validated with **zod** in the existing style; writes **rate-limited** (a simple
in-memory token bucket per user for the bulk/optimize/rollback actions, since there is no
existing rate-limit middleware — a small `utils/rateLimit.ts` ADD).

| Method + path | Permission | Body (zod) | Returns |
| --- | --- | --- | --- |
| `GET /api/admin/seo-auto/dashboard` | `settings` | — | aggregate counters (real data), job status, integration status |
| `GET /api/admin/seo-auto/products` | `settings` | query: filter (needs-attention/duplicate/all), cursor | paged products + score + problems |
| `POST /api/admin/seo-auto/optimize` | `settings` | `{ mode:'all'|'selected'|'category', productIds?:number[], category?:string }` | `{ jobId }` |
| `POST /api/admin/seo-auto/audit` | `settings` | — | `{ jobId }` |
| `GET /api/admin/seo-auto/jobs/:id` | `settings` | — | job progress/log |
| `GET /api/admin/seo-auto/jobs` | `settings` | — | recent jobs |
| `POST /api/admin/seo-auto/rollback` | `settings` | `{ jobId? }` (default: last job with a backup) | `{ restored:n }` |
| `POST /api/admin/seo-auto/override` | `settings` | `{ entityType, id, field, value }` | sets/clears `seo_overrides[field]` |
| `POST /api/admin/seo-auto/reset-auto` | `settings` | `{ entityType, id, field? }` | clears override(s) + regenerates |
| `GET /api/admin/seo-auto/integrations` | `settings` | — | GSC/GA4/GBP status (no secrets) |
| `POST /api/admin/seo-auto/integrations/:provider` | `settings` | `{ action:'connect'|'disconnect', accountRef? }` | status (no secrets) |

**Edited existing routes** (these keep their **existing** permissions — they are NOT
re-gated to `settings`):
- `routes/admin.ts` `POST /products` (gated `requireStaff('products')`, add/update): set
  `seo_overrides[field] = true` for any admin-supplied SEO field, then fire-and-forget
  `runProductSeo`. **Override detection rule (finding 9):** `productSchema` coerces absent
  SEO fields to `null` (`seo_title: p.seoTitle || null`), so presence alone cannot
  distinguish "cleared" from "not sent". The rule is therefore precise: set
  `seo_overrides[field] = true` **only when the parsed value is a non-empty string** (an
  explicit human value); an empty string or absent value means "no override / reset to
  auto" and clears the flag. If an explicit empty-string clear must be distinguished from
  a truly absent field, read `req.body.product[field]` before the `|| null` coercion. No
  new required fields are added to `productSchema`.
- `routes/admin.ts` `POST /categories` (gated `requireStaff('categories')`): same
  non-empty-string override rule for category SEO fields; fire-and-forget `runCategorySeo`
  on add/update; reprocess reassigned products on slug change (reuse the existing
  `tx.product.updateMany` transaction).
- `routes/og.ts`: ADD **two** category routes mirroring the product/page pattern — the
  HTML share route `GET /api/og/category/:slug` and the image route
  `GET /api/og/image/category/:slug` (see §6.6).
- `routes/seo.ts`: EXPORT `invalidateSeoCaches()` (clears **both** the `'sitemap'` and
  `'robots'` cache keys — finding 3); add category `<lastmod>` sourced from
  the new `categories.seo_generated_at` column (see §6.6). No breaking change.
- `services/dataImport.ts` `runImport`: after completion, enqueue one **`audit`
  (changed-only)** job — not `optimize_all` (see §6.1.2 / §6.2).
- `utils/features.ts` + `web/src/lib/features.ts`: ADD flags `seoAuto` (master) and
  `seoAutoGsc`, `seoAutoGa4`, `seoAutoGbp`, `seoAutoCrawler` (PHASE-2). **Default values
  are carried in `DEFAULT_FEATURES`**, because the verified merge logic only turns a key
  OFF when it is explicitly stored `false` (a missing key uses its default). Concretely:
  ```ts
  // api-node/src/utils/features.ts — add to FEATURE_KEYS and DEFAULT_FEATURES
  seoAuto: true,          // master: the automatic engine ships ON (absent = ON, like other keys)
  // PHASE-2 keys INVERT the "absent = ON" convention — default OFF so automation stays
  // dark until an admin explicitly stores `true`:
  seoAutoGsc: false,
  seoAutoGa4: false,
  seoAutoGbp: false,
  seoAutoCrawler: false,
  ```
  `mergeFeatures` is unchanged: it already seeds from `DEFAULT_FEATURES`, so a never-stored
  PHASE-2 key stays `false` and a stored `true` turns it on. On the web, add the same keys
  to `FEATURE_KEYS` + bilingual `FEATURE_LABELS`, and have every PHASE-2 call site read the
  flag as `isFeatureOn(features, 'seoAutoGsc', false)` (pass `def=false`) so an older API
  that serves no `features` object still treats them as OFF; `seoAuto` uses the normal
  `def=true`. A comment next to the new keys in both files documents the inverted
  convention.

---

## 8. New / edited web files

- **NEW `web/src/lib/seoAdmin.ts`** — typed client (mirrors `lib/admin.ts` style) for all
  `/admin/seo-auto/*` endpoints; React-Query hooks for dashboard + job polling.
- **NEW `web/src/pages/admin/AdminSeo.tsx`** — the dashboard (capability 13). Sections:
  counters (products optimized, needing attention, missing/duplicate metadata, categories
  optimized, valid/invalid canonicals, sitemap status, schema validation status, indexing
  problems, broken links [PHASE-2 → "not available yet"], Core Web Vitals [PHASE-2 →
  "connect GA4"], connected integrations, background-job status, recent automatic changes
  from `seo_audit_log`, organic performance [GSC — "not connected" when disconnected]).
  Buttons: **Optimize All Eligible Products**, **Optimize Selected Products**, **Run Full
  Audit**, **Rollback Last Changes** — each posts to the matching endpoint and polls the
  returned job. **Real data only** — every counter comes from the dashboard endpoint; no
  placeholder numbers; a metric with no real source renders an explicit "not available /
  not connected" state. Bilingual Hindi/English copy matching the existing admin.
- **EDITED `web/src/App.tsx`** — add `<Route path="seo" element={<AdminSeo />} />` inside
  the `/admin` shell.
- **EDITED `web/src/pages/admin/AdminApp.tsx`** — add an `ADMIN_TABS` entry
  `{ path: 'seo', key: 'settings', icon: '🔍', label: 'SEO', title: '🔍 SEO Engine' }`
  (gated by the `settings` permission, consistent with the existing SEO sub-tab).
- **EDITED `web/src/types.ts`** — add the new product/category SEO fields
  (`seo_slug`, `seo_score`, `seo_problems`, `seo_overrides`) and SEO dashboard types; add
  `defaultLang?: 'hi' | 'en'` to `SeoConfig`.
- **EDITED `web/src/pages/admin/AdminSettings.tsx` (SEO sub-tab)** — add a small
  `defaultLang` select (Hindi / English) to the existing SEO form so the operator can set
  the default description language; it posts through the existing `saveSeo()` to
  `POST /seo` (now that `seoSchema` + `mergeSeoConfig` carry `defaultLang`).
- **EDITED `web/src/lib/features.ts`** — new flag keys + bilingual labels.
- The existing Settings → 🔎 SEO sub-tab stays (manual overrides live there); the new page
  is the automation cockpit. The per-product panel's save now also sets override flags.

No change to `ProductDetails.tsx` / `Home.tsx` / `Page.tsx` rendering is required: they
already consume the effective `seo_*` columns via `<Seo>`, which now receive auto-filled
values. (Optional: `ProductDetails` can show the derived image `alt` — ADD-only.)

---

## 9. Error handling (concrete, per failing operation)

| Operation | Failure condition | Recoverable? | Caller receives | Logged |
| --- | --- | --- | --- | --- |
| `runProductSeo` on `POST /products` hook | generation/validation throws | yes (fire-and-forget) | product save still succeeds (200) | `console.error` + `seo_audit_log` `validation_fail` |
| Validation fatal gate | `CANONICAL_BAD` / `BLOCKED_PUBLIC` / `FABRICATION` | no (skip field) | field keeps previous value | `seo_audit_log` `validation_fail` with reason |
| Validation recoverable gate | dup/length/irrelevant | yes (1 retry → fallback) | safe metadata published | `seo_audit_log` `generate` with problem code |
| Batch job entity failure | DB error / unexpected throw | yes (2 retries) | job `failed++`, entity in job `log` | job `log` + `seo_audit_log` |
| Batch job fatal | queue/transaction error | partial | job `status='failed'`, `error` set | `console.error` + job `error` |
| Queue interrupted by restart | row left `running` | yes | marked `failed` with "Server restarted…" | `recoverSeoQueue()` log |
| Sitemap/robots build | DB read fails | yes | existing `.catch(()=>[])` → partial sitemap (unchanged behavior) | silent (as today) |
| Integration connect (no creds) | creds absent | n/a | `{ status:'disconnected', message }` | `seo_integrations.last_error` |
| GSC/GA4 fetch (PHASE-2) | API/network error | yes | dashboard shows "error" state, counters show "unavailable" | `seo_integrations.last_error` |
| Rollback | no backup for scope | n/a | `409 { message:'No backup to roll back' }` | audit `rollback` skipped |
| Rollback apply | restore write fails mid-way | partial, transactional | `500` truthful message (don't mask) | `console.error` + audit |

Principle (matches the existing `orders/status` route): never swallow a real DB error into
a misleading success; auto-hooks are fire-and-forget so SEO can never break a commerce
operation.

---

## 10. Input validation rules (per external input)

| Input | Required | Type / limits | On failure |
| --- | --- | --- | --- |
| `optimize.mode` | yes | enum `all|selected|category` | 422 |
| `optimize.productIds` | required if mode=selected | int[] ≤ 1000, each positive | 422 |
| `optimize.category` | required if mode=category | slug `^[a-z0-9-]{1,120}$`, must exist | 422 / 404 |
| `override.entityType` | yes | enum `product|category` | 422 |
| `override.id` | yes | positive int (product) / slug (category) | 422 |
| `override.field` | yes | enum of known SEO fields | 422 |
| `override.value` | yes | boolean | 422 |
| `integrations/:provider` | yes | enum `gsc|ga4|gbp` | 404 |
| `integrations.action` | yes | enum `connect|disconnect` | 422 |
| `integrations.accountRef` | optional | string ≤ 190, non-secret only | 422 |
| `rollback.jobId` | optional | positive int; must have a backup | 409 if none |
| Admin-supplied SEO override text (existing `/products`) | optional | reuse existing `productSchema` limits (title ≤255, desc ≤5000, keywords ≤500, ogImage ≤500) | 422 |
| Generated slug (internal) | — | `^[a-z0-9-]{1,200}$`, unique | suffix `-id` |

All server-side; the client never bypasses these. Rate limit: optimize/audit/rollback
capped (e.g. 10/min/user) via the new `utils/rateLimit.ts`.

---

## 11. Invariants and ownership

| Invariant | Owning layer | Why |
| --- | --- | --- |
| A human-overridden field is never regenerated | `persist.ts` (checks `seo_overrides`) | single write path for all generation |
| Published JSON-LD price/availability == DB | `localSeo.ts` builders (compute at request time) + `validate.ts` `AVAILABILITY_MISMATCH`/`PRICE_MISMATCH` gates | DB is the single source of truth; no stored stale copy. **Note:** this holds on the crawler path only *after* the §5.1/§6.3 correction to `buildProductJsonLd` (which currently hardcodes `InStock`); the fix is part of this revision, not a pre-existing guarantee |
| No fabricated facts/claims ever published | `validate.ts` `FABRICATION` gate | one enforcement point for the hard constraint |
| Exactly one canonical + one robots per page | web `<Seo>` + `routes/og.ts` (single builder array) | prevents duplicate/conflicting tags |
| Public pages never accidentally `noindex` | `generate.ts` indexing map + `BLOCKED_PUBLIC` gate | protects indexation |
| Only one batch job runs at a time | `seoQueue.ts` `running` guard | prevents conflicting/duplicate processing |
| Automation only runs when `seoAuto` is on (create/update hook, import audit enqueue, 15-min cron) | `persist.ts` (`runProductSeo`/`runCategorySeo` gate) + `seoAuditJob.ts` (`runAuditSweep` gate), both reading `mergeFeatures(config.features)` | master kill-switch disables all high-impact automation without a redeploy |
| Secrets never leave the server | `integrations.ts` (reads env/git-ignored config, returns only non-secret refs) | hard security constraint |
| Commerce paths unaffected | all hooks fire-and-forget; ADD-only columns | preserve checkout/UPI/login/tracking/app compat |

---

## 12. Testability

- **Unit (no DB):** `generate.ts` (title/desc/keywords/slug/alt from a `ProductLike`),
  `validate.ts` (each gate against crafted inputs incl. banned-claims regex),
  `completeness.ts` (score math), `dedupe.ts` (grouping on in-memory arrays),
  `utils/slug.ts`. These are pure functions — easy, high-value coverage. (No test runner
  is configured in `api-node` today; `npx tsc --noEmit` is the committed gate. The pure
  modules are structured so a future `vitest`/`jest` setup can test them without a DB; if
  a runner is added, these are the first targets.)
- **Integration (DB):** `persist.ts` override-skip behavior, `seoQueue.ts` enqueue/kick/
  recover, the hook on `POST /products`, rollback restore — exercised against a test DB.
- **Manual verification gates (this iteration):** `npx tsc --noEmit` in `api-node` and
  `npm run build` in `web` must pass; `seo-auto.sql` applied a **second** time makes **no
  schema change and raises no error** — guarded `ADD COLUMN`s are silently skipped by the
  `information_schema` COUNT guard (they print nothing on re-run), and tables use
  `CREATE TABLE IF NOT EXISTS` (only these emit an "already exists" notice). A crawler
  fetch of `/api/og/product/:id` and
  `/api/og/category/:slug` shows auto-filled meta + JSON-LD with DB-matching
  price/availability.

A design note on testability: because generation and validation are pure and persistence
is a thin override-aware writer, the risky logic (what gets written) is fully testable
without standing up the server — this is deliberate.

---

## 13. Rollback / backup mechanism

- Every bulk `optimize_*` and every policy-changing audit writes a `seo_backups` snapshot
  of the affected rows' `seo_*` columns **before** writing, linked via
  `seo_jobs.backup_id`.
- **Rollback Last Changes** (dashboard button → `POST /seo-auto/rollback`) restores the
  most recent backup for the scope inside a transaction, writing `rollback` audit rows and
  busting the SEO caches via `invalidateSeoCaches()` (both the `'sitemap'` and `'robots'`
  keys — finding 3). Overrides are preserved (rollback restores effective columns
  but does not flip `seo_overrides`).
- Because all columns are ADD-only and generation never deletes product/category rows, the
  worst case of a bad run is wrong *metadata*, fully reversible from the last snapshot — no
  commerce data is ever touched.

---

## 14. Hard-constraint compliance checklist

- Reuse `requireAuth` + `requireStaff('settings')` on every new **`/api/admin/seo-auto/*`**
  endpoint — **yes** (§7). The in-place override writes folded into the existing
  `POST /products` / `POST /categories` handlers inherit **those routes' existing
  `products` / `categories` permissions** (verified: `requireStaff('products')` /
  `requireStaff('categories')`), not `settings` — a `settings` check is deliberately NOT
  added there so product/category editors are not broken.
- Google/API creds server-side only (env/git-ignored), never in client bundle or git —
  **yes** (§4.3, §5.6).
- zod input validation, rate limits, audit logging for automatic changes — **yes**
  (§4.3 `seo_audit_log`, §7 rate limit, §10).
- Background jobs for large-catalog processing, idempotent, retry, race-safe during
  imports/price changes — **yes** (§5.3, §6.2, §6.9; `seo_source_hash` re-check before
  write).
- Preserve commerce (checkout/UPI/login/tracking/app compat), ADD-only, break nothing —
  **yes** (fire-and-forget hooks, ADD-only columns, no edits to order/payment paths).
- Feature-flag high-impact automation with backups + rollback — **yes** (`seoAuto` +
  PHASE-2 flags; §13).
- Reuse existing columns before adding new ones — **yes** (effective SEO stays in the
  existing `seo_*` columns; new columns only for metadata the old ones can't carry).
- No new queue dependency — **yes** (`node-cron` + DB-row queue mirroring `video/queue.ts`).
- INR currency; Hindi + English + transliterated variants — **yes** (§5.1, §6.5).
- Never invent prices/discounts/ratings/reviews/stock/cheapest/lowest — **yes**
  (`FABRICATION` gate, §5.2; offers suppressed until real fields exist, §6.3).

---

## 15. File-level change summary

**api-node (new):** `prisma/seo-auto.sql`, `src/seo/generate.ts`, `src/seo/validate.ts`,
`src/seo/persist.ts`, `src/seo/completeness.ts`, `src/seo/dedupe.ts`,
`src/seo/integrations.ts`, `src/services/seoQueue.ts`, `src/services/seoAuditJob.ts`,
`src/routes/seo-admin.ts`, `src/utils/slug.ts`, `src/utils/rateLimit.ts`.

**api-node (edited):** `prisma/schema.prisma` (Product/Category fields + 4 models),
`src/routes/admin.ts` (product/category hooks + override flags), `src/routes/og.ts`
(category share route), `src/routes/seo.ts` (`invalidateSeoCaches` — clears both the
`'sitemap'` and `'robots'` cache keys),
`src/services/dataImport.ts` (enqueue changed-only audit after import),
`src/utils/features.ts` (new flags, PHASE-2 keys default `false`), `src/server.ts` (mount
`seo-admin` router + call `startSeoAuditJob()` in the `app.listen` callback — recovery
runs inside that start fn, mirroring `videoScheduler`, NOT a direct `recoverSeoQueue` call
in `server.ts`), `src/seo/localSeo.ts` (`defaultLang` in `defaultSeoConfig`/`mergeSeoConfig`
+ category/alt helpers; **add `in_stock?: boolean | null` to `ProductLike` and derive
`buildProductJsonLd` `availability` from it instead of the hardcoded `InStock` — finding 1,
revision 3**).

**web (new):** `src/lib/seoAdmin.ts`, `src/pages/admin/AdminSeo.tsx`.

**web (edited):** `src/App.tsx` (route), `src/pages/admin/AdminApp.tsx` (nav tab),
`src/types.ts` (new fields + `defaultLang`), `src/lib/features.ts` (new flags + labels),
`src/pages/admin/AdminSettings.tsx` (per-product save sets override flag — ADD-only).

**Verification:** `npx tsc --noEmit` (api-node) + `npm run build` (web) must pass; apply
`seo-auto.sql` a second time to confirm it is a no-op (guarded `ADD COLUMN`s skipped with
no error/output; `CREATE TABLE IF NOT EXISTS` emits "already exists"); `npx prisma generate`
after schema edits. Do NOT start long-running servers.

---

## 16. Responses to design review (revision 4 — current)

Review: `api-node/.agents/tasks/seo-auto-engine/design-review.md` / `design-review.json` —
verdict `CHANGES_REQUESTED` (0 HIGH, 2 MEDIUM, 3 NIT) raised against revision 3. Every finding
was re-verified against the actual source in `.worktrees/seo-auto-engine/4astore-v2/api-node`
before being resolved. All 5 are **addressed** (none backlogged, none ignored); no finding
changed the chosen architecture — all five are localized corrections/clarifications. Each
change aligns with the original requirements (zero-manual-entry, ADD-only, reuse-first, never
fabricate, feature-flagged high-impact automation, server-side secrets).

| # | Sev | Disposition | Resolution |
| --- | --- | --- | --- |
| 1 | MED | Addressed | **Verified** `categorySchema.slug = z.string().trim().max(120)` and the stored slug is `slugify(c.slug || c.name)` in `routes/admin.ts` (so category slugs can be 81–120 chars), and the page route uses `.max(80)`. §6.6 now uses `^[a-z0-9-]{1,120}$` in **both** new category OG routes (`GET /api/og/category/:slug` and `GET /api/og/image/category/:slug`), matching `categorySchema max(120)`, and adds a sentence stating the category bound is 120 (not the page route's 80) and why (long-slug categories would otherwise 404). §10 `optimize.category` already uses `{1,120}`; the two now agree. |
| 2 | MED | Addressed | The declared `seoAuto` master kill-switch is now **wired**. §6.1 specifies a single gate at the top of `runProductSeo`/`runCategorySeo`/`runAuditSweep` that reads the merged server-side flags via `mergeFeatures(loadStoredFeatures())` over the `config.features` blob (the same source `POST /api/admin/features` writes) and **early-returns (no-op) when `seoAuto` is off**. §6.1.2 (import audit enqueue) and §6.9 (15-min cron sweep) now reference the gate, and §11 adds an invariant row. The kill-switch therefore disables the `POST /admin/products` create/update hook, the import audit enqueue, and the cron — leaving commerce untouched. |
| 3 | NIT | Addressed | **Verified** `routes/seo.ts` caches two keys (`'sitemap'` at the sitemap route, `'robots'` at the robots route) in one `Map`. §6.9 step 2 now specifies `invalidateSeoCaches()` which clears **both** keys (`cache.delete('sitemap'); cache.delete('robots');`); §13 and §15 reference the same function. Clearing only `'sitemap'` would have left `robots.txt` stale for up to 5 min after a policy change. |
| 4 | NIT | Addressed | **Verified** `routes/og.ts` resolves the JSON-LD `image` as `absoluteImageUrl(product.og_image || product.image) || <rendered card>`. §5.1 and §6.8 now state this resolution is **left unchanged** — the engine only adds `imageAlt` as metadata and never rewrites the builder's `image` argument, so crawler image output is preserved. |
| 5 | NIT | Addressed | §6.2 now states the queue idempotent-skip uses the **same `ATTENTION_THRESHOLD`** constant (§5.4) as the "needs attention" predicate: skip when `seo_score ≥ ATTENTION_THRESHOLD` **AND** no `seo_problems` **AND** unchanged `seo_source_hash`. The two surfaces can no longer disagree. |

All five were localized corrections to a slug bound, the kill-switch wiring, a cache-busting
helper, a JSON-LD call-site clarification, and a threshold reconciliation. The revision-3 and
revision-2 response tables are retained below for history.

---

## 16a. Responses to design review (revision 3 — history)

Review: `api-node/.agents/tasks/seo-auto-engine/design-review.md` /
`design-review.json` — verdict `CHANGES_REQUESTED` (1 HIGH, 1 MEDIUM, 2 NIT) raised against
revision 2. Every finding was re-verified against the actual source in
`.worktrees/seo-auto-engine/4astore-v2` before being resolved. All 4 are **addressed** (none
backlogged, none ignored); each change aligns with the original requirements
(zero-manual-entry, ADD-only, reuse-first, never fabricate, server-side secrets).

| # | Sev | Disposition | Resolution |
| --- | --- | --- | --- |
| 1 | HIGH | Addressed | **Verified** against source: `buildProductJsonLd` in `localSeo.ts` hardcodes `availability: 'https://schema.org/InStock'` for any priced product and its `ProductLike` has no `in_stock` field, so the crawler route `GET /api/og/product/:id` publishes out-of-stock products as `InStock`; only the web mirror derives availability from `in_stock`. The design no longer claims this as an existing guarantee. §5.1, §6.3, §11, §15 now specify the ADD-only **fix**: add `in_stock?: boolean | null` to `ProductLike` and derive `availability = in_stock === false ? OutOfStock : InStock` (default `InStock` only when the field is absent — parity with `web/src/lib/seo.ts`). §5.2 `AVAILABILITY_MISMATCH` re-specified to recompute the expected token from DB `in_stock` and assert the builder emitted it. |
| 2 | MED | Addressed | **Verified** `deriveProductSeo()` returns only `{ title, description, keywords }`, and `routes/og.ts` resolves `og_image` as `absoluteImageUrl(product.og_image) || .../og/image/product/:id` (override-or-render-card). §4.1 note corrected to list only the three derived fields; it now states `og_image` is **not** engine-generated — written only via the human override path, keeping its override-or-render-card semantics. §5.3 step 3 explicitly excludes `og_image` from the generated-field write loop; `imageAlt` + the on-demand card are named as the image-SEO outputs. |
| 3 | NIT | Addressed | §5.1 keywords now states the cap is **500 characters** (matching `seo_keywords VARCHAR(500)`; utf8mb4 counts characters), that de-dup runs **before** the cap so the most valuable tokens survive, and that truncation drops whole tokens on a **comma boundary — never mid-token**. |
| 4 | NIT | Addressed | §5.3 steps 5–6 now draw the boundary explicitly: the effective-column writes (step 3) + score/flags (step 4) run inside the awaited `prisma.$transaction`; the `seo_audit_log` rows (step 5) are written **after** the transaction commits, fire-and-forget, so a logging failure never rolls back or blocks the publish. |

No finding changed the chosen architecture; all four were localized corrections — a
genuine builder-availability fix plus three clarity/boundary statements. The revision-2
responses are retained below for history.

---

## 16b. Responses to design review (revision 2 — history)

Review: `design-review.json` for revision 2 — verdict `CHANGES_REQUESTED` (2 HIGH, 6 MEDIUM,
3 NIT). Every finding was re-verified against the actual source in
`.worktrees/seo-auto-engine/4astore-v2` before being resolved. All 11 are **addressed**
(none backlogged, none ignored); each change aligns with the original requirements
(zero-manual-entry, ADD-only, reuse-first, never fabricate, server-side secrets).

| # | Sev | Disposition | Resolution |
| --- | --- | --- | --- |
| 1 | HIGH | Addressed | **Verified** `mergeFeatures` seeds from `DEFAULT_FEATURES` and only flips a key on an explicit stored `false`; all current keys are `true`. Chose **option (a)**: add PHASE-2 keys to `DEFAULT_FEATURES` as `false` (so missing = OFF) and `seoAuto` as `true`; web call sites read PHASE-2 keys with `isFeatureOn(..., false)`. Documented the inverted convention in §3 and §7; §14 updated. `mergeFeatures`/`isFeatureOn` logic itself is unchanged. |
| 2 | HIGH | Addressed | **Verified** `POST /products` = `requireStaff('products')`, `POST /categories` = `requireStaff('categories')`, `POST /seo` = `requireStaff('settings')`. §5.3, §6.1/§7, §14 now state the in-place override writes inherit the commerce routes' `products`/`categories` permissions, and only `/api/admin/seo-auto/*` uses `settings`; explicitly warn against adding a `settings` check to the commerce routes. |
| 3 | MED | Addressed | **Verified** category select is `{ slug: true }`, `Category` has no timestamp, `urlEntry(loc, lastmod?)` omits `<lastmod>` on null. §6.6 now sources category `<lastmod>` from the new `categories.seo_generated_at`, changes the select to include it, and passes it to `urlEntry` (omit when null). |
| 4 | MED | Addressed | **Verified** `recoverQueue()` is the first line of `startVideoScheduler()`; `server.ts` does not call it. §6.2/§15 corrected: `recoverSeoQueue()` runs at the top of `startSeoAuditJob()`, which `server.ts` calls from its `app.listen` callback beside the other start fns. |
| 5 | MED | Addressed | **Verified** `seoSchema` and `mergeSeoConfig` have no `defaultLang`, and `POST /seo` drops unmerged keys. §6.5 now wires `defaultLang` through `defaultSeoConfig`, `mergeSeoConfig` (copies it, default `'hi'`), and `seoSchema` (`z.enum(['hi','en']).optional()`), plus a web SEO-form select (§8). It is a genuine editable override. |
| 6 | MED | Addressed | **Verified** the idempotence pattern is an information_schema COUNT guard (silent skip, no output) + `CREATE TABLE IF NOT EXISTS`. §12/§15 reworded the gate to "a second apply makes no schema change and raises no error"; "already exists" scoped to the table creates. |
| 7 | MED | Addressed | **Verified** og.ts uses paired HTML + image routes per entity and has no category route. §2/§6.6 now add both `GET /api/og/category/:slug` and `GET /api/og/image/category/:slug`, with the HTML's `og:image` pointing at the image route (reusing `getOrRenderOg`). |
| 8 | MED | Addressed | **Verified** `runImport` is the shared CLI+admin full-catalogue idempotent path. Chose **option (a)**: the import enqueues a changed-only `audit` job (not `optimize_all`), keyed on `seo_source_hash`; §6.1.2/§6.2/§6.9 make the import hook and the cron enqueue the *same* idempotent `audit` work, eliminating duplicate/overlapping runs. `optimize_all` is now dashboard-only. |
| 9 | NIT | Addressed | **Verified** `seo_title: p.seoTitle || null`. §7 products bullet now sets `seo_overrides[field]=true` only for a non-empty string value; empty/absent = reset-to-auto; notes reading `req.body.product` before coercion to detect an explicit clear. |
| 10 | NIT | Addressed | §5.4 now enumerates a `SCORE_WEIGHTS` table summing to 100 with per-check rationale, marks the weights and the `ATTENTION_THRESHOLD` (80) as tunable constants in `completeness.ts`, and states the single "needs attention" predicate. |
| 11 | NIT | Addressed | §6.7 now states no new `robots.txt` disallow lines are added; cart/checkout/account/track are SPA routes covered by per-page `noindex` meta, not robots. |

No finding changed the chosen architecture; all were localized corrections to flag
defaults, permission wording, the import trigger, and several existing-code references now
re-verified against source.
