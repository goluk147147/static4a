/**
 * Router-mount regression test for the "Owner access required" 403-on-every-
 * admin-endpoint bug.
 *
 * THE LIVE BUG: admin-data.ts does `router.use(requireAuth, requireOwner)` at
 * the router level, so that owner gate runs on EVERY request the router
 * receives, regardless of sub-path. It was mounted in server.ts with
 * `app.use('/api/admin', adminDataRouter)` — the BARE /api/admin prefix — so the
 * owner gate fired on ALL /api/admin/* calls (products, users, stats, pos…)
 * before the generic adminRouter's requireStaff gate was ever reached. Result:
 * every NON-owner admin got a bogus 403 {message:"Owner access required"} on
 * every page, exactly the reported symptom.
 *
 * THE FIX: mount the owner-gated data router on its SPECIFIC prefix
 * (`/api/admin/data`) so its gate is scoped to the data tools only.
 *
 * These tests reproduce both mounts against a real (in-memory) Express app with
 * no DB: an owner-gated sub-router and a generic staff router, wired the same
 * way server.ts wires them. They assert the leak happens on the bare-prefix
 * mount and does NOT happen on the specific-prefix mount — so a future edit that
 * re-broadens the mount fails here instead of in production.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { AddressInfo } from 'node:net';
import { requireOwner, requireStaff } from '../auth/middleware';
import type { AccessClaims } from '../auth/jwt';

/** Inject a fixed authenticated user so we test routing, not token parsing. */
function withUser(user: AccessClaims) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.user = user;
    next();
  };
}

const admin: AccessClaims = {
  sub: 22,
  role: 'admin',
  mobile: '8252241400',
  username: 'akgupta',
  name: 'akgupta',
  permissions: ['dashboard', 'products', 'users', 'orders'],
};

/**
 * Build an app that mounts an owner-gated "data" router and the generic admin
 * router (here just a /users route gated by requireStaff('users')) the way
 * server.ts does, parameterised by the data router's mount path. Returns a
 * started server plus a helper to GET a path and read status + json body.
 */
async function buildApp(dataMountPath: string) {
  const app = express();
  app.use(express.json());
  app.use(withUser(admin));

  // Owner-only data router — gates EVERY request it receives (router-level use),
  // identical in shape to routes/admin-data.ts.
  const dataRouter = express.Router();
  dataRouter.use(requireOwner);
  dataRouter.get('/status', (_req, res) => res.json({ success: true, data: 'owner-only' }));

  // Generic admin router — the real /users guard.
  const adminRouter = express.Router();
  adminRouter.get('/users', requireStaff('users'), (_req, res) => res.json({ success: true, data: 'user-list' }));

  app.use(dataMountPath, dataRouter);
  app.use('/api/admin', adminRouter);

  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;

  const get = async (path: string) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = (await res.json()) as { success: boolean; message?: string; data?: string };
    return { status: res.status, body };
  };

  return { get, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('REPRODUCE bug: bare /api/admin mount leaks the owner gate onto /users', async () => {
  const app = await buildApp('/api/admin');
  try {
    const r = await app.get('/api/admin/users');
    // The owner-gated data router runs first on the shared prefix and 403s the
    // admin before requireStaff('users') is ever reached — the live symptom.
    assert.equal(r.status, 403);
    assert.equal(r.body.message, 'Owner access required');
  } finally {
    await app.close();
  }
});

test('FIX: specific /api/admin/data mount lets an admin reach /users (200)', async () => {
  const app = await buildApp('/api/admin/data');
  try {
    const users = await app.get('/api/admin/users');
    assert.equal(users.status, 200, 'admin with users perm must reach the generic router');
    assert.equal(users.body.success, true);
    assert.equal(users.body.data, 'user-list');

    // The owner-only tool is still owner-gated on its own prefix: an admin is
    // correctly refused there (and ONLY there).
    const data = await app.get('/api/admin/data/status');
    assert.equal(data.status, 403);
    assert.equal(data.body.message, 'Owner access required');
  } finally {
    await app.close();
  }
});
