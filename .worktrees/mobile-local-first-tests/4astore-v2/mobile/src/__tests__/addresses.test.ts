// Unit tests for the local-first saved-address store (src/store/addresses.ts).
// Proves "save address" and "address load" resolve INSTANTLY from local storage
// with ZERO network I/O on the read/optimistic-write path, and that background
// sync/flush never corrupt the instant local view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetMocks, apiCalls, setGet, setPost, seedRaw, readRaw } from './helpers.ts';
import {
  loadLocal,
  saveLocal,
  upsertLocal,
  syncFromServer,
  queuePending,
  flushPending,
  type PendingPayload,
} from '../store/addresses.ts';
import type { SavedAddress } from '../types.ts';

const KEY = (userId: number | string) => `4astore:addresses:v1:${userId}`;
const PENDING_KEY = (userId: number | string) => `4astore:addresses:pending:v1:${userId}`;

// Minimal valid SavedAddress factory.
function addr(over: Partial<SavedAddress> = {}): SavedAddress {
  return {
    id: 1,
    label: 'Home',
    receiver_name: 'Asha',
    phone: '9990001111',
    house_no: 'H-1',
    city: 'Pune',
    pincode: '411001',
    ...over,
  };
}

test.beforeEach(() => resetMocks());

// --- A1: loadLocal — address load always resolves instantly to a value --------
test('loadLocal returns [] when nothing is stored', async () => {
  const list = await loadLocal(42);
  assert.deepEqual(list, []);
  assert.equal(apiCalls().get, 0, 'loadLocal must not call the network');
});

test('loadLocal returns the stored array when present', async () => {
  const data = [addr({ id: 1 }), addr({ id: 2, label: 'Work' })];
  seedRaw(KEY(42), JSON.stringify(data));
  const list = await loadLocal(42);
  assert.deepEqual(list, data);
});

test('loadLocal returns [] on corrupt JSON (never throws/hangs)', async () => {
  seedRaw(KEY(42), '{not valid json');
  const list = await loadLocal(42);
  assert.deepEqual(list, []);
});

test('loadLocal returns [] when stored value is valid JSON but not an array', async () => {
  seedRaw(KEY(42), JSON.stringify({ foo: 'bar' }));
  const list = await loadLocal(42);
  assert.deepEqual(list, []);
});

// --- A2: saveLocal round-trip + per-user isolation ---------------------------
test('saveLocal then loadLocal round-trips under the correct per-user key', async () => {
  const data = [addr({ id: 7 })];
  await saveLocal(99, data);
  assert.ok(readRaw(KEY(99)), 'should write under the user-99 key');
  assert.deepEqual(await loadLocal(99), data);
});

test('addresses are isolated per userId (A does not leak into B)', async () => {
  await saveLocal('A', [addr({ id: 1, receiver_name: 'UserA' })]);
  await saveLocal('B', [addr({ id: 2, receiver_name: 'UserB' })]);
  assert.deepEqual((await loadLocal('A')).map((a) => a.receiver_name), ['UserA']);
  assert.deepEqual((await loadLocal('B')).map((a) => a.receiver_name), ['UserB']);
});

// --- A3: upsertLocal — optimistic instant save, no network -------------------
test('upsertLocal prepends a NEW address', async () => {
  await saveLocal(1, [addr({ id: 5 })]);
  const next = await upsertLocal(1, addr({ id: 6, receiver_name: 'New' }));
  assert.deepEqual(next.map((a) => a.id), [6, 5], 'new row goes to the front');
  assert.equal(next[0].receiver_name, 'New');
  assert.equal(apiCalls().post, 0, 'upsertLocal must not call the network');
  assert.equal(apiCalls().get, 0);
});

test('upsertLocal replaces an EXISTING id in place (length + order preserved)', async () => {
  await saveLocal(1, [addr({ id: 5, receiver_name: 'Old5' }), addr({ id: 9, receiver_name: 'Old9' })]);
  const next = await upsertLocal(1, addr({ id: 9, receiver_name: 'Updated9' }));
  assert.equal(next.length, 2, 'length unchanged on replace');
  assert.deepEqual(next.map((a) => a.id), [5, 9], 'order preserved');
  assert.equal(next[1].receiver_name, 'Updated9');
});

test('upsertLocal returns the new list and persists it', async () => {
  const next = await upsertLocal(1, addr({ id: 3 }));
  assert.deepEqual(next.map((a) => a.id), [3]);
  assert.deepEqual((await loadLocal(1)).map((a) => a.id), [3]);
});

// --- A4: syncFromServer — background refresh never corrupts local -------------
test('syncFromServer writes the server list to local and returns it on success', async () => {
  const server = [addr({ id: 11 }), addr({ id: 12 })];
  setGet(async () => ({ addresses: server }));
  const result = await syncFromServer(1);
  assert.deepEqual(result, server);
  assert.deepEqual(await loadLocal(1), server);
  assert.equal(apiCalls().get, 1, 'syncFromServer is the only read that touches the network');
});

test('syncFromServer returns null and leaves local data intact on api.get throw', async () => {
  const existing = [addr({ id: 1, receiver_name: 'Keep' })];
  await saveLocal(1, existing);
  setGet(async () => {
    throw new Error('network down');
  });
  const result = await syncFromServer(1);
  assert.equal(result, null);
  assert.deepEqual(await loadLocal(1), existing, 'existing local view is untouched');
});

test('syncFromServer defaults to [] when server omits addresses', async () => {
  setGet(async () => ({}));
  const result = await syncFromServer(1);
  assert.deepEqual(result, []);
});

// --- A5: queuePending + flushPending — offline queue then reconcile ----------
function createPayload(over: Partial<PendingPayload> = {}): PendingPayload {
  return {
    action: 'create',
    id: undefined,
    label: 'Home',
    receiver_name: 'Asha',
    phone: '9990001111',
    house_no: 'H-1',
    city: 'Pune',
    pincode: '411001',
    ...over,
  };
}

test('flushPending returns null and keeps the queue while offline (api.post throws)', async () => {
  await queuePending(1, createPayload({ phone: '111' }));
  await queuePending(1, createPayload({ phone: '222' }));
  setPost(async () => {
    throw new Error('offline');
  });
  const result = await flushPending(1);
  assert.equal(result, null);
  const queued = JSON.parse(readRaw(PENDING_KEY(1)) || '[]') as PendingPayload[];
  assert.equal(queued.length, 2, 'both payloads stay queued');
});

test('flushPending posts queued payloads, reconciles real id over matching NEG temp row, clears queue', async () => {
  // Seed an optimistic temp row with a negative id that matches the payload by phone+house_no+pincode.
  await saveLocal(1, [addr({ id: -123, phone: '9876543210', house_no: 'B-7', pincode: '560001', receiver_name: 'Temp' })]);
  await queuePending(
    1,
    createPayload({ phone: '9876543210', house_no: 'B-7', pincode: '560001', receiver_name: 'Real' })
  );

  const serverRow = addr({ id: 500, phone: '9876543210', house_no: 'B-7', pincode: '560001', receiver_name: 'Real' });
  setPost(async () => ({ address: serverRow }));

  const result = await flushPending(1);
  assert.ok(result, 'returns the final local list on full success');
  const ids = (result as SavedAddress[]).map((a) => a.id);
  assert.deepEqual(ids, [500], 'temp -123 replaced by server id 500');
  assert.ok(!ids.includes(-123), 'temp id is gone');
  assert.equal(readRaw(PENDING_KEY(1)), undefined, 'queue cleared on full success');
});

test('flushPending posts a create payload with id undefined (never a negative temp id)', async () => {
  await saveLocal(1, [addr({ id: -5, phone: '555', house_no: 'X', pincode: '000' })]);
  await queuePending(1, createPayload({ phone: '555', house_no: 'X', pincode: '000' }));
  setPost(async () => ({ address: addr({ id: 42, phone: '555', house_no: 'X', pincode: '000' }) }));

  await flushPending(1);
  const posted = apiCalls().postBodies[0] as PendingPayload;
  assert.equal(posted.id, undefined, 'create payload id must be undefined, never the negative temp id');
});

test('flushPending returns null when the queue is empty', async () => {
  assert.equal(await flushPending(1), null);
  assert.equal(apiCalls().post, 0);
});

// --- A6: reconcileTemp fallback — exercised through flushPending --------------
// reconcileTemp (private) is reached via flushPending. When NO phone+house_no+pincode
// match exists, the code falls back to:
//   temps.reduce((oldest, a) => (!oldest || a.id > oldest.id ? a : oldest), undefined)
// Among negative ids, `a.id > oldest.id` keeps the LEAST-negative id (closest to zero).
// So with temps -300, -100, -200 the reducer selects -100 and replaces THAT row.
test('reconcileTemp fallback replaces the least-negative temp id when no field match', async () => {
  await saveLocal(1, [
    addr({ id: -300, phone: 'aaa', house_no: 'A', pincode: '100', receiver_name: 't-300' }),
    addr({ id: -100, phone: 'bbb', house_no: 'B', pincode: '200', receiver_name: 't-100' }),
    addr({ id: -200, phone: 'ccc', house_no: 'C', pincode: '300', receiver_name: 't-200' }),
  ]);
  // Payload fields match NONE of the temp rows → forces the reducer fallback.
  await queuePending(1, createPayload({ phone: 'zzz', house_no: 'Z', pincode: '999' }));
  const serverRow = addr({ id: 777, phone: 'zzz', house_no: 'Z', pincode: '999', receiver_name: 'server' });
  setPost(async () => ({ address: serverRow }));

  const result = (await flushPending(1)) as SavedAddress[];
  const ids = result.map((a) => a.id);
  // -100 (least negative) is the one replaced by 777; -300 and -200 remain.
  assert.ok(ids.includes(777), 'server row inserted');
  assert.ok(!ids.includes(-100), 'least-negative temp (-100) was replaced');
  assert.ok(ids.includes(-300), '-300 remains');
  assert.ok(ids.includes(-200), '-200 remains');
  assert.deepEqual(ids.slice().sort((a, b) => a - b), [-300, -200, 777].sort((a, b) => a - b));
});

// --- C: non-blocking contract — the crux of "instant" ------------------------
test('the local read/write path performs ZERO network I/O', async () => {
  await saveLocal(1, [addr({ id: 1 })]);
  await loadLocal(1);
  await upsertLocal(1, addr({ id: 2 }));
  await queuePending(1, createPayload());
  assert.equal(apiCalls().get, 0, 'no GET on the local path');
  assert.equal(apiCalls().post, 0, 'no POST on the local path');
});
