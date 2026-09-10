#!/bin/sh
# Package-specific source checks. Generic staged-payload checks are also run by
# `owfeed check`/doctor; these catch project contracts before packaging.
set -eu
cd "$(dirname "$0")/.."

fail=0

for f in root/www/luci-static/resources/view/podkop-bot/*.js; do
    if node --check "$f" >/dev/null; then echo "ok    js    $f"; else echo "FAIL  js    $f"; fail=1; fi
done

for f in root/usr/share/luci/menu.d/*.json root/usr/share/rpcd/acl.d/*.json; do
    if jq empty "$f" >/dev/null 2>&1; then echo "ok    json  $f"; else echo "FAIL  json  $f"; fail=1; fi
done

for f in \
    root/usr/libexec/rpcd/podkop_bot \
    root/usr/lib/podkop_bot/install.sh \
    root/usr/lib/podkop_bot/podkop_bot \
    root/usr/lib/podkop_bot/podkop_bot_init \
    scripts/postinst scripts/postrm tools/*.sh
do
    [ -f "$f" ] || continue
    if sh -n "$f" 2>/tmp/pb-sherr; then echo "ok    sh -n $f"; else echo "FAIL  sh -n $f"; cat /tmp/pb-sherr; fail=1; fi
done

# Vendored bot is an integrity contract, not merely documentation.
if (cd root/usr/lib/podkop_bot && sha256sum -c vendor.sha256); then
    :
else
    echo "FAIL  vendor.sha256"; fail=1
fi

# The stale historical installer must never re-enter the payload.
if [ -f root/usr/share/luci-app-podkop-bot/install.sh ]; then
    echo "FAIL  stale duplicate installer is present"; fail=1
fi

# System journal is operator/machine-facing: built-in event templates stay
# English/ASCII. Localized labels belong in Telegram/LuCI, not logread.
# Also reject the known human-facing variables that can contain localized route
# names even when the logger source line itself is ASCII.
python3 - <<'PY' || fail=1
import pathlib, re, sys
files = [
    pathlib.Path('root/usr/lib/podkop_bot/podkop_bot'),
    pathlib.Path('root/usr/libexec/rpcd/podkop_bot'),
]
forbidden_vars = (
    'ROUTE_NAME', 'LAST_ROUTE_NAME', 'LAST_ROUTE_FAST_NAME',
    'LAST_ROUTE_POLL_NAME', 'active_px_display',
)
errors = []
for path in files:
    for n, line in enumerate(path.read_text().splitlines(), 1):
        if 'logger ' not in line:
            continue
        if re.search(r'[\u0400-\u04FF]', line):
            errors.append(f'{path}:{n}: Cyrillic logger literal: {line.strip()}')
        if any(v in line for v in forbidden_vars):
            errors.append(f'{path}:{n}: localized display variable in logger: {line.strip()}')
if errors:
    print('\n'.join(errors))
    sys.exit(1)
print('journal language contract OK')
PY

# RPC contract: every advertised method has a definition/dispatch/ACL entry and
# every frontend RPC call names an advertised method.
python3 - <<'PY' || fail=1
import json, pathlib, re, sys
root = pathlib.Path('.')
rpc = (root / 'root/usr/libexec/rpcd/podkop_bot').read_text()
acl = json.loads((root / 'root/usr/share/rpcd/acl.d/luci-app-podkop-bot.json').read_text())['luci-app-podkop-bot']
m = re.search(r"case \"\$1\" in\s*list\)\s*echo '(\{.*?\})'", rpc, re.S)
if not m:
    raise SystemExit('RPC list JSON not found')
listed = set(json.loads(m.group(1))) - {'list'}
defs = set(re.findall(r'^method_([a-zA-Z0-9_]+)\(\)', rpc, re.M))
pairs = re.findall(r'^\s*([a-zA-Z0-9_]+)\)\s+method_([a-zA-Z0-9_]+)\s*;;', rpc, re.M)
dispatch = {a for a,b in pairs if a == b}
bad_pairs = [(a,b) for a,b in pairs if a != b]
aclm = set(acl['read']['ubus']['podkop_bot']) | set(acl['write']['ubus']['podkop_bot'])
js = '\n'.join(p.read_text() for p in (root / 'root/www/luci-static/resources/view/podkop-bot').glob('*.js'))
frontend = set(re.findall(r"object:\s*'podkop_bot'\s*,\s*method:\s*'([^']+)'", js, re.S))
errors = []
for label, missing in [
    ('listed without definition', listed-defs),
    ('dispatched without definition', dispatch-defs),
    ('listed without dispatch', listed-dispatch),
    ('dispatch missing from list', dispatch-listed),
    ('listed missing from ACL', listed-aclm),
    ('frontend method missing from list', frontend-listed),
]:
    if missing: errors.append(f"{label}: {sorted(missing)}")
if bad_pairs: errors.append(f"dispatch name mismatch: {bad_pairs}")
if errors:
    print('\n'.join(errors)); sys.exit(1)
print(f'RPC contract OK: {len(listed)} methods')
PY

[ "$fail" -eq 0 ] || { echo "source checks failed"; exit 1; }
echo "source checks passed"
