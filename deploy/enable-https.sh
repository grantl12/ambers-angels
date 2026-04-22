#!/bin/bash
# Run this on the DigitalOcean VPS to enable HTTPS via Let's Encrypt.
# Prerequisites: DNS A records for amberangels.org must already point to this server.
#
# Usage: bash enable-https.sh

set -e

DOMAIN="amberangels.org"
CONF_SRC="$(dirname "$0")/nginx.conf"
CONF_DEST="/etc/nginx/sites-available/amberangels"

echo "==> Installing certbot..."
apt-get install -y certbot python3-certbot-nginx

echo "==> Copying nginx config..."
cp "$CONF_SRC" "$CONF_DEST"
chmod 644 "$CONF_DEST"

echo "==> Enabling site..."
ln -sf "$CONF_DEST" /etc/nginx/sites-enabled/amberangels
rm -f /etc/nginx/sites-enabled/default

echo "==> Testing nginx config..."
nginx -t

echo "==> Starting nginx (if not running)..."
systemctl enable nginx
systemctl start nginx

echo "==> Running certbot..."
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --email admin@amberangels.org --redirect

echo "==> Reloading nginx..."
systemctl reload nginx

echo ""
echo "Done. HTTPS is live at https://$DOMAIN"
echo "Certbot auto-renewal is handled by the certbot systemd timer."
echo "Verify with: systemctl status certbot.timer"
