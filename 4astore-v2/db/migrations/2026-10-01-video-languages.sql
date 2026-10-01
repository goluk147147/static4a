-- Video Ads: Hinglish / हिंदी / English. Safe to re-run.
-- Per-language festival text: {"hindi":{name,greeting,subText,defaultOffer},"english":{...}}
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS translations LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL
  CHECK (translations IS NULL OR json_valid(translations)) AFTER default_offer;
-- Language of each rendered video (for the library badge / filters).
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS lang VARCHAR(10) NOT NULL DEFAULT 'hinglish' AFTER format;
