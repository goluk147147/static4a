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
