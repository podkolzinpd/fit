#!/usr/bin/env python3
"""Merge only meeting settings inside the VM; never print secret values."""
import argparse
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import tempfile


KEYS = {'JITSI_ENABLED', 'JITSI_ORIGIN', 'JITSI_XMPP_DOMAIN',
        'JITSI_MUC_DOMAIN', 'JITSI_APP_ID', 'JITSI_JWT_SECRET'}


def parse(text):
    values = {}
    for line in text.splitlines():
        if not line:
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=([^\x00-\x1f\x7f]*)', line)
        if not match or match[1] in values:
            raise ValueError('Invalid or duplicate environment entry')
        values[match[1]] = match[2]
    return values


def merge(current, fragment, server, enabled):
    old, added, provider = parse(current), parse(fragment), parse(server)
    expected = {'JITSI_ORIGIN': 'https://api.fit-training.ru',
                'JITSI_XMPP_DOMAIN': 'meet.jitsi', 'JITSI_MUC_DOMAIN': 'muc.meet.jitsi',
                'JITSI_APP_ID': 'fit'}
    if set(added) != KEYS or any(added.get(k) != v for k, v in expected.items()):
        raise ValueError('Unexpected meeting target')
    if added['JITSI_ENABLED'] != 'false' or not re.fullmatch(r'[0-9a-f]{64}', added['JITSI_JWT_SECRET']):
        raise ValueError('Invalid protected fragment')
    if added['JITSI_JWT_SECRET'] != provider.get('JWT_APP_SECRET'):
        raise ValueError('Provider credential mismatch')
    # Never silently rotate a previously configured API credential.
    if old.get('JITSI_JWT_SECRET', added['JITSI_JWT_SECRET']) != added['JITSI_JWT_SECRET']:
        raise ValueError('Existing credential mismatch')
    added['JITSI_ENABLED'] = 'true' if enabled else 'false'
    retained = [line for line in current.splitlines() if line.split('=', 1)[0] not in KEYS]
    result = '\n'.join(retained + [f'{k}={added[k]}' for k in sorted(KEYS)]) + '\n'
    if {k: v for k, v in parse(result).items() if k not in KEYS} != {k: v for k, v in old.items() if k not in KEYS}:
        raise ValueError('Unrelated environment changed')
    return result


def protected_read(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        # File identity/permissions are safe diagnostics; no file content.
        print(json.dumps({'event': 'meeting_protected_file_rejected',
                          'file': path.name, 'uid': info.st_uid,
                          'mode': oct(stat.S_IMODE(info.st_mode)),
                          'regular': stat.S_ISREG(info.st_mode)}))
        raise ValueError('Expected root-owned protected regular file')
    return path.read_text()


def backup_original(path, current):
    if not path.exists():
        with open(path, 'x', opener=lambda p, f: os.open(p, f, 0o600)) as handle:
            handle.write(current)
    else:
        protected_read(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['status', 'stage', 'enable', 'disable'])
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'fit-stage-app':
        raise ValueError('Unexpected execution target')
    raw = subprocess.run(['podman', 'inspect', 'fit-api-stage'], capture_output=True, check=True)
    container = json.loads(raw.stdout)[0]
    running_sha = Path('/opt/fit/RUNNING_SHA').read_text().strip()
    target = Path('/opt/fit/secrets/api.env')
    current = protected_read(target)
    if args.mode != 'status':
        result = merge(current, protected_read(Path('/opt/fit-jitsi/api.env.fragment')),
                       protected_read(Path('/opt/fit-jitsi/.env')), args.mode == 'enable')
        if args.mode == 'stage' and parse(current).get('JITSI_ENABLED') == 'true':
            raise ValueError('Stage cannot disable an enabled feature')
        backup = Path('/opt/fit-jitsi/api-before-meetings.env')
        backup_original(backup, current)
        descriptor, temporary = tempfile.mkstemp(prefix='.api-meetings-', dir=target.parent)
        try:
            with os.fdopen(descriptor, 'w') as handle:
                handle.write(result)
                handle.flush()
                os.fsync(handle.fileno())
            os.chown(temporary, 0, target.stat().st_gid)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    configured = parse(protected_read(target))
    # Capture inspect internally: output only the flag, image and SHA, never Env.
    print(json.dumps({'event': 'meeting_api_configuration', 'mode': args.mode,
                      'configuredEnabled': configured.get('JITSI_ENABLED') == 'true',
                      'runtimeEnabled': 'JITSI_ENABLED=true' in container['Config'].get('Env', []),
                      'runtimeImage': container['Config']['Image'],
                      'runningSha': running_sha,
                      'restartPerformed': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        safe_reasons = {'Unexpected execution target', 'Expected root-owned protected regular file',
                        'Invalid or duplicate environment entry', 'Unexpected meeting target',
                        'Invalid protected fragment', 'Provider credential mismatch',
                        'Existing credential mismatch', 'Unrelated environment changed',
                        'Stage cannot disable an enabled feature'}
        reason = str(error) if str(error) in safe_reasons else type(error).__name__
        raise SystemExit(f'Meeting API configuration rejected: {reason}')
