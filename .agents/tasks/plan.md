# Implementation Plan — Local product-image upload with hard 50 KB (51200-byte) compression

Scope: add a local-file product image upload to the 4A Store v2 admin that HARD-compresses the
FINAL stored image to a MAX of 51200 bytes (50 KB), on the WEB admin, plus a small api-node
server-side guard. MOBILE is OUT OF SCOPE for upload (see item 5 — there is no mobile admin product
editor). Keep the diff surgical; this branch is unrelated to pos-billing / admin-fixes.

Worktree root: `c:\xampp\htdocs\static4a\.worktrees\image-upload-50kb`
Projects root: `c:\xampp\htdocs\static4a\.worktrees\image-upload-50kb\4astore-v2`

## Design decisions (grounded in the code I read)

- **Store a compressed JPEG data-URI into `product.image`, no API shape change.** `products.image`
  is a TEXT column already holding base64 data-URIs end-to-end (confirmed in
  `api-node/src/services/dataImport.ts`), and the save path `web/src/lib/admin.ts ->
  saveProduct(action, product)` POSTs `{ action, product }` to `/admin/products`, where
  `productSchema.image` is a free `z.string()`. So a data-URI drops straight in with zero backend
  shape change. Chosen over uploading a file to a new `/products/upload` endpoint (like
  `/banners/upload`) because the brief says "store the compressed data-URI into product.image via
  the existing save path (no API shape change)" and the column already supports it.
- **JPEG output, iterative resize+quality loop.** Extend the existing canvas approach in
  `web/src/lib/checkout.ts` (`compressImage` already draws to a canvas and emits
  `canvas.toDataURL('image/jpeg', q)`). Add a NEW `compressToMaxBytes` that loops: drop quality
  first, then shrink dimensions, until the decoded byte length `<= 51200`, with an aggressive floor
  so it is mathematically impossible to exceed 50 KB (if even the floor is over budget, return the
  smallest result — but with the chosen floor that never happens for real photos). JPEG chosen over
  WebP for maximum browser/`canvas.toDataURL` support; quality-then-size order chosen to preserve
  dimensions as long as possible. **Do NOT modify `compressImage`** — `PaymentModal.tsx` depends on
  its current signature/behaviour; add a sibling function.
- **Measure true bytes, not string length.** data-URI payload byte size = decoded base64 length.
  Compute it from the base64 part (`atob(b64).length`, or `(b64.length * 3/4) - padding`) so the
  ceiling is the real stored size, not the ~1.33x-inflated string length.
- **Server guard at ~60 KB, not exactly 50 KB.** The client targets `<= 51200`; the server rejects
  only clearly-oversized images (decoded data-URI > ~61440 bytes) so a legitimate client-compressed
  image never trips it, while a bypassed/raw upload is blocked. Implemented inside the existing
  `/admin/products` handler (no new route, no change to the global `express.json` limit).
- **Mobile: parity not possible — no editor exists.** `mobile/app/admin/` contains only
  `orders.tsx`, `roles.tsx`, `order/[id].tsx`. There is NO product add/edit screen on mobile, so
  there is nothing to add an image picker to. `expo-image-picker` + `expo-image-manipulator` ARE
  installed, so if a mobile product editor is added later the same ceiling can be implemented
  without a native rebuild — but that is out of scope here.

## Verification commands (discovered during exploration)

- WEB build: `npm run build` in `4astore-v2/web` (runs `generate-sitemap` + `tsc -b` + `vite build`).
- API build: `npm run build` in `4astore-v2/api-node` (`tsc -p tsconfig.json`).
- MOBILE typecheck: `npx tsc --noEmit` in `4astore-v2/mobile` (no mobile code changes, so this must
  stay green as a regression check only).
- Ceiling-proof: a small node script that base64-decodes the stored data-URI and asserts
  `<= 51200` (item 4).

---

- [ ] 1. Add an iterative byte-budget image compressor to the web lib.
      Add a NEW exported async function `compressToMaxBytes(dataUri: string, maxBytes = 51200): Promise<string | null>`
      beside the existing `compressImage` in `web/src/lib/checkout.ts`. It must: load the image,
      then loop — start at a sane max dimension (e.g. 1000px) and quality (e.g. 0.82), re-encode via
      a canvas to `image/jpeg`, measure the DECODED byte size of the result (decode the base64 part,
      e.g. `atob(dataUri.split(',')[1]).length`), and if still over budget progressively lower
      quality (down to ~0.3) then shrink the max dimension (e.g. steps 1000→800→640→512→400→320→256px),
      repeating until size `<= maxBytes`. Guarantee termination and a hard ceiling: at the smallest
      dimension + lowest quality the result is well under 50 KB for any real photo; return that
      final data-URI (never one over `maxBytes` unless the floor itself exceeds it, which it will not).
      Export a small helper `dataUriBytes(dataUri: string): number` too (reused by item 2's size readout).
      Do NOT change `compressImage` — `PaymentModal.tsx` still imports it unchanged.
      Files: `c:\xampp\htdocs\static4a\.worktrees\image-upload-50kb\4astore-v2\web\src\lib\checkout.ts`
      Verify: `npm run build` in `4astore-v2/web` succeeds (tsc + vite) — the new exports typecheck
      and bundle with no errors.

- [ ] 2. Add the local file picker + preview + size readout to the web admin product form.
      In `AdminProducts.tsx`, add — directly under the existing "Image URL" field inside the modal
      `prod-form-grid` — a `<input type="file" accept="image/*">`. On change: read the chosen file as
      a data-URI (`FileReader.readAsDataURL`), run `compressToMaxBytes(dataUri, 51200)`, and on success
      set the form `image` field to the returned compressed data-URI (reuse the existing
      `set('image', ...)`). Show a small preview `<img src={form.image}>` and a size readout computed
      with `dataUriBytes` (e.g. "Stored size: 42.1 KB / 50 KB"). While compressing, disable Save and
      show a "Compressing…" hint; on compressor failure show `showToast('Could not read/compress this image', 'error')`.
      Keep the existing URL `<input>` working (a pasted http(s) URL still saves as-is — do not force
      compression on URLs, only on local file picks). No change to `save()` / `saveProduct` payload —
      `image` already carries whatever string is in the field.
      Files: `c:\xampp\htdocs\static4a\.worktrees\image-upload-50kb\4astore-v2\web\src\pages\admin\AdminProducts.tsx`
      (import `compressToMaxBytes`, `dataUriBytes` from `../../lib/checkout`)
      Verify: `npm run build` in `4astore-v2/web` succeeds. Manual: open Admin → Products → Add,
      pick a large photo, confirm the readout shows `<= 50 KB` and Save succeeds.

- [ ] 3. Add the server-side oversize guard to the product create/update route.
      In the `/products` handler in `api-node/src/routes/admin.ts`, inside the `action === 'add' || 'update'`
      branch AFTER `productSchema` parse succeeds, if `p.image` is a `data:` URI, decode its base64
      payload and if the decoded length exceeds ~61440 bytes (60 KB) return
      `fail(res, 'Product image is too large — it must be compressed to under 50 KB before saving', 400)`.
      A non-`data:` image (http(s) URL) is left untouched. Do NOT change the global `express.json`
      limit in `server.ts` (ads/screenshots rely on 6mb/15mb). Add a tiny local helper to measure the
      decoded size (mirror the existing `Buffer.from(b64, 'base64').length` style already used in
      `/banners/upload`).
      Files: `c:\xampp\htdocs\static4a\.worktrees\image-upload-50kb\4astore-v2\api-node\src\routes\admin.ts`
      Verify: `npm run build` in `4astore-v2/api-node` succeeds (tsc clean).

- [ ] 4. Add and run a ceiling-proof script.
      Write a throwaway node script at `4astore-v2/web/scripts/verify-image-ceiling.mjs` that imports
      nothing from the browser build but instead reproduces the byte check: given a sample base64
      data-URI string it asserts `Buffer.from(b64,'base64').length <= 51200` and exits non-zero
      otherwise. (The real guarantee is produced in-browser by item 1; this script documents and
      checks the arithmetic the guard in item 3 relies on, using the SAME 51200 constant.) Run it and
      confirm it passes, then DELETE the script (it is a verification artifact, not shipped code).
      Files: `c:\xampp\htdocs\static4a\.worktrees\image-upload-50kb\4astore-v2\web\scripts\verify-image-ceiling.mjs` (temporary)
      Verify: `node 4astore-v2/web/scripts/verify-image-ceiling.mjs` exits 0 and prints the measured
      byte size; then remove the file.

- [ ] 5. Confirm mobile has no product editor and record the scoping decision; keep mobile green.
      No mobile code change. Confirm `mobile/app/admin/` contains only `orders.tsx`, `roles.tsx`,
      `order/[id].tsx` (no product add/edit screen), so the <=50 KB mobile upload has nothing to attach
      to and is correctly out of scope. `expo-image-picker` (~17.0.11) and `expo-image-manipulator`
      (~14.0.8) remain available for a future mobile editor without a native rebuild. Run the mobile
      typecheck purely as a regression check that nothing broke.
      Files: none (documentation/scoping item)
      Verify: `npx tsc --noEmit` in `4astore-v2/mobile` succeeds (unchanged, still green).

- [ ] 6. Verify runtime data comes from the DB (not data/*.json) and flag any live JSON read.
      Confirm (already investigated) that `api-node/src/routes/catalog.ts` reads products/categories/
      settings/config/announcement/version via Prisma, and that the ONLY `fs.readFileSync(... .json)`
      callers are `services/dataImport.ts` (one-time legacy import) reached solely through the
      owner-only `/api/admin/data/*` route (`routes/admin-data.ts`) — NOT at normal request time. The
      other `fs.readFile` hits (`services/push.ts` FCM service-account, `video/render.ts`,
      `services/og.ts`) read uploaded/asset binaries, not catalog JSON, so they are fine. Record the
      finding in the review notes. If a live request-time JSON catalog read is found, flag it clearly;
      fix only if it is a one-line obvious in-scope bug (none found during planning).
      Files: none (verification/flag item) — if a one-line fix is needed it would be in the offending
      `api-node/src/routes/*.ts`.
      Verify: `npm run build` in `4astore-v2/api-node` still succeeds; state in the review that no
      request-time JSON catalog read exists.

## Out-of-scope note (do not implement here)

The original user also asked for "order list descending (newest first)" and "fresh, non-cached data".
Those belong to the separate admin-fixes work, NOT this image-upload branch. The one relevant
observation for THIS branch: product/category writes already call `bumpCatalogVersion()` and
`/products` serves `no-cache, must-revalidate` with a version ETag, so an in-stock/out-of-stock edit
is reflected without stale caching. Leave ordering/caching changes to the other branch to keep this
diff surgical.
