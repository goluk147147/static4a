# Build Prompt: "4AStore" Grocery Delivery Platform (Node.js API + Laravel Admin + React Web + MySQL + Native App)

Hand this whole file to any AI/developer as a self-contained brief to rebuild 4AStore. It is derived from the existing PHP/JSON + static-HTML + Android-WebView app and re-specs the SAME product on a new stack, adding **push notifications, SEO, and smart links (deep links / App Links)**.

---

## 0. NON-NEGOTIABLE PRINCIPLES (read first, apply to every section)

1. **Same UI, same features, same functionality — only the technology/framework changes.** The rebuild must look and behave EXACTLY like the current 4AStore: same pages, same layout, same orange grocery theme, same flows, same bilingual English/Hindi copy, same buttons and behavior. Do NOT redesign, remove, or "improve" features. Every screen that exists today must exist and work the same (home, products, product details, cart, checkout, order history, live tracking, profile, login/register, admin panel tabs, rider console, help & support, account deletion, privacy, terms, coming-soon/download).
2. **JWT authentication everywhere.** All login/auth (customer, rider, admin, owner) uses **JWT**, implemented the proper/idiomatic way for each framework:
   - **Node.js API** → `jsonwebtoken` (or Passport-JWT), access + refresh tokens, `bcrypt` hashing.
   - **Laravel admin** → proper JWT approach (Sanctum tokens or `tymon/jwt-auth`), validating the same `users` table.
   - Shared signing secret / verification so a token from one backend is trusted by the other where needed. Passwords always hashed, never plaintext.
3. **Life-long (permanent) login.** Tokens/sessions are long-lived (~1 year, like the current app) with silent refresh so customers, riders and admins stay logged in and never have to re-login repeatedly. Long-expiry refresh token + rotating short access token; store securely (HttpOnly cookie on web, secure storage/Keychain in app). Explicit logout revokes the token.

---

## 0.1 Stack Split

- **Customer + rider + public API → Node.js** (Express + TypeScript, Prisma/Sequelize on MySQL).
- **Admin panel + admin API → Laravel** (PHP 8.2+, Eloquent on the SAME MySQL DB).
- **Website → React** (Vite + TypeScript) — one app containing customer storefront + rider console + admin dashboard UI. Storefront/rider UI call the Node API; admin UI calls the Laravel API.
- **Database → MySQL** — a single shared DB used by both backends. One agreed schema, identical table/column names; Node via Prisma, Laravel via Eloquent.
- **Mobile app → React Native (Expo)** — customer + rider, with push + smart links.

Shared API contract everywhere: `{ "success": true, ... }` / `{ "success": false, "message": "..." }`.

---

## 1. Product Summary

**4AStore** is a hyperlocal grocery & daily-needs e-commerce platform for a single store serving PIN code **824301** (Gajna Road, Chandargarh, Nabinagar, Aurangabad, Bihar, India) plus a fixed list of nearby villages. Bilingual (English + Hindi). Delivery allowed only for PIN `824301`, OR a serviceable village (name matched in English or Hindi), OR live GPS within ~100 km of store coords (`24.580164, 84.114194`). Payment is UPI with a mandatory 12-digit payment reference (UTR) per order.

---

## 2. Tech Stack Details

**Node.js API (customer + rider + public reads)** — Express + TS; ORM **Prisma** (or Sequelize) on MySQL; **JWT** access+refresh (1-year, silent refresh); `bcrypt`; validation with `zod`; Nodemailer (order/OTP/recovery); `multer` uploads; `firebase-admin` for FCM + web push; **OSRM** public router for road route + ETA (no paid map API); BullMQ/`node-cron` for reminder pushes.

**Laravel Admin (PHP 8.2+)** — same MySQL via Eloquent (identical tables); **JWT** (Sanctum or `tymon/jwt-auth`); roles/permissions via `spatie/laravel-permission`. Roles: `owner, superadmin, admin, rider, customer`. Permission keys: `dashboard, orders, riderTracking, products, categories, banners, ads, users, earnings, settings, team`. Queued jobs + scheduler for reminders; triggers push broadcasts.

**Website — React (Vite + TS)** — React Router, TanStack Query, Zustand/Redux Toolkit; Tailwind (orange theme `#ff6600`, gradients — match current look exactly); PWA via `vite-plugin-pwa`. **SEO**: `react-helmet-async`, JSON-LD (`Product`, `Store`/`LocalBusiness`, `BreadcrumbList`), dynamic `sitemap.xml` + `robots.txt`, canonical, OG images. Prefer **Next.js** if SSR/SSG acceptable; else prerender product/category pages.

**Native app — React Native (Expo)** — push, smart/deep links, UPI intents, camera/file upload, native geolocation for rider tracking, Hindi TTS, update channel.

**Cross-cutting**: FCM (Android/iOS) + web push (VAPID); SEO deps + structured data; Smart links — Android **App Links** (`/.well-known/assetlinks.json`) + iOS **Universal Links** (`apple-app-site-association`) + deferred deep-link resolver.

---

## 3. Data Model (MySQL — shared by Node + Laravel)

**users**: `id, name, mobile (unique, /^[6-9]\d{9}$/), username (unique), email/recovery_email, recovery_email_verified, password (hashed), role, backend_rider, custom_delivery (nullable per-user fee), registered_at, last_login`. Customers self-register (email OTP). Riders admin-created/promoted only (`backend_rider=true`) and can switch rider/customer mode.

**admin_users** (or unify into users via roles): `id, username, name, password_hash, role (owner|admin), permissions (json)`. Owner protected; cannot delete own account.

**products**: `id, name, brand, category (slug), weight, mrp, price, discount (auto = round((mrp-price)/mrp*100)), image, description, features (json), in_stock`.

**categories**: `id, name, slug, icon (emoji), image, hidden, age_restricted, warning` (e.g. 18+ "Mouth Freshener" with tobacco warning).

**orders**: `order_id ("4A"+8 hex), user_id, customer (json), items (json), subtotal, discount, delivery_charge, total_amount, payment_method, payment_reference (12-digit UTR, unique), order_status, order_date, delivery_address (json snapshot), rider_id, rider_name, rider_mobile, assigned_at, delivered_at, created_by`. Status: `Order Placed → Confirmed → Packed → Rider Assigned → Out for Delivery → Delivered` (+ `Cancelled`).

**addresses**: label, receiver_name, phone, house_no, landmark, full_address, city, district, state, pincode, lat/lng.

**tracking**: `order_id, status, rider_name, rider_mobile, lat, lng, heading, speed, accuracy, source (device_gps), dest_lat, dest_lng, updated_at, assigned_at`.

**settings** (singleton): `store_email, delivery_charge (10), free_delivery_above (500), upi_id, upi_name, hide_mrp, store_phone, store_address, store_latitude, store_longitude, serviceable_villages (bilingual comma list)`.

**config** (singleton, homepage merchandising): `banners[] (title, subtitle, btnText, btnLink, gradient[2], image, festival, active)`, `festivalAds{}` per festival (diwali, holi, navratri, christmas, eid, ipl, independence, chhath, rakhi → leftAd/rightAd/midBanner), `festivalCategories{}`, `ads[]` (promo strips w/ `{{freeDeliveryAbove}}` templating), `socialProofMessages[]`, `socialProofNames[]`, `currentFestival`.

**announcements**: `id (auto-bump), text, image, target (all|customers|riders|admins), ctaText, ctaLink, enabled`.

**version** (app update): `versionCode, versionName, url, message, forceUpdate, assetVersion`.

**device_tokens** (NEW): `user_id (nullable), token, platform (android|ios|web), topics (json), updated_at`.

---

## 4. API Endpoints (`success`/`message` envelope, JWT + role/permission middleware)

> Node handles customer + rider + public reads. Laravel handles admin management. Both read/write the same MySQL tables.

**Auth/users** — customer flows on **Node** (`/api/users`): `register` (email OTP required), `login` (username or mobile → returns JWT access+refresh), `refresh`, `logout` (revoke), `session`, `deleteSelf`, `sendSignupOtp`/`verifySignupOtp`, password recovery; rider `switchMode`/`switchRiderToCustomer`. Admin ops on **Laravel** (`users` perm): `list, updateUser, delete, deleteInactive, setDelivery, createRider`; team (`team` perm): `adminLogin, adminList, adminCreate, adminUpdate, adminDelete`.

**Products** — GET public (Node); POST `add|update|delete|saveAll` on **Laravel** (`products`).

**Categories** — GET public (Node); POST CRUD on **Laravel** (`categories`).

**Orders** — GET (Node: customer own by mobile; staff: all); POST `save` (Node — validate unique 12-digit UTR + serviceability + snapshot address), `adminCreate` (Laravel `orders`), `updateStatus` (admin any via Laravel / rider own via Node), `acceptOrder` (Node, rider), `delete` (Laravel `orders`, purge tracking + screenshot).

**Tracking** (Node) — GET `?orderId=` live payload (rider loc, dest, store, **OSRM road route** + distance/ETA, ownership checks), GET all (staff/rider); POST rider-only `updateLocation` (non-zero lat/lng, accuracy 0–1000), `setStatus`.

**Merchandising** — GET public (Node): `config`, `ads`, `announcement`. POST on **Laravel**: banners (`banners`), announcement (`ads`).

**Settings** — GET public subset (Node); POST on **Laravel** (`settings`).

**Uploads** — `upload-banner` (Laravel), `upload-screenshot` (Node, named by orderId), `img-proxy`.

**Email** — order confirmation, OTP, recovery (Node Nodemailer, queued).

**Push (NEW)** — `POST /api/push/register`, `/unregister`, `/send` (segment all/customers/riders/**admins**/order). Auto-push: on new order → **admin/staff** + reminder if still `Order Placed` after N minutes; on status change → customer; on new available order → riders. Push service in Node (`firebase-admin`); Laravel calls it or uses `kreait/laravel-firebase`.

**Role assignment (NEW)** — `assignRole` (Laravel, owner/superadmin): give a role to a user **by mobile number** (`admin` + permissions, `rider`, or `customer`); updates topic subscriptions so pushes route correctly.

**Smart links (NEW)** — serve `/.well-known/assetlinks.json` + `/.well-known/apple-app-site-association`; resolver `GET /l/{code}` and canonical URLs `/p/{slug}`, `/c/{slug}`, `/track/{orderId}`, `/festival/{key}`.

---

## 5. Website (React) — pages (must match current UI/flows exactly)

Customer: **Home** (festival banners carousel, category grid, product sections, promo strips, live social-proof toasts), **Products** (search + `?category=`/`?festival=` filters), **Product Details**, **Cart** (persisted, MRP strike unless `hide_mrp`), **Checkout** (address add/select, PIN+village+GPS validation, delivery/free-over-500 + per-user custom fee, UPI QR + 12-digit UTR + screenshot upload), **Order History**, **Live Tracking** (Leaflet + OSRM route + ETA), **Profile**, **Login/Register** (email OTP, JWT), **Help & Support**, **Account Deletion**, **Privacy**, **Terms**, **Coming Soon/Download**.

Rider console: available orders, my deliveries, one-tap status, background GPS push, native map navigation.

Admin (permission-gated, calls Laravel API): **Dashboard, Orders, Rider Tracking, Products, Categories, Banners, Ads & Social, Users, Earnings, Settings, Team Access** (create admins with checkbox permissions; owner protected).

**SEO**: SSR/prerender product & category pages, unique meta/OG per page, JSON-LD, dynamic sitemap from DB, robots.txt, canonical, OG-image endpoint.

---

## 6. Native app + the three requested additions

Reproduce existing WebView behaviors natively: splash, no-internet retry, pull-to-refresh; launch UPI apps (PhonePe `com.phonepe.app`, GPay `com.google.android.apps.nbu.paisa.user`, Paytm, `upi://`/`intent://`); handle `tel:`, `mailto:`, WhatsApp, maps (`geo:`/`google.navigation:`); camera+gallery upload; save invoice PDF / QR to device; native geolocation for rider tracking; Hindi TTS payment voice guide; update channel (Play Store primary + optional self-hosted APK via `version.json`).

**(A) Push** — FCM (Android/iOS) + web push. Register token on launch/login, subscribe to topics (`customers`, `riders`, `admins`, `order_{id}`). Handle foreground/background/quit + tap-to-open deep link. Server triggers on status transitions + admin broadcasts (mirror `announcement.target`). See §6A.1.

**(A.1) New-order alert to admin/staff (REQUIRED)** — Jab bhi koi customer naya order place kare, us par **turant push** jaaye har us user ke device par jise **admin/staff role** diya gaya hai (owner, superadmin, aur `orders` permission wale admins). Notification me: customer naam, order id, item count, total amount, delivery village/area. Tap par app seedha **Orders screen / us order ki detail** khule (`/track/{orderId}` ya admin order view).
  - Delivery via topic `admins` **plus** direct device-token push to every user whose role/permission includes `orders` (baad me add hua staff bhi token register hote hi alert paane lage).
  - **Reminder / persistent announcement**: agar order N minute (configurable, e.g. 5–10) tak `Order Placed` hi rahe, to reminder push + in-app announcement banner dobara jaaye admin/staff ko, jab tak order `Confirmed`/`Cancelled` na ho ya max reminders (e.g. 3) tak. (BullMQ/node-cron ya Laravel scheduler.)
  - Admin/staff **Orders screen** par new/pending orders top par highlight (badge count + sound/vibration), taaki dikhe kiska order aaya.

**(A.2) Role by mobile number (REQUIRED)** — Owner/superadmin **kisi bhi registered user ko uske mobile number se role de sake**: mobile number daalo → role (`admin` + permission checkboxes / `rider` / `customer`) → save. Agle login/token-register par wo correct topics (`admins`/`riders`) subscribe kare aur relevant push milna shuru ho. Role/permissions kabhi bhi mobile se update/revoke ho sake. (Laravel: `updateUser` + `createRider` + `assignRole` jo mobile number leta hai.)

**(B) SEO** — owned by web; app shares OG/canonical URLs so shared links preview correctly.

**(C) Smart links** — Android App Links (`assetlinks.json`) + iOS Universal Links (AASA) + deferred deep link: `https://4astore.<domain>/p/aashirvaad-atta` opens app to that product (or category/tracking/festival); if not installed, opens web and resolves after install. In-app share buttons generate these links for products/offers/tracking.

---

## 7. Business rules to preserve

- Delivery only to PIN `824301` OR serviceable village (English/Hindi match) OR current GPS within ~100 km of store coords; else reject with the same bilingual message.
- Every online order needs a unique valid **12-digit numeric UTR**; reject duplicates.
- Delivery ₹10 default; free above ₹500; per-user `custom_delivery` overrides global.
- Discount auto-computed from MRP vs price; MRP hidden when `hide_mrp`.
- Festival system drives banners, side/mid ads, category highlights by `currentFestival`.
- Riders admin-created only; rider can only update/track own assigned orders.
- Live tracking uses **free OSRM routing + Leaflet** (no paid map API).
- Age-restricted/hidden categories carry 18+ warning, hidden from default listing.
- **JWT + ~1-year life-long login** across all clients.

---

## 8. Deliverables

1. `db/` — MySQL schema (SQL migrations) + seed data (categories, sample products, settings, config, owner admin). Single source of truth for both backends.
2. `api-node/` — Node (Express + TS) customer/rider API: Prisma on MySQL, JWT access+refresh (long-lived), zod, Nodemailer, OSRM tracking, FCM push, uploads, tests (order placement, serviceability, UTR uniqueness, auth).
3. `admin-laravel/` — Laravel admin API + panel: Eloquent on the same MySQL, JWT auth, spatie roles/permissions, product/order/user/team/settings/banner/ads management, push broadcast + reminder scheduler, role-by-mobile assignment.
4. `web/` — React/Next: customer storefront + rider console + admin dashboard UI (pixel/flow-matching current 4AStore), PWA, SEO, Leaflet tracking, cart persistence, JWT auth with silent refresh.
5. `mobile/` — Expo app: FCM push, App/Universal Links + deferred deep links, UPI intents, camera upload, geolocation, Hindi TTS, update channel, JWT persisted in secure storage.
6. `README.md` — setup for all parts, `.env` samples (shared MySQL creds, JWT secret + expiries, mail, FCM key/service account, VAPID, OSRM endpoint, app-link domain), deployment notes (HTTPS, hosting `assetlinks.json`/AASA).
7. Seed one **owner** admin; demonstrate full flow: register → browse → cart → checkout (UPI + UTR) → **new-order push to admin/staff** → admin confirms → rider accepts → live tracking → delivered, with a push at each step, and login persisting long-term.

Keep the `success`/`message` envelope, the identical UI/features/flows, bilingual English/Hindi copy, orange grocery theme, and all rules above. Only the technology changes. Add push notifications, SEO, and smart links as first-class features.
