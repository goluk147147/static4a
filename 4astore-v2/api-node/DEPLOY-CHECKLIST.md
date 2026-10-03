# API Deploy Checklist (EC2 → pm2 app `4astore-api`)

Consolidated list of EVERY pending `api-node` change to ship. The app lives at
`/var/www/html/api-node` and runs under pm2 as `4astore-api`.

> Do **NOT** `git commit` / `git push` as part of this. These are manual upload +
> build + restart steps on the server.

## 1. Upload changed/new source files

Source files touched across the perf pass + this batch (OG / feature flags / TTL
cache):

- `src/db.ts` — Prisma singleton + pool reuse
- `src/middleware/timing.ts` — `DEBUG_TIMING` request timing (no-op unless enabled)
- `src/server.ts` — mounts the new `/api/og` router
- `src/routes/catalog.ts` — `Cache-Control`, 10s in-memory TTL cache on `/config` + `/settings`, `config.features`
- `src/routes/orders.ts` — perf pass
- `src/routes/admin.ts` — new `POST /api/admin/features`
- `src/routes/og.ts` — **NEW** OG share HTML + image routes
- `src/services/og.ts` — **NEW** OG image generator (@napi-rs/canvas, ≤100 KB)
- `src/utils/osrm.ts` — OSRM route cache
- `src/utils/features.ts` — **NEW** shared feature-flag defaults/merge
- `prisma/schema.prisma` — current schema (no destructive change)
- `assets/og-logo.png` — **NEW** logo raster for the OG logo-fallback card

> Make sure `assets/` ships (it is read at runtime by `src/services/og.ts`). The
> `uploads/og/` cache dir is created automatically on first request.

## 2. Run the SQL on the live DB (in this order)

All three are ADD-only, guarded via `information_schema`, and safe to re-run.

```bash
mysql -u <user> -p four_a_store < prisma/perf-indexes.sql
mysql -u <user> -p four_a_store < prisma/charges-settings.sql
mysql -u <user> -p four_a_store < prisma/features-column.sql
```

- `prisma/perf-indexes.sql` — adds `idx_orders_user`, `idx_orders_date`, `idx_tracking_order`
- `prisma/charges-settings.sql` — adds `handling_charge`, `delivery_charge_enabled`, `handling_charge_enabled`, `staff_order_alerts_enabled` to `settings`
- `prisma/features-column.sql` — adds `features` LONGTEXT to `config`

(No separate "OG cache SQL" exists — OG images cache to disk under `uploads/og/`,
not the DB.)

## 3. `.env` additions

Append pool params to `DATABASE_URL` so Prisma caps live connections:

```
DATABASE_URL="mysql://<user>:<pass>@<host>:3306/four_a_store?connection_limit=10&pool_timeout=20"
```

Optional OG origin overrides (default `https://4astore.com`):

```
PUBLIC_SITE_URL=https://4astore.com
PUBLIC_API_URL=https://4astore.com/api
```

## 4. Build

```bash
cd /var/www/html/api-node
npm install            # only if dependencies changed
npm run build          # tsc -p tsconfig.json → dist/
```

> Caveat: if `dist/` was ever created by root (e.g. a sudo build), the next build
> can hit EACCES. Fix ownership first:
>
> ```bash
> sudo chown -R $(whoami):$(whoami) dist
> ```

## 5. Restart pm2 (pick up new env)

```bash
pm2 restart 4astore-api --update-env
pm2 logs 4astore-api --lines 50   # confirm clean boot
```

## 6. nginx (OG crawler rewrite)

Follow **OG-SETUP.md** to add the `map $http_user_agent $is_crawler` block and the
`/product/:id` + `/page/:slug` crawler rewrites, then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 7. Smoke test

```bash
curl -s https://4astore.com/api/config | grep -o '"features":{[^}]*}'
curl -sI https://4astore.com/api/og/image/product/1 | grep -i -E 'content-type|content-length'
curl -A "WhatsApp/2.0" https://4astore.com/product/1 | grep -i 'og:'
```
