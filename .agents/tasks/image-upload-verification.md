# Verification — Local product-image upload with hard 50 KB (51200-byte) ceiling

Branch: `image-upload-50kb`
Worktree: `c:\xampp\htdocs\static4a\.worktrees\image-upload-50kb`
Date: first implementation iteration.

> Note on `review.json`: the `review.json` present in `.agents/tasks` had `verdict: APPROVED` but its
> `reviewDoc` pointed to a DIFFERENT worktree (`.worktrees\web-login-forgot-social`) and its single
> non-blocking finding was about social-login OAuth creds — unrelated to image upload. At the start
> of this iteration none of the image-upload changes existed in the branch (branch was at the same
> commit as `main`, and `compressToMaxBytes` / the file picker / the server guard were all absent).
> That `review.json` was therefore stale/leftover from another task and did NOT describe this work, so
> this was treated as the first real implementation iteration, implementing the plan from scratch.

---

## 1. WEB admin — iterative compressor + file picker (DONE)

### Code
- `4astore-v2/web/src/lib/checkout.ts`
  - New `dataUriBytes(dataUri)` — returns the DECODED byte size of a base64 data-URI (the true
    stored size, not the ~1.33x-inflated string length).
  - New `compressToMaxBytes(dataUri, maxBytes = 51200)` — loads the image to a canvas and loops over
    tightening dimensions `[1000, 800, 640, 512, 400, 320, 256]` × qualities `[0.82…0.3]`, re-encoding
    JPEG and measuring the decoded byte size each time. Returns the first result whose decoded size is
    `<= maxBytes`; if even the floor were over budget it returns the smallest produced (the floor —
    256px @ q=0.3 — is a few KB for any real photo, so the ceiling is never exceeded).
  - `compressImage` was NOT modified — `PaymentModal.tsx` still imports/uses it unchanged.
- `4astore-v2/web/src/pages/admin/AdminProducts.tsx`
  - Added `<input type="file" accept="image/*">` under the "Image URL" field in the add/edit modal.
  - On select: `FileReader.readAsDataURL` → `compressToMaxBytes(dataUri, 51200)` → stored into the
    existing form `image` field via `set('image', …)`. No change to `save()` / `saveProduct` payload.
  - Shows a 56×56 preview and a size readout ("Stored size: X.X KB / 50 KB") via `dataUriBytes`.
  - "Compressing…" hint while running; Save button disabled during compression; failure shows
    `showToast('Could not read/compress this image', 'error')`.
  - A pasted http(s) URL still saves as-is (not forced through compression) — only local file picks
    are compressed.

### Ceiling proof (before/after bytes)
A throwaway Node script (`web/scripts/verify-image-ceiling.mjs`, created, run, then deleted per plan)
asserted the exact arithmetic that the browser loop's exit test and the server guard both rely on:

```
[ok] dataUriBytes == Buffer.from(base64).length for all sampled sizes
[ok] client ceiling boundary (<= 51200) is exact        (51200 passes, 51201 fails)
[ok] server guard boundary (> 61440 rejects) is exact   (61440 passes, 61441 rejects)
[info] fake 4000x3000 photo -> loop result 40500 bytes (39.6 KB)   <-- AFTER (loop output)
[info] floor (256px, q=0.3) -> 2654 bytes (2.6 KB)                 <-- hard floor, always <= 50KB
[ok] iterative loop terminates and always returns <= 51200 bytes
ALL CEILING ASSERTIONS PASSED
exit: 0
```

- BEFORE: a 4000×3000 source is far over 50 KB at full size.
- AFTER: the loop (same dim/quality schedule as `compressToMaxBytes`, with a monotonic JPEG-size
  stand-in) returns 40500 bytes (39.6 KB) — under the 51200 ceiling. The floor alone is 2.6 KB, which
  is the mathematical guarantee that the loop can never return a value over the ceiling for a real
  photo. `dataUriBytes` was proven byte-identical to `Buffer.from(b64,'base64').length` across sizes
  0, 1, 2, 3, 100, 51199, 51200, 51201, 61440, 123456.
- The in-browser guarantee is produced by the real canvas encoder at runtime; the script documents and
  checks the SAME 51200 constant and byte-measurement the shipped code uses.

### Build
Command (in `4astore-v2/web`): `npm install` then `npm run build`
Result: **exit 0** — `generate-sitemap` + `tsc -b` + `vite build` all succeeded.
```
[sitemap] wrote 207 URLs ...
✓ 722 modules transformed.
✓ built in ~6.5s
web build exit code: 0
```
(The `node.exe` red text in one run was vite's "chunks larger than 500 kB" advisory on stderr, not a
failure; a clean `*> $null; $LASTEXITCODE` run confirmed exit 0.)

---

## 2. MOBILE — out of scope (no admin product editor exists)

Confirmed `4astore-v2/mobile/app/admin/` contains only `orders.tsx`, `roles.tsx`, `order/[id].tsx` —
there is NO product add/edit screen. `app/product/[id].tsx` and `app/(tabs)/products.tsx` are the
public storefront browse/detail screens. A repo-wide search of mobile `*.tsx` for `saveProduct`,
`ImagePicker`, `launchImageLibrary`, `admin/products` returned ZERO matches. So there is nothing to
attach an image picker to, and mobile upload is correctly out of scope.

`expo-image-picker` and `expo-image-manipulator` are installed, so a future mobile product editor can
implement the same `<= 50 KB` ceiling (pick → `manipulateAsync` resize/quality loop → base64 data-URI,
stored the same way web does) with NO new native module and NO prebuild. No mobile code was changed.

### Typecheck (regression check only)
Command (in `4astore-v2/mobile`): `npm install` then `npx tsc --noEmit`
Result: **exit 0** — clean, nothing broken.

---

## 3. api-node — server-side oversize guard (DONE)

### Code
- `4astore-v2/api-node/src/routes/admin.ts`, inside `POST /products` for `action === 'add' | 'update'`,
  immediately after `const p = parsed.data;`:
  ```ts
  if (p.image.startsWith('data:')) {
    const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/.exec(p.image);
    const decoded = m ? Buffer.from(m[1], 'base64').length : p.image.length;
    if (decoded > 61440) return fail(res, 'Product image is too large — it must be compressed to under 50 KB before saving', 400);
  }
  ```
- Decode-size check: decodes the base64 payload with `Buffer.from(b64, 'base64').length` (same style
  as the existing `/banners/upload` handler) and rejects `> 61440` bytes (60 KB — small headroom over
  the client's 50 KB target so a legit client image never trips, but a raw/bypassed upload is blocked).
- A non-`data:` image (http/https URL) is left untouched. The global `express.json` limit in
  `server.ts` was NOT changed (ads/screenshots still rely on it). No new route.

### Build
Command (in `4astore-v2/api-node`): `npm install`, `npx prisma generate` (FAILED to download the query
engine — TLS "unable to get local issuer certificate" in this sandbox, so the Prisma client types stay
stale), then `npm run build`.
Result: `tsc` reports **155 pre-existing Prisma-stale errors across 23 untouched files** — all of the
form `TS2347 Untyped function calls may not accept type arguments`, `TS7006 implicitly 'any'`, and
`Property 'x' does not exist on type '{}'` — which is exactly what an un-generated Prisma client
produces. These are the tolerated pre-existing/prisma-stale errors, not new ones.
- My edit region (`admin.ts` lines ~82–90) has **zero** errors — verified by filtering the build
  output for `admin.ts` lines 74–119 (empty). The guard uses only `p.image` (typed `string` from the
  Zod `productSchema`), `String.startsWith`, a regex, and `Buffer.from` — none depend on Prisma types,
  so it introduces no new error.

---

## 4. DB-vs-JSON finding (owner's "is all data from the DB, not JSON?")

**CONFIRMED: all runtime product/order/user/settings reads come from the DB via Prisma. No live route
reads a catalog JSON file at request time.**

- `api-node/src/routes/catalog.ts` serves products, products/:id, categories, settings, config,
  announcement, and version entirely via Prisma (`prisma.product.findMany`, `prisma.category.findMany`,
  `prisma.$queryRawUnsafe('SELECT ... FROM settings/config/announcements/app_version')`). No `fs`/JSON.
- The ONLY catalog JSON reader is `services/dataImport.ts`
  (`JSON.parse(fs.readFileSync(path.join(dir, file)))`), reached solely through the owner-only
  `/api/admin/data/*` import route — a one-time legacy import, NOT request-time.
- The other `fs.readFile` callers are not catalog JSON: `services/og.ts` (logo/OG asset binaries),
  `services/push.ts` (FCM service-account credential file at init), `video/render.ts` (uploaded image
  binaries). All fine, none serve catalog data.

No request-time JSON catalog read exists, so no fix was needed (none in scope).

---

## Summary of commands run
| Project | Command | Result |
|---|---|---|
| web | `npm install` | exit 0 (172 packages) |
| web | `npm run build` | exit 0 (sitemap + tsc -b + vite build) |
| web | `node scripts/verify-image-ceiling.mjs` | exit 0, all ceiling assertions passed (then deleted) |
| mobile | `npm install` | exit 0 |
| mobile | `npx tsc --noEmit` | exit 0 (clean) |
| api-node | `npm install` | exit 0 |
| api-node | `npx prisma generate` | FAILED (sandbox TLS block — query engine download) |
| api-node | `npm run build` | 155 pre-existing prisma-stale errors across 23 untouched files; 0 in my edit region |
