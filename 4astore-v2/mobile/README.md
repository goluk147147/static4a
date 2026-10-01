# 4AStore v2 — Mobile App (React Native / Expo)

Customer + rider app. Shares the Node API, JWT (with **life-long login** via SecureStore refresh
token + silent refresh), **FCM push notifications**, and **smart links** (Android App Links + iOS
Universal Links + deep links).

## Features wired

- **Auth**: login → JWT access token in memory + refresh token in `expo-secure-store`
  (Keychain/Keystore). `bootstrap()` silently refreshes on launch, so users stay logged in ~1 year.
- **Push** (`src/push.ts`): asks permission, gets the device token, registers it with
  `/api/push/register`. Server subscribes the device to role topics (`customers`/`riders`/`admins`).
  New-order alerts to staff, status updates to customers, and admin broadcasts all land here.
  Tapping a notification navigates to the `link` in its payload (e.g. `/track/4A...`).
- **Smart links** (`app.json`): Android `intentFilters` with `autoVerify` for
  `https://4astore.example.com/*` + iOS `associatedDomains`. Also the custom scheme `fourastore://`.
  Host the two files (already in `../web/public/.well-known/`):
  - `assetlinks.json` (Android) — put your app-signing SHA-256 fingerprint in it.
  - `apple-app-site-association` (iOS) — put your Apple `TEAMID`.
- **UPI** (`src/upi.ts`): `payUpi()` opens PhonePe/GPay/Paytm via a `upi://pay` link (same behavior
  as the old WebView app), with amount + note prefilled.

## Screens (expo-router)

- `app/index.tsx` — storefront (product grid from `/api/products`)
- `app/login.tsx` — JWT login + push registration
- `app/track/[orderId].tsx` — live order status/ETA (also the smart-link/push landing screen)

## Setup

```powershell
npm install
# set your API base + push:
#  - app.json > expo.extra.apiBase  (your deployed API)
#  - drop google-services.json (Android FCM) into this folder
npx expo start          # dev
npx expo run:android    # native build (needs Android SDK)
```

## Notes

- This is the functional shell matching the old app's key behaviors. Extend with cart/checkout/
  rider screens reusing the same `src/api.ts` client (identical endpoints as the web app).
- The old self-hosted APK auto-update (`version.json`) can be re-added via `expo-updates` or an
  in-app check hitting `/api/version`.
