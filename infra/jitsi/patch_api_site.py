"""Insert a scoped include without rewriting the existing API/SpeechKit routes."""
from pathlib import Path
import sys


def inject(text):
    anchor = '    client_max_body_size 50m;'
    if text.count(anchor) != 1 or 'server_name api.fit-training.ru;' not in text:
        raise ValueError('Unexpected API ingress structure; refusing modification')
    if 'fit-jitsi-locations' in text:
        raise ValueError('Meeting include already exists')
    return text.replace(anchor, '    include /etc/nginx/snippets/fit-jitsi-locations.conf;\n\n' + anchor)


if __name__ == '__main__':
    path = Path(sys.argv[1])
    path.write_text(inject(path.read_text()))
