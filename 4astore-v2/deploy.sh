#!/usr/bin/env bash
# =============================================================================
# 4A Store — safe one-command deploy (api + web/admin)
#
# Server pe chalao:   bash ~/4astore/4astore-v2/deploy.sh
#
# Ye script:
#   - git pull karti hai (branch: main)
#   - api-node: npm install -> prisma generate -> build -> pm2 restart
#   - web/admin: npm run build -> /var/www/html me rsync
#   - .env, fcm-service-account.json, aur /var/www/html/.htaccess ko
#     KABHI touch/delete NAHI karti (rsync --exclude + no --delete)
#   - deploy se pehle zaroori files maujood hain ye verify karti hai (fail-fast)
#
# Jo aaj issues aaye (galat folder, .htaccess loop, .env delete, prisma stale)
# un sabke against ye script guarded hai.
# =============================================================================

set -euo pipefail

# ---- CONFIRMED PATHS (server se verify kiye hue) ---------------------------
REPO_ROOT="/home/ec2-user/4astore"
API_DIR="$REPO_ROOT/4astore-v2/api-node"
WEB_DIR="$REPO_ROOT/4astore-v2/web"
WEB_ROOT="/var/www/html"          # Apache DocumentRoot (HTTP + HTTPS dono)
PM2_APP="4astore-api"
BRANCH="main"

# NODE_ENV production hone pe tsc/vite/prisma (devDeps) skip ho jaate hain
unset NODE_ENV || true

say() { printf "\n\033[1;36m==== %s ====\033[0m\n" "$1"; }
die() { printf "\n\033[1;31mABORT: %s\033[0m\n" "$1" >&2; exit 1; }

# ---- 0. PRE-FLIGHT: zaroori files maujood hain? ----------------------------
say "0/6  Pre-flight check"
[ -d "$REPO_ROOT/.git" ]                        || die "git repo nahi mila: $REPO_ROOT"
[ -e "$API_DIR/.env" ]                          || die "api-node/.env missing (secrets symlink toota?)"
[ -e "$API_DIR/fcm-service-account.json" ]      || die "fcm-service-account.json missing"
[ -f "$WEB_DIR/package.json" ]                  || die "web/package.json missing"
[ -f "$API_DIR/package.json" ]                  || die "api-node/package.json missing"
echo "  OK: repo, .env, fcm-service-account.json, package.json sab maujood"

# ---- 1. GIT PULL -----------------------------------------------------------
say "1/6  git pull ($BRANCH)"
git -C "$REPO_ROOT" fetch origin "$BRANCH"
git -C "$REPO_ROOT" checkout "$BRANCH"
git -C "$REPO_ROOT" pull --ff-only origin "$BRANCH"
echo "  HEAD: $(git -C "$REPO_ROOT" rev-parse --short HEAD)"

# ---- 2. API: install -> prisma generate -> build ---------------------------
say "2/6  api-node: install + prisma generate + build"
cd "$API_DIR"
npm install --include=dev --no-audit --no-fund
npx prisma generate          # <-- stale Prisma client wala crash yahin rukta hai
npm run build                # dist/server.js
[ -f "$API_DIR/dist/server.js" ] || die "api build fail: dist/server.js nahi bana"

# ---- 3. API: pm2 restart ---------------------------------------------------
say "3/6  pm2 restart $PM2_APP"
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP" --update-env
else
  pm2 start "$API_DIR/dist/server.js" --name "$PM2_APP" --cwd "$API_DIR"
fi
pm2 save
sleep 2
pm2 list | grep "$PM2_APP" || true

# ---- 4. WEB/ADMIN: build ---------------------------------------------------
say "4/6  web/admin build"
cd "$WEB_DIR"
npm install --include=dev --no-audit --no-fund
npm run build                # tsc -b && vite build -> dist/
[ -f "$WEB_DIR/dist/index.html" ] || die "web build fail: dist/index.html nahi bana"

# ---- 5. WEB: deploy to /var/www/html (SAFE: .htaccess + .env exclude) ------
# --delete JAAN-BUJH KE nahi (purani zaroori files na udein).
# .htaccess exclude = live loop-safe .htaccess chhedo mat.
say "5/6  web -> $WEB_ROOT (rsync, .htaccess/.env protected)"
sudo rsync -a \
  --exclude='.htaccess' \
  --exclude='.env' \
  --exclude='.well-known' \
  "$WEB_DIR/dist/" "$WEB_ROOT/"
sudo chown -R apache:apache "$WEB_ROOT" 2>/dev/null || true
echo "  web files synced ( .htaccess / .env / .well-known chhoda )"

# ---- 6. HEALTH CHECK -------------------------------------------------------
say "6/6  Health check"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
LOGIN=$(code -X POST https://4astore.com/api/users/login -H "Content-Type: application/json" -d '{"u":"x"}' || true)
SEO=$(code https://4astore.com/api/admin/seo-auto/dashboard || true)
HOME=$(code https://4astore.com/ || true)
MAP=$(code https://4astore.com/sitemap.xml || true)
ROB=$(code https://4astore.com/robots.txt || true)
FAV=$(code https://4astore.com/favicon.ico || true)
printf "  home=%s  login=%s  seo=%s  sitemap=%s  robots=%s  favicon=%s\n" "$HOME" "$LOGIN" "$SEO" "$MAP" "$ROB" "$FAV"
echo "  (login 4xx = backend zinda; seo 401 = route live; baaki 200 chahiye)"

say "DONE ✅  — browser me Ctrl+Shift+R (ya Cloudflare purge agar zaroorat ho)"
