-- ============================================================
-- 4AStore API — new SEO columns for products, pages + a global config.seo blob
-- ------------------------------------------------------------
-- Run ONCE on the live DB (EC2). ADD COLUMN only — no destructive ops.
--
--   mysql -u <user> -p four_a_store < prisma/seo.sql
--
-- MariaDB 10.4 lacks `ADD COLUMN IF NOT EXISTS` reliably in all builds, so each
-- column is guarded via information_schema and added only when absent. Safe to
-- re-run (second run prints "already exists").
--
-- Columns added:
--   products.seo_title       VARCHAR(255) NULL  -- custom <title>/og:title override
--   products.seo_description TEXT         NULL  -- custom meta description override
--   products.seo_keywords    VARCHAR(500) NULL  -- comma-separated meta keywords
--   products.og_image        VARCHAR(500) NULL  -- custom share image URL/path
--   pages.meta_keywords      VARCHAR(500) NULL  -- comma-separated meta keywords
--   config.seo               LONGTEXT     NULL  -- global SEO config JSON (SeoConfig)
-- ============================================================

-- 1) products.seo_title
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'seo_title');
SET @sql := IF(@c = 0,
  'ALTER TABLE products ADD COLUMN seo_title VARCHAR(255) NULL',
  'SELECT ''seo_title already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) products.seo_description
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'seo_description');
SET @sql := IF(@c = 0,
  'ALTER TABLE products ADD COLUMN seo_description TEXT NULL',
  'SELECT ''seo_description already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) products.seo_keywords
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'seo_keywords');
SET @sql := IF(@c = 0,
  'ALTER TABLE products ADD COLUMN seo_keywords VARCHAR(500) NULL',
  'SELECT ''seo_keywords already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) products.og_image
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'og_image');
SET @sql := IF(@c = 0,
  'ALTER TABLE products ADD COLUMN og_image VARCHAR(500) NULL',
  'SELECT ''og_image already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5) pages.meta_keywords
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pages' AND COLUMN_NAME = 'meta_keywords');
SET @sql := IF(@c = 0,
  'ALTER TABLE pages ADD COLUMN meta_keywords VARCHAR(500) NULL',
  'SELECT ''meta_keywords already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 6) config.seo
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'config' AND COLUMN_NAME = 'seo');
SET @sql := IF(@c = 0,
  'ALTER TABLE config ADD COLUMN seo LONGTEXT NULL',
  'SELECT ''seo already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
