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
counts = {"journalEntries": 0, "matchedEntries": 0}
for line in sys.stdin:
    try:
        record = json.loads(line)
        counts["journalEntries"] += 1
        if record.get("CONTAINER_NAME") != "fit-api-stage":
            continue
        entry = json.loads(record.get("MESSAGE", ""))
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
    result.update(requestId=request_id, failures=item["failures"], timestamps=item["times"])
    print(json.dumps(result))
