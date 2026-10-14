-- ============================================================
-- 4AStore API — POS/inventory additive columns on `products`
-- ------------------------------------------------------------
-- Run ONCE on the live DB (EC2). ADDITIVE only — no destructive ops.
--
--   mysql -u <user> -p four_a_store < prisma/pos-inventory.sql
--
-- This is the MANUAL equivalent of ensureProductInventoryColumns()
-- (src/services/dataImport.ts), which the API runs automatically at startup.
-- Mirrors the repo's no-migrate convention: each ALTER is guarded by an
-- information_schema check so the script is safe to re-run. NO `prisma migrate`
-- / `db push` is used — the Prisma `Product` model carries these fields as a
-- read-only mirror of these raw-SQL columns.
--
-- One stock figure serves BOTH the online store and the in-store counter.
-- Every column is nullable or defaulted so existing rows + the online-order
-- flow are untouched. SKU/barcode uniqueness is enforced in the POS service
-- layer (SELECT-before-insert), NOT a DB unique index; only plain lookup
-- indexes are added here.
-- ============================================================

-- Columns ----------------------------------------------------
SET @t := 'products';

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'sku');
SET @sql := IF(@c = 0, 'ALTER TABLE products ADD COLUMN sku VARCHAR(64) NULL',
  'SELECT ''products.sku exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'barcode');
SET @sql := IF(@c = 0, 'ALTER TABLE products ADD COLUMN barcode VARCHAR(64) NULL',
  'SELECT ''products.barcode exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'purchase_price');
SET @sql := IF(@c = 0, 'ALTER TABLE products ADD COLUMN purchase_price DECIMAL(10,2) NULL',
  'SELECT ''products.purchase_price exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'stock');
SET @sql := IF(@c = 0, 'ALTER TABLE products ADD COLUMN stock DECIMAL(10,3) NOT NULL DEFAULT 0.000',
  'SELECT ''products.stock exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'unit');
SET @sql := IF(@c = 0, 'ALTER TABLE products ADD COLUMN unit VARCHAR(12) NOT NULL DEFAULT ''pcs''',
  'SELECT ''products.unit exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'tax_rate');
SET @sql := IF(@c = 0, 'ALTER TABLE products ADD COLUMN tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00',
  'SELECT ''products.tax_rate exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'low_stock_threshold');
SET @sql := IF(@c = 0, 'ALTER TABLE products ADD COLUMN low_stock_threshold DECIMAL(10,3) NULL',
  'SELECT ''products.low_stock_threshold exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'track_inventory');
SET @sql := IF(@c = 0, 'ALTER TABLE products ADD COLUMN track_inventory TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT ''products.track_inventory exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'allow_negative_stock');
SET @sql := IF(@c = 0, 'ALTER TABLE products ADD COLUMN allow_negative_stock TINYINT(1) NULL',
  'SELECT ''products.allow_negative_stock exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Lookup indexes (non-unique) -------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND INDEX_NAME = 'idx_products_sku');
SET @sql := IF(@c = 0, 'CREATE INDEX idx_products_sku ON products (sku)',
  'SELECT ''idx_products_sku exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND INDEX_NAME = 'idx_products_barcode');
SET @sql := IF(@c = 0, 'CREATE INDEX idx_products_barcode ON products (barcode)',
  'SELECT ''idx_products_barcode exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
