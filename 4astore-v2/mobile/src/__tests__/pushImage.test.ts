// Unit tests for the pure promo-full-screen-image helpers (src/pushPayload.ts).
// Proves a customer promo with an https image opens the in-app full-screen screen while order /
// rider pushes keep their existing deep-link routing untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPromoImagePush, promoRoute } from '../pushPayload.ts';

test('promo with https image + no type -> true, route built', () => {
  const data = { image: 'https://cdn.4astore.com/sale.jpg' };
  assert.equal(isPromoImagePush(data), true);
  assert.equal(promoRoute(data), '/promo/' + encodeURIComponent(data.image));
});

test('promo with link -> route carries encoded link', () => {
  const data = { image: 'https://cdn.4astore.com/sale.jpg', link: '/products?category=diwali' };
  assert.equal(isPromoImagePush(data), true);
  assert.equal(
    promoRoute(data),
    '/promo/' + encodeURIComponent(data.image) + '?link=' + encodeURIComponent(data.link),
  );
});

test('new_order with image -> false, no route', () => {
  const data = { type: 'new_order', image: 'https://cdn.4astore.com/x.jpg' };
  assert.equal(isPromoImagePush(data), false);
  assert.equal(promoRoute(data), null);
});

test('rider_assigned with image -> false', () => {
  const data = { type: 'rider_assigned', image: 'https://cdn.4astore.com/x.jpg' };
  assert.equal(isPromoImagePush(data), false);
  assert.equal(promoRoute(data), null);
});

test('order_status with image -> false', () => {
  const data = { type: 'order_status', image: 'https://cdn.4astore.com/x.jpg' };
  assert.equal(isPromoImagePush(data), false);
  assert.equal(promoRoute(data), null);
});

test('non-https (http) image -> false', () => {
  const data = { image: 'http://cdn.4astore.com/x.jpg' };
  assert.equal(isPromoImagePush(data), false);
  assert.equal(promoRoute(data), null);
});

test('no image -> false', () => {
  assert.equal(isPromoImagePush({ type: 'promo', link: '/products' }), false);
  assert.equal(promoRoute({ type: 'promo', link: '/products' }), null);
});

test('undefined data -> false, null', () => {
  assert.equal(isPromoImagePush(undefined), false);
  assert.equal(promoRoute(undefined), null);
});
