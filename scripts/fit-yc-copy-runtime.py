"""Adapt only addresses/credentials on the explicitly identified target VM."""
import json
from pathlib import Path
import subprocess

root = Path('/opt/fit-copy')
c = json.loads((root / 'target.json').read_text())
assert c['folder'] == 'b1gt7dfqg9sht9slnno5'
assert c['vm_id'] == 'fhm0ju8244ctffsq4lvd'
web, api = c['domain'], c['api_domain']
assert c['mode'] == 'standby' and c['cutover_authorized'] is False
assert web == 'fit-training.ru' and api == 'api.fit-training.ru'
replacements = [('87.242.117.210', c['vm_ip']),
                ('10.70.10.4', c['vm_private_ip'])]

def adapt(value):
    for old, new in replacements:
        value = value.replace(old, new)
    return value

def write(path, content, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    path.chmod(mode)

def read_env(path):
    return dict(line.split('=', 1) for line in Path(path).read_text().splitlines()
                if line and not line.startswith('#') and '=' in line)

def write_env(path, values):
    assert all('\n' not in v and '\r' not in v for v in values.values())
    write(path, ''.join(k + '=' + v + '\n' for k, v in values.items()))

api_values = read_env('/opt/fit/secrets/api.env')
# Yandex ID identities depend on this existing application's psuid. Never replace it.
assert api_values['YANDEX_OAUTH_CLIENT_ID'] == 'fdc7e12c472b475690fbb387d8698663'
old_folder = api_values.get('YANDEX_CLOUD_FOLDER_ID', '')
common = {'DATABASE_HOST': c['db_host'], 'DATABASE_PORT': '6432',
          'DATABASE_NAME': 'fit', 'DATABASE_USER': 'fit_api',
          'DATABASE_PASSWORD': c['api_password'], 'DATABASE_SSL_MODE': 'verify-full',
          'FIT_MEDIA_STORAGE_PROVIDER': 'yandex', 'YANDEX_MEDIA_BUCKET': c['bucket'],
          'YANDEX_MEDIA_ACCESS_KEY_ID': c['s3']['access_key'],
          'YANDEX_MEDIA_SECRET_ACCESS_KEY': c['s3']['secret'],
          'YANDEX_CLOUD_FOLDER_ID': c['folder'],
          'YANDEX_CLOUD_API_KEY': c['ai_key']['secret']}
for path in ['/opt/fit/secrets/api.env', '/opt/fit/secrets/background.env']:
    values = {k: adapt(v) for k, v in read_env(path).items()}
    values.update(common)
    if old_folder and values.get('YANDEX_CLOUD_MODEL_ID', '').startswith('gpt://'):
        values['YANDEX_CLOUD_MODEL_ID'] = values['YANDEX_CLOUD_MODEL_ID'].replace(old_folder, c['folder'])
    for key in list(values):
        if key.startswith('CLOUDRU_MEDIA_') or key == 'CLOUDRU_TENANT_ID':
            del values[key]
    write_env(path, values)
speech = {k: adapt(v) for k, v in read_env('/opt/fit/secrets/speech.env').items()}
speech.update(YANDEX_CLOUD_FOLDER_ID=c['folder'], YANDEX_CLOUD_API_KEY=c['ai_key']['secret'])
write_env('/opt/fit/secrets/speech.env', speech)

# Preserve the exact published assets and only relocate their public endpoint configuration.
changed = 0
for path in Path('/opt/fit/frontend').rglob('*'):
    if path.is_symlink() or not path.is_file() or path.suffix not in {'.js', '.json', '.html', '.webmanifest', '.css'}:
        continue
    content = path.read_text()
    target = adapt(content)
    if target != content:
        path.write_text(target)
        changed += 1

for directory in ['/opt/fit-jitsi', '/etc/nginx']:
    for path in Path(directory).rglob('*'):
        if path.is_symlink() or not path.is_file():
            continue
        try:
            content = path.read_text()
        except (UnicodeError, OSError):
            continue
        target = adapt(content)
        if target != content:
            path.write_text(target)
turn = Path('/etc/turnserver.conf')
turn.write_text(adapt(turn.read_text()))

# The deployed speech image has an explicit origin allowlist. Mount its relocated copy.
speech_revision = Path('/opt/fit/SPEECH_RELEASE_SHA').read_text().strip()
subprocess.run(['podman', 'create', '--name', 'fit-copy-speech-extract', 'localhost/fit-speechkit:' + speech_revision], check=True, stdout=subprocess.DEVNULL)
subprocess.run(['podman', 'cp', 'fit-copy-speech-extract:/app/cloudru-server.mjs', str(root / 'speech-cloudru-server.mjs')], check=True, stdout=subprocess.DEVNULL)
subprocess.run(['podman', 'rm', 'fit-copy-speech-extract'], check=True, stdout=subprocess.DEVNULL)
speech_source = root / 'speech-cloudru-server.mjs'
write(speech_source, adapt(speech_source.read_text()), 0o644)
launcher = Path('/usr/local/libexec/fit-cloudru-speechkit')
content = launcher.read_text()
mount = '--mount type=bind,source=/opt/fit-copy/speech-cloudru-server.mjs,target=/app/cloudru-server.mjs,ro=true '
if mount not in content:
    content = content.replace('--env-file /opt/fit/secrets/speech.env ', mount + '--env-file /opt/fit/secrets/speech.env ')
write(launcher, content, 0o755)

background_launcher = Path('/usr/local/libexec/fit-cloudru-background')
background_content = background_launcher.read_text()
background_mount = '--mount type=bind,source=/opt/fit-copy/fit-yc-copy-background.mjs,target=/copy-background.mjs,ro=true '
if background_mount not in background_content:
    background_content = background_content.replace('--env-file /opt/fit/secrets/background.env ', background_mount + '--env-file /opt/fit/secrets/background.env ')
background_content = background_content.replace('node dist/cloudru-background-worker.js', 'node /copy-background.mjs')
write(background_launcher, background_content, 0o755)
(root / 'fit-yc-copy-background.mjs').chmod(0o644)
# Retain the copied background schedule while preventing duplicate production deliveries.
write('/etc/systemd/system/fit-background.service.d/copy-isolation.conf',
      '[Unit]\nConditionPathExists=/opt/fit-copy/ENABLE_BACKGROUND_DELIVERY\n', 0o644)

# The copied API container is managed by systemd on the new VM for reboot recovery.
revision = Path('/opt/fit/RUNNING_SHA').read_text().strip()
write('/etc/systemd/system/fit-api.service', f'''[Unit]
Description=Fit API copied from Cloud.ru
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
ExecStartPre=-/usr/bin/podman rm --force --ignore fit-api-stage
ExecStart=/usr/bin/podman run --name fit-api-stage --publish 127.0.0.1:18080:8080 --env-file /opt/fit/secrets/api.env localhost/fit-api:{revision}
ExecStop=/usr/bin/podman stop --time 10 fit-api-stage
Restart=always
RestartSec=5
TimeoutStopSec=20
[Install]
WantedBy=multi-user.target
''', 0o644)

# Keep the original public HTTP routes and meeting proxy. The old DataLens endpoint
# is retained as a config copy and is not exposed using the source's TLS identity.
write('/etc/nginx/fit-copy.conf', '''user www-data;
worker_processes auto;
pid /run/nginx.pid;
events { worker_connections 768; }
http {
 include /etc/nginx/mime.types;
 default_type application/octet-stream;
 sendfile on;
 tcp_nopush on;
 access_log /var/log/nginx/access.log;
 error_log /var/log/nginx/error.log warn;
 include /opt/fit-jitsi/nginx-origins.conf;
 include /etc/nginx/sites-available/fit-public-api;
 include /etc/nginx/sites-available/fit-public-web;
}
''', 0o644)
write('/etc/systemd/system/nginx.service.d/fit-copy.conf', '''[Service]
ExecStartPre=
ExecStartPre=/usr/sbin/nginx -t -c /etc/nginx/fit-copy.conf
ExecStart=
ExecStart=/usr/sbin/nginx -c /etc/nginx/fit-copy.conf -g 'daemon on; master_process on;'
ExecReload=
ExecReload=/usr/sbin/nginx -c /etc/nginx/fit-copy.conf -g 'daemon on; master_process on;' -s reload
''', 0o644)
write('/etc/systemd/system/coturn.service.d/fit-meetings.conf', Path('/opt/fit-jitsi/coturn-limits.conf').read_text(), 0o644)
write('/etc/letsencrypt/renewal-hooks/deploy/fit-meetings-turn', Path('/opt/fit-jitsi/renew-certificate').read_text(), 0o700)
print(json.dumps({'event': 'copy_runtime_configured', 'frontendFilesRelocated': changed,
                  'oauthClientPreserved': True, 'databaseTarget': c['db_id'],
                  'backgroundDelivery': 'held', 'domain': web}))
