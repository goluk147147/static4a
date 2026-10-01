# 4AStore v2 — API Collection

Postman files in this folder:

- `4AStore-v2.postman_collection.json` — all endpoints (Node + Laravel admin)
- `4AStore-v2.postman_environment.json` — local URLs + variables

## Import

1. Open Postman → **Import** → drop both JSON files.
2. Top-right, select the environment **"4AStore v2 - Local"**.
3. Make sure the servers are running:
   - Node API: `cd api-node ; npm run dev` → `http://localhost:4000`
   - Laravel admin (optional): `cd admin-laravel ; php artisan serve` → `http://localhost:8000`

## How auth works in the collection

- The collection uses **Bearer {{accessToken}}** at the collection level, so every request
  automatically sends the token once you have one.
- Run **Auth (Node) → Login (owner)** (owner / admin1234). Its test script saves the JWT into
  `{{accessToken}}` automatically. All protected calls then work.
- For a customer flow: **Send signup OTP** (saves `{{otp}}` in dev) → **Register** (saves token).
- **Refresh token** demonstrates the life-long login (uses the refresh cookie / body).

## Handy variables (auto-filled by test scripts)

| Variable | Set by | Used by |
|----------|--------|---------|
| `accessToken` | login / register / refresh | all Bearer-auth requests |
| `otp` | Send signup OTP (dev returns `devOtp`) | Register |
| `orderId` | Place order | tracking, accept, status |

## Groups

- **Health & Public** — no auth (products, categories, settings, config, announcement, version)
- **Auth (Node)** — otp, register, login, refresh, session, logout, deleteSelf
- **Orders (Node)** — list, place (12-digit UTR + serviceability), rider accept
- **Tracking (Node)** — get by orderId (OSRM route+ETA), rider location/status
- **Push (Node)** — register/unregister device token, staff broadcast
- **Admin (Node)** — users, assignRole by mobile, products, categories, settings, banners, announcement, order status
- **Admin (Laravel)** — same admin surface served by the Laravel service (shares DB + JWT)

## OpenAPI

If you prefer OpenAPI/Swagger instead of Postman, tell me and I'll generate an `openapi.yaml`
you can import into Swagger UI, Insomnia, or Postman.
