"""Aggregate-only SpeechKit relay diagnostics; never emit request content."""
import json
import sys


STATUSES = {"connected", "rejected", "streaming", "upstream_done", "upstream_error", "socket_error", "closed"}
OUTCOMES = {"client_closed", "socket_error", "rejected", "auth_timeout", "auth_rejected", "upstream_error",
            "client_stop", "session_timeout", "payload_limit", "protocol_rejected", "auth_buffer_limit"}


def summarize(lines):
    result = {"event": "cloudru_speech_diagnostics", "journalEntries": 0, "relayEvents": 0,
              "statuses": {}, "closedOutcomes": {}}
    for line in lines:
        try:
            record = json.loads(line)
            if not isinstance(record, dict):
                continue
            result["journalEntries"] += 1
            entry = json.loads(record.get("MESSAGE", ""))
            if not isinstance(entry, dict) or entry.get("event") != "cloudru_speech_session":
                continue
            status = entry.get("status")
            if status not in STATUSES:
                continue
        except (ValueError, TypeError):
            continue
        result["relayEvents"] += 1
        result["statuses"][status] = result["statuses"].get(status, 0) + 1
        if status == "closed" and entry.get("outcome") in OUTCOMES:
            outcome = entry["outcome"]
            result["closedOutcomes"][outcome] = result["closedOutcomes"].get(outcome, 0) + 1
    return result


if __name__ == "__main__":
    print(json.dumps(summarize(sys.stdin), sort_keys=True))
