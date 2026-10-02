# 4A Store — Native App (React Native / Expo SDK 54)

Full native rebuild of the old 4AStore WebView app. **Same package, same signing key, same UI,
same features** — only the technology changed (native screens instead of a WebView), plus the three
requested additions: push notifications, smart links, and the staff new-order alert + order detail.

- **Package:** `com.store4a.app` (unchanged → installs as an update of the old app)
- **Signing key:** the original `../../4AStoreApp/4astore-key-new.jks` (alias `4astore`) — the built
  APK's certificate SHA-256 matches the old releases, so the Play Store accepts it as an update.
- **versionCode:** 18 (continues after the last WebView release 17 / v1.7.9), versionName `2.0.0`.
- **API:** the shared Node API (`https://4astore.webtoolsz.com/api`). JWT with ~1-year life-long
  login (refresh token in SecureStore + silent refresh on launch / 401).

## Features (parity with the web storefront + rider console)

Home (festival banners carousel, category rail, popular products, promo strips, live social-proof,
announcement popup with Hindi voice), Products (search + category/brand/sort filters, festival
header & side/mid ads, 18+ warning), Product details (+ share smart link), Cart (persisted),
Checkout (saved addresses, PIN 824301 + serviceable-village + GPS validation, delivery / free-above
/ per-user custom fee), UPI payment sheet (branded QR save to gallery, PhonePe/GPay launch, Hindi
voice guide, **screenshot → on-device OCR auto-UTR**, 12-digit UTR), Order success (WhatsApp order),
Orders (A4 PDF invoice via expo-print), Live tracking (Leaflet + OSRM route + ETA, rider call),
Login/Register (email OTP), Profile (recovery email, delete account), CMS pages, offline retry
screen, update channel (Play Store + `version.json`).

Rider console: available orders, my deliveries, one-tap status, background GPS to the tracking API,
native Google Maps navigation, call customer.

### The three additions

- **(A) Push notifications (FCM):** device token registered on launch/login; server subscribes it to
  role topics (`customers` / `riders` / `admins`). Status pushes to the customer, broadcasts, and the
  loud "new orders" channel for staff. Tapping a notification deep-links to the right screen.
- **(A.1) New-order alert to admin/staff:** when a customer places an order, every owner / superadmin
  / admin-with-`orders` gets an **immediate push** (channel `orders`, high priority + sound +
  vibration) showing customer name, order id, item count, total and delivery area. Tap opens the
  order detail (**kisne order kiya, kahan se**) with items, payment screenshot, map/navigate, and
  status change. A reminder re-fires if the order stays `Order Placed`. While the app is open a
  poller + Hindi voice also announces new orders (works even before Firebase is configured).
- **(A.2) Role by mobile number:** owner/superadmin → Profile → "Role by mobile number" assigns a
  role (admin + permission checkboxes / rider / customer) to any registered user by mobile; the next
  token registration subscribes them to the right topics so alerts route correctly.
- **(C) Smart links:** Android App Links for `https://4astore.webtoolsz.com/product|track|page|...`
  (host `web/public/.well-known/assetlinks.json` with this app's signing SHA-256) + the
  `fourastore://` scheme. Product / tracking share buttons generate these links.

## Build

Prerequisites: Node, JDK 17, Android SDK (set `android/local.properties` → `sdk.dir`). The build
needs the keystore passwords, passed as env vars (NOT committed):

```powershell
cd mobile
$env:NODE_OPTIONS="--use-system-ca"       # if your network needs the system CA store
npx expo prebuild --platform android --clean

cd android
$env:STORE4A_KEYSTORE_PASSWORD="<password>"
$env:STORE4A_KEY_PASSWORD="<password>"
.\gradlew.bat assembleRelease              # signed APK
.\gradlew.bat bundleRelease                # signed AAB for Play Store
```

Outputs:
- APK → `mobile/android/app/build/outputs/apk/release/app-release.apk`
- AAB → `mobile/android/app/build/outputs/bundle/release/app-release.aab`

A ready APK is also copied to the repo root as `4AStore-v2.0.0-code18-native.apk`.

### Push setup (optional for the build, required for live push)

Drop the Firebase `google-services.json` for `com.store4a.app` into `mobile/`, then rebuild. Without
it the app still builds and runs; push is simply disabled (the in-app staff order poller still works).
On the server set `FCM_SERVICE_ACCOUNT` to the Firebase service-account JSON.

## Config plugins

- `plugins/withReleaseSigning.js` — injects the release signingConfig that uses the original keystore
  (passwords from Gradle props / env), surviving every `expo prebuild`.
- `plugins/withNoNdk.js` — removes the pinned `ndkVersion` (this app has no custom C++), so the build
  doesn't fail on machines without that exact NDK.
