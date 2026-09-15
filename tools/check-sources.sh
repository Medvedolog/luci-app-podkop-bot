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
    root/usr/libexec/rpcd/podkop_bot_bearhole \
    root/usr/libexec/rpcd/podkop_bot_warpscout_rescue \
    root/usr/lib/podkop_bot/install.sh \
    root/usr/lib/podkop_bot/podkop_bot \
    root/usr/lib/podkop_bot/podkop_bot_init \
    root/usr/lib/podkop_bot/bearhole.sh \
    root/usr/lib/podkop_bot/warpscout-rescue-watchdog \
    root/etc/init.d/podkop-bearhole \
    root/etc/init.d/podkop-warp-rescue \
    scripts/preinst scripts/postinst scripts/postrm tools/*.sh
do
    [ -f "$f" ] || continue
    if sh -n "$f" 2>/tmp/pb-sherr; then echo "ok    sh -n $f"; else echo "FAIL  sh -n $f"; cat /tmp/pb-sherr; fail=1; fi
done

# HWELP is a tiny native package, deliberately separate from the noarch LuCI
# package. Compile it on the CI host as an early C/parser self-test; OpenWrt SDK
# builds later prove target ABI/package compatibility.
HWELP_SRC="hwelp-proxy/src/hwelp-proxy.c"
HWELP_MAKE="hwelp-proxy/Makefile"
[ -f "$HWELP_SRC" ] || { echo "FAIL  native HWELP source missing"; fail=1; }
[ -f "$HWELP_MAKE" ] || { echo "FAIL  native HWELP package Makefile missing"; fail=1; }
if [ -f "$HWELP_SRC" ]; then
    _hwelp_tmp="/tmp/hwelp-proxy-check.$$"
    if cc -std=c99 -Wall -Wextra -DHWELP_VERSION='"ci"' -o "$_hwelp_tmp" "$HWELP_SRC"; then
        if "$_hwelp_tmp" --check >/dev/null; then echo "ok    c     hwelp-proxy --check"; else echo "FAIL  hwelp-proxy self-test"; fail=1; fi
    else
        echo "FAIL  native HWELP host compile"; fail=1
    fi
    rm -f "$_hwelp_tmp"
fi
grep -Fq 'DEPENDS:=+libc' "$HWELP_MAKE" || { echo "FAIL  hwelp-proxy must depend only on libc"; fail=1; }
grep -Fq 'PROXY=/usr/bin/hwelp-proxy' root/usr/libexec/rpcd/podkop_bot_bearhole || { echo "FAIL  Bearhole RPC not using native HWELP"; fail=1; }
grep -Fq 'BH_PROXY=/usr/bin/hwelp-proxy' root/etc/init.d/podkop-bearhole || { echo "FAIL  Bearhole init not using native HWELP"; fail=1; }
[ ! -e root/usr/bin/podkop-bearhole-proxy ] || { echo "FAIL  retired ucode Bearhole helper returned"; fail=1; }
grep -Fq 'install-hwelp' root/usr/lib/podkop_bot/bearhole.sh || { echo "FAIL  on-demand HWELP bootstrap missing"; fail=1; }
grep -Fq 'set_port' root/usr/libexec/rpcd/podkop_bot_bearhole || { echo "FAIL  HWELP configurable port RPC missing"; fail=1; }

# Bearhole r35 contracts: UCI is user-owned, upgrade hooks are quiet/preserving,
# HWELP cannot be abandoned after a few crashes, and mobile/manual-probe UX is
# explicitly guarded against regression.
[ ! -e root/etc/config/podkop_bearhole ] || { echo "FAIL  Bearhole UCI must not be packaged as a conffile"; fail=1; }
grep -Fq 'podkop_bearhole.preupgrade' scripts/preinst || { echo "FAIL  Bearhole pre-upgrade config preservation missing"; fail=1; }
grep -Fq 'podkop_bearhole-opkg' scripts/postinst || { echo "FAIL  stale Bearhole -opkg cleanup missing"; fail=1; }
grep -Fq 'procd_set_param respawn 3600 5 0' root/etc/init.d/podkop-bearhole || { echo "FAIL  HWELP must not be abandoned after finite respawns"; fail=1; }
BEARHOLE_JS='root/www/luci-static/resources/view/podkop-bot/bearhole.js'
TRANSPORT_JS='root/www/luci-static/resources/view/podkop-bot/transport.js'
REVOLVER_JS='root/www/luci-static/resources/view/podkop-bot/warpscout-rescue.js'
grep -Fq "max-width: 720px" "$BEARHOLE_JS" || { echo "FAIL  Bearhole mobile resource-card layout missing"; fail=1; }
grep -Fq 'Локальная авторизация hwelp (обычно не нужна)' "$BEARHOLE_JS" || { echo "FAIL  local/upstream HWELP auth distinction missing"; fail=1; }
grep -Fq "transport/warp-revolver" "$TRANSPORT_JS" || { echo "FAIL  WARP route must link to Revolver automation"; fail=1; }
grep -Fq 'Автозапуск и самовосстановление' "$REVOLVER_JS" || { echo "FAIL  WARP Rescue automation control is not prominent"; fail=1; }
grep -Fq 'Проверка цепочки:' "$TRANSPORT_JS" || { echo "FAIL  manual chain probe must use inline progress"; fail=1; }
if grep -Fq 'Проверяю цепочку сверху вниз…' "$TRANSPORT_JS"; then
    echo "FAIL  persistent full-chain notification returned" >&2; fail=1
fi

# All auxiliary rpcd log streams must use the shared control-byte/ANSI sanitizer.
LOG_JSON_LIB="root/usr/lib/podkop_bot/json-log.sh"
[ -f "$LOG_JSON_LIB" ] || { echo "FAIL  shared RPC log sanitizer missing"; fail=1; }
for _lf in \
    root/usr/libexec/rpcd/podkop_bot_bearhole \
    root/usr/libexec/rpcd/podkop_bot_warpscout \
    root/usr/libexec/rpcd/podkop_bot_warpscout_rescue \
    root/usr/libexec/rpcd/podkop_bot_warpscout_runtime \
    root/usr/libexec/rpcd/podkop_bot_warpscout_tgscan
do
    grep -Fq '. /usr/lib/podkop_bot/json-log.sh' "$_lf" || { echo "FAIL  shared log sanitizer not sourced by $_lf"; fail=1; }
    grep -Eq 'pb_json_log_(str|filter)' "$_lf" || { echo "FAIL  unsafe log JSON encoder remains in $_lf"; fail=1; }
done

# Bearhole owns no packaged UCI file: first mutation must lazily create it.
grep -Fq 'ensure_bearhole_uci()' root/usr/libexec/rpcd/podkop_bot_bearhole || { echo "FAIL  Bearhole rpcd lazy UCI init missing"; fail=1; }
grep -Fq 'bh_cfg_ensure()' root/usr/lib/podkop_bot/bearhole.sh || { echo "FAIL  Bearhole control lazy UCI init missing"; fail=1; }

# Transport/UI regression guards.
if grep -Fq 'while ! _warp_rescue_pid_alive' root/usr/lib/podkop_bot/podkop_bot; then echo "FAIL  blocking WARP Rescue wait returned"; fail=1; fi
grep -Fq 'action=demote_after_streak' root/usr/lib/podkop_bot/podkop_bot || { echo "FAIL  bounded POLL demotion missing"; fail=1; }
if grep -Fq "callRescueStatus = rpc.declare" root/www/luci-static/resources/view/podkop-bot/overview-state.js; then echo "FAIL  duplicate Overview Rescue RPC returned"; fail=1; fi
grep -Fq 'self._lastRescueStatus=v[2]' root/www/luci-static/resources/view/podkop-bot/overview.js || { echo "FAIL  Overview Rescue status reuse missing"; fail=1; }

# Vendored bot is an integrity contract, not merely documentation.
if (cd root/usr/lib/podkop_bot && sha256sum -c vendor.sha256); then
    :
else
    echo "FAIL  vendor.sha256"; fail=1
fi

if [ -f root/usr/share/luci-app-podkop-bot/install.sh ]; then
    echo "FAIL  stale duplicate installer is present"; fail=1
fi

# System journal is operator/machine-facing: built-in event templates stay
# English/ASCII. Localized labels belong in Telegram/LuCI, not logread.
python3 - <<'PY' || fail=1
import pathlib, re, sys
files = [
    pathlib.Path('root/usr/lib/podkop_bot/podkop_bot'),
    pathlib.Path('root/usr/libexec/rpcd/podkop_bot'),
    pathlib.Path('root/usr/lib/podkop_bot/bearhole.sh'),
    pathlib.Path('root/usr/lib/podkop_bot/warpscout-rescue-watchdog'),
]
forbidden_vars = (
    'ROUTE_NAME', 'LAST_ROUTE_NAME', 'LAST_ROUTE_FAST_NAME',
    'LAST_ROUTE_POLL_NAME', 'active_px_display',
    'PROBE_COUNTRY', 'PROBE_CF_COUNTRY', 'PROBE_GOOGLE_COUNTRY',
    'PROBE_ORG', 'px_type',
)
forbidden_logger_helpers = ('_proxy_display', 'display_proxy_name')
errors = []
for path in files:
    for n, line in enumerate(path.read_text().splitlines(), 1):
        if 'logger ' not in line:
            continue
        if re.search(r'[\u0400-\u04FF]', line):
            errors.append(f'{path}:{n}: Cyrillic logger literal: {line.strip()}')
        if any(v in line for v in forbidden_vars):
            errors.append(f'{path}:{n}: localized display variable in logger: {line.strip()}')
        if any(h in line for h in forbidden_logger_helpers):
            errors.append(f'{path}:{n}: display helper in logger: {line.strip()}')
if errors:
    print('\n'.join(errors))
    sys.exit(1)
print('journal language contract OK')
PY

# RPC contract: every advertised primary podkop method has definition/dispatch/ACL
# coverage and every frontend primary RPC call names an advertised method.
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

# Bearhole RPC contract including the new native-engine controls.
python3 - <<'PY' || fail=1
import json, pathlib, re, sys
p = pathlib.Path('root/usr/libexec/rpcd/podkop_bot_bearhole')
s = p.read_text()
m = re.search(r"list\)\s*\n\s*echo '(\{.*?\})'", s, re.S)
if not m:
    raise SystemExit('Bearhole RPC list JSON not found')
listed=set(json.loads(m.group(1)))
acl=json.loads(pathlib.Path('root/usr/share/rpcd/acl.d/luci-app-podkop-bot.json').read_text())['luci-app-podkop-bot']
allowed=set(acl['read']['ubus']['podkop_bot_bearhole'])|set(acl['write']['ubus']['podkop_bot_bearhole'])
missing=listed-allowed
if missing:
    raise SystemExit(f'Bearhole methods missing from ACL: {sorted(missing)}')
for need in ('start','set_enabled','set_port','qualify_start','status','results','log'):
    if need not in listed: raise SystemExit(f'Bearhole RPC missing {need}')
print('Bearhole RPC contract OK')
PY

# Telegram/root security invariants (0.19.17+).
BOT_SRC="root/usr/lib/podkop_bot/podkop_bot"
grep -Fq '[ -z "$ALLOW_ANON_ADMINS" ] && ALLOW_ANON_ADMINS="0"' "$BOT_SRC" || {
    echo "security: anonymous admins must default to disabled" >&2; exit 1;
}
grep -Fq 'UPLOAD_SESSION_TTL=300' "$BOT_SRC" || {
    echo "security: upload session TTL guard missing" >&2; exit 1;
}
grep -Fq '[ "$chat_type" != "private" ] || [ "$user_id" != "$ADMIN_ID" ]' "$BOT_SRC" || {
    echo "security: uploaded executable must be primary-admin/private-chat gated" >&2; exit 1;
}
grep -Fq 'blocked_user_ids' "$BOT_SRC" && grep -Fq 'blocked_sender_chat_ids' "$BOT_SRC" || {
    echo "security: persistent manual blocklist support missing" >&2; exit 1;
}
if grep -E 'logger .*\[Security\].*(text=|\$\{text\}|\$text)' "$BOT_SRC" >/dev/null 2>&1; then
    echo "security: attacker-controlled Telegram text must not reach syslog" >&2; exit 1
fi

# Journal verbosity contract (0.19.17+).
grep -Fq 'podkop_bot.settings.log_level="normal"' "$BOT_SRC" || {
    echo "logging: normal default missing" >&2; exit 1;
}
grep -Fq 'FOLLOWER_LOG_SUMMARY_TS_FILE' "$BOT_SRC" || {
    echo "logging: follower summary/state gate missing" >&2; exit 1;
}
grep -Fq "form.ListValue, 'log_level'" root/www/luci-static/resources/view/podkop-bot/settings.js || {
    echo "logging: LuCI verbosity selector missing" >&2; exit 1;
}

# Runtime/LuCI regression guards.
for ASYNC in root/www/luci-static/resources/view/podkop-bot/*-async.js; do
    grep -Fq 'return base.constructor.extend({' "$ASYNC" || {
        echo "LuCI: async wrapper must return a constructor: $ASYNC" >&2; fail=1
    }
    if grep -Fq 'return base;' "$ASYNC"; then
        echo "LuCI: async wrapper returns an injected instance: $ASYNC" >&2; fail=1
    fi
done
WARPSCOUT_JS="root/www/luci-static/resources/view/podkop-bot/warpscout.js"
if grep -Fq 'self.refreshView();},1800' "$WARPSCOUT_JS"; then
    echo "WARPSCOUT: manual TG result-erasing delayed refresh returned" >&2; fail=1
fi
RUNTIME_RPC="root/usr/libexec/rpcd/podkop_bot"
BOT_SRC="root/usr/lib/podkop_bot/podkop_bot"
grep -Fq "curl -q -s --noproxy '*' --connect-timeout 3 --max-time 8" "$RUNTIME_RPC" || {
    echo "Runtime: local Clash API must bypass Bearhole/curlrc" >&2; fail=1
}
grep -Fq 'Selector|URLTest|Fallback|LoadBalance)' "$RUNTIME_RPC" || {
    echo "Runtime: selector-like Clash group coverage regressed" >&2; fail=1
}
grep -Fq "curl -q --noproxy '*' -s" "$BOT_SRC" || {
    echo "Bot: local Clash API must bypass Bearhole/curlrc" >&2; fail=1
}
RESCUE_RPC="root/usr/libexec/rpcd/podkop_bot_warpscout_rescue"
grep -Fq 'wait_pid_gone(){' "$RESCUE_RPC" || {
    echo "WARP Rescue: worker completion race guard missing" >&2; fail=1
}
grep -Fq "jq -e '.ok == true'" "$RESCUE_RPC" || {
    echo "WARP Rescue: ubus JSON acknowledgement guard missing" >&2; fail=1
}
grep -Fq 'rescue_autostart' "$RESCUE_RPC" || {
    echo "WARP Rescue: autostart setting missing" >&2; fail=1
}
grep -Fq 'start_control resume' "$RESCUE_RPC" || {
    echo "WARP Rescue: runtime-test restore fallback missing" >&2; fail=1
}
grep -Fq 'event=watchdog_recover' root/usr/lib/podkop_bot/warpscout-rescue-watchdog || {
    echo "WARP Rescue: watchdog recovery path missing" >&2; fail=1
}
if grep -Fq 'Bearhole' root/www/luci-static/resources/view/podkop-bot/warpscout-rescue.js; then
    echo "WARP Rescue UI must not contain Bearhole copy" >&2; fail=1
fi

[ "$fail" -eq 0 ] || { echo "source checks failed"; exit 1; }
echo "source checks passed"