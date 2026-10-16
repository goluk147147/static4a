import { Share } from 'react-native';
import { api } from './api';
import { SITE_URL } from './config';
import type { Product } from './types';

/**
 * Share a product via the UNIVERSAL SMART SHORT-LINK (https://4astore.com/link/<code>),
 * mirroring the web storefront (web/src/pages/ProductDetails.tsx). The short link opens
 * app-first → Play Store → website, so every shared link gets that behaviour.
 *
 * The short code is minted on demand by GET /api/products/:id/short-link.
 * The mobile `api()` returns the parsed JSON body directly (not an axios
 * `{ data }` wrapper), and the server envelope is FLAT — `ok(res, { code })`
 * yields `{ success: true, code }` — so the code lives at `res.code`, NOT
 * `res.data.code`. On null code / network error we FALL BACK to the raw
 * /product/<id> URL so Share never throws or blocks the UI.
 */
export async function shareProduct(product: Product): Promise<void> {
  const url = await resolveShareUrl(product);
  try {
    await Share.share({ message: `${product.name} – ₹${product.price} | 4A Store\n${url}` });
  } catch {
    /* user dismissed the share sheet — ignore */
  }
}

/** Resolve the smart short link, falling back to the canonical product URL. */
async function resolveShareUrl(product: Product): Promise<string> {
  try {
    const code = (await api.get(`/products/${product.id}/short-link`))?.code as string | null;
    if (code) return `${SITE_URL}/link/${code}`;
  } catch {
    /* fall through to canonical */
  }
  return `${SITE_URL}/product/${product.id}`;
}
