# 4A Store — Live Deployment (AWS Ubuntu + PM2 + Nginx)

Domain: **4astore.com** · API on Node (PM2, port 4000) behind Nginx · MySQL + phpMyAdmin · React web as static files.

> Run everything over SSH on the EC2 instance. Replace placeholders in CAPS.

---

## 0. DNS + AWS basics (one time)

1. **Elastic IP**: EC2 → Elastic IPs → Allocate → Associate to your instance (so the IP never changes).
2. **DNS**: at your domain registrar, point `4astore.com` and `www.4astore.com` → that Elastic IP (A records). Remove any old redirect to `webtoolsz.com`.
3. **Security Group** (EC2 → Security Groups → inbound rules): allow
   - 22 (SSH, your IP only), 80 (HTTP), 443 (HTTPS).
   - Do **NOT** open 3306 or 4000 publicly — they stay internal.

```bash
ssh -i your-key.pem ubuntu@YOUR_ELASTIC_IP
```

---

## 1. Install the stack

```bash
sudo apt update && sudo apt upgrade -y

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# MySQL + Nginx + tools
sudo apt install -y mysql-server nginx git unzip

# PM2 (keeps the API running + auto-starts on reboot)
sudo npm i -g pm2

node -v && npm -v && mysql --version && nginx -v
```

### phpMyAdmin (optional, to manage DB in a browser)
```bash
sudo apt install -y php php-mysql php-mbstring php-zip php-gd php-json php-curl phpmyadmin
# When prompted: choose "apache2" OR none; we'll serve it via Nginx below (section 7).
```

---

## 2. MySQL: create DB + user, import data

```bash
sudo mysql
```
```sql
CREATE DATABASE four_a_store CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER 'four_a_user'@'localhost' IDENTIFIED BY 'STRONG_DB_PASSWORD';
GRANT ALL PRIVILEGES ON four_a_store.* TO 'four_a_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Upload `four_a_store_live.sql` (from your PC: `4astore-v2/four_a_store_live.sql`) to the server, then:
```bash
# from your PC:
scp -i your-key.pem C:\xampp\htdocs\static4a\4astore-v2\four_a_store_live.sql ubuntu@YOUR_ELASTIC_IP:/home/ubuntu/

# on the server:
mysql -u four_a_user -p four_a_store < /home/ubuntu/four_a_store_live.sql
```

---

## 3. Get the code onto the server

Easiest: push your repo to GitHub, then clone. Or `scp` the folder up (exclude node_modules).

```bash
sudo mkdir -p /var/www/4astore
sudo chown -R ubuntu:ubuntu /var/www/4astore
cd /var/www/4astore

# option A: git
git clone YOUR_REPO_URL .
# option B: scp from PC (run on PC), excluding node_modules/dist:
#   scp -i key.pem -r 4astore-v2/api-node ubuntu@IP:/var/www/4astore/
#   scp -i key.pem -r 4astore-v2/web      ubuntu@IP:/var/www/4astore/
```

After this you should have `/var/www/4astore/api-node` and `/var/www/4astore/web`.

---

## 4. API (api-node) → build + PM2

```bash
cd /var/www/4astore/api-node

# .env (production)
cp .env.production.example .env
nano .env
```
Fill in `.env`:
```
PORT=4000
NODE_ENV=production
CORS_ORIGINS=https://4astore.com,https://www.4astore.com
DATABASE_URL="mysql://four_a_user:STRONG_DB_PASSWORD@localhost:3306/four_a_store"
JWT_SECRET=<paste output of: openssl rand -hex 48>
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=365
STORE_LAT=24.580164
STORE_LNG=84.114194
SERVICEABLE_PINCODE=824301
OSRM_URL=https://router.project-osrm.org
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=online4astore@gmail.com
MAIL_PASS=<gmail app password>
MAIL_FROM="4A Store <online4astore@gmail.com>"
FCM_SERVICE_ACCOUNT=./firebase-service-account.json
```
(If you don't have FCM yet, leave `FCM_SERVICE_ACCOUNT=` empty — push just stays off.)

Build + run:
```bash
npm ci
npx prisma generate
npm run build

pm2 start dist/server.js --name 4astore-api
pm2 save
pm2 startup           # run the sudo command it prints, so it survives reboot

curl http://127.0.0.1:4000/api/health   # -> {"success":true,...}
```

### Uploads folder must persist
The API writes payment screenshots to `api-node/uploads/`. Make sure it exists & is writable:
```bash
mkdir -p /var/www/4astore/api-node/uploads/screenshots
```

---

## 5. Web (React) → build static files

Build on the server (or build on PC and upload `dist/`). Same-origin `/api`, so no VITE_API_BASE needed.

```bash
cd /var/www/4astore/web
npm ci
npm run build         # creates web/dist
```

The App-Links file `web/dist/.well-known/assetlinks.json` and `apple-app-site-association` are included automatically from `web/public/.well-known/`.

---

## 6. Nginx (serve web + proxy /api) + SSL

```bash
sudo nano /etc/nginx/sites-available/4astore
```
```nginx
server {
    listen 80;
    server_name 4astore.com www.4astore.com;

    root /var/www/4astore/web/dist;
    index index.html;

    # SPA routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API -> Node (PM2)
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 15M;
    }

    # App Links / Universal Links (served with the right content-type)
    location /.well-known/ {
        root /var/www/4astore/web/dist;
        default_type application/json;
        try_files $uri =404;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/4astore /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Free HTTPS (required — JWT cookies use Secure in production)
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 4astore.com -d www.4astore.com
```

Open `https://4astore.com` → storefront. `https://4astore.com/admin` → admin. `https://4astore.com/rider` → rider.

---

## 7. phpMyAdmin via Nginx (optional)

```bash
sudo ln -s /usr/share/phpmyadmin /var/www/4astore/web/dist/phpmyadmin   # OR a separate server block
sudo apt install -y php-fpm
```
Add inside the server block (then reload nginx):
```nginx
    location /phpmyadmin {
        root /usr/share/;
        index index.php;
        location ~ ^/phpmyadmin/(.+\.php)$ {
            fastcgi_pass unix:/run/php/php-fpm.sock;   # adjust php version if needed
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        }
    }
```
Protect it with a strong MySQL password and ideally HTTP basic-auth / IP allowlist.

---

## 8. Push notifications (FCM) — when ready

1. Firebase console → create project → add Android app `com.store4a.app`.
2. Download `google-services.json` → put in `mobile/` (for the APK build).
3. Project settings → Service accounts → Generate private key → upload JSON to the server as
   `/var/www/4astore/api-node/firebase-service-account.json`, set `FCM_SERVICE_ACCOUNT` in `.env`, then `pm2 restart 4astore-api`.

---

## 9. Mobile app → point at 4astore.com, build, publish

On your PC (the production default is already 4astore.com now):
```powershell
cd c:\xampp\htdocs\static4a\4astore-v2\mobile
# (drop google-services.json here first if you set up FCM)
npx expo prebuild --platform android --clean
cd android
$env:STORE4A_KEYSTORE_PASSWORD="Akash@800"; $env:STORE4A_KEY_PASSWORD="Akash@800"
.\gradlew.bat bundleRelease     # AAB for Play Store (upload to Play Console)
.\gradlew.bat assembleRelease   # APK for direct install / self-host
```
- Play Store: upload the **.aab** as an update of `com.store4a.app` (same signing key → accepted).
- **assetlinks.json** already has this key's SHA-256. If Play uses **Play App Signing**, also add the
  Play "App signing key" SHA-256 (Play Console → App integrity) to `assetlinks.json` and redeploy web.

---

## 10. Updates later (redeploy)

```bash
cd /var/www/4astore
git pull                 # or re-upload changed files
cd api-node && npm ci && npx prisma generate && npm run build && pm2 restart 4astore-api
cd ../web && npm ci && npm run build
# web is static — new dist is served immediately; hard-refresh / the app's assetVersion bump handles caches
```

## Quick health checklist
- `pm2 status` → 4astore-api `online`
- `curl https://4astore.com/api/health` → success
- `https://4astore.com` loads; login works; place a test order
- `https://4astore.com/.well-known/assetlinks.json` returns the JSON
- Admin login → Orders shows the test order; assign a role by mobile; new-order push/alert reaches staff
