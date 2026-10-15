import contextlib
import io
import json
from pathlib import Path
import smtplib
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import send_recovery_email as mail


class RecoveryEmailTests(unittest.TestCase):
    def test_recipient_privacy_and_exact_reviewed_copy(self):
        smtp = MagicMock()
        smtp.send_message.return_value = {}
        for address in ['first@example.com', 'second@example.org']:
            message = mail.message_for(address)
            mail.send_one(smtp, address, message)
            self.assertEqual(message['To'].addresses[0].addr_spec, address)
            self.assertEqual(len(message['To'].addresses), 1)
            self.assertIsNone(message['Cc'])
            self.assertIsNone(message['Bcc'])
            self.assertEqual(str(message['Subject']), 'ФИТ снова работает 💪')
            self.assertIn('Мы восстановили работу FIT, можно снова возвращаться к тренировкам в приложении.', message.get_content())
            self.assertEqual(smtp.send_message.call_args.kwargs['to_addrs'], [address])
            self.assertEqual(smtp.send_message.call_args.kwargs['from_addr'], mail.SENDER)
            self.assertNotIn('second@example.org' if address.startswith('first') else 'first@example.com', message.as_string())

    def test_rejects_multiple_or_injected_recipients(self):
        for address in ['a@example.com,b@example.org', 'a@example.com\r\nBcc: b@example.org', 'a@example.com\x00']:
            with self.assertRaises(ValueError):
                mail.message_for(address)

    def test_disconnected_after_data_is_not_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            smtp = MagicMock()
            smtp.send_message.side_effect = smtplib.SMTPServerDisconnected('private details')
            smtp.__enter__.return_value = smtp
            with patch.object(mail, 'STATE_DIR', Path(directory)), patch.object(mail, 'recipients', return_value=['first@example.com']), patch.object(mail, 'smtp_login', return_value=smtp), patch.dict(mail.os.environ, {'RECOVERY_CONFIRMATION': 'SEND_FIT_RECOVERY_EMAIL_2026_10_15'}):
                with self.assertRaises(smtplib.SMTPServerDisconnected):
                    mail.run('email-send')
                ledger = (Path(directory) / (mail.CAMPAIGN + '.json')).read_text()
                self.assertNotIn('@', ledger)
                self.assertEqual(list(json.loads(ledger).values()), ['uncertain'])
                smtp.reset_mock()
                with contextlib.redirect_stdout(io.StringIO()) as output:
                    mail.run('email-send')
                smtp.send_message.assert_not_called()
                self.assertEqual(json.loads(output.getvalue())['uncertain'], 1)

    def test_accepted_message_is_durable_and_not_sent_twice(self):
        with tempfile.TemporaryDirectory() as directory:
            smtp = MagicMock()
            smtp.send_message.return_value = {}
            smtp.__enter__.return_value = smtp
            with patch.object(mail, 'STATE_DIR', Path(directory)), patch.object(mail, 'recipients', return_value=['first@example.com']), patch.object(mail, 'smtp_login', return_value=smtp), patch.object(mail.time, 'sleep'), patch.dict(mail.os.environ, {'RECOVERY_CONFIRMATION': 'SEND_FIT_RECOVERY_EMAIL_2026_10_15'}), contextlib.redirect_stdout(io.StringIO()):
                mail.run('email-send')
                mail.run('email-send')
            self.assertEqual(smtp.send_message.call_count, 1)
            self.assertEqual(list(json.loads((Path(directory) / (mail.CAMPAIGN + '.json')).read_text()).values()), ['accepted'])

    def test_test_action_only_sends_to_own_mailbox(self):
        smtp = MagicMock()
        smtp.send_message.return_value = {}
        smtp.__enter__.return_value = smtp
        with patch.object(mail, 'smtp_login', return_value=smtp), patch.object(mail, 'recipients') as source, contextlib.redirect_stdout(io.StringIO()):
            mail.run('email-test')
        source.assert_not_called()
        self.assertEqual(smtp.send_message.call_args.kwargs['to_addrs'], [mail.SENDER])
