"""Exercise generated proxy routes and Origin filtering with a real Nginx."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from prepare import prepare


class Backend(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'SDK' if self.path.startswith('/libs/') else b'API')

    def log_message(self, *args):
        pass


@unittest.skipUnless(shutil.which('nginx'), 'Nginx is required; installed in infrastructure check job')
class IngressTest(unittest.TestCase):
    def test_existing_api_fallback_sdk_cors_and_ws_origin_boundary(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            bundle = directory / 'bundle'
            prepare(bundle, '8.8.8.8', '10.70.10.8', 'api.fit-training.ru')
            backend = ThreadingHTTPServer(('127.0.0.1', 0), Backend)
            thread = threading.Thread(target=backend.serve_forever, daemon=True)
            thread.start()
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            upstream = f'http://127.0.0.1:{backend.server_port}'
            locations = (bundle / 'nginx-locations.conf').read_text().replace('http://127.0.0.1:8000', upstream)
            config = directory / 'nginx.conf'
            config.write_text(f'''pid {directory}/nginx.pid;
error_log {directory}/error.log;
events {{}}
http {{
    access_log {directory}/access.log;
    {(bundle / 'nginx-origins.conf').read_text()}
    server {{
        listen 127.0.0.1:{port};
        {locations}
        location / {{ proxy_pass {upstream}; }}
    }}
}}
''')
            subprocess.run(['nginx', '-t', '-p', root, '-c', str(config)], check=True, capture_output=True)
            process = subprocess.Popen(['nginx', '-p', root, '-c', str(config), '-g', 'daemon off;'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                base = f'http://127.0.0.1:{port}'
                for attempt in range(30):
                    try:
                        with urlopen(base + '/ready', timeout=1) as response:
                            self.assertEqual(response.read(), b'API')
                        break
                    except URLError:
                        time.sleep(0.1)
                else:
                    self.fail('Test Nginx did not become ready')
                with urlopen(base + '/libs/lib-jitsi-meet.min.js', timeout=2) as response:
                    self.assertEqual(response.read(), b'SDK')
                    self.assertEqual(response.headers['Access-Control-Allow-Origin'], '*')
                request = Request(base + '/xmpp-websocket', headers={'Origin': 'https://untrusted.invalid'})
                with self.assertRaises(HTTPError) as error:
                    urlopen(request, timeout=2)
                self.assertEqual(error.exception.code, 403)
                request = Request(base + '/xmpp-websocket?token=synthetic-test-token',
                                  headers={'Origin': 'https://fit-training.ru'})
                with urlopen(request, timeout=2) as response:
                    self.assertEqual(response.read(), b'API')
            finally:
                process.terminate()
                process.wait(timeout=5)
                backend.shutdown()
                backend.server_close()
                thread.join(timeout=5)
            self.assertNotIn('synthetic-test-token', (directory / 'access.log').read_text())


if __name__ == '__main__':
    unittest.main()
