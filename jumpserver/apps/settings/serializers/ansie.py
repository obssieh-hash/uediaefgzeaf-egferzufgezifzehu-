import re

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from authentication.ansie_rules import ACTIONS, parse_time, validate_ip_range

__all__ = [
    'AnsieInterfaceSettingSerializer', 'AnsieLoginRuleSerializer',
    'AnsieLoginRulesSettingSerializer',
]

HEX_COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')
LOGO_DATA_URI_RE = re.compile(r'^data:image/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$')
# A base64 image of ~500 KB
LOGO_MAX_LENGTH = 700 * 1024


def validate_hex_color(value):
    if not HEX_COLOR_RE.match(value or ''):
        raise serializers.ValidationError(_('Use a hexadecimal colour such as #0b4ea2'))
    return value.lower()


class AnsieInterfaceSettingSerializer(serializers.Serializer):
    PREFIX_TITLE = 'ANSIE'

    ANSIE_BRAND_NAME = serializers.CharField(
        max_length=32, required=False, label=_('Brand name'),
        help_text=_('Short name shown next to the logo, e.g. ANSIE')
    )
    ANSIE_BRAND_SUBTITLE = serializers.CharField(
        max_length=128, required=False, allow_blank=True, label=_('Organisation name'),
    )
    ANSIE_LOGIN_TITLE = serializers.CharField(
        max_length=128, required=False, allow_blank=True, label=_('Platform title'),
        help_text=_('Shown in the browser tab and on the login page. Leave empty to keep the default')
    )
    ANSIE_LOGIN_DESCRIPTION = serializers.CharField(
        max_length=400, required=False, allow_blank=True, label=_('Login page message'),
    )
    ANSIE_LOGO = serializers.CharField(
        max_length=LOGO_MAX_LENGTH, required=False, allow_blank=True, trim_whitespace=True,
        label=_('Logo'), help_text=_('PNG, JPEG, WebP or SVG image, 500 KB at most')
    )
    ANSIE_PRIMARY_COLOR = serializers.CharField(
        max_length=7, required=False, label=_('Primary colour'), validators=[validate_hex_color]
    )
    ANSIE_ACCENT_COLOR = serializers.CharField(
        max_length=7, required=False, label=_('Accent colour'), validators=[validate_hex_color]
    )

    @staticmethod
    def validate_ANSIE_LOGO(value):
        if not value:
            return ''
        is_data_uri = LOGO_DATA_URI_RE.match(value)
        is_url = value.startswith(('https://', 'http://', '/')) and len(value) <= 1024 \
            and not any(c in value for c in '"\'<> \n')
        if not (is_data_uri or is_url):
            raise serializers.ValidationError(_('Upload a PNG, JPEG, WebP or SVG image'))
        return value


class AnsieLoginRuleSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=64)
    enabled = serializers.BooleanField(default=True)
    action = serializers.ChoiceField(choices=ACTIONS, default='deny')
    users = serializers.ListField(
        child=serializers.CharField(max_length=128), required=False, default=list
    )
    ip_ranges = serializers.ListField(
        child=serializers.CharField(max_length=128), required=False, default=list
    )
    weekdays = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=7), required=False, default=list
    )
    time_start = serializers.CharField(max_length=5, required=False, allow_blank=True, default='')
    time_end = serializers.CharField(max_length=5, required=False, allow_blank=True, default='')
    message = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')

    @staticmethod
    def _validate_time(value):
        if not value:
            return ''
        try:
            parse_time(value)
        except (ValueError, TypeError):
            raise serializers.ValidationError(_('Use the HH:MM format, e.g. 08:00'))
        return value

    def validate_time_start(self, value):
        return self._validate_time(value)

    def validate_time_end(self, value):
        return self._validate_time(value)

    @staticmethod
    def validate_users(value):
        return [v.strip() for v in value if v.strip()]

    @staticmethod
    def validate_ip_ranges(value):
        cleaned = []
        for item in value:
            item = item.strip()
            if not item:
                continue
            try:
                validate_ip_range(item)
            except ValueError:
                raise serializers.ValidationError(
                    _('Invalid address: {}. Use *, an IP, a network (10.0.0.0/8) '
                      'or a range (10.0.0.1-10.0.0.50)').format(item)
                )
            cleaned.append(item)
        return cleaned

    @staticmethod
    def validate_weekdays(value):
        return sorted(set(value))


class AnsieLoginRulesSettingSerializer(serializers.Serializer):
    PREFIX_TITLE = _('Login restrictions')

    ANSIE_LOGIN_RULES_ENABLED = serializers.BooleanField(
        required=False, label=_('Enable login restrictions')
    )
    ANSIE_LOGIN_RULES_EXEMPT_SUPERUSER = serializers.BooleanField(
        required=False, label=_('Never block super administrators'),
        help_text=_('Keeps an administrator able to sign in if a rule is too strict')
    )
    ANSIE_LOGIN_RULES = AnsieLoginRuleSerializer(many=True, required=False, label=_('Rules'))
