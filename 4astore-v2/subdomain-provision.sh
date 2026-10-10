#!/usr/bin/env bash
# =============================================================================
# subdomain-provision.sh  —  ek command me poora subdomain setup
#
# Kya karta hai (EC2 / Amazon Linux pe, sudo ke saath):
#   1. Cloudflare API se DNS A-record banata hai   <sub>.4astore.com -> SERVER_IP
#   2. /var/www/sites/<sub> folder + sample index.html banata hai
#   3. Us subdomain ke liye Apache vhost likhta hai + reload
#   4. SFTP-only chroot user banata hai jo SIRF us folder tak limited hai
#      (SSH shell NAHI milta, sirf file upload/download — FileZilla/WinSCP)
#   5. Login credentials print karta hai
#
# Pehli baar:
#   cp subdomain-provision.env.example subdomain-provision.env
#   nano subdomain-provision.env          # Cloudflare token, zone id, server ip bharo
#   chmod 600 subdomain-provision.env
#   sudo bash subdomain-provision.sh shop1
#
# Dobara koi subdomain:  sudo bash subdomain-provision.sh shop2
# Hatao (undo):          sudo bash subdomain-provision.sh --remove shop2
# =============================================================================

set -euo pipefail

# ---- rang / helpers --------------------------------------------------------
say()  { printf "\n\033[1;36m==== %s ====\033[0m\n" "$1"; }
ok()   { printf "  \033[1;32mOK:\033[0m %s\n" "$1"; }
warn() { printf "  \033[1;33m!!\033[0m %s\n" "$1"; }
die()  { printf "\n\033[1;31mABORT: %s\033[0m\n" "$1" >&2; exit 1; }

# ---- root check ------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "root ke saath chalao:  sudo bash $0 <subdomain>"

# ---- config load -----------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/subdomain-provision.env"
[ -f "$ENV_FILE" ] || die "config nahi mila: $ENV_FILE  (example copy karke bharo)"
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${CF_API_TOKEN:?CF_API_TOKEN env me set karo}"
: "${CF_ZONE_ID:?CF_ZONE_ID env me set karo}"
: "${ROOT_DOMAIN:?ROOT_DOMAIN env me set karo}"
: "${SERVER_IP:?SERVER_IP env me set karo}"
CF_PROXIED="${CF_PROXIED:-true}"
SITES_ROOT="${SITES_ROOT:-/var/www/sites}"
VHOST_DIR="${VHOST_DIR:-/etc/httpd/conf.d}"
APACHE_SERVICE="${APACHE_SERVICE:-httpd}"
WEB_GROUP="${WEB_GROUP:-apache}"
SFTP_GROUP="${SFTP_GROUP:-sftpusers}"

# ---- args ------------------------------------------------------------------
MODE="create"
if [ "${1:-}" = "--remove" ]; then
  MODE="remove"; shift
fi
RAW_SUB="${1:-}"
[ -n "$RAW_SUB" ] || die "subdomain naam do.  misaal:  sudo bash $0 shop1"

# subdomain sanitize: lowercase, sirf a-z 0-9 aur hyphen, 1-30 char
SUB="$(printf '%s' "$RAW_SUB" | tr '[:upper:]' '[:lower:]')"
if ! printf '%s' "$SUB" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$'; then
  die "galat subdomain '$RAW_SUB' — sirf a-z, 0-9, hyphen; 1-30 char; hyphen se shuru/khatam nahi"
fi

FQDN="${SUB}.${ROOT_DOMAIN}"
SITE_DIR="${SITES_ROOT}/${SUB}"
VHOST_FILE="${VHOST_DIR}/sub-${SUB}.conf"
SFTP_USER="sftp_${SUB}"

CF_API="https://api.cloudflare.com/client/v4"
cf() {
  # cf <method> <path> [json-body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" "${CF_API}${path}" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$body"
  else
    curl -sS -X "$method" "${CF_API}${path}" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json"
  fi
}

# jq optional — agar na ho toh grep se nikaalenge
have_jq() { command -v jq >/dev/null 2>&1; }

# =============================================================================
# REMOVE mode
# =============================================================================
if [ "$MODE" = "remove" ]; then
  say "REMOVE: ${FQDN}"

  # 1. Cloudflare DNS record delete
  say "Cloudflare DNS record dhoondh ke delete"
  LIST="$(cf GET "/zones/${CF_ZONE_ID}/dns_records?type=A&name=${FQDN}")"
  if have_jq; then
    REC_ID="$(printf '%s' "$LIST" | jq -r '.result[0].id // empty')"
  else
    REC_ID="$(printf '%s' "$LIST" | grep -oE '"id":"[a-f0-9]{32}"' | head -1 | cut -d'"' -f4)"
  fi
  if [ -n "${REC_ID:-}" ]; then
    cf DELETE "/zones/${CF_ZONE_ID}/dns_records/${REC_ID}" >/dev/null && ok "DNS record hata diya"
  else
    warn "DNS record nahi mila (shayad pehle hi hata hua)"
  fi

  # 2. Apache vhost
  if [ -f "$VHOST_FILE" ]; then
    rm -f "$VHOST_FILE" && ok "vhost hataya: $VHOST_FILE"
    systemctl reload "$APACHE_SERVICE" 2>/dev/null || systemctl restart "$APACHE_SERVICE" || true
  else
    warn "vhost file nahi mila"
  fi

  # 3. SFTP user
  if id "$SFTP_USER" >/dev/null 2>&1; then
    userdel "$SFTP_USER" 2>/dev/null || true
    ok "SFTP user hataya: $SFTP_USER"
  else
    warn "SFTP user nahi mila"
  fi

  warn "Folder JAAN-BUJH ke nahi hataya (data safety): $SITE_DIR"
  warn "Agar sach me delete karna hai:  sudo rm -rf '$SITE_DIR'"
  say "REMOVE DONE ✅"
  exit 0
fi

# =============================================================================
# CREATE mode
# =============================================================================
say "0/5  Pre-flight"
command -v curl >/dev/null 2>&1 || die "curl install karo"
have_jq || warn "jq nahi mila — grep fallback use hoga (jq recommend hai: sudo yum install -y jq)"
# Cloudflare token verify
VERIFY="$(cf GET "/user/tokens/verify" || true)"
printf '%s' "$VERIFY" | grep -q '"success":true' || die "Cloudflare token galat/expire (verify fail). Token aur permissions check karo."
ok "Cloudflare token valid"
ok "Target: ${FQDN} -> ${SERVER_IP} (proxied=${CF_PROXIED})"

# ---- 1. Cloudflare DNS -----------------------------------------------------
say "1/5  Cloudflare DNS A-record"
EXISTING="$(cf GET "/zones/${CF_ZONE_ID}/dns_records?type=A&name=${FQDN}")"
if have_jq; then
  EXIST_ID="$(printf '%s' "$EXISTING" | jq -r '.result[0].id // empty')"
else
  EXIST_ID="$(printf '%s' "$EXISTING" | grep -oE '"id":"[a-f0-9]{32}"' | head -1 | cut -d'"' -f4)"
fi
DNS_BODY="$(printf '{"type":"A","name":"%s","content":"%s","ttl":1,"proxied":%s}' "$FQDN" "$SERVER_IP" "$CF_PROXIED")"
if [ -n "${EXIST_ID:-}" ]; then
  RESP="$(cf PUT "/zones/${CF_ZONE_ID}/dns_records/${EXIST_ID}" "$DNS_BODY")"
  printf '%s' "$RESP" | grep -q '"success":true' || die "DNS update fail: $RESP"
  ok "DNS record update hua (pehle se tha)"
else
  RESP="$(cf POST "/zones/${CF_ZONE_ID}/dns_records" "$DNS_BODY")"
  printf '%s' "$RESP" | grep -q '"success":true' || die "DNS create fail: $RESP"
  ok "DNS record banaya"
fi

# ---- 2. Folder -------------------------------------------------------------
say "2/5  Site folder"
mkdir -p "$SITE_DIR"
if [ ! -f "$SITE_DIR/index.html" ]; then
  cat > "$SITE_DIR/index.html" <<HTML
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${FQDN}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}
.card{text-align:center}.card code{background:#1e293b;padding:.2em .5em;border-radius:6px}</style>
</head><body><div class="card">
<h1>${FQDN}</h1>
<p>Subdomain live hai 🎉 — apna code yahan SFTP se upload karo:</p>
<p><code>${SITE_DIR}</code></p>
</div></body></html>
HTML
  ok "sample index.html banaya"
else
  ok "folder pehle se hai, index.html chhoda"
fi

# ---- 3. Apache vhost -------------------------------------------------------
say "3/5  Apache vhost"
cat > "$VHOST_FILE" <<CONF
# Auto-generated by subdomain-provision.sh for ${FQDN}
<VirtualHost *:80>
    ServerName ${FQDN}
    DocumentRoot ${SITE_DIR}
    <Directory ${SITE_DIR}>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    ErrorLog  /var/log/httpd/${SUB}-error.log
    CustomLog /var/log/httpd/${SUB}-access.log combined
</VirtualHost>
CONF
ok "vhost likha: $VHOST_FILE"
# config test + reload
if command -v apachectl >/dev/null 2>&1; then
  apachectl configtest 2>&1 | sed 's/^/  /' || die "Apache config test fail — vhost check karo"
fi
systemctl reload "$APACHE_SERVICE" 2>/dev/null || systemctl restart "$APACHE_SERVICE" || die "Apache reload fail"
ok "Apache reload ho gaya"

# ---- 4. SFTP chroot user ---------------------------------------------------
say "4/5  SFTP-only user (chroot)"

# 4a. group
getent group "$SFTP_GROUP" >/dev/null 2>&1 || groupadd "$SFTP_GROUP"
ok "group: $SFTP_GROUP"

# 4b. sshd config block (ek baar) — SFTP users ko chroot karega
SSHD_SNIPPET="/etc/ssh/sshd_config.d/zz-sftp-${SFTP_GROUP}.conf"
if [ -d /etc/ssh/sshd_config.d ]; then
  TARGET_SNIPPET="$SSHD_SNIPPET"
else
  TARGET_SNIPPET="/etc/ssh/sshd_config"
fi
if ! grep -q "Match Group ${SFTP_GROUP}" "$TARGET_SNIPPET" 2>/dev/null; then
  {
    echo ""
    echo "# --- SFTP-only chroot (added by subdomain-provision.sh) ---"
    echo "Match Group ${SFTP_GROUP}"
    echo "    ChrootDirectory %h"
    echo "    ForceCommand internal-sftp"
    echo "    AllowTcpForwarding no"
    echo "    X11Forwarding no"
    echo "    PermitTunnel no"
  } >> "$TARGET_SNIPPET"
  ok "sshd chroot rule add kiya: $TARGET_SNIPPET"
  # agar main sshd_config me subsystem internal-sftp nahi hai toh ensure karo
  if ! grep -Eq '^\s*Subsystem\s+sftp\s+internal-sftp' /etc/ssh/sshd_config; then
    if grep -Eq '^\s*Subsystem\s+sftp' /etc/ssh/sshd_config; then
      sed -i 's#^\s*Subsystem\s\+sftp.*#Subsystem sftp internal-sftp#' /etc/ssh/sshd_config
      ok "Subsystem sftp -> internal-sftp set kiya"
    fi
  fi
  sshd -t 2>&1 | sed 's/^/  /' || die "sshd config test fail — ruko, kuch galat hai"
  systemctl restart sshd && ok "sshd restart (chroot active)"
else
  ok "sshd chroot rule pehle se hai"
fi

# 4c. user banao / password set karo
#  Chroot ke liye: user ka HOME = chroot jail, jo ROOT ke paas hona chahiye (root:root, 755).
#  Asli writable folder jail ke andar ek subfolder hoga jo site folder pe bind-mount hai.
USER_HOME="/home/${SFTP_USER}"
UPLOAD_DIR="${USER_HOME}/upload"   # yahan upload karega; ye site folder se bind-mount

if id "$SFTP_USER" >/dev/null 2>&1; then
  ok "user pehle se hai: $SFTP_USER"
else
  useradd -g "$SFTP_GROUP" -d "$USER_HOME" -s /sbin/nologin "$SFTP_USER"
  ok "user banaya: $SFTP_USER"
fi

# chroot jail ownership (root:root 755 — ye SSH ki hard requirement hai)
mkdir -p "$USER_HOME"
chown root:root "$USER_HOME"
chmod 755 "$USER_HOME"

# upload folder (yahin user likh sakta hai)
mkdir -p "$UPLOAD_DIR"

# site folder ko jail ke andar laane ke liye bind-mount (symlink chroot me kaam nahi karta)
if ! mountpoint -q "$UPLOAD_DIR"; then
  mount --bind "$SITE_DIR" "$UPLOAD_DIR"
  ok "bind-mount: $SITE_DIR -> $UPLOAD_DIR"
  # reboot ke baad bhi rahe
  FSTAB_LINE="${SITE_DIR} ${UPLOAD_DIR} none bind 0 0"
  grep -qF "$FSTAB_LINE" /etc/fstab || echo "$FSTAB_LINE" >> /etc/fstab
  ok "fstab me bind-mount persist kiya"
else
  ok "bind-mount pehle se active"
fi

# upload folder ko user + web-group dono likh/parh sakein
chown "${SFTP_USER}:${WEB_GROUP}" "$SITE_DIR"
chmod 2775 "$SITE_DIR"
ok "permissions set (user upload kar sake, apache serve kar sake)"

# random password banao
if command -v openssl >/dev/null 2>&1; then
  SFTP_PASS="$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9' | head -c 14)"
else
  SFTP_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14)"
fi
echo "${SFTP_USER}:${SFTP_PASS}" | chpasswd
ok "password set kiya"
# password auth sftp ke liye on hona chahiye (agar sshd me off hai toh warn)
if grep -Eq '^\s*PasswordAuthentication\s+no' /etc/ssh/sshd_config; then
  warn "sshd me PasswordAuthentication no hai — SFTP password login block ho sakta hai."
  warn "Agar password se login na ho, toh SSH key use karo ya PasswordAuthentication yes karo."
fi

# ---- 5. summary ------------------------------------------------------------
say "5/5  DONE ✅"
cat <<SUMMARY

  Subdomain : https://${FQDN}
  Folder    : ${SITE_DIR}
  Vhost     : ${VHOST_FILE}

  SFTP login (FileZilla / WinSCP):
    Protocol : SFTP (SSH File Transfer)
    Host     : ${SERVER_IP}   (ya ${ROOT_DOMAIN})
    Port     : 22
    User     : ${SFTP_USER}
    Password : ${SFTP_PASS}
    Upload   : login karte hi 'upload' folder me files daalo
               (wahi ${SITE_DIR} hai — site turant live)

  Hatao      : sudo bash $0 --remove ${SUB}

  NOTE: Cloudflare DNS propagate hone me 1-2 min lag sakte hain.
        Proxied=on hai toh SSL Cloudflare auto dega.
SUMMARY
