-- ============================================================
-- 4AStore API — `short_links` table (universal smart short-links)
-- ------------------------------------------------------------
-- Run ONCE on the live DB (EC2). CREATE TABLE IF NOT EXISTS only — no
-- destructive ops. Safe to re-run.
--
--   mysql -u <user> -p four_a_store < prisma/short-links.sql
--
-- Purpose: backs the universal short-link subsystem — one short code per
-- product (auto-created on single + bulk product create) plus admin-created
-- custom links for any URL. GET /api/link/:code resolves the code, serves the
-- shared OG HTML to crawlers (from the ONE source of truth, services/ogShare.ts)
-- and a smart-redirect page to humans (app deep-link + Play Store fallback on
-- Android, website otherwise). The /link reverse-proxy rule in
-- deploy/4astore-og.conf forwards 4astore.com/link/<code> to this endpoint.
--
-- This table is ALSO created at runtime by ensureShortLinkTables()
-- (services/dataImport.ts) following the repo's no-migrate convention. This
-- file is the manual equivalent (mirrors prisma/catalog-version.sql style).
-- The Prisma `ShortLink` model mirrors these columns. NO `prisma migrate` /
-- `db push` is used.
--
-- Columns:
--   id          BIGINT UNSIGNED  PK, auto-increment
--   code        VARCHAR(16)      UNIQUE short code (base62, 6–8 chars)
--   target_url  VARCHAR(1000)    where the link points (SPA path or full URL)
--   type        VARCHAR(16)      'product' | 'custom' | …
--   product_id  BIGINT UNSIGNED  NULL for non-product links
--   created_by  VARCHAR(64)      admin username for custom links, NULL otherwise
--   clicks      INT              hit counter, default 0
--   created_at  DATETIME(3)      default CURRENT_TIMESTAMP(3)
-- ============================================================

CREATE TABLE IF NOT EXISTS short_links (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(16)   NOT NULL,
  target_url VARCHAR(1000) NOT NULL,
  type       VARCHAR(16)   NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  created_by VARCHAR(64)   NULL,
  clicks     INT           NOT NULL DEFAULT 0,
  created_at DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_short_links_code (code),
  INDEX idx_short_links_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
