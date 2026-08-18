# 4astore - React Native App

Native mobile app for 4astore grocery delivery.

## Setup

```bash
cd app
npm install
npx expo start
```

Scan QR with **Expo Go** app on your phone.

## Configuration

Edit `src/config.js` to change:
- `BASE_URL` — point to your CDN where JSON files are hosted
- `STORE_CONFIG` — UPI ID, mobile, address etc.

## JSON Data (from CDN)

The app fetches these from your server/CDN:
- `/data/products.json`
- `/data/categories.json`
- `/data/config.json`

For development, run the website server (`npx serve ../` at port 8000) and use your local IP in config.

## Features

- Login / Signup (username + password)
- Browse products with category pills & search
- Product detail page
- Cart with quantity controls (persisted in AsyncStorage)
- UPI-only checkout with screenshot upload
- Forced WhatsApp notification on order
- Order history
- Profile with logout
- Bhagwa (saffron) theme

## Build APK

```bash
npx expo build:android
# or EAS Build:
npx eas build --platform android
```
