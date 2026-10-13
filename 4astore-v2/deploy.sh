#!/usr/bin/env bash
# =============================================================================
# 4A Store — SAFE one-command deploy  (api + web + admin)
#
#   Server pe sirf ye chalao:   bash ~/4astore/4astore-v2/deploy.sh
#
# GUARANTEE — ye files/settings KABHI touch/overwrite/delete NAHI hoti:
#   - api-node/.env                       (DB creds, FCM_SERVICE_ACCOUNT, Google login secrets)
#   - web/.env                            (web runtime env)
#   - fcm-service-account.json  (symlink) (push / FCM credential)
#   - /var/www/html/.htaccess             (SPA routing — loop-safe, live wali)
#   - /var/www/html/phpmyadmin/           (phpMyAdmin UI — ek baar install, phir chhod do)
#   - /var/www/html/.well-known/          (SSL / verification)
#
# Jo kal issues aaye (galat folder, .htaccess loop, .env/FCM path galat, prisma
# stale crash, phpmyadmin dhak jaana) — un SAB ke against ye script guarded hai.
# =============================================================================

set -euo pipefail

# ---- CONFIRMED SERVER PATHS (sab server se verify kiye hue) ----------------
REPO_ROOT="/home/ec2-user/4astore"
API_DIR="$REPO_ROOT/4astore-v2/api-node"
WEB_DIR="$REPO_ROOT/4astore-v2/web"
WEB_ROOT="/var/www/html"            # Apache DocumentRoot (HTTP + HTTPS dono)
PM2_APP="4astore-api"
BRANCH="main"
OG_CONF_SRC="$REPO_ROOT/4astore-v2/deploy/4astore-og.conf"  # repo-tracked crawler-OG vhost include

# NODE_ENV=production hone pe tsc/vite/prisma (devDeps) skip ho jaate — unset
unset NODE_ENV || true

say()  { printf "\n\033[1;36m==== %s ====\033[0m\n" "$1"; }
ok()   { printf "   \033[1;32m✓ %s\033[0m\n" "$1"; }
warn() { printf "   \033[1;33m! %s\033[0m\n" "$1"; }
die()  { printf "\n\033[1;31mABORT: %s\033[0m\n" "$1" >&2; exit 1; }

# ---- 0. PRE-FLIGHT: zaroori settings maujood hain? (fail-fast) --------------
say "0/7  Pre-flight — protected settings maujood hain?"
[ -d "$REPO_ROOT/.git" ]                    || die "git repo nahi mila: $REPO_ROOT"
[ -e "$API_DIR/.env" ]                      || die "api-node/.env MISSING (secrets symlink toota?)"
[ -e "$API_DIR/fcm-service-account.json" ]  || die "fcm-service-account.json MISSING (push toot jayega)"
[ -f "$API_DIR/package.json" ]              || die "api-node/package.json MISSING"
[ -f "$WEB_DIR/package.json" ]              || die "web/package.json MISSING"
# FCM path .env me RELATIVE hona chahiye (galat absolute path = push off — kal wali galti)
if grep -q '^FCM_SERVICE_ACCOUNT=/var/www/html' "$API_DIR/.env" 2>/dev/null; then
  die ".env me FCM_SERVICE_ACCOUNT purane galat path pe hai. Theek karo: FCM_SERVICE_ACCOUNT=fcm-service-account.json"
fi
ok ".env, fcm-service-account.json, package.json sab theek"

# ---- 1. GIT PULL (sirf code; .env/secrets git me hain hi nahi) -------------
say "1/7  git pull ($BRANCH)"
git -C "$REPO_ROOT" fetch origin "$BRANCH"
git -C "$REPO_ROOT" checkout "$BRANCH"
git -C "$REPO_ROOT" pull --ff-only origin "$BRANCH"
ok "HEAD: $(git -C "$REPO_ROOT" rev-parse --short HEAD)"

# ---- 2. API: install -> prisma generate -> build ---------------------------
say "2/7  api-node: install + prisma generate + build"
cd "$API_DIR"
npm install --include=dev --no-audit --no-fund
npx prisma generate          # stale Prisma client crash yahin rukta hai
npm run build                # -> dist/server.js
[ -f "$API_DIR/dist/server.js" ] || die "api build fail: dist/server.js nahi bana"
ok "api built"

# ---- 3. API: pm2 restart (sahi folder + env reload) ------------------------
say "3/7  pm2 restart $PM2_APP"
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP" --update-env
else
  pm2 start "$API_DIR/dist/server.js" --name "$PM2_APP" --cwd "$API_DIR"
fi
pm2 save
sleep 2
ok "pm2 restarted"

# ---- 4. WEB/ADMIN: build ---------------------------------------------------
say "4/7  web/admin build"
cd "$WEB_DIR"
npm install --include=dev --no-audit --no-fund
npm run build                # tsc -b && vite build -> dist/
[ -f "$WEB_DIR/dist/index.html" ] || die "web build fail: dist/index.html nahi bana"
ok "web built"

# ---- 5. WEB: deploy to /var/www/html — PROTECTED SYNC ----------------------
# --delete NAHI (purani zaroori files na udein).
# excludes = ye cheezein live pe jaisi hain waisi rehti hain (overwrite nahi):
say "5/7  web -> $WEB_ROOT  (settings protected, --delete NAHI)"
sudo rsync -a \
  --exclude='.htaccess' \
  --exclude='.env' \
  --exclude='.well-known' \
  --exclude='phpmyadmin' \
  "$WEB_DIR/dist/" "$WEB_ROOT/"
sudo chown -R apache:apache "$WEB_ROOT" 2>/dev/null || true
ok "web synced ( .htaccess / .env / .well-known / phpmyadmin chhoda )"

# ---- 5b. CRAWLER OG ROUTING: repo-shipped Apache vhost include (UNIVERSAL) --
# Social-share previews (WhatsApp/Facebook/etc.) ke liye /product/:id, /page/:slug,
# /category/:slug, /products?category=… par crawler ko Node OG HTML milta hai. Ye rule
# ab .htaccess me NAHI (jo deploy se excluded + revert ho jaata tha) — ye repo-tracked conf
# file hai jo har deploy pe Apache conf.d me install hoti hai. Humans SPA pe hi rehte hain.
say "5b/8  crawler-OG vhost include install (Apache conf.d)"
if [ -f "$OG_CONF_SRC" ]; then
  OG_CONF_DST=""
  if [ -d /etc/httpd/conf.d ]; then
    OG_CONF_DST="/etc/httpd/conf.d/4astore-og.conf"            # Amazon Linux / RHEL / CentOS
  elif [ -d /etc/apache2/conf-available ]; then
    OG_CONF_DST="/etc/apache2/conf-available/4astore-og.conf"  # Debian / Ubuntu
  fi
  if [ -n "$OG_CONF_DST" ]; then
    if ! sudo cmp -s "$OG_CONF_SRC" "$OG_CONF_DST" 2>/dev/null; then
      sudo cp "$OG_CONF_SRC" "$OG_CONF_DST"
      # Debian/Ubuntu: enable the conf (idempotent). RHEL conf.d auto-loads, no enable needed.
      [ -d /etc/apache2/conf-available ] && sudo a2enconf 4astore-og >/dev/null 2>&1 || true
      # Reload Apache so the new/updated rule is live (graceful — no dropped connections).
      sudo systemctl reload httpd 2>/dev/null || sudo systemctl reload apache2 2>/dev/null \
        || sudo apachectl graceful 2>/dev/null || warn "Apache reload nahi hua — manually: sudo systemctl reload httpd"
      ok "crawler-OG include updated + Apache reloaded ($OG_CONF_DST)"
    else
      ok "crawler-OG include already up-to-date ($OG_CONF_DST)"
    fi
  else
    warn "Apache conf dir nahi mila (httpd/apache2) — 4astore-og.conf manually install karo (deploy/4astore-og.conf dekho)"
  fi
else
  warn "$OG_CONF_SRC missing — crawler OG rule skip (repo pull adhoora?)"
fi

# ---- 6. .htaccess SANITY: SPA loop-safe hai? + phpmyadmin bypass? ----------
# .htaccess ko overwrite nahi karte, par agar galat/loop-wali ho to WARN karte hain.
say "6/8  .htaccess sanity check"
HT="$WEB_ROOT/.htaccess"
if [ -f "$HT" ]; then
  grep -q 'RewriteRule \^index\\.html\$ - \[L\]' "$HT" && ok ".htaccess loop-guard maujood" \
    || warn ".htaccess me index.html loop-guard nahi dikha — 500 ka risk"
  grep -qi 'phpmyadmin' "$HT" && ok "phpmyadmin bypass maujood" \
    || warn "phpmyadmin bypass .htaccess me nahi — phpMyAdmin UI SPA me dhak sakta hai (fix niche README me)"
else
  warn "$HT missing — SPA routes 404 denge"
fi

# ---- 7. HEALTH CHECK -------------------------------------------------------
say "7/8  Health check"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
HOME=$(code https://4astore.com/ || true)
LOGIN=$(code -X POST https://4astore.com/api/users/login -H "Content-Type: application/json" -d '{"u":"x"}' || true)
SEO=$(code https://4astore.com/api/admin/seo-auto/dashboard || true)
MAP=$(code https://4astore.com/sitemap.xml || true)
ROB=$(code https://4astore.com/robots.txt || true)
FAV=$(code https://4astore.com/favicon.ico || true)
printf "   home=%s  login=%s  seo=%s  sitemap=%s  robots=%s  favicon=%s\n" "$HOME" "$LOGIN" "$SEO" "$MAP" "$ROB" "$FAV"
echo "   (login 4xx = backend zinda; seo 401 = route live; home/sitemap/robots/favicon = 200)"

# ---- 8. CRAWLER-OG CHECK: crawler ko OG image milti hai, human ko SPA? -----
# Universal fix ki asli verification: crawler UA pe og:image dikhe, bina UA ke SPA (no og:image).
say "8/8  crawler OG verify (/product/1)"
PID="${OG_TEST_PRODUCT_ID:-1}"
CRAWLER_OG=$(curl -s -A 'WhatsApp/2.0' "https://4astore.com/product/$PID" | grep -o 'og:image[^>]*' | head -1 || true)
HUMAN_OG=$(curl -s -A 'Mozilla/5.0' "https://4astore.com/product/$PID" | grep -o 'og:image[^>]*' | head -1 || true)
if [ -n "$CRAWLER_OG" ]; then
  ok "crawler ko og:image mili  → $CRAWLER_OG"
else
  warn "crawler ko og:image NAHI mili — Apache conf.d me 4astore-og.conf load hua? (sudo apachectl -t -D DUMP_MODULES | grep proxy)  +  Cloudflare purge/Vary check karo"
fi
echo "   (human og:image: ${HUMAN_OG:-'<none — SPA default, expected>'} )"

say "DONE ✅  — browser me Ctrl+Shift+R (ya Cloudflare purge agar zaroorat ho)"
