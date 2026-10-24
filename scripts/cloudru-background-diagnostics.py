"""Allowlisted journal diagnostics; never print raw service output."""
import json
import re
import sys


def summarize(lines):
    result = {"event": "cloudru_background_diagnostics", "messages": 0, "workerFailed": False,
              "workerCompleted": False, "moduleMissing": False, "containerError": False,
              "databaseCodes": [], "sessionCleanupFailed": False, "launcherFailures": [],
              "dispatchFailures": [], "transactionFailures": []}
    codes = set()
    launcher_failures = set()
    for line in lines:
        try:
            record = json.loads(line)
        except (ValueError, TypeError):
            continue
        if not isinstance(record, dict):
            continue
        message = record.get("MESSAGE", "")
        if not isinstance(message, str):
            continue
        result["messages"] += 1
        launcher = re.fullmatch(r"background_launcher_failed:(identity|lock|runtime|boundary|private_env|container):([0-9]{1,3})", message)
        if launcher:
            launcher_failures.add((launcher[1], int(launcher[2])))
        result["workerFailed"] |= message == "cloudru_background_failed"
        result["moduleMissing"] |= "Cannot find module '/app/dist/cloudru-background-worker.js'" in message
        result["containerError"] |= message.startswith("Error:")
        try:
            entry = json.loads(message)
        except (ValueError, TypeError):
            continue
        if not isinstance(entry, dict):
            continue
        event = entry.get("event")
        result["workerFailed"] |= message == '"cloudru_background_failed"' or event == "cloudru_background_failed"
        result["workerCompleted"] |= event == "cloudru_background_completed"
        result["sessionCleanupFailed"] |= event == "yandex_session_cleanup_failed"
        code = entry.get("databaseErrorCode", entry.get("errorCode"))
        if event in ("database_pool_window", "database_pool_idle_error", "yandex_session_cleanup_failed", "cloudru_background_failed", "background_transaction_failed") \
                and isinstance(code, str) and re.fullmatch(r"(?:[0-9][0-9A-Z]{4}|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|EPIPE|ETIMEDOUT)", code):
            codes.add(code)
            if event == "background_transaction_failed" and entry.get("transactionPhase") in {"connect", "begin", "timeout", "work", "commit"}:
                failure = {"phase": entry["transactionPhase"], "code": code}
                if failure not in result["transactionFailures"]:
                    result["transactionFailures"].append(failure)
            if event in {"yandex_session_cleanup_failed", "cloudru_background_failed"} \
                    and entry.get("dispatchOperation") in {"push", "app_feedback", "auth_sessions"} \
                    and entry.get("dispatchPhase") in {"prepare", "finalize", "cleanup"}:
                failure = {"operation": entry["dispatchOperation"], "phase": entry["dispatchPhase"], "code": code}
                if failure not in result["dispatchFailures"]:
                    result["dispatchFailures"].append(failure)
    result["databaseCodes"] = sorted(codes)
    result["launcherFailures"] = [{"stage": stage, "exitCode": code} for stage, code in sorted(launcher_failures)]
    return result


if __name__ == "__main__":
    print(json.dumps(summarize(sys.stdin)))
