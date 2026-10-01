/**
 * Banner/ad/festival links in the DB still use the old static-site URLs
 * ("products.html?category=x", "checkout.html", "cart.html"). Map them to SPA routes.
 */
const ROUTES: Record<string, string> = {
  '': '/',
  'index.html': '/',
  products: '/products',
  'products.html': '/products',
  'cart.html': '/cart',
  cart: '/cart',
  'checkout.html': '/checkout',
  'order-history': '/orders',
  'order-history.html': '/orders',
  profile: '/profile',
  'profile.html': '/profile',
  'product-details': '/product',
  'product-details.html': '/product',
};

export function legacyToRoute(link: string | undefined, fallback = '/products'): string {
  if (!link) return fallback;
  if (/^(https?:|mailto:|tel:)/i.test(link)) return link;
  const [rawPath, query = ''] = link.replace(/^\.?\//, '').split('?');
  if (rawPath.startsWith('product-details')) {
    const id = new URLSearchParams(query).get('id');
    return id ? `/product/${id}` : '/products';
  }
  const route = ROUTES[rawPath] ?? `/${rawPath}`;
  return query ? `${route}?${query}` : route;
}

/** Original index.html dyn(): fill {{freeDeliveryAbove}} / {{deliveryCharge}} placeholders. */
export function fillDeliveryPlaceholders(text: string | undefined, freeDeliveryAbove: number, deliveryCharge: number): string {
  return String(text || '')
    .replace(/\{\{\s*freeDeliveryAbove\s*\}\}/g, String(freeDeliveryAbove))
    .replace(/\{\{\s*deliveryCharge\s*\}\}/g, String(deliveryCharge))
    .replace(/₹\s*500\+?/g, '₹' + freeDeliveryAbove);
}
