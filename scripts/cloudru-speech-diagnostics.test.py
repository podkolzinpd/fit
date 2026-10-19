import io
import importlib.util
import json
from pathlib import Path
import unittest

module_spec = importlib.util.spec_from_file_location("cloudru_speech_diagnostics", Path(__file__).with_name("cloudru-speech-diagnostics.py"))
module = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(module)
summarize = module.summarize


class SpeechDiagnosticsTest(unittest.TestCase):
    def test_keeps_only_allowlisted_aggregate_statuses(self):
        lines = [
            json.dumps({"MESSAGE": json.dumps({"event": "cloudru_speech_session", "status": "connected", "sessionId": 1})}),
            json.dumps({"MESSAGE": json.dumps({"event": "cloudru_speech_session", "status": "streaming", "text": "private"})}),
            json.dumps({"MESSAGE": json.dumps({"event": "cloudru_speech_session", "status": "closed", "outcome": "client_stop", "audioBytes": 32000})}),
            json.dumps({"MESSAGE": "untrusted raw service output"}),
        ]
        self.assertEqual(summarize(io.StringIO("\n".join(lines))), {
            "event": "cloudru_speech_diagnostics", "journalEntries": 4, "relayEvents": 3,
            "statuses": {"connected": 1, "streaming": 1, "closed": 1}, "closedOutcomes": {"client_stop": 1},
        })


if __name__ == "__main__":
    unittest.main()
