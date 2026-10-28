#!/usr/bin/env python3
"""Render an isolated, bounded bundle for the existing Fit host; no activation."""
import argparse
import hashlib
import ipaddress
from pathlib import Path
import re
import secrets
import shutil


def prepare(destination, public_ip, private_ip, domain):
    public = ipaddress.IPv4Address(public_ip)
    private = ipaddress.IPv4Address(private_ip)
    rfc1918 = ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')
    if not public.is_global or not any(private in ipaddress.ip_network(net) for net in rfc1918):
        raise ValueError('Expected a public IPv4 address and the VM private IPv4 address')
    if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}', domain):
        raise ValueError('Expected a DNS hostname')
    source = Path(__file__).with_name('compose.upstream.yml')
    if hashlib.sha256(source.read_bytes()).hexdigest() != 'da7904e9efb376c08773ca8e6f75fc4079a2fe869703cd1fdd263bb3439b22c8':
        raise ValueError('Upstream compose checksum mismatch')
    # Refuse reruns: regenerating credentials on an existing installation breaks peers.
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)

    def write(name, content, mode=0o600):
        path = destination / name
        path.write_text(content)
        path.chmod(mode)

    jwt_secret = secrets.token_hex(32)
    turn_secret = secrets.token_hex(32)
    values = {
        'CONFIG': '/opt/fit-jitsi/config',
        'JITSI_IMAGE_VERSION': 'stable-11248-2',
        'HTTP_PORT': '127.0.0.1:8000', 'HTTPS_PORT': '127.0.0.1:8443',
        'PUBLIC_URL': f'https://{domain}', 'TZ': 'UTC',
        'DISABLE_HTTPS': '1', 'ENABLE_HTTP_REDIRECT': '0',
        'ENABLE_LETSENCRYPT': '0', 'ENABLE_JAAS_COMPONENTS': '0',
        'ENABLE_AUTH': '1', 'AUTH_TYPE': 'jwt', 'ENABLE_GUESTS': '0',
        'JWT_ALLOW_EMPTY': '0', 'JWT_APP_ID': 'fit',
        'JWT_APP_SECRET': jwt_secret, 'JWT_ACCEPTED_ISSUERS': 'fit',
        'JWT_ACCEPTED_AUDIENCES': 'jitsi', 'JWT_ENABLE_DOMAIN_VERIFICATION': 'true',
        'JWT_TOKEN_AUTH_MODULE': 'token_verification',
        'XMPP_DOMAIN': 'meet.jitsi', 'XMPP_AUTH_DOMAIN': 'auth.meet.jitsi',
        'XMPP_MUC_DOMAIN': 'muc.meet.jitsi',
        'XMPP_INTERNAL_MUC_DOMAIN': 'internal-muc.meet.jitsi',
        'XMPP_SERVER': 'xmpp.meet.jitsi',
        'JICOFO_AUTH_PASSWORD': secrets.token_hex(32),
        'JVB_AUTH_PASSWORD': secrets.token_hex(32),
        'ENABLE_XMPP_WEBSOCKET': '1',
        'JVB_ADVERTISE_IPS': str(public), 'JVB_ADVERTISE_PRIVATE_CANDIDATES': '0',
        'JVB_DISABLE_STUN': '1', 'JVB_PORT': '10000',
        'JICOFO_MAX_MEMORY': '256m', 'VIDEOBRIDGE_MAX_MEMORY': '640m',
        'ENABLE_RECORDING': '0', 'ENABLE_TRANSCRIPTIONS': '0',
        'ENABLE_TRACING': '0', 'DISABLE_POLLS': '1',
        'TURNS_HOST': domain, 'TURNS_PORT': '5349', 'TURN_TTL': '600',
        'TURN_CREDENTIALS': turn_secret, 'LOG_LEVEL': 'warn',
    }
    write('.env', ''.join(f'{key}={value}\n' for key, value in values.items()))
    shutil.copyfile(source, destination / 'compose.yml')
    write('compose.fit.yml', '''services:
  web:
    mem_limit: 128m
    cpus: 0.15
    cgroup_parent: fit-jitsi.slice
    logging: {driver: none}
  prosody:
    mem_limit: 256m
    cpus: 0.25
    cgroup_parent: fit-jitsi.slice
    logging: {driver: none}
  jicofo:
    mem_limit: 512m
    cpus: 0.25
    cgroup_parent: fit-jitsi.slice
    logging: {driver: none}
  jvb:
    mem_limit: 1024m
    cpus: 0.75
    cgroup_parent: fit-jitsi.slice
    logging: {driver: none}
''')
    write('api.env.fragment', '\n'.join([
        'JITSI_ENABLED=false', f'JITSI_ORIGIN=https://{domain}',
        'JITSI_XMPP_DOMAIN=meet.jitsi', 'JITSI_MUC_DOMAIN=muc.meet.jitsi',
        'JITSI_APP_ID=fit', f'JITSI_JWT_SECRET={jwt_secret}', '',
    ]))
    # No query strings or WebSocket URLs in access/error logs (they can carry JWT).
    origins = ['https://fit-training.ru', 'https://www.fit-training.ru',
               'capacitor://localhost', 'http://localhost', 'https://localhost']
    allowed = '\n'.join(f'    "{origin}" 1;' for origin in origins)
    write('nginx-origins.conf', f'''map $http_origin $fit_meeting_origin {{
    default 0;
{allowed}
}}
''')
    write('nginx-locations.conf', '''
    location ^~ /libs/ {{
        access_log off;
        error_log /dev/null crit;
        proxy_pass http://127.0.0.1:8000;
        proxy_hide_header Access-Control-Allow-Origin;
        add_header Access-Control-Allow-Origin "*" always;
        add_header X-Content-Type-Options nosniff always;
    }}
    location = /xmpp-websocket {{
        access_log off;
        error_log /dev/null crit;
        if ($fit_meeting_origin = 0) {{ return 403; }}
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 90s;
    }}
    location ^~ /colibri-ws/ {{
        access_log off;
        error_log /dev/null crit;
        if ($fit_meeting_origin = 0) {{ return 403; }}
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 90s;
    }}
'''.replace('{{', '{').replace('}}', '}'))
    write('turnserver.conf', f'''listening-ip={private}
relay-ip={private}
external-ip={public}/{private}
listening-port=3478
tls-listening-port=5349
min-port=49160
max-port=49200
realm={domain}
server-name={domain}
fingerprint
use-auth-secret
static-auth-secret={turn_secret}
cert=/etc/fit-jitsi/fullchain.pem
pkey=/etc/fit-jitsi/privkey.pem
no-cli
no-tlsv1
no-tlsv1_1
no-dtls
no-tcp-relay
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
user-quota=4
total-quota=40
no-stdout-log
log-file=/dev/null
''')
    write('fit-jitsi.service', '''[Unit]
Description=Fit meeting infrastructure
Requires=fit-jitsi.slice
Wants=network-online.target
After=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/fit-jitsi
EnvironmentFile=/opt/fit-jitsi/.env
ExecStart=/usr/bin/podman-compose --podman-run-args=--cgroup-parent=fit-jitsi.slice -p fit-jitsi -f compose.yml -f compose.fit.yml up -d
ExecStop=/usr/bin/podman-compose -p fit-jitsi -f compose.yml -f compose.fit.yml down
TimeoutStartSec=300
StandardOutput=null
StandardError=null
[Install]
WantedBy=multi-user.target
''')
    write('fit-jitsi.slice', '''[Unit]
Description=Fit meetings aggregate resource budget
[Slice]
CPUQuota=100%
CPUWeight=20
MemoryHigh=1800M
MemoryMax=2G
MemorySwapMax=0
IOWeight=20
''')
    write('coturn-limits.conf', '''[Service]
Slice=fit-jitsi.slice
MemoryMax=128M
CPUQuota=10%
''')
    write('renew-certificate', f'''#!/bin/sh
set -eu
[ "$RENEWED_LINEAGE" = /etc/letsencrypt/live/{domain} ] || exit 0
install -d -m 750 -o root -g turnserver /etc/fit-jitsi
install -m 640 -o root -g turnserver "$RENEWED_LINEAGE/fullchain.pem" /etc/fit-jitsi/fullchain.pem
install -m 640 -o root -g turnserver "$RENEWED_LINEAGE/privkey.pem" /etc/fit-jitsi/privkey.pem
nginx -t
systemctl reload nginx
systemctl restart coturn
''', 0o700)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--public-ip', required=True)
    parser.add_argument('--private-ip', required=True)
    parser.add_argument('--domain', default='api.fit-training.ru')
    args = parser.parse_args()
    prepare(args.output, args.public_ip, args.private_ip, args.domain)
    print('Bundle prepared with mode 0700; credentials written only to protected files. No services activated.')
