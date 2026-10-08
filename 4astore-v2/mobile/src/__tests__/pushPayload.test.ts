// Unit tests for the pure push-payload normaliser (src/pushPayload.ts).
// Proves every deployed FCM payload shape resolves to a displayable { title, body, channelId }
// so a notification is never dropped or shown with raw JSON / empty text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePush } from '../pushPayload.ts';

test('NEW flat data payload -> read directly', () => {
  const out = normalizePush({ title: 'Order shipped', body: 'On the way', channelId: 'orders', link: '/track/4AX' });
  assert.equal(out.title, 'Order shipped');
  assert.equal(out.body, 'On the way');
  assert.equal(out.channelId, 'orders');
  assert.equal(out.link, '/track/4AX');
});

test('OLD expo payload (message + JSON body) -> message becomes body, JSON keys lifted out', () => {
  const out = normalizePush({
    title: 'New order',
    message: 'Order #4AX from Rahul',
    channelId: 'orders',
    body: JSON.stringify({ link: '/admin/orders?view=4AX', type: 'new_order', orderId: '4AX' }),
  });
  assert.equal(out.title, 'New order');
  assert.equal(out.body, 'Order #4AX from Rahul', 'message must fall back into body');
  assert.equal(out.link, '/admin/orders?view=4AX', 'link must be lifted from the JSON blob');
  assert.equal(out.type, 'new_order');
  assert.equal(out.orderId, '4AX');
  assert.ok(!out.body.includes('{'), 'raw JSON must never be shown as the body text');
});

test('notification-type message -> title/body/channel read from the notification block', () => {
  const out = normalizePush(
    { link: '/track/4AX', type: 'order_status' },
    { title: 'Delivered', body: 'Enjoy!', android: { channelId: 'default', imageUrl: 'https://x/y.png' } },
  );
  assert.equal(out.title, 'Delivered');
  assert.equal(out.body, 'Enjoy!');
  assert.equal(out.channelId, 'default');
  assert.equal(out.image, 'https://x/y.png');
  assert.equal(out.link, '/track/4AX');
});

test('channelId defaults to "default" when absent', () => {
  assert.equal(normalizePush({ title: 'Hi', body: 'There' }).channelId, 'default');
});

test('empty/undefined payload -> empty title and body (caller skips display)', () => {
  const out = normalizePush(undefined);
  assert.equal(out.title, '');
  assert.equal(out.body, '');
  assert.equal(out.channelId, 'default');
});

test('malformed JSON body is treated as plain text, never throws', () => {
  const out = normalizePush({ title: 'T', body: '{not valid json' });
  assert.equal(out.title, 'T');
  assert.equal(out.body, '{not valid json');
});

test('flat data wins over the notification block when both carry title/body', () => {
  const out = normalizePush({ title: 'DataTitle', body: 'DataBody' }, { title: 'NotifTitle', body: 'NotifBody' });
  assert.equal(out.title, 'DataTitle');
  assert.equal(out.body, 'DataBody');
});

test('non-string data values are coerced to strings', () => {
  const out = normalizePush({ title: 'N', body: 'B', total: 499 as unknown as string, orderId: 4021 as unknown as string });
  assert.equal(out.total, '499');
  assert.equal(out.orderId, '4021');
});
