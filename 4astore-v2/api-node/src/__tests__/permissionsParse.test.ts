/**
 * Permissions read-path regression tests (hypothesis-2 guard).
 *
 * A plausible-but-wrong theory for the admin 403 was that a stored permissions
 * value (a JSON *string* like '["products","users"]') was never parsed into an
 * array, so hasPermission saw an empty/garbage list. These tests pin the two
 * read paths that turn a stored value into the string[] authorisation reads
 * from, so a future edit can't silently reintroduce that failure:
 *
 *   - normalizePerms (routes/pos-auth.ts): the raw-SQL admin_phones path. Must
 *     parse a JSON string, pass an array through, and map null/garbage to [],
 *     filtered to the ALLOWED_PERMS set.
 *   - toClaims (auth/session.ts): the Prisma `Json` column path. The Prisma
 *     typed read already returns a JS array, so toClaims keeps an array and maps
 *     a non-array to [] — documenting why the DB read is safe as-is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePerms } from '../routes/pos-auth';
import { toClaims } from '../auth/session';

// --------------------------------------------------------------------------
// normalizePerms — the raw-SQL admin_phones permissions normaliser.
// --------------------------------------------------------------------------
test('normalizePerms parses a stored JSON STRING into a filtered string[]', () => {
  assert.deepEqual(normalizePerms('["products","users"]'), ['products', 'users']);
});

test('normalizePerms passes an array value through (filtered to allowed keys)', () => {
  assert.deepEqual(normalizePerms(['products', 'users']), ['products', 'users']);
});

test('normalizePerms drops keys outside ALLOWED_PERMS (string and array forms)', () => {
  assert.deepEqual(normalizePerms('["products","not_a_perm","users"]'), ['products', 'users']);
  assert.deepEqual(normalizePerms(['products', 'bogus', 'users']), ['products', 'users']);
});

test('normalizePerms de-duplicates repeated keys', () => {
  assert.deepEqual(normalizePerms('["products","products","users"]'), ['products', 'users']);
});

test('normalizePerms maps null / malformed JSON / non-array to []', () => {
  assert.deepEqual(normalizePerms(null), []);
  assert.deepEqual(normalizePerms(undefined), []);
  assert.deepEqual(normalizePerms('not json'), []); // malformed JSON string
  assert.deepEqual(normalizePerms('{"a":1}'), []); // valid JSON but not an array
  assert.deepEqual(normalizePerms(123), []);
});

// --------------------------------------------------------------------------
// toClaims — the Prisma `Json` column read path. Prisma returns an array for a
// JSON array column, so toClaims keeps it; anything non-array -> [].
// --------------------------------------------------------------------------
function userRow(permissions: unknown) {
  return {
    id: 7n,
    role: 'admin',
    mobile: '9876543210',
    username: 'teammate',
    name: 'Teammate',
    permissions,
    backend_rider: false,
  };
}

test('toClaims keeps an array permissions value (the Prisma Json read)', () => {
  const c = toClaims(userRow(['products', 'users']));
  assert.deepEqual(c.permissions, ['products', 'users']);
  assert.equal(c.role, 'admin');
  assert.equal(c.sub, 7);
});

test('toClaims maps a non-array permissions value to [] (never crashes authz)', () => {
  for (const bad of [null, undefined, '["products"]', 'garbage', {}, 5]) {
    const c = toClaims(userRow(bad));
    assert.deepEqual(c.permissions, [], `permissions ${JSON.stringify(bad)} -> []`);
  }
});
