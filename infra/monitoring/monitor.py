#!/usr/bin/env python3
"""Bounded technical monitoring; no application records, SQL or response bodies."""
import argparse
import copy
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.parse
import urllib.request

LABELS = {
    'host_monitor': 'Нет свежих данных минутного мониторинга VM',
    'cpu': 'CPU VM выше 70%: проверить потребителя и планировать увеличение vCPU',
    'memory': 'Доступная память VM ниже 20%: проверить утечку и объём RAM',
    'disk': 'Свободное место на диске ниже 25%: проверить retention и расширение',
    'api': 'API / PostgreSQL не проходят readiness',
    'frontend': 'Frontend недоступен',
    'speech': 'Реле SpeechKit недоступно',
    'background': 'Последний запуск фонового обработчика завершился с ошибкой',
    'backup': 'Подтверждённый backup старше 48 часов или отсутствует',
    'public_api': 'Внешняя проверка API не проходит',
    'public_frontend': 'Внешняя проверка сайта не проходит',
}


def advance(state, conditions, now):
    """Elapsed-time thresholds, reset streaks after missing observations, recovery hysteresis."""
    result = copy.deepcopy(state)
    gap = now - result.get('at', now)
    events = []
    for key, bad in conditions.items():
        entry = result.setdefault('checks', {}).setdefault(key, {'active': False})
        if gap > 600 or gap < 0:
            entry.pop('since', None)
            entry.pop('healthy_since', None)
        if bad:
            entry.pop('healthy_since', None)
            entry.setdefault('since', now)
            duration = 900 if key in ('cpu', 'memory', 'disk') else 120
            if not entry['active'] and now - entry['since'] >= duration:
                events.append('Fit: ПРОБЛЕМА. ' + LABELS[key])
                entry['active'] = True
        else:
            entry.pop('since', None)
            entry.setdefault('healthy_since', now)
            if entry['active'] and now - entry['healthy_since'] >= 300:
                events.append('Fit: ВОССТАНОВЛЕНО. ' + key)
                entry['active'] = False
    result['at'] = now
    return result, events


def healthy(url):
    try:
        with urllib.request.urlopen(url, timeout=4) as response:
            return response.status == 200
    except Exception:
        return False


def host_conditions(state):
    fields = list(map(int, Path('/proc/stat').read_text().splitlines()[0].split()[1:]))
    # guest time is already included in user/nice.
    total, idle = sum(fields[:8]), fields[3] + fields[4]
    previous = state.get('cpu_sample')
    cpu = None
    if previous and total > previous[0]:
        cpu = 100 * (1 - (idle - previous[1]) / (total - previous[0]))
    memory = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        memory[key] = int(value.split()[0])
    available = memory['MemAvailable'] / memory['MemTotal']
    disk = shutil.disk_usage('/')
    try:
        verified = datetime.datetime.fromisoformat(Path('/opt/fit/BACKUP_VERIFIED_AT').read_text().strip().replace('Z', '+00:00')).timestamp()
        age = time.time() - verified
        backup_bad = age < 0 or age > 172800
    except (OSError, ValueError):
        backup_bad = True
    background = subprocess.run(['systemctl', 'show', 'fit-background.service', '--property=Result', '--value'],
                                capture_output=True, text=True, timeout=3, check=False)
    conditions = {'memory': available < .2, 'disk': disk.free / disk.total < .25,
                  'api': not healthy('http://127.0.0.1:18080/ready'),
                  'frontend': not healthy('http://127.0.0.1:18081/auth'),
                  'speech': not healthy('http://127.0.0.1:18084/health'),
                  'background': background.returncode != 0 or background.stdout.strip() != 'success',
                  'backup': backup_bad}
    if cpu is not None:
        conditions['cpu'] = cpu > 70
    return conditions, {'cpu_sample': [total, idle]}, {
        'cpu_percent': None if cpu is None else round(cpu, 1),
        'memory_available_percent': round(available * 100, 1),
        'disk_free_percent': round(disk.free / disk.total * 100, 1)}


def send(message):
    token = os.environ['FIT_ALERT_TELEGRAM_BOT_TOKEN']
    chat = os.environ['FIT_ALERT_TELEGRAM_CHAT_ID']
    if not chat.lstrip('-').isdigit():
        raise ValueError('invalid_chat_configuration')
    payload = {'chat_id': chat, 'text': message}
    thread = os.environ.get('FIT_ALERT_TELEGRAM_THREAD_ID', '')
    if thread:
        if not thread.isdigit() or int(thread) < 1:
            raise ValueError('invalid_thread_configuration')
        payload['message_thread_id'] = thread
    data = urllib.parse.urlencode(payload).encode()
    request = urllib.request.Request('https://api.telegram.org/bot' + token + '/sendMessage', data=data)
    with urllib.request.urlopen(request, timeout=8) as response:
        result = json.loads(response.read(16384))
    if result.get('ok') is not True:
        raise RuntimeError('telegram_delivery_failed')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['host', 'public', 'export', 'relay'], required=True)
    parser.add_argument('--state', required=True)
    parser.add_argument('--snapshot')
    parser.add_argument('--test-delivery', action='store_true')
    args = parser.parse_args()
    if args.test_delivery:
        send('Fit: проверка подключения мониторинга. Алерты приходят в этот чат.')
        print('telegram_test_delivered')
        return
    path = Path(args.state)
    state = json.loads(path.read_text()) if path.exists() else {}
    now = time.time()
    if args.mode == 'export':
        print(json.dumps({'at':state.get('at',0),'active':{key:bool(value.get('active')) for key,value in state.get('checks',{}).items() if key in LABELS}}))
        return
    if args.mode == 'relay':
        snapshot = json.loads(Path(args.snapshot).read_text()) if args.snapshot else {}
        fresh = 0 <= now - snapshot.get('at',0) <= 600
        next_state, events = advance(state, {'host_monitor':not fresh}, now)
        if fresh:
            previous = state.get('host_active', {})
            current = {key: value for key,value in snapshot.get('active',{}).items() if key in LABELS and type(value) is bool}
            for key,value in current.items():
                if value != previous.get(key,False):
                    events.append(('Fit: ПРОБЛЕМА. ' + LABELS[key]) if value else ('Fit: ВОССТАНОВЛЕНО. ' + key))
            next_state['host_active'] = current
        conditions, extra, metrics = {}, {}, {}
    elif args.mode == 'host':
        conditions, extra, metrics = host_conditions(state)
    else:
        conditions = {'public_api': not healthy('https://api.fit-training.ru/ready'),
                      'public_frontend': not healthy('https://fit-training.ru/auth')}
        extra, metrics = {}, {}
    if args.mode != 'relay':
        next_state, events = advance(state, conditions, now)
    # Commit alert/recovery transitions only after acknowledged delivery; failures retry.
    if events and args.mode != 'host':
        send('\n'.join(events))
    next_state.update(extra)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(next_state))
    temporary.chmod(0o600)
    temporary.replace(path)
    print(json.dumps({'event': 'fit_monitor', 'mode': args.mode, 'metrics': metrics,
                      'failing_checks': [key for key, bad in conditions.items() if bad],
                      'notifications': len(events)}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # HTTP exception strings may contain the bot credential: never print them.
        print('fit_monitor_failed', flush=True)
        raise SystemExit(1)
