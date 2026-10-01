# 4AStore v2 — Laravel Admin API

Admin management API for 4AStore. Uses the **same MySQL database** as the Node API
(identical tables) and verifies the **same JWT** the Node API issues (shared `JWT_SECRET`),
so an admin logged in through Node/React is trusted here too.

## What it exposes (`/api/admin/...`)

| Method | Path | Permission | Purpose |
|--------|------|-----------|---------|
| GET  | `/admin/orders` | orders | list all orders |
| POST | `/admin/orders/status` | orders | update order status (pushes customer) |
| POST | `/admin/orders/delete` | orders | delete an order |
| POST | `/admin/products` | products | add / update / delete (auto-discount) |
| POST | `/admin/categories` | categories | add / update / delete |
| POST | `/admin/settings` | settings | update store settings |
| POST | `/admin/banners` | banners | replace homepage banners |
| POST | `/admin/announcement` | ads | save announcement (auto-bumps id) |
| POST | `/admin/push/send` | ads | broadcast push (forwards to Node FCM) |
| GET  | `/admin/users` | users | list users |
| POST | `/admin/assignRole` | owner only | **assign role to a user by mobile number** |

All responses use the shared envelope `{ success, message, ... }`.

## Auth model

- No separate login here — the React admin UI logs in via the **Node API** (`/api/users/login`),
  gets a JWT, and sends it as `Authorization: Bearer <token>` to these Laravel routes.
- `App\Support\JwtGuard` verifies the token with `firebase/php-jwt` using the shared `JWT_SECRET`.
- `admin.jwt:<permission>` middleware enforces owner/superadmin, or admin-with-permission.

## Setup

> This folder contains the app source (controllers, models, routes, middleware). To turn it
> into a full runnable Laravel app on your machine:

1. Install the framework files (needs Composer + internet):
   ```powershell
   composer install
   ```
   If starting fresh, you can also `composer create-project laravel/laravel .` in a temp dir and
   copy these `app/`, `routes/`, `composer.json` files over.

2. Configure env:
   ```powershell
   Copy-Item .env.example .env
   php artisan key:generate
   # set DB_* to four_a_store and JWT_SECRET to match the Node API
   ```

3. Register the API routes + middleware:
   - `routes/api.php` is included by Laravel automatically.
   - `app/Http/Kernel.php` registers the `admin.jwt` alias.
   - Add `NODE_PUSH_URL=http://localhost:4000/api/push/send` to `.env` to forward pushes to FCM.

4. Serve:
   ```powershell
   php artisan serve --port=8000
   ```

The React admin UI (in `../web`) can point at this by setting its admin base URL to
`http://localhost:8000/api` (or keep everything on Node — both share the DB, so either backend
can serve the admin writes; this Laravel service exists to satisfy the Node+Laravel split).

## Notes

- Migrations are NOT included because the schema is owned by `../db/schema.sql` (single source of
  truth shared with Node). Point Laravel at that DB; do not re-migrate.
- Uses `spatie/laravel-permission` in composer for future role UI, but the JWT claims already
  carry `role` + `permissions`, which the middleware uses directly.
