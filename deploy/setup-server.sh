#!/usr/bin/env bash
# One-time server setup: nginx + HTTPS (Let's Encrypt) + "deploy" user for GitHub Actions.
# Usage (as root): bash setup-server.sh example.com you@example.com "ssh-ed25519 AAAA... github-actions"
set -euo pipefail

DOMAIN="${1:?domain required, e.g. corvexo.com}"
EMAIL="${2:?email required for Lets Encrypt certificate}"
PUBKEY="${3:?public SSH key for the deploy user required}"
WEBROOT=/var/www/corvexo

# --- packages ---
if command -v dnf >/dev/null || command -v yum >/dev/null; then
  PM=$(command -v dnf || command -v yum)
  $PM install -y epel-release || true
  $PM install -y nginx rsync certbot python3-certbot-nginx
else
  apt-get update
  apt-get install -y nginx rsync certbot python3-certbot-nginx
fi

# --- deploy user (key-only login, owns the web root) ---
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "$PUBKEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

install -d -m 755 -o deploy -g deploy "$WEBROOT"
[ -f "$WEBROOT/index.html" ] || echo "<h1>$DOMAIN</h1>" > "$WEBROOT/index.html"
chown -R deploy:deploy "$WEBROOT"

# SELinux (RHEL/CentOS/Alma/Rocky): let nginx read the web root
if command -v getenforce >/dev/null && [ "$(getenforce)" != "Disabled" ]; then
  command -v semanage >/dev/null || $PM install -y policycoreutils-python-utils || true
  semanage fcontext -a -t httpd_sys_content_t "$WEBROOT(/.*)?" 2>/dev/null || true
  restorecon -R "$WEBROOT"
fi

# --- nginx site ---
cat > /etc/nginx/conf.d/corvexo.conf <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__ www.__DOMAIN__;
    root __WEBROOT__;
    index index.html;

    location / {
        try_files $uri $uri.html $uri/ =404;
    }

    location ~* \.(png|jpg|jpeg|svg|webp|ico|css|js)$ {
        expires 7d;
        add_header Cache-Control "public";
    }
}
NGINX
sed -i "s#__DOMAIN__#$DOMAIN#g; s#__WEBROOT__#$WEBROOT#g" /etc/nginx/conf.d/corvexo.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# --- firewall ---
if command -v firewall-cmd >/dev/null && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http --add-service=https
  firewall-cmd --reload
elif command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow 'Nginx Full'
fi

# --- HTTPS (domain DNS must already point to this server) ---
DOMAINS=(-d "$DOMAIN")
getent hosts "www.$DOMAIN" >/dev/null && DOMAINS+=(-d "www.$DOMAIN")
certbot --nginx -n --agree-tos --redirect -m "$EMAIL" "${DOMAINS[@]}"
systemctl enable --now certbot-renew.timer 2>/dev/null || systemctl enable --now certbot.timer 2>/dev/null || true

echo "Done: https://$DOMAIN"
