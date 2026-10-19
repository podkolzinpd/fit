"""Fixed, aggregate-only API diagnostics. Never forward raw log fields."""
import json
import re
import sys


def summarize(lines):
    result = {"event": "cloudru_api_command_error_counts", "journalEntries": 0,
              "parsedApiEntries": 0, "failedCommands": 0, "databaseCodes": {}}
    for line in lines:
        try:
            record = json.loads(line)
            if not isinstance(record, dict) or record.get("CONTAINER_NAME") != "fit-api-stage":
                continue
            result["journalEntries"] += 1
            entry = json.loads(record.get("MESSAGE", ""))
            if not isinstance(entry, dict):
                continue
        except (ValueError, TypeError):
            continue
        result["parsedApiEntries"] += 1
        if entry.get("msg") != "Pilot command failed":
            continue
        result["failedCommands"] += 1
        code = entry.get("databaseErrorCode")
        if not isinstance(code, str) or not re.fullmatch(
                r"(?:[0-9][0-9A-Z]{4}|P000[0-4]|HV[0-9A-Z]{3}|XX[0-9A-Z]{3}|PT(?:403|404|409|422)|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|EPIPE|ETIMEDOUT|unknown)", code):
            code = "unknown"
        result["databaseCodes"][code] = result["databaseCodes"].get(code, 0) + 1
    return result


if __name__ == "__main__":
    print(json.dumps(summarize(sys.stdin), sort_keys=True))
