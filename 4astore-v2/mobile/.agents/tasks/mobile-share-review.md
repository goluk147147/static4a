# Product Share now emits the universal smart short link

The mobile product Share button previously shared the raw canonical URL `${SITE_URL}/product/<id>` inline. This change routes it through a new `src/share.ts` helper that first fetches a smart short code from `GET /api/products/:id/short-link` and shares `https://4astore.com/link/<code>` instead, mirroring the web storefront. If the code comes back null or the request fails, it falls back to the raw product URL, and the native share-sheet dismissal is swallowed so Share never throws or blocks. The handler gains a `sharing` state guard against double-taps and a matching `disabled` prop on the button; icon, label, and placement are untouched.

Watch for: the shared message string intentionally keeps the mobile app's existing `name – ₹price | 4A Store` format rather than copying the web's `name — 4A Store` caption (confirmed) — this is the correct reading of "only the shared URL changed," not a parity gap.

**Verdict**: APPROVED

## High-level view

The short-link resolution is isolated in a small `resolveShareUrl` helper with a two-level fallback: a null code and a thrown request both degrade to the canonical `/product/<id>` URL. The API call goes through the existing `api.get` client, so it inherits the correct base (`https://4astore.com/api`), the GET auto-retry, and the 401 refresh path for free; the envelope is unwrapped as `.data?.code`, matching how the rest of the app and the web storefront read it.

The success URL is built from `SITE_URL` out of config, so there is no second hardcoded host and the dev/prod origin stays consistent with the rest of the mobile app. Behaviour parity with the web `resolveShareUrl` is exact on endpoint, unwrapping, success shape (`/link/<code>`), and fallback shape (`/product/<id>`).

The blast radius is contained to the two files in scope: one new helper and the product screen's share handler. No intent filters, assetlinks, versionCode, dependencies, or unrelated screens were touched. There are no automated tests covering the helper, which is the one real gap, though the verification note's path trace covers the three branches by hand.

<details>
<summary>Issues (1)</summary>

1. **No test coverage for the share helper** (likely) — `resolveShareUrl`'s three branches (code present, null code, thrown request) have no unit test; they are only hand-traced in the verification note. Non-blocking given the small surface and the type-check pass, but a short test would lock the fallback behaviour in.

</details>

<details>
<summary>Details</summary>

### Short-link resolution and the two-level fallback

`resolveShareUrl` is the whole behavioural change. It asks the API for a code, and only a non-empty code produces the smart link:

```ts
async function resolveShareUrl(product: Product): Promise<string> {
  try {
    const code = (await api.get(`/products/${product.id}/short-link`)).data?.code as string | null;
    if (code) return `${SITE_URL}/link/${code}`;
  } catch {
    /* fall through to canonical */
  }
  return `${SITE_URL}/product/${product.id}`;
}
```

Two distinct failure modes collapse to the same safe result. A `{ success: true, data: { code: null } }` envelope leaves `code` null, the `if (code)` guard is false, and control falls to the canonical return. A network error, timeout, or non-OK envelope makes `api.get` throw an `ApiError`, which the `catch` absorbs and again falls to the canonical return. Both are fail-open toward a working share, which is the right posture for a share button — a missing short code should never deny the user the ability to share at all.

`shareProduct` then wraps the actual share-sheet call in its own `try/catch`, so a user dismissing the sheet (which rejects on some platforms) does not surface as an error. Combined with the `resolveShareUrl` fallback, the public `shareProduct` promise resolves in every path and never rejects, satisfying the "never throws, never blocks" requirement.

### API-client usage matches app conventions

The leading-slash path `/products/<id>/short-link` is joined onto `API_BASE` (`https://4astore.com/api`) by `buildUrl`, giving `https://4astore.com/api/products/<id>/short-link`. The client returns the parsed envelope directly — it does not unwrap `data` — so reading `.data?.code` at the call site is the correct convention, identical to the web's `fetchProductShortLink` which reads `.data.code`. The mobile version's optional chaining is marginally more defensive but behaviourally equivalent.

Routing through `api.get` rather than a bare `fetch` means the short-link request inherits the client's GET auto-retry on a transient blip and the single-flight 401 refresh, so a logged-in user with a momentarily stale token still resolves a code instead of silently falling back.

### Origin derived from config, no second host

The success URL uses `${SITE_URL}` from `src/config.ts`, where `SITE_URL` resolves `extra.siteUrl` (default `https://4astore.com`) with any trailing slash stripped. There is no second hardcoded host in the helper; both the smart link and the fallback share the same origin. This matches the web's `SITE_ORIGIN` derivation in spirit — the web picks `window.location.origin` at runtime and the mobile app has no window, so config is the correct source.

### Web parity

The mobile `resolveShareUrl` is a line-for-line analogue of the web's: same endpoint, same `.data.code` unwrap, same `${origin}/link/${code}` on success and `${origin}/product/${id}` on fallback, same swallow-on-dismiss around the share call. The web additionally exposes WhatsApp/Copy fallbacks when the Web Share API is absent, but that is a browser concern with no mobile equivalent — React Native's `Share.share` is always available — so its omission is correct, not a gap.

The shared message text diverges deliberately: web shares a `title`/`text`/`url` triple with caption `name — 4A Store`, while mobile keeps its pre-existing single `message` string `name – ₹price | 4A Store\n<url>`. The task scope is explicit that only the shared URL changed, so preserving the app's established message format is the intended behaviour.

### Button UX and double-tap guard

The button keeps its exact icon, label (`🔗 Share / शेयर करें`), outline style, and placement. The additions are a `sharing` state plus `disabled={sharing}` to block a second share sheet while the fetch is in flight, released in a `finally` so a dismissed share re-enables the button. The now-unused `Share` and `SITE_URL` imports in the screen are correctly dropped.

### Scope

The diff touches only `src/share.ts` (new) and `app/product/[id].tsx`. No deep-link intent filters, assetlinks, `app.config.ts` versionCode, dependencies, or other screens were modified, matching the scope constraint. The verification note was taken at face value per instructions; its reported type-check pass (`npx tsc --noEmit`, exit 0) and the absence of any lint config were not re-run.

### Test coverage

Not tested: there is no unit test for `resolveShareUrl`. The code-present, null-code, and thrown-request branches are covered only by the hand-written path trace in the verification note. Given the helper is a dozen lines with a clear fallback and the type-check passed, this is non-blocking, but a small test mocking `api.get` for the three cases would prevent a future regression in the fallback logic.

</details>

<details>
<summary>File map</summary>

- `4astore-v2/mobile/src/share.ts` (new) — `shareProduct` + `resolveShareUrl` helper that fetches the short code and builds `/link/<code>` with `/product/<id>` fallback.
- `4astore-v2/mobile/app/product/[id].tsx` — share handler delegates to `shareProduct`; adds `sharing` guard + `disabled`; drops now-unused `Share`/`SITE_URL` imports.

Full diff: `git diff main` on branch `mobile-share-smartlink`.

</details>
