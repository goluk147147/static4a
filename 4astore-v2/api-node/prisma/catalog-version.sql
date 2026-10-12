-- ============================================================
-- 4AStore API — `catalog_version` counter on the `app_version` table
-- ------------------------------------------------------------
-- Run ONCE on the live DB (EC2). ADD COLUMN only — no destructive ops.
--
--   mysql -u <user> -p four_a_store < prisma/catalog-version.sql
--
-- Purpose: a monotonically-increasing counter bumped by the admin product AND
-- category mutation handlers (add/update/delete) after each DB write. GET
-- /products and GET /categories surface it as an ETag + `no-cache,
-- must-revalidate`, so a storefront client always revalidates but gets a cheap
-- 304 until an edit changes the version, at which point the next request returns
-- fresh data immediately.
--
-- MariaDB 10.4 lacks `ADD COLUMN IF NOT EXISTS` reliably in all builds, so the
-- column is guarded via information_schema and added only when absent. Safe to
-- re-run (second run prints "already exists"). NO `prisma migrate` / `db push`
-- is used — the Prisma schema is unchanged; the column is read via raw SQL and
-- the app code falls back to version `1` when the column is absent.
--
-- Columns added:
--   catalog_version  INT  default 1   -- bumped on every product/category write
-- ============================================================

-- add catalog_version to app_version only if missing
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_version' AND COLUMN_NAME = 'catalog_version');
SET @sql := IF(@c = 0,
  'ALTER TABLE app_version ADD COLUMN catalog_version INT NOT NULL DEFAULT 1',
  'SELECT ''catalog_version already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
