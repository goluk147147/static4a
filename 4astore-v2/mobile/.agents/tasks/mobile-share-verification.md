# Mobile Share → Universal Smart Short-Link — Verification

## Goal
When a user taps **Share** on a product in the APP, share the smart short link
`https://4astore.com/link/<code>` (same as the web storefront), NOT the raw
`https://4astore.com/product/<id>`. On genuine failure, fall back to the raw product URL so
Share never throws or blocks.

## Files changed
- `src/share.ts` (new) — `shareProduct(product)` helper.
- `app/product/[id].tsx` — `share` handler now calls `shareProduct`; removed the inline
  `Share.share(...)` + `SITE_URL` wiring; dropped the now-unused `Share` / `SITE_URL` imports;
  added a `sharing` double-tap guard and `disabled={sharing}` on the Share button.

No other screens, deep-link intent filters, assetlinks, dependencies, or
`app.config.ts` versionCode were touched.

## Helper source (`src/share.ts`)
```ts
import { Share } from 'react-native';
import { api } from './api';
import { SITE_URL } from './config';
import type { Product } from './types';

export async function shareProduct(product: Product): Promise<void> {
  const url = await resolveShareUrl(product);
  try {
    await Share.share({ message: `${product.name} – ₹${product.price} | 4A Store\n${url}` });
  } catch {
    /* user dismissed the share sheet — ignore */
  }
}

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

## Handler source (`app/product/[id].tsx`)
```tsx
const [sharing, setSharing] = useState(false);
const share = async () => {
  if (sharing) return; // guard against double-taps
  setSharing(true);
  try {
    await shareProduct(product);
  } finally {
    setSharing(false);
  }
};
...
<Button title="🔗 Share / शेयर करें" outline onPress={share} disabled={sharing} style={{ marginTop: space.md }} />
```

## Path trace
- **Success path**: `api.get('/products/<id>/short-link')` resolves the envelope
  `{ success: true, data: { code: "<base62>" } }`. We read `.data?.code`; a non-empty `code`
  builds `${SITE_URL}/link/<code>` → shared message is
  `"<name> – ₹<price> | 4A Store\nhttps://4astore.com/link/<code>"`.
- **Fallback path (null code)**: endpoint returns `{ success: true, data: { code: null } }` →
  `code` is `null`, the `if (code)` guard is false → returns `${SITE_URL}/product/<id>`.
- **Fallback path (network / API error)**: `api.get` throws `ApiError` (or network error) →
  caught by the `try/catch` → returns `${SITE_URL}/product/<id>`.
- In all three cases `Share.share(...)` is called; its own throw (sheet dismissed) is swallowed,
  so Share never blocks the UI and the handler never rejects.

## API-client parity with `src/api.ts`
- `src/api.ts` defines `api.get = (path, params) => api(path, { method: 'GET', params })`.
- `api()` returns the parsed JSON envelope directly (`return data as T;`), it does NOT unwrap
  `data`. So the caller reads `.data.code` itself — exactly what the web does.
- Base URL: `API_BASE = extra.apiBase` (= `https://4astore.com/api`), joined by `buildUrl` with the
  leading-slash path → final URL `https://4astore.com/api/products/<id>/short-link`. Correct method
  (GET) and path (`/products/:id/short-link` relative to the API base, per spec).

## Web implementation mirrored (`web/src/pages/ProductDetails.tsx`)
The web `resolveShareUrl` + `fetchProductShortLink` (`web/src/lib/admin.ts`):
```ts
// admin.ts
export async function fetchProductShortLink(id: number): Promise<string | null> {
  return (await api.get(`/products/${id}/short-link`)).data.code as string | null;
}
// ProductDetails.tsx
async function resolveShareUrl(): Promise<string> {
  try {
    const code = await fetchProductShortLink(product!.id);
    if (code) return `${SITE_ORIGIN}/link/${code}`;
  } catch {
    /* fall through to canonical */
  }
  return `${SITE_ORIGIN}/product/${product!.id}`;
}
```
The mobile helper matches: same endpoint, same `.data.code` unwrap, same
`<origin>/link/<code>` success + `<origin>/product/<id>` fallback. Origin is derived from
`SITE_URL` (config), not a second hardcoded host.

## Commands run
- `node_modules` was missing → `npm install --no-audit --no-fund` (added 869 packages, exit 0).
- Type-check: `npx tsc --noEmit` → exit 0, **no errors** (touched files clean, no new errors).
- ESLint: no eslint config and no `lint` script in `package.json` → nothing to run.
- Runtime behaviour (native Share sheet / live API) cannot be exercised headlessly; correctness is
  proven by the code walkthrough above.
