from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase, override_settings

from authentication import ansie_rules, errors
from authentication.mixins import AuthMixin

# 2026-10-12 is a Monday, 2026-10-18 a Sunday
MONDAY_10H = datetime(2026, 10, 12, 10, 0)
MONDAY_20H = datetime(2026, 10, 12, 20, 0)
SUNDAY_10H = datetime(2026, 10, 18, 10, 0)

OFFICE_ONLY = [
    {'name': 'Bureaux', 'action': 'allow', 'users': ['*'], 'ip_ranges': ['10.0.0.0/8'],
     'weekdays': [1, 2, 3, 4, 5], 'time_start': '08:00', 'time_end': '18:00'},
    {'name': 'Tout le reste', 'action': 'deny', 'users': ['*'], 'ip_ranges': ['*'],
     'message': 'Connexion autorisée uniquement depuis les bureaux'},
]


class IpMatchingTests(SimpleTestCase):
    def test_wildcard_and_empty_match_everything(self):
        self.assertTrue(ansie_rules.ip_matches('1.2.3.4', ['*']))
        self.assertTrue(ansie_rules.ip_matches('1.2.3.4', []))

    def test_single_ip_network_and_range(self):
        self.assertTrue(ansie_rules.ip_matches('192.168.1.10', ['192.168.1.10']))
        self.assertTrue(ansie_rules.ip_matches('10.20.30.40', ['10.0.0.0/8']))
        self.assertTrue(ansie_rules.ip_matches('172.16.0.25', ['172.16.0.1-172.16.0.50']))
        self.assertFalse(ansie_rules.ip_matches('172.16.0.51', ['172.16.0.1-172.16.0.50']))
        self.assertFalse(ansie_rules.ip_matches('8.8.8.8', ['10.0.0.0/8', '192.168.0.0/16']))

    def test_ipv6_and_invalid_input(self):
        self.assertTrue(ansie_rules.ip_matches('2001:db8::1', ['2001:db8::/32']))
        self.assertFalse(ansie_rules.ip_matches('not-an-ip', ['10.0.0.0/8']))
        self.assertFalse(ansie_rules.ip_matches('10.0.0.1', ['garbage']))

    def test_validate_ip_range(self):
        for value in ('*', '10.0.0.1', '10.0.0.0/8', '10.0.0.1-10.0.0.9', '2001:db8::/32'):
            ansie_rules.validate_ip_range(value)
        for value in ('abc', '10.0.0.9-10.0.0.1', '10.0.0.1-2001:db8::1', '300.1.1.1'):
            with self.assertRaises(ValueError):
                ansie_rules.validate_ip_range(value)


class ScheduleAndUserTests(SimpleTestCase):
    def test_users_are_case_insensitive(self):
        self.assertTrue(ansie_rules.user_matches('Alice', ['alice', 'bob']))
        self.assertFalse(ansie_rules.user_matches('carol', ['alice', 'bob']))
        self.assertTrue(ansie_rules.user_matches('carol', ['*']))

    def test_weekdays_and_time_window(self):
        self.assertTrue(ansie_rules.schedule_matches(MONDAY_10H, [1], '08:00', '18:00'))
        self.assertFalse(ansie_rules.schedule_matches(MONDAY_20H, [1], '08:00', '18:00'))
        self.assertFalse(ansie_rules.schedule_matches(SUNDAY_10H, [1, 2, 3, 4, 5]))
        self.assertTrue(ansie_rules.schedule_matches(SUNDAY_10H, []))

    def test_window_wrapping_past_midnight(self):
        night = ('22:00', '06:00')
        self.assertTrue(ansie_rules.schedule_matches(datetime(2026, 10, 12, 23, 30), [], *night))
        self.assertTrue(ansie_rules.schedule_matches(datetime(2026, 10, 12, 5, 59), [], *night))
        self.assertFalse(ansie_rules.schedule_matches(MONDAY_10H, [], *night))


class RuleEvaluationTests(SimpleTestCase):
    def test_no_rules_allows(self):
        self.assertIsNone(ansie_rules.is_login_denied([], 'alice', '1.2.3.4', MONDAY_10H))

    def test_first_matching_rule_wins(self):
        deny = ansie_rules.is_login_denied
        self.assertIsNone(deny(OFFICE_ONLY, 'alice', '10.1.2.3', MONDAY_10H))
        self.assertEqual(deny(OFFICE_ONLY, 'alice', '8.8.8.8', MONDAY_10H)['name'], 'Tout le reste')
        self.assertEqual(deny(OFFICE_ONLY, 'alice', '10.1.2.3', MONDAY_20H)['name'], 'Tout le reste')
        self.assertEqual(deny(OFFICE_ONLY, 'alice', '10.1.2.3', SUNDAY_10H)['name'], 'Tout le reste')

    def test_disabled_rules_are_skipped(self):
        rules = [{'name': 'Off', 'enabled': False, 'action': 'deny', 'users': ['*']}]
        self.assertIsNone(ansie_rules.is_login_denied(rules, 'alice', '1.2.3.4', MONDAY_10H))

    def test_rule_limited_to_some_users(self):
        rules = [{'name': 'Prestataires', 'action': 'deny', 'users': ['ext.dupont'], 'ip_ranges': ['*']}]
        self.assertIsNotNone(ansie_rules.is_login_denied(rules, 'ext.dupont', '10.0.0.1', MONDAY_10H))
        self.assertIsNone(ansie_rules.is_login_denied(rules, 'alice', '10.0.0.1', MONDAY_10H))


@patch('authentication.mixins.local_now', return_value=MONDAY_20H)
@patch('authentication.errors.failed.post_auth_failed')
class LoginCheckTests(SimpleTestCase):
    def _check(self, user, ip='8.8.8.8'):
        mixin = AuthMixin()
        mixin.request = Mock()
        mixin._check_ansie_login_rules(user, ip)

    @override_settings(ANSIE_LOGIN_RULES_ENABLED=True, ANSIE_LOGIN_RULES=OFFICE_ONLY,
                       ANSIE_LOGIN_RULES_EXEMPT_SUPERUSER=True)
    def test_blocked_user_gets_the_rule_message(self, *_):
        user = SimpleNamespace(username='alice', is_superuser=False)
        with self.assertRaises(errors.AnsieLoginRuleNotAllowed) as ctx:
            self._check(user)
        self.assertEqual(ctx.exception.msg, 'Connexion autorisée uniquement depuis les bureaux')

    @override_settings(ANSIE_LOGIN_RULES_ENABLED=True, ANSIE_LOGIN_RULES=OFFICE_ONLY,
                       ANSIE_LOGIN_RULES_EXEMPT_SUPERUSER=True)
    def test_super_administrator_is_exempt(self, *_):
        self._check(SimpleNamespace(username='admin', is_superuser=True))

    @override_settings(ANSIE_LOGIN_RULES_ENABLED=False, ANSIE_LOGIN_RULES=OFFICE_ONLY)
    def test_rules_ignored_when_disabled(self, *_):
        self._check(SimpleNamespace(username='alice', is_superuser=False))
