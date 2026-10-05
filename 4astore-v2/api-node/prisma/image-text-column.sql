-- Widen product/category image columns from VARCHAR(500) to TEXT.
-- A few legacy products embed a base64 data-URI image (7k–15k chars) that
-- overflows VARCHAR(500) and aborts the data import (Prisma P2000 "value too
-- long for column: image"). TEXT removes the limit so every image imports.
--
-- Idempotent: MODIFY to TEXT is a no-op if the column is already TEXT.
-- Run on the server BEFORE re-importing:
--   mysql -uroot -p four_a_store < prisma/image-text-column.sql
-- (or inline: mysql -uroot -p four_a_store -e "ALTER TABLE products MODIFY COLUMN image TEXT; ALTER TABLE categories MODIFY COLUMN image TEXT;")

ALTER TABLE products   MODIFY COLUMN image TEXT NULL;
ALTER TABLE categories MODIFY COLUMN image TEXT NULL;
