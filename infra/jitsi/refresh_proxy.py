"""Refresh only managed public proxy snippets; never render/rotate credentials."""
from pathlib import Path
import subprocess
from prepare import write_proxy


assert subprocess.check_output(['hostname'], text=True).strip() == 'fit-stage-app'
directory = Path('/opt/fit-jitsi')
active = Path('/etc/nginx/snippets/fit-jitsi-locations.conf')
assert active.read_bytes() == (directory / 'nginx-locations.conf').read_bytes()
files = {}
write_proxy(lambda name, content: files.update({name: content}))
before = active.read_bytes()
try:
    active.write_text(files['nginx-locations.conf'])
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    subprocess.run(['curl', '--fail', '--silent', '--show-error', '--compressed', '--noproxy', '*',
                    '--retry', '3', '--retry-all-errors', '--max-time', '15',
                    '--resolve', 'api.fit-training.ru:443:127.0.0.1',
                    'https://api.fit-training.ru/libs/lib-jitsi-meet.min.js', '-o', '/dev/null'], check=True)
    (directory / 'nginx-locations.conf').write_text(files['nginx-locations.conf'])
except Exception:
    active.write_bytes(before)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    raise
print('Managed SDK proxy refreshed; compressed transfer verified.')
