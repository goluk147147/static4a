-- ============================================================
-- 4AStore v2 — MySQL schema (shared by Node API + Laravel admin)
-- Charset utf8mb4 for Hindi (Devanagari) support.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------- users (customers, riders, admins live here) ----------
CREATE TABLE IF NOT EXISTS users (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name                  VARCHAR(120)    NOT NULL,
  mobile                VARCHAR(15)     NOT NULL,
  username              VARCHAR(64)     NOT NULL,
  email                 VARCHAR(190)    NULL,
  recovery_email        VARCHAR(190)    NULL,
  recovery_email_verified TINYINT(1)    NOT NULL DEFAULT 0,
  password              VARCHAR(255)    NOT NULL,               -- bcrypt/argon2 hash
  role                  ENUM('owner','superadmin','admin','rider','customer') NOT NULL DEFAULT 'customer',
  permissions           JSON            NULL,                   -- for admins: ["orders","products",...] or ["*"]
  backend_rider         TINYINT(1)      NOT NULL DEFAULT 0,     -- true = admin-created rider
  custom_delivery       INT             NULL,                   -- per-user fixed delivery fee (overrides global)
  registered_at         DATETIME        NULL,
  last_login            DATETIME        NULL,
  created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_mobile (mobile),
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- refresh_tokens (long-lived JWT / life-long login) ----------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  token_hash   CHAR(64)        NOT NULL,          -- sha256 of the refresh token
  device_label VARCHAR(120)    NULL,
  expires_at   DATETIME        NOT NULL,          -- ~1 year out
  revoked      TINYINT(1)      NOT NULL DEFAULT 0,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_hash (token_hash),
  KEY idx_refresh_user (user_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- email_otps (signup / recovery verification) ----------
CREATE TABLE IF NOT EXISTS email_otps (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email      VARCHAR(190)    NOT NULL,
  otp        VARCHAR(10)     NOT NULL,
  purpose    ENUM('signup','recovery') NOT NULL DEFAULT 'signup',
  expires_at DATETIME        NOT NULL,
  consumed   TINYINT(1)      NOT NULL DEFAULT 0,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_otp_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- categories ----------
CREATE TABLE IF NOT EXISTS categories (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(120)    NOT NULL,
  slug           VARCHAR(120)    NOT NULL,
  icon           VARCHAR(16)     NULL,             -- emoji
  image          VARCHAR(500)    NULL,
  hidden         TINYINT(1)      NOT NULL DEFAULT 0,
  age_restricted TINYINT(1)      NOT NULL DEFAULT 0,
  warning        VARCHAR(255)    NULL,
  sort_order     INT             NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- products ----------
CREATE TABLE IF NOT EXISTS products (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(200)    NOT NULL,
  brand       VARCHAR(120)    NULL,
  category    VARCHAR(120)    NOT NULL,           -- category slug
  weight      VARCHAR(60)     NULL,
  mrp         DECIMAL(10,2)   NOT NULL DEFAULT 0,
  price       DECIMAL(10,2)   NOT NULL DEFAULT 0,
  discount    INT             NOT NULL DEFAULT 0, -- auto = round((mrp-price)/mrp*100)
  image       VARCHAR(500)    NULL,
  description TEXT            NULL,
  features    JSON            NULL,
  in_stock    TINYINT(1)      NOT NULL DEFAULT 1,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_products_category (category),
  KEY idx_products_instock (in_stock)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- addresses (saved customer addresses) ----------
CREATE TABLE IF NOT EXISTS addresses (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NULL,
  label         VARCHAR(40)     NULL,             -- Home / Work / Other
  receiver_name VARCHAR(120)    NULL,
  phone         VARCHAR(15)     NULL,
  house_no      VARCHAR(120)    NULL,
  landmark      VARCHAR(200)    NULL,
  full_address  VARCHAR(500)    NULL,
  city          VARCHAR(120)    NULL,
  district      VARCHAR(120)    NULL,
  state         VARCHAR(120)    NULL DEFAULT 'Bihar',
  pincode       VARCHAR(10)     NULL,
  latitude      DOUBLE          NULL,
  longitude     DOUBLE          NULL,
  is_default    TINYINT(1)      NOT NULL DEFAULT 0,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_addresses_user (user_id),
  CONSTRAINT fk_addresses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- orders ----------
CREATE TABLE IF NOT EXISTS orders (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id          VARCHAR(20)     NOT NULL,     -- "4A" + 8 hex
  user_id           BIGINT UNSIGNED NULL,
  customer          JSON            NOT NULL,     -- {name,mobile,address,city,landmark,pincode,deliverySource,deliveryLat,deliveryLng}
  items             JSON            NOT NULL,     -- [{id,name,weight,price,quantity}]
  subtotal          DECIMAL(10,2)   NOT NULL DEFAULT 0,
  discount          DECIMAL(10,2)   NOT NULL DEFAULT 0,
  delivery_charge   DECIMAL(10,2)   NOT NULL DEFAULT 0,
  total_amount      DECIMAL(10,2)   NOT NULL DEFAULT 0,
  payment_method    VARCHAR(30)     NOT NULL DEFAULT 'UPI',
  payment_reference VARCHAR(12)     NULL,         -- 12-digit UTR, unique when present
  order_status      VARCHAR(40)     NOT NULL DEFAULT 'Order Placed',
  order_date        DATETIME        NOT NULL,
  delivery_address  JSON            NULL,         -- snapshot at order time
  rider_id          VARCHAR(40)     NULL,
  rider_name        VARCHAR(120)    NULL,
  rider_mobile      VARCHAR(15)     NULL,
  assigned_at       DATETIME        NULL,
  delivered_at      DATETIME        NULL,
  created_by        VARCHAR(64)     NULL,
  reminder_count    INT             NOT NULL DEFAULT 0,   -- for admin new-order reminders
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_orderid (order_id),
  UNIQUE KEY uq_orders_payref (payment_reference),
  KEY idx_orders_status (order_status),
  KEY idx_orders_rider (rider_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- tracking (live rider GPS per order) ----------
CREATE TABLE IF NOT EXISTS tracking (
  order_id     VARCHAR(20)  NOT NULL,
  status       VARCHAR(40)  NULL,
  rider_name   VARCHAR(120) NULL,
  rider_mobile VARCHAR(15)  NULL,
  lat          DOUBLE       NULL,
  lng          DOUBLE       NULL,
  heading      DOUBLE       NULL,
  speed        DOUBLE       NULL,
  accuracy     DOUBLE       NULL,
  source       VARCHAR(20)  NULL,      -- 'device_gps'
  dest_lat     DOUBLE       NULL,
  dest_lng     DOUBLE       NULL,
  assigned_at  DATETIME     NULL,
  updated_at   DATETIME     NULL,
  PRIMARY KEY (order_id),
  CONSTRAINT fk_tracking_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- settings (single row, id=1) ----------
CREATE TABLE IF NOT EXISTS settings (
  id                  TINYINT UNSIGNED NOT NULL DEFAULT 1,
  store_email         VARCHAR(190) NULL,
  delivery_charge     INT          NOT NULL DEFAULT 10,
  free_delivery_above INT          NOT NULL DEFAULT 500,
  upi_id              VARCHAR(120) NULL,
  upi_name            VARCHAR(120) NULL,
  hide_mrp            TINYINT(1)   NOT NULL DEFAULT 0,
  store_phone         VARCHAR(15)  NULL,
  store_address       VARCHAR(500) NULL,
  store_latitude      DOUBLE       NULL,
  store_longitude     DOUBLE       NULL,
  serviceable_villages TEXT        NULL,      -- "English (हिंदी), ..." comma list
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- config (single row, id=1) — homepage merchandising JSON ----------
CREATE TABLE IF NOT EXISTS config (
  id                TINYINT UNSIGNED NOT NULL DEFAULT 1,
  banners           JSON NULL,
  festival_ads      JSON NULL,
  festival_categories JSON NULL,
  ads               JSON NULL,
  social_proof_messages JSON NULL,
  social_proof_names JSON NULL,
  current_festival  VARCHAR(40) NULL,
  footer            JSON NULL,   -- common site footer (Admin → Settings → Footer); NULL = built-in defaults
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- ad_creatives (admin Ads & Social poster library; original data/ads.json) ----------
CREATE TABLE IF NOT EXISTS ad_creatives (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  data       JSON         NOT NULL,              -- name, campaign, status, format, creative{...}, caption...
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- pages (CMS: Privacy Policy, Terms, Help & Support, Delete Account ...) ----------
-- Edited in Admin → Pages; shown at /page/<slug> and linked from the footer.
CREATE TABLE IF NOT EXISTS pages (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug             VARCHAR(80)  NOT NULL,
  title            VARCHAR(200) NOT NULL,
  meta_description VARCHAR(300) NULL,
  content          MEDIUMTEXT   NOT NULL,          -- HTML (sanitised on render)
  show_in_footer   TINYINT(1)   NOT NULL DEFAULT 1,
  published        TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order       INT          NOT NULL DEFAULT 0,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pages_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- announcements (single row, id=1) ----------
CREATE TABLE IF NOT EXISTS announcements (
  id        INT          NOT NULL DEFAULT 0,   -- auto-bumps on change
  text      TEXT         NULL,
  image     VARCHAR(500) NULL,
  target    VARCHAR(20)  NOT NULL DEFAULT 'all', -- 'all' or one 10-digit mobile (original announcement.php)
  cta_text  VARCHAR(120) NULL,
  cta_link  VARCHAR(500) NULL,
  enabled   TINYINT(1)   NOT NULL DEFAULT 0,
  row_id    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (row_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- app_version (single row, id=1) ----------
CREATE TABLE IF NOT EXISTS app_version (
  id            TINYINT UNSIGNED NOT NULL DEFAULT 1,
  version_code  INT          NOT NULL DEFAULT 1,
  version_name  VARCHAR(20)  NOT NULL DEFAULT '1.0.0',
  url           VARCHAR(500) NULL,
  message       TEXT         NULL,
  force_update  TINYINT(1)   NOT NULL DEFAULT 0,
  asset_version INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- device_tokens (push notifications) ----------
CREATE TABLE IF NOT EXISTS device_tokens (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NULL,
  token      VARCHAR(255)    NOT NULL,
  platform   ENUM('android','ios','web') NOT NULL,
  topics     JSON            NULL,          -- ["customers"] / ["admins"] / ["riders"]
  updated_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_token (token),
  KEY idx_device_user (user_id),
  CONSTRAINT fk_device_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== Video Generator (same as db/migrations/2026-09-30-video-generator.sql) =====
-- Video Generator (Admin → Ads & Social → Video Ads). Safe to re-run.
-- Windows: mysql.exe -u root four_a_store --default-character-set=utf8mb4 -e "SOURCE db/migrations/2026-09-30-video-generator.sql"

-- Featured products feed the daily "Aaj ka Special" video.
ALTER TABLE products ADD COLUMN IF NOT EXISTS featured TINYINT(1) NOT NULL DEFAULT 0 AFTER in_stock;

-- Festival calendar (seeded from api-node/data/festivals.seed.json; editable in admin).
-- Lunar festivals have date = NULL until the admin enters the verified date.
CREATE TABLE IF NOT EXISTS festivals (
  id             VARCHAR(40)  NOT NULL,              -- slug, e.g. "diwali"
  name           VARCHAR(80)  NOT NULL,
  date           DATE         NULL,
  date_verified  TINYINT(1)   NOT NULL DEFAULT 0,    -- admin confirmed this year's date
  greeting       VARCHAR(120) NOT NULL DEFAULT '',
  sub_text       VARCHAR(200) NOT NULL DEFAULT '',
  emojis         JSON         NULL,
  colors         JSON         NULL,                  -- {primary, secondary, accent}
  music_style    VARCHAR(10)  NOT NULL DEFAULT 'festive',
  default_offer  VARCHAR(120) NOT NULL DEFAULT '',
  active         TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_festivals_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Render jobs + video library (one row per video file).
CREATE TABLE IF NOT EXISTS video_jobs (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  status       VARCHAR(12)  NOT NULL DEFAULT 'queued',  -- queued | rendering | done | failed
  progress     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  source       VARCHAR(10)  NOT NULL DEFAULT 'manual',  -- manual | auto
  title        VARCHAR(160) NOT NULL DEFAULT '',
  template     VARCHAR(12)  NOT NULL,
  format       VARCHAR(8)   NOT NULL,                   -- reel | square
  duration_sec TINYINT UNSIGNED NOT NULL,
  options      JSON         NOT NULL,                   -- validated render options
  file_name    VARCHAR(80)  NULL,                       -- media/videos/<file_name>.mp4 (+ .jpg)
  size_bytes   INT UNSIGNED NULL,
  caption      TEXT         NULL,
  error        VARCHAR(500) NULL,
  created_by   VARCHAR(64)  NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at   DATETIME     NULL,
  finished_at  DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_video_jobs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Store profile for videos + auto-generation settings (JSON; NULL = defaults in code).
ALTER TABLE config ADD COLUMN IF NOT EXISTS video_settings LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL
  CHECK (video_settings IS NULL OR json_valid(video_settings));


-- ===== Video languages (same as db/migrations/2026-10-01-video-languages.sql) =====
-- Video Ads: Hinglish / हिंदी / English. Safe to re-run.
-- Per-language festival text: {"hindi":{name,greeting,subText,defaultOffer},"english":{...}}
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS translations LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL
  CHECK (translations IS NULL OR json_valid(translations)) AFTER default_offer;
-- Language of each rendered video (for the library badge / filters).
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS lang VARCHAR(10) NOT NULL DEFAULT 'hinglish' AFTER format;

