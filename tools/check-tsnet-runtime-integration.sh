#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

RPC=root/usr/libexec/rpcd/podkop_bot_tailscale
REPAIR_RPC=root/usr/libexec/rpcd/podkop_bot_tsnet_repair
APPLY=root/usr/lib/podkop_bot/tsnet-runtime-apply.sh
REPAIR=root/usr/lib/podkop_bot/tsnet-auto-repair.sh
POSTINST=scripts/postinst
POSTRM=scripts/postrm

for f in "$RPC" "$REPAIR_RPC" "$APPLY" "$REPAIR"; do
    [ -f "$f" ] || { echo "FAIL  missing tsnet integration file: $f" >&2; exit 1; }
    sh -n "$f"
done

[ ! -e root/etc/init.d/podkop-tsnet-overlay ] || { echo "FAIL  retired tsnet overlay service returned" >&2; exit 1; }
[ ! -e root/usr/lib/podkop_bot/tsnet-overlay-watch.sh ] || { echo "FAIL  retired tsnet watcher returned" >&2; exit 1; }

if grep -Eq '^[[:space:]]*while[[:space:]]' "$APPLY" "$REPAIR"; then
    echo "FAIL  tsnet helpers must be bounded one-shot operations, not watchers" >&2
    exit 1
fi
if grep -Eq 'procd_|respawn|podkop-tsnet-overlay' "$APPLY" "$REPAIR" "$RPC" "$REPAIR_RPC"; then
    echo "FAIL  persistent tsnet lifecycle control returned" >&2
    exit 1
fi

grep -Fq 'RUNTIME_APPLY="/usr/lib/podkop_bot/tsnet-runtime-apply.sh"' "$RPC" || { echo "FAIL  rpc does not use one-shot runtime helper" >&2; exit 1; }
grep -Fq 'runtime_apply_failed' "$RPC" || { echo "FAIL  explicit runtime apply failure reporting missing" >&2; exit 1; }
grep -Fq 'volatile_runtime:true' "$RPC" || { echo "FAIL  non-native runtime volatility contract missing" >&2; exit 1; }
grep -Fq 'mv -f "$_tmp" "$_cfg"' "$APPLY" || { echo "FAIL  atomic runtime swap missing" >&2; exit 1; }
grep -Fq 'rollback=restart_failed' "$APPLY" || { echo "FAIL  restart rollback missing" >&2; exit 1; }

# Auto-repair must wait for an actually usable Podkop/Forkop dataplane. A live
# sing-box PID is not sufficient after provider regeneration.
grep -Fq "ubus call podkop_bot runtime_sections" "$REPAIR" || { echo "FAIL  auto-repair must discover Mixed Proxy runtime sections" >&2; exit 1; }
grep -Fq "ubus call podkop_bot transport_probe" "$REPAIR" || { echo "FAIL  auto-repair must use the existing transport probe" >&2; exit 1; }
grep -Fq '.telegram_reached==true' "$REPAIR" || { echo "FAIL  auto-repair readiness must require real traffic" >&2; exit 1; }
grep -Fq '/var/run/forkop.reload.lock' "$REPAIR" || { echo "FAIL  Forkop reload lock guard missing" >&2; exit 1; }
grep -Fq 'COOLDOWN=300' "$REPAIR" || { echo "FAIL  auto-repair cooldown missing" >&2; exit 1; }
if grep -Fq 'pidof sing-box' "$REPAIR"; then
    echo "FAIL  auto-repair must not use sing-box PID as readiness gate" >&2
    exit 1
fi

# Scheduler ownership is one marked cron line, never a resident service.
grep -Fq '# podkop-bot-tsnet-auto-repair' "$POSTINST" || { echo "FAIL  auto-repair cron registration missing" >&2; exit 1; }
grep -Fq '* * * * * /usr/lib/podkop_bot/tsnet-auto-repair.sh' "$POSTINST" || { echo "FAIL  auto-repair cron cadence missing" >&2; exit 1; }
grep -Fq '# podkop-bot-tsnet-auto-repair' "$POSTRM" || { echo "FAIL  auto-repair cron cleanup missing" >&2; exit 1; }

grep -Fq 'set_enabled' "$REPAIR_RPC" || { echo "FAIL  auto-repair toggle RPC missing" >&2; exit 1; }
grep -Fq '.auto_repair=$v' "$REPAIR_RPC" || { echo "FAIL  auto-repair state persistence missing" >&2; exit 1; }

echo "watcher-free tsnet runtime/auto-repair contract OK"
