# -*- coding: utf-8 -*-
"""
ANSIE login restrictions.

A small, settings-driven rule list that decides whether a user may sign in,
based on the username, the client IP address and the current day / time.

Rules are evaluated in order and the first rule that matches decides:

    {
        "name": "Bureaux uniquement",
        "enabled": true,
        "action": "allow" | "deny",
        "users": ["*"] or ["alice", "bob"],
        "ip_ranges": ["*"] or ["10.0.0.0/8", "192.168.1.10", "172.16.0.1-172.16.0.50"],
        "weekdays": [1, 2, 3, 4, 5],      # ISO weekday, 1 = Monday; empty = every day
        "time_start": "08:00",            # empty = no time window
        "time_end": "18:00",              # may wrap past midnight (22:00 -> 06:00)
        "message": "Connexion autorisée uniquement depuis les bureaux"
    }

When no rule matches, the login is allowed. This module has no Django
dependency so the matching logic can be tested on its own.
"""
import ipaddress
from datetime import datetime, time

ACTION_ALLOW = 'allow'
ACTION_DENY = 'deny'
ACTIONS = (ACTION_ALLOW, ACTION_DENY)
WILDCARD = '*'


def _clean_list(values):
    if values is None:
        return []
    if isinstance(values, str):
        values = values.replace('\n', ',').split(',')
    return [str(v).strip() for v in values if str(v).strip()]


def parse_time(value):
    """Parse 'HH:MM' into a time, or return None for an empty value."""
    if value in (None, ''):
        return None
    if isinstance(value, time):
        return value
    hour, minute = str(value).strip().split(':')
    return time(int(hour), int(minute))


def validate_ip_range(value):
    """Raise ValueError if `value` is not '*', an IP, a CIDR network or an 'a-b' range."""
    value = value.strip()
    if value == WILDCARD:
        return
    if '-' in value:
        start, end = (part.strip() for part in value.split('-', 1))
        start_ip, end_ip = ipaddress.ip_address(start), ipaddress.ip_address(end)
        if start_ip.version != end_ip.version or start_ip > end_ip:
            raise ValueError(value)
        return
    ipaddress.ip_network(value, strict=False)


def ip_matches(ip, ip_ranges):
    ranges = _clean_list(ip_ranges)
    if not ranges or WILDCARD in ranges:
        return True
    try:
        address = ipaddress.ip_address(str(ip).strip())
    except ValueError:
        return False

    for item in ranges:
        try:
            if '-' in item:
                start, end = (part.strip() for part in item.split('-', 1))
                start_ip, end_ip = ipaddress.ip_address(start), ipaddress.ip_address(end)
                if start_ip.version == address.version and start_ip <= address <= end_ip:
                    return True
            elif address in ipaddress.ip_network(item, strict=False):
                return True
        except ValueError:
            continue
    return False


def user_matches(username, users):
    users = _clean_list(users)
    if not users or WILDCARD in users:
        return True
    username = (username or '').lower()
    return username in {u.lower() for u in users}


def schedule_matches(now: datetime, weekdays=None, time_start=None, time_end=None):
    days = [int(d) for d in (weekdays or [])]
    if days and now.isoweekday() not in days:
        return False

    start, end = parse_time(time_start), parse_time(time_end)
    if start is None and end is None:
        return True
    current = now.time().replace(second=0, microsecond=0)
    start = start or time(0, 0)
    end = end or time(23, 59)
    if start <= end:
        return start <= current <= end
    # Window that wraps past midnight, e.g. 22:00 -> 06:00
    return current >= start or current <= end


def rule_matches(rule, username, ip, now):
    if not rule.get('enabled', True):
        return False
    return (
        user_matches(username, rule.get('users'))
        and ip_matches(ip, rule.get('ip_ranges'))
        and schedule_matches(now, rule.get('weekdays'), rule.get('time_start'), rule.get('time_end'))
    )


def find_matching_rule(rules, username, ip, now):
    """Return the first enabled rule that matches, or None."""
    for rule in rules or []:
        if isinstance(rule, dict) and rule_matches(rule, username, ip, now):
            return rule
    return None


def is_login_denied(rules, username, ip, now):
    """Return the deny rule that blocks this login, or None if it is allowed."""
    rule = find_matching_rule(rules, username, ip, now)
    if rule and rule.get('action') == ACTION_DENY:
        return rule
    return None
