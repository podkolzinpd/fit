"""Read one request's technical metadata; never export raw journal/error text."""
import json
import re
import sys
import uuid


def summarize(lines, request_id):
    wanted = str(uuid.UUID(request_id))
    result = {"event": "cloudru_api_request_diagnostics", "journalEntries": 0,
              "matchedEntries": 0, "statuses": [], "errors": [], "planSaveFailures": []}
    for line in lines:
        try:
            record = json.loads(line)
            if not isinstance(record, dict) or record.get("CONTAINER_NAME") != "fit-api-stage":
                continue
            result["journalEntries"] += 1
            entry = json.loads(record.get("MESSAGE", ""))
            if not isinstance(entry, dict) or entry.get("reqId") != wanted:
                continue
        except (ValueError, TypeError):
            continue
        result["matchedEntries"] += 1
        step, reason = entry.get("planSaveStep"), entry.get("planSaveReason")
        if isinstance(step, str) and isinstance(reason, str) and step in {"save", "stage", "format", "notification"} and reason in {
                "active", "conflict", "forbidden", "invalid", "not_found"}:
            diagnostic = {"step": step, "reason": reason}
            if diagnostic not in result["planSaveFailures"]:
                result["planSaveFailures"].append(diagnostic)
        response = entry.get("res")
        status = response.get("statusCode") if isinstance(response, dict) else None
        if isinstance(status, int) and not isinstance(status, bool) and 100 <= status <= 599:
            if status not in result["statuses"]:
                result["statuses"].append(status)
        error = entry.get("err")
        if not isinstance(error, dict):
            continue
        kind = error.get("type")
        code = error.get("code")
        safe = {"type": kind if kind in {"Error", "TypeError", "RangeError", "SyntaxError",
                "ReferenceError", "DatabaseError", "FastifyError"} else "unknown",
                "code": code if isinstance(code, str) and re.fullmatch(
                    r"(?:[0-9][0-9A-Z]{4}|P000[0-4]|XX[0-9A-Z]{3}|FST_ERR_[A-Z_]{1,60}|ECONNRESET|ECONNREFUSED|ETIMEDOUT)", code)
                else "unknown", "frames": []}
        stack = error.get("stack")
        # Only source locations, never the exception message, SQL, values or function arguments.
        if isinstance(stack, str):
            for frame in re.findall(r"^\s+at [^\n]*?/(?:dist|src)/([A-Za-z0-9_/-]+\.[cm]?[jt]s):([0-9]+):([0-9]+)", stack, re.MULTILINE):
                safe["frames"].append(":".join(frame))
                if len(safe["frames"]) == 4:
                    break
        if safe not in result["errors"] and len(result["errors"]) < 10:
            result["errors"].append(safe)
    return result


if __name__ == "__main__":
    try:
        request_id = str(uuid.UUID(sys.argv[1])) if len(sys.argv) == 2 else None
    except ValueError:
        request_id = None
    if request_id is None:
        sys.exit("Expected one request UUID")
    print(json.dumps(summarize(sys.stdin, request_id), sort_keys=True))
