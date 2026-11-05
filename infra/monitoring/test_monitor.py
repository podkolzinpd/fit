import unittest
import tempfile
import json
from pathlib import Path
from monitor import main
from unittest.mock import patch
from monitor import send
from monitor import advance


class AlertLifecycle(unittest.TestCase):
    def test_sustained_load_deduplicates_and_recovers(self):
        state = {}
        events = []
        for at in range(0, 1260, 60):
            state, emitted = advance(state, {'cpu': True}, at)
            events += emitted
        self.assertEqual(len(events), 1)
        for at in range(1260, 1620, 60):
            state, emitted = advance(state, {'cpu': False}, at)
            events += emitted
        self.assertEqual(len(events), 2)
        self.assertIn('ВОССТАНОВЛЕНО', events[-1])

    def test_critical_outage_alerts_on_first_observation(self):
        _, events = advance({}, {'public_api': True}, 0)
        self.assertEqual(len(events), 1)

    def test_missing_samples_do_not_establish_sustained_load(self):
        state, _ = advance({}, {'cpu': True}, 0)
        state, events = advance(state, {'cpu': True}, 1000)
        self.assertEqual(events, [])
        self.assertEqual(state['checks']['cpu']['since'], 1000)

    def test_background_failure_requires_repeated_observation(self):
        state, events = advance({}, {'background': True}, 0)
        self.assertEqual(events, [])
        state, events = advance(state, {'background': True}, 60)
        self.assertEqual(events, [])
        state, events = advance(state, {'background': True}, 120)
        self.assertEqual(len(events), 1)
        _, events = advance(state, {'background': True}, 180)
        self.assertEqual(events, [])

    def test_delivery_failure_propagates_for_retry(self):
        with patch.dict('os.environ', {'FIT_ALERT_TELEGRAM_BOT_TOKEN': 'synthetic', 'FIT_ALERT_TELEGRAM_CHAT_ID': '-123'}):
            with patch('urllib.request.urlopen', side_effect=TimeoutError):
                with self.assertRaises(TimeoutError):
                    send('synthetic')

    def test_flapping_does_not_alert_and_input_not_mutated(self):
        state, _ = advance({}, {'background': True}, 0)
        original = repr(state)
        next_state, _ = advance(state, {'background': False}, 60)
        self.assertEqual(repr(state), original)
        _, events = advance(next_state, {'background': True}, 120)
        self.assertEqual(events, [])


class Routing(unittest.TestCase):
    def test_daily_summary_once_per_moscow_day(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state.json'
            snapshot = Path(directory) / 'snapshot.json'
            snapshot.write_text(json.dumps({'at':21600,'active':{},'metrics':{'cpu_percent':5}}))
            with patch('sys.argv',['monitor','--mode','relay','--state',str(state),'--snapshot',str(snapshot)]), patch('time.time',return_value=21600), patch('monitor.send') as send_mock:
                main(); main()
                self.assertEqual(send_mock.call_count,1)
                self.assertIn('ежедневный',send_mock.call_args[0][0])

    def test_vm_persists_incident_without_telegram_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            path.write_text(json.dumps({'at':100,'checks':{'api':{'active':False,'since':0}}}))
            with patch('sys.argv',['monitor','--mode','host','--state',str(path)]), patch('time.time',return_value=180), patch('monitor.host_conditions',return_value=({'api':True},{},{})), patch('monitor.send') as send_mock:
                main()
                send_mock.assert_not_called()
            self.assertTrue(json.loads(path.read_text())['checks']['api']['active'])

    def test_external_relay_deduplicates_and_reports_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state.json'
            snapshot = Path(directory) / 'snapshot.json'
            with patch('sys.argv',['monitor','--mode','relay','--state',str(state),'--snapshot',str(snapshot)]), patch('time.time',return_value=180), patch('monitor.send') as send_mock:
                snapshot.write_text(json.dumps({'at':180,'active':{'api':True}}))
                main(); main()
                self.assertEqual(send_mock.call_count,1)
                snapshot.write_text(json.dumps({'at':180,'active':{'api':False}}))
                main()
                self.assertEqual(send_mock.call_count,2)

    def test_delivery_failure_keeps_previous_state_for_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state.json'
            snapshot = Path(directory) / 'snapshot.json'
            state.write_text('{}')
            snapshot.write_text(json.dumps({'at':180,'active':{'api':True}}))
            with patch('sys.argv',['monitor','--mode','relay','--state',str(state),'--snapshot',str(snapshot)]), patch('time.time',return_value=180), patch('monitor.send',side_effect=TimeoutError):
                with self.assertRaises(TimeoutError): main()
            self.assertEqual(state.read_text(),'{}')


if __name__ == '__main__':
    unittest.main()
