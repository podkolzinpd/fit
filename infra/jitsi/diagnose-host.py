"""Bounded diagnostics for this task's containers; redact secrets before stdout."""
import json
from pathlib import Path
import re
import subprocess


def run(args, timeout=30):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


assert run(['hostname']).stdout.strip() == 'fit-stage-app'
secret_values = [line.split('=', 1)[1] for line in Path('/opt/fit-jitsi/.env').read_text().splitlines()
                 if '=' in line and any(key in line.split('=', 1)[0] for key in ['SECRET', 'PASSWORD', 'CREDENTIALS'])]


def redact(text):
    for value in secret_values:
        if value:
            text = text.replace(value, '[redacted]')
    text = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[jwt-redacted]', text)
    return text


run(['systemctl', 'start', 'fit-jitsi.service'], timeout=90)
try:
    ids = run(['podman', 'ps', '-a', '--filter', 'label=io.podman.compose.project=fit-jitsi', '--format', '{{.ID}}']).stdout.split()
    for container in ids:
        data = json.loads(run(['podman', 'inspect', container]).stdout)[0]
        print(json.dumps({
            'name': data['Name'], 'state': data['State']['Status'],
            'exitCode': data['State']['ExitCode'], 'error': redact(data['State'].get('Error', '')),
            'user': data['Config'].get('User'), 'parent': data['HostConfig'].get('CgroupParent'),
            'memory': data['HostConfig'].get('Memory'),
            'service': data['Config']['Labels'].get('com.docker.compose.service'),
        }))
        if data['State']['Status'] != 'running':
            try:
                process = run(['podman', 'start', '--attach', container], timeout=8)
                output = process.stdout + process.stderr
            except subprocess.TimeoutExpired as error:
                output = (error.stdout or b'').decode() + (error.stderr or b'').decode()
            print(redact(output)[-6000:])
finally:
    run(['systemctl', 'stop', 'fit-jitsi.service'], timeout=60)
