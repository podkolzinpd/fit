#!/usr/bin/env bash
set -euo pipefail

RELAY_HOST="84-201-157-124.sslip.io"
CERT_PATH="/etc/letsencrypt/live/$RELAY_HOST/fullchain.pem"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --yes nginx certbot
mkdir -p /var/www/certbot

cat >/etc/nginx/conf.d/fit-speechkit-relay.conf <<NGINX
server {
  listen 80;
  server_name $RELAY_HOST;

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location / {
    proxy_pass http://127.0.0.1:8080;
  }
}
NGINX

nginx -t
systemctl enable --now nginx
systemctl reload nginx

if [[ ! -f "$CERT_PATH" ]]; then
  certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    --domain "$RELAY_HOST" \
    --non-interactive \
    --agree-tos \
    --register-unsafely-without-email
fi

cat >/etc/nginx/conf.d/fit-speechkit-relay.conf <<'NGINX'
server {
  listen 80;
  server_name 84-201-157-124.sslip.io;

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location / {
    return 301 https://$host$request_uri;
  }
}

server {
  listen 443 ssl;
  server_name 84-201-157-124.sslip.io;

  ssl_certificate /etc/letsencrypt/live/84-201-157-124.sslip.io/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/84-201-157-124.sslip.io/privkey.pem;

  location = /stt {
    proxy_pass http://127.0.0.1:8080/stt;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
  }

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
  }
}
NGINX

nginx -t
systemctl reload nginx
systemctl enable --now certbot.timer
