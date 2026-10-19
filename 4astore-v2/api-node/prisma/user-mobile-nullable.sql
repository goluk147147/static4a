-- ============================================================
-- 4AStore API — make `users.mobile` NULLable + null legacy Google placeholders
-- ------------------------------------------------------------
-- Run ONCE on the live DB (EC2). MODIFY + a guarded UPDATE only — no drops.
--
--   mysql -u <user> -p four_a_store < prisma/user-mobile-nullable.sql
--
-- Purpose: Google sign-in no longer mints a synthetic `g<sub>` placeholder
-- mobile — a brand-new Google user is stored with mobile = NULL and sets a real
-- number later via the EMAIL-OTP /users/mobile/verify flow. For NULL to be
-- storable the column must drop NOT NULL (the UNIQUE index is preserved; MySQL
-- allows multiple NULLs under a UNIQUE index). The second statement resets every
-- legacy `g<digits>` placeholder to NULL — that pattern can NEVER match a real
-- 6-9 Indian number, so no genuine mobile is touched.
--
-- NO `prisma migrate` / `db push` is used — the same change is applied at
-- runtime by ensureUserMobileNullable() + backfillGooglePlaceholderMobiles()
-- (services/dataImport.ts); this file is the manual equivalent for a one-off
-- DB apply. Safe to re-run.
-- ============================================================

ALTER TABLE users MODIFY mobile VARCHAR(15) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
UPDATE users SET mobile = NULL WHERE mobile REGEXP '^g[0-9]+$';
