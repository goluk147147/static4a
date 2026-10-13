# Smart Short-Link — Final Report

**Task:** `smart-shortlink`
**Branch:** `smart-shortlink`
**Status:** completed
**Review verdict:** APPROVED (see `review.json`)

## What shipped

A universal short-link system at `https://4astore.com/link/<code>` plus a product-page Share button, in `api-node` + `web` only (no mobile rebuild, legacy PHP untouched).

- **`short_links` table** — no-migrate approach: Prisma model in `api-node/prisma/schema.prisma`, idempotent ensure/create SQL in `api-node/prisma/short-links.sql`, created on boot so no destructive migration runs.
- **`/api/link` route** (`api-node/src/routes/link.ts`) — public resolver + smart redirect:
  - Crawler UAs get the correct OG card by reusing the `a0380ad2` `ogShare.ts` source of truth.
  - Human UAs get the smart redirect (Android app via existing App Links / deep link, Play Store fallback, website on desktop).
- **Base62 short-link service** (`api-node/src/services/shortLink.ts`) — code generation, lookup, and `createCustomShortLink` for any URL (staff-gated via `requireStaff('ads')`).
- **Auto-create on product create — single + bulk**:
  - Single: `api-node/src/routes/catalog.ts`.
  - Bulk/auto import: `api-node/src/services/dataImport.ts`.
- **Admin Links API** (`api-node/src/routes/admin-links.ts`, wired in `api-node/src/routes/admin.ts`) and **Admin Links UI** (`web/src/pages/admin/AdminLinks.tsx`, routed in `web/src/pages/admin/AdminApp.tsx`, client in `web/src/lib/admin.ts`) — create short links for ANY URL and list existing ones.
- **Product Share button** (`web/src/pages/ProductDetails.tsx`, routed via `web/src/App.tsx`) — bilingual, shares the universal `/link/<code>`.
- **Deploy-safe Apache rule** — `deploy/4astore-og.conf` gained the `/link` rule reusing the existing include mechanism (no fragile `.htaccess`), so `/link/<code>` reaches the Node resolver for both crawlers and humans.

## Build / verification already done (worktree)

- `api-node` TypeScript build (`tsc`) passes.
- `prisma validate` passes.
- `web` build passes.

## Commits (FEAT)

```
8fa4730e feat: admin short-links page + product share button (FEAT-002)
ab000fdd feat: universal short-link subsystem (short_links table, service, redirect + admin + public APIs)
```

## Post-deploy verification commands

Run after deploy against production (`4astore.com`). Replace `<code>` with a real short code.

1. **Crawler OG image check (WhatsApp UA)** — must return the product `og:image`, not the landing page:
   ```bash
   curl -A "WhatsApp/2.23" -sL https://4astore.com/link/<code> | grep -i 'og:image'
   ```

2. **Human smart-redirect check (Mozilla UA)** — must serve the smart-redirect HTML (app / Play Store / website logic), not the OG card:
   ```bash
   curl -A "Mozilla/5.0 (Linux; Android 13)" -sL https://4astore.com/link/<code> | grep -i -E 'intent://|play.google.com|location.href'
   ```

3. **Desktop landing check** — a desktop UA must land on the website destination:
   ```bash
   curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" -sL -o /dev/null -w "%{http_code} %{url_effective}\n" https://4astore.com/link/<code>
   ```

Also verify the Android app-open fallback on a real device/browser (the `intent://` + 1200ms Play Store fallback is browser-dependent by nature).

## IMPORTANT — merge/deploy reminder

A new Prisma model (`ShortLink`) was added. The **MAIN checkout must run `npx prisma generate` after merge**, otherwise `tsc` fails there (no `prisma.shortLink` on the client). `deploy.sh` already runs `prisma generate` on deploy, but a local main build will fail until the client is regenerated.
