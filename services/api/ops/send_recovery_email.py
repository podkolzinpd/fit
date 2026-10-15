"""One reviewed recovery notice, one SMTP envelope recipient, durable no-retry ledger."""
import email.policy
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
import fcntl
import hashlib
import json
import os
from pathlib import Path
import smtplib
import ssl
import time
import urllib.request

SENDER = 'fitteam@fit-training.ru'
CAMPAIGN = 'fit_recovered_2026_10_15'
SUBJECT = 'ФИТ снова работает 💪'
BODY = '''Привет!

Мы восстановили работу FIT, можно снова возвращаться к тренировкам в приложении.

Спасибо, что дождались, и простите за перерыв.

Открыть FIT: https://fit-training.ru

Команда FIT
'''
STATE_DIR = Path('/opt/fit/recovery-email')


def message_for(recipient):
    if not isinstance(recipient, str) or any(c in recipient for c in '\r\n\x00'):
        raise ValueError('invalid recipient')
    message = EmailMessage(policy=email.policy.SMTP)
    message['From'] = 'Команда FIT <' + SENDER + '>'
    message['To'] = recipient
    if len(message['To'].addresses) != 1 or message['To'].addresses[0].addr_spec != recipient:
        raise ValueError('invalid recipient')
    message['Reply-To'] = SENDER
    message['Subject'] = SUBJECT
    message['Date'] = formatdate(localtime=False)
    message['Message-ID'] = make_msgid(domain='fit-training.ru')
    message.set_content(BODY)
    return message


def fetch_json(url, token, apikey=False):
    headers = {'Authorization': 'Bearer ' + token}
    if apikey:
        headers['apikey'] = token
    request = urllib.request.Request(url, headers=headers, method='GET')
    # Never forward credentials through a redirect.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
        return json.load(response)


def recipients():
    ref = os.environ['SUPABASE_PROJECT_ID']
    if len(ref) != 20 or not ref.isascii() or not ref.isalpha() or not ref.islower():
        raise ValueError('invalid source')
    keys = fetch_json('https://api.supabase.com/v1/projects/' + ref + '/api-keys', os.environ['SUPABASE_ACCESS_TOKEN'])
    key = next(item['api_key'] for item in keys if item.get('name') == 'service_role')
    addresses = set()
    seen_ids = set()
    for page in range(1, 101):
        users = fetch_json('https://' + ref + '.supabase.co/auth/v1/admin/users?page=' + str(page) + '&per_page=1000', key, True)['users']
        if not isinstance(users, list):
            raise ValueError('invalid source page')
        for user in users:
            if user['id'] in seen_ids:
                raise ValueError('source pagination repeated')
            seen_ids.add(user['id'])
            address = (user.get('email') or '').strip().lower()
            if address:
                message_for(address)  # Validate every recipient before sending any message.
                addresses.add(address)
        if len(users) < 1000:
            if not 0 < len(addresses) <= 250:
                raise ValueError('audience outside reviewed bound')
            return sorted(addresses)
    raise ValueError('pagination limit')


def smtp_login():
    smtp = smtplib.SMTP_SSL('smtp.beget.com', 465, timeout=30, context=ssl.create_default_context())
    try:
        smtp.login(SENDER, os.environ['FIT_SMTP_PASSWORD'])
    except BaseException:
        smtp.close()
        raise
    return smtp


def save_state(path, state):
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(state, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def send_one(smtp, address, message):
    # Exactly one envelope recipient; no Cc/Bcc headers are ever constructed.
    if message['Cc'] is not None or message['Bcc'] is not None:
        raise ValueError('recipient privacy invariant')
    refused = smtp.send_message(message, from_addr=SENDER, to_addrs=[address])
    if refused:
        raise smtplib.SMTPRecipientsRefused(refused)


def run(action):
    if action == 'email-test':
        with smtp_login() as smtp:
            send_one(smtp, SENDER, message_for(SENDER))
        print(json.dumps({'action': action, 'smtpAuthenticated': True, 'testAccepted': 1, 'campaignEmailsSent': 0}))
        return
    if action != 'email-send' or os.environ.get('RECOVERY_CONFIRMATION') != 'SEND_FIT_RECOVERY_EMAIL_2026_10_15':
        raise ValueError('confirmation required')
    addresses = recipients()
    if STATE_DIR.is_symlink() or STATE_DIR.stat().st_uid != os.getuid() or STATE_DIR.stat().st_mode & 0o077:
        raise ValueError('private ledger required')
    lock_fd = os.open(STATE_DIR / '.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path = STATE_DIR / (CAMPAIGN + '.json')
        if path.is_symlink():
            raise ValueError('invalid ledger')
        state = json.loads(path.read_text()) if path.exists() else {}
        accepted_now = 0
        with smtp_login() as smtp:
            for address in addresses:
                digest = hashlib.sha256((CAMPAIGN + '\0' + address).encode()).hexdigest()
                if digest in state:
                    continue
                state[digest] = 'uncertain'
                save_state(path, state)  # Persist before SMTP DATA; unknown outcomes are never retried.
                try:
                    send_one(smtp, address, message_for(address))
                except (smtplib.SMTPRecipientsRefused, smtplib.SMTPDataError) as error:
                    state[digest] = 'rejected'
                    save_state(path, state)
                    if isinstance(error, smtplib.SMTPDataError) and error.smtp_code < 500:
                        break
                else:
                    state[digest] = 'accepted'
                    accepted_now += 1
                    save_state(path, state)
                time.sleep(1)
        print(json.dumps({'action': action, 'registeredUniqueEmails': len(addresses), 'acceptedNow': accepted_now,
            'acceptedTotal': sum(value == 'accepted' for value in state.values()),
            'rejected': sum(value == 'rejected' for value in state.values()),
            'uncertain': sum(value == 'uncertain' for value in state.values()),
            'unattempted': len(addresses) - len(state)}))


if __name__ == '__main__':
    try:
        run(os.environ['ACTION'])
    except Exception as error:
        # No exception text, SMTP response or recipient IDs/addresses in shared logs.
        print(json.dumps({'action': os.environ.get('ACTION'), 'failed': True, 'errorClass': type(error).__name__}))
        raise SystemExit(1)
