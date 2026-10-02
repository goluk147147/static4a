-- ============================================================
-- 4AStore API — performance indexes for the LIVE MySQL/MariaDB
-- ------------------------------------------------------------
-- Run this ONCE on the live database (EC2). It only ADDS indexes;
-- it performs NO destructive operations (CREATE INDEX / SELECT only).
--
-- Apply with, e.g.:
--   mysql -u <user> -p four_a_store < prisma/perf-indexes.sql
--
-- MariaDB 10.4 / older MySQL do NOT support `CREATE INDEX IF NOT EXISTS`,
-- so each index is guarded via information_schema: it is created only when
-- absent. That makes the whole script safe to re-run. The index names are
-- unique and chosen NOT to collide with the already-present idx_orders_*
-- (idx_orders_status, idx_orders_rider) created by db/schema.sql.
--
-- NOTE: if you prefer, you can delete the guard blocks and run the bare
-- `CREATE INDEX ...` lines directly — but re-running a bare CREATE INDEX on an
-- existing index WILL error. The guarded form below avoids that.
-- ============================================================

-- ---- orders.user_id : fast "my orders" lookup by owner FK ----
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_user'
);
SET @sql := IF(@idx = 0,
  'CREATE INDEX idx_orders_user ON orders (user_id)',
  'SELECT ''idx_orders_user already exists'' AS note');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---- orders.order_date : date-range / recent-orders queries ----
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_date'
);
SET @sql := IF(@idx = 0,
  'CREATE INDEX idx_orders_date ON orders (order_date)',
  'SELECT ''idx_orders_date already exists'' AS note');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================
-- The following indexes are ALREADY created by db/schema.sql on a fresh
-- install and are therefore NOT re-added here:
--   idx_orders_status (orders.order_status)
--   idx_orders_rider  (orders.rider_id)
--   idx_products_category (products.category)
--   idx_products_instock  (products.in_stock)
--   idx_users_role (users.role)
--   idx_addresses_user (addresses.user_id)
--   idx_device_user (device_tokens.user_id)
--   idx_otp_email (email_otps.email)
-- If a live DB predates db/schema.sql and is missing any of these, copy a
-- guard block above and swap in the table/column/index name.
-- ============================================================
