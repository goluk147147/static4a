# OG / Social Share Setup (EC2 + nginx)

This describes how shared `4astore.com` links get a rich preview (image + title +
description) in WhatsApp, Facebook, Twitter/X, Slack, LinkedIn, Discord, Telegram,
etc., while normal visitors still load the SPA.

## How it works

The Node API (pm2 app `4astore-api`) exposes dedicated share routes:

- `GET /api/og/product/:id` → full HTML document with `og:*` / `twitter:*` meta
  (absolute `https://4astore.com` URLs) and an instant redirect to the SPA
  `/product/:id` for human visitors.
- `GET /api/og/page/:slug` → same for CMS pages (`/page/:slug`).
- `GET /api/og/image/product/:id` → a 1200x630 branded JPEG/WEBP share image
  (product image or the 4A Store logo card), compressed to **≤ 100 KB**, cached on
  disk under `uploads/og/` and in memory. `Cache-Control: public, max-age=86400`.
- `GET /api/og/image/page/:slug` → branded logo card for a CMS page.

The SPA itself is served by nginx. We only want crawlers to see the meta HTML, so
nginx inspects the `User-Agent` and rewrites crawler requests for `/product/:id`
and `/page/:slug` to the Node share routes. Everyone else gets the SPA unchanged.

## nginx configuration

Add this to the `server { ... }` block that serves `4astore.com` (adjust the
`proxy_pass` upstream to match where the Node API listens — commonly
`http://127.0.0.1:4000`).

```nginx
# 1) Flag known social-link crawlers by User-Agent.
map $http_user_agent $is_crawler {
    default                      0;
    "~*facebookexternalhit"      1;
    "~*WhatsApp"                 1;
    "~*Twitterbot"               1;
    "~*Slackbot"                 1;
    "~*LinkedInBot"              1;
    "~*Discordbot"               1;
    "~*TelegramBot"              1;
    "~*Googlebot"                1;
}

server {
    # ... existing TLS / root / SPA config ...

    # 2) Product links: crawlers → Node share route, humans → SPA.
    location ~ ^/product/(?<pid>[A-Za-z0-9]+)/?$ {
        if ($is_crawler) {
            proxy_pass http://127.0.0.1:4000/api/og/product/$pid;
        }
        try_files $uri /index.html;   # humans: SPA
    }

    # 3) CMS pages: crawlers → Node share route, humans → SPA.
    location ~ ^/page/(?<pslug>[a-z0-9-]+)/?$ {
        if ($is_crawler) {
            proxy_pass http://127.0.0.1:4000/api/og/page/$pslug;
        }
        try_files $uri /index.html;   # humans: SPA
    }

    # OG images are served by the API under /api/og/image/... — no extra rule
    # needed as long as /api/ already proxies to the Node app (it does today).
}
```

Then reload nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

> Note: the `if ($is_crawler)` + `proxy_pass` form works inside a regex
> `location`. If your nginx build dislikes `if` inside `location`, split into two
> `location` blocks keyed on `$is_crawler` or use a `map` → `$backend` variable;
> the UA list and target routes stay the same.

## Test

```bash
# Crawler sees meta HTML (og:title / og:image / og:url present):
curl -A "WhatsApp/2.0" https://4astore.com/product/1 | grep -i 'og:'

# Human gets the SPA shell:
curl -A "Mozilla/5.0" https://4astore.com/product/1 | head -n 20

# The share image is small (<= 100 KB) and an image content-type:
curl -sI https://4astore.com/api/og/image/product/1 | grep -i -E 'content-type|content-length'
```

Finally, re-scrape the link in each platform's debugger (e.g. Facebook Sharing
Debugger, LinkedIn Post Inspector) so cached previews refresh.

## Env (optional overrides)

The share routes default to `https://4astore.com`. To point at a different origin
(staging), set in the API `.env`:

```
PUBLIC_SITE_URL=https://4astore.com
PUBLIC_API_URL=https://4astore.com/api
```

## Sitemap & robots mapping (SEO module)

The SEO module adds two crawler-facing endpoints on the Node API:

- `GET /api/sitemap.xml` → an XML `urlset` (homepage, non-hidden categories,
  every product `/product/:id` with `<lastmod>`, and published CMS pages
  `/page/:slug`), cached in-memory for ~5 minutes.
- `GET /api/robots.txt` → `User-agent: *` / `Allow: /` / `Disallow: /admin` /
  `Disallow: /api/`, plus any admin-editable extra lines from
  `config.seo.robotsExtra`, and a `Sitemap: https://4astore.com/sitemap.xml`
  line.

Crawlers expect these at the site root (`/sitemap.xml` and `/robots.txt`), not
under `/api/`. Add two exact-match `location` blocks to the same
`server { ... }` block that serves `4astore.com` so the bare paths proxy to the
API (these routes are **not** gated by the `seoModule` feature flag — crawlers
always need them):

```nginx
server {
    # ... existing TLS / root / SPA + OG crawler config above ...

    # SEO: expose the API's sitemap/robots at the site root.
    location = /sitemap.xml {
        proxy_pass http://127.0.0.1:4000/api/sitemap.xml;
    }
    location = /robots.txt {
        proxy_pass http://127.0.0.1:4000/api/robots.txt;
    }
}
```

Then test and reload nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Verify after reload:

```bash
curl -s https://4astore.com/sitemap.xml | head -n 5     # well-formed <urlset> XML
curl -s https://4astore.com/robots.txt                  # User-agent / Allow / Sitemap: line
```
