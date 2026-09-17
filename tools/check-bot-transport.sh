#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

BOT="root/usr/lib/podkop_bot/podkop_bot"
[ -f "$BOT" ] || { echo "bot transport: source missing" >&2; exit 1; }
sh -n "$BOT"

grep -Fq 'BOT_VERSION="0.19.19"' "$BOT" || {
    echo "bot transport: expected 0.19.19 vendor" >&2; exit 1;
}
grep -Fq 'PODKOP_TRANSPORT_PATCH_V2' "$BOT" || {
    echo "bot transport: POLL/WARP transport generation marker missing" >&2; exit 1;
}
grep -Fq 'ROUTE_KEY="warp_rescue"' "$BOT" || {
    echo "bot transport: WARP Rescue is not a real route" >&2; exit 1;
}
grep -Fq '_try_warp_rescue "$args" "$max_time" "$ct_fast"' "$BOT" || {
    echo "bot transport: WARP Rescue is not in the full cascade" >&2; exit 1;
}
grep -Fq 'action=hold_direct' "$BOT" || {
    echo "bot transport: first fresh-follower POLL failure is not held" >&2; exit 1;
}
grep -Fq 'action=demote_after_streak' "$BOT" || {
    echo "bot transport: bounded POLL demotion missing" >&2; exit 1;
}
grep -F 'POLL_PROXY_FAIL_STREAK' "$BOT" | grep -Fq -- '-lt 2' || {
    echo "bot transport: expected two-strike POLL hysteresis missing" >&2; exit 1;
}
grep -Fq "grep -Eq '^(tier(1|2_[0-9]+|3)|warp_rescue)=[0-9]+ms" "$BOT" || {
    echo "bot transport: WARP Rescue is not part of follower health" >&2; exit 1;
}

# WARP Rescue must never sleep in the synchronous Telegram transport path.
if grep -Fq 'while ! _warp_rescue_pid_alive' "$BOT"; then
    echo "bot transport: blocking WARP Rescue startup wait returned" >&2
    exit 1
fi

# WARP Rescue must be attempted before the first full-cascade Direct block.
warp_line=$(grep -n '_try_warp_rescue "$args" "$max_time" "$ct_fast"' "$BOT" | head -1 | cut -d: -f1)
direct_line=$(grep -n '^[[:space:]]*# tier4: direct' "$BOT" | head -1 | cut -d: -f1)
case "$warp_line:$direct_line" in
    *[!0-9:]*|:|*:|:*) echo "bot transport: cannot resolve WARP/Direct order" >&2; exit 1 ;;
esac
[ "$warp_line" -lt "$direct_line" ] || {
    echo "bot transport: WARP Rescue is after Direct" >&2; exit 1;
}

# Watchdog treats an active Rescue route as healthy, not degraded.
grep -Fq 'tier1|tier2_*|tier3|warp_rescue)' "$BOT" || {
    echo "bot transport: watchdog does not recognize WARP Rescue as healthy" >&2; exit 1;
}

echo "bot transport contract OK"
