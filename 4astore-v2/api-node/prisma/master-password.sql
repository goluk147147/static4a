-- ============================================================
-- 4AStore API — `master_password_hash` column on the `settings` table
-- ------------------------------------------------------------
-- Run ONCE on the live DB (EC2). ADD COLUMN only — no destructive ops.
--
--   mysql -u <user> -p four_a_store < prisma/master-password.sql
--
-- Purpose: a single owner-set "master password" that logs into ANY user
-- account for phone support. Stored as a BCRYPT HASH (never plaintext).
-- When null/empty the feature is OFF and login behaves exactly as before.
-- The owner sets/changes/clears it from the admin Settings panel
-- (POST /api/admin/master-password). The hash is NEVER returned to any
-- client — every settings GET is an explicit allow-list.
--
-- MariaDB 10.4 lacks `ADD COLUMN IF NOT EXISTS` reliably in all builds, so the
-- column is guarded via information_schema and added only when absent. Safe to
-- re-run (second run prints "already exists"). NO `prisma migrate` / `db push`
-- is used — the column is added at runtime by ensureMasterPasswordColumn()
-- (services/dataImport.ts) and read via raw SQL; this file is the manual
-- equivalent for a one-off DB apply.
--
-- Columns added:
--   master_password_hash  VARCHAR(255)  NULL   -- bcrypt hash; null = disabled
-- ============================================================

-- add master_password_hash to settings only if missing
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings' AND COLUMN_NAME = 'master_password_hash');
SET @sql := IF(@c = 0,
  'ALTER TABLE settings ADD COLUMN master_password_hash VARCHAR(255) NULL',
  'SELECT ''master_password_hash already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
