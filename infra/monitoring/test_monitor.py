import unittest
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

    def test_missing_samples_do_not_establish_sustained_load(self):
        state, _ = advance({}, {'cpu': True}, 0)
        state, events = advance(state, {'cpu': True}, 1000)
        self.assertEqual(events, [])
        self.assertEqual(state['checks']['cpu']['since'], 1000)

    def test_api_failure_requires_repeated_observation(self):
        state, events = advance({}, {'api': True}, 0)
        self.assertEqual(events, [])
        state, events = advance(state, {'api': True}, 60)
        self.assertEqual(events, [])
        state, events = advance(state, {'api': True}, 120)
        self.assertEqual(len(events), 1)
        _, events = advance(state, {'api': True}, 180)
        self.assertEqual(events, [])

    def test_delivery_failure_propagates_for_retry(self):
        with patch.dict('os.environ', {'FIT_ALERT_TELEGRAM_BOT_TOKEN': 'synthetic', 'FIT_ALERT_TELEGRAM_CHAT_ID': '-123'}):
            with patch('urllib.request.urlopen', side_effect=TimeoutError):
                with self.assertRaises(TimeoutError):
                    send('synthetic')

    def test_flapping_does_not_alert_and_input_not_mutated(self):
        state, _ = advance({}, {'api': True}, 0)
        original = repr(state)
        next_state, _ = advance(state, {'api': False}, 60)
        self.assertEqual(repr(state), original)
        _, events = advance(next_state, {'api': True}, 120)
        self.assertEqual(events, [])


if __name__ == '__main__':
    unittest.main()
