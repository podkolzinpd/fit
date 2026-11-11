"""Read only technical metadata for the two owner-provided support codes."""
import importlib.util
import json
import re
import sys
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location("request_diagnostics", Path(__file__).with_name("cloudru-api-request-diagnostics.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
wanted = {"6755E382712B", "7BC37FA3FD93"}
records = {}
context = []
counts = {"journalEntries": 0, "matchedEntries": 0}
for line in sys.stdin:
    try:
        record = json.loads(line)
        counts["journalEntries"] += 1
        if record.get("CONTAINER_NAME") != "fit-api-stage":
            continue
        entry = json.loads(record.get("MESSAGE", ""))
        stamp = record.get("__REALTIME_TIMESTAMP", "")
        if isinstance(stamp, str) and stamp.isdigit() and isinstance(entry, dict):
            context.append((int(stamp), entry))
        request_id = str(uuid.UUID(entry.get("reqId", "")))
        if request_id.replace("-", "")[-12:].upper() not in wanted:
            continue
    except (ValueError, TypeError, AttributeError):
        continue
    counts["matchedEntries"] += 1
    item = records.setdefault(request_id, {"lines": [], "failures": [], "times": []})
    item["lines"].append(line)
    stamp = record.get("__REALTIME_TIMESTAMP", "")
    if isinstance(stamp, str) and stamp.isdigit():
        item["times"].append(stamp)
    code = entry.get("databaseErrorCode")
    category = entry.get("databaseErrorCategory")
    failure = {}
    if isinstance(code, str) and re.fullmatch(r"[0-9A-Z_]{1,40}|unknown", code):
        failure["databaseErrorCode"] = code
    if category in {"unknown", "timeout", "connection", "capacity", "constraint", "permission", "data", "transaction"}:
        failure["databaseErrorCategory"] = category
    if failure and failure not in item["failures"]:
        item["failures"].append(failure)
print(json.dumps({"event": "incident_scan", **counts, "matchedRequests": len(records)}))
for request_id, item in records.items():
    result = module.summarize(item["lines"], request_id)
    methods = set()
    operations = set()
    for line in item["lines"]:
        req = json.loads(json.loads(line)["MESSAGE"]).get("req", {})
        if req.get("method") in {"GET", "POST", "PATCH", "DELETE"}:
            methods.add(req["method"])
        url = req.get("url", "").split("?", 1)[0]
        if url in {"/v1/training-data", "/v1/commands", "/v1/clients", "/v1/connections"}:
            operations.add(url)
    result.update(requestId=request_id, failures=item["failures"], timestamps=item["times"], methods=sorted(methods), operations=sorted(operations))
    print(json.dumps(result))

if records:
    times = [int(t) for item in records.values() for t in item["times"]]
    lo, hi = min(times) - 120000000, max(times) + 120000000
    safe_numeric = {"poolMax", "total", "idle", "occupied", "waiting", "windowMs", "acquired", "acquireErrors", "capacityErrors", "idleErrors", "acquireTotalMs", "acquireMaxMs", "failedAcquireMaxMs", "waitingMax", "occupiedMax", "totalMax"}
    safe_events = {"database_pool_window", "database_pool_idle_error", "database_transaction_failed"}
    safe_messages = {"Pilot command failed", "Pilot training data query failed", "Pilot clients query failed", "Pilot connections query failed"}
    for stamp, entry in context:
        if not lo <= stamp <= hi:
            continue
        if entry.get("event") not in safe_events and entry.get("msg") not in safe_messages:
            continue
        safe = {"event": entry.get("event") if entry.get("event") in safe_events else entry["msg"], "timestamp": stamp}
        for key in safe_numeric:
            value = entry.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                safe[key] = value
        if entry.get("poolRole") in {"api", "dispatcher", "migration-owner", "migration-runtime", "function", "unspecified"}:
            safe["poolRole"] = entry["poolRole"]
        for key in ("databaseErrorCode", "databaseErrorCategory"):
            value = entry.get(key)
            if isinstance(value, str) and re.fullmatch(r"[0-9A-Za-z_]{1,40}", value):
                safe[key] = value
        print(json.dumps(safe))

windows = []
for stamp, entry in context:
    if entry.get("event") == "database_pool_window" and entry.get("poolRole") == "api":
        keys = ("acquired", "acquireErrors", "capacityErrors", "failedAcquireMaxMs", "acquireMaxMs", "waitingMax", "occupiedMax", "totalMax")
        windows.append({"timestamp": stamp, **{k: entry[k] for k in keys if isinstance(entry.get(k), (int, float))}})
print(json.dumps({"event": "incident_pool_timeline", "windows": windows[-100:]}))
