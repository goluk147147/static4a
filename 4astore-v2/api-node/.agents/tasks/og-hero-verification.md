# OG Product Hero (Option A) — Verification Note

## What changed
Clean single "product hero" OG image for PRODUCT share previews only.

- `src/services/og.ts`
  - Added `variant?: 'product-hero'` to `RenderOgOptions`.
  - Added new functions: `drawHeroBackground`, `drawHeroBranding`, `drawHeroStrip`,
    `drawHeroPhoto`, and exported `renderProductHeroImage(opts)`.
  - `renderOgImage()` now early-returns `renderProductHeroImage(opts)` when
    `variant === 'product-hero'`. All old functions (`drawBackground`, `drawBrandCard`,
    `drawCardText`, `drawRightPanel`) are untouched and still used for page/category.
  - `compress()`, `getOrRenderOg()` (mem + disk cache), constants `WIDTH=1200`,
    `HEIGHT=630`, `MAX_BYTES`, and `LOGO_PATH` are UNCHANGED.
- `src/routes/og.ts`
  - `GET /image/product/:id` now passes `variant: 'product-hero'`. The page
    (`/image/page/:slug`) and category (`/image/category/:slug`) routes are UNCHANGED.
- `src/services/ogShare.ts` — not modified; `og:image:width=1200`/`height=630` meta stays
  correct because the canvas is still 1200x630.

## Hero layout (Option A)
- Solid light background: subtle `#ffffff -> #f3f5f7` vertical gradient. No circles, no
  split card, no separate right tile.
- Product photo drawn LARGE and CENTERED via pure contain-fit in the upper area
  (`WIDTH-80` x `HEIGHT-140-80` = 1120 x 410 region), ZERO cropping.
- Bottom strip (140px): product name (wrapped, max 2 lines, ellipsised) on the left;
  prominent green `#148f77` price pill; subtle 4A logo (52px tall) in the bottom-right
  corner (falls back to a "4A Store" wordmark if the logo file is missing).
- Fallback: if the product image fails to load, a centered 4A logo (size-capped to
  420x300) is drawn on the clean background with the same text strip — never a broken image.

## Commands run
1. `npm install --no-audit --no-fund` — node_modules was missing in the worktree.
   Result: `added 355 packages`.
2. `npx prisma generate` — FAILED with `403 Forbidden` fetching the schema-engine from
   `binaries.prisma.sh`. This is the known/expected CDN block in this environment. The
   product-hero change does not touch Prisma models, so the stale client is fine for
   type-checking the og code.
3. `npm run build` (`tsc -p tsconfig.json`) — exits 1 with 155 total errors, 110 of them
   `TS2347 "Untyped function calls may not accept type arguments"` spread across the whole
   codebase (addresses.ts, seo/*, services/*, video/*, etc.). These are pre-existing
   stale-Prisma-client errors on `$queryRawUnsafe<T>()` calls, unrelated to this change.
   - `src/services/og.ts`: **0 errors**.
   - `src/routes/og.ts`: only 2 errors, both `TS2347` at lines 78 and 112 — the
     page/category `$queryRawUnsafe<Row[]>` calls (NOT touched by this change, same stale
     client noise). The product-route edit (adding `variant`) produced no error.
4. Isolated clean type-check of the renderer (no Prisma dependency):
   `npx tsc src/services/og.ts --outDir .scratch-dist --module commonjs --target ES2020
   --esModuleInterop --skipLibCheck` — **exit 0, 0 errors**.

## Sample image (real render)
Compiled renderer run via a throwaway script (since prisma noise blocks the full `dist/`):
`renderProductHeroImage({ title: 'Tata Salt 1 Kg', subtitle: '1 Kg', price: '₹28',
imageUrl: 'assets/og-logo.png', variant: 'product-hero' })`.

- Output: `c:\xampp\htdocs\static4a\.worktrees\og-product-hero\og-sample.webp`
- Format/dims/size: **webp, 1200x630, 13,720 bytes** (well under the 100 KB cap).
- Decoded back with `loadImage` to confirm valid 1200x630.
- Visual check: clean white background, large centered image (zero cropping), bottom strip
  with "Tata Salt 1 Kg" + green "₹28" pill + small 4A logo bottom-right. Matches Option A.
- Throwaway script and `.scratch-dist/` were DELETED. The sample image is LEFT for the user.

## Contain-fit math (zero-crop guarantee)
`scale = min(areaW/img.width, areaH/img.height)` → the smaller ratio, so both scaled
dimensions fit within the area; `dx/dy` center the image. No source rectangle is passed to
`drawImage`, so the whole source is drawn — nothing is cropped.

## Commit
HEAD of branch `og-product-hero` — "feat: clean product-hero OG share image for products".
(3 files: src/services/og.ts, src/routes/og.ts, this note. Not pushed. Run
`git -C c:\xampp\htdocs\static4a\.worktrees\og-product-hero rev-parse HEAD` for the hash.)
