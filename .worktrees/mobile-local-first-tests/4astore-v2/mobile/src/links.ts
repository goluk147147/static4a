import { Linking } from 'react-native';
import type { Router } from 'expo-router';
import { SITE_URL } from './config';

// Banner/ad links in the DB still use old static URLs ("products.html?category=x") → app routes.
const ROUTES: Record<string, string> = {
  '': '/',
  'index.html': '/',
  products: '/products',
  'products.html': '/products',
  'cart.html': '/cart',
  cart: '/cart',
  'checkout.html': '/checkout',
  checkout: '/checkout',
  orders: '/orders',
  'order-history': '/orders',
  'order-history.html': '/orders',
  profile: '/profile',
  'profile.html': '/profile',
  'track.html': '/track',
  'privacy-policy': '/page/privacy-policy',
  'privacy-policy.html': '/page/privacy-policy',
  terms: '/page/terms',
  'terms.html': '/page/terms',
  'help-support': '/page/help-support',
  'help-support.html': '/page/help-support',
  'account-deletion': '/page/account-deletion',
  'account-deletion.html': '/page/account-deletion',
};

export function legacyToRoute(link: string | undefined, fallback = '/products'): string {
  if (!link) return fallback;
  let l = link.trim();
  // Links to our own site stay inside the app.
  const site = SITE_URL.replace(/^https?:\/\//, '');
  l = l.replace(new RegExp(`^https?://(www\\.)?${site.replace(/\./g, '\\.')}`, 'i'), '');
  if (/^(https?:|mailto:|tel:|upi:|whatsapp:)/i.test(l)) return l;
  const [rawPath, query = ''] = l.replace(/^\.?\//, '').split('?');
  if (rawPath.startsWith('product-details')) {
    const id = new URLSearchParams(query).get('id');
    return id ? `/product/${id}` : '/products';
  }
  if (rawPath.startsWith('track.html')) {
    const id = new URLSearchParams(query).get('orderId');
    return id ? `/track/${id}` : '/track';
  }
  if (rawPath.startsWith('admin')) {
    const view = new URLSearchParams(query).get('view');
    return view ? `/admin/order/${encodeURIComponent(view)}` : '/admin/orders';
  }
  const route = ROUTES[rawPath] ?? `/${rawPath}`;
  return query ? `${route}?${query}` : route;
}

/** Open an in-app route or an external URL. */
export function openLink(router: Router, link: string | undefined, fallback = '/products') {
  const to = legacyToRoute(link, fallback);
  if (/^[a-z]+:/i.test(to)) {
    Linking.openURL(to).catch(() => null);
    return;
  }
  router.push(to as never);
}

/** Fill {{freeDeliveryAbove}} / {{deliveryCharge}} placeholders. */
export function fillDeliveryPlaceholders(text: string | undefined, freeDeliveryAbove: number, deliveryCharge: number): string {
  return String(text || '')
    .replace(/\{\{\s*freeDeliveryAbove\s*\}\}/g, String(freeDeliveryAbove))
    .replace(/\{\{\s*deliveryCharge\s*\}\}/g, String(deliveryCharge))
    .replace(/₹\s*500\+?/g, '₹' + freeDeliveryAbove);
}
