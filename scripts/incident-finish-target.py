import json,re,sys
ids=set()
for line in sys.stdin:
    try:
        record=json.loads(line); entry=json.loads(record.get('MESSAGE',''))
        if entry.get('reqId')!='882f2704-29d7-4b3a-8853-a50dc58f2fb5': continue
        req=entry.get('req',{})
        if req.get('method')!='POST': continue
        match=re.fullmatch(r'/v1/workouts/([a-f0-9-]{36})/finish-single',req.get('url',''))
        if match: ids.add(match[1])
    except (ValueError,TypeError,AttributeError): continue
if len(ids)!=1: sys.exit('Expected exactly one reviewed completion request')
# Private UUID travels only through stdin to the read-only probe, never to logs.
print(json.dumps({'workoutId':next(iter(ids))}))
