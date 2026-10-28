import unittest
from pathlib import Path
import stat
import tempfile
from unittest.mock import patch
from api_config import backup_original, merge, parse


class ApiConfigTests(unittest.TestCase):
    def test_first_backup_is_private_and_rerun_preserves_original(self):
        with tempfile.TemporaryDirectory() as root:
            backup = Path(root) / 'before.env'
            backup_original(backup, 'ORIGINAL=local-fixture\n')
            self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
            with patch('api_config.protected_read', side_effect=lambda path: path.read_text()):
                backup_original(backup, 'NEW=must-not-replace\n')
            self.assertEqual(backup.read_text(), 'ORIGINAL=local-fixture\n')

    def setUp(self):
        self.secret = 'a' * 64
        self.fragment = ('JITSI_ENABLED=false\nJITSI_ORIGIN=https://api.fit-training.ru\n'
                         'JITSI_XMPP_DOMAIN=meet.jitsi\nJITSI_MUC_DOMAIN=muc.meet.jitsi\n'
                         f'JITSI_APP_ID=fit\nJITSI_JWT_SECRET={self.secret}\n')
        self.server = f'JWT_APP_SECRET={self.secret}\n'

    def test_preserves_unrelated_credentials_and_supports_rollback(self):
        current = 'DATABASE_PASSWORD=local-fixture-only\nOTHER_FLAG=true\n'
        enabled = merge(current, self.fragment, self.server, True)
        self.assertTrue(enabled.startswith(current))
        self.assertEqual(parse(enabled)['JITSI_ENABLED'], 'true')
        disabled = merge(enabled, self.fragment, self.server, False)
        self.assertTrue(disabled.startswith(current))
        self.assertEqual(parse(disabled)['JITSI_ENABLED'], 'false')
        self.assertEqual(merge(disabled, self.fragment, self.server, False), disabled)

    def test_rejects_wrong_target_rotation_duplicates_and_extra_fragment_keys(self):
        for current, fragment, server in [
            ('', self.fragment.replace('https://api.fit-training.ru', 'https://other.example'), self.server),
            ('', self.fragment, 'JWT_APP_SECRET=' + 'b' * 64),
            ('JITSI_JWT_SECRET=' + 'b' * 64, self.fragment, self.server),
            ('KEY=one\nKEY=two', self.fragment, self.server),
            ('', self.fragment + 'DATABASE_PASSWORD=forbidden\n', self.server),
        ]:
            with self.subTest(current=bool(current)):
                with self.assertRaises(ValueError):
                    merge(current, fragment, server, True)
