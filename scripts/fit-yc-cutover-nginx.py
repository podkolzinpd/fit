"""Preserve original ingress; freeze or forward only the three Fit names."""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

root = Path('/opt/fit-cutover')
mode = sys.argv[1]
assert mode in {'inspect', 'maintenance', 'forward'}
test = subprocess.run(['nginx', '-T'], capture_output=True, text=True, check=True)
paths = []
for name in re.findall(r'^# configuration file (.+):$', test.stdout, re.M):
    path = Path(name).resolve()
    if path in paths:
        continue
    content = path.read_text()
    if re.search(r'^\s*server_name\s+(?:fit-training\.ru|api\.fit-training\.ru)\b', content, re.M):
        paths.append(path)
assert len(paths) == 2, 'unexpected_fit_ingress_files'
print(json.dumps({'event': 'fit_ingress_identified', 'files': [str(p) for p in paths], 'mode': mode}))
if mode == 'inspect':
    sys.exit(0)
root.mkdir(mode=0o700, exist_ok=True)
receipt = root / 'ingress-files.json'
if not receipt.exists():
    assert mode == 'maintenance'
    backups = []
    for i, path in enumerate(paths):
        backup = root / f'ingress-{i}.original'
        assert not backup.exists()
        shutil.copy2(path, backup)
        backup.chmod(0o600)
        backups.append({'path': str(path), 'backup': str(backup)})
    receipt.write_text(json.dumps(backups))
    receipt.chmod(0o600)
for item in json.loads(receipt.read_text()):
    original = Path(item['backup']).read_text()
    path = Path(item['path'])
    if mode == 'maintenance':
        replacement = r'\1\n    add_header Retry-After 120 always;\n    return 503;'
        content, n = re.subn(r'(^\s*server_name\s+[^;]+;)', replacement, original, flags=re.M)
        assert n == 2
    else:
        host = 'api.fit-training.ru' if 'server_name api.fit-training.ru;' in original else 'fit-training.ru'
        names = host if host.startswith('api.') else 'fit-training.ru www.fit-training.ru'
        content = f'''server {{
    listen 80;
    server_name {names};
    location / {{ return 301 https://$host$request_uri; }}
}}
server {{
    listen 443 ssl;
    server_name {names};
    ssl_certificate /etc/letsencrypt/live/{host}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{host}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 50m;
    location / {{
        proxy_pass https://89.169.148.38;
        proxy_ssl_server_name on;
        proxy_ssl_name {host};
        proxy_ssl_verify on;
        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
    }}
}}
'''
    path.write_text(content)
