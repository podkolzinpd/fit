import json,sys
from collections import Counter
counts=Counter()
patterns={"conntrack_full":"nf_conntrack: table full", "oom":"out of memory", "oom_kill":"killed process", "link_down":"link is down", "link_up":"link is up", "network_unreachable":"network is unreachable", "network_changed":"network configuration changed", "tls_handshake_timeout":"tls handshake timeout", "connection_refused":"connection refused", "connection_reset":"connection reset"}
for line in sys.stdin:
    try:
        d=json.loads(line); text=str(d.get("MESSAGE", "")).lower()
    except (ValueError,TypeError): continue
    for key,pattern in patterns.items():
        if pattern in text: counts[key]+=1
print(json.dumps({"event":"incident_host_event_counts", "counts":dict(counts)}))
