-- ============================================================
-- 4AStore API — new `settings` columns for charges + staff push toggle
-- ------------------------------------------------------------
-- Run ONCE on the live DB (EC2). ADD COLUMN only — no destructive ops.
--
--   mysql -u <user> -p four_a_store < prisma/charges-settings.sql
--
-- MariaDB 10.4 lacks `ADD COLUMN IF NOT EXISTS` reliably in all builds, so each
-- column is guarded via information_schema and added only when absent. Safe to
-- re-run (second run prints "already exists").
--
-- Columns added:
--   handling_charge            INT      default 0   -- extra handling/packaging fee
--   delivery_charge_enabled    TINYINT  default 1   -- master on/off for delivery fee
--   handling_charge_enabled    TINYINT  default 0   -- master on/off for handling fee
--   staff_order_alerts_enabled TINYINT  default 1   -- admin can mute the loud new-order push
-- ============================================================

-- helper pattern: add <col> to settings only if missing
-- 1) handling_charge
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings' AND COLUMN_NAME = 'handling_charge');
SET @sql := IF(@c = 0,
  'ALTER TABLE settings ADD COLUMN handling_charge INT NOT NULL DEFAULT 0',
  'SELECT ''handling_charge already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) delivery_charge_enabled
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings' AND COLUMN_NAME = 'delivery_charge_enabled');
SET @sql := IF(@c = 0,
  'ALTER TABLE settings ADD COLUMN delivery_charge_enabled TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT ''delivery_charge_enabled already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) handling_charge_enabled
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings' AND COLUMN_NAME = 'handling_charge_enabled');
SET @sql := IF(@c = 0,
  'ALTER TABLE settings ADD COLUMN handling_charge_enabled TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT ''handling_charge_enabled already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) staff_order_alerts_enabled
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings' AND COLUMN_NAME = 'staff_order_alerts_enabled');
SET @sql := IF(@c = 0,
  'ALTER TABLE settings ADD COLUMN staff_order_alerts_enabled TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT ''staff_order_alerts_enabled already exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
