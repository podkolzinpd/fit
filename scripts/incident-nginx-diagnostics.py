import re,json,sys,datetime
from collections import Counter
counts=Counter()
for line in sys.stdin:
    m=re.search(r'\[([^]]+)\] "(GET|POST|PUT|DELETE|PATCH|OPTIONS) ([^ ]+) HTTP/[^" ]+" (\d{3})',line)
    if not m: continue
    try: date=datetime.datetime.strptime(m[1],'%d/%b/%Y:%H:%M:%S %z').astimezone(datetime.timezone.utc)
    except ValueError: continue
    if date.date()!=datetime.date(2026,11,11) or not datetime.time(18,55)<=date.time().replace(tzinfo=None)<=datetime.time(19,5): continue
    path=m[3].split('?',1)[0]
    if path in {'/health','/api/health','/ready','/api/ready'}: route=path
    elif re.fullmatch(r'/(?:api/)?v1/workouts/[a-f0-9-]{36}/(?:finish|finish-single)',path): route='finish-single' if path.endswith('finish-single') else 'finish'
    elif path.startswith('/v1/') or path.startswith('/api/v1/'): route='other-api'
    else: continue
    counts[(m[2],route,int(m[4]))]+=1
print(json.dumps({'event':'incident_nginx_counts','requests':[{'method':k[0],'route':k[1],'status':k[2],'count':v} for k,v in counts.items()]}))
