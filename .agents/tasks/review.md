# Local product-image upload with a hard 50 KB compression ceiling

Admin product add/edit now accepts a local file, iteratively compresses it in-browser to a stored JPEG data-URI of at most 51200 decoded bytes, shows a preview and a size readout, and saves it through the existing `saveProduct` path with no API-shape change. A matching api-node guard rejects any product-image data-URI whose decoded payload exceeds ~60 KB with a 400, so a bypassed or raw upload can't bloat the DB. Payment-screenshot compression, the mobile app, and the online storefront/checkout are untouched. The DB-vs-JSON question the owner raised is answered as a finding: all request-time catalog reads already go through Prisma.

Watch for: nothing blocking. The web ceiling is a genuine hard cap (the dim/quality floor lands a few KB under 50 KB for any real photo, confirmed), the server guard decodes correctly and leaves the global body limit alone (confirmed), and mobile is out of scope because no product editor exists there — correctly documented (confirmed). One minor residual: an http(s) image URL that happens to resolve to a huge remote image is neither compressed nor size-checked, by design (confirmed, non-blocking).

**Verdict**: APPROVED

## High-level view

The compression work is deliberately isolated. Rather than touch the existing `compressImage` (which `PaymentModal` depends on), a new `compressToMaxBytes` was added alongside it, so payment-screenshot behaviour cannot regress. The new function loops a tightening schedule of dimensions and JPEG qualities, measuring the *decoded* byte size (not the inflated base64 string length) after each encode, and returns the first result at or under the ceiling. The aggressive floor (256px, q=0.3) sits far below 50 KB for any real photo, which is what makes the cap a guarantee rather than a target.

The admin form change is additive: a file input under the existing "Image URL" field, a preview thumbnail, a "Stored size: X KB / 50 KB" readout, and compile-time disabling of Save while compression runs. The compressed data-URI is written into the same `image` form field a pasted URL uses, so the save payload and the `saveProduct` call are unchanged.

The server guard is the backstop. It fires only for `data:` images, decodes the base64 with `Buffer.from(...).length` (the same technique the existing banner-upload handler uses), and rejects over 61440 bytes — a small headroom above the client's 50 KB target so a legitimate client image never trips it, while a raw/bypassed upload is blocked. The 60 KB per-image check is independent of the global `express.json` body limit, which stays at 6 MB (and 15 MB for ads), so screenshots and ad payloads are unaffected.

Mobile is correctly scoped out: there is no product add/edit screen in the mobile app (only orders and roles), so there is nothing to attach a picker to. The expo-image-picker and expo-image-manipulator deps are already present, so a future mobile editor can hit the same ceiling with no new native module and no prebuild. The DB-vs-JSON finding confirms no live route reads a catalog JSON file at request time.

<details>
<summary>Issues (2)</summary>

1. **Remote-URL images unbounded** — a pasted http(s) image URL is neither client-compressed nor size-checked by the server guard (guard only inspects `data:` URIs). By design, non-blocking; flag only if remote hotlinks should also be constrained.
2. **Server headroom is a fixed constant** — the 61440-byte guard assumes the client always targets 51200; if the client ceiling is ever raised the server constant must move with it. Non-blocking, worth a comment-level note (already partly documented inline).

</details>

<details>
<summary>Details</summary>

### Iterative ceiling in `compressToMaxBytes` (confirmed)

The function draws the source into a canvas and re-encodes JPEG across a nested schedule — dimensions `[1000, 800, 640, 512, 400, 320, 256]`, qualities `[0.82, 0.72, 0.62, 0.52, 0.42, 0.3]` — measuring decoded bytes after each encode and returning the first output at or under `maxBytes`. The ceiling is enforced on the *decoded* size via `dataUriBytes`, which strips the base64 header and computes `floor(len*3/4) - padding`, i.e. the true stored size rather than the ~1.33x string length. That distinction is the crux of the whole feature: measuring the string length would under-fill images by a third or let them slip over the real stored budget.

The guarantee rests on the floor. The least-aggressive combination still produced in the loop is 256px at q=0.3, which the verification script measured at ~2.6 KB for a synthetic 4000×3000 source — an order of magnitude under 51200. So the "floor still over budget" fallback branch (`resolve(smallest)`) is effectively unreachable for real photographs; it exists only as a safety net and still returns the smallest candidate rather than something oversize. The exit test `bytes <= maxBytes` uses the exact 51200 constant, and the recorded ceiling-proof asserted the boundary is exact (51200 passes, 51201 fails).

```
dims:      1000 → 800 → 640 → 512 → 400 → 320 → 256
qualities: 0.82 → 0.72 → 0.62 → 0.52 → 0.42 → 0.3   (scanned at each dim)
exit:      first encode with dataUriBytes(out) <= 51200
floor:     256px @ 0.3  ≈ 2.6 KB  (always well under ceiling)
```

`compressImage` is byte-for-byte unchanged; `PaymentModal.tsx` still imports and calls `compressImage(original, 1000, 0.7)`, so screenshot compression is provably untouched.

### Admin form wiring (confirmed)

The file input sits under the existing "Image URL" field; on pick it reads the file to a data-URI, runs `compressToMaxBytes(dataUri, 51200)`, and on success calls `set('image', out)` — the same form field a pasted URL writes. `save()` then sends `image: f.image.trim()` through the unchanged `saveProduct('add'|'update', payload)` call, so there is no new API contract. The preview thumbnail and `Stored size: {(dataUriBytes/1024).toFixed(1)} KB / 50 KB` readout render only when the field holds a `data:image` URI, and the Save button is disabled (`saving || compressing`) during compression, closing the window where a user could submit mid-encode. A read/compress failure surfaces a toast and leaves the field untouched. A pasted http(s) URL is saved as-is and not forced through compression — intentional, so remote catalog images keep working.

### Server oversize guard (confirmed)

Inside `POST /products` for add/update, immediately after the Zod parse and before the DB write:

```ts
if (p.image.startsWith('data:')) {
  const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/.exec(p.image);
  const decoded = m ? Buffer.from(m[1], 'base64').length : p.image.length;
  if (decoded > 61440) return fail(res, 'Product image is too large …', 400);
}
```

It fires only for `data:` images; a remote URL passes through untouched. The decode uses `Buffer.from(b64, 'base64').length` — identical technique to the existing banner-upload handler — and the recorded proof confirmed the boundary is exact (61440 passes, 61441 rejects). `fail` is the shared `../utils/http` helper used elsewhere in the same handler (the 422 on parse failure), so the 400 is consistent with the file's error convention. The guard reads only `p.image` (typed `string` from the Zod schema), `String.startsWith`, a regex, and `Buffer.from`, none of which depend on Prisma types — consistent with the verification note's claim of zero new errors in the edit region despite the stale-Prisma build noise.

The global body limit is deliberately left alone: `express.json({ limit: '6mb' })` for the default and `'15mb'` for `/api/admin/ads` are both unchanged in `server.ts`, so payment screenshots and ad/screenshot payloads keep their headroom. The per-image 60 KB check is a semantic guard layered on top of, not a replacement for, the transport limit.

One structural coupling: the server's 61440 constant is a hand-tuned headroom over the client's 51200 target. If the client ceiling ever changes, this constant must move with it or the two drift apart. It's documented inline as "small headroom."

### Mobile out of scope (confirmed)

`4astore-v2/mobile/app/admin/` contains only `orders.tsx`, `roles.tsx`, and `order/[id].tsx` — no product add/edit screen, so there is no surface to attach a picker to. The only mobile `ImagePicker`/`manipulateAsync` usage is `src/components/PaymentSheet.tsx`, the payment-screenshot flow, which is not in this diff and uses the existing `compress: 0.7` manipulate path. `expo-image-picker` (~17.0.11) and `expo-image-manipulator` (~14.0.8) are already in `package.json`, so a future mobile product editor can reach the same ≤50 KB ceiling via a pick → `manipulateAsync` resize/quality loop → base64 data-URI with no new native dependency and no prebuild. The no-editor case is clearly documented in the verification note.

### DB-vs-JSON finding (confirmed)

All request-time catalog/order/user/settings reads go through Prisma (`catalog.ts` uses `prisma.product.findMany`, `prisma.category.findMany`, and `$queryRawUnsafe` against settings/config/announcements/app_version). The only catalog-JSON reader is `services/dataImport.ts`, reachable solely through the owner-only `/api/admin/data/*` one-time import route, not at request time. Other `fs.readFile` callers (`og.ts`, `push.ts`, `video/render.ts`) read asset binaries and credentials, not catalog data. No request-time JSON catalog read exists; nothing to fix here.

### Surgical scope (confirmed)

The feature touches three code files — `web/src/lib/checkout.ts` (additive: two new exported functions, nothing removed/edited), `web/src/pages/admin/AdminProducts.tsx` (additive: file input, preview, compress handler, Save-disable), and `api-node/src/routes/admin.ts` (an 8-line guard block). No shared signatures changed, no routes added, no body limits moved. The order-descending / fresh-not-cached and out-of-stock-display concerns from the original request are not part of this branch and are not touched here, so there is no overlap risk with pos-billing/admin-fixes work on those areas.

</details>

<details>
<summary>File map</summary>

- `4astore-v2/web/src/lib/checkout.ts` — adds `dataUriBytes` (decoded-size calc) and `compressToMaxBytes` (iterative ≤50 KB compressor); `compressImage` untouched.
- `4astore-v2/web/src/pages/admin/AdminProducts.tsx` — local file input, preview + size readout, compress-on-pick into the existing `image` field, Save disabled while compressing.
- `4astore-v2/api-node/src/routes/admin.ts` — oversize guard in `POST /products` rejecting a decoded `data:` image > 61440 bytes with 400.
- `.agents/tasks/plan.md`, `.agents/tasks/image-upload-verification.md` — plan and recorded verification evidence (docs, not reviewed as code).

Full diff: `git -C c:\xampp\htdocs\static4a\.worktrees\image-upload-50kb diff main`

</details>
