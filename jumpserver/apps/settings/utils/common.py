# coding: utf-8
import re

from jumpserver.context_processor import default_interface
from django.conf import settings
from django.templatetags.static import static
from IPy import IP

from common.utils import lookup_domain


_HEX_COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')


def _mix_hex(color, other, weight):
    """Mix `other` into `color` (both #rrggbb); weight is the share of `other`, 0-1."""
    c = [int(color[i:i + 2], 16) for i in (1, 3, 5)]
    o = [int(other[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join('{:02x}'.format(round(a + (b - a) * weight)) for a, b in zip(c, o))


def get_ansie_interface():
    """Branding configured from Settings > ANSIE customisation."""
    # Values saved from the UI are validated; fall back if config.yml holds something else.
    primary = settings.ANSIE_PRIMARY_COLOR if _HEX_COLOR_RE.match(settings.ANSIE_PRIMARY_COLOR or '') else '#0b4ea2'
    accent = settings.ANSIE_ACCENT_COLOR if _HEX_COLOR_RE.match(settings.ANSIE_ACCENT_COLOR or '') else '#0a9a25'
    return {
        'brand_name': settings.ANSIE_BRAND_NAME or 'ANSIE',
        'brand_subtitle': settings.ANSIE_BRAND_SUBTITLE,
        'login_description': settings.ANSIE_LOGIN_DESCRIPTION,
        'logo': settings.ANSIE_LOGO or static('img/ansie_logo.png'),
        'primary_color': primary,
        'primary_dark': _mix_hex(primary, '#000000', 0.3),
        'primary_darker': _mix_hex(primary, '#000000', 0.45),
        'primary_light': _mix_hex(primary, '#ffffff', 0.25),
        'accent_color': accent,
    }


def get_ansie_theme_colors(ansie):
    """Full colour set for the admin console (Lina reads INTERFACE.theme_info.colors)."""
    return {
        '--color-primary': ansie['primary_color'],
        '--color-success': ansie['accent_color'],
        '--color-info': '#1e6fd9',
        '--color-warning': '#f59e0b',
        '--color-danger': '#e5484d',
        '--color-link': ansie['primary_color'],
        '--color-text-primary': '#1e293b',
        '--color-text-secondary': '#64748b',
        '--color-icon-primary': '#475569',
        '--color-border': '#e3e8ef',
        '--color-input-border': '#cbd5e1',
        '--color-disabled-background': '#f5f7fa',
        '--color-disabled': '#b6bfcc',
        '--color-help-text': '#8a94a6',
        '--page-background-color': '#ffffff',
        '--page-content-background-color': '#f3f6fb',
        '--panel-border-color': 'var(--el-border-color-lighter, #ebeef5)',
        '--banner-bg': ansie['primary_dark'],
        '--submenu-bg': '#ffffff',
        '--menu-bg': '#ffffff',
        '--menu-text': '#334155',
        '--menu-text-active': ansie['primary_color'],
        '--menu-hover': '#ffffff',
    }


def get_interface_setting_or_default():
    if not settings.XPACK_ENABLED:
        ansie = get_ansie_interface()
        interface = dict(default_interface)
        interface['ansie'] = ansie
        interface['theme_info'] = {'colors': get_ansie_theme_colors(ansie)}
        if settings.ANSIE_LOGIN_TITLE:
            interface['login_title'] = settings.ANSIE_LOGIN_TITLE
        return interface

    from xpack.plugins.interface.models import Interface
    return Interface.get_interface_setting(default_interface)


def get_login_title():
    return get_interface_setting_or_default()['login_title']


def generate_ips(address_string, max_count=None):
    def transform(_ip):
        real_ip, err_msg = lookup_domain(_ip)
        return _ip if err_msg or real_ip == '0.0.0.0' else real_ip

    # 支持的格式
    # 192.168.1.1,192.168.1.2
    # 192.168.1.1-12 | 192.168.1.1-192.168.1.12 | 192.168.1.0/30 | 192.168.1.1
    if max_count is not None and len(address_string) > max_count * 256:
        raise ValueError('Target specification is too long')
    ips = []
    ip_list = address_string.split(',')
    if max_count is not None and len(ip_list) > max_count:
        raise ValueError(f'At most {max_count} target addresses may be scanned')
    if len(ip_list) >= 1:
        count = 0
        for ip in ip_list:
            try:
                address = IP(transform(ip))
            except ValueError:
                continue
            count += address.len()
            if max_count is not None and count > max_count:
                raise ValueError(f'At most {max_count} target addresses may be scanned')
            ips.append(str(address))
        if ips:
            return ips

    ip_list = address_string.split('-')
    try:
        if len(ip_list) == 2:
            start_ip, end_ip = ip_list
            if ip_list[1].find('.') == -1:
                end_ip = start_ip[:start_ip.rindex('.') + 1] + end_ip
            start, end = IP(start_ip).int(), IP(end_ip).int()
            count = end - start + 1
            addresses = (str(addr) for value in range(start, end + 1) for addr in IP(value))
        else:
            network = IP(ip_list[0])
            count = network.len()
            addresses = (str(ip) for ip in network)
    except ValueError:
        return []
    if max_count is not None and count > max_count:
        raise ValueError(f'At most {max_count} target addresses may be scanned')
    ips.extend(addresses)
    return ips


def is_valid_port(port):
    valid = True
    try:
        port = int(port)
        if port > 65535 or port < 1:
            valid = False
    except (TypeError, ValueError):
        valid = False
    return valid


def generate_ports(ports):
    port_list = []
    if isinstance(ports, int):
        port_list.append(ports)
    elif isinstance(ports, str):
        port_list.extend(
            [int(p) for p in ports.split(',') if p.isdigit()]
        )
    elif isinstance(ports, list):
        port_list = ports
    port_list = list(map(int, filter(is_valid_port, port_list)))
    return port_list
