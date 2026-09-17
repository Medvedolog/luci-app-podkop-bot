#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

python3 - <<'PY'
import json
import pathlib
import re
import sys

root = pathlib.Path('.')
js = (root / 'root/www/luci-static/resources/view/podkop-bot/tailscale.js').read_text()
acl = json.loads((root / 'root/usr/share/rpcd/acl.d/luci-app-podkop-bot.json').read_text())['luci-app-podkop-bot']
errors = []


def advertised(path, metadata=()):
    text = path.read_text()
    m = re.search(r"list\)\s*echo '(\{.*?\})'", text, re.S)
    if not m:
        raise SystemExit(f'RPC list JSON not found: {path}')
    return set(json.loads(m.group(1))) - set(metadata)


def allowed(obj):
    a = set(acl['read']['ubus'].get(obj, []))
    a |= set(acl['write']['ubus'].get(obj, []))
    return a

# Main Tailscale control object.
obj = 'podkop_bot_tailscale'
listed = advertised(root / 'root/usr/libexec/rpcd/podkop_bot_tailscale', {'api_version'})
front = set(re.findall(r"object:\s*'podkop_bot_tailscale'\s*,\s*method:\s*'([^']+)'", js, re.S))
allow = allowed(obj)
for label, missing in [
    ('Tailscale backend methods missing from ACL', listed - allow),
    ('Tailscale frontend methods missing from backend list', front - listed),
    ('Tailscale frontend methods missing from ACL', front - allow),
]:
    if missing:
        errors.append(f'{label}: {sorted(missing)}')
required = {'status', 'create', 'set_enabled', 'set_advertise_exit_node', 'set_accept_routes', 'reapply', 'delete'}
if required - listed:
    errors.append(f'Tailscale required RPC methods missing: {sorted(required - listed)}')

# Optional cron auto-repair has its own tiny RPC object so it does not enlarge
# the main Tailscale lifecycle backend.
repair_obj = 'podkop_bot_tsnet_repair'
repair_listed = advertised(root / 'root/usr/libexec/rpcd/podkop_bot_tsnet_repair')
repair_front = set(re.findall(r"object:\s*'podkop_bot_tsnet_repair'\s*,\s*method:\s*'([^']+)'", js, re.S))
repair_allow = allowed(repair_obj)
for label, missing in [
    ('Repair backend methods missing from ACL', repair_listed - repair_allow),
    ('Repair frontend methods missing from backend list', repair_front - repair_listed),
    ('Repair frontend methods missing from ACL', repair_front - repair_allow),
]:
    if missing:
        errors.append(f'{label}: {sorted(missing)}')
repair_required = {'status', 'set_enabled'}
if repair_required - repair_listed:
    errors.append(f'Repair required RPC methods missing: {sorted(repair_required - repair_listed)}')

if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)

print(f'Tailscale RPC/ACL contract OK: {len(listed)} main + {len(repair_listed)} repair methods')
PY
