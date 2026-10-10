# 4A Store — Deploy guide (safe, repeatable)

Server layout (confirmed):

| Cheez | Path |
|---|---|
| Git repo | `/home/ec2-user/4astore` (branch `main`) |
| Backend (PM2 `4astore-api`) | `/home/ec2-user/4astore/4astore-v2/api-node` → `dist/server.js` |
| Web/admin source | `/home/ec2-user/4astore/4astore-v2/web` |
| Apache DocumentRoot (HTTP+HTTPS) | `/var/www/html` |

Protected files (deploy inhe KABHI nahi chhuta):
`.env` (api + web), `fcm-service-account.json`, `/var/www/html/.htaccess`,
`/var/www/html/phpmyadmin/`, `/var/www/html/.well-known/`

---

## Normal deploy — rozana ka flow

**Local (Windows):**
```bash
cd c:\xampp\htdocs\static4a
git add -A
git commit -m "your change"
git push origin main
```

**Server (EC2) — ek command:**
```bash
bash ~/4astore/4astore-v2/deploy.sh
```

Script khud: git pull → api (install+prisma generate+build+pm2 restart) → web build →
`/var/www/html` me protected rsync → health check. End me `home=200 login=4xx seo=401
sitemap=200 robots=200 favicon=200` aaye = sab theek.

---

## ONE-TIME setup (sirf ek baar, phir kabhi nahi)

### 1. FCM path (push) — .env me RELATIVE path
Backend `.env` me ye hona chahiye (absolute `/var/www/html/...` NAHI):
```
FCM_SERVICE_ACCOUNT=fcm-service-account.json
```
Theek karne ka command:
```bash
sed -i 's#^FCM_SERVICE_ACCOUNT=.*#FCM_SERVICE_ACCOUNT=fcm-service-account.json#' ~/4astore/4astore-v2/api-node/.env
pm2 restart 4astore-api --update-env
```
Verify: `pm2 logs 4astore-api | grep "\[push\]"` → `[push] FCM initialized.` aana chahiye.

### 2. phpMyAdmin — ek baar install (`/var/www/html/phpmyadmin`)
```bash
cd /tmp
sudo tar xzf phpMyAdmin-latest-all-languages.tar.gz
sudo rm -rf /var/www/html/phpmyadmin
sudo mv phpMyAdmin-*-all-languages /var/www/html/phpmyadmin
sudo chown -R apache:apache /var/www/html/phpmyadmin
# config:
cd /var/www/html/phpmyadmin
sudo cp config.sample.inc.php config.inc.php
# blowfish secret (32 char) set karo:
SECRET=$(openssl rand -base64 24)
sudo sed -i "s#\$cfg\['blowfish_secret'\] = '';#\$cfg['blowfish_secret'] = '$SECRET';#" config.inc.php
```

### 3. .htaccess me phpMyAdmin bypass (taaki SPA usse na dhake)
`/var/www/html/.htaccess` me `/api` wali line ke paas ye condition add karo
(RewriteRule se PEHLE):
```apache
  RewriteCond %{REQUEST_URI} !^/phpmyadmin
```
Poora loop-safe .htaccess aise dikhna chahiye:
```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_URI} !^/api
  RewriteCond %{REQUEST_URI} !^/phpmyadmin
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ /index.html [L]
</IfModule>
```
Reload: `sudo systemctl reload httpd`

phpMyAdmin URL (http + IP, domain NAHI):
`http://13.215.20.73/phpmyadmin/`

> Security note: phpMyAdmin public IP pe khula = risk. Behtar: isse apne IP tak
> limit karo (Apache `Require ip <your-ip>`), ya zaroorat ke time hi enable karo.
> DB kaam ke liye `mysql -u root -p four_a_store` CLI bhi kaafi hai.

---

## Agar deploy ke baad kuch toote — turant check
```bash
pm2 logs 4astore-api --lines 40 --nostream   # backend crash?
sudo tail -20 /var/log/httpd/error_log       # apache 500 / .htaccess loop?
cat /var/www/html/.htaccess                   # loop-guard + phpmyadmin bypass hai?
```
Site turant up karne ke liye (routes temporarily off): `sudo mv /var/www/html/.htaccess /tmp/ht.bak`
