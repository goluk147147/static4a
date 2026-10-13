-- =============================================================================
-- otp-purpose-widen.sql  (additive, idempotent — safe to run on a live DB)
--
--   mysql -u <user> -p four_a_store < prisma/otp-purpose-widen.sql
--
-- Purpose: the email_otp.purpose column was too narrow / an ENUM that did not
-- include newer purposes, so prisma.emailOtp.create({ purpose: 'set_mobile' })
-- failed with MySQL 1265 "Data truncated for column 'purpose'". This widens it
-- to VARCHAR(32) so every purpose ('signup','reset','recovery','set_mobile', …)
-- fits. No data loss: existing short values fit in VARCHAR(32).
--
-- The Prisma model already declares `purpose String @default("signup")`, so no
-- schema.prisma change is needed — this only aligns the live column type.
-- =============================================================================

ALTER TABLE email_otp
  MODIFY COLUMN purpose VARCHAR(32) NOT NULL DEFAULT 'signup';
