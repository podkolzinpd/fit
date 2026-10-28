"""Probe real XMPP JWT admission using synthetic rooms; never print credentials."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import socket
import ssl
import struct
import time
from urllib.parse import urlencode
import uuid


class WebSocket:
    def __init__(self, token, room):
        self.sock = ssl.create_default_context().wrap_socket(
            socket.create_connection(('10.70.10.4', 443), timeout=8), server_hostname='api.fit-training.ru')
        self.sock.settimeout(8)
        self.buffer = b''
        query = urlencode({'room': room, **({'token': token} if token else {})})
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f'GET /xmpp-websocket?{query} HTTP/1.1\r\n'
                           'Host: api.fit-training.ru\r\nOrigin: https://fit-training.ru\r\n'
                           'Upgrade: websocket\r\nConnection: Upgrade\r\n'
                           f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n'
                           'Sec-WebSocket-Protocol: xmpp\r\n\r\n').encode())
        while b'\r\n\r\n' not in self.buffer:
            self.buffer += self.sock.recv(65536)
        headers, self.buffer = self.buffer.split(b'\r\n\r\n', 1)
        if not headers.startswith(b'HTTP/1.1 101 '):
            raise RuntimeError('XMPP WebSocket upgrade rejected')

    def exact(self, size):
        while len(self.buffer) < size:
            data = self.sock.recv(65536)
            if not data:
                raise EOFError()
            self.buffer += data
        result, self.buffer = self.buffer[:size], self.buffer[size:]
        return result

    def send(self, value, opcode=1):
        data = value.encode() if isinstance(value, str) else value
        size = len(data)
        length = bytes([0x80 | size]) if size < 126 else b'\xfe' + struct.pack('!H', size)
        mask = os.urandom(4)
        self.sock.sendall(bytes([0x80 | opcode]) + length + mask +
                          bytes(byte ^ mask[index % 4] for index, byte in enumerate(data)))

    def receive(self):
        header = self.exact(2)
        opcode, length = header[0] & 15, header[1] & 127
        if length == 126:
            length = struct.unpack('!H', self.exact(2))[0]
        elif length == 127:
            length = struct.unpack('!Q', self.exact(8))[0]
        mask = self.exact(4) if header[1] & 128 else None
        data = self.exact(length)
        if mask:
            data = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
        if opcode == 8:
            raise EOFError()
        if opcode == 9:
            self.send(data, opcode=10)
            return self.receive()
        return data.decode()

    def until(self, *markers):
        for _ in range(20):
            value = self.receive()
            if any(marker in value for marker in markers):
                return value
        raise RuntimeError('Expected bounded XMPP response was not received')

    def close(self):
        try:
            self.send("<close xmlns='urn:ietf:params:xml:ns:xmpp-framing'/>")
        except (OSError, EOFError):
            pass
        self.sock.close()


def jwt(secret, room, expired=False):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=').decode()
    now = int(time.time())
    body = encode({'iss': 'fit', 'aud': 'jitsi', 'sub': 'meet.jitsi', 'room': room,
                   'iat': now - 600, 'nbf': now - 600, 'exp': now - 300 if expired else now + 300,
                   'context': {'user': {'id': 'fit-infrastructure-probe', 'name': 'Fit infrastructure probe'}}})
    unsigned = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + body
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), unsigned.encode(), hashlib.sha256).digest()).rstrip(b'=')
    return unsigned + '.' + signature.decode()


def probe(token, room, should_admit):
    connection = WebSocket(token, room)
    try:
        opening = "<open xmlns='urn:ietf:params:xml:ns:xmpp-framing' to='meet.jitsi' version='1.0'/>"
        connection.send(opening)
        features = connection.until('mechanisms', 'error', 'failure')
        if 'mechanisms' not in features:
            if should_admit:
                raise RuntimeError('Valid token was rejected before SASL')
            return
        connection.send("<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl' mechanism='ANONYMOUS'/>")
        authentication = connection.until('success', 'failure', 'error')
        if 'success' not in authentication:
            if should_admit:
                raise RuntimeError('Valid token SASL authentication failed')
            return
        connection.send(opening)
        connection.until('features')
        connection.send("<iq type='set' id='bind'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><resource>probe</resource></bind></iq>")
        connection.until('jid', 'error')
        occupant = f'{room}@muc.meet.jitsi/probe'
        connection.send(f"<presence to='{occupant}'><x xmlns='http://jabber.org/protocol/muc'/></presence>")
        presence = connection.until('<presence')
        admitted = 'type="error"' not in presence and "type='error'" not in presence
        if admitted:
            connection.send(f"<presence to='{occupant}' type='unavailable'/>")
        if admitted != should_admit:
            raise RuntimeError('Unexpected room admission decision')
    except (EOFError, socket.timeout):
        if should_admit:
            raise RuntimeError('Valid token connection closed or timed out') from None
    finally:
        connection.close()


if __name__ == '__main__':
    assert os.geteuid() == 0
    settings = dict(line.split('=', 1) for line in Path('/opt/fit-jitsi/.env').read_text().splitlines())
    secret = settings['JWT_APP_SECRET']
    room = 'fit-' + str(uuid.uuid4())
    for name, token, target, admitted in [
        ('valid-room', jwt(secret, room), room, True),
        ('missing-token', None, room, False),
        ('expired-token', jwt(secret, room, expired=True), room, False),
        ('wrong-signature', jwt('synthetic-wrong-signing-key', room), room, False),
        ('wrong-room', jwt(secret, room), 'fit-' + str(uuid.uuid4()), False),
    ]:
        probe(token, target, admitted)
        print(json.dumps({'probe': name, 'result': 'passed'}))
