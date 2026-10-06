#!/usr/bin/env bash
# ============================================================================
# 4A Store v2 — Safe Deploy Script
# ----------------------------------------------------------------------------
# Pulls the latest code and redeploys api-node + web to /var/www/html WITHOUT
# ever touching the server-only secret/data files:
#   - api-node/.env, web/.env            (environment secrets)
#   - api-node/fcm-service-account.json  (FCM push credentials)
#   - api-node/uploads/                  (user-uploaded files)
#   - web/public/data/                   (runtime data)
#
# Usage:   bash ~/4astore/4astore-v2/deploy.sh
# ============================================================================
set -euo pipefail

# ---- Paths (edit here if the server layout changes) ------------------------
REPO_DIR="/home/ec2-user/4astore"
SRC_API="$REPO_DIR/4astore-v2/api-node"
SRC_WEB="$REPO_DIR/4astore-v2/web"
LIVE_API="/var/www/html/api-node"
LIVE_WEB="/var/www/html/web"
PM2_APP="4astore-api"
WEB_OWNER="ec2-user:apache"

# rsync excludes: these NEVER get overwritten or deleted on the live server
API_EXCLUDES=(--exclude='.env' --exclude='node_modules' --exclude='fcm-service-account.json' --exclude='uploads' --exclude='*.log')
WEB_EXCLUDES=(--exclude='.env' --exclude='node_modules' --exclude='dist' --exclude='public/data')

echo "=============================================="
echo " 4A Store deploy — $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================="

# ---- 0. Pre-flight: confirm the secret files exist BEFORE we touch anything -
echo "[0/6] Pre-flight check of required server files..."
MISSING=0
for f in "$LIVE_API/.env" "$LIVE_API/fcm-service-account.json" "$LIVE_WEB/.env"; do
  if [ -e "$f" ]; then
    echo "   OK   $f"
  else
    echo "   MISSING  $f"
    MISSING=1
  fi
done
if [ "$MISSING" = "1" ]; then
  echo "ABORT: a required server file is missing. Fix it before deploying."
  exit 1
fi

# ---- 1. Pull latest code ----------------------------------------------------
echo "[1/6] Pulling latest code in $REPO_DIR ..."
cd "$REPO_DIR"
git pull origin main

# ---- 2. Sync api-node (secrets/uploads preserved via excludes) --------------
echo "[2/6] Syncing api-node -> $LIVE_API (preserving .env, fcm, uploads) ..."
sudo rsync -a --delete "${API_EXCLUDES[@]}" "$SRC_API/" "$LIVE_API/"

# ---- 3. Build + restart api-node -------------------------------------------
echo "[3/6] Building api-node ..."
cd "$LIVE_API"
npm install
npx prisma generate
npm run build
echo "   Restarting $PM2_APP ..."
pm2 restart "$PM2_APP"

# ---- 4. Sync web (secrets/data preserved via excludes) ----------------------
echo "[4/6] Syncing web -> $LIVE_WEB (preserving .env, public/data) ..."
sudo rsync -a --delete "${WEB_EXCLUDES[@]}" "$SRC_WEB/" "$LIVE_WEB/"

# ---- 5. Build web -----------------------------------------------------------
echo "[5/6] Building web ..."
cd "$LIVE_WEB"
npm install
npm run build
sudo chown -R "$WEB_OWNER" "$LIVE_WEB/dist" || true

# ---- 6. Post-deploy verification -------------------------------------------
echo "[6/6] Verifying required files survived + services are up ..."
for f in "$LIVE_API/.env" "$LIVE_API/fcm-service-account.json" "$LIVE_WEB/.env"; do
  [ -e "$f" ] && echo "   OK   $f" || echo "   LOST!!!  $f  <-- investigate"
done
# FCM must be a real file with content, not an empty/broken link
if head -c 20 "$LIVE_API/fcm-service-account.json" >/dev/null 2>&1; then
  echo "   OK   fcm-service-account.json is readable"
else
  echo "   WARN fcm-service-account.json is NOT readable — push will be disabled!"
fi
pm2 status "$PM2_APP" || true

echo "=============================================="
echo " Deploy complete."
echo " Tip: check FCM init ->  pm2 logs $PM2_APP --lines 20 --nostream | grep -i fcm"
echo "=============================================="
