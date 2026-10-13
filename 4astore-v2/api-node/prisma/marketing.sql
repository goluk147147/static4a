-- ============================================================
-- 4AStore API — Marketing Center tables + users.marketing_opt_out column
-- ------------------------------------------------------------
-- Run ONCE on the live DB (EC2). ADDITIVE only — no destructive ops.
--
--   mysql -u <user> -p four_a_store < prisma/marketing.sql
--
-- This is the MANUAL equivalent of ensureMarketingTables()
-- (src/services/dataImport.ts), which the API runs automatically at startup.
-- Mirrors the repo's no-migrate convention (see prisma/catalog-version.sql):
-- `CREATE TABLE IF NOT EXISTS` + an information_schema-guarded `ALTER` so the
-- script is safe to re-run. NO `prisma migrate` / `db push` is used — the
-- Prisma schema (MarketingFestival / MarketingTemplate / MarketingCampaign and
-- User.marketing_opt_out) is a read-only mirror of these raw-SQL tables.
--
-- Festival rows are seeded by the application (ensureMarketingTables) with
-- festival_date = NULL and needs_date_check = 1 so NO wrong (lunar) date is ever
-- hardcoded; this file creates the schema only.
--
-- Tables added:
--   marketing_festivals   -- festival calendar (dates filled later, never guessed)
--   marketing_templates   -- bilingual Hindi/English message templates
--   marketing_campaigns   -- saved broadcast campaigns + manual share counters
-- Column added:
--   users.marketing_opt_out  TINYINT(1) default 0  -- exclude from broadcasts
-- ============================================================

CREATE TABLE IF NOT EXISTS marketing_festivals (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name             VARCHAR(120) NOT NULL,
  slug             VARCHAR(120) NOT NULL,
  festival_date    DATE         NULL,
  greeting_hi      VARCHAR(255) NULL,
  emoji            VARCHAR(16)  NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  needs_date_check TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order       INT          NOT NULL DEFAULT 0,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_marketing_festivals_slug (slug),
  INDEX idx_marketing_festivals_date (festival_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS marketing_templates (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title         VARCHAR(160) NOT NULL,
  category      VARCHAR(60)  NOT NULL DEFAULT 'general',
  festival_slug VARCHAR(120) NULL,
  lang          VARCHAR(12)  NOT NULL DEFAULT 'hinglish',
  body          TEXT         NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order    INT          NOT NULL DEFAULT 0,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_marketing_templates_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name               VARCHAR(160) NOT NULL,
  category           VARCHAR(60)  NULL,
  product_ids        JSON         NULL,
  template_id        BIGINT UNSIGNED NULL,
  customer_mobiles   JSON         NULL,
  message            TEXT         NULL,
  status             VARCHAR(24)  NOT NULL DEFAULT 'draft',
  notes              VARCHAR(500) NULL,
  share_opened       INT          NOT NULL DEFAULT 0,
  copied_count       INT          NOT NULL DEFAULT 0,
  banners_downloaded INT          NOT NULL DEFAULT 0,
  batches_prepared   INT          NOT NULL DEFAULT 0,
  created_by         VARCHAR(64)  NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_marketing_campaigns_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- add users.marketing_opt_out only if missing (MariaDB-safe guard)
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'marketing_opt_out');
SET @sql := IF(@c = 0,
  'ALTER TABLE users ADD COLUMN marketing_opt_out TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT ''marketing_opt_out already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
