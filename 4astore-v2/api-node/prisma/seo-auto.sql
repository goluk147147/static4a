-- ============================================================
-- 4AStore API — automatic SEO engine: ADD-only columns + new tables
-- ------------------------------------------------------------
-- Run ONCE on the live DB (EC2). ADD COLUMN / CREATE TABLE IF NOT EXISTS only —
-- no destructive ops. Safe to re-run (guarded ADD COLUMN silently skipped,
-- CREATE TABLE IF NOT EXISTS prints "already exists").
--
--   mysql -u <user> -p four_a_store < prisma/seo-auto.sql
--
-- MariaDB 10.4 lacks reliable `ADD COLUMN IF NOT EXISTS`, so each column is
-- guarded via information_schema and added only when absent — same pattern as
-- prisma/seo.sql.
-- ============================================================

-- ------------------------------------------------------------
-- products: auto-SEO metadata columns
-- ------------------------------------------------------------

-- products.seo_slug
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'seo_slug');
SET @sql := IF(@c = 0,
  'ALTER TABLE products ADD COLUMN seo_slug VARCHAR(200) NULL',
  'SELECT ''seo_slug already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- products.seo_overrides
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'seo_overrides');
SET @sql := IF(@c = 0,
  'ALTER TABLE products ADD COLUMN seo_overrides JSON NULL',
  'SELECT ''seo_overrides already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- products.seo_auto_json
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'seo_auto_json');
SET @sql := IF(@c = 0,
  'ALTER TABLE products ADD COLUMN seo_auto_json JSON NULL',
  'SELECT ''seo_auto_json already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- products.seo_score
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'seo_score');
SET @sql := IF(@c = 0,
  'ALTER TABLE products ADD COLUMN seo_score TINYINT UNSIGNED NULL',
  'SELECT ''seo_score already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- products.seo_problems
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'seo_problems');
SET @sql := IF(@c = 0,
  'ALTER TABLE products ADD COLUMN seo_problems JSON NULL',
  'SELECT ''seo_problems already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- products.seo_generated_at
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'seo_generated_at');
SET @sql := IF(@c = 0,
  'ALTER TABLE products ADD COLUMN seo_generated_at DATETIME(3) NULL',
  'SELECT ''seo_generated_at already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- products.seo_source_hash
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'seo_source_hash');
SET @sql := IF(@c = 0,
  'ALTER TABLE products ADD COLUMN seo_source_hash CHAR(40) NULL',
  'SELECT ''seo_source_hash already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- categories: SEO columns (categories have none today)
-- ------------------------------------------------------------

-- categories.seo_title
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'seo_title');
SET @sql := IF(@c = 0,
  'ALTER TABLE categories ADD COLUMN seo_title VARCHAR(255) NULL',
  'SELECT ''seo_title already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- categories.seo_description
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'seo_description');
SET @sql := IF(@c = 0,
  'ALTER TABLE categories ADD COLUMN seo_description TEXT NULL',
  'SELECT ''seo_description already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- categories.seo_keywords
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'seo_keywords');
SET @sql := IF(@c = 0,
  'ALTER TABLE categories ADD COLUMN seo_keywords VARCHAR(500) NULL',
  'SELECT ''seo_keywords already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- categories.seo_intro
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'seo_intro');
SET @sql := IF(@c = 0,
  'ALTER TABLE categories ADD COLUMN seo_intro TEXT NULL',
  'SELECT ''seo_intro already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- categories.og_image
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'og_image');
SET @sql := IF(@c = 0,
  'ALTER TABLE categories ADD COLUMN og_image VARCHAR(500) NULL',
  'SELECT ''og_image already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- categories.seo_overrides
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'seo_overrides');
SET @sql := IF(@c = 0,
  'ALTER TABLE categories ADD COLUMN seo_overrides JSON NULL',
  'SELECT ''seo_overrides already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- categories.seo_auto_json
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'seo_auto_json');
SET @sql := IF(@c = 0,
  'ALTER TABLE categories ADD COLUMN seo_auto_json JSON NULL',
  'SELECT ''seo_auto_json already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- categories.seo_score
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'seo_score');
SET @sql := IF(@c = 0,
  'ALTER TABLE categories ADD COLUMN seo_score TINYINT UNSIGNED NULL',
  'SELECT ''seo_score already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- categories.seo_problems
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'seo_problems');
SET @sql := IF(@c = 0,
  'ALTER TABLE categories ADD COLUMN seo_problems JSON NULL',
  'SELECT ''seo_problems already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- categories.seo_generated_at
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'seo_generated_at');
SET @sql := IF(@c = 0,
  'ALTER TABLE categories ADD COLUMN seo_generated_at DATETIME(3) NULL',
  'SELECT ''seo_generated_at already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- categories.seo_source_hash
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'seo_source_hash');
SET @sql := IF(@c = 0,
  'ALTER TABLE categories ADD COLUMN seo_source_hash CHAR(40) NULL',
  'SELECT ''seo_source_hash already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- New tables (InnoDB utf8mb4), CREATE TABLE IF NOT EXISTS
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS seo_jobs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type         VARCHAR(32)      NOT NULL,
  status       VARCHAR(16)      NOT NULL,
  scope        JSON             NULL,
  total        INT              NOT NULL DEFAULT 0,
  processed    INT              NOT NULL DEFAULT 0,
  updated      INT              NOT NULL DEFAULT 0,
  skipped      INT              NOT NULL DEFAULT 0,
  failed       INT              NOT NULL DEFAULT 0,
  progress     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  backup_id    BIGINT UNSIGNED  NULL,
  log          JSON             NULL,
  error        TEXT             NULL,
  created_by   VARCHAR(64)      NULL,
  created_at   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at   DATETIME(3)      NULL,
  finished_at  DATETIME(3)      NULL,
  PRIMARY KEY (id),
  INDEX idx_seo_jobs_status (status),
  INDEX idx_seo_jobs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seo_audit_log (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type  VARCHAR(16)      NOT NULL,
  entity_id    VARCHAR(64)      NOT NULL,
  action       VARCHAR(32)      NOT NULL,
  field        VARCHAR(32)      NULL,
  before_val   TEXT             NULL,
  after_val    TEXT             NULL,
  reason       VARCHAR(255)     NULL,
  job_id       BIGINT UNSIGNED  NULL,
  actor        VARCHAR(64)      NULL,
  created_at   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_seo_audit_entity (entity_type, entity_id),
  INDEX idx_seo_audit_job (job_id),
  INDEX idx_seo_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seo_backups (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id       BIGINT UNSIGNED  NULL,
  entity_type  VARCHAR(16)      NOT NULL,
  scope        JSON             NULL,
  snapshot     LONGTEXT         NOT NULL,
  created_by   VARCHAR(64)      NULL,
  created_at   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_seo_backups_job (job_id),
  INDEX idx_seo_backups_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seo_integrations (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider     VARCHAR(16)      NOT NULL,
  status       VARCHAR(16)      NOT NULL DEFAULT 'disconnected',
  account_ref  VARCHAR(190)     NULL,
  last_sync_at DATETIME(3)      NULL,
  last_error   VARCHAR(255)     NULL,
  updated_at   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_seo_integrations_provider (provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
