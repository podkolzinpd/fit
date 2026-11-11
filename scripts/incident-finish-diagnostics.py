import json,re,sys
from collections import Counter
rows=[]
requests={}
failures=Counter()
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
print(json.dumps({"event":"finish_incident","journalEntries":len(rows),"finishRequests":list(requests.values())[-50:],"databaseFailureCodes":dict(failures),"poolWindows":pools[-20:]}))
