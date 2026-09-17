#!/bin/sh
# Opt-in, cron-driven tsnet runtime recovery for Podkop/Forkop X.
# No daemon and no polling loop: one bounded check per cron invocation.

. /usr/lib/podkop_bot/tsnet-provider.sh

RUNTIME_APPLY="/usr/lib/podkop_bot/tsnet-runtime-apply.sh"
STAMP_DIR="/tmp/podkop-bot-tsnet"
STAMP_FILE="$STAMP_DIR/auto-repair.last"
COOLDOWN=300

[ -r "$TSNET_STATE_FILE" ] || exit 0
[ "$(tsnet_state_get auto_repair)" = true ] || exit 0
[ "$(tsnet_state_get enabled)" = true ] || exit 0

_provider=$(tsnet_provider)
case "$_provider" in
    podkop|forkop-x) ;;
    *) exit 0 ;;
esac

# Never compete with Forkop X while it owns its reload transaction.
[ ! -e /var/run/forkop.reload.lock ] || exit 0

_cfg=$(tsnet_config_path)
[ -r "$_cfg" ] || exit 0

# Nothing to repair when our endpoint survived provider regeneration.
jq -e --arg t "$TSNET_ENDPOINT_TAG" '(.endpoints // []) | any(.type=="tailscale" and .tag==$t)' "$_cfg" >/dev/null 2>&1 && exit 0

# Forkop may have already spawned sing-box while its generated dataplane is not
# usable yet. Readiness is therefore a real Mixed Proxy transaction, not pidof.
# Prefer the primary section (main/tier1 source), then one additional runtime
# section as backup. A single successful path is sufficient.
_sections=$(ubus call podkop_bot runtime_sections '{}' 2>/dev/null || true)
[ -n "$_sections" ] || exit 0

_primary=$(printf '%s' "$_sections" | jq -r '.primary_section // empty' 2>/dev/null)
_candidates=$(printf '%s' "$_sections" | jq -r --arg p "$_primary" '
    [.sections[]? | select(.enabled_for_runtime==true and ((.endpoint // "")|length)>0)] as $s |
    (($s | map(select(.name==$p))) + ($s | map(select(.name!=$p))))[:2][]? |
    .endpoint
' 2>/dev/null)
[ -n "$_candidates" ] || exit 0

_ready=0
_ready_target=''
for _target in $_candidates; do
    _probe=$(ubus call podkop_bot transport_probe "$(jq -cn --arg target "$_target" '{target:$target}')" 2>/dev/null || true)
    if printf '%s' "$_probe" | jq -e '.available==true and .telegram_reached==true' >/dev/null 2>&1; then
        _ready=1
        _ready_target="$_target"
        break
    fi
done
[ "$_ready" = 1 ] || exit 0

_now=$(date +%s 2>/dev/null || echo 0)
_last=0
[ -r "$STAMP_FILE" ] && _last=$(cat "$STAMP_FILE" 2>/dev/null || echo 0)
case "$_now:$_last" in
    *[!0-9:]*|0:*) ;;
    *) [ $((_now - _last)) -ge "$COOLDOWN" ] || exit 0 ;;
esac

mkdir -p "$STAMP_DIR" 2>/dev/null || exit 0
printf '%s\n' "$_now" > "$STAMP_FILE"

if [ -x "$RUNTIME_APPLY" ] && "$RUNTIME_APPLY" >/dev/null 2>&1; then
    logger -t podkop-bot-tsnet "event=auto_repair result=applied provider=$_provider readiness=mixed_proxy" 2>/dev/null || true
    exit 0
fi

logger -t podkop-bot-tsnet "event=auto_repair result=failed provider=$_provider readiness=mixed_proxy cooldown=${COOLDOWN}s" 2>/dev/null || true
exit 0
