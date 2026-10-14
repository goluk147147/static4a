-- ============================================================
-- 4AStore API — POS-wide toggle columns on `settings`
-- ------------------------------------------------------------
-- Run ONCE on the live DB (EC2). ADDITIVE only — no destructive ops.
--
--   mysql -u <user> -p four_a_store < prisma/pos-settings.sql
--
-- This is the MANUAL equivalent of ensurePosSettingsColumns()
-- (src/services/dataImport.ts), which the API runs automatically at startup.
-- `settings` is a raw-SQL table (not a Prisma model). Each ALTER is guarded by
-- an information_schema check so the script is safe to re-run. NO `prisma
-- migrate` / `db push`.
--
-- Also seeds settings.store_address with the romanized live store address when
-- it is blank — the owner may edit it to any string (the Unicode-capable POS
-- invoice renders whatever is stored). store_address already exists on the
-- table; only its value is seeded here, never the column.
-- ============================================================

SET @t := 'settings';

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'pos_allow_negative_stock');
SET @sql := IF(@c = 0, 'ALTER TABLE settings ADD COLUMN pos_allow_negative_stock TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT ''settings.pos_allow_negative_stock exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'pos_sale_notifications');
SET @sql := IF(@c = 0, 'ALTER TABLE settings ADD COLUMN pos_sale_notifications TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT ''settings.pos_sale_notifications exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'pos_bill_prefix');
SET @sql := IF(@c = 0, 'ALTER TABLE settings ADD COLUMN pos_bill_prefix VARCHAR(8) NOT NULL DEFAULT ''INV-''',
  'SELECT ''settings.pos_bill_prefix exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'pos_next_bill_seq');
SET @sql := IF(@c = 0, 'ALTER TABLE settings ADD COLUMN pos_next_bill_seq BIGINT UNSIGNED NOT NULL DEFAULT 1',
  'SELECT ''settings.pos_next_bill_seq exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'pos_allow_manual_items');
SET @sql := IF(@c = 0, 'ALTER TABLE settings ADD COLUMN pos_allow_manual_items TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT ''settings.pos_allow_manual_items exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Seed the invoice store_address default only when blank (never overwrite).
UPDATE settings
   SET store_address = 'Gajna Road, Chandargarh, Nabinagar, Aurangabad, Bihar - 824301'
 WHERE id = 1 AND (store_address IS NULL OR store_address = '');
