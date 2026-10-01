# 4AStore v2 — Node.js API (customer + rider + public)

Express + TypeScript + Prisma + MySQL, with **JWT auth** and **life-long login** (short access token in an HttpOnly cookie + ~1-year refresh token stored hashed in the DB, silent-refreshed).

This is the customer/rider/public API. The Laravel admin API talks to the **same MySQL database**.

## Endpoints (so far)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET  | `/api/health` | — | service check |
| POST | `/api/otp/send` | — | email a 6-digit signup OTP (returns `devOtp` in dev) |
| POST | `/api/users/register` | — | register customer (needs OTP), issues JWT |
| POST | `/api/users/login` | — | login by username or mobile, issues JWT |
| POST | `/api/users/refresh` | cookie | rotate access token (keeps login alive) |
| GET  | `/api/users/session` | JWT | current user |
| POST | `/api/users/logout` | — | revoke refresh token |
| POST | `/api/users/deleteSelf` | JWT | delete own account |
| GET  | `/api/products` `/api/products/:id` | — | product catalog |
| GET  | `/api/categories` | — | categories |
| GET  | `/api/settings` | — | public store settings |
| GET  | `/api/config` | — | banners / ads / festivals / social proof |
| GET  | `/api/announcement` | — | announcement banner |
| GET  | `/api/version` | — | app update channel |
| GET  | `/api/orders?mobile=` | JWT | customer own / staff all |
| POST | `/api/orders` | JWT | place order (12-digit UTR + serviceability checks); fires new-order push to admin/staff |
| POST | `/api/orders/accept` | JWT (rider) | rider claims an order |
| GET  | `/api/tracking?orderId=` | JWT | live tracking (OSRM road route + ETA); owner/rider/order-owner only |
| POST | `/api/tracking/location` | JWT (rider) | rider pushes GPS (lat/lng, accuracy 0–1000) |
| POST | `/api/tracking/status` | JWT (rider) | rider sets delivery status; pushes customer |
| POST | `/api/push/register` | JWT | save device FCM token + auto-subscribe topics by role |
| POST | `/api/push/unregister` | JWT | remove a device token |
| POST | `/api/push/send` | JWT (`ads`) | broadcast to all/customers/riders/admins |
| GET  | `/api/admin/users` | JWT (`users`) | list users |
| POST | `/api/admin/assignRole` | JWT (owner) | give role to a user **by mobile number** |
| POST | `/api/admin/products` | JWT (`products`) | add/update/delete product (auto-discount) |
| POST | `/api/admin/categories` | JWT (`categories`) | add/update/delete category |
| POST | `/api/admin/settings` | JWT (`settings`) | update store settings |
| POST | `/api/admin/banners` | JWT (`banners`) | replace homepage banners |
| POST | `/api/admin/announcement` | JWT (`ads`) | save announcement (auto-bumps id) |
| POST | `/api/admin/orders/status` | JWT (`orders`) | update any order status; pushes customer |

### Push notifications & reminders

- On **order placement**, admin/staff (owner, superadmin, `orders`-permission admins) get a push (topic `admins` + their registered device tokens) — see `notifyStaffNewOrder`.
- A **node-cron job** (every minute) re-pings staff for orders still `Order Placed` after 5 min, up to 3 reminders — see `src/services/reminderJob.ts`.
- **Dev mode**: without `FCM_SERVICE_ACCOUNT` set, pushes are logged to console (`[push:dev] ...`) instead of sent, so everything works without Firebase.
- To enable real push: put your Firebase service-account JSON path in `FCM_SERVICE_ACCOUNT`.

Every response uses the shared envelope: `{ "success": true, ... }` / `{ "success": false, "message": "..." }`.

## Setup

1. **Create the database + import** (uses `../db`).
   > On **Windows PowerShell**, do NOT use `mysql ... < file.sql` — PowerShell reserves `<` and mangles UTF-8 (Hindi becomes `????`). Use MySQL's `SOURCE` instead, which reads the file directly with the right charset.

   XAMPP MariaDB (root, blank password) example:
   ```powershell
   $mysql = "C:\xampp\mysql\bin\mysql.exe"
   & $mysql -u root -e "CREATE DATABASE IF NOT EXISTS four_a_store CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   & $mysql -u root --default-character-set=utf8mb4 four_a_store -e "SET NAMES utf8mb4; SOURCE db/schema.sql;"
   & $mysql -u root --default-character-set=utf8mb4 four_a_store -e "SET NAMES utf8mb4; SOURCE db/seed.sql;"
   ```
   (Run these from the `4astore-v2` folder so the relative `db/...` paths resolve. On Linux/macOS `mysql -u root -p four_a_store < db/schema.sql` is fine.)

2. **Configure env**:
   ```powershell
   Copy-Item .env.example .env
   # edit DATABASE_URL, JWT_SECRET, mail + FCM as needed
   ```

3. **Install + generate Prisma client**:
   ```powershell
   npm install
   npm run prisma:generate
   ```
   If `prisma generate` fails with **"unable to get local issuer certificate"** (common behind XAMPP/antivirus/corporate proxy), let Node skip the TLS check just for the engine download:
   ```powershell
   $env:NODE_TLS_REJECT_UNAUTHORIZED="0"; npx prisma generate
   ```
   For a permanent, secure fix, point Node at your corporate root CA instead:
   `$env:NODE_EXTRA_CA_CERTS="C:\path\to\your-root-ca.pem"`.

4. **Run**:
   ```powershell
   npm run dev      # http://localhost:4000
   ```

## Default owner login

Seed creates an owner: username `owner`, password `admin1234` (bcrypt hash in `seed.sql`).
**Change it.** Generate a new hash:
```powershell
node -e "console.log(require('bcryptjs').hashSync('YourNewPass',10))"
```
Then update the `users` row for `owner`.

## Notes / next steps (from REBUILD-PROMPT.md)

- **Push (new-order alert to admin/staff + reminder)**: wire `firebase-admin` and enqueue a job on order create (see `TODO` in `src/routes/orders.ts`). Reminder loop while status stays `Order Placed` for N minutes.
- **Role by mobile number**, product/category/order **admin writes**, banners/ads/settings writes live in the **Laravel admin** service (shared DB).
- **Live tracking** (`/api/tracking`) with OSRM road route + ETA and rider `updateLocation` is stubbed to add next.
- JWT secret must match the Laravel side so tokens verify across both services.
