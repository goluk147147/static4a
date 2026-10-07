// Unit tests for the pure POST /addresses payload builder (src/addressPayload.ts).
// Proves the create/update decision and the fixed/derived fields match the shape
// checkout.tsx used to inline — no React, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAddressPayload, type AddressCustomer } from '../addressPayload.ts';

// Minimal valid customer factory (buildCustomer() output shape).
function cust(over: Partial<AddressCustomer> = {}): AddressCustomer {
  return {
    name: 'Asha',
    mobile: '9990001111',
    address: 'H-1',
    landmark: 'near school',
    city: 'Pune',
    pincode: '411001',
    deliveryLat: 12.34,
    deliveryLng: 56.78,
    ...over,
  };
}

test('no selectedId -> action "create" and id undefined', () => {
  const p = buildAddressPayload(cust(), 'Home', null);
  assert.equal(p.action, 'create');
  assert.equal(p.id, undefined);
});

test('negative selectedId -> action "create", id undefined (temp row never sent)', () => {
  const p = buildAddressPayload(cust(), 'Home', -17);
  assert.equal(p.action, 'create');
  assert.equal(p.id, undefined);
});

test('positive selectedId -> action "update", id equal to that value', () => {
  const p = buildAddressPayload(cust(), 'Work', 42);
  assert.equal(p.action, 'update');
  assert.equal(p.id, 42);
});

test('full_address composition joins address/city/pincode with ", " and skips empties', () => {
  const full = buildAddressPayload(cust({ address: 'B-7', city: 'Patna', pincode: '800001' }), 'Home', null);
  assert.equal(full.full_address, 'B-7, Patna, 800001');

  const sparse = buildAddressPayload(cust({ address: 'B-7', city: '', pincode: '800001' }), 'Home', null);
  assert.equal(sparse.full_address, 'B-7, 800001', 'empty city is skipped, no double comma');
});

test('district/state are the fixed "Aurangabad"/"Bihar"', () => {
  const p = buildAddressPayload(cust(), 'Other', null);
  assert.equal(p.district, 'Aurangabad');
  assert.equal(p.state, 'Bihar');
});

test('maps customer + label onto the payload fields', () => {
  const p = buildAddressPayload(cust({ name: 'Ravi', mobile: '8880002222', address: 'C-3', landmark: 'temple', city: 'Gaya', pincode: '823001', deliveryLat: 24.79, deliveryLng: 85.0 }), 'Work', 7);
  assert.equal(p.label, 'Work');
  assert.equal(p.receiver_name, 'Ravi');
  assert.equal(p.phone, '8880002222');
  assert.equal(p.house_no, 'C-3');
  assert.equal(p.landmark, 'temple');
  assert.equal(p.city, 'Gaya');
  assert.equal(p.pincode, '823001');
  assert.equal(p.latitude, 24.79);
  assert.equal(p.longitude, 85.0);
});
