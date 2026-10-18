# Implementation Plan — Admin product image update: fix TEXT overflow

## Root cause (confirmed by reading the code)

- `prisma/schema.prisma` → `model Product { ... image String? @db.Text ... @@map("products") }`.
  MySQL `TEXT` holds at most 65,535 **bytes**. The physical table is `products` (confirmed via `@@map("products")`).
- The admin UI compresses images to <= 50 KB of **binary** data but stores them as a base64
  **data-URI string** (`data:image/jpeg;base64,...`). Base64 inflates ~33% plus the
  `data:image/...;base64,` prefix, so ~49.6 KB binary becomes a ~67-68 KB string — over the 64 KB
  TEXT limit. MySQL rejects the write with the "value too long for column: image" error.
- `src/routes/admin.ts` (the `if (p.image.startsWith('data:'))` block in the `add`/`update` handler)
  measures the **decoded binary** length (`const decoded = m ? Buffer.from(m[1], 'base64').length : p.image.length; if (decoded > 61440) ...`). That is the wrong quantity: the column stores the full
  data-URI **string**, not the binary payload. The guard passes (~49.6 KB binary < 60 KB) while the DB
  write fails on the ~67 KB stored string.
- Fix uses the repo's established no-migrate pattern: `ensure*` functions in
  `src/services/dataImport.ts` run idempotent raw `ALTER` statements at startup, guarded by an
  `information_schema` check (mirrors `ensureProductSeoColumns`, `ensureProductStatusColumn`,
  `ensureProductMaxQtyColumn`), wired into the boot block in `src/server.ts`. We do NOT run
  `prisma migrate` / `db push`.

Both fixes below are complementary and both must be applied.

---

- [ ] 1. Enlarge the Prisma column type for the product image.
      In `prisma/schema.prisma`, change the `Product.image` field from `String? @db.Text` to
      `String? @db.MediumText` (MySQL `MEDIUMTEXT` = 16 MB, so a ~67 KB data-URI string fits with
      room to spare). Change ONLY that one line; leave every other field, the `@@map("products")`,
      and all indexes untouched. This makes the generated Prisma client type match the enlarged DB
      column (the actual DB change happens at runtime in item 2).
      Files: `4astore-v2/api-node/prisma/schema.prisma`
      Verify: covered by item 4's `npx prisma generate` (exit 0) and `npm run build` (exit 0); no
      standalone command for this item.

- [ ] 2. Add an idempotent startup ensure step that widens `products.image` to MEDIUMTEXT.
      In `src/services/dataImport.ts`, add an exported `ensureProductImageColumnType()` that mirrors
      the existing ensure pattern but checks the column **type** (not presence, since `image` already
      exists). Query `information_schema.columns` for the current `DATA_TYPE` of `products.image`;
      only run the ALTER when it is still `text` (so the step is a no-op once applied). Use
      `$executeRawUnsafe` — NO prisma migrate / db push. Suggested body:
      ```ts
      /**
       * Ensure the products.image column is MEDIUMTEXT (not TEXT).
       *
       * The admin UI stores product images as base64 data-URI STRINGS. A ~50 KB-binary
       * image becomes a ~67 KB string (base64 +33% + the data: prefix), which overflows
       * a MySQL TEXT column (64 KB) and makes prisma.product.update() fail with
       * "value too long for column: image". MEDIUMTEXT (16 MB) holds it comfortably.
       *
       * Type-guarded (not presence-guarded): the column already exists, so we read its
       * current DATA_TYPE from information_schema and only ALTER while it is still 'text',
       * making re-runs a no-op. Mirrors the other ensure* helpers: $executeRawUnsafe,
       * NO prisma migrate / db push. Mirrored on the Prisma Product model (@db.MediumText).
       */
      export async function ensureProductImageColumnType(): Promise<void> {
        const rows = await prisma.$queryRawUnsafe<Array<{ t: string }>>(
          `SELECT DATA_TYPE AS t FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'image'`
        );
        const type = String(rows?.[0]?.t ?? '').toLowerCase();
        // Already MEDIUMTEXT/LONGTEXT (or the row is absent) → nothing to do.
        if (type !== 'text') return;
        await prisma.$executeRawUnsafe('ALTER TABLE products MODIFY image MEDIUMTEXT NULL');
      }
      ```
      Then wire it into startup in `src/server.ts`: import `ensureProductImageColumnType` in the
      existing `./services/dataImport` import list, and add one fire-and-forget call next to the other
      products ensures (e.g. right after `ensureProductSeoColumns().catch(...)`):
      ```ts
      // Widen products.image TEXT -> MEDIUMTEXT so a base64 data-URI image (<=50 KB binary
      // = ~67 KB string) no longer overflows the 64 KB TEXT limit (idempotent, no-migrate raw SQL).
      ensureProductImageColumnType().catch((e) => console.error('[seed] product image column type failed', e));
      ```
      Files: `4astore-v2/api-node/src/services/dataImport.ts`, `4astore-v2/api-node/src/server.ts`
      Verify: `npm run build` from `4astore-v2/api-node` compiles with exit 0 (the new export is
      imported and called; a typo breaks the build). The live ALTER cannot be verified offline — see
      the note in item 4.

- [ ] 3. Rewrite the oversize guard in admin.ts to measure the stored STRING byte length.
      In `src/routes/admin.ts`, replace the `if (p.image.startsWith('data:')) { ... decoded ... }`
      block so it validates the byte length of what is actually stored — the full data-URI string via
      `Buffer.byteLength(p.image, 'utf8')` — instead of the decoded binary length. Chosen threshold:
      **76800 bytes (75 KB)**. Rationale: the UI targets <= 50 KB of binary; base64 expands that by
      ~33% (≈66.6 KB) plus the `data:image/...;base64,` prefix (≈30 bytes), i.e. a legitimate
      max-budget image is ~67 KB as a string. 75 KB gives a small headroom above that worst case while
      still rejecting a clearly bypassed/raw upload, and it sits far under the new MEDIUMTEXT capacity,
      so the DB write will never be the thing that fails. Keep the existing behavior that a non-`data:`
      (http/https URL) image is left untouched and NOT length-checked as a payload. Preserve the 400
      status and a clear, bilingual-friendly message. Replacement:
      ```ts
      // Oversize guard: a product image data-URI is stored as a base64 STRING, so validate the
      // STORED string's byte length (what the column actually holds) — not the decoded binary.
      // The UI compresses to <= 50 KB binary, which is ~67 KB as a base64 data-URI string; reject
      // above 75 KB (headroom over that worst case, still well under the MEDIUMTEXT column cap).
      // A non-`data:` image (http/https URL) is a reference, not a payload — left untouched.
      if (p.image.startsWith('data:')) {
        const stored = Buffer.byteLength(p.image, 'utf8');
        if (stored > 76800) return fail(res, 'Product image is too large — it must be compressed to under 50 KB before saving / Image bahut badi hai — save karne se pehle 50 KB se chhoti karein', 400);
      }
      ```
      Do NOT touch any other handler behavior: the try/catch (Prisma `P2025` -> genuine 404; other
      errors `console.error('[admin] product update failed', e)` + 500), the zod 422, the publish-guard
      422, the `parseMaxQty` 422, `bumpCatalogVersion()`, and `runProductSeo` all stay exactly as they are.
      Files: `4astore-v2/api-node/src/routes/admin.ts`
      Verify: `npm run build` from `4astore-v2/api-node` exits 0; `npm test` (item 4) shows the existing
      suite still passing.

- [ ] 4. Regenerate the Prisma client, build, and run the test suite.
      Run, from `c:\xampp\htdocs\static4a\4astore-v2\api-node` (Windows / PowerShell; do NOT start any
      long-lived server):
      1. `npx prisma generate` — exit 0; regenerates the client so the `image` field type matches the
         `@db.MediumText` schema edit from item 1.
      2. `npm run build` — runs `tsc -p tsconfig.json`; expect exit 0 with no type errors (confirms the
         new `ensureProductImageColumnType` import/call in server.ts, the dataImport.ts addition, and
         the admin.ts guard rewrite all compile).
      3. `npm test` — runs `node --import ./src/__tests__/register.mjs --test "src/__tests__/**/*.test.ts"`;
         expect the existing 88 tests to still pass (this change adds no new behavior the suite would
         need to cover; it must not regress any passing test).
      Files: none (verification only)
      Verify: all three commands succeed as described above.
      NOTE: local MySQL/XAMPP may be down, so the live product-update round-trip (the actual
      `ALTER TABLE products MODIFY image MEDIUMTEXT NULL` applying and a >64 KB data-URI saving) may not
      be reproducible offline. `npx prisma generate`, `npm run build`, and `npm test` do NOT require a
      running database and are the authoritative local gates; the runtime ALTER is exercised on deploy
      when the server boots against the live DB.

---

## Notes / assumptions

- Physical table name is `products` (from `@@map("products")`), matching every existing products
  ensure helper — the ALTER targets `products`, not `Product`.
- The type guard uses `DATA_TYPE` from `information_schema.columns`, which returns `text` /
  `mediumtext` / `longtext` (lowercase), so comparing against `'text'` correctly makes a re-run on an
  already-widened column a no-op. Unlike the duplicate-column (1060) swallow used by the add-column
  helpers, a `MODIFY` on an already-correct type simply never runs here, so no error-swallow is needed;
  any genuine ALTER failure surfaces to the `.catch` logger in server.ts (consistent with the other
  ensures being fire-and-forget at boot).
- No product-visible behavior changes: images that already saved are unaffected; the only functional
  difference is that a legitimately-sized data-URI image that previously failed now saves, and the
  reject message is clearer and measures the right quantity.

---

## Verification note (iteration 1 — implemented)

All four plan items applied in place at `c:\xampp\htdocs\static4a` (no worktree). No review JSON was
present, so this was a first-iteration from-scratch implementation.

Files touched:
- `4astore-v2/api-node/prisma/schema.prisma` — `Product.image` changed from `String? @db.Text` to
  `String? @db.MediumText` (that one line only; `@@map("products")`, indexes, all other fields
  untouched).
- `4astore-v2/api-node/src/services/dataImport.ts` — added exported
  `ensureProductImageColumnType()` immediately after `ensureProductSeoColumns()`. It reads
  `information_schema.columns.DATA_TYPE` for `products.image`, lowercases it, and only runs
  `ALTER TABLE products MODIFY image MEDIUMTEXT NULL` while the type is still `text` (so re-runs are a
  no-op). `$executeRawUnsafe`, no prisma migrate / db push. No 1060 swallow needed because a MODIFY on
  an already-correct type simply never runs.
- `4astore-v2/api-node/src/server.ts` — added `ensureProductImageColumnType` to the existing
  `./services/dataImport` import list and a fire-and-forget call
  `ensureProductImageColumnType().catch((e) => console.error('[seed] product image column type failed', e))`
  right after the `ensureProductSeoColumns()` call in the boot block.
- `4astore-v2/api-node/src/routes/admin.ts` — the `if (p.image.startsWith('data:'))` oversize guard
  now measures the STORED string via `Buffer.byteLength(p.image, 'utf8')` and rejects above `76800`
  (75 KB) with a 400 and a bilingual message. The decoded-binary measurement was removed. Non-`data:`
  (http/https URL) images are still left untouched. All other handler behavior (try/catch P2025 -> 404,
  other errors console.error + 500, zod 422, publish guard 422, parseMaxQty 422, bumpCatalogVersion,
  runProductSeo) is unchanged.

Commands run from `c:\xampp\htdocs\static4a\4astore-v2\api-node` (Windows / PowerShell):
- `npx prisma generate` — exit 0. The first attempt failed on an SSL cert error while trying to
  download the schema-engine checksum; re-run pinned to the already-present local engines
  (`PRISMA_SCHEMA_ENGINE_BINARY` / `PRISMA_QUERY_ENGINE_LIBRARY` under `node_modules/@prisma/engines`)
  and generated the client successfully (Prisma Client v5.22.0).
- `npm run build` (`tsc -p tsconfig.json`) — exit 0, no type errors.
- `npm test` — exit 0, **88 pass / 0 fail** (unchanged count; no regression).
- dist verification (dist is gitignored, built on deploy): confirmed via Select-String that
  `dist/routes/admin.js` contains `Buffer.byteLength`, `dist/services/dataImport.js` exports and
  defines `ensureProductImageColumnType` with the `ALTER TABLE products MODIFY image MEDIUMTEXT`
  statement, and `dist/server.js` calls `ensureProductImageColumnType`.

Live DB update: NOT possible offline. A TCP probe to `127.0.0.1:3306` was actively refused (local
XAMPP/MySQL is down), so the actual `ALTER TABLE products MODIFY image MEDIUMTEXT NULL` applying and a
~50 KB data-URI image saving could not be exercised locally. `npx prisma generate`, `npm run build`,
and `npm test` do not require a running DB and are the authoritative local gates. The runtime ALTER
and the string-length guard run on deploy when the server boots against the live DB.
