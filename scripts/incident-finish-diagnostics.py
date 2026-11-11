import json,re,sys
from collections import Counter
rows=[]
requests={}
failures=Counter()
operations=Counter()
statuses=Counter()
pools=[]
for line in sys.stdin:
    try:
        record=json.loads(line)
        entry=json.loads(record.get("MESSAGE", ""))
        if not isinstance(entry,dict): continue
        stamp=record.get("__REALTIME_TIMESTAMP","")
        if not isinstance(stamp,str) or not stamp.isdigit(): continue
    except (ValueError,TypeError,AttributeError): continue
    rows.append((int(stamp),entry))
    req=entry.get("req",{})
    url=req.get("url","") if isinstance(req,dict) else ""
    rid=entry.get("reqId")
    if isinstance(url,str) and url.startswith('/'):
        path=url.split('?',1)[0]
        known={'v1','health','ready','clients','connections','training-data','workouts','workout-sets','workout-exercises','finish','finish-single','start','pause','trainer-finance','me','overview','packages','payments','sessions','set','confirm'}
        safe='/'.join(segment if segment in known or not segment else ':id' for segment in path.split('/'))
        method=req.get('method','other')
        if method not in {'GET','POST','PUT','PATCH','DELETE','OPTIONS'}: method='other'
        operations[method+' '+safe]+=1
    response=entry.get('res')
    if isinstance(response,dict) and isinstance(response.get('statusCode'),int):
        statuses[str(response['statusCode'])]+=1
    if isinstance(rid,str) and re.fullmatch(r"[a-f0-9-]{36}",rid) and isinstance(url,str):
        path=url.split("?",1)[0]
        m=re.fullmatch(r"/v1/workouts/[a-f0-9-]{36}/(finish|finish-single)",path)
        if m:
            requests[rid]={"requestId":rid,"operation":m[1],"startedAtUs":int(stamp),"method":req.get("method") if req.get("method") in {"POST","OPTIONS"} else "other"}
    if entry.get("msg") in {"Pilot command failed","Pilot training data query failed","Pilot clients query failed"}:
        code=entry.get("databaseErrorCode","unknown")
        failures[code if isinstance(code,str) and re.fullmatch(r"[A-Z0-9_]{1,40}|unknown",code) else "unknown"]+=1
    if entry.get("event")=="database_pool_window":
        keys=("poolMax","acquired","acquireErrors","capacityErrors","acquireMaxMs","failedAcquireMaxMs","waitingMax","totalMax")
        pools.append({"timestampUs":int(stamp),**{k:entry[k] for k in keys if isinstance(entry.get(k),(int,float))}})
for stamp,entry in rows:
    item=requests.get(entry.get("reqId"))
    if item is None: continue
    res=entry.get("res")
    if isinstance(res,dict) and isinstance(res.get("statusCode"),int):
        item.update(status=res["statusCode"],completedAtUs=stamp)
    duration=entry.get("responseTime")
    if isinstance(duration,(int,float)): item["durationMs"]=round(duration)
print(json.dumps({"event":"finish_incident","journalEntries":len(rows),"requestOperations":dict(operations),"responseStatuses":dict(statuses),"finishRequests":list(requests.values())[-50:],"databaseFailureCodes":dict(failures),"poolWindows":pools[-20:]}))
