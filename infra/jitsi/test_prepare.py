"""Offline bundle checks: credential continuity, overwrite and input boundaries."""
import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BundleTest(unittest.TestCase):
    def test_secrets_match_services_without_becoming_public_or_overwritten(self):
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / 'bundle'
            module.prepare(output, '8.8.8.8', '10.70.10.8', 'meet.example.com')
            env = dict(line.split('=', 1) for line in (output / '.env').read_text().splitlines())
            api = dict(line.split('=', 1) for line in (output / 'api.env.fragment').read_text().splitlines())
            self.assertEqual(api['JITSI_JWT_SECRET'], env['JWT_APP_SECRET'])
            self.assertIn('static-auth-secret=' + env['TURN_CREDENTIALS'], (output / 'turnserver.conf').read_text())
            self.assertEqual(api['JITSI_ENABLED'], 'false')
            credentials = [env[key] for key in ['JWT_APP_SECRET', 'TURN_CREDENTIALS', 'JICOFO_AUTH_PASSWORD', 'JVB_AUTH_PASSWORD']]
            self.assertEqual(len(set(credentials)), 4)
            for credential in credentials:
                self.assertEqual(len(bytes.fromhex(credential)), 32)
                self.assertNotIn(credential, (output / 'nginx-locations.conf').read_text())
            for name in ['.env', 'api.env.fragment', 'turnserver.conf']:
                self.assertEqual(stat.S_IMODE((output / name).stat().st_mode), 0o600)
            before = (output / '.env').read_bytes()
            with self.assertRaises(FileExistsError):
                module.prepare(output, '8.8.8.8', '10.70.10.8', 'meet.example.com')
            self.assertEqual(before, (output / '.env').read_bytes())
            self.assertIn('MemoryMax=2G', (output / 'fit-jitsi.slice').read_text())
            self.assertIn('CPUQuota=100%', (output / 'fit-jitsi.slice').read_text())
            self.assertEqual((output / 'compose.fit.yml').read_text().count('cgroup_parent: fit-jitsi.slice'), 4)

    def test_invalid_addresses_and_config_injection_create_nothing(self):
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / 'bundle'
            for public, private, domain in [
                ('10.0.0.1', '10.0.0.2', 'meet.example.com'),
                ('8.8.8.8', '127.0.0.1', 'meet.example.com'),
                ('8.8.8.8', '10.0.0.2', 'meet.example.com;\ninclude /tmp/*;'),
            ]:
                with self.assertRaises(ValueError):
                    module.prepare(output, public, private, domain)
                self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
