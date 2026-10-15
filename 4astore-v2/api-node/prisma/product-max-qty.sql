-- ============================================================
-- 4AStore API — per-product `max_qty_per_order` column on `products`
-- ------------------------------------------------------------
-- Run ONCE on the live DB (EC2). ADDITIVE only — no destructive ops.
--
--   mysql -u <user> -p four_a_store < prisma/product-max-qty.sql
--
-- This is the MANUAL equivalent of ensureProductMaxQtyColumn()
-- (src/services/dataImport.ts), which the API runs automatically at startup.
-- Mirrors the repo's no-migrate convention: the ALTER is guarded by an
-- information_schema check so the script is safe to re-run. NO `prisma migrate`
-- / `db push` is used — the Prisma `Product` model carries this field as a
-- read-only mirror of this raw-SQL column.
--
-- Per-order purchase cap (Zepto/Blinkit style). DECIMAL(10,3) so weight
-- products (1kg / 0.5kg) AND piece caps (3 pcs) both work; NULL = no limit
-- (unlimited — today's behavior, so existing rows are untouched). UNLIKE the
-- owner-only POS cost/inventory columns, this ONE inventory field IS public
-- (returned by PUBLIC_PRODUCT_SELECT) so the storefront can show "Max N".
-- ============================================================

SET @t := 'products';

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'max_qty_per_order');
SET @sql := IF(@c = 0, 'ALTER TABLE products ADD COLUMN max_qty_per_order DECIMAL(10,3) NULL',
  'SELECT ''products.max_qty_per_order exists'' AS note');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
