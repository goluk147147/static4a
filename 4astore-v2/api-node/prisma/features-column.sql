-- ============================================================
-- 4AStore API — add `features` JSON column to the `config` table
-- Run ONCE on the live DB (EC2). ADD COLUMN only — no destructive ops.
--   mysql -u <user> -p four_a_store < prisma/features-column.sql
-- MariaDB 10.4 lacks reliable ADD COLUMN IF NOT EXISTS, so the add is
-- guarded via information_schema and runs only when absent. Safe to re-run.
-- Column added:
--   features  LONGTEXT  (JSON object of boolean feature flags; NULL = all ON by default)
-- ============================================================
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'config' AND COLUMN_NAME = 'features');
SET @sql := IF(@c = 0,
  'ALTER TABLE config ADD COLUMN features LONGTEXT NULL',
  'SELECT ''features already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
