-- ============================================================
-- 4AStore API — POS billing + inventory tables
-- ------------------------------------------------------------
-- Run ONCE on the live DB (EC2). ADDITIVE only — no destructive ops.
--
--   mysql -u <user> -p four_a_store < prisma/pos-tables.sql
--
-- This is the MANUAL equivalent of ensurePosTables()
-- (src/services/dataImport.ts), which the API runs automatically at startup.
-- `CREATE TABLE IF NOT EXISTS` so the script is safe to re-run. NO `prisma
-- migrate` / `db push` — the Prisma PosBill / PosBillItem / StockMovement /
-- AdminPhone / PosImportBatch / ProductChangeLog models are a read-only mirror.
--
-- Money aggregates are DECIMAL(12,2); line/product money is DECIMAL(10,2);
-- quantity is DECIMAL(10,3). bill_no and idempotency_key are UNIQUE NULL
-- (MySQL permits multiple NULLs) so held bills and non-idempotent rows coexist.
--
-- Tables added:
--   pos_bills           -- counter bills (held/completed/cancelled/refunded)
--   pos_bill_items      -- line items (snapshots; FK → pos_bills ON DELETE CASCADE)
--   stock_movements     -- append-only stock audit trail
--   admin_phones        -- phone allowlist for POS/admin OTP login
--   pos_import_batches  -- Excel import history + row-wise errors
--   product_change_log  -- price/stock change log
-- ============================================================

CREATE TABLE IF NOT EXISTS pos_bills (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bill_no         VARCHAR(20)  NULL,
  idempotency_key CHAR(36)     NULL,
  status          VARCHAR(16)  NOT NULL,
  customer_name   VARCHAR(120) NULL,
  customer_mobile VARCHAR(15)  NULL,
  subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_total       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  grand_total     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  amount_paid     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  balance_due     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  payment_method  VARCHAR(20)  NULL,
  payment_status  VARCHAR(12)  NULL,
  payments_json   JSON         NULL,
  note            VARCHAR(500) NULL,
  created_by      VARCHAR(64)  NULL,
  cancelled_by    VARCHAR(64)  NULL,
  cancel_reason   VARCHAR(255) NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pos_bills_bill_no (bill_no),
  UNIQUE KEY uq_pos_bills_idem (idempotency_key),
  INDEX idx_pos_bills_created (created_at),
  INDEX idx_pos_bills_status (status),
  INDEX idx_pos_bills_mobile (customer_mobile)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pos_bill_items (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bill_id    BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  name       VARCHAR(200) NOT NULL,
  sku        VARCHAR(64)  NULL,
  unit       VARCHAR(12)  NOT NULL DEFAULT 'pcs',
  quantity   DECIMAL(10,3) NOT NULL DEFAULT 0.000,
  rate       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  tax_rate   DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  line_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  is_manual  TINYINT(1)    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_pos_bill_items_bill (bill_id),
  INDEX idx_pos_bill_items_product (product_id),
  CONSTRAINT fk_pos_bill_items_bill FOREIGN KEY (bill_id)
    REFERENCES pos_bills (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id    BIGINT UNSIGNED NOT NULL,
  change_qty    DECIMAL(10,3) NOT NULL,
  balance_after DECIMAL(10,3) NOT NULL,
  reason        VARCHAR(24)  NOT NULL,
  bill_no       VARCHAR(20)  NULL,
  batch_id      BIGINT UNSIGNED NULL,
  note          VARCHAR(255) NULL,
  created_by    VARCHAR(64)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_stock_mov_product (product_id),
  INDEX idx_stock_mov_bill (bill_no),
  INDEX idx_stock_mov_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_phones (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  mobile      VARCHAR(15)  NOT NULL,
  role        VARCHAR(16)  NOT NULL,
  permissions JSON         NULL,
  name        VARCHAR(120) NULL,
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  added_by    VARCHAR(64)  NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_phones_mobile (mobile)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pos_import_batches (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  filename   VARCHAR(255) NOT NULL,
  status     VARCHAR(16)  NOT NULL,
  total_rows INT          NOT NULL DEFAULT 0,
  inserted   INT          NOT NULL DEFAULT 0,
  updated    INT          NOT NULL DEFAULT 0,
  skipped    INT          NOT NULL DEFAULT 0,
  errors     INT          NOT NULL DEFAULT 0,
  error_json JSON         NULL,
  created_by VARCHAR(64)  NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_pos_import_batches_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_change_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NULL,
  field      VARCHAR(32)  NOT NULL,
  old_val    VARCHAR(255) NULL,
  new_val    VARCHAR(255) NULL,
  source     VARCHAR(24)  NOT NULL,
  batch_id   BIGINT UNSIGNED NULL,
  actor      VARCHAR(64)  NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_pcl_product (product_id),
  INDEX idx_pcl_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
