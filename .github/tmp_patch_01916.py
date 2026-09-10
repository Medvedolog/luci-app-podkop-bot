from pathlib import Path

# Version surfaces.
Path('version.txt').write_text('0.19.16\n')

p = Path('Makefile')
s = p.read_text()
assert s.count('PKG_VERSION:=0.19.15') == 1
p.write_text(s.replace('PKG_VERSION:=0.19.15', 'PKG_VERSION:=0.19.16', 1))

p = Path('root/usr/libexec/rpcd/podkop_bot')
s = p.read_text()
assert s.count('LUCI_APP_VERSION="0.19.15"') == 1
p.write_text(s.replace('LUCI_APP_VERSION="0.19.15"', 'LUCI_APP_VERSION="0.19.16"', 1))

p = Path('README.md')
s = p.read_text()
assert '`0.19.15` · OpenWrt · LuCI · opkg / apk' in s
p.write_text(s.replace('`0.19.15` · OpenWrt · LuCI · opkg / apk', '`0.19.16` · OpenWrt · LuCI · opkg / apk', 1))

# Changelog.
p = Path('CHANGELOG.md')
s = p.read_text()
marker = '# Changelog\n\n'
if marker not in s:
    raise SystemExit('CHANGELOG marker not found')
entry = '''# Changelog

## v0.19.16

- **TRANSPORT:** vendored bot gains a Telegram-aware parallel follower: `getMe` is probed concurrently through tier1, every tier2 fallback/auto-section and tier3. On reserve/degraded POLL routes it refreshes every health tick.
- **ANTI-FLAP:** one failed POLL proxy cascade is held when the follower still has a fresh successful Telegram sample; a second consecutive failure may demote to Direct. FAST remains independent.
- **JOURNAL:** localized probe/route display values are kept out of syslog; source checks reject known presentation variables and display helpers in logger calls.

'''
p.write_text(s.replace(marker, entry, 1))

# Strengthen journal contract guard.
p = Path('tools/check-sources.sh')
s = p.read_text()
old = '''forbidden_vars = (
    'ROUTE_NAME', 'LAST_ROUTE_NAME', 'LAST_ROUTE_FAST_NAME',
    'LAST_ROUTE_POLL_NAME', 'active_px_display',
)'''
new = '''forbidden_vars = (
    'ROUTE_NAME', 'LAST_ROUTE_NAME', 'LAST_ROUTE_FAST_NAME',
    'LAST_ROUTE_POLL_NAME', 'active_px_display',
    # UI/display fallbacks below may contain localized text; logger must use
    # an ASCII/machine value (normally via _journal_value) instead.
    'PROBE_COUNTRY', 'PROBE_CF_COUNTRY', 'PROBE_GOOGLE_COUNTRY',
    'PROBE_ORG', 'px_type',
)
forbidden_logger_helpers = ('_proxy_display', 'display_proxy_name')'''
assert old in s
s = s.replace(old, new, 1)
old2 = '''        if any(v in line for v in forbidden_vars):
            errors.append(f'{path}:{n}: localized display variable in logger: {line.strip()}')'''
new2 = '''        if any(v in line for v in forbidden_vars):
            errors.append(f'{path}:{n}: localized display variable in logger: {line.strip()}')
        if any(h in line for h in forbidden_logger_helpers):
            errors.append(f'{path}:{n}: display helper in logger: {line.strip()}')'''
assert old2 in s
p.write_text(s.replace(old2, new2, 1))
