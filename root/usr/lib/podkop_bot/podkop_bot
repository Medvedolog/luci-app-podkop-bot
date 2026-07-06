#!/bin/sh
# ==============================================================================
# Podkop Telegram Bot v0.15.7
# Variant-aware (original / evolution / netshift / plus), OpenWrt/BusyBox ash.
# ==============================================================================

#
# ARCHITECTURE OVERVIEW:
# Stateless long-polling Telegram bot for OpenWrt routers managing the
# 'podkop' package (sing-box wrapper). Written in strict POSIX ash.
#
# KEY SUBSYSTEMS:
# 1. 5-Tier Fallback Transport: Podkop SOCKS5 -> Fallback SOCKS -> Custom Proxy
#    -> Direct -> Emergency IPs. Atomic IPC via mv for watchdog <-> main loop.
# 2. UCI Native Core: direct uci read/write, protected by flock.
#    uci_list_clean + set -f replaces eval for safe list splitting.
# 3. Dynamic State Machine: STATE_FILE for multi-step text inputs
# 4. Sub-Function Routing: _handle_proxy / _handle_settings / _handle_lists /
#    _handle_dns / _handle_bot / _handle_sections
# 5. Background Health Daemon: 5 watchdog checks (TG connectivity, sing-box,
#    SOCKS probe, proxy leaf change, route degradation). Alerts on tier4/tier5.
# 6. Active Outbound Probe: geo (ipapi.co + Cloudflare + Google), service
#    reachability (YouTube/Telegram/ChatGPT/Gemini/Discord), 2-stage throughput
#    (32KB block detection + 1MB speed measurement).
#
# ==============================================================================

export LC_ALL=C
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
# All bot runtime state files live under one directory for easy cleanup.
BOT_DIR="/tmp/podkop_bot"
mkdir -p "$BOT_DIR"

# Bot version. NOTE: also update the "Podkop Telegram Bot vX.Y.Z" line in the
# header comment at the top of this file when bumping (it is not auto-derived).
BOT_VERSION="0.15.7"

# ==============================================================================
# PODKOP VARIANT AUTO-DETECTION
# Must run before any UCI/binary access. Sets PODKOP_UCI, PODKOP_BIN, etc.
# Four variants:
#   original  (itdoginfo/podkop)            — connection_type + proxy_config_type
#   evolution (subscription_update CLI)     — .outbounds[] subscription cache
#   netshift  (yandexru45/netshift fork)    — like evolution, netshift paths
#   plus      (ushan0v/podkop-plus binary)  — action= field, see PLUS MODEL below
# NOTE: paths here are intentionally hardcoded — PODKOP_* vars not yet set.
#
# PLUS MODEL (important — differs from original's single proxy_config_type):
#   On Plus, "subscription" is a SOURCE, not a mode. A section has TWO orthogonal
#   axes that coexist: source (subscription_urls present?) and mode (urltest_enabled
#   flag → urltest, else selector). get_section_type() collapses these to one value
#   (urltest wins over subscription), so for Plus the real mode must be read from
#   the urltest_enabled flag directly, and subscription shown as a separate line.
#   Server count + subscription metadata come from /var/run/podkop-plus/section-cache/
#   <sec>.json (.servers map / .subscriptionMetadata array), preferred via Clash
#   /proxies; the subscription-links/ dir is NOT the node cache. See get_section_type,
#   get_subscription_server_count, _plus_sub_metadata, and the proxy_mode_menu handler.
# ==============================================================================
_detect_podkop_variant() {
    if [ -f /usr/bin/podkop-plus ]; then
        echo "plus"
        return
    fi
    # netshift = renamed podkop-evolution (same UCI schema, new binary/package name)
    if [ -f /usr/bin/netshift ]; then
        echo "netshift"
        return
    fi
    if [ -f /usr/bin/podkop ]; then
        if grep -q "subscription_update" /usr/bin/podkop 2>/dev/null; then
            echo "evolution"
            return
        fi
    fi
    echo "original"
}

# _apply_variant_env: re-applies all variant-dependent variables after
# _detect_podkop_variant() runs. Called after do_update_podkop to handle
# podkop-evolution → NetShift migration in the same session.
_apply_variant_env() {
    case "$PODKOP_VARIANT" in
        plus)
            PODKOP_UCI="podkop-plus"
            PODKOP_BIN="/usr/bin/podkop-plus"
            PODKOP_PKG="podkop-plus"
            PODKOP_DISPLAY_NAME="Podkop Plus"
            PODKOP_GITHUB_REPO="ushan0v/podkop-plus"
            PODKOP_INIT="/etc/init.d/podkop-plus"
            ;;
        netshift)
            PODKOP_UCI="netshift"
            PODKOP_BIN="/usr/bin/netshift"
            PODKOP_PKG="netshift"
            PODKOP_DISPLAY_NAME="NetShift"
            PODKOP_GITHUB_REPO="yandexru45/netshift"
            PODKOP_INIT="/etc/init.d/netshift"
            ;;
        evolution)
            PODKOP_UCI="podkop"
            PODKOP_BIN="/usr/bin/podkop"
            PODKOP_PKG="podkop"
            PODKOP_DISPLAY_NAME="Podkop Evolution"
            PODKOP_GITHUB_REPO="yandexru45/podkop-evolution"
            PODKOP_INIT="/etc/init.d/podkop"
            ;;
        *)  # original
            PODKOP_UCI="podkop"
            PODKOP_BIN="/usr/bin/podkop"
            PODKOP_PKG="podkop"
            PODKOP_DISPLAY_NAME="Podkop"
            PODKOP_GITHUB_REPO="itdoginfo/podkop"
            PODKOP_INIT="/etc/init.d/podkop"
            ;;
    esac
    # These are currently identical across variants but set explicitly
    # so future divergence does not silently use stale values after migration.
    SINGBOX_CONFIG_PATH="/etc/sing-box/config.json"
    PODKOP_FAKEIP_DOMAIN="fakeip.podkop.fyi"
}


PODKOP_VARIANT=$(_detect_podkop_variant)

case "$PODKOP_VARIANT" in
    plus)
        PODKOP_UCI="podkop-plus"
        PODKOP_BIN="/usr/bin/podkop-plus"
        PODKOP_INIT="/etc/init.d/podkop-plus"
        PODKOP_PKG="podkop-plus"
        PODKOP_GITHUB_REPO="ushan0v/podkop-plus"
        PODKOP_DISPLAY_NAME="Podkop Plus"
        SINGBOX_CONFIG_PATH="/etc/sing-box/config.json"
        PODKOP_FAKEIP_DOMAIN="fakeip.podkop.fyi"
        ;;
    evolution)
        PODKOP_UCI="podkop"
        PODKOP_BIN="/usr/bin/podkop"
        PODKOP_INIT="/etc/init.d/podkop"
        PODKOP_PKG="podkop"
        PODKOP_GITHUB_REPO="yandexru45/podkop-evolution"
        PODKOP_DISPLAY_NAME="Podkop Evolution"
        SINGBOX_CONFIG_PATH="/etc/sing-box/config.json"
        PODKOP_FAKEIP_DOMAIN="fakeip.podkop.fyi"
        ;;
    netshift)
        PODKOP_UCI="netshift"
        PODKOP_BIN="/usr/bin/netshift"
        PODKOP_INIT="/etc/init.d/netshift"
        PODKOP_PKG="netshift"
        PODKOP_GITHUB_REPO="yandexru45/netshift"
        PODKOP_DISPLAY_NAME="NetShift"
        SINGBOX_CONFIG_PATH="/etc/sing-box/config.json"
        PODKOP_FAKEIP_DOMAIN="fakeip.podkop.fyi"
        ;;
    *)
        PODKOP_UCI="podkop"
        PODKOP_BIN="/usr/bin/podkop"
        PODKOP_INIT="/etc/init.d/podkop"
        PODKOP_PKG="podkop"
        PODKOP_GITHUB_REPO="itdoginfo/podkop"
        PODKOP_DISPLAY_NAME="Podkop"
        SINGBOX_CONFIG_PATH="/etc/sing-box/config.json"
        PODKOP_FAKEIP_DOMAIN="fakeip.podkop.fyi"
        ;;
esac

# Helper: does this variant support subscriptions?
_variant_has_subscription() {
    case "$PODKOP_VARIANT" in
        plus|evolution|netshift) return 0 ;;
        *) return 1 ;;
    esac
}

# _plus_has_cmd: check if podkop-plus CLI supports a given command.
# show_help is incomplete (get_outbound_link_states, close_all_connections absent),
# so we grep the CLI dispatcher directly — commands appear as "    <cmd>)" lines.
# Falls back to show_help output for stripped/old builds.
_plus_has_cmd() {
    [ "$PODKOP_VARIANT" = "plus" ] || return 1
    if [ -r "$PODKOP_BIN" ] &&        grep -qE "^[[:space:]]*${1}\)" "$PODKOP_BIN" 2>/dev/null; then
        return 0
    fi
    ${PODKOP_BIN} 2>&1 | grep -qF "$1"
}

# _plus_json: call a podkop-plus CLI command, return JSON via stdout.
# Returns empty + non-zero if not Plus or command unavailable.
_plus_json() {
    local _cmd="$1"; shift
    [ "$PODKOP_VARIANT" = "plus" ] || return 1
    _plus_has_cmd "$_cmd" || return 1
    ${PODKOP_BIN} "$_cmd" "$@" 2>/dev/null
}

# _plus_sub_metadata: subscription metadata array for a section, WITHOUT spawning
# the Plus binary. Plus' own `get_subscription_metadata` CLI just reads
# section-cache/<sec>.json and returns its .subscriptionMetadata array
# (confirmed in podkop-plus status_diagnostics.sh + subscription_cache.uc).
# We read the same file directly — avoids a Go/ucode subprocess (RSS spike,
# OOM risk on 256 MB routers). Falls back to the CLI if the file is missing.
# Output: the subscriptionMetadata JSON array, same shape _plus_format_sub_meta expects.
_plus_sub_metadata() {
    local _sec="$1"
    [ "$PODKOP_VARIANT" = "plus" ] || return 1
    local _cache="/var/run/podkop-plus/section-cache/${_sec}.json"
    if [ -f "$_cache" ]; then
        local _arr
        _arr=$(jq -ce '.subscriptionMetadata // []' "$_cache" 2>/dev/null)
        # Use the file only if it parsed AND actually carries metadata.
        if [ -n "$_arr" ] && [ "$_arr" != "[]" ] && [ "$_arr" != "null" ]; then
            printf '%s' "$_arr"
            return 0
        fi
    fi
    # Fallback: ask the Plus CLI (older builds, or cache not yet written).
    _plus_has_cmd "get_subscription_metadata" || return 1
    _plus_json get_subscription_metadata "$_sec" 2>/dev/null
}

# _plus_format_sub_meta: format subscription metadata JSON to human-readable string.
# Input: JSON array from get_subscription_metadata <section>
# Output: "3.2/50 GB · exp 15.07.2025" or empty if no traffic data.
_plus_format_sub_meta() {
    # Schema: [{"traffic":{"used":N,"total":N,"isUnlimited":bool},"expire":epoch}, ...]
    local _json="$1"
    [ -z "$_json" ] || [ "$_json" = "{}" ] || [ "$_json" = "[]" ] && return 0
    local _used _total _unlimited _expire _used_gb _total_gb _expire_str
    # Check traffic object exists
    _used=$(printf '%s' "$_json" | jq -r '.[0].traffic.used // null' 2>/dev/null)
    [ -z "$_used" ] || [ "$_used" = "null" ] && return 0
    _total=$(printf '%s' "$_json" | jq -r '.[0].traffic.total // null' 2>/dev/null)
    _unlimited=$(printf '%s' "$_json" | jq -r '.[0].traffic.isUnlimited // false' 2>/dev/null)
    _expire=$(printf '%s' "$_json" | jq -r '.[0].expire // null' 2>/dev/null)
    _used_gb=$(awk "BEGIN{printf \"%.1f\", ${_used:-0}/1073741824}")
    if [ "$_unlimited" = "true" ]; then
        printf '%s GB / ∞' "$_used_gb"
    elif [ -n "$_total" ] && [ "$_total" != "null" ] && [ "$_total" != "0" ]; then
        _total_gb=$(awk "BEGIN{printf \"%.1f\", ${_total}/1073741824}")
        printf '%s/%s GB' "$_used_gb" "$_total_gb"
    else
        printf '%s GB used' "$_used_gb"
    fi
    if [ -n "$_expire" ] && [ "$_expire" != "null" ] && [ "$_expire" != "0" ]; then
        _expire_str=$(date -d "@${_expire}" "+%d.%m.%Y" 2>/dev/null ||             awk -v ts="$_expire" 'BEGIN{print strftime("%d.%m.%Y",ts)}')
        [ -n "$_expire_str" ] && printf ' · exp %s' "$_expire_str"
    fi
}

# _utf_postcheck_warn: post-apply check for urltest filter wiping all servers.
# Returns warning string (with leading \n\n) if URLTest group is now empty,
# empty string if OK. Uses Clash /proxies after reload — counts real survivors.
_utf_postcheck_warn() {
    local _sec="$1" _mode _proxies _grp _alive
    _mode=$(uci -q get ${PODKOP_UCI}.${_sec}.urltest_filter_mode 2>/dev/null || echo "disabled")
    [ "$_mode" = "disabled" ] && return 0
    _proxies=$(clash_request "/proxies" 2>/dev/null)
    [ -z "$_proxies" ] && return 0
    # Resolve URLTest group OF THIS SECTION — not first selector globally.
    # Mirrors get_selector_tag: exact key → "<sec>-out" → startswith match.
    _grp=$(printf '%s' "$_proxies" | jq -r --arg s "$_sec" '
        (if .proxies[$s] then $s
         elif .proxies[$s + "-out"] then ($s + "-out")
         else (.proxies | to_entries
               | map(select(
                   (.value.type == "Selector" or .value.type == "URLTest")
                   and (.key | startswith($s))))
               | sort_by((.value.all // []) | length) | last | .key)
         end) as $selkey
        | if $selkey == null then empty
          elif (.proxies[$selkey].type == "URLTest") then $selkey
          else (.proxies[$selkey].all[]?
                | select(.proxies[.].type == "URLTest"))
          end' 2>/dev/null | head -1)
    [ -z "$_grp" ] && return 0
    _alive=$(printf '%s' "$_proxies" | jq -r --arg g "$_grp"         '[.proxies[$g].all[]?] | length' 2>/dev/null)
    case "$_alive" in ''|*[!0-9]*) _alive=0 ;; esac
    [ "$_alive" -eq 0 ] && printf '\n\n%s <b>Warning:</b> the urltest filter removed all servers — this section has no outbound. Remove or adjust the filter.' "$E_WARN"
    return 0
}

# _resolve_urltest_group_for_section: section-specific URLTest group lookup.
# Mirrors the logic in _utf_postcheck_warn to avoid picking the wrong group
# when multiple sections / URLTest groups are present in Clash API.
_resolve_urltest_group_for_section() {
    local _sec="$1" _proxies="$2"
    printf '%s' "$_proxies" | jq -r --arg s "$_sec" '
      (if .proxies[$s] then $s
       elif .proxies[$s + "-out"] then ($s + "-out")
       else (.proxies | to_entries
             | map(select(
                 (.value.type == "Selector" or .value.type == "URLTest")
                 and (.key | startswith($s))))
             | sort_by((.value.all // []) | length) | last | .key)
       end) as $selkey
      | if $selkey == null then empty
        elif (.proxies[$selkey].type == "URLTest") then $selkey
        else (.proxies[$selkey].all[]?
              | select(.proxies[.].type == "URLTest"))
        end' 2>/dev/null | head -1
}

# set_section_action: variant-aware write of the connection/action field.
# Plus uses `action` (proxy|outbound|vpn|byedpi|zapret|direct|block).
# original/evolution use `connection_type` (proxy|vpn|block|exclusion).
# Maps bot UI vocabulary onto whatever the installed variant expects.
set_section_action() {
    local _sec="$1" _val="$2"
    if [ "$PODKOP_VARIANT" = "plus" ]; then
        # Plus has no `exclusion` action; equivalent is `direct`.
        [ "$_val" = "exclusion" ] && _val="direct"
        uci set ${PODKOP_UCI}.${_sec}.action="$_val"
    else
        uci set ${PODKOP_UCI}.${_sec}.connection_type="$_val"
    fi
}
# Path to this script — used by self-update (mv + exec/restart).
# Resolved at startup: follows symlinks, falls back to hardcoded installer path.
BOT_PATH=$(readlink -f "$0" 2>/dev/null || echo "/usr/bin/podkop_bot")

BOT_START_TIME=$(date +%s)
BOT_START_STR=$(date "+%Y-%m-%d %H:%M:%S")

# ==============================================================================
# SECTION 0: Configuration & Global Constants
# ==============================================================================

TOKEN=$(uci -q get podkop_bot.settings.bot_token)
ADMIN_ID=$(uci -q get podkop_bot.settings.chat_id)
ADMIN_IDS=$(uci -q get podkop_bot.settings.admin_ids 2>/dev/null)
ADMIN_SENDER_CHAT_IDS=$(uci -q get podkop_bot.settings.admin_sender_chat_ids 2>/dev/null)
ALLOW_ANON_ADMINS=$(uci -q get podkop_bot.settings.allow_anonymous_admins 2>/dev/null)
[ -z "$ALLOW_ANON_ADMINS" ] && ALLOW_ANON_ADMINS="1"

BOT_USERNAME_FILE="${BOT_DIR}/username"
BOT_USERNAME=""
BOT_ID_FILE="${BOT_DIR}/id"
BOT_ID=""

TARGET_CHAT_ID="$ADMIN_ID"
TARGET_MESSAGE_ID=""
TARGET_CHAT_TYPE=""
TARGET_REPLY_THREAD_ID=""

TAG_URI_CACHE="${BOT_DIR}/tag_uri_cache.txt"
UCI_LINKS_CACHE="${BOT_DIR}/uci_links_cache.txt"
# tag → human name extracted from #fragment in UCI links (selector + urltest)
TAG_NAME_CACHE="${BOT_DIR}/tag_name_cache.txt"
ACTIVE_SECTION_FILE="${BOT_DIR}/active_section"
RELOAD_TS_FILE="${BOT_DIR}/last_reload_ts"
REPLY_KB_INSTALLED_FILE="${BOT_DIR}/reply_kb_installed"

# Community lists: GitHub API cache with 1h TTL (60 req/hr rate limit protection)
COMMUNITY_LISTS_FALLBACK="anime block cloudflare cloudfront digitalocean discord geoblock google_ai google_meet google_play hdrezka hetzner hodca meta news ovh porn roblox russia_inside russia_outside telegram tiktok twitter ukraine_inside youtube"
CL_CACHE_FILE="${BOT_DIR}/cl_cache.txt"
CL_CACHE_TS="${BOT_DIR}/cl_cache_ts"

# Public IP cache: updated in background, read instantly in Status screen.
# Three sources: ipinfo.io, ifconfig.me (foreign) + yandex.ru (Russian, works under RKN).
PUBIP_CACHE="${BOT_DIR}/pubip_cache.txt"
PUBIP_CACHE_TTL=300  # 5 minutes — balance between freshness and traffic

if [ -z "$TOKEN" ] || { [ -z "$ADMIN_ID" ] && [ -z "$ADMIN_IDS" ]; }; then
    logger -t podkop-bot "FATAL: Bot token or Admin Chat ID not set in /etc/config/podkop_bot."
    exit 1
fi

# Validate token FORMAT before doing anything network-related. A valid Telegram
# bot token looks like "123456789:ABCdef..." (digits, a colon, then a secret).
# A very common install mistake is pasting the numeric chat_id into the token
# field — that yields endless 401s from getUpdates and a recovery loop that never
# resolves, with no hint to the user. Catch it loudly and exit instead.
case "$TOKEN" in
    *:*)
        # has a colon — check the part before it is all digits and the part
        # after is non-empty
        _tok_id=${TOKEN%%:*}
        _tok_secret=${TOKEN#*:}
        case "$_tok_id" in
            ''|*[!0-9]*)
                logger -t podkop-bot "FATAL: Bot token looks malformed (part before ':' is not numeric). Get a valid token from @BotFather. Current value is not a usable bot token."
                exit 1
                ;;
        esac
        if [ -z "$_tok_secret" ]; then
            logger -t podkop-bot "FATAL: Bot token looks malformed (nothing after ':'). Get a valid token from @BotFather."
            exit 1
        fi
        ;;
    *)
        # no colon at all — almost always a chat_id pasted into the token field
        logger -t podkop-bot "FATAL: Bot token has no ':' — this is not a Telegram bot token (looks like a chat_id or plain number was entered instead). A token from @BotFather looks like 123456789:ABCdef... Fix podkop_bot.settings.bot_token and restart."
        exit 1
        ;;
esac

# Auto-initialize default bot settings if missing
[ -z "$(uci -q get podkop_bot.settings.transport)" ]       && uci set podkop_bot.settings.transport="auto"
[ -z "$(uci -q get podkop_bot.settings.startup_notify)" ]  && uci set podkop_bot.settings.startup_notify="1"
[ -z "$(uci -q get podkop_bot.settings.alert_notify)" ]    && uci set podkop_bot.settings.alert_notify="1"
[ -z "$(uci -q get podkop_bot.settings.broadcast_alerts)" ] && uci set podkop_bot.settings.broadcast_alerts="0"
[ -z "$(uci -q get podkop_bot.settings.ram_alert)" ]           && uci set podkop_bot.settings.ram_alert="1"
[ -z "$(uci -q get podkop_bot.settings.quiet_hours_enabled)" ] && uci set podkop_bot.settings.quiet_hours_enabled="0"
[ -z "$(uci -q get podkop_bot.settings.quiet_hours_from)" ]    && uci set podkop_bot.settings.quiet_hours_from="23:00"
[ -z "$(uci -q get podkop_bot.settings.quiet_hours_to)" ]      && uci set podkop_bot.settings.quiet_hours_to="07:00"
[ -z "$(uci -q get podkop_bot.settings.health_interval)" ] && uci set podkop_bot.settings.health_interval="60"
[ -z "$(uci -q get podkop_bot.settings.daily_report)" ]       && uci set podkop_bot.settings.daily_report="0"
[ -z "$(uci -q get podkop_bot.settings.weekly_report)" ]      && uci set podkop_bot.settings.weekly_report="0"
[ -z "$(uci -q get podkop_bot.settings.weekly_report_day)" ]  && uci set podkop_bot.settings.weekly_report_day="7"
[ -z "$(uci -q get podkop_bot.settings.weekly_report_time)" ] && uci set podkop_bot.settings.weekly_report_time="09:00"
[ -z "$(uci -q get podkop_bot.settings.daily_report_time)" ] && uci set podkop_bot.settings.daily_report_time="08:00"

API_URL="https://api.telegram.org/bot${TOKEN}"
TG_EMERGENCY_IPS="149.154.167.220 149.154.166.110 91.108.4.249"
# Seed IPs above used as fallback if DoH discovery fails.
# _EMERGENCY_IPS_LAST_REFRESH: epoch of last successful DoH refresh (0 = never)
_EMERGENCY_IPS_LAST_REFRESH=0
_EMERGENCY_IPS_REFRESH_INTERVAL=21600  # 6 hours

OFFSET_FILE="${BOT_DIR}/offset"
STATE_FILE="${BOT_DIR}/state"
RELOAD_LOCK="${BOT_DIR}/reload_ts"
HEALTH_STATE_FILE="${BOT_DIR}/health_state"
# Structured SOCKS/TG state: written by watchdog, read by status/tunnel screens
SOCKS_STATE_FILE="${BOT_DIR}/socks_state"
# Periodic SOCKS latency probe results: key=value per endpoint, written by watchdog
SOCKS_PROBE_FILE="${BOT_DIR}/socks_probe"
# Timestamp of last SOCKS re-probe from degraded tier4/tier5 sticky path
SOCKS_REPROBE_TS_FILE="${BOT_DIR}/socks_reprobe_ts"
# Main process writes current route name here so watchdog subshell can read it
MAIN_ROUTE_FILE="${BOT_DIR}/main_route"
# Main process writes current route KEY here (tier1/tier2_N/tier3/tier4/tier5/fail).
# Separate from MAIN_ROUTE_FILE (which holds human-readable name).
# Watchdog reads this for per-cycle nudge logic — never writes to it.
MAIN_ROUTE_KEY_FILE="${BOT_DIR}/main_route_key"

# Write both route name and route key atomically from main process.
# Called at every successful tier resolution so watchdog always reads fresh data.
_write_main_route() {
    local _key="$1" _name="$2"
    # Atomic write via tmp+mv — prevents watchdog reading a truncated (empty) file
    # between O_TRUNC and the actual write (TOCTOU on tmpfs).
    printf '%s' "$_name" > "${MAIN_ROUTE_FILE}.tmp"  && \
        mv "${MAIN_ROUTE_FILE}.tmp"     "$MAIN_ROUTE_FILE"     2>/dev/null
    printf '%s' "$_key"  > "${MAIN_ROUTE_KEY_FILE}.tmp" && \
        mv "${MAIN_ROUTE_KEY_FILE}.tmp" "$MAIN_ROUTE_KEY_FILE" 2>/dev/null
}
ROUTE_CMD_FILE="${BOT_DIR}/route_cmd"
LAST_CMD_FILE="${BOT_DIR}/last_cmd"
UNAUTH_FILE="${BOT_DIR}/unauth"
# Menu/alert interleaving fix: track last menu msg_id and last health alert msg_id.
# send_or_edit uses these to detect when an alert has pushed the menu up and
# re-sends the menu as a new message (delete old + send new) to keep it current.
LAST_MENU_MSG_FILE="${BOT_DIR}/last_menu_msg"
LAST_ALERT_MSG_FILE="${BOT_DIR}/last_alert_msg"

# Dynamically resolve Clash API endpoint from sing-box config
CLASH_API_ADDR=$(jq -r '.experimental.clash_api.external_controller // empty' ${SINGBOX_CONFIG_PATH} 2>/dev/null)
if [ -z "$CLASH_API_ADDR" ]; then
    ROUTER_IP=$(uci -q get network.lan.ipaddr || echo "127.0.0.1")
    CLASH_API_ADDR="${ROUTER_IP}:9090"
fi
CLASH_API="http://${CLASH_API_ADDR}"

# SSH/locale-safe emoji constants (hex-encoded UTF-8)
E_OK=$(printf '\xE2\x9C\x85')
E_ERR=$(printf '\xE2\x9D\x8C')
E_WARN=$(printf '\xE2\x9A\xA0')
E_GLOB=$(printf '\xF0\x9F\x8C\x90')
E_STAT=$(printf '\xF0\x9F\x93\x8A')
E_DWN=$(printf '\xE2\xAC\x87\xEF\xB8\x8F')
E_UP=$(printf '\xE2\xAC\x86\xEF\xB8\x8F')
E_SHLD=$(printf '\xF0\x9F\x9B\xA1\xEF\xB8\x8F')
E_RTR=$(printf '\xF0\x9F\x96\xA5\xEF\xB8\x8F')
E_PRX=$(printf '\xF0\x9F\x94\x8C')
E_SET=$(printf '\xE2\x9A\x99')
E_ADD=$(printf '\xE2\x9E\x95')
E_BACK=$(printf '\xE2\x86\x90')
E_HOME=$(printf '\xF0\x9F\x8F\xA0')
E_FILE=$(printf '\xF0\x9F\x93\x84')
E_LOG=$(printf '\xF0\x9F\x93\x8B')
E_RST=$(printf '\xF0\x9F\x94\x84')
E_STP=$(printf '\xF0\x9F\x9B\x91')
E_DEL=$(printf '\xF0\x9F\x97\x91')
E_KEY=$(printf '\xF0\x9F\x94\x91')
E_CPU=$(printf '\xF0\x9F\xA7\xA0')
E_RAM=$(printf '\xF0\x9F\x92\xBE')
E_PENGUIN=$(printf '\xF0\x9F\x90\xA7')
E_DOG=$(printf '\xF0\x9F\x90\xB6')
E_BOX=$(printf '\xF0\x9F\x93\xA6')
E_ENVELOPE=$(printf '\xF0\x9F\x93\xA8')
E_ORG=$(printf '\xF0\x9F\x8F\xA2')
E_NET=$(printf '\xF0\x9F\x94\x97')
E_ON=$(printf '\xF0\x9F\x9F\xA2')
E_OFF=$(printf '\xE2\x9A\xAA')
E_SKULL=$(printf '\xF0\x9F\x92\x80')
E_YLW=$(printf '\xF0\x9F\x9F\xA1')
E_RED=$(printf '\xF0\x9F\x94\xB4')
E_ORNG=$(printf '\xF0\x9F\x9F\xA0')  # orange circle — "slow but working" latency tier
E_LINK=$(printf '\xF0\x9F\x94\x97')  # link emoji — subscription cards
E_PLAY=$(printf '\xE2\x96\xB6')
E_EDIT=$(printf '\xE2\x9C\x8F')
E_INFO=$(printf '\xE2\x84\xB9')
E_SCAN=$(printf '\xF0\x9F\xAA\xBA')
E_SRV=$(printf '\xF0\x9F\x96\xA7')          # 🖧  server/instances
E_BOT=$(printf '\xF0\x9F\xA4\x96')
E_TIME=$(printf '\xE2\x8F\xB1')
E_NEW=$(printf '\xF0\x9F\x86\x95')
E_CLIP=$(printf '\xF0\x9F\x93\x8E')
E_TEST=$(printf '\xF0\x9F\xA7\xAA')
E_MICRO=$(printf '\xF0\x9F\x94\xAC')
E_BOLT=$(printf '\xE2\x9A\xA1')
E_MAP=$(printf '\xF0\x9F\x97\xBA')
E_HEALTH=$(printf '\xF0\x9F\xA9\xBA')
E_IDEA=$(printf '\xF0\x9F\x92\xA1')   # [bulb] light bulb — hints/tips
E_TGT=$(printf '\xF0\x9F\x8E\xAF')    # [target] target — protocol selector

LAST_ROUTE="unknown"
LAST_ROUTE_NAME="Initializing..."
# Split route tracking: fast (sendMessage etc), poll (getUpdates), doc (sendDocument)
# Doc path never updates FAST or POLL to avoid poisoning transport state with multipart failures.
LAST_ROUTE_FAST="unknown"
LAST_ROUTE_POLL="unknown"
LAST_ROUTE_DOC="unknown"
# Recovery mode: set to N after All transports FAILED; decrements each poll cycle.
# While >0 bot aggressively probes SOCKS tiers before falling to direct.
RECOVERY_MODE=0
_TOKEN_401_LAST=0
API_RESPONSE=""
HEALTH_PID=""
# Optional toast text for answerCallbackQuery — handlers set this to show a brief
# popup notification to the user without modifying the card. Cleared after each use.
CB_ANSWER_TEXT=""

# ==============================================================================
# SECTION 0.5: Podkop Abstraction Helpers
# Variant-aware helpers that replace hardcoded UCI/binary calls.
# All functions depend on PODKOP_VARIANT / PODKOP_UCI set at startup.
# ==============================================================================

# get_section_type: returns section type accounting for variant differences.
# Plus uses 'action' field; original/evolution use 'connection_type'.
# For proxy sections, appends proxy_config_type as subtype: "proxy:selector",
# "proxy:urltest", "proxy:url", "proxy:subscription".
get_section_type() {
    local sec="$1"
    local ct
    if [ "$PODKOP_VARIANT" = "plus" ]; then
        ct=$(uci -q get ${PODKOP_UCI}.${sec}.action 2>/dev/null)
        [ -z "$ct" ] && ct="proxy"
        if [ "$ct" = "proxy" ]; then
            # Plus uses flags instead of proxy_config_type:
            #   urltest_enabled=1  → proxy:urltest  (may also have subscription)
            #   subscription_urls present → proxy:subscription
            #   otherwise → proxy:selector
            local _ut _sub
            _ut=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_enabled 2>/dev/null)
            _sub=$(uci -q show ${PODKOP_UCI}.${sec}.subscription_urls 2>/dev/null | grep -c "=")
            if [ "$_ut" = "1" ]; then
                printf 'proxy:urltest'
            elif [ "${_sub:-0}" -gt 0 ]; then
                printf 'proxy:subscription'
            else
                printf 'proxy:selector'
            fi
            return
        fi
        printf '%s' "$ct"
        return
    fi
    # original / evolution / netshift: use connection_type + proxy_config_type
    ct=$(uci -q get ${PODKOP_UCI}.${sec}.connection_type 2>/dev/null)
    ct="${ct:-proxy}"
    if [ "$ct" = "proxy" ]; then
        local pct
        pct=$(uci -q get ${PODKOP_UCI}.${sec}.proxy_config_type 2>/dev/null)
        case "${pct:-selector}" in
            selector_text) printf 'proxy:selector_text' ;;
            urltest_text)  printf 'proxy:urltest_text' ;;
            *)             printf 'proxy:%s' "${pct:-selector}" ;;
        esac
        return
    fi
    printf '%s' "$ct"
}

# Convenience predicates
section_is_proxy()        { case "$(get_section_type "$1")" in proxy:*) return 0;; esac; return 1; }
# section_is_subscription: true when section is managed via subscription URL(s).
# In plus, urltest+subscription coexist — check subscription_urls directly.
section_is_subscription() {
    _variant_has_subscription || return 1
    if [ "$PODKOP_VARIANT" = "plus" ]; then
        # uci -q get on a list field may return empty on BusyBox ash;
        # use uci show which reliably lists all entries
        uci -q show ${PODKOP_UCI}.${1}.subscription_urls 2>/dev/null | grep -q "=" && return 0
        return 1
    fi
    [ "$(get_section_type "$1")" = "proxy:subscription" ]
}
# section_display_kind: returns display class for UX labeling.
# Differs from get_section_type: subscription takes precedence over urltest for display.
section_display_kind() {
    section_is_subscription "$1" && { printf 'subscription'; return; }
    get_section_type "$1"
}

# section_has_links: true when proxy links are manually managed (not subscription)
section_has_links() {
    section_is_subscription "$1" && return 1
    section_is_proxy "$1"
}

# Icon for section type in list views
_section_type_icon() {
    local stype; stype=$(get_section_type "$1")
    case "$stype" in
        proxy:subscription) printf '📡' ;;
        proxy:urltest)      printf '⚡' ;;
        proxy:selector)     printf '🔗' ;;
        proxy:url)          printf '🔗' ;;
        vpn)                printf '🌐' ;;
        outbound)           printf '📤' ;;
        byedpi)             printf '🛡' ;;
        zapret)             printf '🛡' ;;
        block)              printf '🚫' ;;
        exclusion)          printf '↪'  ;;
        *)                  printf '⚙'  ;;
    esac
}

# _get_wan_interface: returns WAN interface name for SO_BINDTODEVICE.
# Used by direct Telegram/GitHub checks to bypass fakeip/tproxy routing.
_get_wan_interface() {
    local _if
    _if=$(ip route show default 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1); exit}')
    [ -z "$_if" ] && _if=$(uci -q get network.wan.ifname 2>/dev/null || \
                           uci -q get network.wan.device 2>/dev/null)
    printf '%s' "${_if:-}"
}

# get_singbox_version_display: returns sing-box version from package manager metadata.
# IMPORTANT: never call "sing-box version" — it spawns a second Go binary (+20-30 MB RSS)
# which can trigger OOM-killer on low-memory routers (AX3000T, 256 MB devices).
SB_VER_CACHE="${BOT_DIR}/singbox_version"
SWITCH_LOG="${BOT_DIR}/switch_log"
RAM_WEEK_FILE="${BOT_DIR}/ram_week"
WEEKLY_TRAFFIC_BASE="${BOT_DIR}/weekly_traffic_base"
WEEKLY_REPORT_LAST="${BOT_DIR}/weekly_report_last"
get_singbox_version_display() {
    # Skip cache if it contains a negative result — unknown must not be persisted.
    if [ -s "$SB_VER_CACHE" ]; then
        _cached_sbv=$(cat "$SB_VER_CACHE" 2>/dev/null)
        if [ -n "$_cached_sbv" ] && [ "$_cached_sbv" != "unknown" ]; then
            printf '%s' "$_cached_sbv"; return
        fi
    fi
    local ver=""

    # 1. Podkop-plus writes version to state file after each install — no process spawn.
    local _sb_state="/etc/podkop-plus/sing-box-version"
    [ -r "$_sb_state" ] && ver=$(sed -n '1p' "$_sb_state" 2>/dev/null)

    # 2. opkg (OpenWrt 24.10 and earlier)
    if [ -z "$ver" ] && command -v opkg >/dev/null 2>&1; then
        ver=$(opkg list-installed 2>/dev/null | awk '/^sing-box/ && $2 == "-" {print $3; exit}')
    fi

    # 3. apk (OpenWrt 25.x+)
    if [ -z "$ver" ] && command -v apk >/dev/null 2>&1; then
        _apk_line_sbv=$(apk list --installed 2>/dev/null | grep '^sing-box' | head -1)
        [ -n "$_apk_line_sbv" ] && ver=$(printf '%s' "$_apk_line_sbv" | \
            sed 's/^sing-box-extended-//; s/^sing-box-//; s/[[:space:]].*//')
    fi

    # 4. Plus-safe fallback: get_system_info returns sing_box_version without
    #    spawning the Go binary — same source Status card uses.
    if [ -z "$ver" ] && [ "$PODKOP_VARIANT" = "plus" ] && _plus_has_cmd "get_system_info"; then
        ver=$(_plus_json get_system_info 2>/dev/null | jq -r '.sing_box_version // empty' 2>/dev/null)
    fi

    [ -z "$ver" ] && ver="unknown"

    # Cache only positive results — never persist unknown (stale negative cache
    # would hide a valid version on the next call after state-file appears).
    if [ "$ver" != "unknown" ]; then
        mkdir -p "$BOT_DIR" 2>/dev/null
        printf '%s' "$ver" > "$SB_VER_CACHE" 2>/dev/null
    else
        rm -f "$SB_VER_CACHE" 2>/dev/null
    fi
    printf '%s' "$ver"
}

# is_singbox_extended: returns 0 if running sing-box-extended build
is_singbox_extended() {
    get_singbox_version_display | grep -q "extended"
}

# reply_keyboard_main: persistent bottom navigation keyboard JSON
reply_keyboard_main() {
    printf '{"keyboard":[[{"text":"\xf0\x9f\x8f\xa0 Menu"},{"text":"\xf0\x9f\x93\x8a Status"}]],"resize_keyboard":true,"one_time_keyboard":false}'
}

# install_reply_keyboard: send the bottom navigation keyboard to admin chat
install_reply_keyboard() {
    local _payload
    _payload=$(jq -n -c         --arg cid "$TARGET_CHAT_ID"         --arg txt "$(printf '%s Navigation ready.' "$E_OK")"         --argjson kb "$(reply_keyboard_main)"         '{chat_id:$cid,text:$txt,parse_mode:"HTML",reply_markup:$kb}')
    api_request "sendMessage" "$_payload" >/dev/null
}

# install_reply_keyboard_once: install only if not already installed this session
install_reply_keyboard_once() {
    [ -f "$REPLY_KB_INSTALLED_FILE" ] && return 0
    install_reply_keyboard
    date +%s > "$REPLY_KB_INSTALLED_FILE"
}

# normalize_reply_button: map persistent keyboard button text to command
normalize_reply_button() {
    case "$1" in
        "🏠 Menu"|"Menu"|"Меню")       printf '/menu' ;;
        "📊 Status"|"Status"|"Статус") printf 'cmd_status' ;;
        *)                              printf '%s' "$1" ;;
    esac
}

# format_age: convert timestamp to human-readable "Ns ago" / "Nm ago" / "Nh Nm ago"
# Returns "unknown" if timestamp is 0 or empty.
# Appends " ⚠ stale" if older than $2 seconds (default: 300).
format_age() {
    local ts="$1" stale_thresh="${2:-300}"
    [ -z "$ts" ] || [ "$ts" = "0" ] && { printf 'unknown'; return; }
    local now diff
    now=$(date +%s)
    diff=$((now - ts))
    local age_str
    if   [ "$diff" -lt 60 ];   then age_str="${diff}s ago"
    elif [ "$diff" -lt 3600 ]; then age_str="$((diff/60))m ago"
    else age_str="$((diff/3600))h $((diff%3600/60))m ago"; fi
    if [ "$diff" -gt "$stale_thresh" ]; then
        printf '%s ⚠ stale' "$age_str"
    else
        printf '%s' "$age_str"
    fi
}

# _status_severity: returns "ok"|"warn"|"degraded"|"fail" based on service state.
# Args: $1=podkop_running(0/1) $2=sb_running(0/1) $3=tg_transport(ok/fail/?)
#       $4=socks(up/down/?) $5=LAST_ROUTE(tier1/tier2_N/tier4/tier5/...)
_status_severity() {
    # $1=podkop_running $2=sb_running $3=tg_transport $4=socks $5=LAST_ROUTE
    # socks=down triggers degraded; socks=unknown (no data) does NOT
    local pk="$1" sb="$2" tgt="$3" socks="$4"
    if   [ "$pk" = "0" ] || [ "$sb" = "0" ]; then echo "fail"
    elif [ "$socks" = "down" ]; then echo "degraded"
    elif [ "$tgt" = "fail" ];   then echo "warn"
    else echo "ok"; fi
}

# ==============================================================================
# SECTION 1: Input Validation & Escaping Helpers
# ==============================================================================

# Validate IPv4 address or CIDR (e.g. 192.168.1.1 or 10.0.0.0/24)
validate_ip_or_cidr() {
    echo "$1" | awk -F'/' '{
        ip=$1; mask=$2;
        if (mask != "" && (mask !~ /^[0-9]+$/ || mask < 0 || mask > 32)) exit 1;
        split(ip, octets, ".");
        if (length(octets) != 4) exit 1;
        for (i=1; i<=4; i++) {
            if (octets[i] !~ /^[0-9]+$/ || octets[i] < 0 || octets[i] > 255) exit 1;
        }
        exit 0;
    }'
}

# Validate domain name (basic: letters, digits, dots, hyphens)
validate_domain() {
    echo "$1" | grep -qE '^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$'
}

html_escape() {
    # Escapes all 5 HTML special chars including " for safe use inside href="..."
    printf '%s' "$1" | sed \
        -e 's/&/\&amp;/g' \
        -e 's/</\&lt;/g' \
        -e 's/>/\&gt;/g' \
        -e 's/"/\&quot;/g' \
        -e "s/'/\&#39;/g"
}

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\000-\037'
}

# uci_list_clean: strip UCI single-quote wrapping from a list string.
# UCI show outputs list values as: 'item1' 'item2' 'item3'
# This strips the quotes so the result can be safely word-split by the caller.
# Usage:
#   _clean=$(uci_list_clean "$raw")
#   set -f; set -- $_clean; set +f   ← set -f prevents glob expansion
#   for item in "$@"; do ...; done
# IMPORTANT: set -- must happen in the caller's scope, not inside a function,
# because set -- only affects positional params of the current shell context.
# uci_list_clean: normalize UCI list output for safe iteration.
# UCI show returns: key='val1' 'val2' 'val3'
# After cut -d= -f2- we get: 'val1' 'val2' 'val3'
# CORRECT usage — always 2-step to avoid "Unterminated quoted string" in ash:
#   _ucl=$(uci_list_clean "$raw"); eval "set -- $_ucl"
# WRONG (breaks when values contain single-quotes, which all UCI lists do):
#   eval "set -- $(uci_list_clean \"$raw\")"  ← ash eval bug!
uci_list_clean() {
    # Keep single-quotes intact — eval "set --" relies on them for word splitting
    printf '%s' "$1"
}

url_decode() {
    local data="$1"
    [ -z "$data" ] && { echo ""; return 0; }
    # Replace + with space first
    data=$(printf '%s' "$data" | sed 's/+/ /g')
    # Convert %XX to octal \NNN via awk, then interpret with printf.
    # BusyBox printf does not support \xNN escapes but does support \NNN (octal).
    # This correctly handles multi-byte UTF-8 sequences (emoji flags etc).
    local escaped
    escaped=$(printf '%s' "$data" | \
        awk 'BEGIN{for(i=0;i<256;i++) oct[sprintf("%02X",i)]=sprintf("\\%03o",i)}
        {
            s=$0; r=""
            while(match(s,/%[0-9A-Fa-f][0-9A-Fa-f]/)){
                r=r substr(s,1,RSTART-1)
                h=toupper(substr(s,RSTART+1,2))
                r=r oct[h]
                s=substr(s,RSTART+3)
            }
            printf "%s", r s
        }')
    printf '%b' "$escaped"
}

# ==============================================================================
# SECTION 2: Network Transport Layer
#
# ARCHITECTURE (P1 overhaul):
#   - Two independent transport profiles:
#       api_request_fast()  sendMessage/editMessage/answerCB/deleteMessage
#       api_poll_long()     getUpdates only (50s poll, separate timeouts)
#   - api_document()        sendDocument, never updates FAST/POLL route state
#   - Tier order:
#       tier1               Podkop SOCKS5 (primary)
#       tier2_N             fallback_socks list (UCI list, N entries)
#       tier3               custom_proxy (single legacy entry)
#       tier4               Direct
#       tier5               Emergency hardcoded Telegram IPs
#   - Sticky-route fast path: each profile remembers its last working tier
#       and retries it first with short connect-timeout (1-2s).
#   - Recovery mode: after All transports FAILED, next 4 poll cycles
#       aggressively probe SOCKS tiers first before falling to direct.
#   - Logging: one line per event, structured format:
#       [Transport] route=X ok/fail  |  [Transport] recover old=X new=Y
# ==============================================================================

# _resolve_mixed_listen_ip_by_port PORT
# Returns the actual listen IP of the mixed/socks inbound on PORT from sing-box
# config.json. Falls back to LAN IP (then 127.0.0.1) for wildcard/empty listens.
# Used so auto-fallback tiers point at the real listen address, not a guessed LAN IP.
_resolve_mixed_listen_ip_by_port() {
    local _port="$1" _ip=""
    if [ -f "${SINGBOX_CONFIG_PATH}" ]; then
        _ip=$(jq -r --arg p "$_port" \
            '.inbounds[]? | select(.listen_port==($p|tonumber)) |
             select(.type=="mixed" or .type=="socks" or .type=="socks5") |
             .listen // empty' \
            ${SINGBOX_CONFIG_PATH} 2>/dev/null | head -n 1)
        [ -z "$_ip" ] && _ip=$(jq -r --arg p "$_port" \
            '.inbounds[]? | select(.listen_port==($p|tonumber)) | .listen // empty' \
            ${SINGBOX_CONFIG_PATH} 2>/dev/null | head -n 1)
    fi
    case "$_ip" in
        ""|0.0.0.0|::|"[::]") uci -q get network.lan.ipaddr 2>/dev/null || echo "127.0.0.1" ;;
        *) echo "$_ip" ;;
    esac
}

get_proxy_ip() {
    local m_port sb_ip lan_ip sec
    sec=$(get_active_section)
    m_port=$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_port || echo "2080")
    if [ -f "${SINGBOX_CONFIG_PATH}" ]; then
        sb_ip=$(jq -r --arg p "$m_port" \
            '.inbounds[]? | select(.listen_port==($p|tonumber)) |
             select(.type=="mixed" or .type=="socks" or .type=="socks5") |
             .listen // empty' \
            ${SINGBOX_CONFIG_PATH} 2>/dev/null | head -n 1)
        # Fallback: match any inbound on that port regardless of type
        [ -z "$sb_ip" ] && sb_ip=$(jq -r --arg p "$m_port" \
            '.inbounds[]? | select(.listen_port==($p|tonumber)) | .listen // empty' \
            ${SINGBOX_CONFIG_PATH} 2>/dev/null | head -n 1)
        if [ -n "$sb_ip" ]; then
            if [ "$sb_ip" = "0.0.0.0" ] || [ "$sb_ip" = "::" ]; then
                lan_ip=$(uci -q get network.lan.ipaddr)
                echo "${lan_ip:-127.0.0.1}"
            else
                echo "$sb_ip"
            fi
            return
        fi
    fi
    lan_ip=$(uci -q get network.lan.ipaddr)
    echo "${lan_ip:-127.0.0.1}"
}

_is_telegram_response() {
    printf '%s' "$1" | jq -e '.ok == true' >/dev/null 2>&1
}

# _try_curl PROXY_FLAGS MAX_TIME CURL_ARGS [CONNECT_TIMEOUT]
_try_curl() {
    local res ct="${4:-3}"
    # shellcheck disable=SC2086
    res=$(curl -s -k --connect-timeout "$ct" --max-time "$2" $1 $3 2>/dev/null)
    if _is_telegram_response "$res"; then
        API_RESPONSE="$res"
        return 0
    fi
    # Distinguish a REJECTED TOKEN from a dead transport: if Telegram actually
    # answered with ok:false + error_code 401, the network/SOCKS path works but
    # the token is invalid. Don't mask this as "tier down" (which causes an
    # endless recovery loop) — log it loudly once so the cause is visible.
    if printf '%s' "$res" | jq -e '.ok == false and .error_code == 401' >/dev/null 2>&1; then
        local _now_401; _now_401=$(date +%s 2>/dev/null || echo 0)
        if [ $((_now_401 - ${_TOKEN_401_LAST:-0})) -ge 300 ]; then
            _TOKEN_401_LAST="$_now_401"
            logger -t podkop-bot "FATAL-ish: Telegram rejected the bot token (HTTP 401). Transport is fine — the token is invalid or revoked. Fix podkop_bot.settings.bot_token (get a fresh one from @BotFather) and restart. Not a network/SOCKS problem."
        fi
    fi
    return 1
}

# _resolve_primary_section: find first podkop section with proxy type
# and mixed_proxy_enabled=1. Uses get_section_type() for variant compat.
# (Plus uses 'action', original/evolution use 'connection_type'.)
# Returns section name via stdout; falls back to active section then "main".
_resolve_primary_section() {
    local _s _me _sec=""
    local _all
    _all=$(uci -q show ${PODKOP_UCI} 2>/dev/null \
        | grep -E '^[^.]+\.[^.=]+=section$' \
        | sed 's/^[^.]*\.\([^=]*\)=section$/\1/')
    for _s in $_all; do
        section_is_proxy "$_s" || continue
        _me=$(uci -q get ${PODKOP_UCI}.${_s}.mixed_proxy_enabled 2>/dev/null || echo "1")
        if [ "$_me" = "1" ]; then
            _sec="$_s"; break
        fi
    done
    [ -z "$_sec" ] && _sec=$(get_active_section)
    [ -z "$_sec" ] && _sec="main"
    echo "$_sec"
}


# Call at the top of each transport function.
# IMPORTANT: tier1 is always the PRIMARY proxy section (connection_type=proxy,
# mixed_proxy_enabled=1), NOT the active UI section. Active section affects which
# proxies are managed in the bot UI, but bot transport to Telegram must use the
# main tunnel, not e.g. awg_main/WARP which may not route Telegram.
_load_transport_ctx() {
    _t_policy=$(uci -q get podkop_bot.settings.transport || echo "auto")

    # Find primary section via shared helper
    local _primary_sec; _primary_sec=$(_resolve_primary_section)
    local _all_secs
    _all_secs=$(uci -q show ${PODKOP_UCI} 2>/dev/null \
        | grep -E "^${PODKOP_UCI}\.[^.=]+=section$" \
        | sed 's/^[^.]*\.\([^=]*\)=section$/\1/')

    _t_sec="$_primary_sec"
    _t_port=$(uci -q get ${PODKOP_UCI}."${_t_sec}".mixed_proxy_port || echo "2080")
    _t_ip=$(uci -q get network.lan.ipaddr 2>/dev/null || echo "192.168.1.1")
    # Resolve actual listen IP from config.json for tier1
    if [ -f "${SINGBOX_CONFIG_PATH}" ]; then
        local _sb_ip
        _sb_ip=$(jq -r --arg p "$_t_port" \
            '.inbounds[]? | select(.listen_port==($p|tonumber)) |
             select(.type=="mixed" or .type=="socks" or .type=="socks5") |
             .listen // empty' \
            ${SINGBOX_CONFIG_PATH} 2>/dev/null | head -1)
        [ -z "$_sb_ip" ] && _sb_ip=$(jq -r --arg p "$_t_port" \
            '.inbounds[]? | select(.listen_port==($p|tonumber)) | .listen // empty' \
            ${SINGBOX_CONFIG_PATH} 2>/dev/null | head -1)
        if [ -n "$_sb_ip" ]; then
            [ "$_sb_ip" = "0.0.0.0" ] || [ "$_sb_ip" = "::" ] || _t_ip="$_sb_ip"
        fi
    fi

    _t_custom=$(uci -q get podkop_bot.settings.custom_proxy 2>/dev/null || echo "")
    _t_biface=$(uci -q get podkop_bot.settings.bind_interface 2>/dev/null || echo "")
    _t_ifflag=""; [ -n "$_t_biface" ] && _t_ifflag="--interface $_t_biface"

    # Load explicit fallback_socks from bot UCI config
    local _fb_raw
    _fb_raw=$(uci -q show podkop_bot.settings.fallback_socks 2>/dev/null | cut -d= -f2-)
    _t_fb_socks=""
    if [ -n "$_fb_raw" ]; then
        { _ucl=$(uci_list_clean "$_fb_raw"); eval "set -- $_ucl"; }
        _t_fb_socks="$*"
    fi

    # Auto-add mixed_proxy from OTHER sections as additional fallback tiers.
    # Each section with mixed_proxy_enabled=1 and a different port = independent
    # transport path (e.g. awg_main/WARP on 2081 can reach Telegram even if main/2080 fails).
    for _s in $_all_secs; do
        [ "$_s" = "$_t_sec" ] && continue  # skip primary, already tier1
        local _me _mp _ct
        _me=$(uci -q get ${PODKOP_UCI}.${_s}.mixed_proxy_enabled 2>/dev/null || echo "0")
        _mp=$(uci -q get ${PODKOP_UCI}.${_s}.mixed_proxy_port 2>/dev/null || echo "")
        [ "$_me" = "1" ] && [ -n "$_mp" ] && [ "$_mp" != "$_t_port" ] || continue
        local _fb_ip; _fb_ip=$(_resolve_mixed_listen_ip_by_port "$_mp")
        local _auto_fb="socks5h://${_fb_ip}:${_mp}"
        # Only add if not already in explicit fallback list — match by IP:PORT to
        # handle socks5:// vs socks5h:// variants added manually by user
        case " $_t_fb_socks " in
            *"://${_fb_ip}:${_mp} "*|*"://${_fb_ip}:${_mp}") ;;  # already present
            *) _t_fb_socks="${_t_fb_socks:+$_t_fb_socks }${_auto_fb}" ;;
        esac
    done
}

# _try_socks_tiers: attempt tier1 + all fallback_socks in order.
# Sets ROUTE_KEY and ROUTE_NAME on success. Returns 0 on first success.
# ROUTE_KEY: tier1 | tier2_1 | tier2_2 | ...
_try_socks_tiers() {
    local args="$1" max_time="$2" ct="$3"
    # tier1: primary Podkop SOCKS
    if [ "$_t_policy" != "direct" ]; then
        if _try_curl "-x socks5h://${_t_ip}:${_t_port}" "$max_time" "$args" "$ct"; then
            ROUTE_KEY="tier1"
            ROUTE_NAME="Podkop (SOCKS5:${_t_ip}:${_t_port})"
            return 0
        fi
    fi
    # tier2_N: fallback_socks entries
    local _n=0 _fb
    for _fb in $_t_fb_socks; do
        _n=$((_n + 1))
        logger -t podkop-bot "[Transport] Trying fallback SOCKS: ${_fb}"
        if _try_curl "-x ${_fb}" "$max_time" "$args" "$ct"; then
            ROUTE_KEY="tier2_${_n}"
            ROUTE_NAME="Fallback SOCKS${_n} (${_fb})"
            return 0
        fi
    done
    return 1
}

# _curl_via_best_socks: like curl but with automatic SOCKS fallover.
# Tries direct first; if that fails — tier1, then each tier2_N in order.
# Usage: _curl_via_best_socks <max_time> <extra_curl_args...>
# Returns 0 and writes body to stdout on first success.
_curl_via_best_socks() {
    local _max="${1:-15}"; shift
    local _args="$*"
    local _ct=5
    # Caller reads _last_fetch_route for user-facing display
    _last_fetch_route=""

    # 1. Direct (force IPv4: podkop's DNS redirect stalls AAAA, so without -4
    #    this leg burns the whole --max-time on every fetch before SOCKS fallover)
    if curl -4 -s --connect-timeout "$_ct" --max-time "$_max" $_args 2>/dev/null; then
        _last_fetch_route="direct"
        return 0
    fi

    # 2. tier1 — primary Podkop SOCKS
    if [ -n "$_t_ip" ] && [ -n "$_t_port" ] && [ "$_t_policy" != "direct" ]; then
        if curl -s --connect-timeout "$_ct" --max-time "$_max" \
                -x "socks5h://${_t_ip}:${_t_port}" $_args 2>/dev/null; then
            _last_fetch_route="Podkop SOCKS (${_t_ip}:${_t_port})"
            logger -t podkop-bot "[GH fetch] via tier1 SOCKS ${_t_ip}:${_t_port}"
            return 0
        fi
    fi

    # 3. tier2_N — fallback_socks in order
    local _fb
    for _fb in $_t_fb_socks; do
        if curl -s --connect-timeout "$_ct" --max-time "$_max" \
                -x "${_fb}" $_args 2>/dev/null; then
            _last_fetch_route="Fallback SOCKS (${_fb})"
            logger -t podkop-bot "[GH fetch] via fallback SOCKS ${_fb}"
            return 0
        fi
    done

    return 1
}

# ──────────────────────────────────────────────────────────────────────────
# Package-manager DNS workaround.
#
# podkop redirects the system resolver to sing-box (dnsmasq server=127.0.0.42),
# where the router's own AAAA lookups stall — so opkg/apk and the podkop
# install.sh (all musl getaddrinfo) time out resolving downloads.openwrt.org /
# raw.githubusercontent.com even though direct egress works. The bot can't pass
# -4 to opkg/apk, so for the duration of an install we point the ROUTER's own
# /etc/resolv.conf at public IPv4 DNS. This affects only router-originated
# resolution; LAN clients keep using dnsmasq (127.0.0.1:53), untouched. State is
# saved and always restored. Validated safe on this setup: `nft … dport 53`
# showed no :53 redirect and `nslookup … 1.1.1.1` resolves instantly.
_RESOLV_STATE="/tmp/podkop_resolv_state.$$"

_resolv_v4_override() {
    rm -f "$_RESOLV_STATE" "${_RESOLV_STATE}.bak"
    if [ -L /etc/resolv.conf ]; then
        # Preserve the symlink target; do NOT write through it (leaves the
        # target file, e.g. /tmp/resolv.conf, untouched).
        printf 'link %s\n' "$(readlink /etc/resolv.conf)" > "$_RESOLV_STATE"
    else
        printf 'file\n' > "$_RESOLV_STATE"
        cp /etc/resolv.conf "${_RESOLV_STATE}.bak" 2>/dev/null || : > "${_RESOLV_STATE}.bak"
    fi
    rm -f /etc/resolv.conf
    printf 'nameserver 1.1.1.1\nnameserver 1.0.0.1\nnameserver 8.8.8.8\n' > /etc/resolv.conf
}

_resolv_v4_restore() {
    [ -f "$_RESOLV_STATE" ] || return 0
    local _kind _val
    read -r _kind _val < "$_RESOLV_STATE"
    rm -f /etc/resolv.conf
    if [ "$_kind" = "link" ] && [ -n "$_val" ]; then
        ln -s "$_val" /etc/resolv.conf
    else
        cp "${_RESOLV_STATE}.bak" /etc/resolv.conf 2>/dev/null || : > /etc/resolv.conf
    fi
    rm -f "$_RESOLV_STATE" "${_RESOLV_STATE}.bak"
}

# _pkg_net_check: the "проверятор". Verify (over forced IPv4) that the hosts an
# install needs are reachable: OpenWrt package feed + GitHub raw. Echoes a short
# human-readable verdict; returns 0 if both reachable, 1 otherwise.
_pkg_net_check() {
    local _feed_rc _gh_rc
    curl -4 -sf -o /dev/null --connect-timeout 5 --max-time 8 \
        "https://downloads.openwrt.org/" 2>/dev/null; _feed_rc=$?
    curl -4 -sf -o /dev/null --connect-timeout 5 --max-time 8 \
        "https://raw.githubusercontent.com/" 2>/dev/null; _gh_rc=$?
    if [ "$_feed_rc" = "0" ] && [ "$_gh_rc" = "0" ]; then
        printf 'ok'; return 0
    fi
    local _msg="blocked:"
    [ "$_feed_rc" != "0" ] && _msg="${_msg} openwrt-feed"
    [ "$_gh_rc"   != "0" ] && _msg="${_msg} github-raw"
    printf '%s' "$_msg"; return 1
}


# Writes results into variables: _ghc_api_direct, _ghc_api_socks, _ghc_raw_direct,
# _ghc_raw_socks — each is "ok:<ms>" or "fail" or "timeout".
# Uses WAN interface for direct probes to bypass fakeip routing.
run_github_health_check() {
    # Single curl per probe with -w '%{http_code} %{time_total}'.
    # Avoids date +%s%3N — BusyBox returns seconds only, giving always 0ms.
    local _wan_if _if_flag _out _code _tt
    _wan_if=$(_get_wan_interface)
    [ -n "$_wan_if" ] && _if_flag="--interface $_wan_if" || _if_flag=""

    _ghc_api_direct="fail"; _ghc_api_socks="fail"
    _ghc_raw_direct="fail"; _ghc_raw_socks="fail"

    local _api_url="https://api.github.com/repos/${PODKOP_GITHUB_REPO}/releases/latest"
    local _raw_url="https://raw.githubusercontent.com/${PODKOP_GITHUB_REPO}/refs/heads/main/install.sh"
    _ghc_ms() { awk -v t="${1:-0}" 'BEGIN{printf "%dms", t*1000}'; }

    # api.github.com — direct
    _out=$(curl -4 -s -o /dev/null --connect-timeout 5 --max-time 6 \
        $_if_flag --noproxy '*' -w '%{http_code} %{time_total}' "$_api_url" 2>/dev/null)
    _code=${_out%% *}; _tt=${_out##* }
    case "$_code" in 2*|3*) _ghc_api_direct="ok:$(_ghc_ms "$_tt")" ;;
                     "")    _ghc_api_direct="timeout" ;; esac

    # api.github.com — via SOCKS
    if [ -n "$_t_ip" ] && [ -n "$_t_port" ]; then
        _out=$(curl -s -o /dev/null --connect-timeout 6 --max-time 10 \
            -x "socks5h://${_t_ip}:${_t_port}" -w '%{http_code} %{time_total}' "$_api_url" 2>/dev/null)
        _code=${_out%% *}; _tt=${_out##* }
        case "$_code" in 2*|3*) _ghc_api_socks="ok:$(_ghc_ms "$_tt")" ;;
                         "")    _ghc_api_socks="timeout" ;; esac
    else
        _ghc_api_socks="no-socks"
    fi

    # raw.githubusercontent.com — direct
    _out=$(curl -4 -s -o /dev/null --connect-timeout 5 --max-time 6 \
        $_if_flag --noproxy '*' -w '%{http_code} %{time_total}' "$_raw_url" 2>/dev/null)
    _code=${_out%% *}; _tt=${_out##* }
    case "$_code" in 2*|3*) _ghc_raw_direct="ok:$(_ghc_ms "$_tt")" ;;
                     "")    _ghc_raw_direct="timeout" ;; esac

    # raw.githubusercontent.com — via SOCKS
    if [ -n "$_t_ip" ] && [ -n "$_t_port" ]; then
        _out=$(curl -s -o /dev/null --connect-timeout 6 --max-time 10 \
            -x "socks5h://${_t_ip}:${_t_port}" -w '%{http_code} %{time_total}' "$_raw_url" 2>/dev/null)
        _code=${_out%% *}; _tt=${_out##* }
        case "$_code" in 2*|3*) _ghc_raw_socks="ok:$(_ghc_ms "$_tt")" ;;
                         "")    _ghc_raw_socks="timeout" ;; esac
    else
        _ghc_raw_socks="no-socks"
    fi
}

# _ghc_icon: convert ok:<ms>/fail/timeout/no-socks to emoji + label
_ghc_icon() {
    case "$1" in
        ok:*)     printf '%s %s' "$E_OK"  "${1#ok:}" ;;
        no-socks) printf '%s' "${E_OFF} no SOCKS" ;;
        timeout)  printf '%s' "${E_YLW} timeout" ;;
        *)        printf '%s' "${E_ERR} unreachable" ;;
    esac
}

# _in_tg_range: check if IP belongs to known Telegram CIDR prefixes (AS62041).
# Uses glob-based range matching — no full CIDR arithmetic needed in ash.
# Telegram prefixes: 91.105.192/23, 91.108.4/22, 91.108.8/22, 91.108.12/22,
#   91.108.16/22, 91.108.20/22, 91.108.56/22, 95.161.64/20,
#   149.154.160/20, 185.76.151/24
_in_tg_range() {
    case "$1" in
        91.105.192.*|91.105.193.*)                      return 0 ;;
        91.108.[4-7].*|91.108.[89].*|91.108.1[0-9].*|91.108.2[0-3].*) return 0 ;;
        91.108.5[6-9].*|91.108.6[0-3].*)               return 0 ;;
        95.161.6[4-9].*|95.161.7[0-9].*) return 0 ;;
        149.154.16[0-9].*|149.154.17[0-5].*)            return 0 ;;
        185.76.151.*)                                   return 0 ;;
    esac
    return 1
}

# resolve_tg_emergency_ips: resolve api.telegram.org via multiple DoH providers
# in parallel, validate IPs against Telegram CIDR ranges (anti-poisoning).
# Returns space-separated IP list via stdout, or empty on failure.
# Uses --interface WAN + --noproxy to bypass fakeip routing.
resolve_tg_emergency_ips() {
    local _wan_if _if_flag _tmpdir _pids=""
    _wan_if=$(_get_wan_interface)
    [ -n "$_wan_if" ] && _if_flag="--interface $_wan_if" || _if_flag=""
    _tmpdir=$(mktemp -d /tmp/tg_doh.XXXXXX 2>/dev/null) || return 1

    # Query three DoH providers in parallel
    local _host="api.telegram.org"
    for _doh in         "https://1.1.1.1/dns-query?name=${_host}&type=A"         "https://8.8.8.8/resolve?name=${_host}&type=A"         "https://dns.quad9.net/dns-query?name=${_host}&type=A"; do
        local _tag; _tag=$(printf '%s' "$_doh" | cut -d/ -f3 | tr '.' '_')
        ( curl -sf --connect-timeout 4 --max-time 6             $_if_flag --noproxy '*'             -H 'accept: application/dns-json'             "$_doh" 2>/dev/null             | jq -r '.Answer[]? | select(.type==1) | .data' 2>/dev/null             > "${_tmpdir}/${_tag}" ) &
        _pids="$_pids $!"
    done
    wait $_pids 2>/dev/null || true

    # Collect unique IPs that pass range validation
    local _out="" _ip
    for _f in "${_tmpdir}"/*; do
        [ -f "$_f" ] || continue
        while IFS= read -r _ip; do
            [ -z "$_ip" ] && continue
            _in_tg_range "$_ip" || continue
            case " $_out " in *" $_ip "*) ;; *) _out="$_out $_ip" ;; esac
        done < "$_f"
    done
    rm -rf "$_tmpdir" 2>/dev/null || true
    printf '%s' "${_out# }"
}

# _try_all_tiers: full cascade including custom/direct/emergency.
# Sets ROUTE_KEY and ROUTE_NAME on success.
_try_all_tiers() {
    local args="$1" max_time="$2" ct_fast="$3"
    # SOCKS tiers first
    if _try_socks_tiers "$args" "$max_time" "$ct_fast"; then
        return 0
    fi
    # tier3: custom_proxy
    if [ -n "$_t_custom" ] && [ "$_t_policy" != "direct" ]; then
        if _try_curl "$_t_ifflag -x $_t_custom" "$max_time" "$args" "$ct_fast"; then
            ROUTE_KEY="tier3"
            ROUTE_NAME="Custom (${_t_custom})${_t_biface:+ via $_t_biface}"
            return 0
        fi
    fi
    # tier4: direct
    if [ "$_t_policy" != "socks" ]; then
        if _try_curl "$_t_ifflag" "$max_time" "$args" "5"; then
            ROUTE_KEY="tier4"
            ROUTE_NAME="Direct${_t_biface:+ via $_t_biface}"
            return 0
        fi
        # tier5: emergency IPs — try DoH refresh if IPs may be stale
        local _now5; _now5=$(date +%s)
        if [ $((_now5 - _EMERGENCY_IPS_LAST_REFRESH)) -ge "$_EMERGENCY_IPS_REFRESH_INTERVAL" ]; then
            local _fresh5; _fresh5=$(resolve_tg_emergency_ips)
            if [ -n "$_fresh5" ]; then
                TG_EMERGENCY_IPS="$_fresh5"
                _EMERGENCY_IPS_LAST_REFRESH=$_now5
                logger -t podkop-bot "[Transport] Emergency IPs refreshed on tier5 entry: ${_fresh5}"
            fi
        fi
        local _eip
        for _eip in $TG_EMERGENCY_IPS; do
            if _try_curl "$_t_ifflag --resolve api.telegram.org:443:${_eip}" "$max_time" "$args" "5"; then
                ROUTE_KEY="tier5"
                ROUTE_NAME="Emergency IP (${_eip})"
                return 0
            fi
        done
    fi
    return 1
}

# _route_request: core engine used by api_request_fast and api_poll_long.
# $1=curl_args  $2=max_time  $3=ct_sticky  $4=ct_full  $5=route_var (LAST_ROUTE_FAST|LAST_ROUTE_POLL)
# Updates the named route variable and LAST_ROUTE/LAST_ROUTE_NAME (for UI display).
_route_request() {
    local _args="$1" _max="$2" _ct_sticky="$3" _ct_full="$4" _rvar="$5"
    local _last ROUTE_KEY ROUTE_NAME

    # --- IPC: read command from watchdog subshell ---
    # Watchdog cannot modify parent variables directly (subshell isolation).
    # It writes "down" or "up" to ROUTE_CMD_FILE; we act on it here at the
    # top of every transport call (both api_request_fast and api_poll_long).
    # Atomic read: mv to a lock file first — if two processes race, only one
    # gets a successful mv (rename is atomic on Linux tmpfs), eliminating TOCTOU.
    if mv "$ROUTE_CMD_FILE" "${ROUTE_CMD_FILE}.lock" 2>/dev/null; then
        local _wd_cmd
        _wd_cmd=$(cat "${ROUTE_CMD_FILE}.lock" 2>/dev/null)
        rm -f "${ROUTE_CMD_FILE}.lock"
        LAST_ROUTE_FAST="unknown"
        LAST_ROUTE_POLL="unknown"
        LAST_ROUTE="unknown"
        if [ "$_wd_cmd" = "down" ]; then
            RECOVERY_MODE=4
            logger -t podkop-bot "[Transport] sing-box down signal received. Resetting routes."
        else
            # RECOVERY_MODE=2: next 2 poll cycles probe SOCKS tiers first (aggressive),
            # preventing bot from settling on tier4/Direct when tier1 just recovered.
            # Using 0 caused _try_all_tiers to miss tier1 on tight connect-timeout
            # and fall through to Direct if tier1 was slow to respond post-restart.
            RECOVERY_MODE=2
            # Clear tier5 reprobe timestamp: forces immediate SOCKS retry on tier5 path
            rm -f "$SOCKS_REPROBE_TS_FILE"
            logger -t podkop-bot "[Transport] Recovery signal received. Resetting routes, forcing SOCKS rediscovery."
        fi
    fi
    # ------------------------------------------------

    _load_transport_ctx
    eval "_last=\$$_rvar"

    # --- Sticky fast path: retry last known working tier first ---
    if [ "$_last" != "unknown" ] && [ "$_last" != "fail" ]; then
        case "$_last" in
            tier1)
                [ "$_t_policy" != "direct" ] && \
                _try_curl "-x socks5h://${_t_ip}:${_t_port}" "$_max" "$_args" "$_ct_sticky" && {
                    LAST_ROUTE="tier1"; LAST_ROUTE_NAME="Podkop (SOCKS5:${_t_ip}:${_t_port})"
                    _write_main_route "tier1" "$LAST_ROUTE_NAME"
                    eval "$_rvar=tier1"; return 0
                }
                ;;
            tier2_*)
                local _n="${_last#tier2_}" _fb="" _i=0 _item
                for _item in $_t_fb_socks; do
                    _i=$((_i + 1))
                    if [ "$_i" -eq "$_n" ]; then
                        _fb="$_item"
                        break
                    fi
                done
                [ -n "$_fb" ] && \
                _try_curl "-x $_fb" "$_max" "$_args" "$_ct_sticky" && {
                    LAST_ROUTE="$_last"; LAST_ROUTE_NAME="Fallback SOCKS${_n} (${_fb})"
                    _write_main_route "$_last" "$LAST_ROUTE_NAME"
                    eval "$_rvar=$_last"; return 0
                }
                ;;
            tier3)
                [ -n "$_t_custom" ] && \
                _try_curl "$_t_ifflag -x $_t_custom" "$_max" "$_args" "$_ct_sticky" && {
                    LAST_ROUTE="tier3"; LAST_ROUTE_NAME="Custom (${_t_custom})"
                    _write_main_route "tier3" "$LAST_ROUTE_NAME"
                    eval "$_rvar=tier3"; return 0
                }
                ;;
            tier4)
                # On degraded path (tier4): periodically try SOCKS tiers before using direct.
                # Mirrors tier5 reprobe logic — prevents sticking on Direct when tier2
                # recovers but tier1 is still down (Telegram accessible directly).
                local _now _last_reprobe
                _now=$(date +%s)
                _last_reprobe=$(cat "$SOCKS_REPROBE_TS_FILE" 2>/dev/null || echo 0)
                if [ $((_now - _last_reprobe)) -ge 30 ]; then
                    echo "$_now" > "$SOCKS_REPROBE_TS_FILE"
                    local ROUTE_KEY ROUTE_NAME
                    # Try SOCKS tiers (tier1+tier2) first.
                    # Then try tier3 (custom proxy) separately — _try_socks_tiers doesn't cover it.
                    # NOTE: the compound || {...} pattern is split into sequential if-branches
                    # to avoid a POSIX ash parsing ambiguity where the inner && chain inside
                    # {...} can short-circuit in unexpected ways across some BusyBox versions.
                    if _try_socks_tiers "$_args" "$_max" "2"; then
                        :
                    elif [ -n "$_t_custom" ] && [ "$_t_policy" != "direct" ] && \
                         _try_curl "$_t_ifflag -x $_t_custom" "$_max" "$_args" "2"; then
                        ROUTE_KEY="tier3"; ROUTE_NAME="Custom (${_t_custom})"
                    else
                        ROUTE_KEY=""
                    fi
                    if [ -n "$ROUTE_KEY" ]; then
                        LAST_ROUTE="$ROUTE_KEY"; LAST_ROUTE_NAME="$ROUTE_NAME"
                        _write_main_route "$ROUTE_KEY" "$ROUTE_NAME"
                        eval "$_rvar=$ROUTE_KEY"
                        logger -t podkop-bot "[Transport] Recovered from Direct. Active route: ${ROUTE_NAME}"
                        return 0
                    fi
                fi
                # Reprobe failed or not yet due — use direct path
                [ "$_t_policy" != "socks" ] && \
                _try_curl "$_t_ifflag" "$_max" "$_args" "5" && {
                    LAST_ROUTE="tier4"; LAST_ROUTE_NAME="Direct"
                    _write_main_route "tier4" "$LAST_ROUTE_NAME"
                    eval "$_rvar=tier4"; return 0
                }
                ;;
            tier5)
                # On degraded path (tier5): periodically try SOCKS tiers before using emergency IP.
                # Without this, bot stays on tier5 forever even after fallback_socks recovers.
                local _now _last_reprobe
                _now=$(date +%s)
                _last_reprobe=$(cat "$SOCKS_REPROBE_TS_FILE" 2>/dev/null || echo 0)
                if [ $((_now - _last_reprobe)) -ge 30 ]; then
                    echo "$_now" > "$SOCKS_REPROBE_TS_FILE"
                    local ROUTE_KEY ROUTE_NAME
                    if _try_socks_tiers "$_args" "$_max" "2"; then
                        :
                    elif [ -n "$_t_custom" ] && [ "$_t_policy" != "direct" ] && \
                         _try_curl "$_t_ifflag -x $_t_custom" "$_max" "$_args" "2"; then
                        ROUTE_KEY="tier3"; ROUTE_NAME="Custom (${_t_custom})"
                    else
                        ROUTE_KEY=""
                    fi
                    if [ -n "$ROUTE_KEY" ]; then
                        LAST_ROUTE="$ROUTE_KEY"; LAST_ROUTE_NAME="$ROUTE_NAME"
                        _write_main_route "$ROUTE_KEY" "$ROUTE_NAME"
                        eval "$_rvar=$ROUTE_KEY"
                        logger -t podkop-bot "[Transport] Recovered from Emergency IP. Active route: ${ROUTE_NAME}"
                        return 0
                    fi
                fi
                # Reprobe failed or not yet due — use emergency path.
                # Try direct first (may work outside RKN), then hardcoded emergency IPs.
                [ "$_t_policy" != "socks" ] && \
                _try_curl "$_t_ifflag" "$_max" "$_args" "3" && {
                    LAST_ROUTE="tier4"; LAST_ROUTE_NAME="Direct"
                    _write_main_route "tier4" "$LAST_ROUTE_NAME"
                    eval "$_rvar=tier4"; return 0
                }
                for _eip in $TG_EMERGENCY_IPS; do
                    _try_curl "$_t_ifflag --resolve api.telegram.org:443:${_eip}" "$_max" "$_args" "3" && {
                        LAST_ROUTE="tier5"; LAST_ROUTE_NAME="Emergency IP (${_eip})"
                        _write_main_route "tier5" "$LAST_ROUTE_NAME"
                        eval "$_rvar=tier5"; return 0
                    }
                done
                ;;
        esac
        # Sticky path failed — log and fall through to full discovery
        logger -t podkop-bot "[Transport] Sticky route missed, running full discovery."
    fi

    # --- Full discovery cascade ---
    if _try_all_tiers "$_args" "$_max" "$_ct_full"; then
        local _prev_name="$LAST_ROUTE_NAME"
        LAST_ROUTE="$ROUTE_KEY"
        LAST_ROUTE_NAME="$ROUTE_NAME"
        _write_main_route "$ROUTE_KEY" "$ROUTE_NAME"
        eval "$_rvar=$ROUTE_KEY"
        if [ "$_last" = "fail" ] || [ "$_last" = "unknown" ]; then
            logger -t podkop-bot "[Transport] Connection recovered. Active route: ${ROUTE_NAME}"
            RECOVERY_MODE=0
        elif [ "$_prev_name" != "$ROUTE_NAME" ]; then
            logger -t podkop-bot "[Transport] Route: ${ROUTE_NAME}"
        fi
        return 0
    fi

    # --- All tiers failed ---
    if [ "$_last" != "fail" ]; then
        logger -t podkop-bot "[Transport] Connection failed. All proxy tiers exhausted."
        RECOVERY_MODE=4
    fi
    LAST_ROUTE="fail"; LAST_ROUTE_NAME="Disconnected"
    eval "$_rvar=fail"
    return 1
}

# api_request_fast: sendMessage, editMessageText, answerCallbackQuery, deleteMessage
# connect-timeout: 2s sticky / 3s full   max-time: 8s
api_request_fast() {
    local method="$1" payload="$2" max_time="${3:-8}" tmp final_args
    API_RESPONSE=""
    tmp=$(mktemp /tmp/podkop_req.XXXXXX 2>/dev/null) || return 1
    printf '%s' "$payload" > "$tmp"
    final_args="-X POST -H Content-Type:application/json --data-binary @${tmp} ${API_URL}/${method}"
    # Recovery mode: try SOCKS tiers first before sticky (mirrors api_poll_long behaviour)
    if [ "${RECOVERY_MODE:-0}" -gt 0 ]; then
        _load_transport_ctx
        local ROUTE_KEY ROUTE_NAME
        # Use reduced max_time so all SOCKS tiers fit within one fast request budget.
        # Default max_time=8s with ct=3s means tier1 alone can consume all 8s before
        # tier2 gets a chance. Cap at 5s per tier: tier1(3s ct)+tier2(3s ct) = ~6s total.
        local _fast_max=5
        logger -t podkop-bot "[Transport] Fast recovery starting. Trying SOCKS tiers..."
        if _try_socks_tiers "$final_args" "$_fast_max" "3"; then
            LAST_ROUTE="$ROUTE_KEY"; LAST_ROUTE_NAME="$ROUTE_NAME"
            _write_main_route "$ROUTE_KEY" "$ROUTE_NAME"
            LAST_ROUTE_FAST="$ROUTE_KEY"
            # Decrement but do NOT zero — let api_poll_long confirm stability
            # before fully exiting recovery mode. Zeroing here causes the next
            # poll cycle to skip SOCKS-first and potentially land on Direct.
            RECOVERY_MODE=$((RECOVERY_MODE > 1 ? RECOVERY_MODE - 1 : 0))
            logger -t podkop-bot "[Transport] Fast recovery: connected via ${ROUTE_NAME}"
            rm -f "$tmp"; echo "$API_RESPONSE"; return 0
        else
            logger -t podkop-bot "[Transport] Fast recovery: all SOCKS tiers unavailable."
        fi
    fi
    if _route_request "$final_args" "$max_time" "5" "6" "LAST_ROUTE_FAST"; then
        rm -f "$tmp"; echo "$API_RESPONSE"; return 0
    fi
    rm -f "$tmp"; return 1
}
# api_request: alias for api_request_fast (backward compat for non-poll callers)
api_request() { api_request_fast "$@"; }

# api_poll_long: getUpdates only
# connect-timeout: 3s sticky / 4s full   max-time: 65s (50s poll + buffer)
# Recovery mode: if RECOVERY_MODE>0, skip sticky path and probe SOCKS tiers first
api_poll_long() {
    local offset="$1" poll_timeout="${2:-50}"
    local args="-X GET ${API_URL}/getUpdates?offset=${offset}&timeout=${poll_timeout}"
    API_RESPONSE=""
    _load_transport_ctx

    # Recovery mode: aggressively try SOCKS tiers, skip sticky
    if [ "$RECOVERY_MODE" -gt 0 ]; then
        RECOVERY_MODE=$((RECOVERY_MODE - 1))
        logger -t podkop-bot "[Transport] Probing SOCKS tiers (recovery mode)..."
        local ROUTE_KEY ROUTE_NAME
        if _try_socks_tiers "$args" "65" "4"; then
            local _prev="$LAST_ROUTE_POLL"
            LAST_ROUTE="$ROUTE_KEY"; LAST_ROUTE_NAME="$ROUTE_NAME"
            LAST_ROUTE_POLL="$ROUTE_KEY"
            _write_main_route "$ROUTE_KEY" "$ROUTE_NAME"
            [ "$_prev" = "fail" ] && \
                logger -t podkop-bot "[Transport] Connection recovered. Active route: ${ROUTE_NAME}"
            return 0
        fi
        # SOCKS still down in recovery — fall through to full cascade
    fi

    _route_request "$args" "65" "5" "6" "LAST_ROUTE_POLL"
}

# api_poll: backward-compat wrapper
api_poll() { api_poll_long "$1" "${2:-50}"; }

# probe_socks_upstream: check SOCKS connectivity via multiple endpoints.
# Returns 0 if any endpoint responds 204, 1 if all fail.
# Used by watchdog — never updates LAST_ROUTE*.
probe_socks_upstream() {
    local m_ip="$1" m_port="$2" code
    local _probe_urls="http://www.gstatic.com/generate_204 http://connectivitycheck.gstatic.com/generate_204 http://cp.cloudflare.com/generate_204"
    for _url in $_probe_urls; do
        code=$(curl -s -k \
            -x "socks5h://${m_ip}:${m_port}" \
            --connect-timeout 5 --max-time 8 \
            -o /dev/null -w "%{http_code}" \
            "$_url" 2>/dev/null)
        if [ "$code" = "204" ]; then
            return 0
        fi
    done
    return 1
}

# Measure round-trip latency through a SOCKS endpoint.
# Outputs latency in ms, or "timeout" / "fail".
# Uses a single lightweight HTTP probe (gstatic 204).
probe_socks_latency() {
    local proxy_url="$1" _out _code _time
    _out=$(curl -s -k \
        -x "$proxy_url" \
        --connect-timeout 5 --max-time 8 \
        -o /dev/null -w "%{http_code}:%{time_total}" \
        "http://www.gstatic.com/generate_204" 2>/dev/null)
    _code="${_out%%:*}"
    _time="${_out#*:}"
    if [ "$_code" = "204" ]; then
        awk -v t="$_time" 'BEGIN{printf "%dms", int(t*1000)}'
    else
        echo "timeout"
    fi
}

# Probe all configured SOCKS endpoints (tier1 + fallback_socks list) and write
# structured results to SOCKS_PROBE_FILE. Called periodically from watchdog.
# Format: tier1=<ms|timeout>  tier2_1=<ms|timeout>  ts=<epoch>
probe_all_socks_write() {
    # Use _load_transport_ctx to get tier1 + all fallbacks (explicit + auto-sections).
    # This ensures Transport Latency card in Tunnel Health shows all paths including
    # auto-added mixed_proxy from other sections.
    _load_transport_ctx
    local lat out="ts=$(date +%s)"

    # tier1: primary Podkop SOCKS
    lat=$(probe_socks_latency "socks5h://${_t_ip}:${_t_port}")
    out="${out}\ntier1=${lat}"
    logger -t podkop-bot "[SOCKSProbe] Primary (${_t_ip}:${_t_port}): ${lat}"

    # tier2_N: all fallbacks (explicit fallback_socks + auto-added sections)
    local _n=0 _fb
    for _fb in $_t_fb_socks; do
        _n=$((_n + 1))
        lat=$(probe_socks_latency "$_fb")
        out="${out}\ntier2_${_n}=${lat} url=${_fb}"
        logger -t podkop-bot "[SOCKSProbe] Fallback-${_n} (${_fb}): ${lat}"
    done

    # tier3: custom_proxy
    if [ -n "$_t_custom" ]; then
        lat=$(probe_socks_latency "$_t_custom")
        out="${out}\ntier3=${lat} url=${_t_custom}"
        logger -t podkop-bot "[SOCKSProbe] Custom proxy (${_t_custom}): ${lat}"
    fi

    local _probe_tmp; _probe_tmp=$(mktemp /tmp/podkop_socks_probe.XXXXXX 2>/dev/null) || return 1
    printf '%b\n' "$out" > "$_probe_tmp"
    mv "$_probe_tmp" "$SOCKS_PROBE_FILE" 2>/dev/null || rm -f "$_probe_tmp"
}

# api_document: sendDocument — never updates FAST or POLL route state.
# Uses its own LAST_ROUTE_DOC so multipart failures don't poison polling.
api_document() {
    local file="$1" caption="$2"
    local res doc_kb nr
    _load_transport_ctx
    doc_kb="{\"inline_keyboard\":[[{\"text\":\"${E_DEL} Delete\",\"callback_data\":\"delete_msg\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"doc_to_runtime\"}]]}"

    _do_curl_doc() {
        # shellcheck disable=SC2086
        curl -s -k --connect-timeout 5 --max-time 30 \
            $1 \
            -F "chat_id=${TARGET_CHAT_ID}" \
            -F "document=@${file}" \
            -F "caption=${caption}" \
            -F "parse_mode=HTML" \
            -F "reply_markup=${doc_kb}" \
            ${TARGET_REPLY_THREAD_ID:+-F "message_thread_id=${TARGET_REPLY_THREAD_ID}"} \
            "${API_URL}/sendDocument" 2>/dev/null
    }

    # Full cascade top-to-bottom. sendDocument is rare (log uploads only) and
    # multipart uploads are sensitive to proxy behaviour, so no sticky fast-path
    # here — always try in tier order. LAST_ROUTE_DOC records the outcome for
    # diagnostics but does not influence FAST or POLL routing.

    if [ "$_t_policy" != "direct" ]; then
        res=$(_do_curl_doc "-x socks5h://${_t_ip}:${_t_port}")
        _is_telegram_response "$res" && {
            unset -f _do_curl_doc
            LAST_ROUTE_DOC="tier1"; return 0
        }
        # fallback_socks for doc — all tiers from _load_transport_ctx (incl. auto-sections)
        local _n=0 _fb
        for _fb in $_t_fb_socks; do
            _n=$((_n + 1))
            res=$(_do_curl_doc "-x $_fb")
            _is_telegram_response "$res" && {
                unset -f _do_curl_doc
                LAST_ROUTE_DOC="tier2_${_n}"; return 0
            }
        done
        if [ -n "$_t_custom" ]; then
            res=$(_do_curl_doc "$_t_ifflag -x $_t_custom")
            _is_telegram_response "$res" && {
                unset -f _do_curl_doc
                LAST_ROUTE_DOC="tier3"; return 0
            }
        fi
    fi
    if [ "$_t_policy" != "socks" ]; then
        res=$(_do_curl_doc "$_t_ifflag")
        _is_telegram_response "$res" && {
            unset -f _do_curl_doc
            LAST_ROUTE_DOC="tier4"; return 0
        }
        local _eip
        for _eip in $TG_EMERGENCY_IPS; do
            res=$(_do_curl_doc "$_t_ifflag --resolve api.telegram.org:443:${_eip}")
            _is_telegram_response "$res" && {
                unset -f _do_curl_doc
                LAST_ROUTE_DOC="tier5"; return 0
            }
        done
    fi
    unset -f _do_curl_doc
    LAST_ROUTE_DOC="fail"
    return 1
}

# get_tg_latency: measure round-trip to Telegram on the current LAST_ROUTE_FAST
get_tg_latency() {
    local m_port m_ip custom_url b_iface if_flag p_args res
    # Use _load_transport_ctx to get primary section port — same source of truth
    # as actual bot transport. Active UI section may differ from primary proxy section.
    _load_transport_ctx
    m_ip="$_t_ip"; m_port="$_t_port"
    custom_url="$_t_custom"
    b_iface="$_t_biface"; if_flag="$_t_ifflag"
    case "$LAST_ROUTE_FAST" in
        tier1)
            p_args="-x socks5h://${m_ip}:${m_port}"
            ;;
        tier2_*)
            # Resolve the actual fallback SOCKS endpoint by index from combined list
            local _n="${LAST_ROUTE_FAST#tier2_}" _fb_url="" _i=0
            for _fb_url in $_t_fb_socks; do
                _i=$((_i + 1))
                [ "$_i" -eq "$_n" ] && break
                _fb_url=""
            done
            [ -z "$_fb_url" ] && { echo "N/A"; return; }
            p_args="-x ${_fb_url}"
            ;;
        tier3)
            p_args="$if_flag -x ${custom_url}"
            ;;
        tier4)
            p_args="$if_flag"
            ;;
        tier5)
            p_args="$if_flag --resolve api.telegram.org:443:149.154.167.220"
            ;;
        *)
            echo "N/A"; return
            ;;
    esac
    res=$(curl -o /dev/null -s -w "%{time_total}" -m 3 $p_args https://api.telegram.org 2>/dev/null)
    if [ -n "$res" ] && [ "$res" != "0.000" ]; then
        awk -v t="$res" 'BEGIN{printf "%dms", int(t*1000)}'
    else
        echo "Timeout"
    fi
}

# ==============================================================================
# SECTION 3: Authorization & Chat Context
# ==============================================================================

get_active_section() { cat "$ACTIVE_SECTION_FILE" 2>/dev/null || echo "main"; }

set_chat_context() {
    TARGET_CHAT_ID="$1"; TARGET_MESSAGE_ID="$2"
    TARGET_CHAT_TYPE="$3"; TARGET_REPLY_THREAD_ID="$4"
    [ -z "$TARGET_CHAT_ID" ] && TARGET_CHAT_ID="$ADMIN_ID"
}

reset_chat_context() {
    TARGET_CHAT_ID="$ADMIN_ID"; TARGET_MESSAGE_ID=""
    TARGET_CHAT_TYPE=""; TARGET_REPLY_THREAD_ID=""
}

load_bot_identity() {
    [ -f "$BOT_USERNAME_FILE" ] && BOT_USERNAME=$(cat "$BOT_USERNAME_FILE" 2>/dev/null)
    [ -f "$BOT_ID_FILE" ]       && BOT_ID=$(cat "$BOT_ID_FILE" 2>/dev/null)
    [ -n "$BOT_USERNAME" ] && [ -n "$BOT_ID" ] && return 0
    local me_res uname bid
    me_res=$(api_request "getMe" "{}" "10" 2>/dev/null)
    uname=$(printf '%s' "$me_res" | jq -r '.result.username // empty' 2>/dev/null)
    bid=$(printf '%s' "$me_res" | jq -r '.result.id // empty' 2>/dev/null)
    [ -n "$uname" ] && { BOT_USERNAME="$uname"; printf '%s' "$uname" > "$BOT_USERNAME_FILE"; }
    [ -n "$bid" ]   && { BOT_ID="$bid";         printf '%s' "$bid"   > "$BOT_ID_FILE"; }
    [ -n "$BOT_USERNAME" ] && [ -n "$BOT_ID" ]
}

is_whitelisted_admin() {
    local uid="$1" a
    [ -z "$uid" ] && return 1
    [ "$uid" = "$ADMIN_ID" ] && return 0
    for a in $ADMIN_IDS; do [ "$uid" = "$a" ] && return 0; done
    return 1
}

is_whitelisted_sender_chat() {
    local scid="$1" a
    [ -z "$scid" ] && return 1
    for a in $ADMIN_SENDER_CHAT_IDS; do [ "$scid" = "$a" ] && return 0; done
    return 1
}

is_allowed_actor() {
    [ "$3" = "true" ] && return 1
    is_whitelisted_admin "$1" && return 0
    [ "$4" = "1" ] && is_whitelisted_sender_chat "$2" && return 0
    return 1
}

is_private_chat() { [ "$1" = "private" ]; }
is_group_chat()   { [ "$1" = "group" ] || [ "$1" = "supergroup" ]; }

text_mentions_bot() {
    [ -z "$1" ] || [ -z "$2" ] && return 1
    printf '%s\n' "$1" | grep -Eiq "(^|[^[:alnum:]_])@${2}([[:space:][:punct:]]|$)"
}
strip_bot_mention()      { printf '%s' "$1" | sed "s/@${2}\>//Ig"; }
normalize_group_command() { printf '%s' "$1" | sed "s#^\(/[^ @]*\)@${2}\>#\1#I"; }

is_reply_to_bot() {
    [ -z "$1" ] || [ -z "$2" ] && return 1
    local rid; rid=$(printf '%s' "$1" | jq -r '.message.reply_to_message.from.id // empty' 2>/dev/null)
    [ -n "$rid" ] && [ "$rid" = "$2" ]
}

# ==============================================================================
# SECTION 4: Messaging Functions
# ==============================================================================

# _validate_kb: check reply_markup JSON is valid before passing to jq --argjson.
# Invalid kb silently kills the whole jq payload, leaving the card un-sent.
# On failure: logs the bad JSON with calling context, clears kb so card sends without buttons.
_validate_kb() {
    local _kb="$1" _ctx="${2:-unknown}"
    [ -z "$_kb" ] || [ "$_kb" = "null" ] && return 0
    if ! printf '%s' "$_kb" | jq -e . >/dev/null 2>&1; then
        logger -t podkop-bot "[UI] Invalid reply_markup JSON (cmd=${_ctx}): $(printf '%s' "$_kb" | head -c 120)"
        return 1
    fi
    return 0
}

send_message() {
    local txt="$1" kb="$2" payload resp new_mid
    _validate_kb "$kb" "${cmd:-send}" || kb=""
    if [ -n "$kb" ] && [ "$kb" != "null" ]; then
        if [ -n "$TARGET_REPLY_THREAD_ID" ] && [ "$TARGET_REPLY_THREAD_ID" != "null" ]; then
            payload=$(jq -n -c --arg cid "$TARGET_CHAT_ID" --arg txt "$txt" --arg tid "$TARGET_REPLY_THREAD_ID" --argjson kb "$kb" \
                '{chat_id:$cid,text:$txt,parse_mode:"HTML",message_thread_id:($tid|tonumber),reply_markup:$kb}')
        else
            payload=$(jq -n -c --arg cid "$TARGET_CHAT_ID" --arg txt "$txt" --argjson kb "$kb" \
                '{chat_id:$cid,text:$txt,parse_mode:"HTML",reply_markup:$kb}')
        fi
    else
        if [ -n "$TARGET_REPLY_THREAD_ID" ] && [ "$TARGET_REPLY_THREAD_ID" != "null" ]; then
            payload=$(jq -n -c --arg cid "$TARGET_CHAT_ID" --arg txt "$txt" --arg tid "$TARGET_REPLY_THREAD_ID" \
                '{chat_id:$cid,text:$txt,parse_mode:"HTML",message_thread_id:($tid|tonumber)}')
        else
            payload=$(jq -n -c --arg cid "$TARGET_CHAT_ID" --arg txt "$txt" \
                '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
        fi
    fi
    resp=$(api_request "sendMessage" "$payload")
    # Track the new message_id so send_or_edit can detect alert interleaving
    new_mid=$(printf '%s' "$resp" | jq -r '.result.message_id // empty' 2>/dev/null)
    [ -n "$new_mid" ] && printf '%s' "$new_mid" > "$LAST_MENU_MSG_FILE"
}

edit_message() {
    local mid="$1" txt="$2" kb="$3" payload
    [ -z "$mid" ] && { send_message "$txt" "$kb"; return; }
    _validate_kb "$kb" "${cmd:-edit}" || kb=""
    if [ -n "$kb" ] && [ "$kb" != "null" ]; then
        payload=$(jq -n -c --arg cid "$TARGET_CHAT_ID" --arg mid "$mid" --arg txt "$txt" --argjson kb "$kb" \
            '{chat_id:$cid,message_id:($mid|tonumber),text:$txt,parse_mode:"HTML",reply_markup:$kb}')
    else
        payload=$(jq -n -c --arg cid "$TARGET_CHAT_ID" --arg mid "$mid" --arg txt "$txt" \
            '{chat_id:$cid,message_id:($mid|tonumber),text:$txt,parse_mode:"HTML"}')
    fi
    api_request "editMessageText" "$payload" >/dev/null
}


# _is_quiet_hours: returns 0 (true) if current time is within quiet hours range.
# Handles overnight ranges (e.g. 23:00–07:00) and same-day (e.g. 01:00–06:00).
_is_quiet_hours() {
    [ "$(uci -q get podkop_bot.settings.quiet_hours_enabled || echo 0)" = "1" ] || return 1
    local _from _to _now
    _from=$(uci -q get podkop_bot.settings.quiet_hours_from 2>/dev/null || echo "23:00")
    _to=$(uci -q get podkop_bot.settings.quiet_hours_to 2>/dev/null || echo "07:00")
    _now=$(date "+%H%M")
    _from=$(printf '%s' "$_from" | tr -d ':')
    _to=$(printf '%s' "$_to" | tr -d ':')
    case "$_from$_to$_now" in *[!0-9]*) return 1 ;; esac
    if [ "$_from" -le "$_to" ]; then
        [ "$_now" -ge "$_from" ] && [ "$_now" -lt "$_to" ]
    else
        [ "$_now" -ge "$_from" ] || [ "$_now" -lt "$_to" ]
    fi
}


# _send_alert: send watchdog alert respecting broadcast_alerts and quiet_hours.
# If broadcast_alerts=1 — sends to all admin_ids, otherwise only to CHAT_ID.
_send_alert() {
    local txt="$1" kb="$2"
    _is_quiet_hours && return 0  # suppress during quiet hours
    if [ "$(uci -q get podkop_bot.settings.broadcast_alerts || echo 0)" = "1" ]; then
        send_to_all_admins "$txt" "$kb"
    else
        reset_chat_context
        send_message "$txt" "$kb"
    fi
}


# send_to_all_admins: broadcast to CHAT_ID + all extra admin_ids.
# Used for Daily Report and watchdog alerts so all admins receive them.
send_to_all_admins() {
    local txt="$1" kb="$2"
    reset_chat_context
    send_message "$txt" "$kb"
    local _aids _aid
    _aids=$(uci -q show podkop_bot.settings.admin_ids 2>/dev/null | cut -d= -f2- | \
        tr -d "'" | tr ' ' '\n' | grep -v '^$')
    for _aid in $_aids; do
        [ "$_aid" = "$ADMIN_ID" ] && continue
        TARGET_CHAT_ID="$_aid"
        TARGET_REPLY_THREAD_ID=""
        send_message "$txt" "$kb"
    done
    reset_chat_context
}

# send_or_edit: edit existing message OR send new one.
# Alert interleaving fix: if health daemon sent an alert AFTER the current menu
# message (alert_msg_id > menu_msg_id), the menu card is now buried above the
# alert. In this case: delete the buried menu card and send a new one at the
# bottom so the user sees the current state below the alert.
send_or_edit() {
    local mid="$1" txt="$2" kb="$3"
    if [ -n "$mid" ] && [ "$mid" != "null" ] && [ "$mid" != "0" ]; then
        # Check if a health alert was sent after this menu card
        local alert_mid menu_mid
        alert_mid=$(cat "$LAST_ALERT_MSG_FILE" 2>/dev/null)
        menu_mid=$(cat "$LAST_MENU_MSG_FILE" 2>/dev/null)
        # Validate as integers — empty or non-numeric values crash ash with -gt
        case "$alert_mid" in ''|*[!0-9]*) alert_mid=0 ;; esac
        case "$menu_mid"  in ''|*[!0-9]*) menu_mid=0  ;; esac
        if [ "$alert_mid" -gt 0 ] && [ "$menu_mid" -gt 0 ] && [ "$alert_mid" -gt "$menu_mid" ]; then
            # Alert is newer than menu — re-float: delete buried menu, send fresh
            api_request "deleteMessage" \
                "$(jq -n -c --arg cid "$TARGET_CHAT_ID" --arg m "$mid" \
                '{chat_id:$cid,message_id:($m|tonumber)}')" >/dev/null 2>/dev/null
            rm -f "$LAST_ALERT_MSG_FILE"
            send_message "$txt" "$kb"
        else
            edit_message "$mid" "$txt" "$kb"
        fi
    else
        send_message "$txt" "$kb"
    fi
}

answer_callback() {
    api_request "answerCallbackQuery" \
        "$(jq -n -c --arg cb "$1" --arg txt "$2" '{callback_query_id:$cb,text:$txt}')" >/dev/null
}

delete_message() {
    [ -z "$1" ] && return 0
    echo "$1" | grep -qE '^[0-9]+$' || return 0
    api_request "deleteMessage" \
        "$(jq -n -c --arg cid "$TARGET_CHAT_ID" --arg mid "$1" '{chat_id:$cid,message_id:($mid|tonumber)}')" >/dev/null
}


# ==============================================================================
# SECTION 5: Clash API & UCI Helpers
# ==============================================================================

# Communicate with the local sing-box Clash API (proxy status, delay tests, etc.)
# --max-time 10: guards against the case where the local Clash API accepts the TCP
# connection but then hangs on the response (e.g. sing-box under high load, OOM).
# connect-timeout 3 alone only covers the TCP handshake, not the full transfer.
clash_request() {
    local endpoint="$1" method="${2:-GET}" data="$3"
    local secret tmp_body
    secret=$(uci -q get ${PODKOP_UCI}.settings.yacd_secret_key)
    if [ "$method" = "GET" ]; then
        if [ -n "$secret" ]; then
            curl -s --connect-timeout 3 --max-time 10 -H "Authorization: Bearer ${secret}" "${CLASH_API}${endpoint}"
        else
            curl -s --connect-timeout 3 --max-time 10 "${CLASH_API}${endpoint}"
        fi
    else
        tmp_body=$(mktemp /tmp/podkop_clash.XXXXXX)
        printf '%s' "$data" > "$tmp_body"
        if [ -n "$secret" ]; then
            curl -s --connect-timeout 3 --max-time 10 -X "$method" -H "Authorization: Bearer ${secret}" \
                -H "Content-Type: application/json" -d @"$tmp_body" "${CLASH_API}${endpoint}"
        else
            curl -s --connect-timeout 3 --max-time 10 -X "$method" \
                -H "Content-Type: application/json" -d @"$tmp_body" "${CLASH_API}${endpoint}"
        fi
        rm -f "$tmp_body"
    fi
}

# Fetch available community list names from GitHub Releases API.
# Cache result for 1 hour to prevent rate limit (60 req/hr).
# Uses companion timestamp file instead of stat -c (BusyBox stat is limited).
get_available_community_lists() {
    local now last_sync lists
    now=$(date +%s); last_sync=0
    [ -f "$CL_CACHE_TS" ] && last_sync=$(cat "$CL_CACHE_TS" 2>/dev/null || echo 0)
    if [ -f "$CL_CACHE_FILE" ] && [ $((now - last_sync)) -lt 3600 ]; then
        cat "$CL_CACHE_FILE"; return
    fi
    lists=$(curl -s --connect-timeout 5 --max-time 10 \
        "https://api.github.com/repos/itdoginfo/allow-domains/releases/latest" \
        | jq -r '.assets[].name' 2>/dev/null \
        | grep '\.srs$' | sed 's/\.srs$//' | sort | tr '\n' ' ')
    if [ -n "$lists" ]; then
        echo "$lists" > "$CL_CACHE_FILE"
        echo "$now"   > "$CL_CACHE_TS"
        echo "$lists"
    elif [ -f "$CL_CACHE_FILE" ]; then
        cat "$CL_CACHE_FILE"
    else
        echo "$COMMUNITY_LISTS_FALLBACK"
    fi
}

# ==============================================================================
# FUNCTION: refresh_public_ip_cache
# DESCRIPTION: Queries 3 independent public IP services in parallel, picks the
#              winner by majority vote (2-of-3). Services:
#                1. ipinfo.io    — international CDN, reliable
#                2. ifconfig.me  — simple, rarely blocked
#                3. yandex.ru    — Russian service (HTML parse), works under RKN
#              Atomic write via tmp+mv prevents torn reads.
#              mkdir-lock prevents duplicate parallel refresh processes.
#              Using mkdir (not lockfile with $$) because $$ in a background
#              subshell returns the PARENT PID, not the subshell's own PID.
#              If the subshell dies unexpectedly, a $$-based lockfile stays
#              forever (kill -0 on parent PID always succeeds). mkdir is atomic
#              on POSIX filesystems and the OS cleans nothing — so we add a
#              5-minute stale-lock timeout to survive OOM kills / crashes.
# ==============================================================================
PUBIP_REFRESH_LOCK="${BOT_DIR}/pubip_refresh.lockdir"

_validate_ip() {
    echo "$1" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'
}

refresh_public_ip_cache() {
    # Atomic mkdir lock: mkdir is a single POSIX syscall (link(2) semantics).
    # Unlike a lockfile with $$, it cannot produce a false "alive" check after crash.
    if ! mkdir "$PUBIP_REFRESH_LOCK" 2>/dev/null; then
        # Stale-lock recovery: if lock directory is older than 5 minutes, the
        # subshell that created it likely died without cleanup (OOM kill, segfault).
        # Use date -r for mtime — more portable across BusyBox builds than
        # stat -c %Y which requires CONFIG_FEATURE_STAT_FORMAT.
        local lock_mtime lock_age now_ts
        now_ts=$(date +%s)
        lock_mtime=$(date -r "$PUBIP_REFRESH_LOCK" +%s 2>/dev/null || echo "$now_ts")
        lock_age=$((now_ts - lock_mtime))
        if [ "$lock_age" -gt 300 ]; then
            rm -rf "$PUBIP_REFRESH_LOCK"
            mkdir "$PUBIP_REFRESH_LOCK" 2>/dev/null || return 0
        else
            return 0  # Another refresh is running — skip silently
        fi
    fi

    local t1 t2 t3 f1 f2 f3 winner ts tmp

    # Temp files for parallel fetches.
    # Create all three before forking — if any mktemp fails, release lock and abort
    # cleanly instead of leaving a dangling lockdir.
    f1=$(mktemp /tmp/podkop_ip1.XXXXXX 2>/dev/null) || { rm -rf "$PUBIP_REFRESH_LOCK"; return 1; }
    f2=$(mktemp /tmp/podkop_ip2.XXXXXX 2>/dev/null) || { rm -f "$f1"; rm -rf "$PUBIP_REFRESH_LOCK"; return 1; }
    f3=$(mktemp /tmp/podkop_ip3.XXXXXX 2>/dev/null) || { rm -f "$f1" "$f2"; rm -rf "$PUBIP_REFRESH_LOCK"; return 1; }
    f4=$(mktemp /tmp/podkop_ip4.XXXXXX 2>/dev/null) || { rm -f "$f1" "$f2" "$f3"; rm -rf "$PUBIP_REFRESH_LOCK"; return 1; }
    f5=$(mktemp /tmp/podkop_ip5.XXXXXX 2>/dev/null) || { rm -f "$f1" "$f2" "$f3" "$f4"; rm -rf "$PUBIP_REFRESH_LOCK"; return 1; }

    # IMPORTANT: force IPv4 (-4) on all three probes. When podkop redirects DNS
    # to sing-box (dnsmasq server=127.0.0.42, filter_aaaa=1, cachesize=0), the
    # router's own AAAA lookups stall/REFUSE while A records still resolve. musl
    # getaddrinfo waits on both families, so without -4 the lookup times out
    # ("Could not resolve host") even though direct egress works fine. -4 skips
    # the AAAA query entirely and returns the real WAN IP via the direct path.

    # 1. ipinfo.io — international, plain text IP
    curl -4 -s --connect-timeout 5 --max-time 8 \
        "https://ipinfo.io/ip" 2>/dev/null | tr -d '\n\r\t ' > "$f1" &
    local p1=$!

    # 2. ifconfig.me — plain text IP, not blocked in RU
    curl -4 -s --connect-timeout 5 --max-time 8 \
        "https://ifconfig.me" 2>/dev/null | tr -d '\n\r\t ' > "$f2" &
    local p2=$!

    # 3. yandex.ru/internet — Russian service, parse IP from JSON in HTML
    curl -4 -s --connect-timeout 5 --max-time 8 \
        "https://yandex.ru/internet" 2>/dev/null \
        | grep -oE '"ip":"[^"]+"' | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' \
        > "$f3" &
    local p3=$!

    # 4. api.ipify.org — widely available, plain text, works in RU
    curl -4 -s --connect-timeout 5 --max-time 8 \
        "https://api.ipify.org" 2>/dev/null | tr -d '\n\r\t ' > "$f4" &
    local p4=$!

    # 5. 2ip.me — Russian service, plain text IP
    curl -4 -s --connect-timeout 5 --max-time 8 \
        "https://api.2ip.me" 2>/dev/null | tr -d '\n\r\t ' > "$f5" &
    local p5=$!

    wait "$p1" "$p2" "$p3" "$p4" "$p5" 2>/dev/null

    t1=$(cat "$f1" 2>/dev/null); rm -f "$f1"
    t2=$(cat "$f2" 2>/dev/null); rm -f "$f2"
    t3=$(cat "$f3" 2>/dev/null); rm -f "$f3"
    t4=$(cat "$f4" 2>/dev/null); rm -f "$f4"
    t5=$(cat "$f5" 2>/dev/null); rm -f "$f5"

    # Validate: clear non-IP responses
    _validate_ip "$t1" || t1=""
    _validate_ip "$t2" || t2=""
    _validate_ip "$t3" || t3=""
    _validate_ip "$t4" || t4=""
    _validate_ip "$t5" || t5=""

    # Majority vote: prefer 2-of-5 agreement; fall back to first available
    local _all_ips="$t1 $t2 $t3 $t4 $t5"
    winner=""
    for _ip in $t1 $t2 $t3 $t4 $t5; do
        [ -z "$_ip" ] && continue
        local _cnt; _cnt=$(printf '%s\n' $_all_ips | grep -cF "$_ip" 2>/dev/null || echo 0)
        if [ "${_cnt:-0}" -ge 2 ]; then winner="$_ip"; break; fi
    done
    # Fallback: first available
    if [ -z "$winner" ]; then
        for _ip in $t1 $t2 $t3 $t4 $t5; do
            [ -n "$_ip" ] && { winner="$_ip"; break; }
        done
    fi
    [ -z "$winner" ] && winner="Unavailable"

    # Build source list for transparency in UI
    local sources=""
    [ -n "$t1" ] && sources="ipinfo.io"
    [ -n "$t2" ] && { [ -n "$sources" ] && sources="${sources}, ifconfig.me" || sources="ifconfig.me"; }
    [ -n "$t3" ] && { [ -n "$sources" ] && sources="${sources}, yandex.ru"   || sources="yandex.ru"; }
    [ -n "$t4" ] && { [ -n "$sources" ] && sources="${sources}, ipify.org"   || sources="ipify.org"; }
    [ -n "$t5" ] && { [ -n "$sources" ] && sources="${sources}, 2ip.me"      || sources="2ip.me"; }
    [ -z "$sources" ] && sources="all failed"

    ts=$(date +%s)

    # Atomic write: write to tmp then rename — prevents torn reads in get_public_ip_display.
    # If mktemp fails here (RAM disk full), release lock and bail — don't corrupt cache.
    tmp=$(mktemp /tmp/podkop_pubip.XXXXXX 2>/dev/null) || { rm -rf "$PUBIP_REFRESH_LOCK"; return 1; }
    printf '%s\n%s\n%s\n' "$ts" "$winner" "$sources" > "$tmp"
    # mv is atomic on same filesystem (tmpfs→tmpfs). If it fails, rm tmp and release lock.
    mv "$tmp" "$PUBIP_CACHE" 2>/dev/null || { rm -f "$tmp"; rm -rf "$PUBIP_REFRESH_LOCK"; return 1; }

    rm -rf "$PUBIP_REFRESH_LOCK"
    logger -t podkop-bot "[PublicIP] ${winner} (via ${sources})"
}

# Read public IP from cache instantly (no blocking I/O).
# Triggers background refresh if cache is stale or missing.
# Sanity-checks ts before arithmetic to avoid errors on corrupted cache.
get_public_ip_display() {
    local now ts age winner sources

    now=$(date +%s)

    if [ -f "$PUBIP_CACHE" ]; then
        ts=$(sed -n '1p' "$PUBIP_CACHE" 2>/dev/null)
        winner=$(sed -n '2p' "$PUBIP_CACHE" 2>/dev/null)
        sources=$(sed -n '3p' "$PUBIP_CACHE" 2>/dev/null)

        # Sanity-check ts: must be a number to avoid arithmetic error
        case "$ts" in
            ''|*[!0-9]*) ts=0 ;;
        esac
        [ -z "$winner" ] && winner="N/A"
        [ -z "$sources" ] && sources="unknown"

        age=$((now - ts))
        if [ "$age" -gt "$PUBIP_CACHE_TTL" ]; then
            refresh_public_ip_cache >/dev/null 2>&1 &
        fi
        printf '%s' "$winner"
    else
        refresh_public_ip_cache >/dev/null 2>&1 &
        printf 'Checking... (open Status again in ~10s)'
    fi
}

# Check if a community list tag is enabled for the given section.
# FAST PATH: pass pre-built active-list string as optional 3rd arg to avoid
# a uci subprocess per tag (25 tags × 1 uci call = 2-3s on MIPS).
is_list_enabled() {
    local sec="$1" tag="$2" _active_str="$3" item raw_list
    if [ -n "$_active_str" ]; then
        case " $_active_str " in *" $tag "*) return 0 ;; esac
        return 1
    fi
    raw_list=$(uci -q show ${PODKOP_UCI}.${sec}.community_lists 2>/dev/null | cut -d= -f2-)
    [ -z "$raw_list" ] && return 1
    { _ucl=$(uci_list_clean "$raw_list"); eval "set -- $_ucl"; }
    for item in "$@"; do [ "$item" = "$tag" ] && return 0; done
    return 1
}

# Build tag->URI cache from sing-box config.json outbounds (fallback when UCI link missing)
build_tag_uri_cache() {
    local tmp; tmp=$(mktemp /tmp/podkop_tag_uri.XXXXXX)
    jq -r '.outbounds[]? | select(.server != null and .server != "") |
        .tag + "=" + (
            if .type == "hysteria2"     then "hy2://"    + (.password//"-") + "@" + (.server//"-") + ":" + (.server_port|tostring)
            elif .type == "vless"       then "vless://"  + (.uuid//"-")     + "@" + (.server//"-") + ":" + (.server_port|tostring)
            elif .type == "shadowsocks" then "ss://"     + (.server//"-")   + ":" + (.server_port|tostring)
            elif .type == "trojan"      then "trojan://" + (.password//"-") + "@" + (.server//"-") + ":" + (.server_port|tostring)
            elif .type == "tuic"        then "tuic://"   + (.uuid//"-")     + ":" + (.password//"-") + "@" + (.server//"-") + ":" + (.server_port|tostring)
            else (.server//"-") + ":" + (.server_port|tostring)
            end
        )
    ' ${SINGBOX_CONFIG_PATH} 2>/dev/null > "$tmp"
    mv "$tmp" "$TAG_URI_CACHE"
    logger -t podkop-bot "[Core] Proxy URI cache ready ($(wc -l < "$TAG_URI_CACHE" 2>/dev/null || echo 0) entries)"
}

# Build UCI proxy links cache using eval "set --" (uci get option N is broken on BusyBox)
# One link per line, preserving original UCI order.
build_uci_links_cache() {
    local tmp sec raw_list _stype _key
    sec=$(get_active_section)
    _stype=$(get_section_type "$sec")

    # Subscription sections have no proxy_links — managed via subscription_update CLI
    if ! section_has_links "$sec"; then
        : > "$UCI_LINKS_CACHE"
        logger -t podkop-bot "[Core] Section '${sec}' is ${_stype} — no proxy_links cache"
        return 0
    fi

    case "$_stype" in
        proxy:urltest) _key="urltest_proxy_links" ;;
        *)             _key="selector_proxy_links" ;;
    esac
    tmp=$(mktemp /tmp/podkop_uci_links.XXXXXX)
    raw_list=$(uci -q show ${PODKOP_UCI}.${sec}.${_key} 2>/dev/null | cut -d= -f2-)
    if [ -n "$raw_list" ]; then
        { _ucl=$(uci_list_clean "$raw_list"); eval "set -- $_ucl"; }
        for link in "$@"; do printf '%s\n' "$link" >> "$tmp"; done
    fi
    mv "$tmp" "$UCI_LINKS_CACHE"
    logger -t podkop-bot "[Core] Proxy link cache ready for '${sec}' ($(wc -l < "$UCI_LINKS_CACHE" 2>/dev/null || echo 0) entries)"
}

# Build tag->human_name cache from #fragment in ALL UCI proxy link lists.
# Covers selector_proxy_links, urltest_proxy_links, url_proxy_links.
# Format: tag=Human Name
# This is the only way to get display names for URLTest group members since
# sing-box config.json does not store the #fragment comment.
build_tag_name_cache() {
    local tmp sec raw_list link frag tag
    sec=$(get_active_section)
    tmp=$(mktemp /tmp/podkop_tag_name.XXXXXX)
    # url mode uses proxy_string (plain option, one URL per line) — handle separately
    for uci_key in selector_proxy_links urltest_proxy_links; do
        raw_list=$(uci -q show ${PODKOP_UCI}.${sec}.${uci_key} 2>/dev/null | cut -d= -f2-)
        [ -z "$raw_list" ] && continue
        { _ucl=$(uci_list_clean "$raw_list"); eval "set -- $_ucl"; }
        for link in "$@"; do
            # Extract #fragment
            case "$link" in *#?*) frag="${link##*#}" ;; *) continue ;; esac
            frag=$(url_decode "$frag")
            [ -z "$frag" ] && continue
            # Derive tag from sing-box config matching this link's server:port
            # Use TAG_URI_CACHE: find tag whose reconstructed URI matches link server:port
            local srv_port; srv_port=$(extract_server_port_from_uri "${link%%#*}")
            [ -z "$srv_port" ] || [ "$srv_port" = "N/A" ] && continue
            # Match by server:port suffix in TAG_URI_CACHE
            tag=$(grep "@${srv_port}$\|:${srv_port}$" "$TAG_URI_CACHE" 2>/dev/null \
                | head -1 | cut -d= -f1)
            [ -n "$tag" ] && printf '%s=%s\n' "$tag" "$frag" >> "$tmp"
        done
    done
    # Also index fragments from proxy_string (url mode, multiline one-URL-per-line)
    local ps_raw ps_link ps_frag ps_tag ps_srv
    ps_raw=$(uci -q get ${PODKOP_UCI}.${sec}.proxy_string 2>/dev/null)
    if [ -n "$ps_raw" ]; then
        printf '%s\n' "$ps_raw" | grep -v '^[[:space:]]*$' | while IFS= read -r ps_link; do
            case "$ps_link" in *#?*) ps_frag="${ps_link##*#}" ;; *) continue ;; esac
            ps_frag=$(url_decode "$ps_frag")
            [ -z "$ps_frag" ] && continue
            ps_srv=$(extract_server_port_from_uri "${ps_link%%#*}")
            [ -z "$ps_srv" ] || [ "$ps_srv" = "N/A" ] && continue
            ps_tag=$(grep "@${ps_srv}$\|:${ps_srv}$" "$TAG_URI_CACHE" 2>/dev/null \
                | head -1 | cut -d= -f1)
            [ -n "$ps_tag" ] && printf '%s=%s\n' "$ps_tag" "$ps_frag" >> "$tmp"
        done
    fi
    mv "$tmp" "$TAG_NAME_CACHE"
    logger -t podkop-bot "[Core] Proxy name cache ready for '${sec}' ($(wc -l < "$TAG_NAME_CACHE" 2>/dev/null || echo 0) entries)"
}

# Rebuild all caches. Community lists cache intentionally NOT cleared here
# to protect against GitHub rate limits (60 req/hr).
build_all_caches() {
    build_tag_uri_cache
    build_uci_links_cache
    build_tag_name_cache
}

# Returns url_proxy_links for $1 (section) as newline-separated list.
# Uses eval "set --" on UCI shell-quoted output - handles = signs inside
# vless/hy2/vmess URLs correctly (base64 padding, query params, etc).
get_url_proxy_links() {
    # proxy_config_type=url uses proxy_string (multiline textarea, one URL per line).
    # url_proxy_links does NOT exist in podkop UCI schema — this helper now reads
    # proxy_string and emits one non-empty line per URL.
    local sec="$1" raw
    raw=$(uci -q get ${PODKOP_UCI}.${sec}.proxy_string 2>/dev/null)
    [ -z "$raw" ] && return 0
    printf '%s\n' "$raw" | grep -v '^[[:space:]]*$'
}

get_urltest_proxy_links() {
    local sec="$1" raw_list
    raw_list=$(uci -q show ${PODKOP_UCI}.${sec}.urltest_proxy_links 2>/dev/null | cut -d= -f2-)
    [ -z "$raw_list" ] && return 0
    { _ucl=$(uci_list_clean "$raw_list"); eval "set -- $_ucl"; }
    for link in "$@"; do printf '%s\n' "$link"; done
}

get_uri_by_tag() {
    local _tag="$1" _uri
    # Rebuild if file missing OR empty (built too early after reload)
    [ -s "$TAG_URI_CACHE" ] || build_tag_uri_cache
    _uri=$(grep "^${_tag}=" "$TAG_URI_CACHE" 2>/dev/null | cut -d= -f2-)
    # On miss: rebuild once and retry — catches stale cache from early build
    if [ -z "$_uri" ]; then
        build_tag_uri_cache
        _uri=$(grep "^${_tag}=" "$TAG_URI_CACHE" 2>/dev/null | cut -d= -f2-)
    fi
    printf '%s\n' "$_uri"
}

# resolve_manual_uci_link_for_tag: return the raw UCI link string for a tag
# IFF it exists as a manual entry in selector_proxy_links or urltest_proxy_links.
# Does NOT use TAG_URI_CACHE / sing-box config.json — only UCI lists.
# Returns empty string (and exit 1) if the tag is subscription-generated or unknown.
resolve_manual_uci_link_for_tag() {
    local _tag="$1" _sec="${2:-$(get_active_section)}"
    local _uri _srv_port _ucl _link _raw_uci

    # Get the URI for this tag from cache to extract server:port fingerprint
    _uri=$(get_uri_by_tag "$_tag")
    [ -n "$_uri" ] && [ "$_uri" != "N/A" ] || return 1
    _srv_port=$(extract_server_port_from_uri "${_uri%%#*}")
    [ -n "$_srv_port" ] && [ "$_srv_port" != "N/A" ] || return 1

    # Search only in UCI manual link lists — not in sing-box config
    local _uci_key
    for _uci_key in selector_proxy_links urltest_proxy_links; do
        _raw_uci=$(uci -q show ${PODKOP_UCI}.${_sec}.${_uci_key} 2>/dev/null | cut -d= -f2-)
        [ -n "$_raw_uci" ] || continue
        { _ucl=$(uci_list_clean "$_raw_uci"); eval "set -- $_ucl"; }
        for _link in "$@"; do
            case "$_link" in
                *"@${_srv_port}"*|*"@${_srv_port}/"*|*"@${_srv_port}#"*|\
                *"://${_srv_port}"*|*"://${_srv_port}/"*|*"://${_srv_port}#"*)
                    printf '%s\n' "$_link"
                    return 0
                    ;;
            esac
        done
    done
    return 1
}

get_selector_link_by_index() {
    local idx="$1" line i=0
    # Rebuild if file missing OR empty
    [ -s "$UCI_LINKS_CACHE" ] || build_uci_links_cache
    while IFS= read -r line; do
        [ "$i" -eq "$idx" ] && { printf '%s\n' "$line"; return 0; }
        i=$((i + 1))
    done < "$UCI_LINKS_CACHE"
    # On miss: rebuild and retry
    build_uci_links_cache; i=0
    while IFS= read -r line; do
        [ "$i" -eq "$idx" ] && { printf '%s\n' "$line"; return 0; }
        i=$((i + 1))
    done < "$UCI_LINKS_CACHE"
    return 1
}

# Atomic UCI commit with optional flock to prevent concurrent writes
uci_commit_safe() {
    local rc
    if command -v flock >/dev/null 2>&1; then
        ( flock -x 9; uci commit "$1"; exit $? ) 9>/tmp/podkop_uci.lock
        rc=$?
    else
        uci commit "$1"; rc=$?
    fi
    [ "$rc" -ne 0 ] && logger -t podkop-bot "[Error] uci commit '$1' failed (RC=$rc)"
    return $rc
}

# ==============================================================================
# SECTION 6: Proxy Resolution Helpers
# ==============================================================================

get_selector_tag() {
    local proxies="$1" sec tag
    sec=$(get_active_section)
    [ -z "$proxies" ] && proxies=$(clash_request "/proxies" 2>/dev/null)
    tag=$(printf '%s' "$proxies" | jq -r --arg s "$sec" \
        'if .proxies[$s] then $s
         elif .proxies[$s + "-out"] then ($s + "-out")
         else (.proxies | to_entries
               | map(select(
                   (.value.type == "Selector" or .value.type == "URLTest")
                   and (.key | startswith($s))
                 ))
               | sort_by((.value.all // []) | length) | last | .key // ($s + "-out"))
         end' 2>/dev/null)
    echo "${tag:-${sec}-out}"
}

get_active_proxy_name() {
    local proxies="$1" sel now sel_type
    [ -z "$proxies" ] && proxies=$(clash_request "/proxies" 2>/dev/null)
    sel=$(get_selector_tag "$proxies")
    sel_type=$(printf '%s' "$proxies" | jq -r --arg sel "$sel" '.proxies[$sel].type // empty' 2>/dev/null)
    case "$sel_type" in
        Selector|URLTest|Fallback|LoadBalance)
            now=$(printf '%s' "$proxies" | jq -r --arg sel "$sel" '.proxies[$sel].now // empty' 2>/dev/null)
            [ -z "$now" ] && { echo "Unknown"; return 0; }
            _resolve_leaf "$now" "$proxies"
            ;;
        *)
            # url mode: direct outbound tag (Hysteria2/VLESS/etc) or Clash unavailable
            # Return the selector tag itself — it IS the active outbound in url mode
            # Returns "Unknown" (via get_selector_tag default) when Clash API is down
            _resolve_leaf "$sel" "$proxies"
            ;;
    esac
}

# get_active_proxy_display: human-readable display name for UI.
# In url mode: decoded #fragment from proxy_string (e.g. "LV-hysteria2").
# In selector/urltest mode: delegates to display_proxy_name_with_tag.
# Use this for display only — NOT for tag comparisons.
get_active_proxy_display() {
    local proxies="$1" tag _sec _stype _ps
    tag=$(get_active_proxy_name "$proxies")
    _sec=$(get_active_section)
    _stype=$(get_section_type "$_sec")
    # Plus: subscription is a SOURCE, selector/urltest is the MODE — they coexist.
    # Show both axes instead of collapsing to one. For URLTest auto, show the
    # picked node; for Selector, show the active node + "from subscription".
    if [ "$PODKOP_VARIANT" = "plus" ] && section_is_subscription "$_sec"; then
        local _count _ut_flag _node
        _count=$(get_subscription_server_count "$_sec")
        _ut_flag=$(uci -q get ${PODKOP_UCI}.${_sec}.urltest_enabled 2>/dev/null)
        _node=$(display_proxy_name_with_tag "$tag")
        if [ "$_ut_flag" = "1" ]; then
            if [ -n "$_node" ] && [ "$_node" != "Unknown" ]; then
                printf '▶ %s · URLTest · %s servers' "$_node" "$_count"
            else
                printf 'URLTest · %s servers' "$_count"
            fi
        else
            if [ -n "$_node" ] && [ "$_node" != "Unknown" ]; then
                printf '▶ %s · Selector · %s servers' "$_node" "$_count"
            else
                printf 'Selector · %s servers' "$_count"
            fi
        fi
        return 0
    fi
    # original / evolution / netshift: subscription is exclusive (no coexisting mode)
    if [ "$_stype" = "proxy:subscription" ]; then
        local _count; _count=$(get_subscription_server_count "$_sec")
        printf 'subscription (%s servers)' "$_count"
        return 0
    fi
    if [ "$_stype" = "proxy:url" ]; then
        _ps=$(uci -q get ${PODKOP_UCI}.${_sec}.proxy_string 2>/dev/null | head -1)
        case "$_ps" in
            *#?*) url_decode "${_ps##*#}"; return 0 ;;
            *@*)  echo "$_ps" | sed 's|.*@||;s|[/?].*||' | cut -c1-25; return 0 ;;
        esac
    fi
    display_proxy_name_with_tag "$tag"
}

# get_subscription_server_count: count real outbound servers in subscription cache.
# Excludes meta-outbounds (selector, urltest, direct, dns, block).
get_subscription_server_count() {
    local sec="$1" cnt cache
    # Primary: Clash /proxies — reflects what is actually loaded into sing-box,
    # independent of how each variant lays out its /var/run cache files.
    local proxies sel
    proxies=$(clash_request "/proxies" 2>/dev/null)
    if [ -n "$proxies" ] && [ "$proxies" != "null" ]; then
        sel=$(get_selector_tag "$proxies")
        if [ -n "$sel" ]; then
            cnt=$(echo "$proxies" | jq -r --arg s "$sel" '
                [ (.proxies[$s].all // [])[]
                  | ascii_downcase
                  | select(. != "direct" and . != "block" and . != "dns-out") ]
                | length' 2>/dev/null)
            if [ -n "$cnt" ] && [ "$cnt" -gt 0 ] 2>/dev/null; then
                echo "$cnt"; return
            fi
        fi
    fi
    # Fallback: per-variant file cache. Schemas differ:
    #   plus      → section-cache/<sec>.json, .servers is an OBJECT (tag→host) map
    #   evolution → subscription/<sec>.json,  .outbounds[] array (sing-box style)
    #   netshift  → subscriptions/<sec>.json, .outbounds[] array
    cache=$(get_subscription_cache_path "$sec")
    [ -f "$cache" ] || { echo "0"; return; }
    if [ "$PODKOP_VARIANT" = "plus" ]; then
        cnt=$(jq -r '(.servers // {}) | length' "$cache" 2>/dev/null)
    else
        cnt=$(jq -r '[.outbounds[] | select(
            .type != "selector" and .type != "urltest" and
            .type != "direct" and .type != "dns" and .type != "block"
        )] | length' "$cache" 2>/dev/null)
    fi
    echo "${cnt:-0}"
}

# get_subscription_cache_path: path to outbound list cache for a subscription section.
get_subscription_cache_path() {
    local sec="$1"
    case "$PODKOP_VARIANT" in
        evolution) printf '/var/run/podkop/subscription/%s.json' "$sec" ;;
        netshift)  printf '/var/run/netshift/subscriptions/%s.json' "$sec" ;;
        plus)      printf '/var/run/podkop-plus/section-cache/%s.json' "$sec" ;;
        *)         printf '' ;;
    esac
}

# get_subscription_metadata_path: path to traffic/expire metadata (Plus only).
get_subscription_metadata_path() {
    local sec="$1"
    case "$PODKOP_VARIANT" in
        plus) printf '/var/run/podkop-plus/subscription-metadata/%s.json' "$sec" ;;
        *)    printf '' ;;
    esac
}

# get_subscription_urls: list of subscription URLs for the section.
# Evolution: single URL from subscription_url.
# Plus: list from subscription_urls.
get_subscription_urls() {
    local sec="$1"
    section_is_subscription "$sec" || return 1
    if [ "$PODKOP_VARIANT" = "evolution" ] || [ "$PODKOP_VARIANT" = "netshift" ]; then
        # NetShift supports both scalar and list subscription_url.
        # uci show handles both — returns one line per value.
        local _ns_urls
        _ns_urls=$(uci -q show ${PODKOP_UCI}.${sec}.subscription_url 2>/dev/null \
            | sed "s/^[^=]*=//; s/^'//; s/'$//" \
            | grep -v "^[[:space:]]*$")
        [ -n "$_ns_urls" ] && printf '%s\n' "$_ns_urls"
    else
        # uci show for list fields returns one line per item:
        # podkop-plus.main.subscription_urls='url1'
        # podkop-plus.main.subscription_urls='url2'
        # Extract the value part after = and strip single quotes
        uci -q show ${PODKOP_UCI}.${sec}.subscription_urls 2>/dev/null \
            | sed "s/^[^=]*=//; s/^'//; s/'$//" \
            | grep -v "^[[:space:]]*$"
    fi
}

_resolve_leaf() {
    local curr="$1" proxies="$2" i=0 pt nxt
    while [ "$i" -lt 5 ]; do
        pt=$(echo "$proxies" | jq -r --arg n "$curr" '.proxies[$n].type // empty')
        case "$pt" in
            Selector|URLTest|Fallback|LoadBalance)
                nxt=$(echo "$proxies" | jq -r --arg n "$curr" '.proxies[$n].now // empty')
                [ -n "$nxt" ] && [ "$nxt" != "$curr" ] && curr="$nxt" || break ;;
            *) break ;;
        esac
        i=$((i + 1))
    done
    echo "$curr"
}

get_proxy_index_by_tag() {
    local tag="$1" sec num
    sec=$(get_active_section)
    [ "$tag" = "${sec}-out" ] && { echo "0"; return 0; }
    num=$(printf '%s\n' "$tag" | sed -n "s/^${sec}-\([0-9][0-9]*\)-out$/\1/p")
    [ -n "$num" ] || return 1
    echo $((num - 1))
}

get_proxy_human_name_from_link() {
    local link="$1" frag
    case "$link" in *#*) frag="${link##*#}" ;; *) return 1 ;; esac
    [ -z "$frag" ] && return 1
    url_decode "$frag"
}

get_proxy_human_name_by_index() {
    local idx="$1" link name
    link=$(get_selector_link_by_index "$idx") || return 1
    name=$(get_proxy_human_name_from_link "$link")
    [ -n "$name" ] && { printf '%s\n' "$name"; return 0; }
    return 1
}

get_proxy_human_name_by_tag() {
    local tag="$1" idx human
    idx=$(get_proxy_index_by_tag "$tag") || return 1
    human=$(get_proxy_human_name_by_index "$idx")
    [ -n "$human" ] && { printf '%s\n' "$human"; return 0; }
    return 1
}

display_proxy_name() {
    local tag="$1" human cached_uri srv_port type_str
    [ -z "$tag" ] && { echo "Unknown"; return 0; }
    # 1. Try human name from selector_proxy_links index (fast, works for selector mode)
    human=$(get_proxy_human_name_by_tag "$tag")
    [ -n "$human" ] && { printf '%s\n' "$human"; return 0; }
    # 2. Try tag_name_cache (covers urltest_proxy_links, url_proxy_links, all modes)
    # Use -s to check non-empty; rebuild on miss (stale cache from early reload)
    [ -s "$TAG_NAME_CACHE" ] || build_tag_name_cache
    human=$(grep "^${tag}=" "$TAG_NAME_CACHE" 2>/dev/null | cut -d= -f2-)
    if [ -z "$human" ]; then
        # Ensure TAG_URI_CACHE is fresh before rebuilding TAG_NAME_CACHE —
        # build_tag_name_cache depends on TAG_URI_CACHE for server:port matching
        [ -s "$TAG_URI_CACHE" ] || build_tag_uri_cache
        build_tag_name_cache
        human=$(grep "^${tag}=" "$TAG_NAME_CACHE" 2>/dev/null | cut -d= -f2-)
    fi
    [ -n "$human" ] && { printf '%s\n' "$human"; return 0; }
    # 3. Fallback: reconstruct [type] server:port from TAG_URI_CACHE
    cached_uri=$(get_uri_by_tag "$tag")
    if [ -n "$cached_uri" ] && [ "$cached_uri" != "N/A" ]; then
        srv_port=$(extract_server_port_from_uri "$cached_uri")
        type_str=$(printf '%s' "$cached_uri" | cut -d: -f1)
        [ -n "$srv_port" ] && [ "$srv_port" != "N/A" ] && { printf '[%s] %s\n' "$type_str" "$srv_port"; return 0; }
    fi
    # 4. Last resort: return raw tag
    printf '%s\n' "$tag"
}

display_proxy_name_with_tag() {
    local tag="$1" human
    [ -z "$tag" ] && { echo "Unknown"; return 0; }
    human=$(display_proxy_name "$tag")
    [ "$human" != "$tag" ] && printf '%s (%s)\n' "$human" "$tag" || printf '%s\n' "$tag"
}

extract_server_port_from_uri() {
    local clean="${1%%#*}" sp
    # Handles both formats:
    #   with auth:    scheme://user[:pass]@host:port  (vless, hy2, trojan, tuic, ss+auth)
    #   without auth: scheme://host:port              (ss no-auth as stored in TAG_URI_CACHE)
    sp=$(printf '%s\n' "$clean" | sed -n 's|^[^:]*://\([^@/?]*@\)\?\([^/?#]*\).*|\2|p')
    [ -n "$sp" ] && printf '%s' "$sp" || printf 'N/A'
}

format_proxy_delay_status() {
    local delay="$1"
    [ -z "$delay" ] || [ "$delay" = "0" ] || [ "$delay" = "N/A" ] && { printf '%s Offline' "$E_RED"; return; }
    case "$delay" in
        ''|*[!0-9]*) printf '%s Unknown' "$E_YLW" ;;
        *) if   [ "$delay" -lt 200 ]; then printf '%s Healthy'      "$E_ON"
           elif [ "$delay" -lt 500 ]; then printf '%s OK'           "$E_YLW"
           elif [ "$delay" -lt 900 ]; then printf '%s Slow'         "$E_ORNG"
           else                            printf '%s High Latency' "$E_RED"; fi ;;
    esac
}

build_proxy_list_label() {
    local proxies="$1" selector="$2" idx="$3" current_proxy="$4"
    local name display_name leaf type delay_raw icon delay_txt active_mark

    name=$(echo "$proxies" | jq -r --arg sel "$selector" --arg idx "$idx" \
        '.proxies[$sel].all[$idx|tonumber] // empty' 2>/dev/null)
    [ -z "$name" ] && return 1

    active_mark=""; [ "$name" = "$current_proxy" ] && active_mark="${E_PLAY} "
    display_name=$(display_proxy_name "$name")
    leaf=$(_resolve_leaf "$name" "$proxies"); [ -z "$leaf" ] && leaf="$name"
    type=$(echo "$proxies" | jq -r --arg n "$leaf" '.proxies[$n].type // .proxies[$n].adapterType // "Unknown"' 2>/dev/null)
    delay_raw=$(echo "$proxies" | jq -r --arg n "$name" '.proxies[$n].history[-1].delay // 0' 2>/dev/null)
    [ -z "$delay_raw" ] || [ "$delay_raw" = "0" ] && \
        delay_raw=$(echo "$proxies" | jq -r --arg n "$leaf" '.proxies[$n].history[-1].delay // 0' 2>/dev/null)

    if [ -n "$delay_raw" ] && [ "$delay_raw" != "0" ]; then
        delay_txt="${delay_raw}ms"
        if   [ "$delay_raw" -lt 200 ]; then icon="${E_ON}"
        elif [ "$delay_raw" -lt 500 ]; then icon="${E_YLW}"
        elif [ "$delay_raw" -lt 900 ]; then icon="${E_ORNG}"
        else                                icon="${E_RED}"; fi
    else
        delay_txt="N/A"; icon="${E_RED}"
    fi
    printf '%s%s %s | %s | %s' "$active_mark" "$icon" "$display_name" "$type" "$delay_txt"
}

get_uci_bool_emoji() {
    local value; value=$(uci -q get "$1.$2")
    [ "$value" = "1" ] && echo "${E_ON}" || echo "${E_OFF}"
}

toggle_uci_bool() {
    local config="$1" option="$2" current new_value
    current=$(uci -q get "${config}.${option}")
    new_value="1"; [ "$current" = "1" ] && new_value="0"
    uci set "${config}.${option}=${new_value}"
    uci_commit_safe "$(echo "$config" | cut -d. -f1)"
}

# Reload podkop with 10-second cooldown and optional flock.
# Records reload timestamp for Tunnel Health display.
# Returns: 0=success, 1=skipped (cooldown), 2=failed
safe_reload_podkop() {
    local force="$1" rc

    if command -v flock >/dev/null 2>&1; then
        ( flock -n 9 || exit 1
          local now last diff
          now=$(date +%s)
          if [ "$force" != "force" ]; then
              last=$(cat "$RELOAD_LOCK" 2>/dev/null || echo "0")
              diff=$((now - last))
              [ "$diff" -lt 10 ] && exit 1
          fi
          echo "$now" > "$RELOAD_LOCK"
          echo "$now" > "$RELOAD_TS_FILE"
          exit 0
        ) 9>/tmp/podkop_reload.lock || {
            logger -t podkop-bot "[Reload] Skipped (cooldown active)"; return 1
        }
    else
        local now last diff
        now=$(date +%s)
        if [ "$force" != "force" ]; then
            last=$(cat "$RELOAD_LOCK" 2>/dev/null || echo "0")
            diff=$((now - last))
            if [ "$diff" -lt 10 ]; then logger -t podkop-bot "[Reload] Skipped"; return 1; fi
        fi
        echo "$now" > "$RELOAD_LOCK"
        echo "$now" > "$RELOAD_TS_FILE"
    fi

    ${PODKOP_INIT} reload; rc=$?
    # Wait for sing-box config.json to be written and valid before building caches.
    # podkop reload is semi-async: returns before sing-box fully restarts.
    # Building caches too early produces empty TAG_URI/UCI_LINKS/TAG_NAME caches.
    local _cfg_ready=0
    if [ "$rc" -eq 0 ]; then
        local _ci=0 _cfg="${SINGBOX_CONFIG_PATH:-${SINGBOX_CONFIG_PATH}}"
        while [ "$_ci" -lt 10 ]; do
            jq -e '.outbounds | length > 0' "$_cfg" >/dev/null 2>&1 && { _cfg_ready=1; break; }
            sleep 1; _ci=$((_ci + 1))
        done
        [ "$_cfg_ready" = "0" ] && logger -t podkop-bot "[Reload] Warning: config.json not ready after 10s, skipping cache build"
    fi
    [ "$_cfg_ready" = "1" ] && build_all_caches
    [ "$rc" -ne 0 ] && { logger -t podkop-bot "[Error] Reload failed (RC=$rc) — podkop config invalid, sing-box not restarted"; return 2; }
    logger -t podkop-bot "[Reload] Success"; return 0
}

# Check podkop tunnel health via fakeip DNS test.
# Borrowed from podkop_autoupdater (VizzleTF).
# Returns 0 and sets PODKOP_DNS_OK=1 if tunnel working, PODKOP_DNS_OK=0 if not.
# Usage: podkop_dns_check [delay_seconds]
podkop_dns_check() {
    local delay="${1:-15}" result
    sleep "$delay"
    result=$(nslookup -timeout=3 "${PODKOP_FAKEIP_DOMAIN:-fakeip.podkop.fyi}" 127.0.0.42 2>&1)
    if printf '%s' "$result" | grep -q 'Address:.*198\.18\.'; then
        PODKOP_DNS_OK=1
        logger -t podkop-bot "[Reload] DNS check passed (fakeip → 198.18.x.x)"
    else
        PODKOP_DNS_OK=0
        logger -t podkop-bot "[Reload] DNS check failed (tunnel may not be routing)"
    fi
}

# ==============================================================================
# Active Outbound Probe functions
# All tests run through current mixed_proxy SOCKS (socks5h://IP:PORT).
# This means they test the ACTIVE outbound, not the router's direct connection.
# ==============================================================================

# probe_geo: get exit IP, country, ASN through active outbound
# Sets: PROBE_EXIT_IP, PROBE_COUNTRY, PROBE_ORG
probe_geo() {
    local m_ip m_port sec resp
    sec=$(get_active_section)
    m_port=$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_port 2>/dev/null || echo "2080")
    m_ip=$(get_proxy_ip)

    # Primary: ipapi.co — IP, country, ASN/org
    resp=$(curl -s -k \
        -x "socks5h://${m_ip}:${m_port}" \
        --connect-timeout 6 --max-time 10 \
        "https://ipapi.co/json" 2>/dev/null)

    if [ -n "$resp" ]; then
        PROBE_EXIT_IP=$(printf '%s' "$resp" | jq -r '.ip // empty' 2>/dev/null)
        PROBE_COUNTRY=$(printf '%s' "$resp" | jq -r '(.country_code // "") + " " + (.country_name // "")' 2>/dev/null | sed 's/^ *//;s/ *$//')
        PROBE_ORG=$(printf '%s' "$resp" | jq -r '.org // empty' 2>/dev/null)
    fi
    [ -z "$PROBE_EXIT_IP" ] && PROBE_EXIT_IP="N/A"
    [ -z "$PROBE_COUNTRY" ] && PROBE_COUNTRY="N/A"
    [ -z "$PROBE_ORG" ] && PROBE_ORG=""

    # Secondary: Cloudflare cdn-cgi/trace — independent geo source, plain text, no rate limit
    # Returns: loc=NL, colo=AMS — how Cloudflare sees the exit IP
    local cf_resp
    cf_resp=$(curl -s -k \
        -x "socks5h://${m_ip}:${m_port}" \
        --connect-timeout 6 --max-time 8 \
        "https://cloudflare.com/cdn-cgi/trace" 2>/dev/null)
    PROBE_CF_COUNTRY=$(printf '%s' "$cf_resp" | grep '^loc=' | cut -d= -f2 | tr -d '\r')
    [ -z "$PROBE_CF_COUNTRY" ] && PROBE_CF_COUNTRY="N/A"
}

# probe_google: get Google's geo hint through active outbound
# Parses MgUcDb field from google.com response
# Sets: PROBE_GOOGLE_COUNTRY
probe_google() {
    local m_ip m_port sec resp
    sec=$(get_active_section)
    m_port=$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_port 2>/dev/null || echo "2080")
    m_ip=$(get_proxy_ip)

    resp=$(curl -s -k \
        -x "socks5h://${m_ip}:${m_port}" \
        --connect-timeout 6 --max-time 10 \
        -A "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0" \
        "https://www.google.com" 2>/dev/null)

    # Extract Google internal geo hint — used by Google to determine user country
    PROBE_GOOGLE_COUNTRY=$(printf '%s' "$resp" | \
        grep -o '"MgUcDb":"[^"]*"' | \
        sed 's/"MgUcDb":"//;s/"//' | head -1)
    [ -z "$PROBE_GOOGLE_COUNTRY" ] && PROBE_GOOGLE_COUNTRY="N/A"
}

# probe_services: check reachability of key services through active outbound
# Sets: PROBE_SVC_RESULTS (TAB-separated lines: "name<TAB>icon<TAB>detail")
probe_services() {
    local m_ip m_port sec
    sec=$(get_active_section)
    m_port=$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_port 2>/dev/null || echo "2080")
    m_ip=$(get_proxy_ip)
    PROBE_SVC_RESULTS=""
    PROBE_TG_BLOCKED=0

    local _name _url _expected _parse _code _icon _detail _tab
    _tab=$(printf '\t')
    local _ua="Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
    local _proxy="-x socks5h://${m_ip}:${m_port}"
    local _curl_base="curl -s -k --connect-timeout 6 --max-time 10"

    # Helper: run probe, set _code and optionally parse JSON for _detail
    _probe() {
        local __url="$1" __expected="$2" __parse="$3"
        shift 3
        _code=$($_curl_base $_proxy -o /tmp/podkop_probe_svc.tmp -w "%{http_code}" "$@" "$__url" 2>/dev/null)
        _detail=""
        if [ -n "$__parse" ] && [ -s /tmp/podkop_probe_svc.tmp ]; then
            _detail=$(jq -r "$__parse // empty" /tmp/podkop_probe_svc.tmp 2>/dev/null || echo "")
            [ -n "$_detail" ] && _detail=" ($_detail)"
        fi
        rm -f /tmp/podkop_probe_svc.tmp
        case "$_code" in
            "$__expected")       _icon="${E_OK}" ;;
            ''|000)              _icon="${E_RED}"; _detail=" (timeout)" ;;
            301|302|303|307|308) _icon="${E_YLW}"; _detail=" (redirect $_code)" ;;
            403|451)             _icon="${E_RED}"; _detail=" (blocked $_code)" ;;
            *)                   _icon="${E_YLW}"; _detail=" (HTTP $_code)" ;;
        esac
    }

    # YouTube — sw.js_data endpoint returns country as ipregion.sh approach
    # tail -n +3 skips first 2 lines (non-JSON prefix), then parse country field
    _name="YouTube"
    _code=$(curl -s -k \
        -x "socks5h://${m_ip}:${m_port}" \
        --connect-timeout 6 --max-time 10 \
        -o /tmp/podkop_probe_svc.tmp \
        -w "%{http_code}" \
        "https://www.youtube.com/sw.js_data" 2>/dev/null)
    _detail=""
    if [ "$_code" = "200" ] && [ -s /tmp/podkop_probe_svc.tmp ]; then
        local _yt_country
        _yt_country=$(tail -n +3 /tmp/podkop_probe_svc.tmp 2>/dev/null | \
            jq -r '.[0][2][0][0][1] // empty' 2>/dev/null)
        [ -n "$_yt_country" ] && _detail=" ($_yt_country)"
        _icon="${E_OK}"
    elif [ -z "$_code" ] || [ "$_code" = "000" ]; then
        _icon="${E_RED}"; _detail=" (timeout)"
    else
        _icon="${E_RED}"; _detail=" (HTTP $_code)"
    fi
    rm -f /tmp/podkop_probe_svc.tmp
    PROBE_SVC_RESULTS="${PROBE_SVC_RESULTS}${_name}${_tab}${_icon}${_tab}${_detail}
"
    # Telegram API
    _name="Telegram API"
    _probe "https://api.telegram.org" "200" "" -L
    [ "$_icon" != "${E_OK}" ] && PROBE_TG_BLOCKED=1
    PROBE_SVC_RESULTS="${PROBE_SVC_RESULTS}${_name}${_tab}${_icon}${_tab}${_detail}
"
    # ChatGPT — platform.openai.com/v1/models returns 401 (auth required) = accessible
    # ab.chatgpt.com times out on many datacenter IPs — use API endpoint instead
    _name="ChatGPT"
    _code=$(curl -s -k \
        -x "socks5h://${m_ip}:${m_port}" \
        --connect-timeout 8 --max-time 15 \
        -o /dev/null \
        -w "%{http_code}" \
        "https://api.openai.com/v1/models" 2>/dev/null)
    case "$_code" in
        200|401) _icon="${E_OK}";  _detail="" ;;
        ''|000)  _icon="${E_RED}"; _detail=" (timeout)" ;;
        403|451) _icon="${E_RED}"; _detail=" (geo-blocked)" ;;
        *)       _icon="${E_YLW}"; _detail=" (HTTP $_code)" ;;
    esac
    PROBE_SVC_RESULTS="${PROBE_SVC_RESULTS}${_name}${_tab}${_icon}${_tab}${_detail}
"
    # Claude.ai — api.anthropic.com/v1/models returns 401 (auth required) = accessible
    # claude.ai/login returns 403 for datacenter IPs via Cloudflare — use API instead
    _name="Claude.ai"
    _code=$(curl -s -k \
        -x "socks5h://${m_ip}:${m_port}" \
        --connect-timeout 6 --max-time 10 \
        -o /dev/null \
        -w "%{http_code}" \
        "https://api.anthropic.com/v1/models" 2>/dev/null)
    case "$_code" in
        200|401) _icon="${E_OK}";  _detail="" ;;
        ''|000)  _icon="${E_RED}"; _detail=" (timeout)" ;;
        403|451) _icon="${E_RED}"; _detail=" (geo-blocked)" ;;
        *)       _icon="${E_YLW}"; _detail=" (HTTP $_code)" ;;
    esac
    PROBE_SVC_RESULTS="${PROBE_SVC_RESULTS}${_name}${_tab}${_icon}${_tab}${_detail}
"
    # Gemini — google.com/app returns 200 in supported regions, redirects/403 elsewhere
    _name="Gemini"
    _code=$(curl -s -k -L -A "$_ua" \
        -x "socks5h://${m_ip}:${m_port}" \
        --connect-timeout 6 --max-time 10 \
        -o /dev/null \
        -w "%{http_code}" \
        "https://gemini.google.com/app" 2>/dev/null)
    case "$_code" in
        200)     _icon="${E_OK}"; _detail="" ;;
        ''|000)  _icon="${E_RED}"; _detail=" (timeout)" ;;
        403|451) _icon="${E_RED}"; _detail=" (geo-blocked)" ;;
        *)       _icon="${E_YLW}"; _detail=" (HTTP $_code)" ;;
    esac
    PROBE_SVC_RESULTS="${PROBE_SVC_RESULTS}${_name}${_tab}${_icon}${_tab}${_detail}
"
    # Discord
    _name="Discord"
    _probe "https://discord.com/api/v9/gateway" "200" ""
    PROBE_SVC_RESULTS="${PROBE_SVC_RESULTS}${_name}${_tab}${_icon}${_tab}${_detail}
"
}

# probe_throughput: measure download speed and detect ISP throttle/block.
# Two-stage test:
#   Stage 1: 32 KB — fast, detects 16 KB block pattern (РКН drops after ~16 KB)
#   Stage 2: 1 MB  — accurate speed measurement (skipped if stage 1 shows block)
# Sets: PROBE_SPEED_MBPS, PROBE_SPEED_BYTES, PROBE_SPEED_SECS, PROBE_SPEED_STATUS
probe_throughput() {
    local m_ip m_port sec raw speed_bps size_bytes time_secs
    sec=$(get_active_section)
    m_port=$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_port 2>/dev/null || echo "2080")
    m_ip=$(get_proxy_ip)

    # Stage 1: 32 KB — detect 16 KB block quickly (РКН pattern: drops after ~16 KB)
    # curl writes -w fields even on RST — colon-separated format always emitted
    local raw1
    raw1=$(curl -s -k \
        -x "socks5h://${m_ip}:${m_port}" \
        --connect-timeout 6 --max-time 15 \
        -H "Range: bytes=0-32767" \
        -o /dev/null \
        -w "%{speed_download}:%{size_download}:%{time_total}" \
        "https://speed.cloudflare.com/__down?bytes=32768" 2>/dev/null)

    local s1_size s1_size_kb
    s1_size=$(printf '%s' "$raw1" | cut -d: -f2 | grep -oE '^[0-9]+' || echo "0")
    s1_size="${s1_size:-0}"
    s1_size_kb=$(awk "BEGIN{printf \"%d\", ${s1_size} / 1024}")

    # Detect 16 KB block: received ≤20 KB out of 32 KB
    if [ "${s1_size_kb:-0}" -le 20 ] && [ "${s1_size:-0}" -gt 0 ]; then
        PROBE_SPEED_STATUS="block16k"
        PROBE_SPEED_MBPS="0.00"
        PROBE_SPEED_BYTES="$s1_size"
        PROBE_SPEED_SECS=$(printf '%s' "$raw1" | cut -d: -f3 | grep -oE '^[0-9]+(\.[0-9]+)?' || echo "0")
        PROBE_SPEED_SECS=$(awk "BEGIN{printf \"%.1f\", ${PROBE_SPEED_SECS:-0}}")
        return
    elif [ "${s1_size:-0}" -eq 0 ]; then
        PROBE_SPEED_STATUS="blocked"
        PROBE_SPEED_MBPS="0.00"
        PROBE_SPEED_BYTES=0
        PROBE_SPEED_SECS="0.0"
        return
    fi

    # Stage 2: 1 MB — accurate speed measurement
    raw=$(curl -s -k \
        -x "socks5h://${m_ip}:${m_port}" \
        --connect-timeout 6 --max-time 60 \
        -H "Range: bytes=0-1048575" \
        -o /dev/null \
        -w "%{speed_download}:%{size_download}:%{time_total}" \
        "https://speed.cloudflare.com/__down?bytes=1048576" 2>/dev/null)

    speed_bps=$(printf '%s' "${raw%%:*}"          | grep -oE '^[0-9]+(\.[0-9]+)?' || echo "0")
    size_bytes=$(printf '%s' "$raw" | cut -d: -f2 | grep -oE '^[0-9]+'            || echo "0")
    time_secs=$(printf '%s' "$raw"  | cut -d: -f3 | grep -oE '^[0-9]+(\.[0-9]+)?' || echo "0")
    speed_bps="${speed_bps:-0}"; size_bytes="${size_bytes:-0}"; time_secs="${time_secs:-0}"

    PROBE_SPEED_MBPS=$(awk "BEGIN{printf \"%.2f\", ${speed_bps} * 8 / 1000000}")
    PROBE_SPEED_BYTES="${size_bytes}"
    PROBE_SPEED_SECS=$(awk "BEGIN{printf \"%.1f\", ${time_secs}}")

    local size_kb
    size_kb=$(awk "BEGIN{printf \"%d\", ${size_bytes} / 1024}")

    if [ "$(awk "BEGIN{print (${speed_bps} < 100000) ? 1 : 0}")" = "1" ]; then
        PROBE_SPEED_STATUS="throttled"
    else
        PROBE_SPEED_STATUS="ok"
    fi
}



do_podkop_stop() {
    local rc pid_list
    ${PODKOP_INIT} stop 2>/dev/null; rc=$?
    pid_list=$(pidof sing-box 2>/dev/null)
    if [ -n "$pid_list" ]; then
        logger -t podkop-bot "[Stop] Orphaned sing-box PIDs: ${pid_list}, sending SIGTERM"
        kill $pid_list 2>/dev/null; sleep 1
        pid_list=$(pidof sing-box 2>/dev/null)
        if [ -n "$pid_list" ]; then
            logger -t podkop-bot "[Stop] Sending SIGKILL to: ${pid_list}"
            kill -9 $pid_list 2>/dev/null
        fi
    fi
    pidof sing-box >/dev/null 2>&1 && return 1 || return 0
}

# ==============================================================================
# SECTION 7: Diagnostics
# ==============================================================================

run_internal_diagnostics() {
    local out_file="$1" rc=0 selector delay_res
    {
        echo "=== BOT INTERNAL DIAGNOSTICS ==="
        echo "Date: $(date)"; echo "Host: $(cat /proc/sys/kernel/hostname 2>/dev/null || echo Router)"
        echo; echo "--- Bot Version ---"; echo "${BOT_VERSION}"
        echo; echo "--- Core UCI ---"
        uci -q show ${PODKOP_UCI}.main 2>/dev/null || true
        uci -q show ${PODKOP_UCI}.main_routing 2>/dev/null || true
        uci -q show ${PODKOP_UCI}.dns 2>/dev/null || true
        uci -q show ${PODKOP_UCI}.settings 2>/dev/null || true
        echo; echo "--- Clash API ---"
        if clash_request "/version" "GET" 2>/dev/null | jq . >/dev/null 2>&1; then echo "OK"
        else echo "FAIL"; rc=1; fi
        echo; echo "--- Selector Delay Test ---"
        selector="$(get_selector_tag "")"; echo "$selector"
        delay_res="$(clash_request "/proxies/${selector}/delay?timeout=5000&url=http://www.gstatic.com/generate_204" 2>/dev/null)"
        echo "$delay_res"
        echo; echo "--- Native Routing ---"; ip -4 route show 2>&1 || true
        echo; echo "--- Interfaces ---"; ip -4 addr show 2>&1 || true
        echo; echo "--- Nftables (podkop) ---"; nft list ruleset 2>/dev/null | grep -i "${PODKOP_PKG}" || true
        echo; echo "--- Log Tail ---"; logread 2>/dev/null | grep -iE "${PODKOP_PKG}|sing-box" | tail -n 50 || true
    } > "$out_file"
    return "$rc"
}

run_upstream_health_report() {
    local out_file="$1"
    local proxies selector names_file ok_count fail_count total
    local name display_name tag_idx raw_link p_svr_port name_url res delay type leaf_n

    proxies="$(clash_request "/proxies" 2>/dev/null)"
    selector="$(get_selector_tag "$proxies")"
    names_file="$(mktemp /tmp/podkop_upstream.XXXXXX)"

    { echo "=== UPSTREAM HEALTH REPORT ==="; echo "Date: $(date)"; echo "Selector: ${selector}"; echo; } > "$out_file"

    if [ -z "$proxies" ] || [ "$proxies" = "null" ]; then
        echo "FAIL: Clash API unavailable" >> "$out_file"; rm -f "$names_file"; return 1
    fi

    echo "--- Candidates ---" >> "$out_file"
    echo "$proxies" | jq -r --arg sel "$selector" '.proxies[$sel].all[]?' 2>/dev/null > "$names_file"
    cat "$names_file" >> "$out_file"; echo >> "$out_file"
    echo "--- Delay Results ---" >> "$out_file"

    while IFS= read -r name; do
        [ -n "$name" ] || continue
        display_name="$(display_proxy_name "$name")"
        tag_idx=$(get_proxy_index_by_tag "$name")
        [ -n "$tag_idx" ] && raw_link=$(get_selector_link_by_index "$tag_idx")
        [ -z "$raw_link" ] && raw_link=$(get_uri_by_tag "$name")
        [ -n "$raw_link" ] && p_svr_port=$(extract_server_port_from_uri "${raw_link%%#*}") || p_svr_port="N/A"
        name_url="$(printf '%s' "$name" | jq -rR '@uri')"
        res="$(clash_request "/proxies/${name_url}/delay?timeout=5000&url=http://www.gstatic.com/generate_204" 2>/dev/null)"
        delay="$(echo "$res" | jq -r '.delay // "0"' 2>/dev/null)"
        # Resolve leaf for accurate type (same logic as proxy_menu)
        leaf_n=$(_resolve_leaf "$name" "$proxies")
        [ -z "$leaf_n" ] && leaf_n="$name"
        type="$(echo "$proxies" | jq -r --arg n "$leaf_n" '.proxies[$n].type // .proxies[$n].adapterType // "Unknown"' 2>/dev/null)"
        case "$delay" in ''|*[!0-9]*) delay="0" ;; esac
        if [ "$delay" -gt 0 ]; then
            printf '[OK]   %s | %s | %s | %sms | tag=%s\n' "$display_name" "$type" "$p_svr_port" "$delay" "$name" >> "$out_file"
        else
            printf '[FAIL] %s | %s | %s | timeout | tag=%s\n' "$display_name" "$type" "$p_svr_port" "$name" >> "$out_file"
        fi
    done < "$names_file"

    ok_count="$(grep -c '^\[OK\]'   "$out_file" 2>/dev/null)"; case "$ok_count"   in ''|*[!0-9]*) ok_count=0   ;; esac
    fail_count="$(grep -c '^\[FAIL\]' "$out_file" 2>/dev/null)"; case "$fail_count" in ''|*[!0-9]*) fail_count=0 ;; esac
    total=$((ok_count + fail_count))
    { echo; echo "--- Summary ---"; echo "Total: ${total}"; echo "Healthy: ${ok_count}"; echo "Failed: ${fail_count}"; } >> "$out_file"
    rm -f "$names_file"
    [ "$fail_count" -gt 0 ] && return 1 || return 0
}

# ==============================================================================
# SECTION 8: Health Daemon (Background TG + sing-box watchdog)
# ==============================================================================
#
# Three independent checks per cycle:
# A. Telegram API direct reachability (raw curl, not through bot transport stack)
#   B. sing-box process liveness
#   C. SOCKS upstream probe (via probe_socks_upstream, 3 endpoints)
#
# Anti-flap hysteresis:
#   SOCKS down alert fires only after 2 consecutive down probes.
#   SOCKS recover alert fires only after 2 consecutive up probes.
#   TG connectivity uses same 2/2 hysteresis.
#
# On SOCKS down: resets LAST_ROUTE_FAST and LAST_ROUTE_POLL to "unknown"
#   so main loop immediately rediscovers working tier.
# On SOCKS recover: same reset + 3s DNS warmup sleep.
#
# Structured state written to SOCKS_STATE_FILE (key=value, one per line):
#   tg=ok|fail
#   socks=up|down
#   route=<LAST_ROUTE value>
#   last_ok=<last tier that worked>
# ==============================================================================

# check_health() — probes Telegram reachability via two independent paths.
# Writes TWO keys to HEALTH_STATE_FILE (sourced by watchdog after call):
#   tg_direct=ok|fail   — raw direct curl, no proxy (expected fail under RKN)
#   tg_transport=ok|fail — via primary mixed_proxy SOCKS (Podkop tier1)
# Return value: 0 if either path succeeded, 1 if both failed.
# Does NOT touch LAST_ROUTE_* — uses its own independent curl sessions.
check_health() {
    local tmp_resp _direct=fail _transport=fail _tier2=fail
    local _sec _port _ip

    # A1: direct (no proxy) — raw TCP connectivity to Telegram DC IPs
    # Uses --interface <wan_if> + --noproxy to bypass fakeip/tproxy routing.
    # Without --interface, curl may go through podkop tunnel and return ok
    # even when Telegram is blocked — causing false "direct ✅".
    # Falls back to "unknown" if WAN interface cannot be determined.
    local _dc_pids="" _dc_dir _wan_if _if_flag=""
    _wan_if=$(_get_wan_interface)
    if [ -n "$_wan_if" ]; then
        _if_flag="--interface $_wan_if"
    else
        # WAN interface unknown — cannot do reliable direct check
        _direct="unknown"
    fi
    if [ "$_direct" != "unknown" ]; then
        _dc_dir=$(mktemp -d /tmp/podkop_dc_probes.XXXXXX 2>/dev/null) || _dc_dir="/tmp"
        local _dc_ips="$TG_EMERGENCY_IPS"
        [ -z "$_dc_ips" ] && _dc_ips="149.154.167.220 149.154.167.51 91.108.56.190"
        local _dc_total=0 _dc_i=0
        for _dc_ip in $_dc_ips; do
            _dc_i=$((_dc_i+1)); _dc_total=$_dc_i
            ( curl -s -k --connect-timeout 4 --max-time 6 \
                $_if_flag --noproxy '*' \
                --resolve "api.telegram.org:443:${_dc_ip}" \
                -X GET "${API_URL}/getMe" 2>/dev/null \
                | jq -e '.ok == true' >/dev/null 2>&1 \
                && echo "ok" || echo "fail" ) > "${_dc_dir}/dc_${_dc_i}" &
            _dc_pids="$_dc_pids $!"
        done
        wait $_dc_pids 2>/dev/null || true
        local _dc_ok=0; _dc_i=0
        for _dc_ip in $_dc_ips; do
            _dc_i=$((_dc_i+1))
            [ -f "${_dc_dir}/dc_${_dc_i}" ] && \
                [ "$(cat "${_dc_dir}/dc_${_dc_i}")" = "ok" ] && \
                _dc_ok=$((_dc_ok + 1))
        done
        rm -rf "$_dc_dir" 2>/dev/null || true
        if [ "$_dc_total" -gt 0 ] && [ "$_dc_ok" -gt 0 ] && [ $((_dc_ok*2)) -ge "$_dc_total" ]; then
            _direct=ok
        else
            _direct=fail
        fi
    fi

    # A2: via primary SOCKS (mixed_proxy / Podkop tier1)
    # Align with the LIVE poll path so a working tunnel can't read as fail:
    #  (1) ip:port from _load_transport_ctx (reads actual listen addr from
    #      sing-box config.json, unlike raw network.lan.ipaddr);
    #  (2) same curl syntax as the poll (-x socks5h://), not --socks5-hostname.
    _load_transport_ctx
    local _primary_sec="$_t_sec"
    local _all_secs_h
    _all_secs_h=$(uci -q show ${PODKOP_UCI} 2>/dev/null \
        | grep -E "^${PODKOP_UCI}\.[^.=]+=section$" \
        | sed 's/^[^.]*\.\([^=]*\)=section$/\1/')
    _port="$_t_port"
    _ip="$_t_ip"
    tmp_resp=$(curl -s -k --connect-timeout 5 --max-time 10 \
        -x "socks5h://${_ip}:${_port}" \
        -X GET "${API_URL}/getMe" 2>/dev/null)
    if printf '%s' "$tmp_resp" | jq -e '.ok == true' >/dev/null 2>&1; then
        _transport=ok
    fi

    # A3: probe all fallback paths — explicit fallback_socks + other sections mixed_proxy
    # Run all probes in parallel (background subshells) to avoid timeout accumulation.
    # Pattern: same as refresh_public_ip_cache() and cmd_all_delay_test.
    local _fb_raw _fb_list="" _tier2_results="" _tier2=none
    _fb_raw=$(uci -q show podkop_bot.settings.fallback_socks 2>/dev/null | cut -d= -f2-)
    [ -n "$_fb_raw" ] && { { _ucl=$(uci_list_clean "$_fb_raw"); eval "set -- $_ucl"; }; _fb_list="$*"; }

    # Build probe list: [label, endpoint] pairs written to tmpfiles in parallel
    local _probe_dir; _probe_dir=$(mktemp -d /tmp/podkop_health_probes.XXXXXX) || { _tier2=none; }
    local _pids="" _probe_any=0

    # explicit fallback_socks — ALL entries in parallel (not just first)
    local _fn=0
    for _fbe in $_fb_list; do
        _fn=$((_fn + 1))
        ( curl -s -k --connect-timeout 4 --max-time 8 \
            -x "$_fbe" -X GET "${API_URL}/getMe" 2>/dev/null \
            | jq -e '.ok == true' >/dev/null 2>&1 \
            && echo "ok" || echo "fail" ) > "${_probe_dir}/fb_${_fn}" &
        _pids="$_pids $!"
        _probe_any=1
    done

    # other sections mixed_proxy — parallel, skip duplicates vs explicit fallback_socks
    for _s in $_all_secs_h; do
        [ "$_s" = "$_primary_sec" ] && continue
        local _me _mp
        _me=$(uci -q get ${PODKOP_UCI}.${_s}.mixed_proxy_enabled 2>/dev/null || echo "0")
        _mp=$(uci -q get ${PODKOP_UCI}.${_s}.mixed_proxy_port 2>/dev/null || echo "")
        [ "$_me" = "1" ] && [ -n "$_mp" ] && [ "$_mp" != "$_port" ] || continue
        # Skip if already in explicit fallback_socks list (duplicate check)
        local _auto_ip; _auto_ip=$(_resolve_mixed_listen_ip_by_port "$_mp")
        local _auto_ep="socks5h://${_auto_ip}:${_mp}"
        case " $_fb_list " in *" $_auto_ep "*) continue ;; esac
        ( curl -s -k --connect-timeout 4 --max-time 8 \
            --socks5-hostname "${_auto_ip}:${_mp}" \
            -X GET "${API_URL}/getMe" 2>/dev/null \
            | jq -e '.ok == true' >/dev/null 2>&1 \
            && echo "ok" || echo "fail" ) > "${_probe_dir}/sec_${_s}" &
        _pids="$_pids $!"
        _probe_any=1
    done

    # Wait for all parallel probes
    [ -n "$_pids" ] && wait $_pids 2>/dev/null || true

    # Collect results from all parallel probes
    local _rn=0
    for _fbe in $_fb_list; do
        _rn=$((_rn + 1))
        local _rf="${_probe_dir}/fb_${_rn}"
        [ -f "$_rf" ] && [ "$(cat "$_rf")" = "ok" ] && _tier2=ok || \
            { [ "$_tier2" = "none" ] && _tier2=fail; }
    done
    for _s in $_all_secs_h; do
        [ "$_s" = "$_primary_sec" ] && continue
        local _rf="${_probe_dir}/sec_${_s}"
        [ -f "$_rf" ] || continue
        local _sec_result; _sec_result=$(cat "$_rf")
        _tier2_results="${_tier2_results}tg_sec_${_s}=${_sec_result}\n"
        [ "$_sec_result" = "ok" ] && _tier2=ok
    done
    [ "$_probe_any" = "0" ] && _tier2=none
    rm -rf "$_probe_dir" 2>/dev/null || true

    # Write atomically via tmp+mv — prevents watchdog reading truncated file
    printf 'tg_direct=%s\ntg_transport=%s\ntg_tier2=%s\n%b' \
        "$_direct" "$_transport" "$_tier2" "$_tier2_results" \
        > "${HEALTH_STATE_FILE}.tmp" && mv "${HEALTH_STATE_FILE}.tmp" "$HEALTH_STATE_FILE" 2>/dev/null

    # Return 0 (success) if at least one path works
    [ "$_direct" = "ok" ] || [ "$_transport" = "ok" ]
}

_write_socks_state() {
    # Args: $1=tg_aggregate(ok|fail)  $2=socks(up|down)  $3=last_ok_route
    # Reads tg_direct/tg_transport from HEALTH_STATE_FILE (written by check_health).
    # Keeps tg= for backward compat with any external tooling.
    local _tg_direct _tg_transport _tg_tier2 _tg_sec_lines
    _tg_direct=$(grep "^tg_direct=" "$HEALTH_STATE_FILE" 2>/dev/null | cut -d= -f2)
    _tg_transport=$(grep "^tg_transport=" "$HEALTH_STATE_FILE" 2>/dev/null | cut -d= -f2)
    _tg_tier2=$(grep "^tg_tier2=" "$HEALTH_STATE_FILE" 2>/dev/null | cut -d= -f2)
    # Forward per-section TG results so Tunnel Health can read them from SOCKS_STATE_FILE
    _tg_sec_lines=$(grep "^tg_sec_" "$HEALTH_STATE_FILE" 2>/dev/null)
    # route= and route_name= removed: watchdog subshell holds stale LAST_ROUTE.
    # Authoritative route key is in MAIN_ROUTE_KEY_FILE, written by main process.
    printf 'tg=%s\ntg_direct=%s\ntg_transport=%s\ntg_tier2=%s\nsocks=%s\nlast_ok=%s\n%s\n' \
        "$1" "${_tg_direct:-?}" "${_tg_transport:-?}" "${_tg_tier2:-none}" "$2" "$3" \
        "${_tg_sec_lines}" > "$SOCKS_STATE_FILE"
}

# send_health_alert: health daemon uses this instead of bare api_request_fast.
# Captures the sent message_id and writes it to LAST_ALERT_MSG_FILE so that
# send_or_edit in the main bot can detect when a menu card is buried under
# a health alert and re-float the menu.
send_health_alert() {
    local payload="$1" resp alert_mid
    _is_quiet_hours && return 0  # suppress during quiet hours
    resp=$(api_request_fast "sendMessage" "$payload")
    alert_mid=$(printf '%s' "$resp" | jq -r '.result.message_id // empty' 2>/dev/null)
    [ -n "$alert_mid" ] && printf '%s' "$alert_mid" > "$LAST_ALERT_MSG_FILE"
    # Broadcast to extra admins if enabled
    if [ "$(uci -q get podkop_bot.settings.broadcast_alerts || echo 0)" = "1" ]; then
        local _txt _aid _aids
        _txt=$(printf '%s' "$payload" | jq -r '.text // empty' 2>/dev/null)
        [ -z "$_txt" ] && return 0
        _aids=$(uci -q show podkop_bot.settings.admin_ids 2>/dev/null | cut -d= -f2- | \
            tr -d "'" | tr ' ' '\n' | grep -v '^$')
        for _aid in $_aids; do
            [ "$_aid" = "$ADMIN_ID" ] && continue
            local _bc_payload
            _bc_payload=$(jq -n -c --arg cid "$_aid" --arg txt "$_txt" \
                '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
            api_request_fast "sendMessage" "$_bc_payload" >/dev/null 2>&1
        done
    fi
}

# _flush_autoswitch_summary: send pending URLTest switch summary when the
# debounce window expires. This is called periodically from the watchdog loop,
# not only on a new switch, so a single switch followed by silence is not lost.
_flush_autoswitch_summary() {
    [ "${_sw_count:-0}" -eq 0 ] && return 0
    local _now; _now=$(date +%s)
    # Flush when the debounce window elapsed, or if the buffer grows too much.
    [ $((_now - _sw_first_ts)) -lt "$_SW_WINDOW" ] && [ "$_sw_count" -lt 10 ] && return 0

    if [ "$(uci -q get podkop_bot.settings.alert_notify || echo 1)" != "1" ]; then
        _sw_count=0; _sw_pending_to=""; _sw_old_disp=""
        return 0
    fi

    local _txt
    local _sw_old_esc _sw_to_esc
    _sw_old_esc=$(html_escape "$_sw_old_disp")
    _sw_to_esc=$(html_escape "$_sw_pending_to")
    if [ "$_sw_count" -eq 1 ]; then
        _txt=$(printf '🔀 <code>%s</code> → <code>%s</code> <i>(urltest)</i>'             "$_sw_old_esc" "$_sw_to_esc")
    else
        _txt=$(printf '🔀 <b>Proxy switched ×%d</b> in %dm
now: <code>%s</code> <i>(urltest)</i>'             "$_sw_count" "$(( (_now - _sw_first_ts) / 60 + 1 ))" "$_sw_to_esc")
    fi

    local _pl; _pl=$(jq -n -c --arg cid "$ADMIN_ID" --arg txt "$_txt"         '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
    send_health_alert "$_pl"
    _sw_count=0; _sw_pending_to=""; _sw_old_disp=""
}

# ==============================================================================
# DAILY REPORT
# ==============================================================================
# ==============================================================================
# WEEKLY REPORT
# ==============================================================================
send_weekly_report() {
    local _wr_lock="${BOT_DIR}/weekly_report.lock"
    mkdir "$_wr_lock" 2>/dev/null || return 0

    local _hn _model _model_short _now_str _week_start _sec
    _hn=$(cat /proc/sys/kernel/hostname 2>/dev/null | tr -d '\n' || echo "Router")
    _model=$(cat /tmp/sysinfo/model 2>/dev/null | tr -d '\n' || echo "")
    _model_short=$(printf '%s' "$_model" | sed 's/Xiaomi //; s/Redmi Router /Redmi /; s/ Router//; s/(OpenWrt[^)]*)//' | sed 's/[[:space:]]*$//')
    _now_str=$(date "+%d.%m.%Y, %H:%M")
    _week_start=$(awk "BEGIN{print strftime(\"%d.%m\", $(date +%s)-604800)}" 2>/dev/null || echo "?")
    _sec=$(get_active_section)

    # ── Версии и файлы ────────────────────────────────────────────────────────
    local _bot_ver _bot_mtime _bot_hash _init_mtime _p_ver _sb_ver
    _bot_ver="$BOT_VERSION"
    _bot_mtime=$(date -r "$BOT_PATH" "+%d.%m %H:%M" 2>/dev/null || echo "?")
    _bot_hash=$(sha256sum "$BOT_PATH" 2>/dev/null | awk '{print substr($1,1,8)}')
    _init_mtime=$(date -r /etc/init.d/podkop_bot "+%d.%m %H:%M" 2>/dev/null || echo "?")
    _p_ver=$(opkg info ${PODKOP_PKG} 2>/dev/null | grep '^Version:' | tail -1 | cut -d' ' -f2 | sed 's/^v//' | cut -d'-' -f1)
    [ -z "$_p_ver" ] && _p_ver=$(apk info ${PODKOP_PKG} 2>/dev/null | grep "^${PODKOP_PKG}" | head -1 | \
        awk '{print $1}' | sed "s/^${PODKOP_PKG}-//;s/^v//;s/-r[0-9]*$//" | cut -d'-' -f1)
    _p_ver=$(printf '%s' "${_p_ver:-?}" | sed 's/^v//')
    _sb_ver=$(get_singbox_version_display 2>/dev/null | sed 's/-extended.*$/-ext/' || echo "?")

    # ── Стабильность ─────────────────────────────────────────────────────────
    local _bot_uptime _bot_elapsed _sb_uptime _sb_restarts _today_log
    _bot_elapsed=$(( $(date +%s) - ${BOT_START_TIME:-$(date +%s)} ))
    _bot_uptime=$(awk -v s="$_bot_elapsed" 'BEGIN{
        d=int(s/86400);h=int((s%86400)/3600);m=int((s%3600)/60);
        if(d>0) printf "%dd %dh",d,h; else printf "%dh %dm",h,m}')
    local _sb_pid_rt; _sb_pid_rt=$(pgrep -f "sing-box run" 2>/dev/null | head -1)
    _sb_uptime="unknown"
    if [ -n "$_sb_pid_rt" ]; then
        local _tps _boot _sb_ticks _sb_elapsed
        _tps=$(getconf CLK_TCK 2>/dev/null || echo 100)
        _boot=$(awk '{print int($1)}' /proc/uptime)
        _sb_ticks=$(awk '{print $22}' /proc/"$_sb_pid_rt"/stat 2>/dev/null || echo 0)
        _sb_elapsed=$(( $(date +%s) - ( $(date +%s) - _boot + _sb_ticks / _tps ) ))
        _sb_uptime=$(awk -v s="$_sb_elapsed" 'BEGIN{
            d=int(s/86400);h=int((s%86400)/3600);m=int((s%3600)/60);
            if(d>0) printf "%dd %dh",d,h; else printf "%dh %dm",h,m}')
    fi
    _today_log=$(date "+%b %e" 2>/dev/null | sed 's/  / /')
    _sb_restarts=$(logread 2>/dev/null | grep "$_today_log" | \
        grep -c 'sing-box.*start\|Starting sing-box' 2>/dev/null || echo 0)
    case "$_sb_restarts" in ''|*[!0-9]*) _sb_restarts=0 ;; esac

    # Route switches за 7 дней из switch_log
    local _sw_week_count _sw_last_line _sw_last_ago _sw_last_method
    _sw_week_count=0
    if [ -f "$SWITCH_LOG" ]; then
        _sw_cutoff=$(( $(date +%s) - 604800 ))
        _sw_week_count=$(awk -F'|' -v c="$_sw_cutoff" '$1>=c{n++} END{print n+0}' "$SWITCH_LOG")
        _sw_last_line=$(tail -1 "$SWITCH_LOG" 2>/dev/null)
    fi
    local _sw_disp="нет данных"
    if [ -n "$_sw_last_line" ]; then
        local _sw_ts _sw_elapsed
        _sw_ts=$(printf '%s' "$_sw_last_line" | cut -d'|' -f1)
        _sw_method=$(printf '%s' "$_sw_last_line" | cut -d'|' -f2)
        _sw_elapsed=$(( $(date +%s) - ${_sw_ts:-0} ))
        _sw_ago=$(awk -v s="$_sw_elapsed" 'BEGIN{
            if(s<3600) printf "%dm назад",int(s/60);
            else if(s<86400) printf "%dh %dm назад",int(s/3600),int((s%3600)/60);
            else printf "%dd назад",int(s/86400)}')
        case "$_sw_method" in
            manual)  _sw_disp="✋ вручную · ${_sw_ago}" ;;
            urltest) _sw_disp="🤖 urltest · ${_sw_ago}" ;;
            *)       _sw_disp="$_sw_ago" ;;
        esac
    fi

    # TG статус
    local _tg_direct _tg_transport
    _tg_direct=$(grep "^tg_direct=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)
    _tg_transport=$(grep "^tg_transport=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)

    # ── Ресурсы: RAM ──────────────────────────────────────────────────────────
    local _ram_total _ram_avail _ram_used _ram_total_mb _ram_pct _ram_free_mb
    _ram_total=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 1)
    _ram_avail=$(awk '/MemAvailable/{print $2}' /proc/meminfo 2>/dev/null || echo 0)
    _ram_used=$(( (_ram_total - _ram_avail) / 1024 ))
    _ram_total_mb=$(( _ram_total / 1024 ))
    _ram_pct=$(awk "BEGIN{printf \"%d\", (${_ram_total}-${_ram_avail})*100/${_ram_total}}")
    _ram_free_mb=$(( _ram_avail / 1024 ))
    local _rw_min _rw_cnt
    _rw_min=$(awk -F'|' '{print $1}' "$RAM_WEEK_FILE" 2>/dev/null)
    _rw_cnt=$(awk -F'|' '{print $2}' "$RAM_WEEK_FILE" 2>/dev/null || echo 0)
    local _ram_min_disp=""
    [ -n "$_rw_min" ] && _ram_min_disp=$(printf '\nMin за неделю: <code>%s MB</code>%s' \
        "$_rw_min" "$([ "${_rw_min:-999}" -lt 30 ] 2>/dev/null && echo ' ⚠️' || true)")
    local _ram_alert_disp=""
    [ "${_rw_cnt:-0}" -gt 0 ] 2>/dev/null && _ram_alert_disp=$(printf '\nRAM-алертов: <code>%s</code>' "$_rw_cnt")
    # Reset weekly RAM stats after report
    rm -f "$RAM_WEEK_FILE" 2>/dev/null

    # ── Туннель ───────────────────────────────────────────────────────────────
    local _proxies _active_ob _active_ob_disp _active_delay _active_cc
    _proxies=$(clash_request "/proxies" 2>/dev/null)
    _active_ob=$(get_active_proxy_name "$_proxies" 2>/dev/null || echo "?")
    _active_ob_disp=$(display_proxy_name "$_active_ob" 2>/dev/null || echo "$_active_ob")
    _active_delay=$(printf '%s' "$_proxies" | jq -r \
        --arg n "$_active_ob" '.proxies[$n].history[-1].delay // 0' 2>/dev/null || echo "?")
    _active_cc=$(printf '%s' "$_proxies" | jq -r \
        --arg n "$_active_ob" '.proxies[$n].extra? // {} |
        to_entries[] | select(.key | test("flag|country|cc|emoji"; "i")) | .value' \
        2>/dev/null | head -1)
    if [ -z "$_active_cc" ]; then
        local _ob_ip; _ob_ip=$(printf '%s' "$_proxies" | jq -r \
            --arg n "$_active_ob" '.proxies[$n].server // ""' 2>/dev/null)
        [ -n "$_ob_ip" ] && _active_cc=$(get_country_flag "$_ob_ip" 2>/dev/null || echo "")
    fi

    # Режим и счётчик серверов
    local _sec_mode _sec_mode_disp _total_servers=""
    _sec_mode=$(get_section_type "$_sec" 2>/dev/null || echo "?")
    if [ "$PODKOP_VARIANT" = "plus" ] && section_is_subscription "$_sec" 2>/dev/null; then
        local _sub_cnt _ut_flag _total
        _sub_cnt=$(get_subscription_server_count "$_sec" 2>/dev/null || echo 0)
        _ut_flag=$(uci -q get ${PODKOP_UCI}.${_sec}.urltest_enabled 2>/dev/null)
        _total=$(printf '%s' "$_proxies" | jq -r --arg sel "$(get_selector_tag "$_proxies")" \
            '.proxies[$sel].all // [] | length' 2>/dev/null || echo 0)
        _manual=$(( ${_total:-0} - ${_sub_cnt:-0} ))
        [ "$_manual" -lt 0 ] && _manual=0
        [ "$_ut_flag" = "1" ] && _sec_mode_disp="URLTest" || _sec_mode_disp="Selector"
        if [ "${_total:-0}" -gt 0 ] 2>/dev/null; then
            [ "$_manual" -gt 0 ] && \
                _total_servers=" · ${_total} (${_sub_cnt} sub + ${_manual} manual)" || \
                _total_servers=" · ${_total} servers"
        fi
    else
        case "$_sec_mode" in
            proxy:urltest)  _sec_mode_disp="URLTest" ;;
            proxy:selector) _sec_mode_disp="Selector" ;;
            *)              _sec_mode_disp="$_sec_mode" ;;
        esac
    fi

    # ── Трафик: delta за неделю ───────────────────────────────────────────────
    local _conn_data _total_dl _total_ul _curr_conn _dl_fmt _ul_fmt
    _conn_data=$(clash_request "/connections" 2>/dev/null)
    _curr_conn=$(printf '%s' "$_conn_data" | jq -r '.connections | length // 0' 2>/dev/null || echo 0)
    _total_dl=$(printf '%s' "$_conn_data" | jq -r '.downloadTotal // 0' 2>/dev/null || echo 0)
    _total_ul=$(printf '%s' "$_conn_data" | jq -r '.uploadTotal // 0' 2>/dev/null || echo 0)
    case "$_total_dl" in ''|*[!0-9]*) _total_dl=0 ;; esac
    case "$_total_ul" in ''|*[!0-9]*) _total_ul=0 ;; esac

    # Weekly traffic delta
    local _week_dl _week_ul _dl_week_fmt _ul_week_fmt _avg_day_fmt _traffic_note=""
    local _base_ts _base_dl _base_ul
    _base_ts=$(awk -F'|' '{print $1}' "$WEEKLY_TRAFFIC_BASE" 2>/dev/null || echo 0)
    _base_dl=$(awk -F'|' '{print $2}' "$WEEKLY_TRAFFIC_BASE" 2>/dev/null || echo 0)
    _base_ul=$(awk -F'|' '{print $3}' "$WEEKLY_TRAFFIC_BASE" 2>/dev/null || echo 0)
    case "$_base_dl" in ''|*[!0-9]*) _base_dl=0 ;; esac
    case "$_base_ul" in ''|*[!0-9]*) _base_ul=0 ;; esac

    if [ "${_base_ts:-0}" -gt 0 ] 2>/dev/null && [ "$_total_dl" -ge "$_base_dl" ] 2>/dev/null; then
        _week_dl=$(( _total_dl - _base_dl ))
        _week_ul=$(( _total_ul - _base_ul ))
        _days=$(awk -v ts="$_base_ts" "BEGIN{d=($(date +%s)-ts)/86400; printf \"%d\", d>0?d:1}")
        _dl_week_fmt=$(awk "BEGIN{b=${_week_dl};if(b>=1073741824)printf \"%.1f GB\",b/1073741824;
            else if(b>=1048576)printf \"%.1f MB\",b/1048576;else printf \"%.0f KB\",b/1024}")
        _ul_week_fmt=$(awk "BEGIN{b=${_week_ul};if(b>=1073741824)printf \"%.1f GB\",b/1073741824;
            else if(b>=1048576)printf \"%.1f MB\",b/1048576;else printf \"%.0f KB\",b/1024}")
        _avg_dl=$(( _week_dl / _days ))
        _avg_day_fmt=$(awk "BEGIN{b=${_avg_dl};if(b>=1073741824)printf \"%.1f GB\",b/1073741824;
            else if(b>=1048576)printf \"%.1f MB\",b/1048576;else printf \"%.0f KB\",b/1024}")
        [ "$_sb_restarts" -gt 0 ] && _traffic_note=" <i>(частичные данные — были рестарты sing-box)</i>"
    else
        _dl_week_fmt="н/д"
        _ul_week_fmt="н/д"
        _avg_day_fmt="н/д"
        _traffic_note=" <i>(первая неделя — baseline установлен)</i>"
    fi
    # Save baseline if Clash API returned a valid JSON object (even if counters are 0)
    if printf '%s' "$_conn_data" | jq -e 'has("downloadTotal") and has("uploadTotal")' >/dev/null 2>&1; then
        printf '%s|%s|%s\n' "$(date +%s)" "$_total_dl" "$_total_ul" > "$WEEKLY_TRAFFIC_BASE" 2>/dev/null
    fi

    _dl_fmt=$(awk "BEGIN{b=${_total_dl};if(b>=1073741824)printf \"%.1f GB\",b/1073741824;
        else if(b>=1048576)printf \"%.1f MB\",b/1048576;else printf \"%.0f KB\",b/1024}")
    _ul_fmt=$(awk "BEGIN{b=${_total_ul};if(b>=1073741824)printf \"%.1f GB\",b/1073741824;
        else if(b>=1048576)printf \"%.1f MB\",b/1048576;else printf \"%.0f KB\",b/1024}")

    # ── Подписка Plus ─────────────────────────────────────────────────────────
    local _sub_block=""
    if [ "$PODKOP_VARIANT" = "plus" ] && section_is_subscription "$_sec" 2>/dev/null; then
        # Use _plus_sub_metadata (reads section-cache, no CLI spawn)
        local _smj; _smj=$(_plus_sub_metadata "$_sec" 2>/dev/null)
        local _sub_meta_str; _sub_meta_str=$(_plus_format_sub_meta "$_smj")
        local _sub_warn=""
        if [ -n "$_smj" ] && [ "$_smj" != "null" ]; then
            # expire_days from epoch timestamp
            local _exp_ts _sub_exp_days
            _exp_ts=$(printf '%s' "$_smj" | jq -r '.[0].expire // 0' 2>/dev/null || echo 0)
            if [ "${_exp_ts:-0}" -gt 0 ] 2>/dev/null; then
                _sub_exp_days=$(( (_exp_ts - $(date +%s)) / 86400 ))
                [ "$_sub_exp_days" -lt 7 ] 2>/dev/null && \
                    _sub_warn=" ⚠️ <b>Истекает через ${_sub_exp_days} дн.!</b>"
            fi
            # traffic_pct from used/total
            local _tr_used _tr_total _sub_pct
            _tr_used=$(printf '%s' "$_smj" | jq -r '.[0].traffic.used // 0' 2>/dev/null || echo 0)
            _tr_total=$(printf '%s' "$_smj" | jq -r '.[0].traffic.total // 0' 2>/dev/null || echo 0)
            if [ "${_tr_total:-0}" -gt 0 ] 2>/dev/null; then
                _sub_pct=$(awk -v u="$_tr_used" -v t="$_tr_total" 'BEGIN{printf "%d", (u*100)/t}')
                [ "${_sub_pct:-0}" -ge 80 ] 2>/dev/null && \
                    _sub_warn="${_sub_warn} ⚠️ <b>Трафик ${_sub_pct}%</b>"
            fi
        fi
        [ -n "$_sub_meta_str" ] && _sub_block="$(printf '\n\n📡 <b>Подписка</b>\n📊 %s%s' \
            "$_sub_meta_str" "${_sub_warn:-}")"
    fi

    # ── Bot config snapshot ───────────────────────────────────────────────────
    local _hi _qh_en _qh_fr _qh_to _bc _ram_al _dr_en _cur_tier
    _hi=$(uci -q get podkop_bot.settings.health_interval || echo 60)
    _qh_en=$(uci -q get podkop_bot.settings.quiet_hours_enabled || echo 0)
    _qh_fr=$(uci -q get podkop_bot.settings.quiet_hours_from || echo "23:00")
    _qh_to=$(uci -q get podkop_bot.settings.quiet_hours_to || echo "07:00")
    _bc=$(uci -q get podkop_bot.settings.broadcast_alerts || echo 0)
    _ram_al=$(uci -q get podkop_bot.settings.ram_alert || echo 1)
    _dr_en=$(uci -q get podkop_bot.settings.daily_report || echo 0)
    _cur_tier=$(cat "$MAIN_ROUTE_FILE" 2>/dev/null | tr -d '\n' | \
        sed 's#://\([^:/@]*\):[^@]*@#://\1:**@#g' || echo "?")
    local _qh_disp
    [ "$_qh_en" = "1" ] && _qh_disp="${_qh_fr}–${_qh_to}" || _qh_disp="off"

    # ── Сборка ───────────────────────────────────────────────────────────────
    local _header
    _header="$(html_escape "$_hn")"
    [ -n "$_model_short" ] && _header="${_header} · $(html_escape "$_model_short")"

    local _ob_disp="?"
    if [ -n "$_active_ob" ] && [ "$_active_ob" != "?" ]; then
        _ob_disp="▶ ${_active_cc:+${_active_cc} }$(html_escape "${_active_ob_disp:-$_active_ob}")${_active_delay:+ · ${_active_delay} ms}"
    fi

    local _tg_direct_icon; [ "$_tg_direct" = "ok" ] && _tg_direct_icon="✅" || _tg_direct_icon="❌"
    local _tg_tunnel_icon; [ "$_tg_transport" = "ok" ] && _tg_tunnel_icon="✅" || _tg_tunnel_icon="❌"

    local _text
    _text="$(printf '🗓 <b>Weekly Report</b>\n<b>%s</b>\n%s–%s\n<code>────────────────────</code>' \
        "$_header" "$_week_start" "$_now_str")"

    _text="${_text}$(printf '\n\n🧩 <b>Версии</b>\nBot: <code>v%s</code> · %s · <code>%s</code>\nInit.d: %s\n%s v%s · Sing-box <code>%s</code>' \
        "$_bot_ver" "$_bot_mtime" "${_bot_hash:-?}" \
        "${_init_mtime}" \
        "$PODKOP_DISPLAY_NAME" "$(html_escape "${_p_ver:-?}")" "$(html_escape "$_sb_ver")")"

    _text="${_text}$(printf '\n\n🩺 <b>Стабильность</b>\nBot uptime: <code>%s</code>\nTunnel uptime: <code>%s</code>\nsing-box restarts (сегодня): <code>%s</code>\nRoute switches (неделя): <code>%s</code>\nПоследний switch: %s\nTG: direct %s · tunnel %s' \
        "$_bot_uptime" "$_sb_uptime" "$_sb_restarts" "$_sw_week_count" \
        "$_sw_disp" "$_tg_direct_icon" "$_tg_tunnel_icon")"

    _text="${_text}$(printf '\n\n💾 <b>Ресурсы</b>\nRAM: <code>%s / %s MB (%s%%)</code>%s%s' \
        "$_ram_used" "$_ram_total_mb" "$_ram_pct" \
        "${_ram_min_disp}" "${_ram_alert_disp}")"

    _text="${_text}$(printf '\n\n🔀 <b>Туннель</b>\nРежим: <code>%s</code> [<code>%s</code>]%s\nActive: %s' \
        "$_sec_mode_disp" "$(html_escape "$_sec")" "$_total_servers" "$_ob_disp")"

    _text="${_text}$(printf '\n\n📊 <b>Трафик</b>%s\nНеделя: ↓ <code>%s</code> · ↑ <code>%s</code>\nСред/день: ↓ <code>%s</code>\nСоединений: <code>%s</code>' \
        "$_traffic_note" "$_dl_week_fmt" "$_ul_week_fmt" "$_avg_day_fmt" "$_curr_conn")"

    [ -n "$_sub_block" ] && _text="${_text}${_sub_block}"

    _text="${_text}$(printf '\n\n⚙️ <b>Bot config</b>\nRoute: <code>%s</code>\nHealth interval: <code>%ss</code>\nQuiet hours: <code>%s</code>\nBroadcast alerts: <code>%s</code> · RAM alert: <code>%s</code>\nDaily report: <code>%s</code>' \
        "$(html_escape "$_cur_tier")" "$_hi" "$_qh_disp" \
        "$([ "$_bc" = "1" ] && echo "on" || echo "off")" \
        "$([ "$_ram_al" = "1" ] && echo "on" || echo "off")" \
        "$([ "$_dr_en" = "1" ] && echo "on" || echo "off")")"

    # Save last sent timestamp
    printf '%s\n' "$(date +%s)" > "$WEEKLY_REPORT_LAST" 2>/dev/null

    send_to_all_admins "$_text" \
        "{\"inline_keyboard\":[[{\"text\":\"📊 Status\",\"callback_data\":\"cmd_status\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
    rmdir "$_wr_lock" 2>/dev/null
}

send_daily_report() {
    # Single-instance lock — prevents overlap between scheduled and manual send
    local _dr_lock="${BOT_DIR}/daily_report.lock"
    mkdir "$_dr_lock" 2>/dev/null || return 0

    # ── Шапка ────────────────────────────────────────────────────────────────
    local _hn _model _model_short _now_str _sec
    _hn=$(cat /proc/sys/kernel/hostname 2>/dev/null | tr -d '\n' || echo "Router")
    _model=$(cat /tmp/sysinfo/model 2>/dev/null | tr -d '\n' || echo "")
    # Shorten model: strip vendor prefix and "Router" word
    _model_short=$(printf '%s' "$_model" | sed 's/Xiaomi //; s/Redmi Router /Redmi /; s/ Router//; s/(OpenWrt[^)]*)//')
    _model_short=$(printf '%s' "$_model_short" | sed 's/[[:space:]]*$//')
    _now_str=$(date "+%d %B %Y, %H:%M")
    _sec=$(get_active_section)

    # ── Система ──────────────────────────────────────────────────────────────
    local _uptime_str _loadavg _ram_total _ram_avail _ram_used _ram_total_mb _ram_pct
    _uptime_str=$(awk '{d=int($1/86400);h=int(($1%86400)/3600);m=int(($1%3600)/60);
        if(d>0) printf "%dd %dh %dm",d,h,m; else printf "%dh %dm",h,m}' /proc/uptime)
    _loadavg=$(awk '{printf "%s %s %s",$1,$2,$3}' /proc/loadavg)
    _ram_total=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 1)
    _ram_avail=$(awk '/MemAvailable/{print $2}' /proc/meminfo 2>/dev/null || echo 0)
    _ram_used=$(( (_ram_total - _ram_avail) / 1024 ))
    _ram_total_mb=$(( _ram_total / 1024 ))
    _ram_pct=$(awk "BEGIN{printf \"%d\", (${_ram_total}-${_ram_avail})*100/${_ram_total}}")

    # ── Сеть — из кешей/UCI ───────────────────────────────────────────────────
    local _wan_ip _lan_ip _exit_ip _exit_cc _extra_ifs
    _wan_ip=$(ip -4 route get 1.1.1.1 2>/dev/null \
        | awk '/src/{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
    [ -z "$_wan_ip" ] && _wan_ip=$(uci -q get network.wan.ipaddr 2>/dev/null || echo "?")
    _lan_ip=$(uci -q get network.lan.ipaddr 2>/dev/null || echo "?")
    _exit_ip=$(sed -n '2p' "$PUBIP_CACHE" 2>/dev/null || echo "?")
    _exit_cc=$(get_country_flag "$_exit_ip" 2>/dev/null || echo "")
    # TG статус из SOCKS_STATE_FILE — без новых curl-запросов
    local _tg_direct _tg_transport
    _tg_direct=$(grep "^tg_direct=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)
    _tg_transport=$(grep "^tg_transport=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)
    # TG одной строкой
    local _tg_direct_icon _tg_tunnel_icon
    [ "$_tg_direct" = "ok" ] && _tg_direct_icon="✅" || _tg_direct_icon="❌"
    [ "$_tg_transport" = "ok" ] && _tg_tunnel_icon="✅" || _tg_tunnel_icon="❌"
    # Виртуальные адаптеры
    _extra_ifs=$(ip -4 addr show 2>/dev/null | awk '/inet / {
        iface=$NF; sub(/@.*/, "", iface);
        if(iface ~ /^(tun|tail|awg|wg|zt|zero)/) {
            ip=$2; sub(/\/.*/, "", ip);
            if      (iface ~ /^tail/) label="Tailscale"
            else if (iface ~ /^zt/)   label="ZeroTier"
            else if (iface ~ /^awg/)  label="AmneziaWG"
            else if (iface ~ /^wg/)   label="WireGuard"
            else if (iface ~ /^tun/)  label="VPN"
            else                      label=iface
            printf "%s (%s): %s\n", label, iface, ip
        }
    }')

    # ── Туннель ───────────────────────────────────────────────────────────────
    local _proxies _active_ob _active_ob_disp _active_delay _active_cc _p_ver _sb_ver
    _proxies=$(clash_request "/proxies" 2>/dev/null)
    _active_ob=$(get_active_proxy_name "$_proxies" 2>/dev/null || echo "?")
    _active_ob_disp=$(display_proxy_name "$_active_ob" 2>/dev/null || echo "$_active_ob")
    _active_delay=$(printf '%s' "$_proxies" | jq -r \
        --arg n "$_active_ob" '.proxies[$n].history[-1].delay // 0' 2>/dev/null || echo "?")
    _active_cc=$(printf '%s' "$_proxies" | jq -r \
        --arg n "$_active_ob" '.proxies[$n].extra? // {} |
        to_entries[] | select(.key | test("flag|country|cc|emoji"; "i")) | .value' \
        2>/dev/null | head -1)
    if [ -z "$_active_cc" ]; then
        local _ob_ip
        _ob_ip=$(printf '%s' "$_proxies" | jq -r \
            --arg n "$_active_ob" '.proxies[$n].server // ""' 2>/dev/null)
        [ -n "$_ob_ip" ] && _active_cc=$(get_country_flag "$_ob_ip" 2>/dev/null || echo "")
    fi
    # Last switch
    local _switch_ts="" _switch_method="" _switch_disp=""
    local _switch_line; _switch_line=$(cat "${BOT_DIR}/last_switch" 2>/dev/null | head -1)
    if [ -n "$_switch_line" ]; then
        _switch_ts=$(printf '%s' "$_switch_line" | cut -d'|' -f1)
        _switch_method=$(printf '%s' "$_switch_line" | cut -d'|' -f2)
        case "$_switch_ts" in ''|*[!0-9]*) _switch_ts="" ;; esac
        local _sw_elapsed
        _sw_elapsed=$(( $(date +%s) - ${_switch_ts:-0} ))
        local _sw_ago
        if [ "$_sw_elapsed" -lt 3600 ]; then
            _sw_ago=$(awk -v s="$_sw_elapsed" 'BEGIN{printf "%dm назад", int(s/60)}')
        elif [ "$_sw_elapsed" -lt 86400 ]; then
            _sw_ago=$(awk -v s="$_sw_elapsed" 'BEGIN{printf "%dh %dm назад", int(s/3600), int((s%3600)/60)}')
        else
            _sw_ago=$(awk -v s="$_sw_elapsed" 'BEGIN{printf "%dd назад", int(s/86400)}')
        fi
        case "$_switch_method" in
            manual)  _switch_disp=" · ✋ вручную ${_sw_ago}" ;;
            urltest) _switch_disp=" · 🤖 urltest ${_sw_ago}" ;;
        esac
    fi
    # Версии
    # Режим секции
    local _sec_mode _sec_mode_disp
    _sec_mode=$(get_section_type "$_sec" 2>/dev/null || echo "?")
    if [ "$PODKOP_VARIANT" = "plus" ] && section_is_subscription "$_sec" 2>/dev/null; then
        # For Plus subscription: show mode + server count
        local _sec_count _ut_flag
        _sec_count=$(get_subscription_server_count "$_sec" 2>/dev/null || echo "?")
        _ut_flag=$(uci -q get ${PODKOP_UCI}.${_sec}.urltest_enabled 2>/dev/null)
        if [ "$_ut_flag" = "1" ]; then
            _sec_mode_disp="URLTest · ${_sec_count} servers"
        else
            _sec_mode_disp="Selector · ${_sec_count} servers"
        fi
    else
        case "$_sec_mode" in
            proxy:urltest)      _sec_mode_disp="URLTest" ;;
            proxy:selector)     _sec_mode_disp="Selector" ;;
            proxy:subscription) _sec_mode_disp="Subscription" ;;
            proxy:url)          _sec_mode_disp="Single URL" ;;
            proxy:selector_text) _sec_mode_disp="Selector (text) — edit in LuCI" ;;
            proxy:urltest_text)  _sec_mode_disp="URLTest (text) — edit in LuCI" ;;
            vpn:*)              _sec_mode_disp="VPN" ;;
            *)                  _sec_mode_disp="$_sec_mode" ;;
        esac
    fi
    # Plus: subscription is a source, not a mode — show both axes (e.g. "Subscription · URLTest")
    if [ "$PODKOP_VARIANT" = "plus" ] && section_is_subscription "$_sec"; then
        local _smode_ut; _smode_ut=$(uci -q get ${PODKOP_UCI}.${_sec}.urltest_enabled 2>/dev/null)
        if [ "$_smode_ut" = "1" ]; then
            _sec_mode_disp="Subscription · URLTest"
        else
            _sec_mode_disp="Subscription · Selector"
        fi
    fi
    _p_ver=$(opkg info ${PODKOP_PKG} 2>/dev/null | grep '^Version:' | tail -1 | cut -d' ' -f2 | sed 's/^v//' | cut -d'-' -f1)
    [ -z "$_p_ver" ] && _p_ver=$(apk info ${PODKOP_PKG} 2>/dev/null | grep "^${PODKOP_PKG}" | head -1 | \
        awk '{print $1}' | sed "s/^${PODKOP_PKG}-//;s/^v//;s/-r[0-9]*$//" | cut -d'-' -f1)
    # Grep fallback: shell-script forks only. grep -m1 stops at first match,
    # reads only a few KB, does NOT execute the binary. Safe on AX3000T.
    if [ -z "$_p_ver" ] && [ -f "$PODKOP_BIN" ]; then
        _p_ver=$(grep -m1 -oE 'VERSION="[^"]*"' "$PODKOP_BIN" 2>/dev/null \
            | cut -d'"' -f2 | sed 's/^v//')
        [ -z "$_p_ver" ] && _p_ver=$(grep -m1 "^VERSION=" "$PODKOP_BIN" 2>/dev/null \
            | cut -d= -f2 | tr -d "'\042" | sed 's/^v//')
    fi
    _p_ver=$(printf '%s' "${_p_ver:-?}" | sed 's/^v//')  # safety strip
    _sb_ver=$(get_singbox_version_display 2>/dev/null | sed 's/-extended.*$/-ext/' || echo "?")
    # Рестарты sing-box за сутки
    local _sb_restarts _today_log
    _today_log=$(date "+%b %e" 2>/dev/null | sed 's/  / /')
    _sb_restarts=$(logread 2>/dev/null | grep "$_today_log" | \
        grep -c 'sing-box.*start\|starting sing-box\|Starting sing-box' 2>/dev/null || echo 0)
    case "$_sb_restarts" in ''|*[!0-9]*) _sb_restarts=0 ;; esac

    # ── Трафик ───────────────────────────────────────────────────────────────
    local _conn_data _total_dl _total_ul _curr_conn _dl_fmt _ul_fmt _sb_since=""
    _conn_data=$(clash_request "/connections" 2>/dev/null)
    _curr_conn=$(printf '%s' "$_conn_data" | jq -r '.connections | length // 0' 2>/dev/null || echo 0)
    _total_dl=$(printf '%s' "$_conn_data" | jq -r '.downloadTotal // 0' 2>/dev/null || echo 0)
    _total_ul=$(printf '%s' "$_conn_data" | jq -r '.uploadTotal // 0' 2>/dev/null || echo 0)
    case "$_curr_conn" in ''|*[!0-9]*) _curr_conn=0 ;; esac
    case "$_total_dl"  in ''|*[!0-9]*) _total_dl=0  ;; esac
    case "$_total_ul"  in ''|*[!0-9]*) _total_ul=0  ;; esac
    _dl_fmt=$(awk "BEGIN{b=${_total_dl};if(b>=1073741824)printf \"%.1f GB\",b/1073741824;\
        else if(b>=1048576)printf \"%.1f MB\",b/1048576;else printf \"%.0f KB\",b/1024}")
    _ul_fmt=$(awk "BEGIN{b=${_total_ul};if(b>=1073741824)printf \"%.1f GB\",b/1073741824;\
        else if(b>=1048576)printf \"%.1f MB\",b/1048576;else printf \"%.0f KB\",b/1024}")
    # Период: uptime sing-box
    local _sb_pid_rt; _sb_pid_rt=$(pgrep -f "sing-box run" 2>/dev/null | head -1)
    if [ -n "$_sb_pid_rt" ]; then
        local _tps _boot _sb_ticks _sb_start_ts _sb_elapsed
        _tps=$(getconf CLK_TCK 2>/dev/null || echo 100)
        _boot=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)
        _sb_ticks=$(awk '{print $22}' /proc/"$_sb_pid_rt"/stat 2>/dev/null || echo 0)
        _sb_start_ts=$(( $(date +%s) - _boot + _sb_ticks / _tps ))
        _sb_elapsed=$(( $(date +%s) - _sb_start_ts ))
        if [ "$_sb_elapsed" -gt 0 ]; then
            if [ "$_sb_elapsed" -lt 3600 ]; then
                _sb_since=$(awk -v s="$_sb_elapsed" 'BEGIN{printf "%dm", int(s/60)}')
            elif [ "$_sb_elapsed" -lt 86400 ]; then
                _sb_since=$(awk -v s="$_sb_elapsed" 'BEGIN{printf "%dh %dm", int(s/3600), int((s%3600)/60)}')
            else
                _sb_since=$(awk -v s="$_sb_elapsed" 'BEGIN{printf "%dd %dh", int(s/86400), int((s%86400)/3600)}')
            fi
        fi
    fi

    # ── Транспорт бота ────────────────────────────────────────────────────────
    local _cur_tier _tier_chain=""
    _cur_tier=$(cat "$MAIN_ROUTE_FILE" 2>/dev/null | tr -d '\n' || echo "?")
    # Mask credentials in route string (e.g. socks5h://user:pass@host)
    _cur_tier=$(printf '%s' "$_cur_tier" | sed 's#://\([^:/@]*\):[^@]*@#://\1:**@#g')
    # Резервные каналы из probe file
    while IFS='=' read -r _tier_name _tier_val; do
        [ -z "$_tier_name" ] && continue
        local _tier_ms; _tier_ms=$(printf '%s' "$_tier_val" | awk '{print $1}')
        case "$_tier_ms" in
            timeout|fail|"") _tier_ms="${_tier_ms:-?}" ;;
            *ms) : ;;
            *[0-9]) _tier_ms="${_tier_ms}ms" ;;
        esac
        case "$_tier_name" in
            tier2_*) _tier_chain="${_tier_chain}   Резерв ${_tier_name#tier2_}: <code>${_tier_ms}</code>\n" ;;
            tier3)   _tier_chain="${_tier_chain}   Custom: <code>${_tier_ms}</code>\n" ;;
        esac
    done < "$SOCKS_PROBE_FILE" 2>/dev/null

    # ── Подписка Plus ─────────────────────────────────────────────────────────
    local _sub_block=""
    if [ "$PODKOP_VARIANT" = "plus" ] && section_is_subscription "$_sec"; then
        local _sub_urls _sub_url_disp=""
        _sub_urls=$(get_subscription_urls "$_sec" 2>/dev/null | head -1)
        if [ -n "$_sub_urls" ]; then
            # Strip secret params and credentials
            _sub_url_disp=$(printf '%s' "$_sub_urls" | \
                sed 's/[?&]\(token\|key\|pass\|secret\|auth\|password\|access\)[^&]*/…/g' | \
                sed 's/:[^:@]*@/:**@/')
            _sub_url_disp=$(html_escape "$_sub_url_disp")
        fi
        # Use file-first metadata (no binary spawn), CLI fallback inside helper
        local _sub_meta_str=""
        if [ "$PODKOP_VARIANT" = "plus" ]; then
            local _smj; _smj=$(_plus_sub_metadata "$_sec" 2>/dev/null)
            [ -n "$_smj" ] && _sub_meta_str=$(_plus_format_sub_meta "$_smj")
        fi
        if [ -n "$_sub_url_disp" ] || [ -n "$_sub_meta_str" ]; then
            _sub_block="$(printf '\n\n📋 <b>Подписка</b>')"
            [ -n "$_sub_url_disp" ] && _sub_block="${_sub_block}$(printf '\n<code>%s</code>' "$_sub_url_disp")"
            [ -n "$_sub_meta_str" ] && _sub_block="${_sub_block}$(printf '\n📊 %s' "$_sub_meta_str")"
        fi
    fi

    # ── Сборка ───────────────────────────────────────────────────────────────
    local _header
    _header="$(html_escape "$_hn")"
    [ -n "$_model_short" ] && _header="${_header} · $(html_escape "$_model_short")"

    local _ob_disp="?"
    if [ -n "$_active_ob" ] && [ "$_active_ob" != "?" ]; then
        local _ob_human; _ob_human=$(html_escape "${_active_ob_disp:-$_active_ob}")
        _ob_disp="▶ ${_active_cc:+${_active_cc} }${_ob_human}${_active_delay:+ · ${_active_delay} ms}"
    fi

    local _text
    _text="$(printf '%s <b>Ежедневный отчёт</b>\n<b>%s</b>\n%s\n<code>────────────────────</code>' \
        "$E_SCAN" "$_header" "$_now_str")"

    _text="${_text}$(printf '\n\n🖥 <b>Система</b>\nUptime: <code>%s</code> · Load: <code>%s</code>\nRAM: <code>%s / %s MB (%s%%)</code>' \
        "$_uptime_str" "$_loadavg" "$_ram_used" "$_ram_total_mb" "$_ram_pct")"

    _text="${_text}$(printf '\n\n🌐 <b>Сеть</b>\nWAN: <code>%s</code> · LAN: <code>%s</code>\nВнешний IP: <code>%s</code> %s\nTG direct: %s · TG tunnel: %s' \
        "$(html_escape "$_wan_ip")" "$(html_escape "$_lan_ip")" \
        "$(html_escape "$_exit_ip")" "$_exit_cc" \
        "${_tg_direct_icon} $([ "$_tg_direct" = "ok" ] && echo "доступен" || echo "заблокирован (ISP)")" \
        "${_tg_tunnel_icon} $([ "$_tg_transport" = "ok" ] && echo "работает" || echo "недоступен")")"

    [ -n "$_extra_ifs" ] && _text="${_text}$(printf '%s' "$_extra_ifs" | \
        while IFS= read -r _if_line; do
            [ -n "$_if_line" ] && printf '\n   🔗 %s' "$(html_escape "$_if_line")"
        done)"

    _text="${_text}$(printf '\n\n🔀 <b>Туннель</b>\n%s v%s · Sing-box %s\nРежим: <code>%s</code> [<code>%s</code>]\nOutbound: %s%s\nРестартов sing-box: <code>%s</code>' \
        "$PODKOP_DISPLAY_NAME" "$(html_escape "${_p_ver:-?}")" \
        "$(html_escape "$_sb_ver")" "$_sec_mode_disp" "$(html_escape "$_sec")" \
        "$_ob_disp" "$_switch_disp" "$_sb_restarts")"

    _text="${_text}$(printf '\n\n📊 <b>Трафик</b>%s\n↓ <code>%s</code> · ↑ <code>%s</code> · Conn: <code>%s</code>' \
        "${_sb_since:+ (за ${_sb_since})}" "$_dl_fmt" "$_ul_fmt" "$_curr_conn")"

    _text="${_text}$(printf '\n\n🤖 <b>Транспорт бота</b>\nRoute: <code>%s</code>' \
        "$(html_escape "$_cur_tier")")"
    [ -n "$_tier_chain" ] && _text="${_text}$(printf '\n%b' "$_tier_chain")"

    [ -n "$_sub_block" ] && _text="${_text}${_sub_block}"

    send_to_all_admins "$_text" \
        "{\"inline_keyboard\":[[{\"text\":\"📊 Status\",\"callback_data\":\"cmd_status\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
    rmdir "$_dr_lock" 2>/dev/null
}


start_health_daemon() {
    kill "$HEALTH_PID" 2>/dev/null
    (
        trap 'exit' INT TERM QUIT

        local interval
        local last_tg_state="unknown"  curr_tg_state
        local tg_fail_streak=0         tg_ok_streak=0
        local last_sb_state="running"  curr_sb_state sb_alert_txt new_pid
        local last_socks_state=""      curr_socks_state socks_alert_txt
        local socks_fail_streak=0      socks_ok_streak=0
        local sec m_ip m_port admin_payload last_ok_route="tier1"
        # Latency probe runs every PROBE_EVERY cycles (not every cycle — heavier)
        local probe_cycle=0 PROBE_EVERY=5
        local _ram_alert_sent=0  # epoch of last low-RAM alert (hysteresis)
        local _ram_alert_active=0  # 1 = currently in low-RAM state
        # Track probe background PID to reap it before launching next one.
        # Without this, probe subshells accumulate as zombies over months of uptime
        # (one probe every ~5min = ~8640/month, each leaving an ash zombie entry).
        local _last_probe_pid=""
        # Read hostname once for alert prefixes (multi-router identification)
        local _hn; _hn=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo "Router")
        # Leaf proxy tracking — alert when active proxy changes
        local last_leaf="" curr_leaf=""
        # raw_choice = Clash API .now field — changes only on manual selection
        local last_raw_choice="" curr_raw_choice=""
        # Debounce: don't send leaf-change alerts more often than once per 60s
        local last_leaf_alert_ts=0
        # Auto-switch debounce: batch rapid URLTest flapping into one summary
        local _sw_count=0 _sw_first_ts=0 _sw_pending_to="" _sw_old_disp=""
        local _SW_WINDOW=120   # seconds: batch switches within this window
        # Track tier1 SOCKS state separately from effective transport state.
        # Allows alerting when tier1 goes down even if tier2 keeps bot reachable.
        local last_tier1_state="up"
        local _recovery_ts=0  # timestamp of last "Primary SOCKS recovered" alert
        # Track bot route degradation (tier4/tier5) for alert on degrade/recover.
        local last_bot_route_degraded=0

        local _dr_last_date=""
        local _wr_last_date=""
        while true; do
            interval=$(uci -q get podkop_bot.settings.health_interval || echo "60")
            sleep "$interval"

            # Daily report: fire once per day at configured time
            if [ "$(uci -q get podkop_bot.settings.daily_report || echo 0)" = "1" ]; then
                local _dr_time _dr_now_hm _dr_today
                _dr_time=$(uci -q get podkop_bot.settings.daily_report_time || echo "08:00")
                _dr_today=$(date "+%Y-%m-%d")
                _dr_now_num=$(date "+%H%M")
                _dr_target_num=$(printf '%s' "$_dr_time" | tr -d ':')
                case "$_dr_target_num" in ''|*[!0-9]*) _dr_target_num="0800" ;; esac
                # Skip daily report on weekly report day — weekly covers the day
                _wr_day_chk=$(uci -q get podkop_bot.settings.weekly_report_day || echo "7")
                _wr_en_chk=$(uci -q get podkop_bot.settings.weekly_report || echo "0")
                _today_dow=$(date "+%u")
                _skip_daily=0
                [ "$_wr_en_chk" = "1" ] && [ "$_today_dow" = "$_wr_day_chk" ] && _skip_daily=1
                if [ "$_dr_now_num" -ge "$_dr_target_num" ] && [ "$_dr_today" != "$_dr_last_date" ] && [ "$_skip_daily" = "0" ]; then
                    _dr_last_date="$_dr_today"
                    send_daily_report &
                fi
            fi


            # Weekly report: fire once per week on configured day (ISO: 1=Mon…7=Sun)
            if [ "$(uci -q get podkop_bot.settings.weekly_report || echo 0)" = "1" ]; then
                local _wr_day _wr_time_cfg _wr_today _wr_dow _wr_now_num _wr_target_num
                _wr_day=$(uci -q get podkop_bot.settings.weekly_report_day || echo "7")
                _wr_time_cfg=$(uci -q get podkop_bot.settings.weekly_report_time || echo "09:00")
                _wr_today=$(date "+%Y-%m-%d")
                _wr_dow=$(date "+%u")
                _wr_now_num=$(date "+%H%M")
                _wr_target_num=$(printf '%s' "$_wr_time_cfg" | tr -d ':')
                case "$_wr_target_num" in ''|*[!0-9]*) _wr_target_num="0900" ;; esac
                # Also check persistent file to survive bot restarts
                _wr_last_ts=$(awk 'NR==1{print $1+0}' "$WEEKLY_REPORT_LAST" 2>/dev/null || echo 0)
                _wr_last_persistent=$(awk -v ts="$_wr_last_ts" \
                    'BEGIN{if(ts>0) print strftime("%Y-%m-%d",ts); else print ""}' 2>/dev/null || echo "")
                [ -n "$_wr_last_persistent" ] && _wr_last_date="$_wr_last_persistent"
                if [ "$_wr_dow" = "$_wr_day" ] && \
                   [ "$_wr_now_num" -ge "$_wr_target_num" ] && \
                   [ "$_wr_today" != "$_wr_last_date" ]; then
                    _wr_last_date="$_wr_today"
                    send_weekly_report &
                fi
            fi

            probe_cycle=$((probe_cycle + 1))
            if [ "$probe_cycle" -ge "$PROBE_EVERY" ]; then
                probe_cycle=0
                # Summary log every PROBE_EVERY cycles instead of per-cycle ok spam
                _wd_log_route=$(cat "$MAIN_ROUTE_FILE" 2>/dev/null | tr -d '\n' || echo "unknown")
                logger -t podkop-bot "[Health] System OK | SOCKS: ${last_socks_state:-?} | sing-box: ${last_sb_state:-?} | Route: ${_wd_log_route}"
                # Reap previous probe subshell before launching a new one.
                # In BusyBox ash, background children become zombies until the parent
                # calls wait. Over months of uptime these accumulate (one per 5min cycle).
                # FIXED: never use blocking wait — if the child is stuck in D-state
                # (blocked I/O on tmpfs), wait blocks the entire health daemon forever.
                # Instead: if it is still alive, kill it; then reap non-blocking.
                if [ -n "$_last_probe_pid" ]; then
                    if kill -0 "$_last_probe_pid" 2>/dev/null; then
                        kill "$_last_probe_pid" 2>/dev/null
                    fi
                    wait "$_last_probe_pid" 2>/dev/null || true
                fi
                probe_all_socks_write &
                _last_probe_pid=$!

                # ── RAM low-memory alert (every 5 cycles = PROBE_EVERY×interval) ──
                if [ "$(uci -q get podkop_bot.settings.alert_notify || echo 1)" = "1" ] && \
                   [ "$(uci -q get podkop_bot.settings.ram_alert || echo 1)" = "1" ]; then
                    local _ram_free_kb _ram_free_mb _now_ts
                    _ram_free_kb=$(awk '/MemAvailable/{print $2}' /proc/meminfo 2>/dev/null || echo 999999)
                    _ram_free_mb=$(( _ram_free_kb / 1024 ))
                    _now_ts=$(date +%s)
                    # Update weekly RAM tracking: min_free|alert_count|last_check_ts
                    _rw_min=$(awk -F'|' '{print $1}' "$RAM_WEEK_FILE" 2>/dev/null)
                    _rw_cnt=$(awk -F'|' '{print $2}' "$RAM_WEEK_FILE" 2>/dev/null || echo 0)
                    if [ -z "$_rw_min" ] || [ "$_ram_free_mb" -lt "$_rw_min" ] 2>/dev/null; then
                        _rw_min=$_ram_free_mb
                    fi
                    printf '%s|%s|%s\n' "$_rw_min" "${_rw_cnt:-0}" "$_now_ts" > "$RAM_WEEK_FILE" 2>/dev/null || true
                    if [ "$_ram_free_mb" -lt 30 ] && [ "$_ram_alert_active" = "0" ]; then
                        # Enter low-RAM state — send alert
                        _ram_alert_active=1
                        _ram_alert_sent=$_now_ts
                        _rw_cnt=$(( ${_rw_cnt:-0} + 1 ))
                        printf '%s|%s|%s\n' "$_rw_min" "$_rw_cnt" "$_now_ts" > "$RAM_WEEK_FILE" 2>/dev/null || true
                        logger -t podkop-bot "[Watchdog] Low RAM: ${_ram_free_mb} MB free"
                        local _ram_total_mb
                        _ram_total_mb=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo "?")
                        _send_alert "$(printf '%s <b>[%s] Low Memory Warning</b>\n\n<b>Free RAM: %s MB</b> / %s MB\n\n<i>Risk of OOM-killer. Consider:</i>\n• Reduce URLTest outbound count\n• Increase <code>health_interval</code> to 120+\n• Use <code>sing-box stable</code> instead of extended' \
                            "$E_RAM" "$_hn" "$_ram_free_mb" "$_ram_total_mb")" ""
                    elif [ "$_ram_free_mb" -ge 40 ] && [ "$_ram_alert_active" = "1" ]; then
                        # Recovered — send recovery notice
                        _ram_alert_active=0
                        logger -t podkop-bot "[Watchdog] RAM recovered: ${_ram_free_mb} MB free"
                        _send_alert "$(printf '%s <b>[%s] Memory Recovered</b>\n\nFree RAM: <b>%s MB</b> — back to normal.' \
                            "$E_OK" "$_hn" "$_ram_free_mb")" ""
                    elif [ "$_ram_free_mb" -lt 30 ] && [ "$_ram_alert_active" = "1" ]; then
                        # Still low — re-alert every hour
                        local _elapsed_since_alert
                        _elapsed_since_alert=$(( _now_ts - _ram_alert_sent ))
                        if [ "$_elapsed_since_alert" -ge 3600 ]; then
                            _ram_alert_sent=$_now_ts
                            local _ram_total_mb
                            _ram_total_mb=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo "?")
                            _send_alert "$(printf '%s <b>[%s] Low Memory (still)</b>\n\nFree RAM: <b>%s MB</b> / %s MB' \
                                "$E_RAM" "$_hn" "$_ram_free_mb" "$_ram_total_mb")" ""
                        fi
                    fi
                fi
            fi

            sec=$(get_active_section)
            m_port=$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_port || echo "2080")
            m_ip=$(get_proxy_ip)

            # ------------------------------------------------------------------
            # Check A: Telegram API connectivity.
            # Tries direct curl first (shown as "TG direct" in Tunnel Health).
            # If direct fails, falls back to SOCKS probe (mixed_proxy).
            # Does NOT touch LAST_ROUTE_FAST/POLL — uses its own curl session.
            # Under RKN: direct fails, SOCKS succeeds → status "via SOCKS".
            # ------------------------------------------------------------------
            check_health
            # check_health writes tg_direct= and tg_transport= to HEALTH_STATE_FILE.

            # Periodically refresh emergency IPs via DoH (every 6h, or if never done)
            local _now_ts; _now_ts=$(date +%s)
            if [ $((_now_ts - _EMERGENCY_IPS_LAST_REFRESH)) -ge "$_EMERGENCY_IPS_REFRESH_INTERVAL" ]; then
                local _fresh_ips; _fresh_ips=$(resolve_tg_emergency_ips)
                if [ -n "$_fresh_ips" ]; then
                    TG_EMERGENCY_IPS="$_fresh_ips"
                    _EMERGENCY_IPS_LAST_REFRESH=$_now_ts
                    logger -t podkop-bot "[Transport] Emergency IPs refreshed via DoH: ${_fresh_ips}"
                else
                    logger -t podkop-bot "[Transport] DoH refresh failed — keeping seed IPs"
                fi
            fi
            # TG is "reachable" if either path works (direct OK or transport OK).
            local _tgd _tgt
            _tgd=$(grep "^tg_direct=" "$HEALTH_STATE_FILE" 2>/dev/null | cut -d= -f2)
            _tgt=$(grep "^tg_transport=" "$HEALTH_STATE_FILE" 2>/dev/null | cut -d= -f2)
            curr_tg_state="${_tgd}/${_tgt}"
            if [ "$_tgd" = "ok" ] || [ "$_tgt" = "ok" ]; then
                tg_fail_streak=0
                tg_ok_streak=$((tg_ok_streak + 1))
                if [ "$last_tg_state" = "fail" ] && [ "$tg_ok_streak" -ge 2 ]; then
                    last_tg_state="ok"
                    logger -t podkop-bot "[Watchdog] Telegram reachable again."
                    if [ "$(uci -q get podkop_bot.settings.alert_notify || echo 1)" = "1" ]; then
                        local _now_tg; _now_tg=$(date +%s)
                        # Suppress if "Primary SOCKS recovered" was sent <30s ago
                        # (that alert already conveys the recovery — no duplicate needed)
                        if [ $((_now_tg - _recovery_ts)) -ge 30 ]; then
                            local _tg_route
                            _tg_route=$(cat "$MAIN_ROUTE_FILE" 2>/dev/null | tr -d '\n\r\t')
                            case "$_tg_route" in
                                ""|"Initializing..."|"Initializing") _tg_route="via SOCKS (recovered)" ;;
                            esac
                            admin_payload=$(jq -n -c --arg cid "$ADMIN_ID" \
                                --arg txt "$(printf '<b>[%s]</b> %s <b>Telegram reachable</b>\n\nBot connection restored.\n<b>Route:</b> <code>%s</code>' \
                                    "$_hn" "$E_OK" "$_tg_route")" \
                                '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
                            send_health_alert "$admin_payload"
                        else
                            logger -t podkop-bot "[Watchdog] Telegram reachable — suppressed (within 30s of SOCKS recovery)"
                        fi
                    fi
                fi
                [ "$last_tg_state" = "unknown" ] && last_tg_state="ok"
            else
                tg_ok_streak=0
                tg_fail_streak=$((tg_fail_streak + 1))
                if [ "$last_tg_state" = "ok" ] && [ "$tg_fail_streak" -ge 2 ]; then
                    last_tg_state="fail"
                    logger -t podkop-bot "[Watchdog] Telegram unreachable."
                    if [ "$(uci -q get podkop_bot.settings.alert_notify || echo 1)" = "1" ]; then
                        admin_payload=$(jq -n -c --arg cid "$ADMIN_ID" \
                            --arg txt "$(printf '<b>[%s]</b> %s <b>Telegram unreachable</b>\n\nBot lost connection.\n<b>podkop proxy:</b> unaffected, running normally.' \
                                "$_hn" "$E_WARN" "${LAST_ROUTE_NAME:-unknown}")" \
                            '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
                        send_health_alert "$admin_payload"
                    fi
                fi
                [ "$last_tg_state" = "unknown" ] && last_tg_state="fail"
            fi

            # ------------------------------------------------------------------
            # Check B: sing-box process liveness
            # ------------------------------------------------------------------
            if pidof sing-box >/dev/null 2>&1; then curr_sb_state="running"
            else curr_sb_state="stopped"; fi

            if [ "$curr_sb_state" != "$last_sb_state" ]; then
                if [ "$(uci -q get podkop_bot.settings.alert_notify || echo 1)" = "1" ]; then
                    if [ "$curr_sb_state" = "stopped" ]; then
                        local _sb_leaf _sb_leaf_disp
                        _sb_leaf=$([ -n "$last_leaf" ] && echo "$last_leaf" || echo "unknown")
                        _sb_leaf_disp=$(display_proxy_name "$_sb_leaf")
                        sb_alert_txt=$(printf '<b>[%s]</b> %s <b>sing-box stopped</b>\n\nVPN tunnel is down.\n<b>Last proxy:</b> <code>%s</code>\n\n<i>Traffic routing interrupted. Bot switching to fallback channel.</i>' \
                            "$_hn" "$E_ERR" "$_sb_leaf_disp")
                        # IPC: force transport reset — tier1/tier2 SOCKS are dead without sing-box
                        printf 'down' > "$ROUTE_CMD_FILE"
                        logger -t podkop-bot "[Transport] sing-box stopped. Signalling route reset."
                    else
                        new_pid=$(pidof sing-box 2>/dev/null | awk '{print $1}')
                        # Get current leaf after recovery (may take a moment to settle)
                        local _rec_leaf_disp
                        _rec_leaf_disp=$(display_proxy_name "${last_leaf:-unknown}")
                        sb_alert_txt=$(printf '<b>[%s]</b> %s <b>sing-box recovered</b>\n\nVPN tunnel is back up.\n<b>Active proxy:</b> <code>%s</code>\n\n<i>Traffic routing restored.</i>' \
                            "$_hn" "$E_OK" "$_rec_leaf_disp")
                        # IPC: signal recovery — let transport rediscover tier1
                        printf 'up' > "$ROUTE_CMD_FILE"
                        logger -t podkop-bot "[Transport] sing-box recovered. Signalling route rediscovery."
                    fi
                    admin_payload=$(jq -n -c --arg cid "$ADMIN_ID" --arg txt "$sb_alert_txt" \
                        '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
                    send_health_alert "$admin_payload"
                fi
                last_sb_state="$curr_sb_state"
            fi

            # ------------------------------------------------------------------
            # Check C: SOCKS upstream via probe_socks_upstream (3 endpoints)
            # Suppressed when sing-box is stopped (Check B covers that alert).
            # Hysteresis: alert only after 2 consecutive same-state probes.
            # ------------------------------------------------------------------
            if [ "$curr_sb_state" = "stopped" ]; then
                curr_socks_state="${last_socks_state:-up}"
                logger -t podkop-bot "[Watchdog] SOCKS probe skipped (sing-box is stopped)"
            else
                if probe_socks_upstream "$m_ip" "$m_port"; then
                    curr_socks_state="up"
                    # Log ok only on state change — suppress per-cycle spam
                    if [ "$last_socks_state" != "up" ] || [ "$last_tier1_state" = "down" ]; then
                        logger -t podkop-bot "[Watchdog] SOCKS proxy reachable (${m_ip}:${m_port})"
                    fi
                    # If tier1 was down (bot was on tier2), send recovery alert
                    if [ "$last_tier1_state" = "down" ]; then
                        if [ "$(uci -q get podkop_bot.settings.alert_notify || echo 1)" = "1" ]; then
                            local _rec_txt
                            _rec_txt=$(printf '<b>[%s]</b> %s <b>Primary SOCKS recovered</b>\n\nBot returning to primary channel.\n\n<b>Back online:</b> <code>%s:%s</code>' \
                                "$_hn" "$E_OK" "$m_ip" "$m_port")
                            local _rec_payload
                            _rec_payload=$(jq -n -c --arg cid "$ADMIN_ID" --arg txt "$_rec_txt" \
                                '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
                            send_health_alert "$_rec_payload"
                            _recovery_ts=$(date +%s)
                        fi
                    fi
                    # Reset tier1 tracking so next outage fires a fresh alert
                    last_tier1_state="up"
                else
                    # tier1 down — check if any tier2 fallback_socks is reachable.
                    # If so, mark socks=up so IPC "up" fires and bot uses tier2
                    # instead of staying on Direct indefinitely.
                    curr_socks_state="down"
                    local _tier1_was_up=1  # tier1 specifically down — used for alert
                    logger -t podkop-bot "[Watchdog] SOCKS proxy unreachable (${m_ip}:${m_port})"
                    local _fb_raw _fb _fb_ok=0 _fb_alive=""
                    _fb_raw=$(uci -q show podkop_bot.settings.fallback_socks 2>/dev/null | cut -d= -f2-)
                    if [ -n "$_fb_raw" ]; then
                        { _ucl=$(uci_list_clean "$_fb_raw"); eval "set -- $_ucl"; }
                        for _fb in "$@"; do
                            local _fb_ip _fb_port
                            _fb_ip=$(echo "$_fb" | sed 's|socks5h\?://||' | cut -d: -f1)
                            _fb_port=$(echo "$_fb" | sed 's|socks5h\?://||' | cut -d: -f2)
                            if probe_socks_upstream "$_fb_ip" "$_fb_port"; then
                                curr_socks_state="up"
                                _fb_ok=1
                                _fb_alive="$_fb"
                                logger -t podkop-bot "[Watchdog] Primary SOCKS down, fallback ${_fb} is alive."
                                break
                            fi
                        done
                    fi
                    # If tier2 is keeping transport alive, still fire a degraded alert
                    # so user knows tier1 is down — even though bot itself is still reachable.
                    if [ "$_fb_ok" = "1" ] && [ "${last_tier1_state:-up}" = "up" ]; then
                        last_tier1_state="down"
                        if [ "$(uci -q get podkop_bot.settings.alert_notify || echo 1)" = "1" ]; then
                            local _deg_txt
                            _deg_txt=$(printf '<b>[%s]</b> %s <b>Primary SOCKS unavailable</b>\n\nBot switched to fallback channel.\n\n<b>Down:</b> <code>%s:%s</code>\n<b>Fallback:</b> <code>%s</code>\n\n<i>podkop traffic routing may be affected.</i>' \
                                "$_hn" "$E_WARN" "$m_ip" "$m_port" "$_fb_alive")
                            local _deg_payload
                            _deg_payload=$(jq -n -c --arg cid "$ADMIN_ID" --arg txt "$_deg_txt" \
                                '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
                            send_health_alert "$_deg_payload"
                        fi
                    elif [ "$_fb_ok" = "0" ]; then
                        last_tier1_state="down"
                    fi
                fi
            fi

            # Hysteresis counters
            if [ "$curr_socks_state" = "up" ]; then
                socks_fail_streak=0
                socks_ok_streak=$((socks_ok_streak + 1))
            else
                socks_ok_streak=0
                socks_fail_streak=$((socks_fail_streak + 1))
            fi

            # Determine effective state with hysteresis (require 2 consecutive)
            local effective_socks="$last_socks_state"
            if [ "$curr_socks_state" = "down" ] && [ "$socks_fail_streak" -ge 2 ]; then
                effective_socks="down"
            elif [ "$curr_socks_state" = "up" ] && [ "$socks_ok_streak" -ge 2 ]; then
                effective_socks="up"
            fi

            # Act on effective state transition
            if [ -n "$last_socks_state" ] && [ "$effective_socks" != "$last_socks_state" ]; then
                if [ "$(uci -q get podkop_bot.settings.alert_notify || echo 1)" = "1" ]; then
                    # Use last known leaf (populated by Check D) — avoids extra clash_request
                    local active_px_display
                    active_px_display=$(display_proxy_name "${last_leaf:-unknown}")

                    if [ "$effective_socks" = "down" ]; then
                        # IPC: signal main process to reset route state and enter recovery mode.
                        # Cannot modify parent variables directly (subshell isolation).
                        printf 'down' > "$ROUTE_CMD_FILE"
                        logger -t podkop-bot "[Watchdog] SOCKS down. Triggering route reset."
                        # Build fallback availability from last probe file
                        local _fb_avail=""
                        if [ -f "$SOCKS_PROBE_FILE" ]; then
                            local _fp=1
                            while true; do
                                local _fline; _fline=$(grep "^tier2_${_fp}=" "$SOCKS_PROBE_FILE" 2>/dev/null)
                                [ -z "$_fline" ] && break
                                local _flat; _flat=$(echo "$_fline" | cut -d= -f2 | awk '{print $1}')
                                _fb_avail="${_fb_avail}  tier2_${_fp}=${_flat}\n"
                                _fp=$((_fp + 1))
                            done
                        fi
                        [ -z "$_fb_avail" ] && _fb_avail="  (none configured)\n"
                        socks_alert_txt=$(printf \
                            '<b>[%s]</b> %s <b>Primary SOCKS unavailable</b>\n\nBot switching to fallback channels.\n\n<b>Down:</b> <code>%s:%s</code>\n<b>Active proxy (podkop):</b> <code>%s</code>\n<b>Fallback channels:</b>\n<code>%b</code>\n<i>podkop traffic routing may be affected.</i>' \
                            "$_hn" "$E_ERR" "$m_ip" "$m_port" \
                            "$active_px_display" \
                            "$_fb_avail")
                    else
                        # IPC: signal main process to clear recovery mode and rediscover tier1.
                        sleep 3
                        printf 'up' > "$ROUTE_CMD_FILE"
                        last_ok_route="tier1"
                        logger -t podkop-bot "[Watchdog] SOCKS recovered. Triggering route rediscovery."
                        socks_alert_txt=$(printf \
                            '<b>[%s]</b> %s <b>Primary SOCKS recovered</b>\n\nBot back on primary channel.\n\n<b>Proxy:</b> <code>%s:%s</code>\n<b>Active proxy (podkop):</b> <code>%s</code>' \
                            "$_hn" "$E_OK" "$m_ip" "$m_port" \
                            "$active_px_display")
                    fi
                    admin_payload=$(jq -n -c --arg cid "$ADMIN_ID" --arg txt "$socks_alert_txt" \
                        '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
                    send_health_alert "$admin_payload"
                    # Track recovery time to suppress duplicate "Telegram reachable" within 30s
                    case "$socks_alert_txt" in *"SOCKS recovered"*) _recovery_ts=$(date +%s) ;; esac
                fi
                logger -t podkop-bot "[Watchdog] SOCKS state: ${last_socks_state} → ${effective_socks}"
                last_socks_state="$effective_socks"
            fi

            # Baseline on first run
            if [ -z "$last_socks_state" ]; then
                last_socks_state="$curr_socks_state"
                logger -t podkop-bot "[Watchdog] SOCKS baseline: ${curr_socks_state} (${m_ip}:${m_port})"
                # If baseline is "up" but bot is already on degraded route,
                # send IPC up immediately — no transition will fire later.
                if [ "$curr_socks_state" = "up" ]; then
                    _wd_cur_route=$(cat "$MAIN_ROUTE_KEY_FILE" 2>/dev/null | tr -d '\n\r\t ')
                    # Nudge if route is NOT a good SOCKS tier (tier1 or tier2_N).
                    # Use negative match to handle unknown values, typos, stale files.
                    case "${_wd_cur_route:-unknown}" in
                        tier1|tier2_*)
                            logger -t podkop-bot "[Watchdog] Route OK (${_wd_cur_route}), no action needed."
                            ;;
                        *)
                            logger -t podkop-bot "[Watchdog] Route stuck on ${_wd_cur_route}. SOCKS alive, forcing reconnect..."
                            printf 'up' > "$ROUTE_CMD_FILE"
                            printf '%s' "$(date +%s)" > "${BOT_DIR}/last_nudge"
                            ;;
                    esac
                fi
            fi

            # ------------------------------------------------------------------
            # Check D: Active proxy leaf change (selector/urltest switch)
            # Distinguishes manual switch (user action) from auto-switch (URLTest).
            # Tracks curr_raw_choice (.now field) — changes only on manual action.
            # ------------------------------------------------------------------
            if [ "$curr_sb_state" = "running" ]; then
                local _wd_proxies _wd_sel _wd_leaf_raw _wd_leaf_type
                _wd_proxies=$(clash_request "/proxies" 2>/dev/null)
                if [ -n "$_wd_proxies" ] && [ "$_wd_proxies" != "null" ]; then
                    _wd_sel=$(get_selector_tag "$_wd_proxies")
                    _wd_leaf_raw=$(echo "$_wd_proxies" | jq -r --arg s "$_wd_sel" \
                        '.proxies[$s].now // empty' 2>/dev/null)
                    if [ -n "$_wd_leaf_raw" ]; then
                        curr_raw_choice="$_wd_leaf_raw"
                        curr_leaf=$(_resolve_leaf "$_wd_leaf_raw" "$_wd_proxies")
                        _wd_leaf_type=$(echo "$_wd_proxies" | jq -r \
                            --arg n "$curr_leaf" '.proxies[$n].type // empty' 2>/dev/null)
                        case "$_wd_leaf_type" in
                            Selector|URLTest|Fallback|LoadBalance) curr_leaf="" ;;
                        esac
                    else
                        curr_raw_choice=""
                        curr_leaf=""
                    fi
                    if [ -n "$curr_leaf" ] && [ -n "$last_leaf" ] && \
                       [ "$curr_leaf" != "$last_leaf" ]; then
                        local old_disp new_disp _now_ts
                        old_disp=$(display_proxy_name "$last_leaf")
                        new_disp=$(display_proxy_name "$curr_leaf")
                        _now_ts=$(date +%s)
                        if [ "$(uci -q get podkop_bot.settings.alert_notify || echo 1)" = "1" ] && \
                           [ $((_now_ts - last_leaf_alert_ts)) -ge 60 ]; then
                            last_leaf_alert_ts=$_now_ts
                            local leaf_txt
                            if [ "$curr_raw_choice" != "$last_raw_choice" ]; then
                                # .now changed → manual selection (bot button or LuCI)
                                logger -t podkop-bot "[Watchdog] Active proxy changed manually: ${last_leaf} → ${curr_leaf}"
                                printf '%s|manual|%s|%s\n' "$(date +%s)" "$last_leaf" "$curr_leaf" >> "$SWITCH_LOG" 2>/dev/null
                                # Keep only last 8 days
                                _sw_cutoff=$(( $(date +%s) - 691200 ))
                                _sw_tmp=$(awk -F'|' -v c="$_sw_cutoff" '$1>=c' "$SWITCH_LOG" 2>/dev/null) && printf '%s\n' "$_sw_tmp" > "$SWITCH_LOG" 2>/dev/null || true
                                printf '%s|manual|%s\n' "$(date +%s)" "$curr_leaf" > "${BOT_DIR}/last_switch"
                                leaf_txt=$(printf '<b>[%s]</b> %s <b>Proxy manually switched</b>\n\n<b>From:</b> <code>%s</code>\n<b>To:</b>   <code>%s</code>\n\n<i>Active outbound was changed manually.</i>' \
                                    "$_hn" "$E_TGT" "$old_disp" "$new_disp")
                            else
                                # .now unchanged → URLTest picked a faster server
                                logger -t podkop-bot "[Watchdog] Active proxy auto-switched: ${last_leaf} → ${curr_leaf}"
                                printf '%s|urltest|%s|%s\n' "$(date +%s)" "$last_leaf" "$curr_leaf" >> "$SWITCH_LOG" 2>/dev/null
                                _sw_cutoff=$(( $(date +%s) - 691200 ))
                                _sw_tmp=$(awk -F'|' -v c="$_sw_cutoff" '$1>=c' "$SWITCH_LOG" 2>/dev/null) && printf '%s\n' "$_sw_tmp" > "$SWITCH_LOG" 2>/dev/null || true
                                printf '%s|urltest|%s\n' "$(date +%s)" "$curr_leaf" > "${BOT_DIR}/last_switch"
                                # Debounce: accumulate only. Flush is done periodically
                                # at the end of the watchdog loop by _flush_autoswitch_summary,
                                # so a single URLTest switch followed by silence is still sent.
                                [ "$_sw_count" -eq 0 ] && { _sw_first_ts=$_now_ts; _sw_old_disp="$old_disp"; }
                                _sw_count=$((_sw_count + 1))
                                _sw_pending_to="$new_disp"
                                leaf_txt=""
                            fi
                            if [ -n "$leaf_txt" ]; then
                                admin_payload=$(jq -n -c --arg cid "$ADMIN_ID" --arg txt "$leaf_txt" \
                                    '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
                                send_health_alert "$admin_payload"
                            fi
                        fi
                    fi
                    [ -n "$curr_raw_choice" ] && last_raw_choice="$curr_raw_choice"
                    [ -n "$curr_leaf" ] && last_leaf="$curr_leaf"
                fi
            fi

            # ------------------------------------------------------------------
            # Check E: Bot transport route degradation / recovery alert
            # Fires when bot route drops to tier4 (Direct) or tier5 (Emergency IP)
            # and when it recovers back to tier1/tier2.
            # ------------------------------------------------------------------
            local _wd_bot_route
            _wd_bot_route=$(cat "$MAIN_ROUTE_KEY_FILE" 2>/dev/null | tr -d '\n\r\t ')
            case "${_wd_bot_route:-unknown}" in
                tier1|tier2_*)
                    # Good route — if previously degraded, send recovery alert
                    if [ "${last_bot_route_degraded:-0}" = "1" ]; then
                        last_bot_route_degraded=0
                        logger -t podkop-bot "[Watchdog] Bot route recovered: ${_wd_bot_route}"
                        if [ "$(uci -q get podkop_bot.settings.alert_notify || echo 1)" = "1" ]; then
                            local _route_name
                            _route_name=$(cat "$MAIN_ROUTE_FILE" 2>/dev/null || echo "$_wd_bot_route")
                            local _rec_route_txt
                            _rec_route_txt=$(printf '<b>[%s]</b> %s <b>Bot connection restored</b>\n\n<b>Active route:</b> <code>%s</code>' \
                                "$_hn" "$E_OK" "$_route_name")
                            local _rec_route_pl
                            _rec_route_pl=$(jq -n -c --arg cid "$ADMIN_ID" --arg txt "$_rec_route_txt" \
                                '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
                            send_health_alert "$_rec_route_pl"
                        fi
                    fi
                    ;;
                tier4|tier5)
                    # Degraded route — alert once per degradation event
                    if [ "${last_bot_route_degraded:-0}" = "0" ]; then
                        last_bot_route_degraded=1
                        logger -t podkop-bot "[Watchdog] Bot route degraded: ${_wd_bot_route}"
                        if [ "$(uci -q get podkop_bot.settings.alert_notify || echo 1)" = "1" ]; then
                            local _route_name _deg_route_txt _deg_route_pl
                            _route_name=$(cat "$MAIN_ROUTE_FILE" 2>/dev/null || echo "$_wd_bot_route")
                            case "$_wd_bot_route" in
                                tier4) _deg_route_txt=$(printf '<b>[%s]</b> %s <b>Bot on Direct connection</b>\n\nAll SOCKS proxies are unreachable.\nBot is connecting to Telegram without a tunnel.\n\n<b>Route:</b> <code>%s</code>\n\n<i>If Telegram is blocked by your ISP, bot may become unavailable.</i>' \
                                    "$_hn" "$E_ERR" "$_route_name") ;;
                                tier5) _deg_route_txt=$(printf '<b>[%s]</b> %s <b>Bot on Emergency IPs</b>\n\nAll normal routes failed. Using hardcoded Telegram IPs.\n\n<b>Route:</b> <code>%s</code>' \
                                    "$_hn" "$E_ERR" "$_route_name") ;;
                            esac
                            _deg_route_pl=$(jq -n -c --arg cid "$ADMIN_ID" --arg txt "$_deg_route_txt" \
                                '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
                            send_health_alert "$_deg_route_pl"
                        fi
                    fi
                    ;;
            esac

            # Per-cycle: if SOCKS is up but bot route is degraded (tier4/tier5/fail),
            # send IPC up every cycle to nudge main loop back to SOCKS discovery.
            # Per-cycle nudge: if SOCKS is up but bot route is degraded,
            # send IPC up so main loop rediscovers tier1 within one health interval.
            # Reads MAIN_ROUTE_KEY_FILE — written by main process, never stale.
            # Nudge: if SOCKS (tier2+) is alive but bot route is degraded,
            # send IPC up to trigger SOCKS rediscovery.
            # Throttled to once per 120s to avoid continuous LAST_ROUTE_FAST resets
            # which would cause full discovery every poll cycle (recover old=fail loop).
            if [ "$curr_socks_state" = "up" ] && [ "$curr_sb_state" = "running" ]; then
                _wd_cur_route=$(cat "$MAIN_ROUTE_KEY_FILE" 2>/dev/null | tr -d '\n\r\t ')
                # Negative match: nudge on anything that is NOT tier1/tier2_*
                # Handles stale files with typos/old values from previous bot versions.
                case "${_wd_cur_route:-unknown}" in
                    tier1|tier2_*)
                        : # good route, no nudge needed
                        ;;
                    *)
                        local _now_nudge _last_nudge
                        _now_nudge=$(date +%s)
                        _last_nudge=$(cat "${BOT_DIR}/last_nudge" 2>/dev/null || echo 0)
                        if [ $((_now_nudge - _last_nudge)) -ge 120 ]; then
                            logger -t podkop-bot "[Watchdog] Route stuck on ${_wd_cur_route}. SOCKS alive, forcing reconnect..."
                            printf 'up' > "$ROUTE_CMD_FILE"
                            printf '%s' "$_now_nudge" > "${BOT_DIR}/last_nudge"
                        fi
                        ;;
                esac
            fi

            # Flush pending URLTest auto-switch summary whose debounce window elapsed.
            # This covers the common case of one switch followed by silence.
            _flush_autoswitch_summary

            # Write structured state for status screens
            _write_socks_state "$last_tg_state" "$last_socks_state" "$last_ok_route"

        done
    ) &
    HEALTH_PID=$!
}

# ==============================================================================
# SECTION 9: Command Handlers
# ==============================================================================

# ------------------------------------------------------------------------------
# 9.1: Section Management
# Active section shown in header text only — no spinning active-section button.
# ------------------------------------------------------------------------------
_handle_sections() {
    local cmd="$1" mid="$2"
    local sec=$(get_active_section)

    case "$cmd" in
        "sections_menu")
            rm -f "$STATE_FILE"
    rm -f "$REPLY_KB_INSTALLED_FILE"  # Force re-install reply keyboard after restart
            local sections rows s text kb
            # uci show gives "podkop.NAME=section" for section objects.
            # Correct pattern matches lines ending in =section exactly.
            sections=$(uci -q show ${PODKOP_UCI} 2>/dev/null \
                | grep -E "^${PODKOP_UCI}\.[^.=]+=section$" \
                | sed 's/^[^.]*\.\([^=]*\)=section$/\1/' \
                | grep -v '_routing$')
            rows=""
            for s in $sections; do
                # Only inactive sections get a button (Variant C: no spinning active button)
                [ "$s" != "$sec" ] && rows="${rows}[{\"text\":\"${s}\",\"callback_data\":\"set_sec_${s}\"}],"
            done
            text=$(cat <<EOF
${E_CLIP} <b>Sections Management</b>

<b>Active section:</b> <code>${sec}</code>

<i>Select a section to switch to:</i>
EOF
)
            kb="{\"inline_keyboard\":[${rows}[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"main_settings_menu\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;
        "do_set_sec_"*)
            local new_sec="${cmd#do_set_sec_}"
            echo "$new_sec" > "$ACTIVE_SECTION_FILE"
            build_all_caches
            safe_reload_podkop "force"; sleep 1
            _handle_sections "sections_menu" "$mid"
            ;;

        "set_sec_"*)
            local new_sec="${cmd#set_sec_}"
            send_or_edit "$mid" \
                "$(printf '%s Switch active section to <code>%s</code>?\n\nPodkop will reload.' "$E_WARN" "$new_sec")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Switch\",\"callback_data\":\"do_set_sec_${new_sec}\"},{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"sections_menu\"}]]}"
            ;;
    esac
}

# ------------------------------------------------------------------------------
# 9.2: Proxy Selector Handler
# Pagination (10/page), add/delete/switch/test, batch delay test.
# FIXED: cmd_all_delay_test uses explicit PID wait (no more HEALTH_PID deadlock).
# FIXED: build_uci_links_cache uses eval (uci get N broken on BusyBox).
# ------------------------------------------------------------------------------
_handle_proxy() {
    local cmd="$1" mid="$2" text="$3" state="$4"
    local sec=$(get_active_section)
    local per_page=10

    if [ "$cmd" = "STATE_INPUT" ]; then
        # Nav escape: persistent keyboard buttons cancel current state
        case "$text" in
            "🏠 Menu"|"/menu"|"main_menu")
                rm -f "$STATE_FILE"
                delete_message "$mid"
                _handle_bot "/menu" "" "" ""
                return ;;
            "📊 Status"|"cmd_status"|"/status")
                rm -f "$STATE_FILE"
                delete_message "$mid"
                _handle_bot "cmd_status" "" "" ""
                return ;;
        esac

        # During confirm step: user sends text while pending_sub_url_* is active.
        # Must be checked BEFORE rm -f STATE_FILE to preserve the pending URL on line 2.
        if printf '%s' "$state" | grep -qE '^pending_sub_url_'; then
            send_message "$(printf '%s Please use the <b>Confirm</b> or <b>Cancel</b> buttons above.' "$E_WARN")" \
                "{\"inline_keyboard\":[[{\"text\":\"❌ Cancel\",\"callback_data\":\"proxy_menu\"}]]}"
            return
        fi

        rm -f "$STATE_FILE"

        # Subscription URL edit: wait_sub_url_<sec>
        if printf '%s' "$state" | grep -qE '^wait_sub_url_'; then
            delete_message "$mid"
            local _sub_sec="${state#wait_sub_url_}"
            local _new_url; _new_url=$(printf '%s' "$text" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            if ! printf '%s' "$_new_url" | grep -qE '^https?://'; then
                send_message "$(printf '%s <b>Invalid URL.</b>\nMust start with <code>http://</code> or <code>https://</code>.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_menu\"}]]}"
                return
            fi
            local _old_urls="" _ou_line
            while IFS= read -r _ou_line; do
                [ -z "$_ou_line" ] && continue
                local _ou_short; _ou_short=$(printf '%s' "$_ou_line" | cut -c1-67)
                [ "$(printf '%s' "$_ou_line" | wc -c | tr -d ' ')" -gt 67 ] && _ou_short="${_ou_short}..."
                _old_urls="${_old_urls}  <code>$(html_escape "$_ou_short")</code>
"
            done <<SUBURLS
$(get_subscription_urls "$_sub_sec" | head -3)
SUBURLS
            [ -z "$_old_urls" ] && _old_urls="  <i>none</i>"
            local _new_url_html; _new_url_html=$(html_escape "$_new_url")
            printf '%s\n%s' "pending_sub_url_${_sub_sec}" "$_new_url" > "$STATE_FILE"
            send_message "$(printf '%s <b>Replace subscription URL?</b>\n\n<b>Current:</b>\n%s\n\n<b>New:</b>\n  <code>%s</code>\n\n<i>Replaces all URLs for section <code>%s</code> and triggers reload.</i>' \
                "$E_WARN" "$_old_urls" "$_new_url_html" "$_sub_sec")" \
                "{\"inline_keyboard\":[[{\"text\":\"✅ Confirm\",\"callback_data\":\"do_confirm_sub_url_${_sub_sec}\"},{\"text\":\"❌ Cancel\",\"callback_data\":\"proxy_menu\"}]]}"
            return
        fi

        if [ "$state" = "wait_proxy_link" ]; then
            delete_message "$mid"
            local safe_link=$(printf "%s" "$text" | tr -d '\r\n')
            local _stype; _stype=$(get_section_type "$sec")
            local _links_key
            if [ "$PODKOP_VARIANT" = "plus" ]; then
                # Plus stores all manual servers in selector_proxy_links;
                # urltest is a flag (urltest_enabled), not a separate links list.
                _links_key="selector_proxy_links"
            else
                case "$_stype" in
                    proxy:urltest) _links_key="urltest_proxy_links" ;;
                    *)             _links_key="selector_proxy_links" ;;
                esac
            fi
            if echo "$safe_link" | grep -q '[[:space:]]'; then
                send_message "$(printf '%s <b>Invalid!</b>\nLink contains spaces.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_menu\"}]]}"
            elif ! echo "$safe_link" | grep -qE '^(vless|vmess|ss|trojan|hy2|hysteria2|socks|socks4|socks4a|socks5)://'; then
                send_message "$(printf '%s <b>Invalid protocol!</b>' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_menu\"}]]}"
            elif uci -q show ${PODKOP_UCI}.${sec} 2>/dev/null | grep -qF "${_links_key}='$safe_link'"; then
                send_message "$(printf '%s <b>Duplicate!</b>\nThis link is already in the list.' "$E_WARN")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_menu\"}]]}"
            else
                uci add_list ${PODKOP_UCI}.${sec}.${_links_key}="$safe_link"
                uci_commit_safe ${PODKOP_UCI}
                send_message "$(printf '%s <b>Applying...</b>' "$E_RST")" ""
                safe_reload_podkop "force"; sleep 1
                _handle_proxy "proxy_menu" "" "" ""
            fi
        fi
        return
    fi

    case "$cmd" in
        proxy_menu|proxy_menu_p_*)
            rm -f "$STATE_FILE"
            local proxies selector current_proxy current_proxy_display
            local total total_pages page start_idx end_idx
            local rows list_text nav_row text kb
            local page_tsv name ptype delay_raw delay_txt icon active_mark
            local human_name short_name short_name_json abs_idx

            page=0
            [ "$cmd" != "proxy_menu" ] && page="${cmd#proxy_menu_p_}"

            # Answer callback immediately — before clash_request which can take 2-3s.
            # Telegram times out callback queries in ~5s; answering early removes the
            # spinner from the button and shows the toast before any heavy work starts.
            # Sets CB_ANSWER_TEXT="__ANSWERED__" to signal main loop not to answer again.
            if [ -n "$cb_id" ] && [ "$cmd" != "proxy_menu" ]; then
                answer_callback "$cb_id" "$(printf '%s Refreshing...' "$E_TIME")"
                CB_ANSWER_TEXT="__ANSWERED__"
            fi

            proxies=$(clash_request "/proxies")
            # Clash API can be slow on busy routers — retry once before giving up
            if [ -z "$proxies" ] || [ "$proxies" = "null" ]; then
                sleep 2
                proxies=$(clash_request "/proxies")
            fi
            if [ -z "$proxies" ] || [ "$proxies" = "null" ]; then
                send_or_edit "$mid" "$(printf '%s <b>Clash API Unavailable</b>\n<i>sing-box may be restarting. Try Refresh in a moment.</i>' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_RST} Retry\",\"callback_data\":\"proxy_menu\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
                return
            fi

            selector=$(get_selector_tag "$proxies")
            current_proxy=$(get_active_proxy_name "$proxies")
            current_proxy_display=$(html_escape "$(display_proxy_name_with_tag "$current_proxy")")

            # Detect URLTest mode and whether auto or manual is active
            local proxy_mode_cur urltest_group urltest_now is_auto_mode auto_hint
            proxy_mode_cur=$(get_section_type "$sec")
            auto_hint=""

            # For Plus: fetch link states to mark filtered/unavailable outbounds
            local _link_states_json=""
            if [ "$PODKOP_VARIANT" = "plus" ] && _plus_has_cmd "get_outbound_link_states"; then
                _link_states_json=$(_plus_json get_outbound_link_states "$sec")
            fi

            if [ "$proxy_mode_cur" = "proxy:urltest" ]; then
                # Find the URLTest group that belongs to THIS selector — not globally.
                # Search only within .proxies[$selector].all[] to avoid cross-section bleed.
                urltest_group=$(echo "$proxies" | jq -r \
                    --arg sel "$selector" \
                    '.proxies[$sel].all[]? as $n |
                     select(.proxies[$n].type == "URLTest") | $n' \
                    2>/dev/null | head -1)
                urltest_now=$(echo "$proxies" | jq -r \
                    --arg g "$urltest_group" '.proxies[$g].now // empty' 2>/dev/null)
                # Active selector .now points to the urltest group itself = Auto mode
                local selector_now
                selector_now=$(echo "$proxies" | jq -r \
                    --arg sel "$selector" '.proxies[$sel].now // empty' 2>/dev/null)
                if [ "$selector_now" = "$urltest_group" ] || [ -z "$urltest_group" ]; then
                    is_auto_mode="1"
                    # For subscription sections mode is shown in title — skip redundant hint
                    if [ "$PODKOP_VARIANT" = "plus" ] && section_is_subscription "$sec" 2>/dev/null; then
                        auto_hint=""
                    else
                        auto_hint=" | <i>URLTest: auto-selecting</i>"
                    fi
                else
                    is_auto_mode="0"
                    auto_hint=" | <i>Pinned manually</i>"
                fi
            fi

            total=$(echo "$proxies" | jq -r --arg sel "$selector" '
                . as $root |
                [$root.proxies[$sel].all[]? |
                  select(($root.proxies[.].type // "") |
                    (. != "Selector" and . != "URLTest" and . != "Fallback" and . != "LoadBalance"))
                ] | length // 0' 2>/dev/null)

            total_pages=$(( (total + per_page - 1) / per_page ))
            [ "$total_pages" -eq 0 ] && total_pages=1
            [ "$page" -ge "$total_pages" ] && page=$((total_pages - 1))
            [ "$page" -lt 0 ] && page=0
            start_idx=$(( page * per_page ))
            end_idx=$(( start_idx + per_page ))
            [ "$end_idx" -gt "$total" ] && end_idx="$total"

            # ONE jq call for the entire page: returns TSV orig_idx\tname\ttype\tdelay_raw
            # Resolves leaf proxy for type/delay (follows Selector->URLTest chains).
            # This replaces 4 jq forks per proxy with a single call — ~10x faster on MIPS.
            # depth counter prevents infinite recursion on cyclic A->B->A proxy references.
            # Group nodes (URLTest/Selector/Fallback/LoadBalance) are filtered out —
            # they are internal sing-box routing nodes, not real outbounds to display.
            # orig_idx is the position in .all[] — used for px_view_N / ask_del_px_N callbacks.
            page_tsv=$(echo "$proxies" | jq -r \
                --arg sel "$selector" \
                --argjson s 0 \
                --argjson e 9999 \
                '
                . as $root |
                $root.proxies[$sel].all | to_entries[$s:$e][] |
                .key as $orig_idx | .value as $name |
                # Skip internal group nodes — not real proxies
                select(
                    ($root.proxies[$name].type // "") |
                    (. != "Selector" and . != "URLTest" and . != "Fallback" and . != "LoadBalance")
                ) |
                # Walk chain with depth limit (max 5 hops) to guard against cycles
                def leaf(n; depth):
                    if depth <= 0 then n
                    else
                        ($root.proxies[n].type // "") as $t |
                        if ($t == "Selector" or $t == "URLTest" or $t == "Fallback") then
                            ($root.proxies[n].now // n) as $next |
                            if $next != n then leaf($next; depth - 1) else n end
                        else n end
                    end;
                leaf($name; 5) as $lf |
                [
                    ($orig_idx | tostring),
                    $name,
                    ($root.proxies[$lf].type // $root.proxies[$lf].adapterType // "Unknown"),
                    (($root.proxies[$name].history[-1].delay //
                      $root.proxies[$lf].history[-1].delay // 0) | tostring)
                ] | @tsv
                ' 2>/dev/null)

            rows=""; list_text=""; local disp_count=0 disp_idx=0

            while IFS=$(printf '\t') read -r orig_idx name ptype delay_raw; do
                [ -z "$name" ] && continue
                # Paginate by display position (not .all[] index)
                if [ "$disp_idx" -lt "$start_idx" ]; then disp_idx=$((disp_idx+1)); continue; fi
                if [ "$disp_idx" -ge "$end_idx" ];   then disp_idx=$((disp_idx+1)); continue; fi
                local abs_idx="$orig_idx"

                # Delay icon and label
                case "$delay_raw" in
                    ''|0|'0') delay_txt="N/A"; icon="${E_RED}" ;;
                    *)
                        delay_txt="${delay_raw}ms"
                        if   [ "$delay_raw" -lt 200 ]; then icon="${E_ON}"
                        elif [ "$delay_raw" -lt 500 ]; then icon="${E_YLW}"
                        elif [ "$delay_raw" -lt 900 ]; then icon="${E_ORNG}"
                        else                                icon="${E_RED}"; fi ;;
                esac

                # Human-readable name (UCI fragment or tag)
                human_name=$(display_proxy_name "$name")

                # List: active proxy gets ▶ + bold; others plain
                # html_escape name: URI fragment may contain < > & from user input
                safe_name=$(html_escape "$human_name")
                # For Plus: mark filtered/inactive outbounds
                local _ls_mark=""
                if [ -n "$_link_states_json" ] && [ "$_link_states_json" != "{}" ]; then
                    local _ls_val; _ls_val=$(printf '%s' "$_link_states_json" |                         jq -r --arg t "$name" '.[$t] // null' 2>/dev/null)
                    [ "$_ls_val" = "false" ] && _ls_mark="⊘ "
                fi
                # Button label mirrors the list line: ▶ marks the active proxy,
                # the latency dot (green/yellow/red) marks the rest. This way the
                # active outbound is obvious on the button itself — no need to
                # match the [index] against the list before tapping to test/switch.
                local btn_mark
                if [ "$name" = "$current_proxy" ]; then
                    btn_mark="${E_PLAY}"
                    list_text=$(printf '%s\n<code>[%s]</code> %s <b>%s%s</b> | %s | %s' \
                        "$list_text" "$abs_idx" "${E_PLAY}" \
                        "$_ls_mark" "$safe_name" "$ptype" "$delay_txt")
                else
                    btn_mark="${icon}"
                    list_text=$(printf '%s\n<code>[%s]</code> %s %s%s | %s | %s' \
                        "$list_text" "$abs_idx" "$icon" \
                        "$_ls_mark" "$safe_name" "$ptype" "$delay_txt")
                fi
                short_name=$(json_escape "[${abs_idx}] ${btn_mark} ${_ls_mark}${human_name}")
                rows="${rows}[{\"text\":\"${short_name}\",\"callback_data\":\"px_view_${abs_idx}\"}],"
                disp_idx=$((disp_idx + 1))
            done <<EOF
$page_tsv
EOF

            # Strip leading newline from list_text
            list_text="${list_text#?}"

            nav_row=""
            if [ "$total" -gt "$per_page" ]; then
                local prev_p=$((page - 1)) next_p=$((page + 1))
                local prev_cb="proxy_menu_p_${prev_p}" next_cb="proxy_menu_p_${next_p}"
                [ "$page" -eq 0 ] && prev_cb="proxy_menu_p_0"
                [ "$next_p" -ge "$total_pages" ] && next_cb="proxy_menu_p_${page}"
                nav_row="[{\"text\":\"${E_BACK} Prev\",\"callback_data\":\"${prev_cb}\"},{\"text\":\"${E_FILE} $((page+1))/${total_pages}\",\"callback_data\":\"proxy_menu_p_${page}\"},{\"text\":\"Next >\",\"callback_data\":\"${next_cb}\"}],"
            fi

            kb="{\"inline_keyboard\":[${rows}${nav_row}"
            # URLTest mode: prepend Auto (best ping) button on its own row
            if [ "$proxy_mode_cur" = "proxy:urltest" ] && [ -n "$urltest_group" ]; then
                if [ "${is_auto_mode:-0}" != "1" ]; then
                    kb="${kb}[{\"text\":\"${E_SCAN} Switch to URLTest auto\",\"callback_data\":\"do_px_auto_urltest\"}],"
                fi
                # URLTest auto ✓ indicator shown in list text, no standalone button needed
            fi
            # For subscription sections: show Edit Subscription URL.
            # On Plus, subscription and manual links COEXIST (subscription pulls
            # servers + manual links in selector_proxy_links, URLTest tests all),
            # so ALSO offer Add. On other variants subscription is exclusive.
            if section_is_subscription "$sec"; then
                if [ "$PODKOP_VARIANT" = "plus" ]; then
                    kb="${kb}[{\"text\":\"✏️ Edit Subscription URL\",\"callback_data\":\"cmd_edit_sub_url\"},{\"text\":\"${E_ADD} Add\",\"callback_data\":\"cmd_proxy_add\"}],[{\"text\":\"${E_BOLT} Test All\",\"callback_data\":\"cmd_all_delay_test\"},{\"text\":\"${E_RST} Refresh\",\"callback_data\":\"proxy_menu_p_${page}\"}],[{\"text\":\"${E_TEST} Diagnostics\",\"callback_data\":\"cmd_diagnostics\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"main_menu\"}]]}"
                else
                    kb="${kb}[{\"text\":\"✏️ Edit Subscription URL\",\"callback_data\":\"cmd_edit_sub_url\"},{\"text\":\"${E_RST} Refresh\",\"callback_data\":\"proxy_menu_p_${page}\"}],[{\"text\":\"${E_TEST} Diagnostics\",\"callback_data\":\"cmd_diagnostics\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"main_menu\"}]]}"
                fi
            else
                kb="${kb}[{\"text\":\"${E_ADD} Add\",\"callback_data\":\"cmd_proxy_add\"},{\"text\":\"${E_BOLT} Test All\",\"callback_data\":\"cmd_all_delay_test\"},{\"text\":\"${E_RST} Refresh\",\"callback_data\":\"proxy_menu_p_${page}\"}],[{\"text\":\"${E_TEST} Diagnostics\",\"callback_data\":\"cmd_diagnostics\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"main_menu\"}]]}"
            fi
            local _card_title _sub_url_line=""
            # Show subscription URL(s) for subscription sections
            if section_is_subscription "$sec"; then
                local _sub_urls _sub_url_disp="" _sub_meta_str=""
                _sub_urls=$(get_subscription_urls "$sec")
                if [ -n "$_sub_urls" ]; then
                    local _pm_u_line
                    while IFS= read -r _pm_u_line; do
                        [ -z "$_pm_u_line" ] && continue
                        local _pm_u_short; _pm_u_short=$(printf '%s' "$_pm_u_line" | cut -c1-57)
                        [ "$(printf '%s' "$_pm_u_line" | wc -c | tr -d ' ')" -gt 57 ] && _pm_u_short="${_pm_u_short}..."
                        _sub_url_disp="${_sub_url_disp}  <code>$(html_escape "$_pm_u_short")</code>
"
                    done <<PMURLEOF
$(printf '%s' "$_sub_urls" | head -3)
PMURLEOF
                fi
                # Traffic/expiry — file-first (no binary spawn), CLI fallback in helper
                if [ "$PODKOP_VARIANT" = "plus" ]; then
                    local _smj; _smj=$(_plus_sub_metadata "$sec" 2>/dev/null)
                    [ -n "$_smj" ] && _sub_meta_str=$(_plus_format_sub_meta "$_smj")
                fi
                # Build combined subscription line
                if [ -n "$_sub_url_disp" ] || [ -n "$_sub_meta_str" ]; then
                    # Build with printf to avoid literal \n in ash variable expansion
                    local _smeta_part="" _surl_part=""
                    [ -n "$_sub_meta_str" ] && _smeta_part=" 📊 ${_sub_meta_str}"
                    [ -n "$_sub_url_disp" ] && _surl_part=$(printf '\n%s' "$_sub_url_disp")
                    _sub_url_line=$(printf '\n%s <b>Subscription:</b>%s%s'                         "$E_LINK" "$_smeta_part" "$_surl_part")
                fi
            fi
            # For Plus subscription sections — always show as Subscription Outbounds
            # with mode as subtitle, avoiding "URLTest Outbounds (auto: tag) [section]" mash
            if [ "$PODKOP_VARIANT" = "plus" ] && section_is_subscription "$sec"; then
                local _total_sfx _sub_cnt _manual_cnt
                _sub_cnt=$(get_subscription_server_count "$sec" 2>/dev/null || echo 0)
                # Manual links = total loaded - subscription count
                _manual_cnt=$(( ${total:-0} - ${_sub_cnt:-0} ))
                [ "$_manual_cnt" -lt 0 ] && _manual_cnt=0
                if [ "${total:-0}" -gt 0 ] 2>/dev/null; then
                    if [ "$_manual_cnt" -gt 0 ]; then
                        _total_sfx=" · ${total} (${_sub_cnt} sub + ${_manual_cnt} manual)"
                    else
                        _total_sfx=" · ${total} servers"
                    fi
                else
                    _total_sfx=""
                fi
                if [ "${is_auto_mode:-0}" = "1" ]; then
                    _card_title="${E_LINK} <b>Subscription Outbounds</b> · <i>URLTest</i>${_total_sfx}"
                else
                    _card_title="${E_LINK} <b>Subscription Outbounds</b> · <i>Selector</i>${_total_sfx}"
                fi
            else
                case "$proxy_mode_cur" in
                    proxy:urltest)       _card_title="${E_TGT} <b>URLTest Outbounds</b>" ;;
                    proxy:subscription)  _card_title="${E_LINK} <b>Subscription Outbounds</b>" ;;
                    proxy:selector_text) _card_title="${E_INFO} <b>Selector (text mode)</b>" ;;
                    proxy:urltest_text)  _card_title="${E_INFO} <b>URLTest (text mode)</b>" ;;
                    *)                   _card_title="${E_GLOB} <b>Outbound Selector</b>" ;;
                esac
            fi
            # NetShift selector_text/urltest_text: links in multiline scalar,
            # not UCI list — read-only in bot, user must edit in LuCI.
            case "$proxy_mode_cur" in
                proxy:selector_text|proxy:urltest_text)
                    send_or_edit "$mid" \
                        "$(printf '%s <b>%s</b>\n[<code>%s</code>]\n\n%s\n\n<i>This section uses text-mode links (NetShift selector_text / urltest_text).\nLinks are stored as a multiline field — edit them in LuCI, not here.</i>' \
                            "$E_INFO" "${_card_title}" "$sec" "$(printf 'Active: <code>%s</code>' "$current_proxy_display")")"\
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"section_settings\"}]]}"
                    return
                    ;;
            esac
            text=$(cat <<EOF
${_card_title} [<code>${sec}</code>]
<b>Active:</b> <code>${current_proxy_display}</code>${auto_hint}${_sub_url_line}

${list_text}

<i>Tap a proxy name to view details and switch.</i>
EOF
)
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "cmd_all_delay_test")
            # FIXED: collect explicit PIDs, wait only on those (not on HEALTH_PID)
            # UX FIX: send a separate status message below the card (don't replace it),
            # then delete the status message and refresh the card inline when done.
            local names_file pids="" pid p name_url batch=0 status_resp status_mid
            # Send a NEW message below (not edit) so the card stays visible
            local _status_payload
            _status_payload=$(jq -n -c --arg cid "$TARGET_CHAT_ID" \
                --arg txt "$(printf '%s <b>Testing all proxies...</b>' "$E_TIME")" \
                '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
            status_resp=$(api_request_fast "sendMessage" "$_status_payload")
            status_mid=$(printf '%s' "$status_resp" | jq -r '.result.message_id // empty' 2>/dev/null)

            proxies=$(clash_request "/proxies")
            selector=$(get_selector_tag "$proxies")
            names_file=$(mktemp /tmp/podkop_delay_test.XXXXXX 2>/dev/null) || {
                [ -n "$status_mid" ] && delete_message "$status_mid"
                return
            }
            echo "$proxies" | jq -r --arg sel "$selector" '
              . as $root | $root.proxies[$sel].all[]?
              | select(($root.proxies[.].type // "") |
                  (. != "Selector" and . != "URLTest" and . != "Fallback" and . != "LoadBalance"))
            ' 2>/dev/null > "$names_file"

            while IFS= read -r name; do
                [ -n "$name" ] || continue
                name_url=$(printf '%s' "$name" | jq -rR '@uri')
                clash_request "/proxies/${name_url}/delay?timeout=5000&url=http://www.gstatic.com/generate_204" \
                    >/dev/null 2>&1 &
                pid=$!; pids="$pids $pid"; batch=$((batch + 1))
                if [ "$batch" -ge 10 ]; then
                    for p in $pids; do wait "$p" 2>/dev/null; done
                    pids=""; batch=0
                fi
            done < "$names_file"
            for p in $pids; do wait "$p" 2>/dev/null; done

            sleep 1; rm -f "$names_file"
            # Delete the status message, then refresh the card inline.
            # Clear CB_ANSWER_TEXT so the internal proxy_menu call doesn't fire another toast.
            [ -n "$status_mid" ] && delete_message "$status_mid"
            CB_ANSWER_TEXT=""
            _handle_proxy "proxy_menu_p_${page}" "$mid" "" ""
            ;;

        "px_view_"*)
            rm -f "$STATE_FILE"
            local p_idx p_name p_display_name leaf_name p_type
            local p_svr_port p_delay_raw p_delay p_status
            local raw_link share_uri tag_idx ret_page=0 text kb proxies selector

            p_idx="${cmd#px_view_}"
            ret_page=$(( p_idx / per_page ))
            proxies=$(clash_request "/proxies"); selector=$(get_selector_tag "$proxies")
            local _pview_mode; _pview_mode=$(get_section_type "$sec")
            p_name=$(echo "$proxies" | jq -r --arg sel "$selector" --arg idx "$p_idx" \
                '.proxies[$sel].all[$idx|tonumber] // empty')
            [ -z "$p_name" ] && return

            p_display_name=$(html_escape "$(display_proxy_name "$p_name")")
            leaf_name=$(_resolve_leaf "$p_name" "$proxies"); [ -z "$leaf_name" ] && leaf_name="$p_name"
            p_type=$(echo "$proxies" | jq -r --arg n "$leaf_name" \
                '.proxies[$n].type // .proxies[$n].adapterType // "Unknown"' 2>/dev/null)

            tag_idx=$(get_proxy_index_by_tag "$p_name")
            [ -n "$tag_idx" ] && raw_link=$(get_selector_link_by_index "$tag_idx")
            [ -z "$raw_link" ] && raw_link=$(get_uri_by_tag "$p_name")
            if [ -n "$raw_link" ]; then
                share_uri="$raw_link"; p_svr_port=$(extract_server_port_from_uri "${raw_link%%#*}")
            else share_uri="N/A"; p_svr_port="N/A"; fi
            p_svr_port_esc=$(html_escape "$p_svr_port")

            p_delay_raw=$(echo "$proxies" | jq -r --arg n "$p_name" '.proxies[$n].history[-1].delay // 0' 2>/dev/null)
            [ -z "$p_delay_raw" ] || [ "$p_delay_raw" = "0" ] && \
                p_delay_raw=$(echo "$proxies" | jq -r --arg n "$leaf_name" '.proxies[$n].history[-1].delay // 0' 2>/dev/null)
            [ -z "$p_delay_raw" ] || [ "$p_delay_raw" = "0" ] && p_delay="N/A" || p_delay="${p_delay_raw}ms"
            # Escape Clash API values that go into HTML context
            p_type_esc=$(html_escape "$p_type")
            p_name_esc=$(html_escape "$p_name")
            leaf_name_esc=$(html_escape "$leaf_name")

            # Human-readable delay verdict
            local p_verdict
            case "$p_delay_raw" in
                ''|0|'0') p_verdict="Offline - no response" ;;
                *)
                    if   [ "$p_delay_raw" -lt 150 ]; then p_verdict="${E_ON} Excellent"
                    elif [ "$p_delay_raw" -lt 200 ]; then p_verdict="${E_ON} Good"
                    elif [ "$p_delay_raw" -lt 500 ]; then p_verdict="${E_YLW} Acceptable"
                    elif [ "$p_delay_raw" -lt 900 ]; then p_verdict="${E_ORNG} Slow but usable"
                    else                                  p_verdict="${E_RED} Very high - consider switching"; fi ;;
            esac

            text=$(cat <<EOF
${E_GLOB} <b>Proxy Card</b> [<code>${sec}</code>]
<code>────────────────────</code>
<b>${p_display_name}</b>
<b>Type:</b> ${p_type_esc}
<b>Delay:</b> ${p_delay} - ${p_verdict}
<b>Server:</b> <code>${p_svr_port_esc}</code>
<b>Tag:</b> <code>${p_name_esc}</code>
EOF
)
            [ "$leaf_name" != "$p_name" ] && text=$(printf '%s\n<b>Leaf:</b> <code>%s</code>' "$text" "$leaf_name_esc")
            text=$(printf '%s\n<code>────────────────────</code>\n<b>Share Link:</b>\n<code>%s</code>' "$text" "$(html_escape "$share_uri")")
            # can_delete: only show Delete if tag has a real manual UCI link.
            # resolve_manual_uci_link_for_tag searches only selector/urltest_proxy_links
            # — never TAG_URI_CACHE / sing-box config — so subscription-generated
            # outbounds (which have no UCI entry) correctly get can_delete=0.
            local can_delete=0 _manual_link
            if section_is_subscription "$sec"; then
                _manual_link=$(resolve_manual_uci_link_for_tag "$p_name" "$sec")
                [ -n "$_manual_link" ] && can_delete=1
            else
                can_delete=1
            fi
            kb=$(jq -n -c --arg i "$p_idx" --arg p "$ret_page" \
                --arg ok "$( [ "$_pview_mode" = "proxy:urltest" ] && echo "📌 Pin manually" || echo "${E_OK} Switch" )" \
                --arg test "${E_RST} Test" \
                --arg del "${E_DEL} Delete" --arg back "${E_BACK} Back" \
                --arg probe "${E_MICRO} Probe" \
                --arg menu "🏠 Menu" \
                --arg is_urltest "$( [ "$_pview_mode" = "proxy:urltest" ] && echo 1 || echo 0 )" \
                --arg is_active "$( [ "$p_name" = "$(get_active_proxy_name "$proxies")" ] && echo 1 || echo 0 )" \
                --arg can_del "$can_delete" \
                '{
                inline_keyboard: [
                    (if $is_urltest == "1" then
                        [{"text":"ℹ️ Tap Pin to override auto URLTest selection","callback_data":"noop"}]
                    else [] end),
                    [{"text":$ok,  "callback_data":("do_px_"+$i)},   {"text":$test,"callback_data":("test_px_"+$i)}],
                    (if $can_del == "1" then
                        [{"text":$del,"callback_data":("ask_del_px_"+$i)},{"text":$back,"callback_data":("proxy_menu_p_"+$p)}]
                    else
                        [{"text":$back,"callback_data":("proxy_menu_p_"+$p)}]
                    end),
                    (if $is_active == "1" then [{"text":$probe,"callback_data":("ask_probe_outbound_px_"+$i)}] else [] end),
                    [{"text":$menu,"callback_data":"/menu"}]
                ] | map(select(length > 0))
                }')
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "test_px_"*)
            local p_idx="${cmd#test_px_}" p_name p_name_url proxies selector status_resp status_mid
            proxies=$(clash_request "/proxies"); selector=$(get_selector_tag "$proxies")
            p_name=$(echo "$proxies" | jq -r --arg sel "$selector" --arg idx "$p_idx" \
                '.proxies[$sel].all[$idx|tonumber] // empty')
            # Send separate status message below card — don't replace the card
            local _tst_payload
            _tst_payload=$(jq -n -c --arg cid "$TARGET_CHAT_ID" \
                --arg txt "$(printf '%s Testing <b>%s</b>...' "$E_TIME" "$(html_escape "$p_name")")" \
                '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
            status_resp=$(api_request_fast "sendMessage" "$_tst_payload")
            status_mid=$(printf '%s' "$status_resp" | jq -r '.result.message_id // empty' 2>/dev/null)
            p_name_url=$(echo "$p_name" | jq -rR '@uri')
            clash_request "/proxies/${p_name_url}/delay?timeout=5000&url=http://www.gstatic.com/generate_204" >/dev/null
            [ -n "$status_mid" ] && delete_message "$status_mid"
            _handle_proxy "px_view_${p_idx}" "$mid" "" ""
            ;;

        "do_px_auto_urltest")
            # Switch selector to point at the URLTest group — restores auto best-ping mode
            local proxies selector urltest_grp payload
            proxies=$(clash_request "/proxies")
            selector=$(get_selector_tag "$proxies")
            # Search URLTest only within current selector's all[] — not globally
            urltest_grp=$(echo "$proxies" | jq -r \
                --arg sel "$selector" \
                '. as $root | $root.proxies[$sel].all[]? |
                 select($root.proxies[.].type == "URLTest")' \
                2>/dev/null | head -1)
            if [ -n "$urltest_grp" ]; then
                payload=$(jq -n -c --arg name "$urltest_grp" '{name:$name}')
                clash_request "/proxies/${selector}" "PUT" "$payload" >/dev/null
                logger -t podkop-bot "Audit: ${audit_str} -> auto urltest via ${urltest_grp}"
            fi
            _handle_proxy "proxy_menu" "$mid" "" ""
            ;;

        "do_px_"*)
            local p_idx="${cmd#do_px_}" ret_page=0 proxies selector proxy_name payload
            ret_page=$(( ${cmd#do_px_} / per_page ))
            proxies=$(clash_request "/proxies"); selector=$(get_selector_tag "$proxies")
            proxy_name=$(echo "$proxies" | jq -r --arg sel "$selector" --arg idx "$p_idx" \
                '.proxies[$sel].all[$idx|tonumber] // empty')
            payload=$(jq -n -c --arg name "$proxy_name" '{name:$name}')
            clash_request "/proxies/${selector}" "PUT" "$payload" >/dev/null
            _handle_proxy "proxy_menu_p_${ret_page}" "$mid" "" ""
            ;;

        "ask_del_px_"*)
            local p_idx="${cmd#ask_del_px_}" p_name p_display_name raw_link text kb proxies selector

            proxies=$(clash_request "/proxies"); selector=$(get_selector_tag "$proxies")
            p_name=$(echo "$proxies" | jq -r --arg sel "$selector" --arg idx "$p_idx" \
                '.proxies[$sel].all[$idx|tonumber] // empty')

            # Always find the full original link by server:port matching.
            # Do NOT use get_selector_link_by_index(tag_idx) — tag format "main-N-out"
            # assumes sing-box config order == UCI list order, which is false after
            # any add/remove. Wrong index silently deletes a DIFFERENT proxy.
            # server:port from TAG_URI_CACHE is unique per outbound and order-independent.
            local _cached_uri _srv_port _sec
            _sec=$(get_active_section)
            _cached_uri=$(get_uri_by_tag "$p_name")

            if [ -n "$_cached_uri" ] && [ "$_cached_uri" != "N/A" ]; then
                _srv_port=$(extract_server_port_from_uri "$_cached_uri")
                if [ -n "$_srv_port" ] && [ "$_srv_port" != "N/A" ]; then
                    [ -f "$UCI_LINKS_CACHE" ] || build_uci_links_cache
                    raw_link=$(grep -m1 \
                        "@${_srv_port}[/?#]\|@${_srv_port}$\|://${_srv_port}[/?#]\|://${_srv_port}$" \
                        "$UCI_LINKS_CACHE" 2>/dev/null)
                    if [ -z "$raw_link" ]; then
                        local _raw_uci
                        _raw_uci=$(uci -q show ${PODKOP_UCI}.${_sec}.selector_proxy_links 2>/dev/null | cut -d= -f2-)
                        if [ -n "$_raw_uci" ]; then
                            { _ucl=$(uci_list_clean "$_raw_uci"); eval "set -- $_ucl"; }
                            for _link in "$@"; do
                                case "$_link" in
                                    *"@${_srv_port}"*|*"@${_srv_port}/"*|*"@${_srv_port}#"*|\
                                    *"://${_srv_port}"*|*"://${_srv_port}/"*|*"://${_srv_port}#"*)
                                        raw_link="$_link"; break ;;
                                esac
                            done
                        fi
                    fi
                fi
            fi

            if [ -z "$raw_link" ]; then
                send_or_edit "$mid" "$(printf '%s <b>Cannot resolve link for deletion.</b>\n<i>Caches may be stale — try Reload Podkop first.</i>' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"px_view_${p_idx}\"}]]}"
                return
            fi
            # Store link in STATE_FILE keyed by clash index so do_del_px_confirmed_N
            # can verify it's reading the right entry even if STATE_FILE was recycled.
            printf '%s\n%s\n' "$p_idx" "$raw_link" > "$STATE_FILE"
            p_display_name=$(html_escape "$(display_proxy_name "$p_name")")
            text=$(printf '%s <b>Confirm Delete</b>\n\nSection <code>%s</code>:\n<code>%s</code>' "$E_WARN" "$sec" "$p_display_name")
            # Callback carries the clash index — no reliance on STATE_FILE alone
            kb="{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Delete\",\"callback_data\":\"do_del_px_confirmed_${p_idx}\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"px_view_${p_idx}\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "do_del_px_confirmed_"*)
            local p_idx="${cmd#do_del_px_confirmed_}" raw_link state_idx ret_page=0
            # Read link from STATE_FILE and cross-check that the stored index matches.
            # If STATE_FILE was recycled (parallel action), re-resolve by server:port.
            state_idx=$(sed -n '1p' "$STATE_FILE" 2>/dev/null)
            raw_link=$(sed -n '2p' "$STATE_FILE" 2>/dev/null)
            rm -f "$STATE_FILE"

            # Index mismatch or empty STATE_FILE — re-resolve the link
            if [ -z "$raw_link" ] || [ "$state_idx" != "$p_idx" ]; then
                local proxies selector p_name _cached_uri _srv_port _sec
                _sec=$(get_active_section)
                proxies=$(clash_request "/proxies"); selector=$(get_selector_tag "$proxies")
                p_name=$(echo "$proxies" | jq -r --arg sel "$selector" --arg idx "$p_idx" \
                    '.proxies[$sel].all[$idx|tonumber] // empty')
                _cached_uri=$(get_uri_by_tag "$p_name")
                if [ -n "$_cached_uri" ] && [ "$_cached_uri" != "N/A" ]; then
                    _srv_port=$(extract_server_port_from_uri "$_cached_uri")
                    if [ -n "$_srv_port" ] && [ "$_srv_port" != "N/A" ]; then
                        [ -f "$UCI_LINKS_CACHE" ] || build_uci_links_cache
                        raw_link=$(grep -m1 \
                            "@${_srv_port}[/?#]\|@${_srv_port}$\|://${_srv_port}[/?#]\|://${_srv_port}$" \
                            "$UCI_LINKS_CACHE" 2>/dev/null)
                        if [ -z "$raw_link" ]; then
                            local _raw_uci _pmode
                            _pmode=$(get_section_type "${_sec}")
                            [ "$_pmode" = "proxy:urltest" ] && \
                                _raw_uci=$(uci -q show ${PODKOP_UCI}.${_sec}.urltest_proxy_links 2>/dev/null | cut -d= -f2-) || \
                                _raw_uci=$(uci -q show ${PODKOP_UCI}.${_sec}.selector_proxy_links 2>/dev/null | cut -d= -f2-)
                            if [ -n "$_raw_uci" ]; then
                                { _ucl=$(uci_list_clean "$_raw_uci"); eval "set -- $_ucl"; }
                                for _link in "$@"; do
                                    case "$_link" in
                                        *"@${_srv_port}"*|*"://${_srv_port}"*)
                                            raw_link="$_link"; break ;;
                                    esac
                                done
                            fi
                        fi
                    fi
                fi
            fi

            # Also check urltest_proxy_links if selector search failed
            if [ -z "$raw_link" ]; then
                local _raw_uci_ut
                _raw_uci_ut=$(uci -q show ${PODKOP_UCI}.${_sec:-$(get_active_section)}.urltest_proxy_links 2>/dev/null | cut -d= -f2-)
                if [ -n "$_raw_uci_ut" ]; then
                    { _ucl=$(uci_list_clean "$_raw_uci_ut"); eval "set -- $_ucl"; }
                    for _link in "$@"; do
                        case "$_link" in
                            *"@${_srv_port}"*|*"://${_srv_port}"*)
                                raw_link="$_link"; break ;;
                        esac
                    done
                fi
            fi

            if [ -z "$raw_link" ]; then
                send_or_edit "$mid" "$(printf '%s <b>Delete failed!</b>\nCould not resolve link. Try Reload Podkop.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_menu\"}]]}"
                return
            fi
            [ -n "$p_idx" ] && ret_page=$(( p_idx / per_page ))
            local _del_sec; _del_sec=$(get_active_section)
            local _del_mode; _del_mode=$(get_section_type "${_del_sec}")
            # Plus stores ALL manual links in selector_proxy_links (urltest is a
            # flag, not a separate list), so deletion must target the same field
            # the add path used — regardless of mode. Otherwise the link lives in
            # selector_proxy_links while del_list hits urltest_proxy_links and the
            # link stays. Non-plus variants keep mode-based key selection.
            local _del_key
            if [ "$PODKOP_VARIANT" = "plus" ]; then
                _del_key="selector_proxy_links"
            elif [ "$_del_mode" = "proxy:urltest" ]; then
                _del_key="urltest_proxy_links"
            else
                _del_key="selector_proxy_links"
            fi
            uci del_list ${PODKOP_UCI}.${_del_sec}.${_del_key}="$raw_link"
            uci_commit_safe ${PODKOP_UCI}
            send_or_edit "$mid" "$(printf '%s <b>Applying...</b>' "$E_RST")" ""
            safe_reload_podkop "force"; sleep 1
            _handle_proxy "proxy_menu_p_${ret_page}" "$mid" "" ""
            ;;

        "cmd_proxy_add")
            # On Plus, subscription + manual links coexist, so allow Add even on
            # a subscription section (link goes to selector_proxy_links). Other
            # variants: subscription section is exclusive — block manual add.
            if [ "$PODKOP_VARIANT" != "plus" ] && section_is_subscription "$sec"; then
                send_or_edit "$mid" \
                    "$(printf '%s This is a subscription section — servers are managed automatically.\nTo change the source, use <b>Edit Subscription URL</b>.' "$E_WARN")" \
                    "{\"inline_keyboard\":[[{\"text\":\"✏️ Edit Subscription URL\",\"callback_data\":\"cmd_edit_sub_url\"},{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_menu\"}]]}"
                return
            fi
            echo "wait_proxy_link" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Send outbound link.</b>\n<i>vless://, vmess://, ss://, trojan://, hy2://, socks5://…</i>' "$E_EDIT")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"proxy_menu\"}]]}"
            ;;

        "cmd_edit_sub_url")
            # Prompt user to send a new subscription URL for the active section
            _variant_has_subscription || {
                send_or_edit "$mid" "$(printf '%s Subscription management is not supported for this variant.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_menu\"}]]}"
                return
            }
            local _ese_sec; _ese_sec=$(get_active_section)
            section_is_subscription "$_ese_sec" || {
                send_or_edit "$mid" "$(printf '%s This section is not subscription-managed.' "$E_WARN")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_menu\"}]]}"
                return
            }
            local _ese_urls="" _eu_line
            while IFS= read -r _eu_line; do
                [ -z "$_eu_line" ] && continue
                local _eu_short; _eu_short=$(printf '%s' "$_eu_line" | cut -c1-67)
                [ "$(printf '%s' "$_eu_line" | wc -c | tr -d ' ')" -gt 67 ] && _eu_short="${_eu_short}..."
                _ese_urls="${_ese_urls}  <code>$(html_escape "$_eu_short")</code>
"
            done <<ESUURLS
$(get_subscription_urls "$_ese_sec" | head -3)
ESUURLS
            [ -z "$_ese_urls" ] && _ese_urls="  <i>none configured</i>"
            printf '%s' "wait_sub_url_${_ese_sec}" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Edit Subscription URL</b>\n\n<b>Current URL(s):</b>\n%s\n\nSend the new subscription URL.\n<i>http:// or https:// required.\nFor Plus: replaces all existing URLs.\nFor Evolution/NetShift: replaces the single URL.</i>' \
                    "$E_EDIT" "$_ese_urls")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"proxy_menu\"}]]}"
            ;;

        do_confirm_sub_url_*)
            # Execute the confirmed subscription URL replacement
            local _conf_sec="${cmd#do_confirm_sub_url_}"
            # Validate STATE_FILE header matches this section before reading URL
            local _state_head _pending_url
            _state_head=$(head -n 1 "$STATE_FILE" 2>/dev/null)
            if [ "$_state_head" != "pending_sub_url_${_conf_sec}" ]; then
                rm -f "$STATE_FILE"
                send_or_edit "$mid" "$(printf '%s Session expired or mismatched. Please try again.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_menu\"}]]}"
                return
            fi
            _pending_url=$(sed -n '2p' "$STATE_FILE" 2>/dev/null)
            rm -f "$STATE_FILE"
            if [ -z "$_pending_url" ]; then
                send_or_edit "$mid" "$(printf '%s Session expired. Please try again.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_menu\"}]]}"
                return
            fi
            send_or_edit "$mid" "$(printf '%s <b>Applying...</b>' "$E_RST")" ""
            if [ "$PODKOP_VARIANT" = "evolution" ] || [ "$PODKOP_VARIANT" = "netshift" ]; then
                # NetShift may have multiple subscription URLs (UCI list).
                # Warn user if replacing multiple URLs with one.
                local _ns_url_count
                _ns_url_count=$(uci -q show ${PODKOP_UCI}.${_conf_sec}.subscription_url 2>/dev/null \
                    | grep -c "subscription_url=" 2>/dev/null || echo 0)
                if [ "${_ns_url_count:-0}" -gt 1 ] 2>/dev/null; then
                    send_message "$(printf '%s <b>Warning:</b> section has %s subscription URLs.\nAll will be replaced. Use LuCI to manage multiple URLs.' \
                        "$E_WARN" "$_ns_url_count")" ""
                    sleep 1
                fi
                uci -q delete ${PODKOP_UCI}.${_conf_sec}.subscription_url 2>/dev/null || true
                uci add_list ${PODKOP_UCI}.${_conf_sec}.subscription_url="$_pending_url"
            else
                # Plus: list field — replace all existing entries
                uci -q delete ${PODKOP_UCI}.${_conf_sec}.subscription_urls 2>/dev/null || true
                uci add_list ${PODKOP_UCI}.${_conf_sec}.subscription_urls="$_pending_url"
            fi
            if ! uci_commit_safe ${PODKOP_UCI}; then
                send_message "$(printf '%s <b>UCI commit failed.</b>\nCheck logs.' "$E_ERR")" ""
                return
            fi
            safe_reload_podkop "force"; sleep 2
            send_message "$(printf '%s <b>Subscription URL updated.</b>\nSection: <code>%s</code>\nPodkop will fetch the new subscription on next update cycle.' \
                "$E_OK" "$_conf_sec")" ""
            _handle_proxy "proxy_menu" "$mid" "" ""
            ;;
    esac
}

# ------------------------------------------------------------------------------
# 9.2b: URL Links Handler (proxy_config_type=url)
# Edits proxy_string (the real podkop UCI key for url mode).
# proxy_string is a multiline textarea — one proxy URL per line.
# Outbound info screen (proxy_config_type=outbound) - redirect to LuCI/console.
# ------------------------------------------------------------------------------
_handle_url_links() {
    local cmd="$1" mid="$2" text="$3" state="$4"
    local sec=$(get_active_section)
    local per_page=8

    if [ "$cmd" = "STATE_INPUT" ]; then
        rm -f "$STATE_FILE"
        if [ "$state" = "wait_url_link" ]; then
            delete_message "$mid"
            local safe_link
            safe_link=$(printf "%s" "$text" | tr -d '\r\n' | sed 's/[[:space:]]//g')
            if [ -z "$safe_link" ]; then
                send_message "$(printf '%s <b>Empty input.</b>' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"url_links_menu\"}]]}"
            elif ! echo "$safe_link" | grep -qE '^(vless|vmess|ss|trojan|hy2|hysteria2|socks|socks4|socks4a|socks5)://'; then
                send_message "$(printf '%s <b>Invalid protocol!</b>\n<i>vless, vmess, ss, trojan, hy2, socks5…</i>' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"url_links_menu\"}]]}"
            elif get_url_proxy_links "$sec" | grep -qxF "$safe_link"; then
                send_message "$(printf '%s <b>Duplicate!</b>\nThis link is already in the list.' "$E_WARN")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"url_links_menu\"}]]}"
            else
                # Replace proxy_string entirely — Single URL mode means one URL only
                uci set ${PODKOP_UCI}.${sec}.proxy_string="$safe_link"
                uci_commit_safe ${PODKOP_UCI}
                send_message "$(printf '%s <b>Applying...</b>' "$E_RST")" ""
                safe_reload_podkop "force"; sleep 1
                _handle_url_links "url_links_menu" "" "" ""
            fi
        fi
        return
    fi

    case "$cmd" in
        url_links_menu|url_links_p_*)
            rm -f "$STATE_FILE"
            local page=0 link_list total total_pages
            local start_idx end_idx rows list_text nav_row kb abs_idx
            local short human

            [ "$cmd" != "url_links_menu" ] && page="${cmd#url_links_p_}"

            # Load URLs from proxy_string (one per line, skip empty)
            link_list=$(get_url_proxy_links "$sec")
            if [ -z "$link_list" ]; then
                total=0
            else
                total=$(printf '%s\n' "$link_list" | grep -c .)
            fi

            total_pages=$(( (total + per_page - 1) / per_page ))
            [ "$total_pages" -eq 0 ] && total_pages=1
            [ "$page" -ge "$total_pages" ] && page=$((total_pages - 1))
            [ "$page" -lt 0 ] && page=0
            start_idx=$(( page * per_page ))
            end_idx=$(( start_idx + per_page ))
            [ "$end_idx" -gt "$total" ] && end_idx="$total"

            # Get active proxy info FIRST — need icon for list button
            local _ul_delay_txt _ul_verdict _ul_name _ul_probe_row="" _ul_icon
            local _ul_sec _ul_ms
            _ul_sec=$(get_active_section)
            local _ul_proxies _ul_sel _ul_delay_raw
            _ul_proxies=$(clash_request "/proxies")
            _ul_sel=$(get_selector_tag "$_ul_proxies")
            # Clash API has delay for main-out directly in url mode
            _ul_delay_raw=$(printf '%s' "$_ul_proxies" | jq -r \
                --arg sel "$_ul_sel" '.proxies[$sel].history[-1].delay // 0' 2>/dev/null)
            local _ul_ps
            _ul_ps=$(uci -q get ${PODKOP_UCI}.${_ul_sec}.proxy_string 2>/dev/null | head -1)
            case "$_ul_ps" in
                *#?*) _ul_name=$(url_decode "${_ul_ps##*#}") ;;
                *@*)  _ul_name=$(echo "$_ul_ps" | sed 's|.*@||;s|[/?].*||' | cut -c1-25) ;;
                *)    _ul_name="proxy" ;;
            esac
            if [ -z "$_ul_delay_raw" ] || [ "$_ul_delay_raw" = "0" ]; then
                _ul_delay_txt="N/A"; _ul_verdict="Untested"; _ul_icon="$E_YLW"
                _ul_probe_row="[{\"text\":\"${E_MICRO} Probe Active Outbound\",\"callback_data\":\"ask_probe_outbound_url\"}],"
            else
                _ul_ms="$_ul_delay_raw"
                _ul_delay_txt="${_ul_ms}ms"
                if   [ "$_ul_ms" -lt 150 ]; then _ul_verdict="${E_ON} Excellent";   _ul_icon="$E_ON"
                elif [ "$_ul_ms" -lt 200 ]; then _ul_verdict="${E_ON} Good";        _ul_icon="$E_ON"
                elif [ "$_ul_ms" -lt 500 ]; then _ul_verdict="${E_YLW} Acceptable"; _ul_icon="$E_YLW"
                elif [ "$_ul_ms" -lt 900 ]; then _ul_verdict="${E_ORNG} Slow but usable"; _ul_icon="$E_ORNG"
                else                              _ul_verdict="${E_RED} High latency"; _ul_icon="$E_RED"; fi
                _ul_probe_row="[{\"text\":\"${E_MICRO} Probe Active Outbound\",\"callback_data\":\"ask_probe_outbound_url\"}],"
            fi

            rows=""; list_text=""; abs_idx=0
            local line_n=0
            if [ "$total" -gt 0 ]; then
                while IFS= read -r link; do
                    [ -z "$link" ] && continue
                    if [ "$line_n" -ge "$start_idx" ] && [ "$line_n" -lt "$end_idx" ]; then
                        local disp proto host
                        proto=$(echo "$link" | cut -d: -f1)
                        host=$(echo "$link" | sed 's|.*@||; s|/.*||; s|?.*||' | cut -c1-30)
                        disp="${proto}://...${host}"
                        human=$(json_escape "$disp")
                        list_text=$(printf '%s\n<code>[%s]</code> %s' "$list_text" "$line_n" "$disp")
                        rows="${rows}[{\"text\":\"${E_DEL} [${line_n}] ${human}\",\"callback_data\":\"ask_del_ul_${line_n}\"}],"
                    fi
                    line_n=$((line_n + 1))
                done <<EOF
$link_list
EOF
            fi

            kb="{\"inline_keyboard\":[${rows}${nav_row}[{\"text\":\"${E_ADD} Set URL\",\"callback_data\":\"cmd_url_link_add\"},{\"text\":\"${E_RST} Refresh\",\"callback_data\":\"url_links_menu\"}],${_ul_probe_row}[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_menu\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            text=$(cat <<EOF
${E_GLOB} <b>Single URL Proxy</b> [<code>${sec}</code>]
<b>Active:</b> $(html_escape "$_ul_name") | ${_ul_delay_txt} — ${_ul_verdict}

${list_text}

<i>Tap [${E_DEL}] to remove the current URL. Use Set URL to replace it.</i>
EOF
)
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "cmd_url_link_add")
            echo "wait_url_link" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Set Single URL Proxy</b>\n\nSend the proxy link:\n<i>(vless://, hy2://, ss://, trojan://, vmess://, socks://)</i>\n\nThis replaces any existing URL.' "$E_EDIT")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"url_links_menu\"}]]}"
            ;;

        "ask_del_ul_"*)
            local idx="${cmd#ask_del_ul_}"
            local link_to_del="" ln=0
            while IFS= read -r link; do
                [ -z "$link" ] && continue
                if [ "$ln" -eq "$idx" ]; then link_to_del="$link"; break; fi
                ln=$((ln + 1))
            done <<EOF
$(get_url_proxy_links "$sec")
EOF
            if [ -z "$link_to_del" ]; then
                send_or_edit "$mid" "$(printf '%s Entry not found.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"url_links_menu\"}]]}"
                return
            fi
            local disp_link
            disp_link=$(echo "$link_to_del" | cut -d: -f1)://...$(echo "$link_to_del" | sed 's|.*@||; s|/.*||; s|?.*||' | cut -c1-30)
            send_or_edit "$mid" \
                "$(printf '%s <b>Remove this link?</b>\n\n<code>%s</code>\n\n[%s] from section <code>%s</code>' "$E_WARN" "$(html_escape "$disp_link")" "$idx" "$sec")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Remove\",\"callback_data\":\"do_del_ul_${idx}\"},{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"url_links_menu\"}]]}"
            ;;

        "do_del_ul_"*)
            local idx="${cmd#do_del_ul_}"
            local ln=0 new_val="" link
            while IFS= read -r link; do
                [ -z "$link" ] && continue
                if [ "$ln" -ne "$idx" ]; then
                    if [ -z "$new_val" ]; then new_val="$link"
                    else new_val=$(printf '%s\n%s' "$new_val" "$link"); fi
                fi
                ln=$((ln + 1))
            done <<EOF
$(get_url_proxy_links "$sec")
EOF
            send_or_edit "$mid" "$(printf '%s <b>Removed. Applying...</b>' "$E_RST")" ""
            if [ -z "$new_val" ]; then
                uci -q delete ${PODKOP_UCI}.${sec}.proxy_string
            else
                uci set ${PODKOP_UCI}.${sec}.proxy_string="$new_val"
            fi
            uci_commit_safe ${PODKOP_UCI}
            safe_reload_podkop "force"; sleep 1
            _handle_url_links "url_links_menu" "$mid" "" ""
            ;;

        "outbound_info")
            rm -f "$STATE_FILE"
            local luci_ip
            luci_ip=$(uci -q get network.lan.ipaddr 2>/dev/null || echo "192.168.1.1")
            send_or_edit "$mid" \
                "$(printf '%s <b>Outbound Config mode</b>\n\nThis mode requires editing raw sing-box JSON.\nEditing JSON via Telegram is error-prone and not supported by the bot.\n\n<b>Please use LuCI or console instead:</b>\n\n<b>LuCI:</b> <code>http://%s/cgi-bin/luci/admin/services/podkop</code>\n<b>SSH:</b> <code>uci set ${PODKOP_UCI}.%s.outbound_json=...</code>\n\n<i>After editing in LuCI/console, use Reload Podkop in the bot to apply.</i>' "$E_WARN" "$luci_ip" "$sec")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_RST} Reload Podkop\",\"callback_data\":\"ask_reload_podkop\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"main_menu\"}]]}"
            ;;
    esac
}
# ------------------------------------------------------------------------------
# 9.3: Core Podkop Settings
# ------------------------------------------------------------------------------
_handle_settings() {
    local cmd="$1" mid="$2" text="$3" state="$4"
    local sec=$(get_active_section)

    case "$cmd" in
        "main_settings_menu")
            rm -f "$STATE_FILE"
            local text kb
            text=$(cat <<EOF
${E_SET} <b>Podkop Settings</b> [<code>${sec}</code>]

Select a category to manage:
EOF
)
            kb="{\"inline_keyboard\":[
                [{\"text\":\"${E_SET} Section Settings\",\"callback_data\":\"section_settings\"}],
                [{\"text\":\"${E_GLOB} Global Settings\",\"callback_data\":\"global_settings\"}],
                [{\"text\":\"${E_CLIP} Sections\",\"callback_data\":\"sections_menu\"}],
                [{\"text\":\"${E_FILE} Routing & Lists\",\"callback_data\":\"community_lists\"}],
                [{\"text\":\"${E_BACK} Back\",\"callback_data\":\"/menu\"}]
            ]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "advanced_settings")
            # v0.15.1: advanced_settings split into section_settings + global_settings.
            # Redirect to section_settings for back-compat with saved buttons.
            _handle_settings "section_settings" "$mid" "$cid" "$cb_id"
            ;;

        "section_settings")
            rm -f "$STATE_FILE"
            # Redirect zapret/byedpi sections to their own menu
            if [ "$PODKOP_VARIANT" = "plus" ]; then
                local _sec_action; _sec_action=$(uci -q get ${PODKOP_UCI}.${sec}.action 2>/dev/null)
                case "$_sec_action" in
                    zapret|byedpi)
                        _handle_settings "${_sec_action}_section_menu" "$mid" "$cid" "$cb_id"
                        return ;;
                esac
            fi
            local proxy_mode conn_type mixed_en mixed_port proxy_mode_disp
            local mode_hint conn_hint autostart_btn autostart_lbl text kb

            proxy_mode=$(get_section_type "$sec")
            conn_type=$(get_section_type "$sec" | cut -d: -f1)
            proxy_mode_disp="${proxy_mode#proxy:}"
            mixed_en=$(get_uci_bool_emoji "${PODKOP_UCI}.${sec}" "mixed_proxy_enabled")
            mixed_port=$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_port || echo "2080")

            local mode_hint conn_hint
            case "$proxy_mode" in
                proxy:selector)     mode_hint="${E_IDEA} <i>Selector: manually choose the active proxy.</i>" ;;
                proxy:urltest)      mode_hint="${E_IDEA} <i>URLTest: sing-box auto-picks the fastest proxy.</i>" ;;
                proxy:url)          mode_hint="${E_IDEA} <i>URL: single proxy_string connection.</i>" ;;
                proxy:subscription) mode_hint="${E_IDEA} <i>Subscription: server list auto-managed.</i>" ;;
                outbound)           mode_hint="${E_IDEA} <i>Outbound: raw sing-box JSON config.</i>" ;;
                *)                  mode_hint="" ;;
            esac
            case "$conn_type" in
                proxy)     conn_hint="${E_IDEA} <i>Proxy: route matched traffic through VPN tunnel.</i>" ;;
                vpn)       conn_hint="${E_IDEA} <i>VPN: full tunnel mode, all traffic goes through VPN.</i>" ;;
                block)     conn_hint="${E_IDEA} <i>Block: matched traffic is blocked.</i>" ;;
                exclusion) conn_hint="${E_IDEA} <i>Exclusion: matched traffic bypasses the tunnel.</i>" ;;
                *)         conn_hint="" ;;
            esac

            if ${PODKOP_INIT} enabled >/dev/null 2>&1; then
                autostart_btn="${E_ON} Autostart ON"; autostart_lbl="ask_toggle_autostart_off"
            else
                autostart_btn="${E_OFF} Autostart OFF"; autostart_lbl="ask_toggle_autostart_on"
            fi

            text=$(cat <<EOF
${E_SET} <b>Section Settings</b> [<code>${sec}</code>]
<code>────────────────────</code>
<b>Connection:</b> <code>${conn_type}</code>  ${conn_hint}
<b>Mode:</b> <code>${proxy_mode_disp}</code>  ${mode_hint}
<code>────────────────────</code>
<b>Mixed Proxy:</b> ${mixed_en} port <code>${mixed_port}</code>
EOF
)
            kb="{\"inline_keyboard\":["
            kb="${kb}[{\"text\":\"Conn: ${conn_type}\",\"callback_data\":\"conn_type_menu\"},{\"text\":\"${E_TGT} Mode: ${proxy_mode_disp}\",\"callback_data\":\"proxy_mode_menu\"}],"
            kb="${kb}[{\"text\":\"${mixed_en} Mixed Proxy\",\"callback_data\":\"ask_toggle_mixed\"},{\"text\":\"${E_EDIT} Port: ${mixed_port}\",\"callback_data\":\"cmd_set_mixed_port\"}],"
            # Plus: add URLTest Filters button when urltest mode active
            local _uf_btn=""
            [ "$PODKOP_VARIANT" = "plus" ] && [ "$proxy_mode" = "proxy:urltest" ] && _uf_btn="yes"
            kb="${kb}[{\"text\":\"${E_TGT} URLTest\",\"callback_data\":\"urltest_settings\"},{\"text\":\"${E_NET} Resolver\",\"callback_data\":\"domain_resolver_settings\"}],"
            [ -n "$_uf_btn" ] && kb="${kb}[{\"text\":\"🔬 URLTest Filters (country/regex)\",\"callback_data\":\"urltest_filters_menu\"}],"
            kb="${kb}[{\"text\":\"${autostart_btn}\",\"callback_data\":\"${autostart_lbl}\"}],"
            kb="${kb}[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"main_settings_menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "zapret_section_menu"|"byedpi_section_menu")
            # DPI bypass section menu — shown when active section has action=zapret or action=byedpi
            rm -f "$STATE_FILE"
            local dpi_type sec_action dpi_status_json dpi_icon dpi_running dpi_ver dpi_strategy text kb
            sec_action=$(uci -q get ${PODKOP_UCI}.${sec}.action 2>/dev/null)
            local _en; _en=$(uci -q get ${PODKOP_UCI}.${sec}.enabled 2>/dev/null); [ -z "$_en" ] && _en="1"

            if [ "$sec_action" = "zapret" ]; then
                dpi_type="Zapret"
                dpi_strategy=$(uci -q get ${PODKOP_UCI}.${sec}.nfqws_opt 2>/dev/null || echo "not set")
                if _plus_has_cmd "get_zapret_status"; then
                    dpi_status_json=$(_plus_json get_zapret_status)
                    dpi_running=$(printf '%s' "$dpi_status_json" | jq -r '.running_process_count // 0' 2>/dev/null)
                    dpi_ver=$(printf '%s' "$dpi_status_json" | jq -r '.version // ""' 2>/dev/null)
                    local _ready; _ready=$(printf '%s' "$dpi_status_json" | jq -r '.ready // false' 2>/dev/null)
                    [ "$_ready" = "true" ] && dpi_icon="${E_OK}" || dpi_icon="${E_ERR}"
                else
                    dpi_icon="${E_OFF}"; dpi_running="?"; dpi_ver="?"
                fi
            else
                dpi_type="ByeDPI"
                dpi_strategy=$(uci -q get ${PODKOP_UCI}.${sec}.byedpi_cmd_opts 2>/dev/null || echo "not set")
                if _plus_has_cmd "get_byedpi_status"; then
                    dpi_status_json=$(_plus_json get_byedpi_status)
                    dpi_running=$(printf '%s' "$dpi_status_json" | jq -r '.running_process_count // 0' 2>/dev/null)
                    dpi_ver=$(printf '%s' "$dpi_status_json" | jq -r '.version // ""' 2>/dev/null)
                    local _ready; _ready=$(printf '%s' "$dpi_status_json" | jq -r '.ready // false' 2>/dev/null)
                    [ "$_ready" = "true" ] && dpi_icon="${E_OK}" || dpi_icon="${E_ERR}"
                else
                    dpi_icon="${E_OFF}"; dpi_running="?"; dpi_ver="?"
                fi
            fi

            local _en_icon; [ "$_en" = "1" ] && _en_icon="${E_ON}" || _en_icon="${E_OFF}"
            local _strat_short; _strat_short=$(printf '%s' "$dpi_strategy" | cut -c1-60)
            [ ${#dpi_strategy} -gt 60 ] && _strat_short="${_strat_short}…"

            text=$(cat <<EOF
🛡 <b>${dpi_type} Section</b> [<code>${sec}</code>]
<code>────────────────────</code>
<b>Status:</b> ${dpi_icon} $([ "$dpi_running" != "0" ] && echo "running (${dpi_running} proc)" || echo "stopped")
<b>Section:</b> ${_en_icon} $([ "$_en" = "1" ] && echo "enabled" || echo "disabled")
$([ -n "$dpi_ver" ] && [ "$dpi_ver" != "?" ] && printf "<b>Version:</b> %s\n" "$dpi_ver")<b>Strategy:</b> <code>${_strat_short}</code>
EOF
)
            local _toggle_cb _toggle_lbl
            if [ "$_en" = "1" ]; then
                _toggle_lbl="${E_OFF} Disable Section"; _toggle_cb="do_dpi_toggle_${sec}_0"
            else
                _toggle_lbl="${E_ON} Enable Section";  _toggle_cb="do_dpi_toggle_${sec}_1"
            fi
            kb="{\"inline_keyboard\":[
                [{\"text\":\"${_toggle_lbl}\",\"callback_data\":\"${_toggle_cb}\"}],
                [{\"text\":\"${E_EDIT} Edit Strategy\",\"callback_data\":\"wait_dpi_strategy_${sec}\"}],
                [{\"text\":\"${E_BACK} Back\",\"callback_data\":\"main_settings_menu\"}]
            ]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "do_dpi_toggle_"*)
            # Toggle enabled for zapret/byedpi section: do_dpi_toggle_<sec>_<0|1>
            [ "$PODKOP_VARIANT" = "plus" ] || { _handle_settings "section_settings" "$mid" "" ""; return; }
            local _dt="${cmd#do_dpi_toggle_}"
            local _dt_sec="${_dt%_[01]}" _dt_val="${_dt##*_}"
            # Guard: only act if section really is zapret/byedpi
            local _dta; _dta=$(uci -q get ${PODKOP_UCI}.${_dt_sec}.action 2>/dev/null)
            case "$_dta" in
                zapret|byedpi) ;;
                *) _handle_settings "section_settings" "$mid" "" ""; return ;;
            esac
            uci set ${PODKOP_UCI}.${_dt_sec}.enabled="$_dt_val"
            uci_commit_safe ${PODKOP_UCI}
            safe_reload_podkop "force"; sleep 1
            _handle_settings "${_dta}_section_menu" "$mid" "" ""
            ;;

                "global_settings")
            rm -f "$STATE_FILE"
            local dl quic wan excl_ntp interval outbound_iface yacd_en lan_ip text kb
            local next_int

            dl=$(get_uci_bool_emoji "${PODKOP_UCI}.settings" "download_lists_via_proxy")
            quic=$(get_uci_bool_emoji "${PODKOP_UCI}.settings" "disable_quic")
            wan=$(get_uci_bool_emoji "${PODKOP_UCI}.settings" "enable_badwan_interface_monitoring")
            excl_ntp=$(get_uci_bool_emoji "${PODKOP_UCI}.settings" "exclude_ntp")
            interval=$(uci -q get ${PODKOP_UCI}.settings.update_interval || echo "1d")
            outbound_iface=$(uci -q get ${PODKOP_UCI}.settings.output_network_interface 2>/dev/null || echo "auto")
            yacd_en=$(uci -q get ${PODKOP_UCI}.settings.enable_yacd || echo "0")
            lan_ip=$(uci -q get network.lan.ipaddr || echo "127.0.0.1")

            next_int="1h"
            [ "$interval" = "1h" ]  && next_int="6h"
            [ "$interval" = "6h" ]  && next_int="12h"
            [ "$interval" = "12h" ] && next_int="1d"
            [ "$interval" = "1d" ]  && next_int="3d"
            [ "$interval" = "3d" ]  && next_int="1h"

            local yacd_url_line=""
            [ "$yacd_en" = "1" ] && yacd_url_line=$(printf '\n<b>YACD URL:</b> <code>http://%s:9090/ui</code>' "$lan_ip")

            text=$(cat <<EOF
${E_GLOB} <b>Global Settings</b>
<code>────────────────────</code>
<b>Outbound iface:</b> <code>${outbound_iface}</code>
<b>Update interval:</b> <code>${interval}</code>
<b>Disable QUIC:</b> ${quic} | <b>Excl. NTP:</b> ${excl_ntp}
<b>DL via Proxy:</b> ${dl} | <b>Bad WAN:</b> ${wan}
<b>YACD:</b> $([ "$yacd_en" = "1" ] && echo "${E_ON} Enabled" || echo "${E_OFF} Disabled")${yacd_url_line}
EOF
)
            kb="{\"inline_keyboard\":["
            kb="${kb}[{\"text\":\"${E_NET} Outbound: ${outbound_iface}\",\"callback_data\":\"cmd_set_outbound_iface\"},{\"text\":\"Update: ${interval}\",\"callback_data\":\"set_update_int_${next_int}\"}],"
            kb="${kb}[{\"text\":\"${quic} Disable QUIC\",\"callback_data\":\"ask_toggle_quic\"},{\"text\":\"${excl_ntp} Excl. NTP\",\"callback_data\":\"ask_toggle_ntp\"}],"
            kb="${kb}[{\"text\":\"${dl} DL via Proxy\",\"callback_data\":\"ask_toggle_dl\"},{\"text\":\"${wan} Bad WAN\",\"callback_data\":\"ask_toggle_wan\"}],"
            kb="${kb}[{\"text\":\"${E_NET} DNS\",\"callback_data\":\"dns_settings\"},{\"text\":\"${E_STAT} YACD: $([ "$yacd_en" = "1" ] && echo "ON" || echo "OFF")\",\"callback_data\":\"ask_toggle_yacd\"}],"
            kb="${kb}[{\"text\":\"${E_SCAN} Bad WAN Details\",\"callback_data\":\"badwan_details\"}],"
            kb="${kb}[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"main_settings_menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "proxy_mode_menu")
            local current_mode
            current_mode=$(get_section_type "$sec")
            local current_mode_short; current_mode_short="${current_mode#proxy:}"
            local pm_txt kb_pm
            local _pm_modes _pm_desc _pm_src_line=""
            if [ "$PODKOP_VARIANT" = "plus" ]; then
                _pm_modes="selector urltest"
                # Plus: mode is the urltest_enabled flag, NOT get_section_type
                # (which is overridden to 'subscription' when a sub URL exists).
                # Without this the active button never gets a checkmark.
                local _ut_flag; _ut_flag=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_enabled 2>/dev/null)
                if [ "$_ut_flag" = "1" ]; then current_mode_short="urltest"; else current_mode_short="selector"; fi
                # Subscription is a SOURCE shown alongside the mode, not a mode itself.
                if section_is_subscription "$sec"; then
                    local _pm_n; _pm_n=$(get_subscription_server_count "$sec")
                    _pm_src_line=$(printf '\n%s <b>Source:</b> subscription (%s servers)' "$E_LINK" "$_pm_n")
                fi
                _pm_desc="<b>selector</b> — manual proxy selection\n<b>urltest</b> — auto best-ping (toggle urltest_enabled)"
            else
                _pm_modes="url selector urltest outbound"
                _pm_desc="<b>url</b> — single proxy URL (proxy_string)\n<b>selector</b> — manual proxy selection\n<b>urltest</b> — auto best-ping selection\n<b>outbound</b> — raw sing-box JSON (LuCI/console only)"
            fi
            pm_txt=$(printf '%s <b>Proxy Mode</b> [<code>%s</code>]\n\nCurrent: <code>%s</code>%s\n\n%s' \
                "$E_TGT" "$sec" "$current_mode_short" "$_pm_src_line" "$_pm_desc")
            kb_pm="{\"inline_keyboard\":[["
            for _m in $_pm_modes; do
                if [ "$_m" = "$current_mode_short" ]; then
                    kb_pm="${kb_pm}{\"text\":\"${E_OK} ${_m}\",\"callback_data\":\"proxy_mode_menu\"},"
                else
                    kb_pm="${kb_pm}{\"text\":\"${_m}\",\"callback_data\":\"ask_switch_mode_${_m}\"},"
                fi
            done
            # Remove trailing comma, close row and add back button
            kb_pm="${kb_pm%,}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"section_settings\"}]]}"
            send_or_edit "$mid" "$pm_txt" "$kb_pm"
            ;;

        "ask_switch_mode_"*)
            local target_mode="${cmd#ask_switch_mode_}"
            local current_mode warn_txt kb
            current_mode=$(get_section_type "$sec")
            # Plus: 'selector'/'urltest' are the urltest_enabled flag, not get_section_type
            # (which collapses to 'subscription'). Guard against a no-op switch that would
            # trigger a pointless sing-box reload when already in the requested mode.
            if [ "$PODKOP_VARIANT" = "plus" ]; then
                local _cur_ut _cur_mode
                _cur_ut=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_enabled 2>/dev/null)
                if [ "$_cur_ut" = "1" ]; then _cur_mode="urltest"; else _cur_mode="selector"; fi
                if [ "$target_mode" = "$_cur_mode" ]; then
                    # No-op: already in this mode. Re-render the menu, skip reload.
                    _handle_settings "proxy_mode_menu" "$mid" "" ""
                    return
                fi
            fi
            case "$target_mode" in
                urltest)
                    if [ "$PODKOP_VARIANT" = "plus" ]; then
                        # Plus: urltest_enabled flag, servers come from subscription
                        local _sub_count; _sub_count=$(get_subscription_server_count "$sec")
                        warn_txt=$(printf '%s <b>Switch to URLTest mode?</b>\n\nURLTest: sing-box auto-picks the fastest proxy from subscription.\n<b>You will no longer manually select a proxy.</b>\n%s <b>%s</b> subscription server(s) available.\n\nSection: <code>%s</code>' "$E_WARN" "$E_OK" "${_sub_count:-0}" "$sec")
                    else
                        local _utl_count
                        _utl_raw=$(uci -q show ${PODKOP_UCI}.${sec}.urltest_proxy_links 2>/dev/null | cut -d= -f2-); _utl_count=0; [ -n "$_utl_raw" ] && { { _ucl=$(uci_list_clean "$_utl_raw"); eval "set -- $_ucl"; }; _utl_count=$#; }
                        if [ "${_utl_count:-0}" -eq 0 ]; then
                            warn_txt=$(printf '%s <b>Switch to URLTest mode?</b>\n\n%s <b>URLTest Proxy Links is empty!</b>\npodkop will fail to start after switching.\n\n<b>Add links first:</b> Settings → Core → URLTest → Proxy Links\n\nSection: <code>%s</code>' "$E_ERR" "$E_ERR" "$sec")
                        else
                            warn_txt=$(printf '%s <b>Switch to URLTest mode?</b>\n\nURLTest: sing-box auto-picks the fastest proxy.\n<b>You will no longer manually select a proxy.</b>\n%s <b>%s</b> URLTest link(s) ready.\n\nSection: <code>%s</code>' "$E_WARN" "$E_OK" "$_utl_count" "$sec")
                        fi
                    fi
                    ;;
                selector)
                    if [ "$PODKOP_VARIANT" = "plus" ]; then
                        # Plus: just toggle urltest_enabled off, subscription servers stay
                        local _sub_count2; _sub_count2=$(get_subscription_server_count "$sec")
                        warn_txt=$(printf '%s <b>Switch to Selector mode?</b>\n\nSelector: you manually pick the active proxy from subscription.\n%s <b>%s</b> subscription server(s) available.\n\nSection: <code>%s</code>' "$E_WARN" "$E_OK" "${_sub_count2:-0}" "$sec")
                    else
                        local _sel_count _utl_count_back
                        _sel_lraw=$(uci -q show ${PODKOP_UCI}.${sec}.selector_proxy_links 2>/dev/null | cut -d= -f2-); _sel_count=0; [ -n "$_sel_lraw" ] && { { _ucl=$(uci_list_clean "$_sel_lraw"); eval "set -- $_ucl"; }; _sel_count=$#; }
                        _utl_lraw=$(uci -q show ${PODKOP_UCI}.${sec}.urltest_proxy_links 2>/dev/null | cut -d= -f2-); _utl_count_back=0; [ -n "$_utl_lraw" ] && { { _ucl=$(uci_list_clean "$_utl_lraw"); eval "set -- $_ucl"; }; _utl_count_back=$#; }
                        if [ "${_sel_count:-0}" -eq 0 ] && [ "${_utl_count_back:-0}" -gt 0 ]; then
                            warn_txt=$(printf '%s <b>Switch to Selector mode?</b>\n\nSelector: you manually pick the active proxy.\n\n%s <b>Selector Proxy Links is empty!</b>\nURLTest has %s link(s) that can be cloned.\n\nSection: <code>%s</code>' \
                                "$E_WARN" "$E_WARN" "$_utl_count_back" "$sec")
                        else
                            warn_txt=$(printf '%s <b>Switch to Selector mode?</b>\n\nSelector: you manually pick the active proxy.\n\nSection: <code>%s</code>' \
                                "$E_WARN" "$sec")
                        fi
                    fi
                    ;;
                url)
                    local _ps; _ps=$(uci -q get ${PODKOP_UCI}.${sec}.proxy_string 2>/dev/null)
                    if [ -z "$_ps" ]; then
                        warn_txt=$(printf '%s <b>Switch to URL mode?</b>\n\n%s <b>No proxy URL configured!</b>\nIf you switch without setting a URL first, podkop will crash on reload.\n\n<b>You will be prompted to enter the URL immediately after confirming.</b>\n\nSection: <code>%s</code>' "$E_WARN" "$E_ERR" "$sec")
                    else
                        warn_txt=$(printf '%s <b>Switch to URL mode?</b>\n\nURL mode: single proxy via <code>proxy_string</code>.\nExisting selector/urltest links are preserved but inactive.\n\nCurrent URL: <code>%s</code>\n\nSection: <code>%s</code>' "$E_WARN" "$_ps" "$sec")
                    fi
                    ;;
                outbound) warn_txt=$(printf '%s <b>Switch to Outbound mode?</b>\n\nOutbound mode requires editing raw sing-box JSON via LuCI or console.\nBot cannot edit outbound JSON directly.\n\nSection: <code>%s</code>' "$E_WARN" "$sec") ;;
                *)        warn_txt=$(printf '%s Unknown mode: %s' "$E_ERR" "$target_mode") ;;
            esac
            # For urltest: add clone button when selector has links but urltest is empty
            local _kb_extra=""
            if [ "$target_mode" = "urltest" ]; then
                local _utl_c _sel_c
                _utl_raw2=$(uci -q show ${PODKOP_UCI}.${sec}.urltest_proxy_links 2>/dev/null | cut -d= -f2-); _utl_c=0; [ -n "$_utl_raw2" ] && { { _ucl=$(uci_list_clean "$_utl_raw2"); eval "set -- $_ucl"; }; _utl_c=$#; }
                # Use Clash API count — captures ALL proxies, not just those added via bot
                _sel_c=$(clash_request "/proxies" 2>/dev/null | \
                    jq -r --arg sel "$(get_selector_tag "")" '.proxies[$sel].all | length // 0' 2>/dev/null)
                if [ "${_utl_c:-0}" -eq 0 ] && [ "${_sel_c:-0}" -gt 0 ]; then
                    _kb_extra="[{\"text\":\"${E_RST} Clone ${_sel_c} links from Selector first\",\"callback_data\":\"cmd_clone_sel_to_utl\"}],"
                fi
            fi
            # For selector: add clone button when urltest has links but selector is empty
            if [ "$target_mode" = "selector" ]; then
                local _sel_c2 _utl_c2
                _sel_lraw2=$(uci -q show ${PODKOP_UCI}.${sec}.selector_proxy_links 2>/dev/null | cut -d= -f2-); _sel_c2=0; [ -n "$_sel_lraw2" ] && { { _ucl=$(uci_list_clean "$_sel_lraw2"); eval "set -- $_ucl"; }; _sel_c2=$#; }
                _utl_lraw2=$(uci -q show ${PODKOP_UCI}.${sec}.urltest_proxy_links 2>/dev/null | cut -d= -f2-); _utl_c2=0; [ -n "$_utl_lraw2" ] && { { _ucl=$(uci_list_clean "$_utl_lraw2"); eval "set -- $_ucl"; }; _utl_c2=$#; }
                if [ "${_sel_c2:-0}" -eq 0 ] && [ "${_utl_c2:-0}" -gt 0 ]; then
                    _kb_extra="[{\"text\":\"${E_RST} Clone ${_utl_c2} links from URLTest first\",\"callback_data\":\"cmd_clone_utl_to_sel\"}],"
                fi
            fi
            kb="{\"inline_keyboard\":[${_kb_extra}[{\"text\":\"${E_OK} Yes, Switch\",\"callback_data\":\"do_switch_mode_${target_mode}\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"proxy_mode_menu\"}]]}"
            send_or_edit "$mid" "$warn_txt" "$kb"
            ;;

        "do_switch_mode_"*)
            local target_mode="${cmd#do_switch_mode_}"
            # Plus has no url/outbound proxy_config_type — block stale buttons
            if [ "$PODKOP_VARIANT" = "plus" ]; then
                case "$target_mode" in
                    url|outbound)
                        send_or_edit "$mid" "$(printf '%s This mode is not available on Podkop Plus.' "$E_WARN")" \
                            "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_mode_menu\"}]]}" ; return ;;
                esac
            fi
            # Defense-in-depth: re-check list non-empty at do-stage (not only ask-stage).
            # If user ignored the warning and pressed "Yes, Switch" anyway on an empty list
            # podkop would fatal abort on reload and drop the entire tunnel.
            # url mode uses a state-machine delay (wait_url_link) — same pattern here.
            case "$target_mode" in
                url)
                    local _ps; _ps=$(uci -q get ${PODKOP_UCI}.${sec}.proxy_string 2>/dev/null)
                    if [ -z "$_ps" ]; then
                        uci set ${PODKOP_UCI}.${sec}.proxy_config_type="url"
                        uci_commit_safe ${PODKOP_UCI}
                        echo "wait_url_link" > "$STATE_FILE"
                        send_or_edit "$mid" \
                            "$(printf '%s <b>URL mode set.</b>\n\n%s <b>Reload is held</b> until you send a proxy URL.\nSend the link now (vless://, hy2://, trojan://, ss://, ...).\n\nTo cancel and revert to Selector, tap the button below.' \
                                "$E_WARN" "$E_ERR")" \
                            "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel — revert to Selector\",\"callback_data\":\"do_switch_mode_selector\"}]]}"
                        return
                    fi
                    ;;
                urltest)
                    # Plus: servers from subscription, no urltest_proxy_links to check
                    if [ "$PODKOP_VARIANT" != "plus" ]; then
                        local _utl_raw _utl_c=0
                        _utl_raw=$(uci -q show ${PODKOP_UCI}.${sec}.urltest_proxy_links 2>/dev/null | cut -d= -f2-)
                        [ -n "$_utl_raw" ] && { _ucl=$(uci_list_clean "$_utl_raw"); eval "set -- $_ucl"; _utl_c=$#; }
                        if [ "$_utl_c" -eq 0 ]; then
                            send_or_edit "$mid" \
                                "$(printf '%s <b>Refused: URLTest list is empty.</b>\n\nSwitching now would crash podkop on reload.\nAdd links first via URLTest Settings, or clone from Selector.' "$E_ERR")" \
                                "{\"inline_keyboard\":[[{\"text\":\"${E_RST} URLTest Settings\",\"callback_data\":\"urltest_settings\"},{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_mode_menu\"}]]}"
                            return
                        fi
                    fi
                    ;;
                selector)
                    # Plus: servers from subscription, no selector_proxy_links to check
                    if [ "$PODKOP_VARIANT" != "plus" ]; then
                        local _sel_raw _sel_c=0
                        _sel_raw=$(uci -q show ${PODKOP_UCI}.${sec}.selector_proxy_links 2>/dev/null | cut -d= -f2-)
                        [ -n "$_sel_raw" ] && { _ucl=$(uci_list_clean "$_sel_raw"); eval "set -- $_ucl"; _sel_c=$#; }
                        if [ "$_sel_c" -eq 0 ]; then
                            send_or_edit "$mid" \
                                "$(printf '%s <b>Refused: Selector list is empty.</b>\n\nSwitching now would crash podkop on reload.\nAdd links first, or clone from URLTest.' "$E_ERR")" \
                                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_mode_menu\"}]]}"
                            return
                        fi
                    fi
                    ;;
            esac
            # Apply mode switch — variant-aware
            if [ "$PODKOP_VARIANT" = "plus" ]; then
                # Plus uses urltest_enabled flag instead of proxy_config_type
                case "$target_mode" in
                    urltest)  uci set ${PODKOP_UCI}.${sec}.urltest_enabled="1" ;;
                    selector) uci set ${PODKOP_UCI}.${sec}.urltest_enabled="0" ;;
                esac
            else
                uci set ${PODKOP_UCI}.${sec}.proxy_config_type="$target_mode"
            fi
            uci_commit_safe ${PODKOP_UCI}
            # Invalidate caches: mode switch changes which links list is active,
            # stale TAG_NAME_CACHE/UCI_LINKS_CACHE would show old proxy names.
            rm -f "$TAG_NAME_CACHE" "$UCI_LINKS_CACHE" "$TAG_URI_CACHE"
            send_or_edit "$mid" "$(printf '%s Applying mode switch to <code>%s</code>...' "$E_RST" "$target_mode")" ""
            safe_reload_podkop "force"; sleep 1
            _handle_settings "section_settings" "$mid" "" ""
            ;;

        "set_update_int_"*) uci set ${PODKOP_UCI}.settings.update_interval="${cmd#set_update_int_}"; uci_commit_safe ${PODKOP_UCI}; _handle_settings "global_settings" "$mid" "" "" ;;
        "set_log_"*)
            # v0.15.1: log_level removed from bot UI. Use LuCI or SSH.
            send_or_edit "$mid" "$(printf '%s Log level is no longer managed by the bot.\nUse LuCI or SSH to change it.' "$E_WARN")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"global_settings\"}]]}" ;;

        "ask_toggle_dl")   send_or_edit "$mid" "$(printf '%s Toggle download lists via proxy?' "$E_WARN")"  "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes\",\"callback_data\":\"do_toggle_dl\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"global_settings\"}]]}" ;;
        "ask_toggle_quic") send_or_edit "$mid" "$(printf '%s Toggle QUIC blocking?' "$E_WARN")"             "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes\",\"callback_data\":\"do_toggle_quic\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"global_settings\"}]]}" ;;
        "ask_toggle_wan")  send_or_edit "$mid" "$(printf '%s Toggle bad WAN monitoring?' "$E_WARN")"        "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes\",\"callback_data\":\"do_toggle_wan\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"global_settings\"}]]}" ;;
        "ask_toggle_ntp")  send_or_edit "$mid" "$(printf '%s Toggle NTP exclusion?' "$E_WARN")"             "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes\",\"callback_data\":\"do_toggle_ntp\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"global_settings\"}]]}" ;;
        "ask_toggle_mixed")
            local _mp; _mp=$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_port 2>/dev/null)
            local _cur_me; _cur_me=$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_enabled 2>/dev/null || echo "0")
            local _note=""
            if [ "$_cur_me" != "1" ] && [ -z "$_mp" ]; then
                # Calculate what port would be auto-assigned
                local _used _candidate=2080
                _used=$(uci -q show ${PODKOP_UCI} 2>/dev/null \
                    | grep '\.mixed_proxy_port=' \
                    | sed "s/.*mixed_proxy_port='//;s/'$//" \
                    | grep -E '^[0-9]+$')
                while echo "$_used" | grep -qx "$_candidate"; do
                    _candidate=$((_candidate + 1))
                done
                _mp="$_candidate"
                _note="\n\n<i>Port not set — will auto-assign ${_candidate}.</i>"
            fi
            send_or_edit "$mid" "$(printf '%s Toggle Mixed Proxy (SOCKS5 listener on port %s)?%s' "$E_WARN" "${_mp:-2080}" "$_note")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes\",\"callback_data\":\"do_toggle_mixed\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"section_settings\"}]]}"
            ;;

        "conn_type_menu")
            local curr_ct
            if [ "$PODKOP_VARIANT" = "plus" ]; then
                curr_ct=$(uci -q get ${PODKOP_UCI}.${sec}.action 2>/dev/null || echo "proxy")
            else
                curr_ct=$(get_section_type "$sec" | cut -d: -f1)
            fi
            local ct_txt; ct_txt=$(printf '%s <b>Connection Type</b> [<code>%s</code>]\n\nCurrent: <code>%s</code>\n\n<b>proxy</b> - route matched traffic through VPN tunnel\n<b>vpn</b> - full tunnel, all traffic through VPN\n<b>block</b> - drop matched traffic\n<b>exclusion</b> - matched traffic bypasses tunnel' "$E_SET" "$sec" "$curr_ct")
            local _excl_btn=",{\"text\":\"Exclusion\",\"callback_data\":\"do_set_conn_exclusion\"}"
            [ "$PODKOP_VARIANT" = "plus" ] && _excl_btn=",{\"text\":\"Direct\",\"callback_data\":\"do_set_conn_direct\"}"
            send_or_edit "$mid" "$ct_txt" \
                "{\"inline_keyboard\":[[{\"text\":\"Proxy\",\"callback_data\":\"do_set_conn_proxy\"},{\"text\":\"VPN\",\"callback_data\":\"do_set_conn_vpn\"},{\"text\":\"Block\",\"callback_data\":\"do_set_conn_block\"}${_excl_btn}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"section_settings\"}]]}"
            ;;
        "do_set_conn_"*)
            local new_ct="${cmd#do_set_conn_}"
            # VPN guard: podkop aborts if connection_type=vpn and interface is not set.
            # Mirror the url-mode guard: save the type, hold reload, ask for interface.
            if [ "$new_ct" = "vpn" ]; then
                local _vpn_iface; _vpn_iface=$(uci -q get ${PODKOP_UCI}.${sec}.interface 2>/dev/null)
                if [ -z "$_vpn_iface" ]; then
                    set_section_action "$sec" "vpn"
                    uci_commit_safe ${PODKOP_UCI}
                    echo "wait_vpn_iface" > "$STATE_FILE"
                    send_or_edit "$mid"                         "$(printf '%s <b>VPN mode set.</b>

%s <b>Reload is held</b> until you set a VPN interface.
Send the UCI interface name now (e.g. <code>wg0</code>, <code>tun0</code>, <code>tailscale0</code>).

Without this, podkop will abort on reload with "VPN interface is not set".

To cancel and revert to Proxy, tap below.'                             "$E_WARN" "$E_ERR")"                         "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel — revert to Proxy\",\"callback_data\":\"do_set_conn_proxy\"}]]}"
                    return
                fi
            fi
            set_section_action "$sec" "$new_ct"
            uci_commit_safe ${PODKOP_UCI}
            send_or_edit "$mid" "$(printf '%s Applying connection type <code>%s</code>...' "$E_RST" "$new_ct")" ""
            safe_reload_podkop "force"; sleep 1
            _handle_settings "section_settings" "$mid" "" ""
            ;;

        "do_toggle_dl")
            local _dl_cur _dl_sec
            _dl_cur=$(uci -q get ${PODKOP_UCI}.settings.download_lists_via_proxy 2>/dev/null)
            if [ "$PODKOP_VARIANT" = "plus" ] && [ "$_dl_cur" != "1" ]; then
                _dl_sec=$(uci -q get ${PODKOP_UCI}.settings.download_lists_via_proxy_section 2>/dev/null)
                if [ -z "$_dl_sec" ]; then
                    send_or_edit "$mid" "$(printf '%s <b>Cannot enable</b>\n\nNeeds a proxy/VPN/outbound section (download_lists_via_proxy_section) set first. On Plus, enabling without one breaks list/subscription startup. Set it in LuCI, then toggle here.' "$E_WARN")" \
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"global_settings\"}]]}"
                    return
                fi
            fi
            toggle_uci_bool "${PODKOP_UCI}.settings" "download_lists_via_proxy"; safe_reload_podkop; _handle_settings "global_settings" "$mid" "" "" ;;
        "do_toggle_quic") toggle_uci_bool "${PODKOP_UCI}.settings" "disable_quic";                        safe_reload_podkop; _handle_settings "global_settings" "$mid" "" "" ;;
        "do_toggle_wan")  toggle_uci_bool "${PODKOP_UCI}.settings" "enable_badwan_interface_monitoring";   safe_reload_podkop; _handle_settings "global_settings" "$mid" "" "" ;;
        "do_toggle_ntp")  toggle_uci_bool "${PODKOP_UCI}.settings" "exclude_ntp";                         safe_reload_podkop; _handle_settings "global_settings" "$mid" "" "" ;;
        "do_toggle_mixed")
            local _cur_me; _cur_me=$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_enabled 2>/dev/null || echo "0")
            # When enabling mixed proxy — ensure required parameters are set
            if [ "$_cur_me" != "1" ]; then
                [ -z "$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_port 2>/dev/null)" ] && {
                    # Find a free port — collect all ports already used by other sections
                    local _used_ports _candidate=2080
                    _used_ports=$(uci -q show ${PODKOP_UCI} 2>/dev/null \
                        | grep '\.mixed_proxy_port=' \
                        | sed "s/.*mixed_proxy_port='//;s/'$//" \
                        | grep -E '^[0-9]+$')
                    # Increment until we find an unused port
                    while echo "$_used_ports" | grep -qx "$_candidate"; do
                        _candidate=$((_candidate + 1))
                    done
                    uci set ${PODKOP_UCI}.${sec}.mixed_proxy_port="${_candidate}"
                    logger -t podkop-bot "[Config] Auto-set mixed_proxy_port=${_candidate} for section ${sec}"
                }
            fi
            toggle_uci_bool "${PODKOP_UCI}.${sec}" "mixed_proxy_enabled"
            if safe_reload_podkop; then
                _handle_settings "section_settings" "$mid" "" ""
            else
                send_or_edit "$mid" "$(printf '%s <b>Reload failed</b>\n\nPodkop could not apply the config change.\nMixed proxy toggle was saved to UCI but sing-box did not restart.\n\nCheck: <code>logread | grep podkop</code>' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"section_settings\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            fi
            ;;

        "ask_toggle_autostart_off")
            send_or_edit "$mid" \
                "$(printf '%s <b>Disable Podkop autostart?</b>\n\nPodkop will NOT start on reboot.\nYou can re-enable it here at any time.' "$E_WARN")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Disable\",\"callback_data\":\"do_autostart_off\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"section_settings\"}]]}" ;;
        "ask_toggle_autostart_on")
            send_or_edit "$mid" \
                "$(printf '%s <b>Enable Podkop autostart?</b>\n\nPodkop will start automatically on every reboot.' "$E_WARN")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Enable\",\"callback_data\":\"do_autostart_on\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"section_settings\"}]]}" ;;
        "do_autostart_off")
            ${PODKOP_INIT} disable 2>/dev/null
            send_or_edit "$mid" "$(printf '%s Podkop autostart <b>disabled</b>.' "$E_OK")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"section_settings\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}" ;;
        "do_autostart_on")
            ${PODKOP_INIT} enable 2>/dev/null
            send_or_edit "$mid" "$(printf '%s Podkop autostart <b>enabled</b>.' "$E_OK")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"section_settings\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}" ;;
    esac
}


# ------------------------------------------------------------------------------
# 9.3b: Section Extras — URLTest tuning, Domain Resolver, Bad WAN details
# ------------------------------------------------------------------------------
_handle_section_extras() {
    local cmd="$1" mid="$2" text="$3" state="$4"
    local sec
    sec=$(get_active_section)

    if [ "$cmd" = "STATE_INPUT" ]; then
        rm -f "$STATE_FILE"
        case "$state" in
            wait_wr_settings)
                delete_message "$mid"
                local _wr_inp _wr_d _wr_t
                _wr_inp=$(printf '%s' "$text" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
                _wr_d=$(printf '%s' "$_wr_inp" | cut -d' ' -f1)
                _wr_t=$(printf '%s' "$_wr_inp" | cut -d' ' -f2)
                if printf '%s' "$_wr_d" | grep -qE '^[1-7]$' && \
                   printf '%s' "$_wr_t" | grep -qE '^([01][0-9]|2[0-3]):[0-5][0-9]$'; then
                    uci set podkop_bot.settings.weekly_report_day="$_wr_d"
                    uci set podkop_bot.settings.weekly_report_time="$_wr_t"
                    uci commit podkop_bot
                    _wr_dn=$(case "$_wr_d" in 1)echo Mon;;2)echo Tue;;3)echo Wed;;4)echo Thu;;5)echo Fri;;6)echo Sat;;*)echo Sun;;esac)
                    send_message "$(printf '%s Weekly report set: <code>%s %s</code>.' "$E_OK" "$_wr_dn" "$_wr_t")" ""
                else
                    send_message "$(printf '%s Invalid format. Use <code>D HH:MM</code>, e.g. <code>7 09:00</code>.' "$E_ERR")" ""
                fi
                _handle_bot "bot_settings" "" "" ""
                ;;

            wait_quiet_hours)
                delete_message "$mid"
                local _qh_input _qh_f _qh_t
                _qh_input=$(printf '%s' "$text" | tr -d ' \r\n' | head -c 11)
                _qh_f=$(printf '%s' "$_qh_input" | cut -d'-' -f1)
                _qh_t=$(printf '%s' "$_qh_input" | cut -d'-' -f2)
                if printf '%s' "$_qh_f" | grep -qE '^([01][0-9]|2[0-3]):[0-5][0-9]$' && \
                   printf '%s' "$_qh_t" | grep -qE '^([01][0-9]|2[0-3]):[0-5][0-9]$'; then
                    uci set podkop_bot.settings.quiet_hours_from="$_qh_f"
                    uci set podkop_bot.settings.quiet_hours_to="$_qh_t"
                    uci commit podkop_bot
                    send_message "$(printf '%s Quiet hours set: <code>%s</code> – <code>%s</code>.' "$E_OK" "$_qh_f" "$_qh_t")" ""
                else
                    send_message "$(printf '%s Invalid format. Use <code>HH:MM-HH:MM</code> (e.g. <code>23:00-07:00</code>).' "$E_ERR")" ""
                fi
                _handle_bot "bot_settings" "" "" ""
                ;;

            wait_dr_time)
                delete_message "$mid"
                local _dt_val; _dt_val=$(printf '%s' "$text" | tr -d '\r\n ' | head -c 5)
                if printf '%s' "$_dt_val" | grep -qE '^([01][0-9]|2[0-3]):[0-5][0-9]$'; then
                    uci set podkop_bot.settings.daily_report_time="$_dt_val"
                    uci commit podkop_bot
                    send_message "$(printf '%s Daily report time set to <code>%s</code>.' "$E_OK" "$_dt_val")" ""
                else
                    send_message "$(printf '%s Invalid time format. Use HH:MM (e.g. 08:00).' "$E_ERR")" ""
                fi
                _handle_bot "bot_settings" "" "" ""
                ;;

            wait_urltest_url)
                delete_message "$mid"
                local val; val=$(printf '%s' "$text" | tr -d '\r\n')
                if ! echo "$val" | grep -qE '^https?://'; then
                    send_message "$(printf '%s Invalid URL. Must start with http:// or https://' "$E_ERR")" \
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"urltest_settings\"}]]}"
                else
                    uci set ${PODKOP_UCI}.${sec}.urltest_testing_url="$val"
                    uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop
                    _handle_section_extras "urltest_settings" "" "" ""
                fi ;;
            wait_urltest_interval)
                delete_message "$mid"
                local val; val=$(printf '%s' "$text" | tr -d '\n\r\t ')
                if ! echo "$val" | grep -qE '^[0-9]+[smh]$'; then
                    send_message "$(printf '%s Invalid interval. Examples: 3m, 180s, 1h' "$E_ERR")" \
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"urltest_settings\"}]]}"
                else
                    uci set ${PODKOP_UCI}.${sec}.urltest_check_interval="$val"
                    uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop
                    _handle_section_extras "urltest_settings" "" "" ""
                fi ;;
            wait_urltest_tolerance)
                delete_message "$mid"
                local val; val=$(printf '%s' "$text" | tr -d '\n\r\t ')
                if ! echo "$val" | grep -qE '^[0-9]+$'; then
                    send_message "$(printf '%s Invalid value. Enter a number in milliseconds (e.g. 50).' "$E_ERR")" \
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"urltest_settings\"}]]}"
                else
                    uci set ${PODKOP_UCI}.${sec}.urltest_tolerance="$val"
                    uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop
                    _handle_section_extras "urltest_settings" "" "" ""
                fi ;;
            wait_dr_server)
                delete_message "$mid"
                local val; val=$(printf '%s' "$text" | tr -d '\r\n\t ')
                uci set ${PODKOP_UCI}.${sec}.domain_resolver_dns_server="$val"
                uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop
                _handle_section_extras "domain_resolver_settings" "" "" "" ;;
            wait_badwan_ifaces)
                delete_message "$mid"
                local val; val=$(printf '%s' "$text" | tr -d '\r\n')
                uci set ${PODKOP_UCI}.settings.badwan_monitored_interfaces="$val"
                uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop
                _handle_section_extras "badwan_details" "" "" "" ;;
            wait_badwan_delay)
                delete_message "$mid"
                local val; val=$(printf '%s' "$text" | tr -d '\n\r\t ')
                if ! echo "$val" | grep -qE '^[0-9]+$'; then
                    send_message "$(printf '%s Invalid value. Enter seconds (e.g. 10).' "$E_ERR")" \
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"badwan_details\"}]]}"
                else
                    uci set ${PODKOP_UCI}.settings.badwan_reload_delay="$val"
                    uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop
                    _handle_section_extras "badwan_details" "" "" ""
                fi ;;
            wait_mixed_port)
                delete_message "$mid"
                local val; val=$(printf '%s' "$text" | tr -d '\n\r\t ')
                if ! echo "$val" | grep -qE '^[0-9]+$' || [ "$val" -lt 1024 ] || [ "$val" -gt 65535 ]; then
                    send_message "$(printf '%s Invalid port. Must be 1024-65535.' "$E_ERR")" \
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"section_settings\"}]]}"
                else
                    uci set ${PODKOP_UCI}.${sec}.mixed_proxy_port="$val"
                    uci_commit_safe ${PODKOP_UCI}
                    send_message "$(printf '%s Port set to %s. Applying...' "$E_OK" "$val")" ""
                    safe_reload_podkop "force"; sleep 1
                    _handle_settings "section_settings" "" "" ""
                fi ;;
            wait_outbound_iface)
                delete_message "$mid"
                local val; val=$(printf '%s' "$text" | tr -d '\r\n\t ')
                if [ -z "$val" ]; then
                    uci delete ${PODKOP_UCI}.settings.output_network_interface 2>/dev/null
                    uci set ${PODKOP_UCI}.settings.enable_output_network_interface="0"
                else
                    uci set ${PODKOP_UCI}.settings.output_network_interface="$val"
                    uci set ${PODKOP_UCI}.settings.enable_output_network_interface="1"
                fi
                uci_commit_safe ${PODKOP_UCI}
                send_message "$(printf '%s Interface set to: %s. Applying...' "$E_OK" "${val:-auto}")" ""
                safe_reload_podkop "force"; sleep 1
                _handle_settings "global_settings" "" "" "" ;;
            wait_vpn_iface)
                delete_message "$mid"
                local val; val=$(printf '%s' "$text" | tr -d '
	 ')
                if [ -z "$val" ]; then
                    send_message "$(printf '%s Interface name cannot be empty. Send the UCI interface name (e.g. wg0, tun0) or tap Cancel.' "$E_ERR")"                         "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel — revert to Proxy\",\"callback_data\":\"do_set_conn_proxy\"}]]}"
                    # Keep state — wait for valid input
                else
                    uci set ${PODKOP_UCI}.${sec}.interface="$val"
                    uci_commit_safe ${PODKOP_UCI}
                    send_message "$(printf '%s VPN interface set to <code>%s</code>. Applying...' "$E_OK" "$val")" ""
                    safe_reload_podkop "force"; sleep 1
                    _handle_settings "section_settings" "" "" ""
                fi
                ;;

            wait_utl_link)
                delete_message "$mid"
                local safe_link; safe_link=$(printf "%s" "$text" | tr -d '\r\n' | sed 's/[[:space:]]//g')
                if ! echo "$safe_link" | grep -qE '^(vless|vmess|ss|trojan|hy2|hysteria2|socks|socks4|socks4a|socks5)://'; then
                    send_message "$(printf '%s <b>Invalid protocol!</b>\n<i>vless, vmess, ss, trojan, hy2, socks5…</i>' "$E_ERR")" \
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"urltest_links_menu\"}]]}"
                elif get_urltest_proxy_links "$sec" | grep -qxF "$safe_link"; then
                    send_message "$(printf '%s <b>Duplicate!</b> Link already in list.' "$E_WARN")" \
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"urltest_links_menu\"}]]}"
                else
                    uci add_list ${PODKOP_UCI}.${sec}.urltest_proxy_links="$safe_link"
                    uci_commit_safe ${PODKOP_UCI}
                    send_message "$(printf '%s <b>Applying...</b>' "$E_RST")" ""
                    safe_reload_podkop "force"; sleep 1
                    _handle_section_extras "urltest_links_menu" "" "" ""
                fi ;;
        esac
        return
    fi

    case "$cmd" in
        "wait_utfilter_excob_"*|"wait_utfilter_incob_"*)
            # Excl/Incl Outbounds: show live outbound picker instead of free-text prompt.
            [ "$PODKOP_VARIANT" = "plus" ] || { _handle_section_extras "urltest_filters_menu" "$mid" "" ""; return; }
            local _ob_full="${cmd#wait_utfilter_}"
            local _ob_type="${_ob_full%%_*}"   # excob | incob
            local _ob_sec="${_ob_full#*_}"
            local _ob_field _ob_label
            [ "$_ob_type" = "excob" ] && _ob_field="urltest_exclude_outbounds" && _ob_label="Excl Outbounds"
            [ "$_ob_type" = "incob" ] && _ob_field="urltest_include_outbounds" && _ob_label="Incl Outbounds"
            # Fetch live outbounds from Clash API for this section's URLTest group
            local _ob_proxies _ob_selector _ob_utgroup
            _ob_proxies=$(clash_request "/proxies" 2>/dev/null)
            _ob_utgroup=$(_resolve_urltest_group_for_section "$_ob_sec" "$_ob_proxies")
            # Read currently selected outbounds for this field (newline-separated)
            local _ob_cur_raw
            _ob_cur_raw=$(uci -q show ${PODKOP_UCI}.${_ob_sec}.${_ob_field} 2>/dev/null \
                | cut -d= -f2- | tr "'" "\n" | grep -v "^$")
            local _ob_cur_disp; _ob_cur_disp=$(printf '%s' "$_ob_cur_raw" | tr "\n" "," | sed "s/,$//")
            if [ -z "$_ob_proxies" ] || [ -z "$_ob_utgroup" ]; then
                # Clash unavailable — fall back to free-text entry
                echo "$cmd" > "$STATE_FILE"
                send_or_edit "$mid" \
                    "$(printf '%s <b>%s</b> [<code>%s</code>]\n\nCurrent: <code>%s</code>\n\n<i>Clash API unavailable — enter tags manually (one per line) or /cancel.</i>' \
                        "$E_EDIT" "$_ob_label" "$_ob_sec" "$(html_escape "${_ob_cur_disp:-none}")")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"urltest_filters_menu\"}]]}"
                return
            fi
            # Build toggle-button keyboard from the URLTest group's member list.
            # Same 2-column for/col pattern used by community_lists — no subshell, ash-safe.
            # Store tag list in temp file so obpick can resolve IDX → real tag name
            local _ob_taglist _ob_idx _ob_tag _ob_icon
            _ob_taglist=$(printf '%s' "$_ob_proxies" | jq -r \
                --arg g "$_ob_utgroup" '[ .proxies[$g].all[]? ] | .[]' 2>/dev/null)
            printf '%s\n' "$_ob_taglist" > "${BOT_DIR}/utfilter_ob_list_${_ob_sec}"
            local _ob_rows="" _ob_col=0 _ob_left=""
            _ob_idx=0
            while IFS= read -r _ob_tag; do
                [ -z "$_ob_tag" ] && continue
                printf '%s' "$_ob_cur_raw" | grep -qxF "$_ob_tag" && _ob_icon="✅" || _ob_icon="⬜"
                local _ob_cb="do_utfilter_obpick_${_ob_type}_${_ob_sec}_IDX${_ob_idx}"
                local _ob_tag_json; _ob_tag_json=$(json_escape "$_ob_tag")
                local _ob_btn="{\"text\":\"${_ob_icon} ${_ob_tag_json}\",\"callback_data\":\"${_ob_cb}\"}"
                if [ "$_ob_col" -eq 0 ]; then
                    _ob_left="$_ob_btn"; _ob_col=1
                else
                    _ob_rows="${_ob_rows}[${_ob_left},${_ob_btn}],"
                    _ob_col=0; _ob_left=""
                fi
                _ob_idx=$((_ob_idx + 1))
            done < "${BOT_DIR}/utfilter_ob_list_${_ob_sec}"
            [ -n "$_ob_left" ] && _ob_rows="${_ob_rows}[${_ob_left}],"
            local _ob_text
            _ob_text="$(printf '%s <b>%s</b> [<code>%s</code>]\n\nTap to toggle. Selected: <code>%s</code>' \
                "$E_TGT" "$_ob_label" "$_ob_sec" "$(html_escape "${_ob_cur_disp:-none}")")"
            send_or_edit "$mid" "$_ob_text" \
                "{\"inline_keyboard\":[${_ob_rows}[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"urltest_filters_menu\"},{\"text\":\"🗑 Clear all\",\"callback_data\":\"do_utfilter_obclear_${_ob_type}_${_ob_sec}\"}]]}"
            ;;

        "do_utfilter_obpick_"*)
            # Toggle a single outbound. Tag encoded as IDX (index into saved list) to avoid
            # underscore ambiguity in callback_data parsing.
            [ "$PODKOP_VARIANT" = "plus" ] || { _handle_section_extras "urltest_filters_menu" "$mid" "" ""; return; }
            local _op_full="${cmd#do_utfilter_obpick_}"
            local _op_type="${_op_full%%_*}"          # excob | incob
            local _op_rest="${_op_full#*_}"            # <sec>_IDX<n>
            local _op_sec="${_op_rest%_IDX*}"
            local _op_idx="${_op_rest##*_IDX}"
            local _op_tag
            _op_tag=$(sed -n "$((_op_idx + 1))p" "${BOT_DIR}/utfilter_ob_list_${_op_sec}" 2>/dev/null)
            if [ -z "$_op_tag" ]; then
                send_or_edit "$mid" "$(printf '%s Could not resolve outbound tag. Try reopening the menu.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"urltest_filters_menu\"}]]}"
                return
            fi
            local _op_field
            [ "$_op_type" = "excob" ] && _op_field="urltest_exclude_outbounds"
            [ "$_op_type" = "incob" ] && _op_field="urltest_include_outbounds"
            local _op_cur_raw
            _op_cur_raw=$(uci -q show ${PODKOP_UCI}.${_op_sec}.${_op_field} 2>/dev/null \
                | cut -d= -f2- | tr "'" "\n" | grep -v "^$")
            if printf '%s' "$_op_cur_raw" | grep -qxF "$_op_tag"; then
                # Already in list — rebuild without this tag
                uci -q delete ${PODKOP_UCI}.${_op_sec}.${_op_field} 2>/dev/null || true
                # Write to temp file to avoid pipe-subshell: uci add_list must run
                # in the current shell, not a subshell created by printf | while.
                local _op_tmp; _op_tmp="${BOT_DIR}/utfilter_rebuild_$$"
                printf '%s\n' "$_op_cur_raw" > "$_op_tmp"
                while IFS= read -r _op_item; do
                    [ -z "$_op_item" ] && continue
                    [ "$_op_item" = "$_op_tag" ] && continue
                    uci add_list ${PODKOP_UCI}.${_op_sec}.${_op_field}="$_op_item"
                done < "$_op_tmp"
                rm -f "$_op_tmp"
            else
                uci add_list ${PODKOP_UCI}.${_op_sec}.${_op_field}="$_op_tag"
            fi
            uci_commit_safe ${PODKOP_UCI}
            safe_reload_podkop "force"
            # Redraw picker
            _handle_section_extras "wait_utfilter_${_op_type}_${_op_sec}" "$mid" "" ""
            ;;

        "do_utfilter_obclear_"*)
            # Clear entire excob/incob list
            [ "$PODKOP_VARIANT" = "plus" ] || { _handle_section_extras "urltest_filters_menu" "$mid" "" ""; return; }
            local _oc_full="${cmd#do_utfilter_obclear_}"
            local _oc_type="${_oc_full%%_*}"
            local _oc_sec="${_oc_full#*_}"
            local _oc_field
            [ "$_oc_type" = "excob" ] && _oc_field="urltest_exclude_outbounds"
            [ "$_oc_type" = "incob" ] && _oc_field="urltest_include_outbounds"
            uci -q delete ${PODKOP_UCI}.${_oc_sec}.${_oc_field} 2>/dev/null || true
            uci_commit_safe ${PODKOP_UCI}
            safe_reload_podkop "force"
            _handle_section_extras "wait_utfilter_${_oc_type}_${_oc_sec}" "$mid" "" ""
            ;;

        "wait_utfilter_exc_"*|"wait_utfilter_inc_"*)
            # Enter text-entry state for country filters (exc/inc only — outbounds use picker above)
            local _wcb_full="${cmd#wait_utfilter_}"
            local _wcb_type="${_wcb_full%%_*}"
            local _wcb_sec="${_wcb_full#*_}"
            local _wcb_field _wcb_label _wcb_hint
            case "$_wcb_type" in
                exc)   _wcb_field="urltest_exclude_countries"; _wcb_label="Exclude Countries"; _wcb_hint="RU,BY,KZ" ;;
                inc)   _wcb_field="urltest_include_countries"; _wcb_label="Include Countries"; _wcb_hint="NL,DE,FI" ;;
            esac
            local _wcb_cur; _wcb_cur=$(uci -q show ${PODKOP_UCI}.${_wcb_sec}.${_wcb_field} 2>/dev/null |                 cut -d= -f2- | tr "'" "
" | grep -v "^$" | tr "
" ",")
            echo "$cmd" > "$STATE_FILE"
            send_or_edit "$mid"                 "$(printf '%s <b>%s for section <code>%s</code></b>\n\nCurrent: <code>%s</code>\n\nSend new value (e.g. <code>%s</code>) or /cancel.'                     "$E_EDIT" "$_wcb_label" "$_wcb_sec"                     "$(html_escape "${_wcb_cur:-none}")" "$_wcb_hint")"                 "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"urltest_filters_menu\"}]]}"
            ;;

        "wait_dpi_strategy_"*)
            # Enter strategy edit state for DPI section
            local _wds_sec="${cmd#wait_dpi_strategy_}"
            local _wds_act; _wds_act=$(uci -q get ${PODKOP_UCI}.${_wds_sec}.action 2>/dev/null)
            local _wds_field _wds_cur
            if [ "$_wds_act" = "zapret" ]; then
                _wds_field="nfqws_opt"
            else
                _wds_field="byedpi_cmd_opts"
            fi
            _wds_cur=$(uci -q get ${PODKOP_UCI}.${_wds_sec}.${_wds_field} 2>/dev/null || echo "")
            echo "$cmd" > "$STATE_FILE"
            send_or_edit "$mid"                 "$(printf '%s <b>Enter %s strategy for section <code>%s</code></b>\n\nCurrent:\n<code>%s</code>\n\nSend new strategy string or /cancel.'                     "$E_EDIT" "$([ "$_wds_act" = "zapret" ] && echo "nfqws" || echo "byedpi")" "$_wds_sec"                     "$(html_escape "${_wds_cur:-not set}")")"                 "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"${_wds_act}_section_menu\"}]]}"
            ;;

        "urltest_filters_menu")
            # URLTest filters — Plus only (urltest_filter_mode, countries, regex, outbounds)
            rm -f "$STATE_FILE"
            if [ "$PODKOP_VARIANT" != "plus" ]; then
                send_or_edit "$mid" "$(printf '%s URLTest filters are only available on Podkop Plus.' "$E_WARN")"                     "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"section_settings\"}]]}"
                return
            fi
            local _fm _dc _dc_disp _exc _inc _exc_ob _inc_ob _exc_re _inc_re _hide text kb
            _fm=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_filter_mode 2>/dev/null || echo "disabled")
            _dc=$(uci -q get ${PODKOP_UCI}.${sec}.detect_server_country 2>/dev/null)
            case "$_dc" in
                country_is)   _dc_disp="country_is" ;;
                flag_emoji|1) _dc_disp="flag_emoji" ;;
                ""|0)         _dc_disp="disabled" ;;
                *)            _dc_disp="flag_emoji" ;;
            esac
            _exc=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_exclude_countries 2>/dev/null | tr "'" "
" | grep -v "^$" | tr "
" "," | sed "s/,$//")
            _inc=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_include_countries 2>/dev/null | tr "'" "
" | grep -v "^$" | tr "
" "," | sed "s/,$//")
            local _exc_ob_raw _inc_ob_raw _exc_ob_disp _inc_ob_disp
            _exc_ob_raw=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_exclude_outbounds 2>/dev/null | tr "'" "\n" | grep -v "^$")
            _inc_ob_raw=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_include_outbounds 2>/dev/null | tr "'" "\n" | grep -v "^$")
            _exc_ob=$(printf '%s' "$_exc_ob_raw" | grep -c "." 2>/dev/null || echo 0)
            _inc_ob=$(printf '%s' "$_inc_ob_raw" | grep -c "." 2>/dev/null || echo 0)
            _exc_ob_disp=$(printf '%s' "$_exc_ob_raw" | head -3 | sed 's/^/  • /')
            [ "${_exc_ob:-0}" -gt 3 ] && _exc_ob_disp="${_exc_ob_disp}\n  (+$((_exc_ob-3)) more)"
            _inc_ob_disp=$(printf '%s' "$_inc_ob_raw" | head -3 | sed 's/^/  • /')
            [ "${_inc_ob:-0}" -gt 3 ] && _inc_ob_disp="${_inc_ob_disp}\n  (+$((_inc_ob-3)) more)"
            _inc_ob=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_include_outbounds 2>/dev/null | tr "'" "
" | grep -vc "^$")
            _exc_re=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_exclude_regex 2>/dev/null | tr "'" "
" | grep -vc "^$")
            _inc_re=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_include_regex 2>/dev/null | tr "'" "
" | grep -vc "^$")
            _hide=$(get_uci_bool_emoji "${PODKOP_UCI}.${sec}" "urltest_hide_filtered_outbounds")
            local _dc_icon; [ "$_dc_disp" = "disabled" ] && _dc_icon="${E_OFF}" || _dc_icon="${E_ON}"
            text=$(cat <<EOF
${E_TGT} <b>URLTest Filters</b> [<code>${sec}</code>]
<i>Filter servers by country, name or regex before URLTest picks the fastest.</i>
<code>────────────────────</code>
<b>Filter mode:</b> <code>${_fm}</code>
<b>Detect country:</b> ${_dc_icon} ${_dc_disp}
<b>Hide filtered:</b> ${_hide}
$([ -n "$_exc" ] && printf "<b>Excl countries:</b> <code>%s</code>\n" "$_exc")$([ -n "$_inc" ] && printf "<b>Incl countries:</b> <code>%s</code>\n" "$_inc")$([ "${_exc_ob:-0}" -gt 0 ] && printf "<b>Excl outbounds (%d):</b>\n%s\n" "$_exc_ob" "$_exc_ob_disp")$([ "${_inc_ob:-0}" -gt 0 ] && printf "<b>Incl outbounds (%d):</b>\n%s\n" "$_inc_ob" "$_inc_ob_disp")$([ "${_exc_ob:-0}" -eq 0 ] && [ "${_inc_ob:-0}" -eq 0 ] && printf "<b>Outbound filters:</b> none")
$([ "$_exc_re" -gt 0 ] 2>/dev/null && printf "<b>Excl regex:</b> %d rules\n" "$_exc_re")$([ "$_inc_re" -gt 0 ] 2>/dev/null && printf "<b>Incl regex:</b> %d rules\n" "$_inc_re")
EOF
)
            # Filter mode cycle: disabled → exclude → include → disabled
            local _next_fm
            case "$_fm" in
                disabled) _next_fm="exclude" ;;
                exclude)  _next_fm="include" ;;
                *)        _next_fm="disabled" ;;
            esac
            kb="{\"inline_keyboard\":[
                [{\"text\":\"Mode: ${_fm}\",\"callback_data\":\"do_utfilter_mode_${_next_fm}\"},{\"text\":\"🌍 Country: ${_dc_disp}\",\"callback_data\":\"do_utfilter_cycle_dc\"}],
                [{\"text\":\"${_hide} Hide Filtered\",\"callback_data\":\"do_utfilter_toggle_hide\"}],
                [{\"text\":\"${E_EDIT} Excl Countries\",\"callback_data\":\"wait_utfilter_exc_${sec}\"},{\"text\":\"${E_EDIT} Incl Countries\",\"callback_data\":\"wait_utfilter_inc_${sec}\"}],
                [{\"text\":\"${E_EDIT} Excl Outbounds\",\"callback_data\":\"wait_utfilter_excob_${sec}\"},{\"text\":\"${E_EDIT} Incl Outbounds\",\"callback_data\":\"wait_utfilter_incob_${sec}\"}],
                [{\"text\":\"${E_BACK} Back\",\"callback_data\":\"section_settings\"}]
            ]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "do_utfilter_mode_"*)
            [ "$PODKOP_VARIANT" = "plus" ] || { _handle_section_extras "urltest_filters_menu" "$mid" "" ""; return; }
            uci set ${PODKOP_UCI}.${sec}.urltest_filter_mode="${cmd#do_utfilter_mode_}"
            uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop "force"
            _handle_section_extras "urltest_filters_menu" "$mid" "" "" ;;

        "do_utfilter_cycle_dc")
            [ "$PODKOP_VARIANT" = "plus" ] || { _handle_section_extras "urltest_filters_menu" "$mid" "" ""; return; }
            local _cur_dc _next_dc
            _cur_dc=$(uci -q get ${PODKOP_UCI}.${sec}.detect_server_country 2>/dev/null)
            case "$_cur_dc" in
                ""|0)         _next_dc="flag_emoji" ;;
                flag_emoji|1) _next_dc="country_is" ;;
                country_is)   _next_dc="" ;;
                *)            _next_dc="flag_emoji" ;;
            esac
            if [ -z "$_next_dc" ]; then
                uci -q delete ${PODKOP_UCI}.${sec}.detect_server_country 2>/dev/null
            else
                uci set ${PODKOP_UCI}.${sec}.detect_server_country="$_next_dc"
            fi
            uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop "force"
            _handle_section_extras "urltest_filters_menu" "$mid" "" "" ;;

        "do_utfilter_toggle_hide")
            [ "$PODKOP_VARIANT" = "plus" ] || { _handle_section_extras "urltest_filters_menu" "$mid" "" ""; return; }
            toggle_uci_bool "${PODKOP_UCI}.${sec}" "urltest_hide_filtered_outbounds"
            uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop "force"
            _handle_section_extras "urltest_filters_menu" "$mid" "" "" ;;

        "urltest_settings")
            rm -f "$STATE_FILE"
            local ut_url ut_interval ut_tol ut_links_count sel_links_count
            ut_url=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_testing_url 2>/dev/null || echo "https://www.gstatic.com/generate_204 (default)")
            ut_interval=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_check_interval 2>/dev/null || echo "3m (default)")
            ut_tol=$(uci -q get ${PODKOP_UCI}.${sec}.urltest_tolerance 2>/dev/null || echo "50 (default)")
            _utl_lraw=$(uci -q show ${PODKOP_UCI}.${sec}.urltest_proxy_links 2>/dev/null | cut -d= -f2-); ut_links_count=0; [ -n "$_utl_lraw" ] && { { _ucl=$(uci_list_clean "$_utl_lraw"); eval "set -- $_ucl"; }; ut_links_count=$#; }
            _sel_lraw=$(uci -q show ${PODKOP_UCI}.${sec}.selector_proxy_links 2>/dev/null | cut -d= -f2-); sel_links_count=0; [ -n "$_sel_lraw" ] && { { _ucl=$(uci_list_clean "$_sel_lraw"); eval "set -- $_ucl"; }; sel_links_count=$#; }
            local _clone_btn=""
            if [ "${sel_links_count:-0}" -gt 0 ]; then
                _clone_btn="[{\"text\":\"${E_RST} Clone from Selector (${sel_links_count})\",\"callback_data\":\"cmd_clone_sel_to_utl\"}],"
            else
                # Fallback: check Clash API for proxy count even if UCI is empty
                local _clash_count
                _clash_count=$(clash_request "/proxies" 2>/dev/null | \
                    jq -r --arg sel "$(get_selector_tag "")" '.proxies[$sel].all | length // 0' 2>/dev/null)
                [ "${_clash_count:-0}" -gt 0 ] && \
                    _clone_btn="[{\"text\":\"${E_RST} Clone from Selector (${_clash_count})\",\"callback_data\":\"cmd_clone_sel_to_utl\"}],"
            fi
            local _links_hint=""
            [ "${ut_links_count:-0}" -eq 0 ] && \
                _links_hint="\n${E_ERR} <b>Empty — podkop will abort in URLTest mode!</b>"
            send_or_edit "$mid" \
                "$(printf '%s <b>URLTest Settings</b> [<code>%s</code>]\n\n<b>Testing URL:</b>\n<code>%s</code>\n\n<b>Check Interval:</b> <code>%s</code>\n<i>How often sing-box tests proxies. Format: 3m, 180s, 1h</i>\n\n<b>Tolerance:</b> <code>%s ms</code>\n<i>Max latency diff to switch proxies. Lower = more switching.</i>\n\n<b>Proxy Links:</b> %s entries%b' \
                    "$E_TGT" "$sec" "$ut_url" "$ut_interval" "$ut_tol" "$ut_links_count" "$_links_hint")" \
                "{\"inline_keyboard\":[${_clone_btn}[{\"text\":\"${E_EDIT} Testing URL\",\"callback_data\":\"cmd_set_ut_url\"},{\"text\":\"${E_EDIT} Interval\",\"callback_data\":\"cmd_set_ut_interval\"}],[{\"text\":\"${E_EDIT} Tolerance\",\"callback_data\":\"cmd_set_ut_tolerance\"},{\"text\":\"${E_GLOB} Proxy Links\",\"callback_data\":\"urltest_links_menu\"}],[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"section_settings\"}]]}"
            ;;

        "cmd_set_ut_url")
            echo "wait_urltest_url" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Set URLTest Testing URL</b>\n\nCurrent: <code>%s</code>\n\nSend new URL (must start with http:// or https://).\nDefault: <code>https://www.gstatic.com/generate_204</code>' \
                    "$E_EDIT" "$(uci -q get ${PODKOP_UCI}.${sec}.urltest_testing_url || echo "not set")")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"urltest_settings\"}]]}"
            ;;

        "cmd_set_ut_interval")
            echo "wait_urltest_interval" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Set URLTest Check Interval</b>\n\nCurrent: <code>%s</code>\n\nFormat: <code>3m</code>, <code>180s</code>, <code>1h</code>\nDefault: 3m' \
                    "$E_EDIT" "$(uci -q get ${PODKOP_UCI}.${sec}.urltest_check_interval || echo "not set")")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"urltest_settings\"}]]}"
            ;;

        "cmd_set_ut_tolerance")
            echo "wait_urltest_tolerance" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Set URLTest Tolerance</b>\n\nCurrent: <code>%s ms</code>\n\nEnter value in milliseconds.\nDefault: 50ms. Lower values cause more proxy switching.' \
                    "$E_EDIT" "$(uci -q get ${PODKOP_UCI}.${sec}.urltest_tolerance || echo "not set")")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"urltest_settings\"}]]}"
            ;;

        "domain_resolver_settings")
            rm -f "$STATE_FILE"
            local dr_en dr_type dr_server dr_en_icon
            dr_en=$(uci -q get ${PODKOP_UCI}.${sec}.domain_resolver_enabled 2>/dev/null || echo "0")
            dr_type=$(uci -q get ${PODKOP_UCI}.${sec}.domain_resolver_dns_type 2>/dev/null || echo "udp")
            dr_server=$(uci -q get ${PODKOP_UCI}.${sec}.domain_resolver_dns_server 2>/dev/null || echo "not set")
            dr_en_icon=$([ "$dr_en" = "1" ] && echo "$E_ON" || echo "$E_OFF")

            # Cycle DNS type: udp -> doh -> dot -> udp
            local next_dr_type="doh"
            [ "$dr_type" = "doh" ] && next_dr_type="dot"
            [ "$dr_type" = "dot" ] && next_dr_type="udp"

            send_or_edit "$mid" \
                "$(printf '%s <b>Domain Resolver</b> [<code>%s</code>]\n\n%s <b>Enabled:</b> <code>%s</code>\n<b>DNS Type:</b> <code>%s</code>\n<b>DNS Server:</b> <code>%s</code>\n\n<i>Domain Resolver resolves domains in rules via this DNS,\nindependently from the global DNS settings.</i>' \
                    "$E_NET" "$sec" "$dr_en_icon" \
                    "$([ "$dr_en" = "1" ] && echo "yes" || echo "no")" \
                    "$dr_type" "$dr_server")" \
                "{\"inline_keyboard\":[[{\"text\":\"${dr_en_icon} Toggle\",\"callback_data\":\"do_toggle_dr\"},{\"text\":\"DNS Type: ${dr_type}\",\"callback_data\":\"set_dr_type_${next_dr_type}\"}],[{\"text\":\"${E_EDIT} DNS Server\",\"callback_data\":\"cmd_set_dr_server\"}],[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"section_settings\"}]]}"
            ;;

        "do_toggle_dr")
            toggle_uci_bool "${PODKOP_UCI}.${sec}" "domain_resolver_enabled"
            uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop
            _handle_section_extras "domain_resolver_settings" "$mid" "" ""
            ;;

        "set_dr_type_"*)
            uci set ${PODKOP_UCI}.${sec}.domain_resolver_dns_type="${cmd#set_dr_type_}"
            uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop
            _handle_section_extras "domain_resolver_settings" "$mid" "" ""
            ;;

        "cmd_set_dr_server")
            echo "wait_dr_server" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Set Domain Resolver DNS Server</b>\n\nCurrent: <code>%s</code>\n\nSend new value.\nExamples: <code>8.8.8.8</code>, <code>dns.google</code>, <code>https://dns.google/dns-query</code>' \
                    "$E_EDIT" "$(uci -q get ${PODKOP_UCI}.${sec}.domain_resolver_dns_server || echo "not set")")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"domain_resolver_settings\"}]]}"
            ;;

        "badwan_details")
            rm -f "$STATE_FILE"
            local bw_en bw_ifaces bw_delay bw_en_icon
            bw_en=$(uci -q get ${PODKOP_UCI}.settings.enable_badwan_interface_monitoring 2>/dev/null || echo "0")
            bw_ifaces=$(uci -q get ${PODKOP_UCI}.settings.badwan_monitored_interfaces 2>/dev/null || echo "not set")
            bw_delay=$(uci -q get ${PODKOP_UCI}.settings.badwan_reload_delay 2>/dev/null || echo "10 (default)")
            bw_en_icon=$([ "$bw_en" = "1" ] && echo "$E_ON" || echo "$E_OFF")

            send_or_edit "$mid" \
                "$(printf '%s <b>Bad WAN Monitor Details</b>\n\n%s <b>Enabled:</b> <code>%s</code>\n<b>Monitored Interfaces:</b>\n<code>%s</code>\n<b>Reload Delay:</b> <code>%s s</code>\n\n<i>Podkop reloads when WAN interface changes.\nLeave interfaces blank to monitor default WAN.</i>' \
                    "$E_SCAN" "$bw_en_icon" \
                    "$([ "$bw_en" = "1" ] && echo "yes" || echo "no")" \
                    "$bw_ifaces" "$bw_delay")" \
                "{\"inline_keyboard\":[[{\"text\":\"${bw_en_icon} Toggle\",\"callback_data\":\"do_toggle_wan\"},{\"text\":\"${E_EDIT} Interfaces\",\"callback_data\":\"cmd_set_bw_ifaces\"}],[{\"text\":\"${E_EDIT} Reload Delay\",\"callback_data\":\"cmd_set_bw_delay\"}],[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"section_settings\"}]]}"
            ;;

        "cmd_set_bw_ifaces")
            echo "wait_badwan_ifaces" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Set Monitored Interfaces</b>\n\nCurrent: <code>%s</code>\n\nSend space-separated interface names.\nExample: <code>wan wan6</code>\nLeave blank to clear (monitor default WAN).' \
                    "$E_EDIT" "$(uci -q get ${PODKOP_UCI}.settings.badwan_monitored_interfaces || echo "not set")")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"badwan_details\"}]]}"
            ;;

        "cmd_set_bw_delay")
            echo "wait_badwan_delay" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Set Reload Delay</b>\n\nCurrent: <code>%s s</code>\n\nSeconds to wait after WAN change before reload.\nDefault: 10' \
                    "$E_EDIT" "$(uci -q get ${PODKOP_UCI}.settings.badwan_reload_delay || echo "10")")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"badwan_details\"}]]}"
            ;;

        "cmd_set_mixed_port")
            echo "wait_mixed_port" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Set Mixed Proxy Port</b>\n\nCurrent: <code>%s</code>\n\nEnter port number (1024-65535).\nDefault: 2080\n\n%s Changing the port requires reload. Make sure no other service uses this port.' \
                    "$E_EDIT" "$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_port || echo "2080")" "$E_WARN")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"section_settings\"}]]}"
            ;;

        "cmd_set_outbound_iface")
            echo "wait_outbound_iface" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Set Outbound Interface</b>\n\nCurrent: <code>%s</code>\n\n<i>Global setting — applies to all podkop sections.</i>\nEnter UCI interface name (e.g. <code>wan</code>, <code>wwan0</code>).\nLeave blank to reset to auto.' \
                    "$E_EDIT" "$(uci -q get ${PODKOP_UCI}.settings.output_network_interface || echo "auto")")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"section_settings\"}]]}"
            ;;

        "urltest_links_menu"|"urltest_links_p_"*)
            rm -f "$STATE_FILE"
            local page=0
            [ "$cmd" != "urltest_links_menu" ] && page="${cmd#urltest_links_p_}"
            local per_page=8 link_list total total_pages
            local start_idx end_idx rows list_text nav_row kb line_n=0
            link_list=$(get_urltest_proxy_links "$sec")
            if [ -z "$link_list" ]; then total=0
            else total=$(printf '%s\n' "$link_list" | grep -c .); fi
            total_pages=$(( (total + per_page - 1) / per_page ))
            [ "$total_pages" -eq 0 ] && total_pages=1
            [ "$page" -ge "$total_pages" ] && page=$((total_pages - 1))
            [ "$page" -lt 0 ] && page=0
            start_idx=$(( page * per_page ))
            end_idx=$(( start_idx + per_page ))
            [ "$end_idx" -gt "$total" ] && end_idx="$total"
            rows=""; list_text=""
            if [ "$total" -gt 0 ]; then
                while IFS= read -r link; do
                    [ -z "$link" ] && continue
                    if [ "$line_n" -ge "$start_idx" ] && [ "$line_n" -lt "$end_idx" ]; then
                        local disp proto host
                        proto=$(echo "$link" | cut -d: -f1)
                        host=$(echo "$link" | sed 's|.*@||; s|/.*||; s|?.*||' | cut -c1-30)
                        disp="${proto}://...${host}"
                        local human; human=$(json_escape "$disp")
                        list_text=$(printf '%s\n<code>[%s]</code> %s' "$list_text" "$line_n" "$disp")
                        rows="${rows}[{\"text\":\"${E_DEL} [${line_n}] ${human}\",\"callback_data\":\"ask_del_utl_${line_n}\"}],"
                    fi
                    line_n=$((line_n + 1))
                done <<EOF
$link_list
EOF
            fi
            list_text="${list_text#?}"
            [ -z "$list_text" ] && list_text="<i>No outbound links yet.</i>"
            nav_row=""
            if [ "$total" -gt "$per_page" ]; then
                local prev_p=$((page-1)) next_p=$((page+1))
                [ "$page" -eq 0 ] && prev_p=0
                [ "$next_p" -ge "$total_pages" ] && next_p=$page
                nav_row="[{\"text\":\"< Prev\",\"callback_data\":\"urltest_links_p_${prev_p}\"},{\"text\":\"$((page+1))/${total_pages}\",\"callback_data\":\"urltest_links_menu\"},{\"text\":\"Next >\",\"callback_data\":\"urltest_links_p_${next_p}\"}],"
            fi
            kb="{\"inline_keyboard\":[${rows}${nav_row}[{\"text\":\"${E_ADD} Add Link\",\"callback_data\":\"cmd_utl_add\"},{\"text\":\"${E_RST} Refresh\",\"callback_data\":\"urltest_links_menu\"}],[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"urltest_settings\"}]]}"
            send_or_edit "$mid" "$(printf '%s <b>URLTest Proxy Links</b> [<code>%s</code>]\n<b>Total:</b> %s\n\n%s\n\n<i>Tap [%s] to remove a link.</i>' \
                "$E_GLOB" "$sec" "$total" "$list_text" "${E_DEL}")" "$kb"
            ;;

        "cmd_clone_sel_to_utl")
            # Clone all outbound proxies from Clash API into urltest_proxy_links.
            # Uses Clash API as source (not just UCI selector_proxy_links) so it
            # captures ALL proxies including those added outside the bot.
            # Matches each proxy's server:port back to its full original UCI link.
            local _added=0 _skipped=0 _not_found=0
            local proxies selector proxy_name proxy_names_file

            proxies=$(clash_request "/proxies")
            selector=$(get_selector_tag "$proxies")
            if [ -z "$proxies" ] || [ "$proxies" = "null" ] || [ -z "$selector" ]; then
                send_or_edit "$mid" "$(printf '%s Clash API unavailable — cannot read proxy list.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"urltest_settings\"}]]}"
                return
            fi

            proxy_names_file=$(mktemp /tmp/podkop_clone.XXXXXX 2>/dev/null) || return
            echo "$proxies" | jq -r --arg sel "$selector" '.proxies[$sel].all[]?' 2>/dev/null > "$proxy_names_file"

            [ -f "$UCI_LINKS_CACHE" ] || build_uci_links_cache

            while IFS= read -r proxy_name; do
                [ -z "$proxy_name" ] && continue
                # Get server:port from TAG_URI_CACHE
                local _cached_uri _srv_port _full_link
                _cached_uri=$(get_uri_by_tag "$proxy_name")
                [ -z "$_cached_uri" ] && { _not_found=$((_not_found + 1)); continue; }
                _srv_port=$(extract_server_port_from_uri "$_cached_uri")
                [ -z "$_srv_port" ] || [ "$_srv_port" = "N/A" ] && { _not_found=$((_not_found + 1)); continue; }
                # Find full original link in UCI_LINKS_CACHE
                _full_link=$(grep -m1 \
                    "@${_srv_port}[/?#]\|@${_srv_port}$\|://${_srv_port}[/?#]\|://${_srv_port}$" \
                    "$UCI_LINKS_CACHE" 2>/dev/null)
                if [ -z "$_full_link" ]; then
                    # Fallback: try live uci show
                    local _raw_uci
                    _raw_uci=$(uci -q show ${PODKOP_UCI}.${sec}.selector_proxy_links 2>/dev/null | cut -d= -f2-)
                    if [ -n "$_raw_uci" ]; then
                        { _ucl=$(uci_list_clean "$_raw_uci"); eval "set -- $_ucl"; }
                        for _l in "$@"; do
                            case "$_l" in *"@${_srv_port}"*|*"://${_srv_port}"*)
                                _full_link="$_l"; break ;;
                            esac
                        done
                    fi
                fi
                if [ -z "$_full_link" ]; then
                    _not_found=$((_not_found + 1)); continue
                fi
                # Skip duplicates already in urltest_proxy_links
                if uci -q show ${PODKOP_UCI}.${sec}.urltest_proxy_links 2>/dev/null | grep -qF "'${_full_link}'"; then
                    _skipped=$((_skipped + 1))
                else
                    uci add_list ${PODKOP_UCI}.${sec}.urltest_proxy_links="$_full_link"
                    _added=$((_added + 1))
                fi
            done < "$proxy_names_file"
            rm -f "$proxy_names_file"

            uci_commit_safe ${PODKOP_UCI}
            build_tag_name_cache

            local _result
            _result=$(printf '%s <b>Cloned %s link(s)</b> from Selector.' "$E_OK" "$_added")
            [ "$_skipped" -gt 0 ] && _result=$(printf '%s\n<i>%s duplicate(s) skipped.</i>' "$_result" "$_skipped")
            [ "$_not_found" -gt 0 ] && _result=$(printf '%s\n<i>%s proxy/proxies not in UCI (added outside bot) — skipped.</i>' "$_result" "$_not_found")
            send_or_edit "$mid" "$_result" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_GLOB} View URLTest Links\",\"callback_data\":\"urltest_links_menu\"},{\"text\":\"${E_BACK} Back\",\"callback_data\":\"urltest_settings\"}]]}"
            ;;

        "cmd_clone_utl_to_sel")
            # Clone all urltest_proxy_links into selector_proxy_links.
            # Symmetric counterpart of cmd_clone_sel_to_utl.
            local _added=0 _skipped=0
            local _utl_raw_c _item_c
            _utl_raw_c=$(uci -q show ${PODKOP_UCI}.${sec}.urltest_proxy_links 2>/dev/null | cut -d= -f2-)
            if [ -z "$_utl_raw_c" ]; then
                send_or_edit "$mid" "$(printf '%s URLTest Proxy Links is empty — nothing to clone.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"proxy_mode_menu\"}]]}"
                return
            fi
            { _ucl=$(uci_list_clean "$_utl_raw_c"); eval "set -- $_ucl"; }
            for _item_c in "$@"; do
                [ -z "$_item_c" ] && continue
                if uci -q show ${PODKOP_UCI}.${sec}.selector_proxy_links 2>/dev/null | grep -qF "'${_item_c}'"; then
                    _skipped=$((_skipped + 1))
                else
                    uci add_list ${PODKOP_UCI}.${sec}.selector_proxy_links="$_item_c"
                    _added=$((_added + 1))
                fi
            done
            uci_commit_safe ${PODKOP_UCI}
            build_all_caches
            local _result2
            if [ "$_added" -eq 0 ] && [ "$_skipped" -gt 0 ]; then
                # All were duplicates — selector already has these links
                _result2=$(printf '%s <b>Selector Proxy Links already up to date.</b>\n\n<i>All %s link(s) from URLTest already exist in Selector — nothing to add.</i>' "$E_OK" "$_skipped")
            else
                _result2=$(printf '%s <b>Cloned %s link(s)</b> from URLTest.' "$E_OK" "$_added")
                [ "$_skipped" -gt 0 ] && _result2=$(printf '%s\n<i>%s duplicate(s) skipped.</i>' "$_result2" "$_skipped")
            fi
            send_or_edit "$mid" "$_result2" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Switch to Selector\",\"callback_data\":\"do_switch_mode_selector\"},{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"proxy_mode_menu\"}]]}"
            ;;

        "cmd_utl_add")
            echo "wait_utl_link" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Add URLTest Outbound Link</b>\n\n<i>(vless, hy2, hysteria2, ss, trojan, vmess, socks)</i>\n\nOne link per message.' "$E_EDIT")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"urltest_links_menu\"}]]}"
            ;;

        "ask_del_utl_"*)
            local idx="${cmd#ask_del_utl_}" link_to_del="" ln=0 _item
            while IFS= read -r _item; do
                [ -z "$_item" ] && continue
                [ "$ln" -eq "$idx" ] && { link_to_del="$_item"; break; }
                ln=$((ln + 1))
            done <<EOF
$(get_urltest_proxy_links "$sec")
EOF
            [ -z "$link_to_del" ] && {
                send_or_edit "$mid" "$(printf '%s Entry not found.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"urltest_links_menu\"}]]}"
                return
            }
            local disp_link; disp_link=$(echo "$link_to_del" | cut -d: -f1)://...$(echo "$link_to_del" | sed 's|.*@||; s|/.*||; s|?.*||' | cut -c1-30)
            send_or_edit "$mid" \
                "$(printf '%s <b>Remove this URLTest link?</b>\n\n<code>%s</code>' "$E_WARN" "$(html_escape "$disp_link")")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Remove\",\"callback_data\":\"do_del_utl_${idx}\"},{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"urltest_links_menu\"}]]}"
            ;;

        "do_del_utl_"*)
            local idx="${cmd#do_del_utl_}" link_to_del="" ln=0 _item
            while IFS= read -r _item; do
                [ -z "$_item" ] && continue
                [ "$ln" -eq "$idx" ] && { link_to_del="$_item"; break; }
                ln=$((ln + 1))
            done <<EOF
$(get_urltest_proxy_links "$sec")
EOF
            [ -n "$link_to_del" ] && {
                uci del_list ${PODKOP_UCI}.${sec}.urltest_proxy_links="$link_to_del"
                uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop "force"; sleep 1
            }
            _handle_section_extras "urltest_links_menu" "$mid" "" ""
            ;;
    esac
}

# ------------------------------------------------------------------------------
# 9.4: DNS & YACD Settings
# ------------------------------------------------------------------------------
_handle_dns() {
    local cmd="$1" mid="$2" text="$3" state="$4"

    if [ "$cmd" = "STATE_INPUT" ]; then
        rm -f "$STATE_FILE"
        local srv=$(printf "%s" "$text" | tr -d '\r\n\t ')
        if [ "$state" = "wait_dns_server" ]; then
            delete_message "$mid"
            uci set ${PODKOP_UCI}.settings.dns_server="$srv"; uci_commit_safe ${PODKOP_UCI}
            send_message "$(printf '%s DNS Server set to: %s' "$E_OK" "$srv")" ""
            safe_reload_podkop "force"; sleep 1; _handle_dns "dns_settings" "" "" ""
        elif [ "$state" = "wait_bootstrap_dns" ]; then
            delete_message "$mid"
            uci set ${PODKOP_UCI}.settings.bootstrap_dns_server="$srv"; uci_commit_safe ${PODKOP_UCI}
            send_message "$(printf '%s Bootstrap DNS set to: %s' "$E_OK" "$srv")" ""
            safe_reload_podkop "force"; sleep 1; _handle_dns "dns_settings" "" "" ""
        fi
        return
    fi

    case "$cmd" in
        "dns_settings")
            rm -f "$STATE_FILE"
            local protocol server boot_dns kb_boot text kb
            protocol=$(uci -q get ${PODKOP_UCI}.settings.dns_type || echo "udp")
            server=$(uci -q get ${PODKOP_UCI}.settings.dns_server || echo "Not set")
            boot_dns=$(uci -q get ${PODKOP_UCI}.settings.bootstrap_dns_server || echo "Not set")
            local proto_hint
            case "$protocol" in
                udp)  proto_hint="${E_IDEA} <i>UDP: fast, unencrypted DNS. ISP can see your queries.</i>" ;;
                doh)  proto_hint="${E_IDEA} <i>DoH: DNS over HTTPS. Hides queries from ISP, uses port 443.</i>" ;;
                dot)  proto_hint="${E_IDEA} <i>DoT: DNS over TLS. Encrypted DNS, uses port 853.</i>" ;;
                *)    proto_hint="" ;;
            esac

            text=$(cat <<EOF
${E_NET} <b>DNS Settings</b> (Global)

<b>Protocol:</b> <code>${protocol}</code>
${proto_hint}
<b>Server:</b> <code>${server}</code>
<b>Bootstrap:</b> <code>${boot_dns}</code>
<i>Bootstrap resolves the DoH/DoT server hostname via plain DNS.
Only needed for DoH/DoT - ignored in UDP mode.</i>
EOF
)
            kb_boot=""
            [ "$protocol" = "doh" ] || [ "$protocol" = "dot" ] && \
                kb_boot="[{\"text\":\"${E_EDIT} Set Bootstrap\",\"callback_data\":\"cmd_boot_dns\"}],"
            kb="{\"inline_keyboard\":[${kb_boot}[{\"text\":\"Protocol: ${protocol}\",\"callback_data\":\"dns_proto_menu\"}],[{\"text\":\"${E_EDIT} Change Server\",\"callback_data\":\"cmd_dns_server\"}],[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"section_settings\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;
        "cmd_dns_server")
            echo "wait_dns_server" > "$STATE_FILE"
            local _cur_dns; _cur_dns=$(uci -q get ${PODKOP_UCI}.settings.dns_server || echo "not set")
            send_or_edit "$mid" \
                "$(printf '%s <b>Change DNS Server</b>\n\nCurrent: <code>%s</code>\n\nSend new value:\nExample: <code>8.8.8.8</code> or <code>dns.google</code>' "$E_EDIT" "$_cur_dns")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"dns_settings\"}]]}"
            ;;
        "cmd_boot_dns")
            echo "wait_bootstrap_dns" > "$STATE_FILE"
            send_or_edit "$mid" "$(printf '%s <b>Set Bootstrap DNS</b>\n\nExample: <code>77.88.8.8</code>' "$E_EDIT")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"dns_settings\"}]]}"
            ;;
        "dns_proto_menu")
            send_or_edit "$mid" \
                "$(printf '%s <b>Select DNS Protocol</b>

<b>UDP</b> - fast, unencrypted. ISP sees all queries.
<b>DoH</b> - DNS over HTTPS (port 443). Best privacy, works through most firewalls.
<b>DoT</b> - DNS over TLS (port 853). Encrypted, may be blocked by some ISPs.' "$E_TGT")" \
                "{\"inline_keyboard\":[[{\"text\":\"UDP\",\"callback_data\":\"do_dns_pr_udp\"},{\"text\":\"DoH\",\"callback_data\":\"do_dns_pr_doh\"},{\"text\":\"DoT\",\"callback_data\":\"do_dns_pr_dot\"}],[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"dns_settings\"}]]}"
            ;;
        "do_dns_pr_"*)
            uci set ${PODKOP_UCI}.settings.dns_type="${cmd#do_dns_pr_}"; uci_commit_safe ${PODKOP_UCI}
            safe_reload_podkop; _handle_dns "dns_settings" "$mid" "" ""
            ;;

        "yacd_settings")
            # v0.15.1: YACD detail management removed from bot (use LuCI for secret/WAN).
            # Toggle lives in global_settings. Redirect for back-compat.
            _handle_settings "global_settings" "$mid" "$cid" "$cb_id"
            ;;
        "ask_toggle_yacd")     send_or_edit "$mid" "$(printf '%s Toggle YACD?' "$E_WARN")"         "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes\",\"callback_data\":\"do_toggle_yacd\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"global_settings\"}]]}" ;;
        "ask_toggle_yacd_wan"|"do_toggle_yacd_wan"|"yacd_secret_menu"|"ask_yacd_generate_secret"|"do_yacd_generate_secret"|"ask_yacd_remove_secret"|"do_yacd_remove_secret")
            # v0.15.1: YACD secret/WAN management removed. Use LuCI or SSH.
            send_or_edit "$mid" "$(printf '%s YACD WAN access and secret key are managed via LuCI or SSH.\nOnly enable/disable is available in the bot.' "$E_WARN")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"global_settings\"}]]}" ;;
        "do_toggle_yacd")      toggle_uci_bool "${PODKOP_UCI}.settings" "enable_yacd";            safe_reload_podkop; _handle_settings "global_settings" "$mid" "" "" ;;
        


    esac
}

# ------------------------------------------------------------------------------
# 9.5: Routing Lists Handler
#
# Community lists: 2-column grid, GitHub API with 1h cache.
# Remote domain/subnet lists: display + edit by index (bypasses 64-byte CB limit).
# Fully routed IPs: display + add + delete by IP from button.
# user_domains_text / user_subnets_text: paginated viewer, add line, remove by index.
#
# FIXED: remote list display uses eval "set --" (uci get N broken on BusyBox)
# ------------------------------------------------------------------------------
_handle_lists() {
    local cmd="$1" mid="$2" text="$3" state="$4"
    local sec=$(get_active_section)

    if [ "$cmd" = "STATE_INPUT" ]; then
        # Nav escape: persistent keyboard buttons cancel current state
        case "$text" in
            "🏠 Menu"|"/menu"|"main_menu")
                rm -f "$STATE_FILE"
                delete_message "$mid"
                _handle_bot "/menu" "" "" ""
                return ;;
            "📊 Status"|"cmd_status")
                rm -f "$STATE_FILE"
                delete_message "$mid"
                _handle_bot "cmd_status" "" "" ""
                return ;;
        esac
        rm -f "$STATE_FILE"

        if [ "$state" = "wait_fully_routed_ip" ]; then
            delete_message "$mid"
            local ip=$(printf "%s" "$text" | tr -d '\r\n\t ')
            if ! validate_ip_or_cidr "$ip"; then
                send_message "$(printf '%s Invalid IP/CIDR.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"community_lists\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
                return
            fi
            uci add_list ${PODKOP_UCI}.${sec}.fully_routed_ips="$ip"; uci_commit_safe ${PODKOP_UCI}
            send_message "$(printf '%s Routed IP added: %s' "$E_OK" "$ip")" ""
            safe_reload_podkop "force"; sleep 1; _handle_lists "community_lists" "" "" ""

        elif [ "$state" = "wait_excl_ip" ]; then
            delete_message "$mid"
            local ip; ip=$(printf "%s" "$text" | tr -d '\r\n\t ')
            if ! validate_ip_or_cidr "$ip"; then
                send_message "$(printf '%s Invalid IP/CIDR.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"excl_ips_edit\"}]]}"
                return
            fi
            uci add_list ${PODKOP_UCI}.settings.routing_excluded_ips="$ip"; uci_commit_safe ${PODKOP_UCI}
            send_message "$(printf '%s Excluded IP added: %s' "$E_OK" "$ip")" ""
            safe_reload_podkop "force"; sleep 1; _handle_lists "excl_ips_edit" "" "" ""

        elif [ "$state" = "wait_remote_domain" ] || [ "$state" = "wait_remote_subnet" ]; then
            delete_message "$mid"
            local safe_link=$(printf "%s" "$text" | tr -d '\r\n\t ')
            if ! echo "$safe_link" | grep -qE '^https?://'; then
                send_message "$(printf '%s Must start with http:// or https://' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"community_lists\"}]]}"
                return
            fi
            if [ "$state" = "wait_remote_domain" ]; then
                # Plus: write to domain_ip_lists (what LuCI uses); original: remote_domain_lists
                if [ "$PODKOP_VARIANT" = "plus" ]; then
                    uci add_list ${PODKOP_UCI}.${sec}.domain_ip_lists="$safe_link"
                else
                    uci add_list ${PODKOP_UCI}.${sec}.remote_domain_lists="$safe_link"
                fi
            else
                # remote_subnet_lists — Plus has no domain_ip_lists equivalent for subnets
                uci add_list ${PODKOP_UCI}.${sec}.remote_subnet_lists="$safe_link"
            fi
            uci_commit_safe ${PODKOP_UCI}
            send_message "$(printf '%s Remote list saved.' "$E_OK")" ""
            safe_reload_podkop "force"; sleep 1; _handle_lists "community_lists" "" "" ""

        elif printf '%s' "$state" | grep -qE '^wait_utfilter_(exc|inc|excob|incob)_'; then
            # URLTest filter list edit: wait_utfilter_<type>_<sec>
            delete_message "$mid"
            local _utf_full="${state#wait_utfilter_}"
            local _utf_type="${_utf_full%%_*}"
            local _utf_sec="${_utf_full#*_}"
            local _utf_field _utf_label
            case "$_utf_type" in
                exc)   _utf_field="urltest_exclude_countries"; _utf_label="exclude countries (2-letter codes, comma-separated)" ;;
                inc)   _utf_field="urltest_include_countries"; _utf_label="include countries (2-letter codes, comma-separated)" ;;
                excob) _utf_field="urltest_exclude_outbounds"; _utf_label="exclude outbounds (server tags, one per line)" ;;
                incob) _utf_field="urltest_include_outbounds"; _utf_label="include outbounds (server tags, one per line)" ;;
            esac
            # Parse input: comma-separated → UCI list
            local _utf_input="$text"
            # Clear existing list
            uci -q delete ${PODKOP_UCI}.${_utf_sec}.${_utf_field} 2>/dev/null || true
            # Add each item
            local _utf_item _utf_tmp
            _utf_tmp="${BOT_DIR}/utfilter_input_$$"
            printf '%s' "$_utf_input" | tr ",
" "

" > "$_utf_tmp"
            while IFS= read -r _utf_item; do
                _utf_item=$(printf '%s' "$_utf_item" | tr -d ' 	
')
                [ -z "$_utf_item" ] && continue
                uci add_list ${PODKOP_UCI}.${_utf_sec}.${_utf_field}="$_utf_item"
            done < "$_utf_tmp"
            rm -f "$_utf_tmp"
            uci_commit_safe ${PODKOP_UCI}
            safe_reload_podkop "force"; sleep 1
            local _utf_w; _utf_w=$(_utf_postcheck_warn "$_utf_sec")
            send_message "$(printf '%s Filter list updated.%s' "$E_OK" "$_utf_w")" ""
            _handle_section_extras "urltest_filters_menu" "" "" ""

        elif printf '%s' "$state" | grep -qE '^wait_dpi_strategy_'; then
            # Edit nfqws_opt (zapret) or byedpi_cmd_opts (byedpi) strategy
            delete_message "$mid"
            local _dpi_sec="${state#wait_dpi_strategy_}"
            local _dpi_act; _dpi_act=$(uci -q get ${PODKOP_UCI}.${_dpi_sec}.action 2>/dev/null)
            local _strategy_field _validate_cmd
            if [ "$_dpi_act" = "zapret" ]; then
                _strategy_field="nfqws_opt"
                _validate_cmd="validate_nfqws_strategy_json"
            else
                _strategy_field="byedpi_cmd_opts"
                _validate_cmd="validate_byedpi_strategy_json"
            fi
            local _new_strategy="$text"
            # Validate strategy if Plus CLI available
            if _plus_has_cmd "$_validate_cmd"; then
                local _vres; _vres=$(${PODKOP_BIN} "$_validate_cmd" "$_new_strategy" 2>/dev/null)
                local _valid; _valid=$(printf '%s' "$_vres" | jq -r '.valid // true' 2>/dev/null)
                if [ "$_valid" = "false" ]; then
                    local _vmsg; _vmsg=$(printf '%s' "$_vres" | jq -r '.message // "Invalid strategy"' 2>/dev/null)
                    send_message "$(printf '%s Strategy validation failed:\n<code>%s</code>\n\nTry again or send /cancel.' "$E_ERR" "$(html_escape "$_vmsg")")" ""
                    echo "$state" > "$STATE_FILE"
                    return
                fi
            fi
            uci set ${PODKOP_UCI}.${_dpi_sec}.${_strategy_field}="$_new_strategy"
            uci_commit_safe ${PODKOP_UCI}
            safe_reload_podkop "force"; sleep 1
            send_message "$(printf '%s Strategy updated.' "$E_OK")" ""
            _handle_settings "${_dpi_act}_section_menu" "" "" ""

        elif [ "$state" = "wait_user_domain_add" ] || [ "$state" = "wait_user_subnet_add" ]; then
            # Add a single line to user_domains_text or user_subnets_text.
            # Validation is intentionally different:
            #   domain list: only hostnames (no IPs — use fully_routed_ips for that)
            #   subnet list: only IP/CIDR (no domain names)
            delete_message "$mid"
            local entry=$(printf "%s" "$text" | tr -d '\r\n\t ')
            local field="user_domains_text" back_cb="user_domains_menu" type_key="user_domain_list_type"
            [ "$state" = "wait_user_subnet_add" ] && { field="user_subnets_text"; back_cb="user_subnets_menu"; type_key="user_subnet_list_type"; }

            if [ "$state" = "wait_user_domain_add" ]; then
                if ! validate_domain "$entry"; then
                    send_message "$(printf '%s Invalid domain name: <code>%s</code>\nExpected format: <code>example.com</code>' "$E_ERR" "$(html_escape "$entry")")" \
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"${back_cb}\"}]]}"
                    return
                fi
            else
                if ! validate_ip_or_cidr "$entry"; then
                    send_message "$(printf '%s Invalid IP/CIDR: <code>%s</code>\nExpected format: <code>10.0.0.0/24</code> or <code>1.2.3.4</code>' "$E_ERR" "$(html_escape "$entry")")" \
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"${back_cb}\"}]]}"
                    return
                fi
            fi
            local current
            current=$(uci -q get ${PODKOP_UCI}.${sec}.${field} 2>/dev/null || echo "")
            if [ -n "$current" ]; then
                uci set ${PODKOP_UCI}.${sec}.${field}="${current}
${entry}"
            else
                uci set ${PODKOP_UCI}.${sec}.${field}="$entry"
            fi
            # Ensure podkop reads *_text field (ignored when list_type != text)
            uci set ${PODKOP_UCI}.${sec}.${type_key}="text"
            uci_commit_safe ${PODKOP_UCI}
            send_message "$(printf '%s Added: %s' "$E_OK" "$(html_escape "$entry")")" ""
            safe_reload_podkop "force"; sleep 1; _handle_lists "$back_cb" "" "" ""

        elif [ "$state" = "wait_user_domain_del" ] || [ "$state" = "wait_user_subnet_del" ]; then
            # Delete a line from user_domains_text or user_subnets_text by index
            delete_message "$mid"
            local del_idx=$(printf "%s" "$text" | tr -d '\r\n\t ')
            local field="user_domains_text" back_cb="user_domains_menu" type_key="user_domain_list_type"
            [ "$state" = "wait_user_subnet_del" ] && { field="user_subnets_text"; back_cb="user_subnets_menu"; type_key="user_subnet_list_type"; }

            case "$del_idx" in
                ''|*[!0-9]*)
                    send_message "$(printf '%s Enter a valid line number.' "$E_ERR")" \
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"${back_cb}\"}]]}"
                    return ;;
            esac

            local current new_val i=0 line
            current=$(uci -q get ${PODKOP_UCI}.${sec}.${field} 2>/dev/null || echo "")
            new_val=""
            while IFS= read -r line; do
                if [ "$i" -ne "$del_idx" ]; then
                    if [ -z "$new_val" ]; then new_val="$line"
                    else new_val=$(printf '%s\n%s' "$new_val" "$line"); fi
                fi
                i=$((i + 1))
            done <<EOF
$current
EOF
            uci set ${PODKOP_UCI}.${sec}.${field}="$new_val"
            uci set ${PODKOP_UCI}.${sec}.${type_key}="text"
            uci_commit_safe ${PODKOP_UCI}
            send_message "$(printf '%s Line %s removed.' "$E_OK" "$del_idx")" ""
            safe_reload_podkop "force"; sleep 1; _handle_lists "$back_cb" "" "" ""
        fi
        return
    fi

    case "$cmd" in
        "community_lists")
            rm -f "$STATE_FILE"
            local cd_count sn_count fr_count r_dom_count r_sub_count excl_count
            local r_dom_text r_sub_text fr_ips_text active_lists
            local list_url clean_url filename ip raw

            cd_count=$(uci -q get ${PODKOP_UCI}.${sec}.user_domains_text 2>/dev/null | grep -c "[^[:space:]]")
            sn_count=$(uci -q get ${PODKOP_UCI}.${sec}.user_subnets_text  2>/dev/null | grep -c "[^[:space:]]")
            fr_count=$(uci -q show ${PODKOP_UCI}.${sec} 2>/dev/null | grep -c "^${PODKOP_UCI}\.${sec}\.fully_routed_ips=")
            # Plus: LuCI writes combined lists to domain_ip_lists; legacy remote_domain/subnet_lists also read
            local _dip_count=0
            if [ "$PODKOP_VARIANT" = "plus" ]; then
                _dip_count=$(uci -q show ${PODKOP_UCI}.${sec} 2>/dev/null | grep -c "^${PODKOP_UCI}\.${sec}\.domain_ip_lists=")
            fi
            r_dom_count=$(uci -q show ${PODKOP_UCI}.${sec} 2>/dev/null | grep -c "^${PODKOP_UCI}\.${sec}\.remote_domain_lists=")
            r_sub_count=$(uci -q show ${PODKOP_UCI}.${sec} 2>/dev/null | grep -c "^${PODKOP_UCI}\.${sec}\.remote_subnet_lists=")
            # Treat domain_ip_lists as domain list entries for display
            [ "${_dip_count:-0}" -gt 0 ] && r_dom_count=$(( r_dom_count + _dip_count ))
            excl_count=$(uci -q show ${PODKOP_UCI}.settings 2>/dev/null | grep -c "^${PODKOP_UCI}\.settings\.routing_excluded_ips=")
            # Plus-only: rule_set (domains only) and rule_set_with_subnets (.srs/.json)
            local rs_count=0 rsws_count=0 rs_text="" rsws_text=""
            if [ "$PODKOP_VARIANT" = "plus" ]; then
                rs_count=$(uci -q show ${PODKOP_UCI}.${sec} 2>/dev/null | grep -c "^${PODKOP_UCI}\.${sec}\.rule_set=")
                rsws_count=$(uci -q show ${PODKOP_UCI}.${sec} 2>/dev/null | grep -c "^${PODKOP_UCI}\.${sec}\.rule_set_with_subnets=")
                if [ "$rs_count" -gt 0 ]; then
                    raw=$(uci -q show ${PODKOP_UCI}.${sec}.rule_set 2>/dev/null | cut -d= -f2-)
                    [ -n "$raw" ] && { _ucl=$(uci_list_clean "$raw"); eval "set -- $_ucl"; } && for list_url in "$@"; do
                        clean_url="${list_url%%#*}"; clean_url="${clean_url%%\?*}"; filename="${clean_url##*/}"
                        rs_text=$(printf '%s\n• <a href="%s">%s</a>' "$rs_text" "$(html_escape "$list_url")" "$(html_escape "$filename")")
                    done
                else
                    rs_text=$(printf '\n<i>None</i>')
                fi
                if [ "$rsws_count" -gt 0 ]; then
                    raw=$(uci -q show ${PODKOP_UCI}.${sec}.rule_set_with_subnets 2>/dev/null | cut -d= -f2-)
                    [ -n "$raw" ] && { _ucl=$(uci_list_clean "$raw"); eval "set -- $_ucl"; } && for list_url in "$@"; do
                        clean_url="${list_url%%#*}"; clean_url="${clean_url%%\?*}"; filename="${clean_url##*/}"
                        rsws_text=$(printf '%s\n• <a href="%s">%s</a>' "$rsws_text" "$(html_escape "$list_url")" "$(html_escape "$filename")")
                    done
                else
                    rsws_text=$(printf '\n<i>None</i>')
                fi
            fi

            # Use safe_set_args for list parsing (glob-safe; uci get N broken on BusyBox)
            r_dom_text=""
            if [ "$r_dom_count" -gt 0 ]; then
                # Merge remote_domain_lists + domain_ip_lists (Plus)
                local _rdl_raw _dip_raw
                _rdl_raw=$(uci -q show ${PODKOP_UCI}.${sec}.remote_domain_lists 2>/dev/null | cut -d= -f2-)
                _dip_raw=""
                [ "$PODKOP_VARIANT" = "plus" ] &&                     _dip_raw=$(uci -q show ${PODKOP_UCI}.${sec}.domain_ip_lists 2>/dev/null | cut -d= -f2-)
                raw=$(printf '%s
%s' "$_rdl_raw" "$_dip_raw" | grep -v "^[[:space:]]*$")
                [ -n "$raw" ] && { _ucl=$(uci_list_clean "$raw"); eval "set -- $_ucl"; } && for list_url in "$@"; do
                    clean_url="${list_url%%#*}"; clean_url="${clean_url%%\?*}"; filename="${clean_url##*/}"
                    r_dom_text=$(printf '%s\n• <a href="%s">%s</a>' "$r_dom_text" "$(html_escape "$list_url")" "$(html_escape "$filename")")
                done
            else
                r_dom_text=$(printf '\n<i>None</i>')
            fi

            r_sub_text=""
            if [ "$r_sub_count" -gt 0 ]; then
                raw=$(uci -q show ${PODKOP_UCI}.${sec}.remote_subnet_lists 2>/dev/null | cut -d= -f2-)
                [ -n "$raw" ] && { _ucl=$(uci_list_clean "$raw"); eval "set -- $_ucl"; } && for list_url in "$@"; do
                    clean_url="${list_url%%#*}"; clean_url="${clean_url%%\?*}"; filename="${clean_url##*/}"
                    r_sub_text=$(printf '%s\n• <a href="%s">%s</a>' "$r_sub_text" "$(html_escape "$list_url")" "$(html_escape "$filename")")
                done
            else
                r_sub_text=$(printf '\n<i>None</i>')
            fi

            fr_ips_text=""
            if [ "$fr_count" -gt 0 ]; then
                raw=$(uci -q show ${PODKOP_UCI}.${sec}.fully_routed_ips 2>/dev/null | cut -d= -f2-)
                [ -n "$raw" ] && { _ucl=$(uci_list_clean "$raw"); eval "set -- $_ucl"; } && for ip in "$@"; do
                    fr_ips_text=$(printf '%s\n• <code>%s</code>' "$fr_ips_text" "$ip")
                done
            else
                fr_ips_text=$(printf '\n<i>None</i>')
            fi

            active_lists=$(uci -q show ${PODKOP_UCI}.${sec} 2>/dev/null \
                | grep "^${PODKOP_UCI}\.${sec}\.community_lists=" \
                | sed "s/^[^']*'//g; s/'$//g; s/' '/, /g" || echo "<i>None</i>")

            local _rs_section=""
            if [ "$PODKOP_VARIANT" = "plus" ]; then
                _rs_section=$(printf '\n<b>Rule Sets — domains only</b> (.srs/.json):%s\n\n<b>Rule Sets — domains + subnets</b> (.srs/.json):%s\n<i>Edit rule sets in LuCI → Podkop → Conditions</i>' \
                    "$rs_text" "$rsws_text")
            fi

            text=$(cat <<EOF
${E_FILE} <b>Routing & Lists</b> [<code>${sec}</code>]
<i>What goes through the tunnel — and what bypasses it.</i>

<b>Community Lists</b> (predefined sets — which services to tunnel):
<code>${active_lists}</code>

<b>External Domain Lists</b> (by URL):${r_dom_text}

<b>External Subnet Lists</b> (by URL):${r_sub_text}
${_rs_section}
<b>Devices → Tunnel</b> (all their traffic via tunnel):${fr_ips_text}

<b>Devices → Bypass:</b> ${excl_count} entries (go direct, skip tunnel)
<b>My Domains:</b> ${cd_count} · <b>My Subnets:</b> ${sn_count}
EOF
)
            local kb
            kb="{\"inline_keyboard\":["
            kb="${kb}[{\"text\":\"${E_SET} Community Lists\",\"callback_data\":\"community_lists_edit\"}],"
            kb="${kb}[{\"text\":\"${E_SET} Domain Lists\",\"callback_data\":\"r_dom_edit\"},{\"text\":\"${E_SET} Subnet Lists\",\"callback_data\":\"r_sub_edit\"}],"
            kb="${kb}[{\"text\":\"➡️ Tunnel Devices\",\"callback_data\":\"fr_ips_edit\"},{\"text\":\"↩️ Bypass Devices\",\"callback_data\":\"excl_ips_edit\"}],"
            kb="${kb}[{\"text\":\"${E_EDIT} My Domains\",\"callback_data\":\"user_domains_menu\"},{\"text\":\"${E_EDIT} My Subnets\",\"callback_data\":\"user_subnets_menu\"}],"
            kb="${kb}[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"main_settings_menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "community_lists_edit")
            rm -f "$STATE_FILE"
            send_or_edit "$mid" "$(printf '%s Loading lists...' "$E_TIME")" ""
            local available tag rows col=0 mark pair_left="" pair_left_tag="" text kb
            available=$(get_available_community_lists)
            rows=""
            # Build active-list string once to avoid N uci calls in the loop
            local _active_cl_raw _active_cl_str=""
            _active_cl_raw=$(uci -q show ${PODKOP_UCI}.${sec}.community_lists 2>/dev/null | cut -d= -f2-)
            if [ -n "$_active_cl_raw" ]; then
                { _ucl=$(uci_list_clean "$_active_cl_raw"); eval "set -- $_ucl"; }
                for _cl in "$@"; do _active_cl_str="${_active_cl_str} ${_cl} "; done
            fi
            for tag in $available; do
                is_list_enabled "$sec" "$tag" "$_active_cl_str" && mark="${E_ON}" || mark="${E_OFF}"
                if [ "$col" -eq 0 ]; then
                    pair_left="${mark} ${tag}"; pair_left_tag="$tag"; col=1
                else
                    rows="${rows}[{\"text\":\"${pair_left}\",\"callback_data\":\"toggle_cl_${pair_left_tag}\"},{\"text\":\"${mark} ${tag}\",\"callback_data\":\"toggle_cl_${tag}\"}],"
                    col=0; pair_left=""; pair_left_tag=""
                fi
            done
            [ -n "$pair_left" ] && rows="${rows}[{\"text\":\"${pair_left}\",\"callback_data\":\"toggle_cl_${pair_left_tag}\"}],"
            text=$(cat <<EOF
${E_FILE} <b>Community Lists</b> [<code>${sec}</code>]

${E_ON} enabled  ${E_OFF} disabled

${E_IDEA} <i>Enabled lists are routed strictly through the tunnel.
Domains in these lists bypass your ISP completely.</i>

Changes apply immediately with reload.
EOF
)
            kb="{\"inline_keyboard\":[${rows}[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"community_lists\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "toggle_cl_"*)
            local tag="${cmd#toggle_cl_}"
            case "$tag" in *[!a-z0-9_-]*) send_or_edit "$mid" "$(printf '%s Invalid tag.' "$E_ERR")" ""; return ;; esac
            send_or_edit "$mid" "$(printf '%s Applying...' "$E_RST")" ""
            if is_list_enabled "$sec" "$tag"; then
                uci del_list ${PODKOP_UCI}.${sec}.community_lists="$tag"
            else
                uci add_list ${PODKOP_UCI}.${sec}.community_lists="$tag"
            fi
            uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop "force"; sleep 1
            _handle_lists "community_lists_edit" "$mid" "" ""
            ;;

        "r_dom_edit"|"r_sub_edit")
            rm -f "$STATE_FILE"
            local list_type="remote_domain_lists" human_type="Remote Domain Lists" cb_prefix="del_rdom_"
            [ "$cmd" = "r_sub_edit" ] && { list_type="remote_subnet_lists"; human_type="Remote Subnet Lists"; cb_prefix="del_rsub_"; }
            local rows="" text list_url clean_url filename raw i=0
            text=$(printf '%s <b>Manage %s</b> [<code>%s</code>]\n\n' "$E_FILE" "$human_type" "$sec")
            raw=$(uci -q show ${PODKOP_UCI}.${sec}.${list_type} 2>/dev/null | cut -d= -f2-)
            if [ -n "$raw" ]; then
                { _ucl=$(uci_list_clean "$raw"); eval "set -- $_ucl"; }
                for list_url in "$@"; do
                    clean_url="${list_url%%#*}"; clean_url="${clean_url%%\?*}"; filename="${clean_url##*/}"
                    text=$(printf '%s<b>[%d]</b> <a href="%s">%s</a>\n' "$text" "$i" "$(html_escape "$list_url")" "$(html_escape "$filename")")
                    rows="${rows}[{\"text\":\"${E_DEL} Remove [${i}]\",\"callback_data\":\"${cb_prefix}${i}\"}],"
                    i=$((i + 1))
                done
            fi
            [ "$i" -eq 0 ] && text=$(printf '%s<i>No lists configured.</i>' "$text")
            local add_cb="cmd_add_r_dom"
            [ "$cmd" = "r_sub_edit" ] && add_cb="cmd_add_r_sub"
            local kb="{\"inline_keyboard\":[${rows}[{\"text\":\"${E_ADD} Add URL\",\"callback_data\":\"${add_cb}\"}],[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"community_lists\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "del_rdom_"*|"del_rsub_"*)
            local idx list_type target raw list_url url i=0
            if case "$cmd" in del_rdom_*) true ;; *) false ;; esac; then
                idx="${cmd#del_rdom_}"; list_type="remote_domain_lists"; target="r_dom_edit"
            else
                idx="${cmd#del_rsub_}"; list_type="remote_subnet_lists"; target="r_sub_edit"
            fi
            raw=$(uci -q show ${PODKOP_UCI}.${sec}.${list_type} 2>/dev/null | cut -d= -f2-)
            if [ -n "$raw" ]; then
                { _ucl=$(uci_list_clean "$raw"); eval "set -- $_ucl"; }
                for url in "$@"; do
                    if [ "$i" -eq "$idx" ]; then list_url="$url"; break; fi
                    i=$((i + 1))
                done
            fi
            if [ -n "$list_url" ]; then
                send_or_edit "$mid" "$(printf '%s Applying...' "$E_RST")" ""
                uci del_list ${PODKOP_UCI}.${sec}.${list_type}="$list_url"
                uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop "force"; sleep 1
            fi
            _handle_lists "$target" "$mid" "" ""
            ;;

        "fr_ips_edit")
            rm -f "$STATE_FILE"
            local rows="" ip raw text kb
            raw=$(uci -q show ${PODKOP_UCI}.${sec}.fully_routed_ips 2>/dev/null | cut -d= -f2-)
            [ -n "$raw" ] && { _ucl=$(uci_list_clean "$raw"); eval "set -- $_ucl"; } && for ip in "$@"; do
                rows="${rows}[{\"text\":\"${E_DEL} ${ip}\",\"callback_data\":\"del_frip_${ip}\"}],"
            done
            local fr_count=0
            [ -n "$raw" ] && { { _ucl=$(uci_list_clean "$raw"); eval "set -- $_ucl"; }; fr_count=$#; }
            text=$(cat <<EOF
${E_FILE} <b>Fully Routed IPs</b> [<code>${sec}</code>]
${fr_count} entries

Tap an IP button to remove it.
${E_IDEA} <i>Fully Routed IPs bypass the domain/subnet lists and always go through the tunnel.</i>
EOF
)
            kb="{\"inline_keyboard\":[${rows}[{\"text\":\"${E_ADD} Add IP\",\"callback_data\":\"cmd_add_fr_ip\"}],[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"community_lists\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "del_frip_"*)
            local ip="${cmd#del_frip_}"
            if ! validate_ip_or_cidr "$ip"; then
                send_or_edit "$mid" "$(printf '%s Invalid IP.' "$E_ERR")" ""; return
            fi
            send_or_edit "$mid" "$(printf '%s Applying...' "$E_RST")" ""
            uci del_list ${PODKOP_UCI}.${sec}.fully_routed_ips="$ip"
            uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop "force"; sleep 1
            _handle_lists "fr_ips_edit" "$mid" "" ""
            ;;

        "excl_ips_edit")
            rm -f "$STATE_FILE"
            local rows="" ip raw text kb excl_count=0
            raw=$(uci -q show ${PODKOP_UCI}.settings.routing_excluded_ips 2>/dev/null | cut -d= -f2-)
            [ -n "$raw" ] && { _ucl=$(uci_list_clean "$raw"); eval "set -- $_ucl"; } && for ip in "$@"; do
                rows="${rows}[{\"text\":\"${E_DEL} ${ip}\",\"callback_data\":\"del_excl_${ip}\"}],"
            done
            [ -n "$raw" ] && { { _ucl=$(uci_list_clean "$raw"); eval "set -- $_ucl"; }; excl_count=$#; }
            text=$(cat <<EOF
${E_FILE} <b>Routing Excluded IPs</b> [<code>global</code>]
${excl_count} entries

Tap an IP button to remove it.
${E_IDEA} <i>Excluded IPs bypass the tunnel entirely — always go direct regardless of rules. This is a global setting (applies to all sections).</i>
EOF
)
            kb="{\"inline_keyboard\":[${rows}[{\"text\":\"${E_ADD} Add IP\",\"callback_data\":\"cmd_add_excl_ip\"}],[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"community_lists\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "del_excl_"*)
            local ip="${cmd#del_excl_}"
            if ! validate_ip_or_cidr "$ip"; then
                send_or_edit "$mid" "$(printf '%s Invalid IP.' "$E_ERR")" ""; return
            fi
            send_or_edit "$mid" "$(printf '%s Applying...' "$E_RST")" ""
            uci del_list ${PODKOP_UCI}.settings.routing_excluded_ips="$ip"
            uci_commit_safe ${PODKOP_UCI}; safe_reload_podkop "force"; sleep 1
            _handle_lists "excl_ips_edit" "$mid" "" ""
            ;;

        # user_domains_text / user_subnets_text — line-by-line editor
        # Shows paginated list (20/page), add line, remove by entering index number.
        "user_domains_menu"|"user_domains_menu_p_"*|"user_subnets_menu"|"user_subnets_menu_p_"*)
            rm -f "$STATE_FILE"
            local field="user_domains_text" human="Custom Domains"
            local add_state="wait_user_domain_add" del_state="wait_user_domain_del"
            local back_cb="user_domains_menu" base_cmd="user_domains_menu"
            local page=0

            case "$cmd" in
                user_subnets_menu|user_subnets_menu_p_*)
                    field="user_subnets_text"; human="Custom Subnets"
                    add_state="wait_user_subnet_add"; del_state="wait_user_subnet_del"
                    back_cb="user_subnets_menu"; base_cmd="user_subnets_menu" ;;
            esac
            case "$cmd" in
                *_p_*) page="${cmd##*_p_}" ;;
            esac

            local per_pg=20 current total total_pages start end idx=0 line list_text
            current=$(uci -q get ${PODKOP_UCI}.${sec}.${field} 2>/dev/null || echo "")
            total=$(printf '%s' "$current" | grep -c "[^[:space:]]" 2>/dev/null)
            case "$total" in ''|*[!0-9]*) total=0 ;; esac
            total_pages=$(( (total + per_pg - 1) / per_pg ))
            [ "$total_pages" -eq 0 ] && total_pages=1
            [ "$page" -ge "$total_pages" ] && page=$((total_pages - 1))
            [ "$page" -lt 0 ] && page=0
            start=$(( page * per_pg )); end=$(( start + per_pg ))

            list_text=""
            while IFS= read -r line; do
                [ -z "$line" ] && continue
                if [ "$idx" -ge "$start" ] && [ "$idx" -lt "$end" ]; then
                    list_text=$(printf '%s\n<code>[%d]</code> %s' "$list_text" "$idx" "$(html_escape "$line")")
                fi
                idx=$((idx + 1))
            done <<EOF
$current
EOF
            [ -z "$list_text" ] && list_text=$(printf '\n<i>No entries.</i>')

            local nav_row=""
            if [ "$total" -gt "$per_pg" ]; then
                local prev_p=$((page-1)) next_p=$((page+1))
                [ "$page" -eq 0 ] && prev_p=0
                [ "$next_p" -ge "$total_pages" ] && next_p=$((total_pages-1))
                nav_row="[{\"text\":\"${E_BACK} Prev\",\"callback_data\":\"${base_cmd}_p_${prev_p}\"},{\"text\":\"${E_FILE} $((page+1))/${total_pages}\",\"callback_data\":\"${base_cmd}_p_${page}\"},{\"text\":\"Next >\",\"callback_data\":\"${base_cmd}_p_${next_p}\"}],"
            fi

            text=$(cat <<EOF
${E_EDIT} <b>${human}</b> [<code>${sec}</code>]
${total} entries (page $((page+1))/${total_pages})
${list_text}

To remove: tap "${E_DEL} Remove by #" and enter the line number.
EOF
)
            local kb
            kb="{\"inline_keyboard\":[${nav_row}[{\"text\":\"${E_ADD} Add line\",\"callback_data\":\"cmd_user_add_${add_state}\"},{\"text\":\"${E_DEL} Remove by #\",\"callback_data\":\"cmd_user_del_${del_state}\"}],[{\"text\":\"${E_FILE} Download as file\",\"callback_data\":\"cmd_user_download_${field}\"},{\"text\":\"${E_BACK} Back\",\"callback_data\":\"community_lists\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "cmd_user_add_"*)
            local add_state="${cmd#cmd_user_add_}"
            local human_hint back_cb="user_domains_menu"
            if [ "$add_state" = "wait_user_subnet_add" ]; then
                human_hint="$(printf '%s <b>Add Custom Subnet</b>\n\nSend one IP or CIDR range.\nExample: <code>10.0.0.0/24</code> or <code>1.2.3.4</code>' "$E_EDIT")"
                back_cb="user_subnets_menu"
            else
                human_hint="$(printf '%s <b>Add Custom Domain</b>\n\nSend one domain name (no http://, no wildcards).\nExample: <code>example.com</code>' "$E_EDIT")"
            fi
            echo "$add_state" > "$STATE_FILE"
            send_or_edit "$mid" "$human_hint" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"${back_cb}\"}]]}"
            ;;

        "cmd_user_del_"*)
            local del_state="${cmd#cmd_user_del_}"
            local back_cb="user_domains_menu"
            [ "$del_state" = "wait_user_subnet_del" ] && back_cb="user_subnets_menu"
            echo "$del_state" > "$STATE_FILE"
            send_or_edit "$mid" "$(printf '%s <b>Remove entry</b>\n\nSend the line number to remove (shown in brackets above).' "$E_DEL")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"${back_cb}\"}]]}"
            ;;

        "cmd_user_download_"*)
            local field="${cmd#cmd_user_download_}"
            local current tmp_f
            current=$(uci -q get ${PODKOP_UCI}.${sec}.${field} 2>/dev/null || echo "")
            tmp_f=$(mktemp /tmp/podkop_userlist.XXXXXX)
            printf '%s\n' "$current" > "$tmp_f"
            api_document "$tmp_f" "${field} [${sec}]"
            rm -f "$tmp_f"
            ;;

        "cmd_add_fr_ip")
            echo "wait_fully_routed_ip" > "$STATE_FILE"
            send_or_edit "$mid" "$(printf '%s <b>Add Fully Routed IP</b>\n\nSend IP or CIDR (e.g. <code>192.168.1.50</code>).' "$E_EDIT")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"community_lists\"}]]}"
            ;;

        "cmd_add_excl_ip")
            echo "wait_excl_ip" > "$STATE_FILE"
            send_or_edit "$mid" "$(printf '%s <b>Add Routing Excluded IP</b>\n\nSend IP or CIDR.\nThis IP will always bypass the tunnel.\nExample: <code>10.0.0.0/8</code>' "$E_EDIT")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"excl_ips_edit\"}]]}"
            ;;
        "cmd_add_r_dom")
            echo "wait_remote_domain" > "$STATE_FILE"
            send_or_edit "$mid" "$(printf '%s <b>Add Remote Domain List URL</b>\n\nSend http/https URL.' "$E_EDIT")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"community_lists\"}]]}"
            ;;
        "cmd_add_r_sub")
            echo "wait_remote_subnet" > "$STATE_FILE"
            send_or_edit "$mid" "$(printf '%s <b>Add Remote Subnet List URL</b>\n\nSend http/https URL.' "$E_EDIT")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"community_lists\"}]]}"
            ;;
    esac
}

# ------------------------------------------------------------------------------
# 9.6: Bot & System Handler
# Main menu, Status, Runtime Info, Tunnel Health, Bot Settings, system actions.
#
# FIXED: wan_ip uses ip route + uci (no blocking curl to api.ipify.org)
# FIXED: main_menu does NOT call get_tg_latency (removed 3s delay per open)
# NEW:   cmd_tunnel_health - dedicated Tunnel Health screen
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# 9.6: Fallback SOCKS Manager
_handle_fallback_socks() {
    local cmd="$1" mid="$2" text="$3" state="$4"

    if [ "$cmd" = "STATE_INPUT" ]; then
        rm -f "$STATE_FILE"
        if [ "$state" = "wait_admin_id" ]; then
            delete_message "$mid"
            local safe_id
            safe_id=$(printf "%s" "$text" | tr -d '\r\n\t ')
            local _primary_chat; _primary_chat=$(uci -q get podkop_bot.settings.chat_id 2>/dev/null)
            if ! echo "$safe_id" | grep -qE '^-?[0-9]+$'; then
                send_message "$(printf '%s <b>Invalid ID!</b>\nUser ID must be numeric.\nExample: <code>123456789</code>' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"admins_menu\"}]]}"
            elif [ "$safe_id" = "$_primary_chat" ]; then
                send_message "$(printf '%s This is the primary admin (chat_id) — already has full access.' "$E_WARN")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"admins_menu\"}]]}"
            else
                local _existing_aids _dup=0
                _existing_aids=$(uci -q show podkop_bot.settings.admin_ids 2>/dev/null | cut -d= -f2-)
                if [ -n "$_existing_aids" ]; then
                    { _ucl=$(uci_list_clean "$_existing_aids"); eval "set -- $_ucl"; }
                    for _e in "$@"; do
                        [ "$_e" = "$safe_id" ] && _dup=1 && break
                    done
                fi
                if [ "$_dup" = "1" ]; then
                    send_message "$(printf '%s <b>Duplicate!</b>\n<code>%s</code> already in admin list.' "$E_WARN" "$safe_id")" \
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"admins_menu\"}]]}"
                else
                    uci add_list podkop_bot.settings.admin_ids="$safe_id"
                    uci_commit_safe podkop_bot
                    ADMIN_IDS=$(uci -q get podkop_bot.settings.admin_ids 2>/dev/null)
                    _handle_bot "admins_menu" "" "" ""
                fi
            fi
        fi

        if [ "$state" = "wait_fb_socks_add" ]; then
            delete_message "$mid"
            local safe_fb
            safe_fb=$(printf "%s" "$text" | tr -d '\r\n' | sed 's/[[:space:]]//g')
            if ! echo "$safe_fb" | grep -qE '^socks5h?://[^:]+:[0-9]+$'; then
                send_message "$(printf '%s <b>Invalid format!</b>\nExpected: <code>socks5://IP:PORT</code> or <code>socks5h://IP:PORT</code>\n<code>socks5h://</code> resolves DNS through the proxy (recommended under RKN).\nExample: <code>socks5h://192.168.2.238:18080</code>' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"fallback_socks_menu\"}]]}"
            else
                local _existing _dup=0
                _existing=$(uci -q show podkop_bot.settings.fallback_socks 2>/dev/null | cut -d= -f2-)
                # Normalize to host:port for duplicate check (socks5:// and socks5h:// same endpoint)
                local _new_hp; _new_hp=$(echo "$safe_fb" | sed 's|^socks5h\?://||')
                if [ -n "$_existing" ]; then
                    { _ucl=$(uci_list_clean "$_existing"); eval "set -- $_ucl"; }
                    for _e in "$@"; do
                        local _e_hp; _e_hp=$(echo "$_e" | sed 's|^socks5h\?://||')
                        [ "$_e_hp" = "$_new_hp" ] && _dup=1 && break
                    done
                fi
                if [ "$_dup" = "1" ]; then
                    send_message "$(printf '%s <b>Duplicate!</b>\nEndpoint <code>%s</code> already in list (same host:port).' "$E_WARN" "$_new_hp")" \
                        "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"fallback_socks_menu\"}]]}"
                else
                    uci add_list podkop_bot.settings.fallback_socks="$safe_fb"
                    uci_commit_safe podkop_bot
                    _handle_fallback_socks "fallback_socks_menu" "" "" ""
                fi
            fi
        fi
        return
    fi

    case "$cmd" in
        "fallback_socks_menu")
            rm -f "$STATE_FILE"
            local rows list_text kb n=0 _fb
            local _fb_raw
            _fb_raw=$(uci -q show podkop_bot.settings.fallback_socks 2>/dev/null | cut -d= -f2-)
            rows=""; list_text=""
            if [ -n "$_fb_raw" ]; then
                { _ucl=$(uci_list_clean "$_fb_raw"); eval "set -- $_ucl"; }
                for _fb in "$@"; do
                    list_text=$(printf '%s\n<code>[%s]</code> %s' "$list_text" "$n" "$_fb")
                    rows="${rows}[{\"text\":\"${E_DEL} [${n}] ${_fb}\",\"callback_data\":\"ask_del_fb_${n}\"}],"
                    n=$((n + 1))
                done
            fi
            list_text="${list_text#?}"
            [ -z "$list_text" ] && list_text="<i>No fallback SOCKS configured.</i>"
            local text kb
            text=$(printf '%s <b>Fallback SOCKS</b>\n\nTried in order after Podkop SOCKS5 fails.\nFormat: <code>socks5://IP:PORT</code> or <code>socks5h://IP:PORT</code>\n\n%s' "$E_NET" "$list_text")
            kb="{\"inline_keyboard\":[${rows}[{\"text\":\"${E_ADD} Add\",\"callback_data\":\"cmd_fb_socks_add\"},{\"text\":\"${E_RST} Refresh\",\"callback_data\":\"fallback_socks_menu\"}],[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"bot_settings\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "admins_menu")
            rm -f "$STATE_FILE"
            local rows="" list_text="" n=0 _aid
            local _primary_chat; _primary_chat=$(uci -q get podkop_bot.settings.chat_id 2>/dev/null)
            local _aids_raw
            _aids_raw=$(uci -q show podkop_bot.settings.admin_ids 2>/dev/null | cut -d= -f2-)
            # Always show primary chat_id first (protected)
            list_text="<code>[primary]</code> <b>${_primary_chat}</b> 🔒"
            if [ -n "$_aids_raw" ]; then
                { _ucl=$(uci_list_clean "$_aids_raw"); eval "set -- $_ucl"; }
                for _aid in "$@"; do
                    list_text=$(printf '%s\n<code>[%s]</code> %s' "$list_text" "$n" "$_aid")
                    rows="${rows}[{\"text\":\"${E_DEL} [${n}] ${_aid}\",\"callback_data\":\"ask_del_admin_${n}\"}],"
                    n=$((n + 1))
                done
            fi
            [ "$n" -eq 0 ] && list_text=$(printf '%s\n\n<i>No additional admins.</i>' "$list_text")
            local _anon; _anon=$(uci -q get podkop_bot.settings.allow_anonymous_admins 2>/dev/null || echo "0")
            local _anon_icon; [ "$_anon" = "1" ] && _anon_icon="$E_ON" || _anon_icon="$E_RED"
            local text
            text=$(printf '👤 <b>Bot Admins</b>\n\nThese users can control the bot.\nPrimary admin (chat_id) cannot be removed.\n\n%s' "$list_text")
            local kb="{\"inline_keyboard\":[${rows}[{\"text\":\"${E_ADD} Add Admin\",\"callback_data\":\"cmd_admin_add\"},{\"text\":\"${E_RST} Refresh\",\"callback_data\":\"admins_menu\"}],[{\"text\":\"${_anon_icon} Anon group admins\",\"callback_data\":\"toggle_anon_admins\"}],[{\"text\":\"🤖 Bot Info & Invite\",\"callback_data\":\"cmd_bot_invite_info\"}],[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"bot_settings\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "cmd_bot_invite_info")
            load_bot_identity
            local _uname="${BOT_USERNAME:-unknown}"
            local _bid="${BOT_ID:-unknown}"
            send_or_edit "$mid" "$(printf '🤖 <b>Bot Identity</b>\n\nUsername: <code>@%s</code>\nBot ID: <code>%s</code>\nVersion: <code>%s</code>\n\n<b>To add bot to a group/channel:</b>\n1. Open the group or channel\n2. Add <code>@%s</code> as member\n3. Grant admin rights if needed\n4. Get the chat ID (use @userinfobot or check logs)\n5. Add the chat ID via <b>Add Admin</b>\n\n<i>The bot will accept commands from any chat ID listed as admin.</i>' \
                "$_uname" "$_bid" "$BOT_VERSION" "$_uname")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"admins_menu\"}]]}"
            ;;

        "toggle_anon_admins")
            toggle_uci_bool "podkop_bot.settings" "allow_anonymous_admins"
            ALLOW_ANON_ADMINS=$(uci -q get podkop_bot.settings.allow_anonymous_admins 2>/dev/null)
            _handle_bot "admins_menu" "$mid" "" ""
            ;;

        "cmd_admin_add")
            echo "wait_admin_id" > "$STATE_FILE"
            send_or_edit "$mid" "$(printf '👤 <b>Add Admin</b>\n\nSend the Telegram <b>User ID</b> (numeric) of the new admin.\n\nExample: <code>123456789</code>\n\n<i>User must start a chat with the bot first.</i>')" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"admins_menu\"}]]}"
            ;;

        "ask_del_admin_"*)
            local idx="${cmd#ask_del_admin_}" aid_to_del="" n=0 _aid
            local _aids_raw
            _aids_raw=$(uci -q show podkop_bot.settings.admin_ids 2>/dev/null | cut -d= -f2-)
            if [ -n "$_aids_raw" ]; then
                { _ucl=$(uci_list_clean "$_aids_raw"); eval "set -- $_ucl"; }
                for _aid in "$@"; do
                    [ "$n" -eq "$idx" ] && aid_to_del="$_aid" && break
                    n=$((n + 1))
                done
            fi
            [ -z "$aid_to_del" ] && {
                send_or_edit "$mid" "$(printf '%s Admin not found.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"admins_menu\"}]]}"
                return
            }
            send_or_edit "$mid" \
                "$(printf '%s <b>Remove admin?</b>\n\n<code>%s</code>' "$E_WARN" "$aid_to_del")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Remove\",\"callback_data\":\"do_del_admin_${idx}\"},{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"admins_menu\"}]]}"
            ;;

        "do_del_admin_"*)
            local idx="${cmd#do_del_admin_}" aid_to_del="" n=0 _aid
            local _aids_raw
            _aids_raw=$(uci -q show podkop_bot.settings.admin_ids 2>/dev/null | cut -d= -f2-)
            if [ -n "$_aids_raw" ]; then
                { _ucl=$(uci_list_clean "$_aids_raw"); eval "set -- $_ucl"; }
                for _aid in "$@"; do
                    [ "$n" -eq "$idx" ] && aid_to_del="$_aid" && break
                    n=$((n + 1))
                done
            fi
            [ -z "$aid_to_del" ] && {
                _handle_bot "admins_menu" "$mid" "" ""
                return
            }
            uci del_list podkop_bot.settings.admin_ids="$aid_to_del"
            uci_commit_safe podkop_bot
            # Reload ADMIN_IDS in memory
            ADMIN_IDS=$(uci -q get podkop_bot.settings.admin_ids 2>/dev/null)
            send_or_edit "$mid" "$(printf '%s Removed admin <code>%s</code>.' "$E_OK" "$aid_to_del")" ""
            sleep 1
            _handle_bot "admins_menu" "$mid" "" ""
            ;;

        "ask_del_fb_"*)
            local idx="${cmd#ask_del_fb_}" fb_to_del="" n=0 _fb
            local _fb_raw
            _fb_raw=$(uci -q show podkop_bot.settings.fallback_socks 2>/dev/null | cut -d= -f2-)
            if [ -n "$_fb_raw" ]; then
                { _ucl=$(uci_list_clean "$_fb_raw"); eval "set -- $_ucl"; }
                for _fb in "$@"; do
                    [ "$n" -eq "$idx" ] && fb_to_del="$_fb" && break
                    n=$((n + 1))
                done
            fi
            [ -z "$fb_to_del" ] && {
                send_or_edit "$mid" "$(printf '%s Entry not found.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"fallback_socks_menu\"}]]}"
                return
            }
            send_or_edit "$mid" \
                "$(printf '%s <b>Remove this fallback?</b>\n\n<code>%s</code>' "$E_WARN" "$fb_to_del")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Remove\",\"callback_data\":\"do_del_fb_${idx}\"},{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"fallback_socks_menu\"}]]}"
            ;;

        "do_del_fb_"*)
            local idx="${cmd#do_del_fb_}" n=0 _fb
            local _fb_raw
            _fb_raw=$(uci -q show podkop_bot.settings.fallback_socks 2>/dev/null | cut -d= -f2-)
            if [ -n "$_fb_raw" ]; then
                { _ucl=$(uci_list_clean "$_fb_raw"); eval "set -- $_ucl"; }
                # Find value by index, delete by value (most reliable on all OpenWrt builds)
                local _del_val=""
                for _fb in "$@"; do
                    [ "$n" -eq "$idx" ] && { _del_val="$_fb"; break; }
                    n=$((n + 1))
                done
                if [ -n "$_del_val" ]; then
                    uci del_list podkop_bot.settings.fallback_socks="$_del_val"
                    uci_commit_safe podkop_bot
                    # Verify — if del_list failed, rebuild without the index
                    local _after
                    _after=$(uci -q show podkop_bot.settings.fallback_socks 2>/dev/null | cut -d= -f2-)
                    if printf '%s' "$_after" | grep -qF "$_del_val"; then
                        n=0
                        uci delete podkop_bot.settings.fallback_socks 2>/dev/null
                        for _fb in "$@"; do
                            [ "$n" -ne "$idx" ] && uci add_list podkop_bot.settings.fallback_socks="$_fb"
                            n=$((n + 1))
                        done
                        uci_commit_safe podkop_bot
                    fi
                fi
            fi
            _handle_fallback_socks "fallback_socks_menu" "$mid" "" ""
            ;;

        "cmd_test_fb_socks")
            send_or_edit "$mid" "$(printf '%s Testing SOCKS endpoints...' "$E_TIME")" ""
            _load_transport_ctx
            local n=0 _fb result_text=""
            # Short timeouts for interactive test (3s connect / 5s total per endpoint)
            _probe_fast() {
                local _url="$1" _out _code _time
                _out=$(curl -s -k -x "$_url" \
                    --connect-timeout 3 --max-time 5 \
                    -o /dev/null -w "%{http_code}:%{time_total}" \
                    "http://www.gstatic.com/generate_204" 2>/dev/null)
                _code="${_out%%:*}"
                _time="${_out#*:}"
                if [ "$_code" = "204" ]; then
                    awk -v t="$_time" 'BEGIN{printf "%dms", int(t*1000)}'
                else
                    echo "timeout"
                fi
            }
            local lat; lat=$(_probe_fast "socks5h://${_t_ip}:${_t_port}")
            case "$lat" in timeout|fail) result_text="${result_text}${E_ERR} tier1 Podkop: <code>$lat</code>\n" ;;
                *) result_text="${result_text}${E_ON} tier1 Podkop: <code>$lat</code>\n" ;; esac
            for _fb in $_t_fb_socks; do
                n=$((n + 1))
                lat=$(_probe_fast "$_fb")
                case "$lat" in timeout|fail)
                    result_text="${result_text}${E_ERR} tier2_${n}: <code>$lat</code> <i>${_fb}</i>\n" ;;
                    *) result_text="${result_text}${E_ON} tier2_${n}: <code>$lat</code> <i>${_fb}</i>\n" ;;
                esac
            done
            unset -f _probe_fast
            [ -z "$result_text" ] && result_text="<i>No endpoints configured.</i>"
            send_or_edit "$mid" \
                "$(printf '%s <b>SOCKS Reachability Test</b>\n<i>(gstatic 204, 3s timeout)</i>\n\n%b' "$E_TEST" "$result_text")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_RST} Re-test\",\"callback_data\":\"cmd_test_fb_socks\"},{\"text\":\"${E_BACK} Back\",\"callback_data\":\"fallback_socks_menu\"}]]}"
            ;;

        "cmd_fb_socks_add")
            echo "wait_fb_socks_add" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Add Fallback SOCKS</b>\n\n<code>socks5h://IP:PORT</code> — recommended (remote DNS)\n<code>socks5://IP:PORT</code> — local DNS\n<code>socks5h://hostname:PORT</code> — domain also works\n\nExample: <code>socks5h://192.168.2.238:18080</code>' "$E_EDIT")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"fallback_socks_menu\"}]]}"
            ;;
    esac
}

_handle_bot() {
    local cmd="$1" mid="$2" text="$3" state="$4"

    if [ "$cmd" = "STATE_INPUT" ]; then
        rm -f "$STATE_FILE"
        if [ "$state" = "wait_restart_router_confirm" ]; then
            local input; input=$(printf "%s" "$text" | tr -d '\r\n\t ')
            if [ "$input" = "YES" ]; then
                send_message "$(printf '%s <b>Rebooting %s now...</b>\nBot will be back online in ~60 seconds.' "$E_OFF" "$(cat /proc/sys/kernel/hostname 2>/dev/null || echo Router)")" ""
                logger -t podkop-bot "[Restart Router] Manual reboot requested via Telegram"
                sleep 2
                reboot
            else
                delete_message "$mid"
                send_message "$(printf '%s Reboot cancelled. You typed: <code>%s</code>' "$E_BACK" "$(html_escape "$input")")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_maintenance\"}]]}"
            fi
            return
        elif [ "$state" = "wait_custom_proxy" ]; then
            delete_message "$mid"
            local safe_link=$(printf "%s" "$text" | tr -d '\r\n\t ')
            if echo "$safe_link" | grep -qE '^(http|https|socks5|socks5h)://'; then
                uci set podkop_bot.settings.custom_proxy="$safe_link"; uci_commit_safe podkop_bot
                send_message "$(printf '%s Custom proxy saved.' "$E_OK")" ""
                _handle_bot "bot_settings" "" "" ""
            else
                send_message "$(printf '%s Must start with http:// or socks5://' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"bot_settings\"}]]}"
            fi
        elif [ "$state" = "wait_bind_iface" ]; then
            delete_message "$mid"
            local safe_iface=$(printf "%s" "$text" | tr -d '\r\n')
            if echo "$safe_iface" | grep -q '[[:space:]]'; then
                send_message "$(printf '%s Interface name contains spaces.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"bot_settings\"}]]}"
            elif ! ip link show "$safe_iface" >/dev/null 2>&1; then
                send_message "$(printf '%s Interface <code>%s</code> does not exist.' "$E_ERR" "$safe_iface")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"bot_settings\"}]]}"
            else
                uci set podkop_bot.settings.bind_interface="$safe_iface"; uci_commit_safe podkop_bot
                send_message "$(printf '%s Bound to: %s' "$E_OK" "$safe_iface")" ""
                _handle_bot "bot_settings" "" "" ""
            fi
        fi
        return
    fi

    case "$cmd" in
        # Back-compat: the /status slash-command redirects to the cmd_status
        # screen. IMPORTANT: this pattern must NOT include "cmd_status" itself —
        # doing so makes this branch call _handle_bot "cmd_status", which matches
        # this same pattern again → unbounded recursion → the shell aborts and
        # procd respawns the bot (the "Status crashes & restarts" bug). Plain
        # "cmd_status" must fall through to the real renderer below.
        "/status")
            _handle_bot "cmd_status" "$mid" "" "" ;;

        "/start"|"/menu"|"main_menu"|"main_menu_new")
            rm -f "$STATE_FILE"
            # Install persistent bottom keyboard on /start or /menu
            install_reply_keyboard_once
            local _stop_start hostname p_ver active_proxy active_proxy_display sec sec_count sec_str text kb

            _stop_start="{\"text\":\"${E_STP} Stop Podkop\",\"callback_data\":\"ask_cmd_stop\"}"
            pidof sing-box >/dev/null 2>&1 || \
                _stop_start="{\"text\":\"${E_ON} Start Podkop\",\"callback_data\":\"cmd_start\"}"

            hostname=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo "Router")
            p_ver=$(opkg info ${PODKOP_PKG} 2>/dev/null | grep '^Version:' | tail -1 | cut -d' ' -f2 | sed 's/^v//' | cut -d'-' -f1)
            [ -z "$p_ver" ] && p_ver=$(apk info ${PODKOP_PKG} 2>/dev/null | head -1 | awk '{print $1}' | sed "s/^${PODKOP_PKG}-//;s/^v//" | cut -d'-' -f1)
            # Pass cached proxies to avoid extra clash_request
            local proxies; proxies=$(clash_request "/proxies")
            active_proxy=$(get_active_proxy_name "$proxies")
            active_proxy_display=$(html_escape "$(get_active_proxy_display "$proxies")")
            sec=$(get_active_section)
            sec_count=$(uci -q show ${PODKOP_UCI} 2>/dev/null | grep -cE "^${PODKOP_UCI}\.[^.=]+=section$")

            # Show section name always when >1 section, on its own line before Active Route
            sec_str=""
            [ "$sec_count" -gt 1 ] && sec_str="<b>Section:</b> <code>${sec}</code>"

            # Subscription metadata for Plus (traffic/expiry) — show in main menu
            # Traffic/expiry shown in Outbounds, not main menu

            # NOTE: get_tg_latency intentionally removed from main_menu (was 3s delay per open)
            # Latency is still available in Status and Bot Settings screens.
            text=$(cat <<EOF
<b>${E_RTR} Podkop Manager</b>
<b>Host:</b> ${hostname}
<b>Podkop:</b> ${p_ver:-Unknown} (${PODKOP_DISPLAY_NAME}) | <b>Bot:</b> v${BOT_VERSION}
${sec_str:+${sec_str}
}<b>Active Route:</b> <code>${active_proxy_display}</code>
<b>Bot route:</b> ${LAST_ROUTE_NAME}
EOF
)
            kb="{\"inline_keyboard\":["
            # Mode-aware proxy button: label and target depend on proxy_config_type
            local cur_pct; cur_pct=$(get_section_type "$sec")
            local proxy_btn_lbl proxy_btn_cb
            case "$cur_pct" in
                proxy:urltest)      proxy_btn_lbl="${E_GLOB} Outbounds"; proxy_btn_cb="proxy_menu" ;;
                proxy:url)          proxy_btn_lbl="${E_GLOB} Single URL"; proxy_btn_cb="url_links_menu" ;;
                proxy:subscription) proxy_btn_lbl="📡 Subscription";     proxy_btn_cb="proxy_menu" ;;
                outbound)           proxy_btn_lbl="${E_GLOB} Outbound";   proxy_btn_cb="outbound_info" ;;
                *)                  proxy_btn_lbl="${E_GLOB} Outbounds";  proxy_btn_cb="proxy_menu" ;;
            esac
            kb="${kb}[{\"text\":\"${E_STAT} Status\",\"callback_data\":\"cmd_status\"},{\"text\":\"${proxy_btn_lbl}\",\"callback_data\":\"${proxy_btn_cb}\"}],"
            kb="${kb}[{\"text\":\"${E_SET} Settings\",\"callback_data\":\"main_settings_menu\"},{\"text\":\"${E_RST} Reload Podkop\",\"callback_data\":\"ask_reload_podkop\"}],"
            kb="${kb}[{\"text\":\"${E_BOT} Bot Settings\",\"callback_data\":\"bot_settings\"},${_stop_start}],"
            [ "$PODKOP_VARIANT" = "plus" ] && \
                kb="${kb}[{\"text\":\"${E_SRV} Server Instances\",\"callback_data\":\"cmd_server_instances\"}],"
            kb="${kb}[{\"text\":\"🔧 Maintenance\",\"callback_data\":\"cmd_maintenance\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "cmd_status")
            local hostname lan_ip wan_ip uptime_sys loadavg mem_free os_ver extra_ifs
            local podkop_running podkop_autostart_ok podkop_mode podkop_mode_lbl
            local sb_running sb_pid sb_ram sb_ver_st p_ver_st
            local proxies active_proxy_display pub_ip_display
            local _h_tgd _h_tgt _h_socks _h_tier2
            local strategy yacd_en tg_lat sec text kb

            hostname=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo "Router")
            os_ver=$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || echo "OpenWrt")

            lan_ip=$(uci -q get network.lan.ipaddr || echo "Unknown")
            wan_ip=$(ip -4 route get 1.1.1.1 2>/dev/null \
                | awk '/src/{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
            [ -z "$wan_ip" ] && wan_ip=$(uci -q get network.wan.ipaddr 2>/dev/null || echo "Unknown")
            uptime_sys=$(awk '{d=int($1/86400);h=int(($1%86400)/3600);m=int(($1%3600)/60);printf "%dd %dh %dm",d,h,m}' /proc/uptime)
            loadavg=$(awk '{printf "%s, %s, %s",$1,$2,$3}' /proc/loadavg)
            mem_free=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo "0")

            extra_ifs=$(ip -4 addr show 2>/dev/null | awk -v icon="${E_NET}" '/inet / {
                iface=$NF; sub(/@.*/, "", iface);
                if(iface ~ /^(tun|tail|awg|wg|zt|zero)/) {
                    ip=$2; sub(/\/.*/, "", ip);
                    if      (iface ~ /^tail/)  label="Tailscale"
                    else if (iface ~ /^zt/)    label="ZeroTier"
                    else if (iface ~ /^awg/)   label="AmneziaWG"
                    else if (iface ~ /^wg/)    label="WireGuard"
                    else if (iface ~ /^tun/)   label="VPN"
                    else                       label=iface
                    printf "%s %s (<code>%s</code>): <code>%s</code>\n", icon, label, iface, ip;
                }
            }')
            [ -n "$extra_ifs" ] && extra_ifs="${extra_ifs}
"
            # Podkop state
            podkop_running=0
            ${PODKOP_INIT} status 2>&1 | grep -qi "running" && podkop_running=1
            podkop_autostart_ok=0
            ${PODKOP_INIT} enabled >/dev/null 2>&1 && podkop_autostart_ok=1

            sec=$(get_active_section)
            podkop_mode=$(get_section_type "$sec")
            case "$podkop_mode" in
                proxy:selector)     podkop_mode_lbl="Selector" ;;
                proxy:urltest)      podkop_mode_lbl="URLTest" ;;
                proxy:url)          podkop_mode_lbl="URL" ;;
                proxy:subscription) podkop_mode_lbl="Subscription" ;;
                outbound)           podkop_mode_lbl="Outbound" ;;
                byedpi|zapret)      podkop_mode_lbl="${podkop_mode}" ;;
                vpn)                podkop_mode_lbl="VPN" ;;
                *)                  podkop_mode_lbl="${podkop_mode}" ;;
            esac

            # Sing-box state
            sb_running=0
            pidof sing-box >/dev/null 2>&1 && sb_running=1
            sb_pid=$(pidof sing-box 2>/dev/null || echo "")
            sb_ram="0"
            [ -n "$sb_pid" ] && \
                sb_ram=$(awk '/VmRSS/{print int($2/1024)}' /proc/"$sb_pid"/status 2>/dev/null || echo "0")

            # Versions — use Plus get_system_info if available, else manual
            local _sysinfo _update_avail=""
            if _plus_has_cmd "get_system_info"; then
                _sysinfo=$(_plus_json get_system_info)
                p_ver_st=$(printf '%s' "$_sysinfo" | jq -r '.podkop_version // ""' 2>/dev/null)
                sb_ver_st=$(printf '%s' "$_sysinfo" | jq -r '.sing_box_version // ""' 2>/dev/null)
                # Check if update available
                local _latest; _latest=$(printf '%s' "$_sysinfo" | jq -r '.podkop_latest_version // "unknown"' 2>/dev/null)
                if [ -n "$_latest" ] && [ "$_latest" != "unknown" ] && [ "$_latest" != "$p_ver_st" ]; then
                    _update_avail=" → <b>${_latest}</b> available"
                fi
            fi
            if [ -z "$p_ver_st" ]; then
                p_ver_st=$(opkg info ${PODKOP_PKG} 2>/dev/null | grep '^Version:' | tail -1 | cut -d' ' -f2 | sed 's/^v//' | cut -d'-' -f1)
                [ -z "$p_ver_st" ] && p_ver_st=$(apk info ${PODKOP_PKG} 2>/dev/null | head -1 | awk '{print $1}' | sed "s/^${PODKOP_PKG}-//;s/^v//" | cut -d'-' -f1)
            fi
            [ -z "$sb_ver_st" ] && sb_ver_st=$(get_singbox_version_display)
            # Device model — read from Plus CLI if available, else /tmp/sysinfo/model
            local _device_model
            if [ -n "${_sysinfo:-}" ]; then
                _device_model=$(printf '%s' "$_sysinfo" | jq -r 'if (.device_model // "") == "unknown" then "" else (.device_model // "") end' 2>/dev/null)
            fi
            [ -z "$_device_model" ] && _device_model=$(cat /tmp/sysinfo/model 2>/dev/null || echo "")
            local _device_model_html; _device_model_html=$(html_escape "$_device_model")

            # Connectivity state from SOCKS_STATE_FILE
            _h_tgd=$(grep "^tg_direct=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)
            _h_tgt=$(grep "^tg_transport=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)
            _h_socks=$(grep "^socks=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)
            _h_tier2=$(grep "^tg_tier2=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)

            strategy=$(uci -q get ${PODKOP_UCI}.settings.dns_type || echo "udp")
            yacd_en=$(uci -q get ${PODKOP_UCI}.settings.enable_yacd || echo "0")
            tg_lat=$(get_tg_latency)

            proxies=$(clash_request "/proxies")
            active_proxy_display=$(html_escape "$(get_active_proxy_display "$proxies")")
            # Truncate proxy display for Status (full URI in Runtime Info).
            # POSIX/BusyBox-safe: do not use ${var:0:N}; some OpenWrt ash builds
            # abort with "bad substitution" at runtime, which killed cmd_status.
            if [ "$(printf '%s' "$active_proxy_display" | wc -c | tr -d ' ')" -gt 40 ]; then
                # For "subscription · urltest → Node (tag)" — strip (tag) part first,
                # then truncate at 38 chars if still too long
                active_proxy_display=$(printf '%s' "$active_proxy_display" | sed 's/ ([^)]*)$//')
                if [ "$(printf '%s' "$active_proxy_display" | wc -c | tr -d ' ')" -gt 38 ]; then
                    active_proxy_display="$(printf '%s' "$active_proxy_display" | cut -c1-36)…"
                fi
            fi
            pub_ip_display=$(get_public_ip_display)

            # ── HTML-escape display strings ───────────────────────────────────
            local _route_name_html _hostname_html _os_ver_html _mode_lbl_html _strategy_html
            _route_name_html=$(html_escape "$LAST_ROUTE_NAME")
            _hostname_html=$(html_escape "$hostname")
            _os_ver_html=$(html_escape "$os_ver")
            _mode_lbl_html=$(html_escape "$podkop_mode_lbl")
            # For Plus subscription: mode already in active_proxy_display — skip suffix
            local _mode_suffix
            if [ "$PODKOP_VARIANT" = "plus" ] && section_is_subscription "$sec" 2>/dev/null; then
                _mode_suffix=""
            else
                _mode_suffix=" — ${_mode_lbl_html}"
            fi
            _strategy_html=$(html_escape "$strategy")



            # ── Aggregate severity ────────────────────────────────────────────
            # Inputs: podkop_running, sb_running, _h_tgt, _h_socks, LAST_ROUTE
            local _sev _sev_title _sev_note
            local _socks_state _tg_ok=0
            case "$_h_socks" in
                up)   _socks_state="up" ;;
                down) _socks_state="down" ;;
                *)    _socks_state="unknown" ;;
            esac
            [ "$_h_tgt" = "ok" ] && _tg_ok=1

            _sev=$(_status_severity "$podkop_running" "$sb_running" "$_h_tgt" "$_h_socks" "$LAST_ROUTE")
            # Override: empty SOCKS_STATE_FILE (watchdog not yet run) → pending, not degraded
            [ "$_socks_state" = "unknown" ] && [ "$_sev" = "degraded" ] && _sev="ok"

            case "$_sev" in
                ok)
                    _sev_title="${E_OK} <b>Podkop is running</b>"
                    if [ "$_socks_state" = "unknown" ]; then
                        _sev_note="Health check pending — watchdog has not run yet."
                    else
                        case "$_h_tgd" in
                            ok)      _sev_note="Telegram reachable directly and via tunnel." ;;
                            fail)    _sev_note="Telegram via tunnel. Direct is blocked — expected for this network." ;;
                            unknown) _sev_note="Telegram reachable via tunnel. Direct not checked (WAN iface unknown)." ;;
                            *)       _sev_note="Telegram reachable via tunnel." ;;
                        esac
                    fi
                    ;;
                warn)
                    _sev_title="${E_WARN} <b>Running with limitations</b>"
                    _sev_note="Podkop is running but Telegram is unreachable via tunnel."
                    ;;
                degraded)
                    _sev_title="${E_YLW} <b>Bot on fallback route</b>"
                    case "$LAST_ROUTE" in
                        tier4) _sev_note="SOCKS unavailable. Bot connected directly — may stop responding if Telegram is blocked." ;;
                        tier5) _sev_note="All routes failed. Bot using emergency Telegram IPs." ;;
                        *)     _sev_note="Primary SOCKS unavailable. Bot on $(html_escape "$LAST_ROUTE_NAME")." ;;
                    esac
                    ;;
                fail)
                    _sev_title="${E_ERR} <b>Action required</b>"
                    if   [ "$podkop_running" = "0" ]; then
                        _sev_note="Podkop is not running. Traffic may not be routed through VPN."
                    elif [ "$sb_running" = "0" ]; then
                        _sev_note="Sing-box is stopped. Reload Podkop to restart."
                    else
                        _sev_note="Service state unknown."
                    fi
                    ;;
            esac

            # ── Telegram connectivity block ───────────────────────────────────
            local _tg_line _tg_direct_line _tg_backup_line
            if [ "$_tg_ok" = "1" ]; then
                _tg_line="${E_OK} via ${_route_name_html}"
            else
                _tg_line="${E_ERR} unreachable"
            fi
            case "$_h_tgd" in
                ok)      _tg_direct_line="${E_OK} reachable" ;;
                fail)    _tg_direct_line="${E_ERR} blocked" ;;
                unknown) _tg_direct_line="${E_OFF} not checked (WAN iface unknown)" ;;
                *)       _tg_direct_line="${E_OFF} unknown" ;;
            esac
            case "$_h_tier2" in
                ok)
                    case "$LAST_ROUTE" in
                        tier2_*) _tg_backup_line="${E_OK} active (in use)" ;;
                        *)       _tg_backup_line="${E_OK} available" ;;
                    esac ;;
                fail) _tg_backup_line="${E_ERR} unavailable" ;;
                *)    _tg_backup_line="not configured" ;;
            esac

            # ── Bot route block ───────────────────────────────────────────────
            local _route_icon _route_note
            case "$LAST_ROUTE" in
                tier1)   _route_icon="$E_OK" ;  _route_note="" ;;
                tier2_*) _route_icon="$E_OK" ;  _route_note=" (backup SOCKS)" ;;
                tier3)   _route_icon="$E_OK" ;  _route_note=" (custom proxy)" ;;
                tier4)   _route_icon="$E_YLW";  _route_note=" ⚠ direct — bot may fail if TG is blocked" ;;
                tier5)   _route_icon="$E_ERR";  _route_note=" ⚠ emergency IPs only" ;;
                *)       _route_icon="$E_OFF";  _route_note="" ;;
            esac


            # ── Build text ────────────────────────────────────────────────────
            # Short version for display (strip trailing build number after 3rd dot for singbox)
            local sb_ver_short p_ver_short
            sb_ver_short=$(printf '%s' "$sb_ver_st" | sed 's/-[0-9]*\.[0-9]*\.[0-9]*$//')
            p_ver_short="$p_ver_st"

            # Podkop status icons
            local _pk_icon _sb_icon _as_icon
            [ "$podkop_running"    = "1" ] && _pk_icon="$E_OK" || _pk_icon="$E_ERR"
            [ "$sb_running"        = "1" ] && _sb_icon="$E_OK" || _sb_icon="$E_ERR"
            [ "$podkop_autostart_ok" = "1" ] && _as_icon="$E_OK" || _as_icon="$E_ERR"

            # Precompute all optional fragments outside the message body.
            # BusyBox ash on OpenWrt is much safer when Status text contains no
            # embedded command substitutions inside a here-doc / multi-line body.
            local _device_model_inline _pub_ip_inline _sb_ram_inline _tier2_inline _yacd_icon _pub_ip_html
            # Full device model is intentionally NOT shown on the Status host line
            # (too long, e.g. "Xiaomi Redmi Router AX6000 (OpenWrt U-Boot layout)").
            # The full name lives in Runtime Info instead.
            _device_model_inline=""
            # Public IP: only show it when it is a real IPv4 that differs from WAN.
            # Skip placeholders like "Unavailable" / "N/A" / "Checking..." so the
            # WAN line never ends in an ugly " · Unavailable" when the router is
            # behind double-NAT or direct egress is blocked.
            _pub_ip_inline=""
            if _validate_ip "$pub_ip_display" && [ "$pub_ip_display" != "$wan_ip" ]; then
                _pub_ip_html=$(html_escape "$pub_ip_display")
                _pub_ip_inline=" — EXT <code>${_pub_ip_html}</code>"
            fi
            _sb_ram_inline=""
            [ "$sb_ram" != "0" ] && _sb_ram_inline=" | <code>${sb_ram} MB</code>"
            _tier2_inline=""
            [ -n "$_h_tier2" ] && _tier2_inline=" · Backup: ${_tg_backup_line}"
            [ "$yacd_en" = "1" ] && _yacd_icon="$E_ON" || _yacd_icon="$E_OFF"

            text=$(printf '%s' "${_sev_title}
<i>${_sev_note}</i>
<code>────────────────────</code>
${E_RTR} <b>${_hostname_html}</b> | ${uptime_sys}${_device_model_inline}
${E_PENGUIN} ${_os_ver_html}
${E_GLOB} WAN: <code>${wan_ip}</code>${_pub_ip_inline}
${E_HOME} LAN: <code>${lan_ip}</code>
${extra_ifs}${E_CPU} <code>${loadavg}</code> | ${E_RAM} <code>${mem_free} MB</code> RAM free
<code>────────────────────</code>
${E_DOG} ${PODKOP_DISPLAY_NAME} <code>${p_ver_short:-?}</code> ${_pk_icon}${_update_avail}
   autostart: ${_as_icon}
${E_BOX} Sing-box <code>${sb_ver_short}</code> ${_sb_icon}${_sb_ram_inline}
${E_GLOB} <code>${active_proxy_display}</code>${_mode_suffix}
<code>────────────────────</code>
${E_ENVELOPE} Telegram: ${_tg_line}
${E_NET} Direct: ${_tg_direct_line}${_tier2_inline}
<code>────────────────────</code>
${E_SHLD} Bot: ${_route_icon} ${_route_name_html} <code>${tg_lat}</code>
${E_NET} DNS: <code>${_strategy_html}</code> — YACD: ${_yacd_icon}
<code>────────────────────</code>
<i>bot v${BOT_VERSION}</i>")
            kb='{"inline_keyboard":['
            kb="${kb}[{\"text\":\"🧭 Runtime Info\",\"callback_data\":\"cmd_runtime\"}],"
            if [ "$podkop_running" = "1" ]; then
                kb="${kb}[{\"text\":\"♻️ Reload Podkop\",\"callback_data\":\"ask_reload_podkop\"}],"
            else
                kb="${kb}[{\"text\":\"${E_ON} Start Podkop\",\"callback_data\":\"cmd_start\"}],"
            fi
            kb="${kb}[{\"text\":\"🔃 Refresh\",\"callback_data\":\"cmd_status\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]"
            kb="${kb}]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;
        "cmd_runtime")
            local conn_data curr_conn total_dl total_ul dl_fmt ul_fmt text kb
            local proxies selector active_proxy active_proxy_display p_delay_raw p_delay p_type active_leaf
            local sb_uptime_str sb_pid_rt
            sb_pid_rt=$(pidof sing-box 2>/dev/null)
            if [ -n "$sb_pid_rt" ]; then
                local _now _lrr _diff _sb_start _tps _boot
                _now=$(date +%s)
                _lrr=0
                [ -f "$RELOAD_TS_FILE" ] && _lrr=$(cat "$RELOAD_TS_FILE" 2>/dev/null || echo 0)
                if [ "$_lrr" -eq 0 ]; then
                    _sb_start=$(awk '{print $22}' /proc/"$sb_pid_rt"/stat 2>/dev/null || echo 0)
                    _tps=$(getconf CLK_TCK 2>/dev/null || echo 100)
                    _boot=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)
                    _lrr=$((_now - _boot + _sb_start / _tps))
                fi
                _diff=$((_now - _lrr))
                if   [ "$_diff" -lt 60 ];   then sb_uptime_str="${_diff}s"
                elif [ "$_diff" -lt 3600 ]; then sb_uptime_str="$((  _diff/60))m"
                else sb_uptime_str="$((_diff/3600))h $((_diff%3600/60))m"; fi
            else
                sb_uptime_str="stopped"
            fi

            conn_data=$(clash_request "/connections")
            curr_conn=$(printf '%s' "$conn_data" | jq -r '.connections | length // 0' 2>/dev/null)
            total_dl=$(printf '%s' "$conn_data" | jq -r '.downloadTotal // 0' 2>/dev/null)
            total_ul=$(printf '%s' "$conn_data" | jq -r '.uploadTotal // 0' 2>/dev/null)
            case "$curr_conn" in ''|*[!0-9]*) curr_conn=0 ;; esac
            case "$total_dl" in ''|*[!0-9]*) total_dl=0 ;; esac
            case "$total_ul" in ''|*[!0-9]*) total_ul=0 ;; esac
            dl_fmt=$(awk "BEGIN{m=$total_dl/1000000;if(m>=1000)printf \"%.2f GB\",m/1000;else printf \"%.2f MB\",m}")
            ul_fmt=$(awk "BEGIN{m=$total_ul/1000000;if(m>=1000)printf \"%.2f GB\",m/1000;else printf \"%.2f MB\",m}")

            proxies=$(clash_request "/proxies")
            selector=$(get_selector_tag "$proxies")
            active_proxy=$(get_active_proxy_name "$proxies")
            active_proxy_display=$(html_escape "$(get_active_proxy_display "$proxies")")

            # Resolve leaf to get accurate type and delay (follows Selector/URLTest chains)
            active_leaf=$(_resolve_leaf "$active_proxy" "$proxies")
            [ -z "$active_leaf" ] && active_leaf="$active_proxy"

            # Try delay: by proxy name, then leaf, then selector tag (url mode: tag is main-out)
            p_delay_raw=$(echo "$proxies" | jq -r --arg n "$active_proxy" '.proxies[$n].history[-1].delay // 0' 2>/dev/null)
            [ -z "$p_delay_raw" ] || [ "$p_delay_raw" = "0" ] && \
                p_delay_raw=$(echo "$proxies" | jq -r --arg n "$active_leaf" '.proxies[$n].history[-1].delay // 0' 2>/dev/null)
            [ -z "$p_delay_raw" ] || [ "$p_delay_raw" = "0" ] && \
                p_delay_raw=$(echo "$proxies" | jq -r --arg n "$selector" '.proxies[$n].history[-1].delay // 0' 2>/dev/null)
            [ -z "$p_delay_raw" ] || [ "$p_delay_raw" = "0" ] && p_delay="N/A" || p_delay="${p_delay_raw}ms"
            p_type=$(echo "$proxies" | jq -r --arg n "$active_leaf" \
                '.proxies[$n].type // .proxies[$n].adapterType // empty' 2>/dev/null)
            # In url mode leaf name != Clash tag — try selector tag for type too
            [ -z "$p_type" ] || [ "$p_type" = "null" ] && \
                p_type=$(echo "$proxies" | jq -r --arg n "$selector" \
                    '.proxies[$n].type // .proxies[$n].adapterType // "Unknown"' 2>/dev/null)

            # Bot transport summary line for Runtime Info
            local rt_socks_state rt_transport_summary
            rt_socks_state=$(grep "^socks=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)

            local selector_e p_type_e route_name_e rt_transport_summary_e
            selector_e=$(html_escape "$selector")
            p_type_e=$(html_escape "$p_type")
            route_name_e=$(html_escape "${LAST_ROUTE_NAME:-unknown}")
            if [ "$rt_socks_state" = "up" ]; then
                rt_transport_summary_e="${E_ON} ${route_name_e}"
            else
                rt_transport_summary_e="${E_YLW} ${route_name_e} (SOCKS down)"
            fi
            text=$(cat <<EOF
${E_SCAN} <b>Runtime Info</b>
<code>────────────────────</code>
${E_PRX} <b>Connections:</b> ${curr_conn}
${E_DWN} <b>Downloaded:</b> ${dl_fmt}
${E_UP} <b>Uploaded:</b> ${ul_fmt}
⏱ <b>Session:</b> ${sb_uptime_str}
<code>────────────────────</code>
${E_GLOB} <b>Active proxy:</b> <code>${active_proxy_display}</code>
${E_SET} <b>Type:</b> ${p_type_e} | <b>Delay:</b> ${p_delay}
<b>Selector:</b> <code>${selector_e}</code>
<code>────────────────────</code>
${E_SHLD} <b>Bot route:</b> ${rt_transport_summary_e}
EOF
)
            local _close_conn_btn=""
            if [ "$PODKOP_VARIANT" = "plus" ] && _plus_has_cmd "clash_api"; then
                _close_conn_btn=",{\"text\":\"🔌 Close Connections\",\"callback_data\":\"do_close_connections\"}"
            fi
            kb="{\"inline_keyboard\":[
                [{\"text\":\"${E_TEST} Diagnostics\",\"callback_data\":\"cmd_diagnostics\"}],
                [{\"text\":\"${E_FILE} Configs & Logs\",\"callback_data\":\"cmd_files\"}${_close_conn_btn}],
                [{\"text\":\"${E_RST} Refresh\",\"callback_data\":\"cmd_runtime\"},{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_status\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]
            ]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "do_close_connections")
            if [ "$PODKOP_VARIANT" = "plus" ]; then
                local _res; _res=$(_plus_json clash_api close_all_connections)
                local _ok; _ok=$(printf '%s' "$_res" | jq -r '.success // false' 2>/dev/null)
                if [ "$_ok" = "true" ]; then
                    send_or_edit "$mid" "$(printf '%s All connections closed. Active traffic will reconnect.' "$E_OK")"                         "{\"inline_keyboard\":[[{\"text\":\"${E_RST} Refresh\",\"callback_data\":\"cmd_runtime\"}],[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_runtime\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
                else
                    send_or_edit "$mid" "$(printf '%s Failed to close connections.' "$E_ERR")"                         "{\"inline_keyboard\":[[{\"text\":\"${E_RST} Retry\",\"callback_data\":\"do_close_connections\"},{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_runtime\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
                fi
            fi
            ;;

        "cmd_server_instances")
            # Server Instances — Plus only. Read-only view from UCI (type=server sections).
            # Source: uci show podkop-plus — no runtime dependency on sing-box/Clash API.
            # Clash /connections used optionally for per-server traffic stats.
            [ "$PODKOP_VARIANT" = "plus" ] || {
                send_or_edit "$mid" \
                    "$(printf '%s Server Instances are only available on Podkop Plus.' "$E_WARN")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"/menu\"}]]}"
                return
            }
            rm -f "$STATE_FILE"

            # Collect all UCI server sections
            local _si_raw _si_sections
            _si_raw=$(uci -q show ${PODKOP_UCI} 2>/dev/null | grep "^${PODKOP_UCI}\.[^.=]*=server$")
            _si_sections=$(printf '%s\n' "$_si_raw" | sed "s/^${PODKOP_UCI}\.//;s/=server$//" | grep -v '^$')

            local _si_count=0
            local _s
            for _s in $_si_sections; do _si_count=$((_si_count+1)); done

            if [ "$_si_count" -eq 0 ]; then
                send_or_edit "$mid" \
                    "$(printf '%s <b>Server Instances</b>\n\n<i>No server mode instances configured.</i>\n<i>Supported: VLESS, VMess, Trojan, Shadowsocks, SOCKS, Hysteria2, MTProto (extended), Tailscale</i>\n\n<i>Configure in LuCI → Podkop Plus → Server</i>' "$E_SRV")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_RST} Refresh\",\"callback_data\":\"cmd_server_instances\"},{\"text\":\"${E_BACK} Back\",\"callback_data\":\"/menu\"}]]}"
                return
            fi

            # Optional: aggregate connections by inbound tag from Clash API
            local _conns_raw _conn_map_file
            _conn_map_file="${BOT_DIR}/si_conn_map_$$"
            _conns_raw=$(clash_request "/connections" 2>/dev/null)
            if [ -n "$_conns_raw" ]; then
                printf '%s' "$_conns_raw" | jq -r '
                    .connections[]? |
                    "\(.metadata.inboundTag // .metadata.inbound // .inboundTag // "")|\(.download // 0)|\(.upload // 0)"
                ' 2>/dev/null | grep -v '^|' | awk -F'|' '
                    { tag=$1; dl=$2; ul=$3
                      cnt[tag]++; sdl[tag]+=dl; sul[tag]+=ul }
                    END { for (t in cnt) printf "%s %d %d %d\n", t, cnt[t], sdl[t], sul[t] }
                ' > "$_conn_map_file" 2>/dev/null
            fi

            _si_conn_stats() {
                awk -v t="$1" '$1==t{print;found=1;exit} END{if(!found)print t,0,0,0}' \
                    "$_conn_map_file" 2>/dev/null
            }
            _si_fmt_bytes() {
                awk "BEGIN{b=$1;if(b>=1073741824)printf \"%.1fGB\",b/1073741824;
                    else if(b>=1048576)printf \"%.1fMB\",b/1048576;
                    else if(b>=1024)printf \"%.0fKB\",b/1024;
                    else printf \"%dB\",b}"
            }
            _si_is_listening() {
                local _p="$1" _hx
                case "$_p" in ''|*[!0-9]*) return 1;; esac
                netstat -ln 2>/dev/null | grep -Eq "[:.]${_p}[[:space:]]" && return 0
                ss -H -lntu 2>/dev/null | grep -Eq "[:.]${_p}[[:space:]]" && return 0
                _hx=$(printf '%04X' "$_p")
                grep -qsi ":${_hx} " /proc/net/tcp /proc/net/tcp6 \
                                      /proc/net/udp /proc/net/udp6 2>/dev/null
            }
            # _si_safe_name: replicate Plus' server_safe_filename — any char outside
            # [A-Za-z0-9_.-] becomes '_'. Used to locate the per-section TS state dir.
            _si_safe_name() {
                printf '%s' "$1" | sed 's/[^A-Za-z0-9_.-]/_/g'
            }
            # _si_ts_state_dir: per-section Tailscale state directory (Plus convention).
            _si_ts_state_dir() {
                printf '/etc/podkop-plus/tailscale/%s' "$(_si_safe_name "$1")"
            }
            # _si_ts_registered: node has provisioned state (tailscaled.state exists, non-empty).
            # sing-box stores tsnet state in <state_dir>/tailscaled.state once the node logs in.
            _si_ts_registered() {
                local _d; _d=$(_si_ts_state_dir "$1")
                [ -s "${_d}/tailscaled.state" ]
            }

            local _text
            _text="${E_SRV} <b>Server Instances</b> (${_si_count})\n"
            _text="${_text}<code>────────────────────</code>"

            # Compute sing-box liveness once (used by tailscale status); avoids one
            # pgrep per server inside the loop.
            local _sb_alive=0
            pgrep -f sing-box >/dev/null 2>&1 && _sb_alive=1

            for _s in $_si_sections; do
                local _proto _enabled _listen _port _pubhost _security _sni _routing_mode _routing_sec
                _proto=$(uci -q get ${PODKOP_UCI}.${_s}.protocol 2>/dev/null || echo "vless")
                _enabled=$(uci -q get ${PODKOP_UCI}.${_s}.enabled 2>/dev/null || echo "1")
                _listen=$(uci -q get ${PODKOP_UCI}.${_s}.listen 2>/dev/null || echo "0.0.0.0")
                _port=$(uci -q get ${PODKOP_UCI}.${_s}.listen_port 2>/dev/null || echo "")
                _pubhost=$(uci -q get ${PODKOP_UCI}.${_s}.public_host 2>/dev/null || echo "")
                _security=$(uci -q get ${PODKOP_UCI}.${_s}.security 2>/dev/null || echo "")
                _sni=$(uci -q get ${PODKOP_UCI}.${_s}.tls_server_name 2>/dev/null || echo "")
                _routing_mode=$(uci -q get ${PODKOP_UCI}.${_s}.routing_mode 2>/dev/null || echo "rules")
                _routing_sec=$(uci -q get ${PODKOP_UCI}.${_s}.routing_section 2>/dev/null || echo "")

                # Status icon: enabled in UCI + port listening
                local _icon
                if [ "$_enabled" != "1" ] && [ "$_enabled" != "" ]; then
                    _icon="${E_OFF}"
                elif [ -n "$_port" ] && _si_is_listening "$_port"; then
                    _icon="${E_ON}"
                else
                    _icon="${E_YLW}"  # enabled in UCI but port not detected (may be starting)
                fi

                # Tailscale via sing-box extended = userspace node (no tailscale0 iface,
                # no tailscaled process). Status = sing-box running + node registered
                # (per-section tailscaled.state exists). Yellow = configured but not yet
                # logged in (empty state / sing-box not up).
                [ "$_proto" = "tailscale" ] && {
                    if [ "$_sb_alive" = "1" ] && _si_ts_registered "$_s"; then
                        _icon="${E_ON}"
                    else
                        _icon="${E_YLW}"
                    fi
                }

                local _s_esc _proto_esc _pubhost_esc _sni_esc _routing_sec_esc
                _s_esc=$(html_escape "$_s")
                _proto_esc=$(html_escape "$_proto")
                _pubhost_esc=$(html_escape "$_pubhost")
                _sni_esc=$(html_escape "$_sni")
                _routing_sec_esc=$(html_escape "$_routing_sec")

                local _listen_disp
                [ "$_listen" = "0.0.0.0" ] || [ "$_listen" = "::" ] \
                    && _listen_disp="*" || _listen_disp=$(html_escape "$_listen")

                _text="${_text}\n\n${_icon} <b>${_proto_esc}</b>"
                [ "$_enabled" != "1" ] && [ "$_enabled" != "" ] && \
                    _text="${_text} <i>(disabled)</i>"
                _text="${_text} · <code>${_s_esc}</code>"

                # Port / address
                if [ "$_proto" = "tailscale" ]; then
                    # sing-box extended runs Tailscale in userspace (tsnet) — no tailscale0
                    # interface or tailscaled. The 100.64/10 IP is assigned at runtime and
                    # only knowable from debug logs or the admin panel.
                    local _ts_hostname _ts_ctrl _ts_exit _ts_accept _ts_ip _ts_safe _ts_state
                    _ts_safe=$(_si_safe_name "$_s")
                    _ts_hostname=$(uci -q get ${PODKOP_UCI}.${_s}.tailscale_hostname 2>/dev/null || echo "")
                    [ -z "$_ts_hostname" ] && _ts_hostname="podkop-${_ts_safe}"
                    _ts_ctrl=$(uci -q get ${PODKOP_UCI}.${_s}.tailscale_control_url 2>/dev/null || echo "")
                    _ts_exit=$(uci -q get ${PODKOP_UCI}.${_s}.tailscale_advertise_exit_node 2>/dev/null || echo "0")
                    _ts_accept=$(uci -q get ${PODKOP_UCI}.${_s}.tailscale_accept_routes 2>/dev/null || echo "0")

                    # Connectivity status line
                    if _si_ts_registered "$_s"; then
                        _text="${_text}\n    🔗 <b>connected</b> · userspace (tsnet)"
                    else
                        _text="${_text}\n    🔌 <i>not registered yet</i> · userspace (tsnet)"
                    fi

                    # Tailscale IP: only cheaply knowable if sing-box runs in
                    # system_interface mode (real tailscale0 iface). Userspace tsnet
                    # has no iface and no stable file — don't scan logs on every render.
                    _ts_ip=$(ip -4 -o addr show tailscale0 2>/dev/null \
                        | grep -oE '100\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
                    if [ -n "$_ts_ip" ]; then
                        _text="${_text}\n    📍 <code>$(html_escape "$_ts_ip")</code>"
                    else
                        _text="${_text}\n    📍 <i>IP: see Tailscale admin panel</i>"
                    fi

                    _text="${_text}\n    🏷 Node: <code>$(html_escape "$_ts_hostname")</code>"

                    # Custom control URL = self-hosted Headscale (only show if non-default)
                    case "$_ts_ctrl" in
                        ""|"https://controlplane.tailscale.com") : ;;
                        *) _text="${_text}\n    🛰 Control: <code>$(html_escape "$_ts_ctrl")</code>" ;;
                    esac

                    # Routing role flags
                    [ "$_ts_exit" = "1" ]   && _text="${_text}\n    🚪 advertises exit node"
                    [ "$_ts_accept" = "1" ] && _text="${_text}\n    📥 accepts routes"

                    _ts_state=$(_si_ts_state_dir "$_s")
                    _text="${_text}\n    💾 State: <code>$(html_escape "$_ts_state")</code>"
                else
                    _text="${_text}\n    🔌 ${_listen_disp}:<b>${_port:-?}</b>"
                fi

                # Public host — skip for tailscale (public_host is router WAN/LAN, not TS IP)
                [ -n "$_pubhost_esc" ] && [ "$_proto" != "tailscale" ] && \
                    _text="${_text}\n    🌐 <code>${_pubhost_esc}</code>"

                # Security (TLS/Reality/none) — only for relevant protocols
                case "$_proto" in vless|vmess|trojan)
                    local _sec_disp="${_security:-tls}"
                    case "$_sec_disp" in
                        reality) _text="${_text}\n    🔐 Reality" ;;
                        tls)     _text="${_text}\n    🔒 TLS${_sni_esc:+ · SNI: <code>${_sni_esc}</code>}" ;;
                        none)    _text="${_text}\n    🔓 No TLS" ;;
                    esac
                ;; esac

                # MTProto specifics
                [ "$_proto" = "mtproto" ] && {
                    local _faketls
                    _faketls=$(uci -q get ${PODKOP_UCI}.${_s}.mtproto_faketls 2>/dev/null || echo "google.com")
                    _text="${_text}\n    🎭 FakeTLS: <code>$(html_escape "$_faketls")</code>"
                }

                # Routing mode
                case "$_routing_mode" in
                    rules)   _text="${_text}\n    📋 Routing: rules" ;;
                    direct)  _text="${_text}\n    ➡️ Routing: direct" ;;
                    section) _text="${_text}\n    🔀 Routing: → <code>${_routing_sec_esc}</code>" ;;
                esac

                # Connections from Clash API (optional)
                if [ -f "$_conn_map_file" ]; then
                    local _inbound_tag="${_s}-server-in"
                    local _cs _cc _cdl _cul
                    _cs=$(_si_conn_stats "$_inbound_tag")
                    _cc=$(printf '%s' "$_cs" | awk '{print $2}')
                    _cdl=$(printf '%s' "$_cs" | awk '{print $3}')
                    _cul=$(printf '%s' "$_cs" | awk '{print $4}')
                    [ "${_cc:-0}" -gt 0 ] && \
                        _text="${_text}\n    📊 ${_cc} conn · ↓$(_si_fmt_bytes "$_cdl") ↑$(_si_fmt_bytes "$_cul")"
                fi
            done

            rm -f "$_conn_map_file"
            _text="${_text}\n\n<i>Status: 🟢 listening · 🟡 enabled, port not detected · ⚫ disabled</i>"

            # Render: convert our literal "\n" markers to real newlines WITHOUT the
            # fragile `printf '%b'` (which also interprets \t \xNN \c etc. that may appear
            # inside UCI-sourced values like hostnames/paths, dropping or truncating text —
            # the cause of the garbled card in v0.15.5). awk gsub touches only the exact
            # two-byte sequence backslash-n; every other byte (UTF-8 emoji, stray '\') passes through.
            local _text_nl
            _text_nl=$(printf '%s' "$_text" | awk '{gsub(/\\n/,"\n")}1')
            send_or_edit "$mid" "$_text_nl" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_RST} Refresh\",\"callback_data\":\"cmd_server_instances\"},{\"text\":\"${E_BACK} Back\",\"callback_data\":\"/menu\"}]]}"
            ;;
        "cmd_tunnel_health")
            # Dedicated Tunnel Health screen: system-level tunnel state
            local sec nft_count sb_pid sb_ram sb_state wan_iface proxy_mode
            local last_reload_ts last_reload_str active_cl nft_raw text kb

            # Load transport context so _t_ip/_t_port are set for GitHub SOCKS probes
            _load_transport_ctx
            sec=$(get_active_section)
            proxy_mode=$(get_section_type "$sec")
            proxy_mode_disp="${proxy_mode#proxy:}"
            wan_iface=$(uci -q get ${PODKOP_UCI}.settings.output_network_interface 2>/dev/null || echo "auto")

            # nftables podkop rules count
            nft_raw=$(nft list ruleset 2>/dev/null | grep -i "${PODKOP_PKG}" | wc -l)
            nft_count="${nft_raw:-0}"

            # sing-box process
            if pidof sing-box >/dev/null 2>&1; then sb_state="${E_OK} RUNNING"
            else sb_state="${E_ERR} STOPPED"; fi
            sb_pid=$(pidof sing-box 2>/dev/null || echo "n/a")
            sb_ram="0"
            [ "$sb_pid" != "n/a" ] && \
                sb_ram=$(awk '/VmRSS/{print int($2/1024)}' /proc/"$sb_pid"/status 2>/dev/null || echo "0")

            # Last reload: prefer bot's own RELOAD_TS_FILE.
            local now last_reload_raw diff_s
            now=$(date +%s)
            last_reload_raw=0
            if [ -f "$RELOAD_TS_FILE" ]; then
                last_reload_raw=$(cat "$RELOAD_TS_FILE" 2>/dev/null || echo "0")
            fi
            if [ "$last_reload_raw" -eq 0 ] && [ "$sb_pid" != "n/a" ]; then
                local sb_start_ticks ticks_per_sec boot_ts
                sb_start_ticks=$(awk '{print $22}' /proc/"$sb_pid"/stat 2>/dev/null || echo "0")
                ticks_per_sec=$(getconf CLK_TCK 2>/dev/null || echo "100")
                boot_ts=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo "0")
                last_reload_raw=$((now - boot_ts + sb_start_ticks / ticks_per_sec))
            fi
            if [ "$last_reload_raw" -gt 0 ]; then
                diff_s=$((now - last_reload_raw))
                if   [ "$diff_s" -lt 60 ];   then last_reload_str="${diff_s}s ago"
                elif [ "$diff_s" -lt 3600 ]; then last_reload_str="$((diff_s/60))m ago"
                else                              last_reload_str="$((diff_s/3600))h $((diff_s%3600/60))m ago"; fi
            else
                last_reload_str="Unknown"
            fi

            # Active community lists
            active_cl=$(uci -q show ${PODKOP_UCI}.${sec} 2>/dev/null \
                | grep "^${PODKOP_UCI}\.${sec}\.community_lists=" \
                | sed "s/^[^']*'//g; s/'$//g; s/' '/, /g" || echo "None")
            [ -z "$active_cl" ] && active_cl="None"

            # Active proxy name from Clash API
            local th_proxies th_active_proxy th_active_display
            th_proxies=$(clash_request "/proxies" 2>/dev/null)
            th_active_proxy=$(get_active_proxy_name "$th_proxies")
            th_active_display=$(html_escape "$(get_active_proxy_display "$th_proxies")")
            [ -z "$th_active_display" ] && th_active_display="N/A (Clash down)"

            # Read structured watchdog state: two TG keys + socks
            local wd_tg_direct="?" wd_tg_transport="?" wd_socks="?"
            if [ -f "$SOCKS_STATE_FILE" ]; then
                wd_tg_direct=$(grep "^tg_direct=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)
                wd_tg_transport=$(grep "^tg_transport=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)
                wd_socks=$(grep "^socks=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)
            fi
            # tunnel icon: ok only if both transport ok AND socks up
            local tunnel_icon tgd_icon tier2_icon tier2_line
            [ "$wd_tg_direct" = "ok" ] && tgd_icon="$E_OK" || tgd_icon="$E_ERR"
            [ "$wd_tg_transport" = "ok" ] && [ "$wd_socks" = "up" ] && tunnel_icon="$E_OK" || {
                [ "$wd_tg_transport" = "ok" ] && tunnel_icon="$E_YLW" || tunnel_icon="$E_ERR"
            }
            local wd_tier2; wd_tier2=$(grep "^tg_tier2=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)
            case "$wd_tier2" in
                ok)   tier2_icon="$E_OK";  tier2_line="${tier2_icon} <b>TG tier2 SOCKS:</b> <code>ok</code>" ;;
                fail) tier2_icon="$E_ERR"; tier2_line="${tier2_icon} <b>TG tier2 SOCKS:</b> <code>fail</code>" ;;
                *)    tier2_line="" ;;
            esac

            # Consolidated per-section block: outbound delay + TG reachability in one line
            # Format: 🟢 [main] LV-hysteria2 217ms | TG: ✅
            local _sec_ob_lines=""
            if [ -n "$th_proxies" ]; then
                local _all_secs_th
                _all_secs_th=$(uci -q show ${PODKOP_UCI} 2>/dev/null \
                    | grep -E "^${PODKOP_UCI}\.[^.=]+=section$" \
                    | sed 's/^[^.]*\.\([^=]*\)=section$/\1/')
                for _s in $_all_secs_th; do
                    local _s_sel _s_now _s_leaf _s_delay _s_icon _s_name _s_tg _s_tg_icon
                    # Get selector tag for this section
                    _s_sel=$(printf '%s' "$th_proxies" | jq -r \
                        --arg s "$_s" \
                        '[ .proxies | to_entries[] |
                           select(.key == ($s + "-out") or (.key | startswith($s + "-"))) |
                           select(.value.type == "Selector" or .value.type == "URLTest") ]
                         | sort_by((.value.all // []) | length) | last | .key // empty' 2>/dev/null)
                    # Get delay — from selector or direct outbound
                    if [ -n "$_s_sel" ]; then
                        _s_now=$(printf '%s' "$th_proxies" | jq -r \
                            --arg sel "$_s_sel" '.proxies[$sel].now // empty' 2>/dev/null)
                        [ -n "$_s_now" ] && _s_leaf=$(_resolve_leaf "$_s_now" "$th_proxies") \
                                         || _s_leaf="$_s_sel"
                    else
                        # VPN/url mode — direct outbound tag
                        _s_leaf="${_s}-out"
                    fi
                    _s_delay=$(printf '%s' "$th_proxies" | jq -r \
                        --arg n "$_s_leaf" '.proxies[$n].history[-1].delay // 0' 2>/dev/null)
                    # Fallback: if leaf has no delay history, try the selector/urltest group node
                    if [ -z "$_s_delay" ] || [ "$_s_delay" = "0" ]; then
                        _s_delay=$(printf '%s' "$th_proxies" | jq -r \
                            --arg n "$_s_sel" '.proxies[$n].history[-1].delay // 0' 2>/dev/null)
                    fi
                    _s_name=$(html_escape "$(display_proxy_name "$_s_leaf")")
                    [ -z "$_s_name" ] && _s_name="$_s_leaf"
                    if [ -z "$_s_delay" ] || [ "$_s_delay" = "0" ]; then
                        _s_icon="$E_YLW"; _s_delay="N/A"
                    elif [ "$_s_delay" -lt 200 ]; then _s_icon="$E_ON"
                    elif [ "$_s_delay" -lt 500 ]; then _s_icon="$E_YLW"
                    elif [ "$_s_delay" -lt 900 ]; then _s_icon="$E_ORNG"
                    else _s_icon="$E_RED"; fi
                    [ "$_s_delay" != "N/A" ] && _s_delay="${_s_delay}ms"
                    # TG reachability: primary section → use tg_transport (already checked by check_health A2)
                    # Non-primary sections → use tg_sec_<name> (per-section probe from A3)
                    if [ "$_s" = "$(_resolve_primary_section)" ]; then
                        _s_tg=$(grep "^tg_transport=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)
                    else
                        _s_tg=$(grep "^tg_sec_${_s}=" "$SOCKS_STATE_FILE" 2>/dev/null | cut -d= -f2)
                    fi
                    [ "$_s_tg" = "ok" ] && _s_tg_icon="$E_OK" || { [ -n "$_s_tg" ] && _s_tg_icon="$E_ERR" || _s_tg_icon="…"; }
                    _sec_ob_lines="${_sec_ob_lines}${_s_icon} [${_s}] <code>${_s_name}</code> ${_s_delay} | TG: ${_s_tg_icon}\n"
                done
            fi

            # Read SOCKS latency probe results
            local probe_ts="" probe_tier1="" probe_fb_text="" probe_age_str="" probe_t3_text=""
            if [ -f "$SOCKS_PROBE_FILE" ]; then
                probe_ts=$(grep "^ts=" "$SOCKS_PROBE_FILE" 2>/dev/null | cut -d= -f2)
                probe_tier1=$(grep "^tier1=" "$SOCKS_PROBE_FILE" 2>/dev/null | cut -d= -f2)
                # Build fallback_socks probe lines
                local _pn=1
                while true; do
                    local _pline
                    _pline=$(grep "^tier2_${_pn}=" "$SOCKS_PROBE_FILE" 2>/dev/null)
                    [ -z "$_pline" ] && break
                    local _plat _purl
                    _plat=$(echo "$_pline" | cut -d= -f2 | awk '{print $1}')
                    _purl=$(echo "$_pline" | grep -oE 'url=[^ ]+' | cut -d= -f2)
                    _purl="${_purl:-tier2_${_pn}}"
                    local _platicon
                    case "$_plat" in timeout|fail) _platicon="$E_ERR" ;; *) _platicon="$E_ON" ;; esac
                    probe_fb_text="${probe_fb_text}${_platicon} tier2_${_pn}: <code>${_plat}</code> <i>${_purl}</i>\n"
                    _pn=$((_pn + 1))
                done
                # tier3: custom_proxy
                local _t3line; _t3line=$(grep "^tier3=" "$SOCKS_PROBE_FILE" 2>/dev/null)
                if [ -n "$_t3line" ]; then
                    local _t3lat _t3url _t3icon
                    _t3lat=$(echo "$_t3line" | cut -d= -f2 | awk '{print $1}')
                    _t3url=$(echo "$_t3line" | grep -oE 'url=[^ ]+' | cut -d= -f2)
                    case "$_t3lat" in timeout|fail) _t3icon="$E_ERR" ;; *) _t3icon="$E_ON" ;; esac
                    probe_t3_text="${_t3icon} tier3 (custom): <code>${_t3lat}</code> <i>${_t3url}</i>\n"
                fi
                if [ -n "$probe_ts" ]; then
                    local probe_age=$(( $(date +%s) - probe_ts ))
                    if   [ "$probe_age" -lt 60 ];   then probe_age_str="${probe_age}s ago"
                    elif [ "$probe_age" -lt 3600 ];  then probe_age_str="$((probe_age/60))m ago"
                    else                                  probe_age_str="$((probe_age/3600))h ago"
                    fi
                fi
            fi
            local t1_icon
            case "${probe_tier1:-?}" in timeout|fail) t1_icon="$E_ERR" ;; "?") t1_icon="$E_YLW" ;; *) t1_icon="$E_ON" ;; esac

            local probe_section=""
            if [ -n "$probe_tier1" ]; then
                probe_section=$(printf '\n<code>────────────────────</code>\n%s <b>Transport Latency</b> <i>(probed %s)</i>\n%s tier1 (Podkop): <code>%s</code>\n%b%b' \
                    "$E_TIME" "${probe_age_str:-unknown}" "$t1_icon" "$probe_tier1" "$probe_fb_text" "$probe_t3_text")
            else
                probe_section=$(printf '\n<code>────────────────────</code>\n%s <b>Transport Latency:</b> <i>not yet probed</i>' "$E_TIME")
            fi

            text=$(cat <<EOF
${E_HEALTH} <b>Tunnel Health</b> [<code>${sec}</code>]
<code>────────────────────</code>
${E_PRX} <b>Sing-box:</b> ${sb_state}
${E_RAM} <b>PID:</b> <code>${sb_pid}</code> | <b>RAM:</b> ${sb_ram} MB
${E_SET} <b>Mode:</b> <code>${proxy_mode_disp}</code>
${E_NET} <b>WAN iface:</b> <code>${wan_iface}</code>
${E_GLOB} <b>Active proxy:</b> <code>${th_active_display}</code>
<code>────────────────────</code>
${tgd_icon} <b>TG direct:</b> <code>${wd_tg_direct:-?}</code>$([ "${wd_tg_direct}" = "fail" ] && [ "${wd_tg_transport:-?}" != "fail" ] && printf ' <i>(expected — ISP block, tunnel OK)</i>' || printf ' <i>(no proxy)</i>')
${tunnel_icon} <b>TG tunnel:</b> <code>${wd_tg_transport:-?}</code>$([ "${wd_socks}" != "up" ] && printf " <i>(SOCKS %s)</i>" "${wd_socks:-?}")
$([ -n "$tier2_line" ] && printf '%s' "$tier2_line")
${E_SHLD} <b>Bot transport:</b> <code>${LAST_ROUTE_NAME}</code>
${E_NET} <b>Poll route:</b> <code>${LAST_ROUTE_POLL}</code> | <b>Fast:</b> <code>${LAST_ROUTE_FAST}</code>${probe_section}
<code>────────────────────</code>
$([ -n "$_sec_ob_lines" ] && printf '📡 <b>Active outbounds by section:</b>\n%b<code>────────────────────</code>\n' "$_sec_ob_lines")
${E_FILE} <b>nftables rules (podkop):</b> ${nft_count}
${E_RST} <b>Last reload:</b> ${last_reload_str}
<code>────────────────────</code>
${E_ON} <b>Community Lists:</b>
<code>${active_cl}</code>
EOF
)
            # Append GitHub connectivity section (all variants, not Plus-only)
            local _ghc_section=""
            send_or_edit "$mid" "${text}
<code>────────────────────</code>
<i>Checking GitHub connectivity…</i>" ""
            run_github_health_check
            _ghc_section=$(printf '\n<code>────────────────────</code>\n%s <b>GitHub Connectivity</b>\napi.github.com:\n   direct: %s\n   SOCKS: %s\nraw.githubusercontent.com:\n   direct: %s\n   SOCKS: %s'                     "$E_GLOB"                     "$(_ghc_icon "$_ghc_api_direct")"                     "$(_ghc_icon "$_ghc_api_socks")"                     "$(_ghc_icon "$_ghc_raw_direct")"                     "$(_ghc_icon "$_ghc_raw_socks")")
            text="${text}${_ghc_section}"
            kb="{\"inline_keyboard\":[
                [{\"text\":\"${E_RST} Refresh\",\"callback_data\":\"cmd_tunnel_health\"},{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_diagnostics\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]
            ]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "bot_settings")
            rm -f "$STATE_FILE"
            local tr st al hi cp bi next_tr tr_disp next_hi text kb tg_lat sec m_port m_ip

            tr=$(uci -q get podkop_bot.settings.transport || echo "auto")
            st=$(uci -q get podkop_bot.settings.startup_notify || echo "1")
            al=$(uci -q get podkop_bot.settings.alert_notify || echo "1")
            hi=$(uci -q get podkop_bot.settings.health_interval || echo "60")
            cp=$(uci -q get podkop_bot.settings.custom_proxy || echo "Not set")
            bi=$(uci -q get podkop_bot.settings.bind_interface || echo "Not set")
            local dr dr_time dr_icon
            dr=$(uci -q get podkop_bot.settings.daily_report || echo "0")
            dr_time=$(uci -q get podkop_bot.settings.daily_report_time || echo "08:00")
            [ "$dr" = "1" ] && dr_icon="$E_ON" || dr_icon="$E_OFF"
            tg_lat=$(get_tg_latency)

            next_tr="socks"; tr_disp="Auto"
            [ "$tr" = "socks" ]  && { next_tr="direct"; tr_disp="Socks5"; }
            [ "$tr" = "direct" ] && { next_tr="auto";   tr_disp="Direct"; }

            # Cycle: 60 → 30 → 120 → 300 → 60
            # 30s shows a confirm warning (high CPU load on weak routers)
            next_hi="30"
            [ "$hi" = "30"  ] && next_hi="120"
            [ "$hi" = "120" ] && next_hi="300"
            [ "$hi" = "300" ] && next_hi="60"

            sec=$(get_active_section)
            m_port=$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_port || echo "2080")
            m_ip=$(get_proxy_ip)

            # Build fallback route chain with active tier highlighted in bold.
            # LAST_ROUTE_FAST holds the current tier key: tier1, tier2_N, tier3, tier4, tier5.
            local tr_chain="" _tier=1 _fb_raw _fb _tier_key _tier_line
            _active_tier="$LAST_ROUTE_FAST"

            _fmt_tier() {
                local _key="$1" _label="$2"
                if [ "$_key" = "$_active_tier" ]; then
                    printf '<b>%s. %s ◀ active</b>' "$_tier" "$_label"
                else
                    printf '%s. %s' "$_tier" "$_label"
                fi
            }

            if [ "$tr" != "direct" ]; then
                _mip_esc=$(html_escape "$m_ip")
                tr_chain=$(_fmt_tier "tier1" "SOCKS5 (${_mip_esc}:${m_port})")
                _tier=$((_tier + 1))
                _fb_raw=$(uci -q show podkop_bot.settings.fallback_socks 2>/dev/null | cut -d= -f2-)
                if [ -n "$_fb_raw" ]; then
                    { _ucl=$(uci_list_clean "$_fb_raw"); eval "set -- $_ucl"; }
                    local _fn=1
                    for _fb in "$@"; do
                        _fb_esc=$(html_escape "$_fb")
                        tr_chain="${tr_chain}
$(_fmt_tier "tier2_${_fn}" "Fallback SOCKS (${_fb_esc})")"
                        _tier=$((_tier + 1)); _fn=$((_fn + 1))
                    done
                fi
            fi
            if [ "$cp" != "Not set" ]; then
                _cp_esc=$(html_escape "$cp")
                tr_chain="${tr_chain}
$(_fmt_tier "tier3" "Custom (${_cp_esc})")"
                _tier=$((_tier + 1))
            fi
            if [ "$tr" != "socks" ]; then
                _bi_esc=""; [ "$bi" != "Not set" ] && _bi_esc=" via $(html_escape "$bi")"
                local d_if="$_bi_esc"
                tr_chain="${tr_chain}
$(_fmt_tier "tier4" "Direct${d_if}")"
                _tier=$((_tier + 1))
                tr_chain="${tr_chain}
$(_fmt_tier "tier5" "Emergency IPs")"
            fi
            [ -z "$tr_chain" ] && tr_chain="No valid transports!"

            local now uptime_s uptime_sys last_cmd_str unauth_str
            now=$(date +%s); uptime_s=$((now - BOT_START_TIME))
            uptime_sys=$(awk -v t="$uptime_s" 'BEGIN{d=int(t/86400);h=int((t%86400)/3600);m=int((t%3600)/60);printf "%dd %dh %dm",d,h,m}')

            last_cmd_str="None"
            if [ -f "$LAST_CMD_FILE" ]; then
                local lc_ts lc_usr lc_cmd lc_time
                lc_ts=$(cut -d'|' -f1 "$LAST_CMD_FILE"); lc_usr=$(cut -d'|' -f2 "$LAST_CMD_FILE")
                lc_cmd=$(cut -d'|' -f3- "$LAST_CMD_FILE")
                lc_time=$(awk -v t="$lc_ts" 'BEGIN{print strftime("%Y-%m-%d %H:%M:%S",t)}' 2>/dev/null || echo "$lc_ts")
                last_cmd_str=$(printf '@%s at %s\nCmd: <code>%s</code>' "$lc_usr" "$lc_time" "$lc_cmd")
            fi

            unauth_str="0 attempts"
            if [ -f "$UNAUTH_FILE" ]; then
                local ua_cnt ua_ts ua_usr ua_time
                ua_cnt=$(cut -d'|' -f1 "$UNAUTH_FILE"); ua_ts=$(cut -d'|' -f2 "$UNAUTH_FILE")
                ua_usr=$(cut -d'|' -f3 "$UNAUTH_FILE")
                ua_time=$(awk -v t="$ua_ts" 'BEGIN{print strftime("%Y-%m-%d %H:%M:%S",t)}' 2>/dev/null || echo "$ua_ts")
                unauth_str=$(printf '%s %s attempts\nLast: @%s at %s' "$E_RED" "$ua_cnt" "$ua_usr" "$ua_time")
            fi

            kb="{\"inline_keyboard\":["
            # Hints
            local tr_hint cp_hint=""
            if echo "$cp" | grep -q '^socks5://'; then
                cp_hint="${E_IDEA} <i>Tip: <code>${cp}</code> is a SOCKS proxy — consider moving it to Fallback SOCKS (tier2) for better failover ordering.</i>"
            fi
            case "$tr" in
                auto)   tr_hint="" ;; # chain shown below in Fallback Chain
                socks)  tr_hint="${E_WARN} <i>SOCKS only — bot goes offline if all SOCKS fail.</i>" ;;
                direct) tr_hint="${E_WARN} <i>Direct — skips all SOCKS. Use when tunnel is intentionally off.</i>" ;;
                *)      tr_hint="" ;;
            esac

            # Keyboard: 3 semantic groups
            local cp_btn bi_btn st_icon al_icon bc bc_icon ram_al ram_al_icon qh qh_icon qh_from qh_to
            local wr wr_icon wr_day wr_time
            wr=$(uci -q get podkop_bot.settings.weekly_report || echo "0")
            wr_day=$(uci -q get podkop_bot.settings.weekly_report_day || echo "7")
            wr_time=$(uci -q get podkop_bot.settings.weekly_report_time || echo "09:00")
            [ "$wr" = "1" ] && wr_icon="$E_ON" || wr_icon="$E_OFF"
            _wr_day_name=$(case "$wr_day" in 1)echo Mon;;2)echo Tue;;3)echo Wed;;4)echo Thu;;5)echo Fri;;6)echo Sat;;*)echo Sun;;esac)
            bc=$(uci -q get podkop_bot.settings.broadcast_alerts || echo "0")
            [ "$bc" = "1" ] && bc_icon="$E_ON" || bc_icon="$E_OFF"
            ram_al=$(uci -q get podkop_bot.settings.ram_alert || echo "1")
            [ "$ram_al" = "1" ] && ram_al_icon="$E_ON" || ram_al_icon="$E_OFF"
            qh=$(uci -q get podkop_bot.settings.quiet_hours_enabled || echo "0")
            qh_from=$(uci -q get podkop_bot.settings.quiet_hours_from || echo "23:00")
            qh_to=$(uci -q get podkop_bot.settings.quiet_hours_to || echo "07:00")
            [ "$qh" = "1" ] && qh_icon="$E_ON" || qh_icon="$E_OFF"
            [ "$cp" = "Not set" ]                 && cp_btn="{\"text\":\"${E_ADD} Custom Proxy\",\"callback_data\":\"cmd_custom_proxy\"}"                 || cp_btn="{\"text\":\"${E_DEL} Clear Custom Proxy\",\"callback_data\":\"cmd_clear_custom_proxy\"}"
            [ "$bi" = "Not set" ]                 && bi_btn="{\"text\":\"${E_ADD} Bind Iface\",\"callback_data\":\"cmd_bind_iface\"}"                 || bi_btn="{\"text\":\"${E_DEL} Unbind Iface\",\"callback_data\":\"cmd_clear_bind_iface\"}"
            [ "$st" = "1" ] && st_icon="$E_ON" || st_icon="$E_OFF"
            [ "$al" = "1" ] && al_icon="$E_ON" || al_icon="$E_OFF"

            kb="{\"inline_keyboard\":[
                [{\"text\":\"Transport: ${tr_disp}\",\"callback_data\":\"ask_set_tr_menu\"},{\"text\":\"Health: ${hi}s\",\"callback_data\":\"set_bot_hi_${next_hi}\"}],
                [{\"text\":\"${E_NET} Fallback SOCKS\",\"callback_data\":\"fallback_socks_menu\"},{\"text\":\"${E_TEST} Test Fallback\",\"callback_data\":\"cmd_test_fb_socks\"}],
                [${cp_btn},${bi_btn}],
                [{\"text\":\"${st_icon} Startup Notify\",\"callback_data\":\"toggle_bot_st\"},{\"text\":\"${al_icon} Alert Notify\",\"callback_data\":\"toggle_bot_al\"}],
                [{\"text\":\"${bc_icon} Broadcast Alerts\",\"callback_data\":\"toggle_broadcast_alerts\"},{\"text\":\"${ram_al_icon} RAM Alert\",\"callback_data\":\"toggle_ram_alert\"}],
                [{\"text\":\"${qh_icon} Quiet Hours: ${qh_from}–${qh_to}\",\"callback_data\":\"toggle_quiet_hours\"},{\"text\":\"⏰ Set Range\",\"callback_data\":\"cmd_set_quiet_hours\"}],
                [{\"text\":\"${dr_icon} Daily Report: ${dr_time}\",\"callback_data\":\"toggle_daily_report\"},{\"text\":\"⏰ Report time\",\"callback_data\":\"cmd_set_dr_time\"}],
                [{\"text\":\"${wr_icon} Weekly Report: ${_wr_day_name} ${wr_time}\",\"callback_data\":\"toggle_weekly_report\"},{\"text\":\"⏰ Set Schedule\",\"callback_data\":\"cmd_set_wr\"}],
                [{\"text\":\"👤 Admins\",\"callback_data\":\"admins_menu\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]
            ]}"

            text=$(cat <<EOF
${E_BOT} <b>Bot Control Plane</b>
<code>────────────────────</code>
${E_SHLD} <b>Transport Policy:</b> <code>${tr}</code>${tr_hint:+
${tr_hint}}
${E_SHLD} <b>Active Route:</b> <code>${LAST_ROUTE_NAME:-Initializing...}</code>
${E_TIME} <b>TG Latency:</b> ${tg_lat}
<code>────────────────────</code>
<b>Route Chain:</b>
${tr_chain}
<code>────────────────────</code>
<b>Overrides:</b>
<b>Custom Proxy:</b> <code>${cp}</code>${cp_hint:+
${cp_hint}}
<b>Bind Interface:</b> <code>${bi}</code>
<code>────────────────────</code>
<b>Bot Uptime:</b> ${uptime_sys}
<b>Started:</b> ${BOT_START_STR}
<code>────────────────────</code>
<b>Last Command:</b>
${last_cmd_str}

<b>Unauthorized Attempts:</b>
${unauth_str}
EOF
)
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "set_bot_tr_"*) uci set podkop_bot.settings.transport="${cmd#set_bot_tr_}"; uci_commit_safe podkop_bot; _handle_bot "bot_settings" "$mid" "" "" ;;

        "ask_set_tr_menu")
            local curr_tr; curr_tr=$(uci -q get podkop_bot.settings.transport || echo "auto")
            local tr_menu_txt; tr_menu_txt=$(printf '%s <b>Transport Policy</b>\n\nCurrent: <code>%s</code>\n\n<b>auto</b> - SOCKS5 first, then Fallback SOCKS, then Direct.\n<b>socks</b> - SOCKS only. Bot goes offline if all SOCKS fail.\n<b>direct</b> - Skip all SOCKS. Use only when tunnel is intentionally off.\n\n%s <b>Warning:</b> switching to a restrictive mode may break connectivity under active RKN blocks.' \
                "$E_SET" "$curr_tr" "$E_WARN")
            send_or_edit "$mid" "$tr_menu_txt" \
                "{\"inline_keyboard\":[[{\"text\":\"Auto\",\"callback_data\":\"ask_set_tr_auto\"},{\"text\":\"Socks only\",\"callback_data\":\"ask_set_tr_socks\"},{\"text\":\"Direct only\",\"callback_data\":\"ask_set_tr_direct\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"bot_settings\"}]]}"
            ;;

        "ask_set_tr_"*)
            local new_tr="${cmd#ask_set_tr_}"
            local curr_tr; curr_tr=$(uci -q get podkop_bot.settings.transport || echo "auto")
            [ "$new_tr" = "$curr_tr" ] && { _handle_bot "bot_settings" "$mid" "" ""; return; }
            local warn_txt
            case "$new_tr" in
                auto)   warn_txt=$(printf '%s Switch to <b>Auto</b> transport?\n\nBot will try: SOCKS5 -\x3e Fallback SOCKS -\x3e Direct -\x3e Emergency IPs.\nSafest mode — recommended.' "$E_OK") ;;
                socks)  warn_txt=$(printf '%s Switch to <b>Socks only</b>?\n\n<b>Bot goes offline if all SOCKS proxies fail.</b>\nUse only to guarantee no direct traffic.' "$E_WARN") ;;
                direct) warn_txt=$(printf '%s Switch to <b>Direct only</b>?\n\n<b>All SOCKS proxies will be bypassed.</b>\nBot connects to Telegram without a tunnel.\nSafe only when podkop is intentionally stopped.' "$E_WARN") ;;
                *)      _handle_bot "bot_settings" "$mid" "" ""; return ;;
            esac
            send_or_edit "$mid" "$warn_txt" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Confirm\",\"callback_data\":\"do_set_tr_${new_tr}\"},{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"bot_settings\"}]]}"
            ;;

        "do_set_tr_"*)
            uci set podkop_bot.settings.transport="${cmd#do_set_tr_}"
            uci_commit_safe podkop_bot
            _handle_bot "bot_settings" "$mid" "" ""
            ;;
        "set_bot_hi_30")
            # 30s interval warning - requires explicit confirmation
            local _hostname; _hostname=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo "Router")
            local _hi30_txt; _hi30_txt=$(printf '%s <b>Health Interval: 30 seconds</b>\n\n<b>Only for powerful routers</b> (Cortex-A53+, 256MB+ RAM).\n\nOn weak MIPS routers 2 curl probes every 30s may spike CPU.\n\nRouter: <code>%s</code>\n\nProceed?' "$E_WARN" "$_hostname")
            send_or_edit "$mid" "$_hi30_txt" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, set 30s\",\"callback_data\":\"do_set_hi_30\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"bot_settings\"}]]}"
            ;;
        "do_set_hi_30"|"set_bot_hi_"*)
            local _new_hi="${cmd#set_bot_hi_}"
            [ "$cmd" = "do_set_hi_30" ] && _new_hi="30"
            uci set podkop_bot.settings.health_interval="$_new_hi"
            uci_commit_safe podkop_bot
            _handle_bot "bot_settings" "$mid" "" "" ;;
        "toggle_bot_st") toggle_uci_bool "podkop_bot.settings" "startup_notify"; _handle_bot "bot_settings" "$mid" "" "" ;;
        "toggle_bot_al") toggle_uci_bool "podkop_bot.settings" "alert_notify";   _handle_bot "bot_settings" "$mid" "" "" ;;
        "toggle_broadcast_alerts") toggle_uci_bool "podkop_bot.settings" "broadcast_alerts"; _handle_bot "bot_settings" "$mid" "" "" ;;
        "toggle_ram_alert")        toggle_uci_bool "podkop_bot.settings" "ram_alert";        _handle_bot "bot_settings" "$mid" "" "" ;;
        "toggle_quiet_hours")      toggle_uci_bool "podkop_bot.settings" "quiet_hours_enabled"; _handle_bot "bot_settings" "$mid" "" "" ;;
        "cmd_set_quiet_hours")
            local _qh_from _qh_to
            _qh_from=$(uci -q get podkop_bot.settings.quiet_hours_from || echo "23:00")
            _qh_to=$(uci -q get podkop_bot.settings.quiet_hours_to || echo "07:00")
            echo "wait_quiet_hours" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Quiet Hours Range</b>\n\nCurrent: <code>%s</code> – <code>%s</code>\n\nSend range as <code>HH:MM-HH:MM</code>\n(e.g. <code>23:00-07:00</code> or <code>01:00-06:00</code>)\n\nOvernight ranges are supported.\n/cancel to abort.' \
                    "$E_TIME" "$_qh_from" "$_qh_to")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"bot_settings\"}]]}"
            ;;
        "toggle_daily_report") toggle_uci_bool "podkop_bot.settings" "daily_report"; _handle_bot "bot_settings" "$mid" "" "" ;;
        "toggle_weekly_report") toggle_uci_bool "podkop_bot.settings" "weekly_report"; _handle_bot "bot_settings" "$mid" "" "" ;;
        "cmd_set_wr")
            local _wr_day_cur _wr_time_cur
            _wr_day_cur=$(uci -q get podkop_bot.settings.weekly_report_day || echo "7")
            _wr_time_cur=$(uci -q get podkop_bot.settings.weekly_report_time || echo "09:00")
            echo "wait_wr_settings" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Weekly Report Schedule</b>\n\nCurrent: day <code>%s</code>, time <code>%s</code>\n\nSend as <code>D HH:MM</code> where D is day of week (1=Mon … 7=Sun)\nExample: <code>7 09:00</code> for Sunday 09:00\n\n/cancel to abort.' \
                    "$E_TIME" "$_wr_day_cur" "$_wr_time_cur")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"bot_settings\"}]]}"
            ;;
        "cmd_set_dr_time")
            local _cur_dr_time
            _cur_dr_time=$(uci -q get podkop_bot.settings.daily_report_time || echo "08:00")
            echo "wait_dr_time" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Daily Report Time</b>\n\nCurrent: <code>%s</code>\n\nSend time in <code>HH:MM</code> format (e.g. <code>07:00</code>) or /cancel.' \
                    "$E_TIME" "$_cur_dr_time")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"bot_settings\"}]]}"
            ;;

        "cmd_custom_proxy")
            echo "wait_custom_proxy" > "$STATE_FILE"
            send_or_edit "$mid" "$(printf '%s <b>Set Custom Proxy</b>\n\nUsed as <b>tier3</b> — fallback after Podkop SOCKS and fallback_socks list.\n\n<b>Supported formats:</b>\n<code>socks5://IP:PORT</code>\n<code>socks5h://IP:PORT</code> (remote DNS)\n<code>socks5h://hostname:PORT</code>\n<code>http://IP:PORT</code>\n<code>https://IP:PORT</code>\n<code>IP:PORT</code> (treated as HTTP)\n\n<i>socks5h is recommended — DNS resolves through the proxy.</i>' "$E_EDIT")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"bot_settings\"}]]}"
            ;;
        "cmd_clear_custom_proxy")
            uci delete podkop_bot.settings.custom_proxy 2>/dev/null; uci_commit_safe podkop_bot
            send_or_edit "$mid" "$(printf '%s Cleared.' "$E_OK")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"bot_settings\"}]]}"
            ;;
        "cmd_bind_iface")
            echo "wait_bind_iface" > "$STATE_FILE"
            send_or_edit "$mid" "$(printf '%s <b>Bind Interface</b>\n\nExample: <code>awg0</code>, <code>tailscale0</code>' "$E_EDIT")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"bot_settings\"}]]}"
            ;;
        "cmd_clear_bind_iface")
            uci delete podkop_bot.settings.bind_interface 2>/dev/null; uci_commit_safe podkop_bot
            send_or_edit "$mid" "$(printf '%s Cleared.' "$E_OK")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"bot_settings\"}]]}"
            ;;

        "cmd_diagnostics")
            local text kb
            text=$(printf '%s <b>Diagnostics</b>\n\nActive tests — may take 10–30 sec on slow routers.' "$E_TEST")
            kb="{\"inline_keyboard\":[
                [{\"text\":\"${E_HEALTH} Tunnel Health + GitHub\",\"callback_data\":\"cmd_tunnel_health\"}],
                [{\"text\":\"${E_MICRO} Probe Active Outbound\",\"callback_data\":\"ask_probe_outbound\"}],
                [{\"text\":\"${E_SCAN} Proxy Latency Test\",\"callback_data\":\"ask_upstream_health\"}],
                [{\"text\":\"${E_GLOB} Global Check\",\"callback_data\":\"ask_run_podkop_tests\"},{\"text\":\"${E_CPU} Internal Diag\",\"callback_data\":\"ask_run_internal_diag\"}],
                [{\"text\":\"${E_LOG} Support Bundle\",\"callback_data\":\"ask_support_bundle\"}],
                [{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_runtime\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]
            ]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "ask_upstream_health")
            local text kb
            text=$(printf '%s <b>Upstream Health</b>\n\nTests all outbound proxies via Clash API.\nSends results as a text file.\n\n<i>May take 10\xe2\x80\x9330 sec on slow routers.</i>' "$E_WARN")
            kb="{\"inline_keyboard\":[[{\"text\":\"${E_OK} Run\",\"callback_data\":\"cmd_upstream_health\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"cmd_diagnostics\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "ask_run_podkop_tests")
            local text kb
            text=$(printf '%s <b>Global Check</b>\n\nRuns <code>podkop global_check</code> \xe2\x80\x94 tests DNS, routing, connectivity.\nSends results as a text file.\n\n<i>May take 10\xe2\x80\x9330 sec.</i>' "$E_WARN")
            kb="{\"inline_keyboard\":[[{\"text\":\"${E_OK} Run\",\"callback_data\":\"cmd_run_podkop_tests\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"cmd_diagnostics\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "ask_run_internal_diag")
            local text kb
            text=$(printf '%s <b>Internal Diagnostics</b>\n\nGathers UCI config, routes, nft rules, syslog, bot state.\nSends results as a text file.\n\n<i>~5 sec, light CPU load.</i>' "$E_WARN")
            kb="{\"inline_keyboard\":[[{\"text\":\"${E_OK} Run\",\"callback_data\":\"cmd_run_internal_diag\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"cmd_diagnostics\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "ask_support_bundle")
            local text kb
            text=$(printf '%s <b>Support Bundle</b>\n\nCollects everything: versions, UCI config (token redacted), routes, nft, interfaces, bot transport state, last 80 syslog lines.\nSends as a single text file.\n\n<i>~5 sec. Share with maintainer when reporting bugs.</i>' "$E_WARN")
            kb="{\"inline_keyboard\":[[{\"text\":\"${E_OK} Collect & Send\",\"callback_data\":\"cmd_support_bundle\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"cmd_diagnostics\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "ask_probe_outbound"|"ask_probe_outbound_px_"*|"ask_probe_outbound_url")
            local sec proxy_mode active_px active_px_display text kb
            # Determine back target: px_view_N if came from proxy card, else diagnostics
            local _back_target="cmd_diagnostics"
            case "$cmd" in
                ask_probe_outbound_px_*)
                    local _px_idx="${cmd#ask_probe_outbound_px_}"
                    _back_target="px_view_${_px_idx}"
                    ;;
                ask_probe_outbound_url)
                    _back_target="url_links_menu"
                    ;;
            esac
            sec=$(get_active_section)
            proxy_mode=$(get_section_type "$sec")

            # Check mixed_proxy is enabled — probe uses it as SOCKS5 endpoint
            local _mixed_enabled
            _mixed_enabled=$(uci -q get ${PODKOP_UCI}.${sec}.mixed_proxy_enabled 2>/dev/null || echo "1")
            if [ "$_mixed_enabled" = "0" ]; then
                send_or_edit "$mid" "$(printf '%s <b>Probe unavailable</b>\n\n<code>mixed_proxy</code> is disabled for section <code>%s</code>.\n\nProbe routes traffic through mixed_proxy SOCKS5 — it cannot run without it.\n\n<i>Enable mixed_proxy in Podkop settings and reload to use Probe.</i>' \
                    "$E_WARN" "$sec")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"${_back_target}\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
                return
            fi
            local proxies; proxies=$(clash_request "/proxies")
            if [ -z "$proxies" ] || [ "$proxies" = "null" ]; then
                send_or_edit "$mid" "$(printf '%s <b>Probe unavailable</b>\n\nClash API is not responding.\n\n<i>Enable YACD in Podkop settings (Dashboard tab) and reload, then try again.</i>' \
                    "$E_WARN")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"${_back_target}\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
                return
            fi
            active_px=$(get_active_proxy_name "$proxies")
            active_px_display=$(html_escape "$(get_active_proxy_display "$proxies")")
            local mode_note=""
            [ "$proxy_mode" = "proxy:urltest" ] && mode_note=$(printf '\n<i>URLTest mode: testing current auto-selected proxy.</i>')
            text=$(printf '%s <b>Probe Active Outbound</b>\n\nTests the currently active proxy through <code>mixed_proxy</code>:\n\n• Exit IP, GeoIP, Cloudflare geo, Google hint\n• Service reachability (YouTube, Telegram API, ChatGPT, Gemini, Discord)\n• Throughput: 32 KB block check + 1 MB speed test\n\n<b>Active:</b> <code>%s</code>%s\n\n<i>Takes 20–40 sec. Traffic ~1.3 MB.</i>' \
                "$E_MICRO" "$active_px_display" "$mode_note")
            kb="{\"inline_keyboard\":[[{\"text\":\"${E_OK} Run\",\"callback_data\":\"cmd_probe_outbound_back_${_back_target}\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"${_back_target}\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "cmd_probe_outbound_back_"*)
            # Extract back target encoded in callback_data
            local _back="${cmd#cmd_probe_outbound_back_}"
            # Cooldown: not more than once per 2 minutes
            local _probe_ts_file="${BOT_DIR}/probe_ts"
            local _now; _now=$(date +%s)
            local _last; _last=$(cat "$_probe_ts_file" 2>/dev/null || echo 0)
            if [ $((_now - _last)) -lt 120 ]; then
                local _wait=$(( 120 - (_now - _last) ))
                send_or_edit "$mid" "$(printf '%s Cooldown active. Try again in %ds.' "$E_WARN" "$_wait")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"${_back}\"}]]}"
                return
            fi
            printf '%s' "$_now" > "$_probe_ts_file"

            send_or_edit "$mid" "$(printf '%s <b>Probing active outbound...</b>\n\nStep 1/4: Geo location...' "$E_MICRO")" ""

            # Collect context
            local sec proxy_mode proxies active_px active_px_display px_type
            sec=$(get_active_section)
            proxy_mode=$(get_section_type "$sec")
            proxies=$(clash_request "/proxies")
            active_px=$(get_active_proxy_name "$proxies")
            active_px_display=$(html_escape "$(get_active_proxy_display "$proxies")")
            local active_leaf
            active_leaf=$(_resolve_leaf "$active_px" "$proxies")
            [ -z "$active_leaf" ] && active_leaf="$active_px"
            px_type=$(echo "$proxies" | jq -r --arg n "$active_leaf" \
                '.proxies[$n].type // "unknown"' 2>/dev/null || echo "unknown")

            # Step 1: Geo
            PROBE_EXIT_IP=""; PROBE_COUNTRY=""; PROBE_ORG=""; PROBE_CF_COUNTRY=""
            probe_geo
            send_or_edit "$mid" "$(printf '%s <b>Probing active outbound...</b>\n\nStep 2/4: Google hint...' "$E_MICRO")" ""

            # Step 2: Google
            PROBE_GOOGLE_COUNTRY=""
            probe_google
            send_or_edit "$mid" "$(printf '%s <b>Probing active outbound...</b>\n\nStep 3/4: Services...' "$E_MICRO")" ""

            # Step 3: Services
            PROBE_SVC_RESULTS=""; PROBE_TG_BLOCKED=0
            probe_services
            send_or_edit "$mid" "$(printf '%s <b>Probing active outbound...</b>\n\nStep 4/4: Throughput...' "$E_MICRO")" ""

            # Step 4: Throughput
            PROBE_SPEED_MBPS=""; PROBE_SPEED_BYTES=0; PROBE_SPEED_SECS=""; PROBE_SPEED_STATUS=""
            probe_throughput

            # ── Build result card ──────────────────────────────────────────
            local size_kb_disp size_unit
            size_kb_disp=$(awk "BEGIN{printf \"%d\", ${PROBE_SPEED_BYTES:-0} / 1024}")
            if [ "${size_kb_disp:-0}" -ge 900 ]; then
                size_unit=$(awk "BEGIN{printf \"%.1f MB\", ${PROBE_SPEED_BYTES:-0} / 1048576}")
            else
                size_unit="${size_kb_disp} KB"
            fi

            local speed_line speed_verdict
            case "${PROBE_SPEED_STATUS:-ok}" in
                ok)
                    speed_line="${E_OK} ${PROBE_SPEED_MBPS} Mbps"
                    speed_verdict=""
                    ;;
                throttled)
                    speed_line="${E_RED} ${PROBE_SPEED_MBPS} Mbps"
                    speed_verdict=$(printf '\n%s <b>ISP throttle suspected</b> — speed below 0.8 Mbps threshold.' "$E_WARN")
                    ;;
                block16k)
                    speed_line="${E_RED} —"
                    speed_verdict=$(printf '\n%s <b>16 KB block suspected</b> — connection dropped after ~16 KB.\nThis is a known RKN pattern: first packets pass, then traffic is cut.' "$E_WARN")
                    ;;
                blocked)
                    speed_line="${E_RED} —"
                    speed_verdict=$(printf '\n%s <b>Connection blocked</b> — almost no data received.' "$E_WARN")
                    ;;
            esac

            # Services block — heredoc feeds PROBE_SVC_RESULTS in current shell.
            # || [ -n "$_sname" ] guards last line if $() stripped trailing newline.
            local svc_block=""
            local _tab; _tab=$(printf '\t')
            while IFS="$_tab" read -r _sname _sicon _sdetail || [ -n "$_sname" ]; do
                [ -z "$_sname" ] && continue
                svc_block=$(printf '%s\n%-15s %s%s' "$svc_block" "$_sname" "$_sicon" "$_sdetail")
            done <<EOF
${PROBE_SVC_RESULTS}
EOF
            svc_block="${svc_block#?}"  # strip leading newline

            # Mode hint
            local mode_hint=""
            case "$proxy_mode" in
                proxy:urltest) mode_hint=" <i>(URLTest auto)</i>" ;;
                *)            mode_hint="" ;;
            esac

            # Org line
            local org_line=""
            [ -n "$PROBE_ORG" ] && org_line=$(printf '\n%s <code>%s</code>' "$E_ORG" "$PROBE_ORG")

            local result_text
            result_text=$(printf '%b <b>Active Outbound Probe</b>
<code>────────────────────</code>
%s <b>%s</b>%s | <code>%s</code>
<code>────────────────────</code>
%s <b>Exit IP:</b> <code>%s</code>
%s <b>GeoIP:</b> %s%s
%s <b>Cloudflare:</b> %s
%s <b>Google:</b> %s
<code>────────────────────</code>
%s <b>Services:</b>
<code>%s</code>
<code>────────────────────</code>
%s <b>Throughput:</b> %s
%s <b>Downloaded:</b> %s in %ss%b' \
                "$E_MICRO" \
                "$E_GLOB" "$active_px_display" "$mode_hint" "$px_type" \
                "$E_MAP" "$PROBE_EXIT_IP" \
                "$E_MAP" "$PROBE_COUNTRY" "$org_line" \
                "$E_MAP" "$PROBE_CF_COUNTRY" \
                "$E_MAP" "$PROBE_GOOGLE_COUNTRY" \
                "$E_ENVELOPE" \
                "$svc_block" \
                "$E_BOLT" "$speed_line" \
                "$E_BOLT" "$size_unit" "$PROBE_SPEED_SECS" \
                "$speed_verdict")

            # Action buttons — context-aware
            local action_btn=""
            if [ "${PROBE_TG_BLOCKED:-0}" = "1" ]; then
                action_btn="[{\"text\":\"${E_BOT} Bot Settings\",\"callback_data\":\"bot_settings\"}],"
            elif [ "$PROBE_SPEED_STATUS" = "throttled" ] || [ "$PROBE_SPEED_STATUS" = "block16k" ] || [ "$PROBE_SPEED_STATUS" = "blocked" ]; then
                case "$proxy_mode" in
                    proxy:urltest)
                        action_btn="[{\"text\":\"${E_BOLT} Test All Proxies\",\"callback_data\":\"cmd_all_delay_test\"}],"
                        ;;
                    proxy:url)
                        action_btn="[{\"text\":\"${E_EDIT} Set New URL\",\"callback_data\":\"cmd_url_link_add\"}],"
                        ;;
                    *)
                        action_btn="[{\"text\":\"${E_GLOB} Switch Proxy\",\"callback_data\":\"proxy_menu\"}],"
                        ;;
                esac
            fi

            local result_kb
            local _back_label
            case "$_back" in
                cmd_diagnostics)  _back_label="Diagnostics" ;;
                url_links_menu)   _back_label="Single URL" ;;
                *)                _back_label="Back" ;;
            esac
            result_kb="{\"inline_keyboard\":[${action_btn}[{\"text\":\"${E_BACK} ${_back_label}\",\"callback_data\":\"${_back}\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"

            logger -t podkop-bot "[Probe] ${active_px_display}: geo=${PROBE_COUNTRY} cf=${PROBE_CF_COUNTRY} google=${PROBE_GOOGLE_COUNTRY} tg_blocked=${PROBE_TG_BLOCKED} speed=${PROBE_SPEED_MBPS}Mbps size=${size_kb_disp}KB status=${PROBE_SPEED_STATUS}"
            send_or_edit "$mid" "$result_text" "$result_kb"
            ;;

        "cmd_upstream_health")
            local uf="/tmp/podkop_upstream.txt"
            send_or_edit "$mid" "$(printf '%s Testing upstream proxies...' "$E_TIME")" ""
            if run_upstream_health_report "$uf"; then api_document "$uf" "Upstream Health"
            else send_message "$(printf '%s Done with failures.' "$E_WARN")" ""; api_document "$uf" "Upstream Health (failures)"; fi
            rm -f "$uf"; delete_message "$mid"; _handle_bot "cmd_diagnostics" "" "" ""
            ;;
        "cmd_run_podkop_tests")
            local tf="/tmp/podkop_global_check.txt"
            send_or_edit "$mid" "$(printf '%s Running Global Check...' "$E_TIME")" ""
            ${PODKOP_BIN} global_check | sed "s/$(printf '\033')\\[[0-9;]*[a-zA-Z]//g" > "$tf" 2>&1 || \
                echo "ERROR: global_check failed" >> "$tf"
            api_document "$tf" "Podkop Global Check"
            rm -f "$tf"; delete_message "$mid"; _handle_bot "cmd_diagnostics" "" "" ""
            ;;
        "cmd_run_internal_diag")
            local tf="/tmp/podkop_internal_diag.txt"
            send_or_edit "$mid" "$(printf '%s Gathering diagnostics...' "$E_TIME")" ""
            run_internal_diagnostics "$tf"
            api_document "$tf" "Internal Diagnostics" || \
                send_message "$(printf '%s Failed to send.' "$E_ERR")" ""
            rm -f "$tf"; delete_message "$mid"; _handle_bot "cmd_diagnostics" "" "" ""
            ;;

        "cmd_files")
            send_or_edit "$mid" "$(printf '%s <b>Configs & Logs</b>' "$E_FILE")" \
                "{\"inline_keyboard\":[
                    [{\"text\":\"${E_FILE} Podkop Config\",\"callback_data\":\"cmd_get_config\"},{\"text\":\"${E_FILE} Sing-box JSON\",\"callback_data\":\"cmd_get_sb_json\"}],
                    [{\"text\":\"${E_LOG} Syslog\",\"callback_data\":\"cmd_get_log\"}],
                    [{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_runtime\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]
                ]}"
            ;;
        "cmd_get_config")  api_document "/etc/config/${PODKOP_UCI}" "${PODKOP_DISPLAY_NAME} Config" ;;
        "cmd_get_sb_json") api_document "${SINGBOX_CONFIG_PATH}" "Sing-box Config" ;;
        "cmd_get_log")
            logread | grep -iE "${PODKOP_PKG}|sing-box" | tail -n 150 > /tmp/podkop_syslog.txt
            api_document "/tmp/podkop_syslog.txt" "Recent Logs"
            rm -f /tmp/podkop_syslog.txt
            ;;

        "cmd_support_bundle")
            local bf="/tmp/podkop_support_bundle.txt"
            send_or_edit "$mid" "$(printf '%s Collecting support bundle...' "$E_TIME")" ""
            local sec; sec=$(get_active_section)
            local hostname; hostname=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo "Router")
            local p_ver; p_ver=$(opkg info ${PODKOP_PKG} 2>/dev/null | grep '^Version:' | tail -1 | cut -d' ' -f2 | sed 's/^v//' | cut -d'-' -f1)
            [ -z "$p_ver" ] && p_ver=$(apk info ${PODKOP_PKG} 2>/dev/null | head -1 | awk '{print $1}' | sed "s/^${PODKOP_PKG}-//;s/^v//" | cut -d'-' -f1)
            local sb_ver; sb_ver=$(get_singbox_version_display 2>/dev/null || echo "unknown")
            {
                echo "=== Podkop Support Bundle ==="
                echo "Date: $(date)"
                echo "Host: ${hostname}"
                echo "Bot: v${BOT_VERSION}"
                echo "Podkop: ${p_ver:-unknown}"
                echo "Sing-box: ${sb_ver}"
                echo ""
                echo "=== Active Section ==="
                echo "$sec"
                echo ""
                echo "=== Podkop Status ==="
                ${PODKOP_INIT} status 2>&1 || echo "status failed"
                echo ""
                echo "=== Sing-box Process ==="
                if pidof sing-box >/dev/null 2>&1; then
                    local sb_pid; sb_pid=$(pidof sing-box | awk '{print $1}')
                    echo "PID: $sb_pid"
                    awk '/VmRSS/{print "RAM: "int($2/1024)" MB"}' /proc/"$sb_pid"/status 2>/dev/null
                else
                    echo "NOT RUNNING"
                fi
                echo ""
                echo "=== UCI Config (${PODKOP_UCI}) ==="
                uci show ${PODKOP_UCI} 2>&1
                echo ""
                echo "=== UCI Config (podkop_bot) ==="
                uci show podkop_bot 2>&1 | grep -v "bot_token\|chat_id\|admin_ids"
                echo ""
                echo "=== IP Routes ==="
                ip route show 2>&1 | head -30
                echo ""
                echo "=== IP Rules ==="
                ip rule show 2>&1 | head -20
                echo ""
                echo "=== NFT Rules (podkop) ==="
                nft list ruleset 2>/dev/null | grep -A5 -B1 -i "${PODKOP_PKG}" | head -60 || echo "nft not available"
                echo ""
                echo "=== Network Interfaces ==="
                ip -brief addr show 2>&1 | head -20
                echo ""
                echo "=== Public IP Cache ==="
                cat "$PUBIP_CACHE" 2>/dev/null || echo "not cached"
                echo ""
                echo "=== Bot Transport State ==="
                echo "LAST_ROUTE: $LAST_ROUTE"
                echo "LAST_ROUTE_FAST: $LAST_ROUTE_FAST"
                echo "LAST_ROUTE_POLL: $LAST_ROUTE_POLL"
                echo "LAST_ROUTE_NAME: $LAST_ROUTE_NAME"
                echo "RECOVERY_MODE: $RECOVERY_MODE"
                cat "$SOCKS_STATE_FILE" 2>/dev/null && echo "" || echo "(no socks state file)"
                echo ""
                echo "=== Recent Podkop Syslog (last 80 lines) ==="
                logread 2>/dev/null | grep -iE "${PODKOP_PKG}|sing-box" | tail -80 || echo "logread failed"
            } > "$bf" 2>&1
            api_document "$bf" "Support Bundle [$(html_escape "$hostname")]"
            rm -f "$bf"
            delete_message "$mid"
            _handle_bot "cmd_diagnostics" "" "" ""
            ;;

        "ask_restart_router_1")
            # First confirmation — button press
            send_or_edit "$mid" \
                "$(printf '%s <b>Restart Router?</b>\n\nThis will reboot <b>%s</b>.\nAll connections will be interrupted for ~60 seconds.\n\n<b>Are you sure?</b>' "$E_WARN" "$(cat /proc/sys/kernel/hostname 2>/dev/null || echo Router)")" \
                "{\"inline_keyboard\":[
                    [{\"text\":\"${E_OK} Yes, continue\",\"callback_data\":\"ask_restart_router_2\"}],
                    [{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"cmd_maintenance\"}]
                ]}"
            ;;

        "ask_restart_router_2")
            # Second confirmation — requires typing YES
            echo "wait_restart_router_confirm" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Final confirmation required.</b>\n\nType <code>YES</code> (uppercase) to confirm router reboot.\nAny other input cancels.' "$E_WARN")" \
                "{\"inline_keyboard\":[
                    [{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"cmd_maintenance\"}]
                ]}"
            ;;

        "ask_restart_bot")
            send_or_edit "$mid" \
                "$(printf '%s <b>Restart Bot?</b>\n\nKills all bot processes (main loop + watchdog subshells) and restarts via init.d.\nBot will send a startup notification when back online.' "$E_WARN")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Restart\",\"callback_data\":\"do_restart_bot\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"cmd_maintenance\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            ;;

        "do_restart_bot")
            send_message "$(printf '%s <b>Restarting bot...</b>\nStartup notification will confirm when back online.' "$E_RST")" ""
            logger -t podkop-bot "[Restart] Manual restart requested via Telegram"
            kill "$HEALTH_PID" 2>/dev/null

            if [ -f "/etc/init.d/podkop_bot" ]; then
                # procd path: just kill ourselves — procd respawns automatically.
                # DO NOT do /proc reap here: it kills the new procd-spawned instance
                # that may already be starting, causing an infinite respawn loop.
                # stop_service in init.d already handles orphaned subshells via
                # _kill_all_podkop_bot before the new instance starts.
                kill -9 $$ 2>/dev/null || true
            else
                # No init.d: reap orphaned subshells (health daemon forks)
                # then exec new instance directly.
                local _self_pid=$$ _reap_pid _reap_cmd
                for _reap_pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
                    [ "$_reap_pid" = "$_self_pid" ] && continue
                    _reap_cmd=$(cat "/proc/${_reap_pid}/cmdline" 2>/dev/null | tr '\0' ' ')
                    case "$_reap_cmd" in
                        *"podkop_bot"*|*"podkop-bot"*)
                            kill -9 "$_reap_pid" 2>/dev/null || true ;;
                    esac
                done
                sleep 1
                exec "$BOT_PATH"
            fi
            exit 0
            ;;

        "cmd_info")
            # v0.15.1: cmd_info merged into cmd_status. Redirect for back-compat.
            _handle_bot "cmd_status" "$mid" "$cid" "$cb_id"
            ;;

        "cmd_info_legacy_unused_placeholder")
            # Placeholder to preserve grep/diff context — never reached
            :
            ;;

        "cmd_maintenance")
            # Clear upload state if user hit inline Cancel from Upload Bot Script
            { read -r _ms < "$STATE_FILE" 2>/dev/null; [ "$_ms" = "wait_bot_script_file" ] && rm -f "$STATE_FILE"; } || true
            # Warn once per bot session if init.d is outdated
            local _init_warn_f="${BOT_DIR}/init_warn_shown"
            if [ ! -f "$_init_warn_f" ]; then
                local _init_chk="/etc/init.d/podkop_bot"
                if [ -f "$_init_chk" ] && \
                   { ! grep -q "_kill_all_podkop_bot" "$_init_chk" 2>/dev/null || \
                     ! grep -q "return 0" "$_init_chk" 2>/dev/null; }; then
                    touch "$_init_warn_f" 2>/dev/null
                    send_message "$(printf '%s <b>init.d устарел.</b>\nСтарая версия без smart lock — возможны Telegram 409 конфликты при перезапуске.\nОбновите через <code>install.sh</code> или используйте кнопку обновления бота.' "$E_WARN")" ""
                fi
            fi
            local p_ver sb_ver lan_ip y_en text kb
            local _mi_sysinfo _mi_update="" _mi_zapret="" _mi_byedpi="" _mi_zapret2=""
            if _plus_has_cmd "get_system_info"; then
                _mi_sysinfo=$(_plus_json get_system_info)
                p_ver=$(printf '%s' "$_mi_sysinfo" | jq -r '.podkop_version // ""' 2>/dev/null)
                sb_ver=$(printf '%s' "$_mi_sysinfo" | jq -r '.sing_box_version // ""' 2>/dev/null)
                local _mi_latest; _mi_latest=$(printf '%s' "$_mi_sysinfo" | jq -r '.podkop_latest_version // "unknown"' 2>/dev/null)
                [ -n "$_mi_latest" ] && [ "$_mi_latest" != "unknown" ] && [ "$_mi_latest" != "$p_ver" ] &&                     _mi_update=$(printf '\n   %s Update available: <b>%s</b>' "$E_YLW" "$_mi_latest")
                # zapret/byedpi if installed
                local _zap_inst _byedpi_inst
                _zap_inst=$(printf '%s' "$_mi_sysinfo" | jq -r '.zapret_installed // 0' 2>/dev/null)
                _byedpi_inst=$(printf '%s' "$_mi_sysinfo" | jq -r '.byedpi_installed // 0' 2>/dev/null)
                [ "$_zap_inst" = "1" ] && _mi_zapret=$(printf '\n<b>Zapret:</b> %s'                     "$(printf '%s' "$_mi_sysinfo" | jq -r '.zapret_version // "installed"' 2>/dev/null)")
                _zap2_inst=$(printf '%s' "$_mi_sysinfo" | jq -r '.zapret2_installed // 0' 2>/dev/null)
                if [ "$_zap2_inst" = "1" ]; then
                    local _zap2_ver
                    _zap2_ver=$(/opt/zapret2/nfq2/nfqws2 --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+[^ ]*' | head -1)
                    _mi_zapret2=$(printf '\n<b>Zapret2:</b> %s' "${_zap2_ver:-installed}")
                fi
                [ "$_byedpi_inst" = "1" ] && _mi_byedpi=$(printf '\n<b>ByeDPI:</b> %s'                     "$(printf '%s' "$_mi_sysinfo" | jq -r '.byedpi_version // "installed"' 2>/dev/null)")
            fi
            if [ -z "$p_ver" ]; then
                p_ver=$(opkg info ${PODKOP_PKG} 2>/dev/null | grep '^Version:' | tail -1 | cut -d' ' -f2 | sed 's/^v//' | cut -d'-' -f1)
                [ -z "$p_ver" ] && p_ver=$(apk info ${PODKOP_PKG} 2>/dev/null | head -1 | awk '{print $1}' | sed "s/^${PODKOP_PKG}-//;s/^v//" | cut -d'-' -f1)
            fi
            [ -z "$sb_ver" ] && sb_ver=$(get_singbox_version_display)
            lan_ip=$(uci -q get network.lan.ipaddr || echo "127.0.0.1")
            # Device model for Maintenance screen.
            # Prefer the FULL model string from /tmp/sysinfo/model (what Runtime
            # used to show), since the Plus CLI .device_model is often just the
            # vendor/short name. Fall back to CLI value only if sysinfo is empty.
            local _maint_model
            _maint_model=$(cat /tmp/sysinfo/model 2>/dev/null || echo "")
            if [ -z "$_maint_model" ] && [ -n "${_mi_sysinfo:-}" ]; then
                _maint_model=$(printf '%s' "$_mi_sysinfo" | jq -r 'if (.device_model // "") == "unknown" then "" else (.device_model // "") end' 2>/dev/null)
            fi
            y_en=$(uci -q get ${PODKOP_UCI}.settings.enable_yacd || echo "0")

            # GitHub releases URL for this variant
            local _gh_releases="https://github.com/${PODKOP_GITHUB_REPO}/releases"

            text=$(cat <<EOF
${E_SET} <b>Maintenance</b>
<code>────────────────────</code>
$([ -n "$_maint_model" ] && echo "$E_RTR <b>Device:</b> $(html_escape "$_maint_model")")
${E_DOG} <b>${PODKOP_DISPLAY_NAME}</b> <a href="${_gh_releases}">${p_ver:-Unknown}</a>${_mi_update}
<b>Sing-box:</b> ${sb_ver:-Unknown}${_mi_zapret}${_mi_zapret2}${_mi_byedpi}
<b>Bot:</b> v${BOT_VERSION}
<b>YACD:</b> $([ "$y_en" = "1" ] && printf "${E_ON} Enabled — http://%s:9090/ui" "$lan_ip" || echo "${E_OFF} Disabled")
EOF
)
            kb="{\"inline_keyboard\":[
                [{\"text\":\"${E_DOG} Check Podkop Update\",\"callback_data\":\"cmd_check_update\"}],
                [{\"text\":\"${E_NEW} Check Bot Update\",\"callback_data\":\"cmd_check_update_bot\"}],
                [{\"text\":\"📊 Send Daily Report Now\",\"callback_data\":\"cmd_send_report_now\"}],
                [{\"text\":\"📅 Send Weekly Report Now\",\"callback_data\":\"cmd_send_weekly_now\"}],
                [{\"text\":\"📤 Upload Bot Script\",\"callback_data\":\"cmd_upload_bot_script\"}],
                [{\"text\":\"${E_RST} Restart Bot\",\"callback_data\":\"ask_restart_bot\"}],
                [{\"text\":\"${E_SKULL} Restart Router\",\"callback_data\":\"ask_restart_router_1\"}],
                [{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]
            ]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "cmd_upload_bot_script")
            echo "wait_bot_script_file" > "$STATE_FILE"
            send_or_edit "$mid" \
                "$(printf '%s <b>Upload Bot Script</b>\n\nSend a <code>podkop_bot.sh</code> file as a document.\n\n<i>The file will be validated (shebang, BOT_VERSION, syntax check) before installation.\nCurrent bot will be backed up to <code>podkop_bot.sh.bak</code>.\nBot will restart automatically after install.</i>\n\n/cancel to abort.' "$E_FILE")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"cmd_maintenance\"}]]}"
            ;;

        "cmd_send_weekly_now")
            send_or_edit "$mid" "$(printf '%s Sending weekly report...' "$E_TIME")" \
                "{\"inline_keyboard\":[[{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_weekly_report &
            ;;

        "cmd_send_report_now")
            # Run in background — send_daily_report does several curl calls
            # (tg_latency, clash API, public IP) that can block for 10+ seconds.
            # Sending "Sending..." first gives immediate UI feedback.
            send_or_edit "$mid" "$(printf '%s Sending daily report...' "$E_TIME")" \
                "{\"inline_keyboard\":[[{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_daily_report &
            ;;

        "cmd_check_update")
            local p_ver latest text kb
            send_or_edit "$mid" "$(printf '%s Checking GitHub...' "$E_TIME")" ""
            p_ver=$(opkg info ${PODKOP_PKG} 2>/dev/null | grep '^Version:' | tail -1 | cut -d' ' -f2 | sed 's/^v//' | cut -d'-' -f1)
            [ -z "$p_ver" ] && p_ver=$(apk info ${PODKOP_PKG} 2>/dev/null | head -1 | awk '{print $1}' | sed "s/^${PODKOP_PKG}-//;s/^v//" | cut -d'-' -f1)
            latest=$(_curl_via_best_socks 10 \
                "https://api.github.com/repos/${PODKOP_GITHUB_REPO}/releases/latest" \
                | jq -r '.tag_name' 2>/dev/null | sed 's/^v//' | cut -d'-' -f1)
            if [ -z "$latest" ] || [ "$latest" = "null" ]; then
                send_or_edit "$mid" "$(printf '%s Cannot reach GitHub.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_maintenance\"}]]}"
                return
            fi
            # If p_ver is empty (package manager returned nothing — unusual pkg name or not installed),
            # treat as unknown: show latest and offer update rather than falsely claiming "up to date".
            if [ -z "$p_ver" ]; then
                text=$(printf '%s <b>Cannot detect installed podkop version.</b>\n\nLatest on GitHub: <b>%s</b>\n\n<i>opkg/apk returned no version info.</i>' "$E_WARN" "$latest")
                send_or_edit "$mid" "$text" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Install/Update\",\"callback_data\":\"do_update_podkop\"},{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"cmd_maintenance\"}]]}"
                return
            fi
            # Compare versions without sort -V (not guaranteed on BusyBox).
            # Split x.y.z into parts and compare numerically.
            local _upd=0
            if [ "$p_ver" != "$latest" ]; then
                local _p1 _p2 _p3 _p4 _l1 _l2 _l3 _l4
                _p1=$(printf '%s' "$p_ver" | cut -d. -f1)
                _p2=$(printf '%s' "$p_ver" | cut -d. -f2)
                _p3=$(printf '%s' "$p_ver" | cut -d. -f3)
                _p4=$(printf '%s' "$p_ver" | cut -d. -f4)
                _l1=$(printf '%s' "$latest" | cut -d. -f1)
                _l2=$(printf '%s' "$latest" | cut -d. -f2)
                _l3=$(printf '%s' "$latest" | cut -d. -f3)
                _l4=$(printf '%s' "$latest" | cut -d. -f4)
                if   [ "${_l1:-0}" -gt "${_p1:-0}" ]; then _upd=1
                elif [ "${_l1:-0}" -eq "${_p1:-0}" ] && [ "${_l2:-0}" -gt "${_p2:-0}" ]; then _upd=1
                elif [ "${_l1:-0}" -eq "${_p1:-0}" ] && [ "${_l2:-0}" -eq "${_p2:-0}" ] && [ "${_l3:-0}" -gt "${_p3:-0}" ]; then _upd=1
                elif [ "${_l1:-0}" -eq "${_p1:-0}" ] && [ "${_l2:-0}" -eq "${_p2:-0}" ] && [ "${_l3:-0}" -eq "${_p3:-0}" ] && [ "${_l4:-0}" -gt "${_p4:-0}" ]; then _upd=1
                fi
            fi
            if [ "$_upd" = "1" ]; then
                text=$(cat <<EOF
${E_NEW} <b>Update Available!</b>

<b>Current:</b> ${p_ver}
<b>Latest:</b> ${latest}

<i>Runs install.sh from GitHub (no hash verification).</i>
EOF
)
                kb="{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Install\",\"callback_data\":\"do_update_podkop\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"cmd_maintenance\"}]]}"
                send_or_edit "$mid" "$text" "$kb"
            else
                send_or_edit "$mid" "$(printf '%s Up to date: %s' "$E_OK" "$p_ver")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_maintenance\"}]]}"
            fi
            ;;

        "do_update_podkop")
            local _upd_tmp="/tmp/podkop_update.sh"
            local _upd_log="/tmp/podkop_update.log"
            local _upd_url="https://raw.githubusercontent.com/${PODKOP_GITHUB_REPO}/refs/heads/main/install.sh"
            send_or_edit "$mid" "$(printf '%s Downloading update...' "$E_TIME")" ""
            rm -f "$_upd_tmp" "$_upd_log"
            if ! _curl_via_best_socks 30 -o "$_upd_tmp" "$_upd_url"; then
                send_or_edit "$mid" "$(printf '%s Cannot reach GitHub — install.sh not downloaded.' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_maintenance\"}]]}"
                return
            fi
            if ! grep -q "^#!" "$_upd_tmp" 2>/dev/null; then
                send_or_edit "$mid" "$(printf '%s Downloaded script is invalid (no shebang).' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_maintenance\"}]]}"
                return
            fi
            # Pre-flight "проверятор": confirm (over forced IPv4) that the feed
            # and GitHub raw are reachable. If they aren't even with -4, it's a
            # real egress block — tell the user instead of letting opkg/apk hang.
            local _net_verdict; _net_verdict=$(_pkg_net_check)
            if [ "$_net_verdict" != "ok" ]; then
                send_or_edit "$mid" "$(printf '%s <b>Package network unreachable</b>\n\n<code>%s</code>\n\n<i>Even over IPv4 the package feed/GitHub did not respond — this is an egress block, not the DNS issue. Update would fail.</i>' "$E_ERR" "$(html_escape "$_net_verdict")")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_maintenance\"}]]}"
                return
            fi
            send_or_edit "$mid" "$(printf '%s Installing podkop...\n\n<i>Package network OK. This may take up to 60 seconds.</i>' "$E_TIME")" ""
            # opkg/apk inside install.sh resolve via the system resolver (musl),
            # which stalls on AAAA under podkop. Point the router's own resolver
            # at public IPv4 DNS for the install; restore on exit (subshell trap
            # keeps the parent's traps untouched and guarantees restore).
            (
                trap '_resolv_v4_restore' EXIT INT TERM
                _resolv_v4_override
                sh "$_upd_tmp"
            ) >"$_upd_log" 2>&1
            local _exit=$?
            _resolv_v4_restore   # belt-and-suspenders if the subshell was killed
            # Tail of log — last 20 non-empty lines
            # install.sh (podkop/plus) colours its output with ANSI escapes
            # (\033[..m). Those render as garbage in Telegram <pre> and can make
            # the log look empty. Strip them before tailing. printf-built ESC is
            # more portable on BusyBox sed than \x1b.
            local _esc; _esc=$(printf '\033')
            local _log_tail; _log_tail=$(sed "s/${_esc}\[[0-9;]*m//g" "$_upd_log" 2>/dev/null | grep -v '^[[:space:]]*$' | tail -20)
            if [ "$_exit" -eq 0 ]; then
                # Re-detect variant FIRST — must happen before reading _new_ver
                # so we use the correct PODKOP_PKG after evolution→netshift migration.
                local _old_variant="$PODKOP_VARIANT"
                PODKOP_VARIANT=$(_detect_podkop_variant)
                _apply_variant_env 2>/dev/null || true
                local _new_ver; _new_ver=$(opkg info ${PODKOP_PKG} 2>/dev/null | grep '^Version:' | tail -1 | cut -d' ' -f2 | sed 's/^v//' | cut -d'-' -f1)
                [ -z "$_new_ver" ] && _new_ver=$(apk info ${PODKOP_PKG} 2>/dev/null | head -1 | awk '{print $1}' | sed "s/^${PODKOP_PKG}-//;s/^v//" | cut -d'-' -f1)
                local _migrated_note=""
                [ "$_old_variant" = "evolution" ] && [ "$PODKOP_VARIANT" = "netshift" ] && \
                    _migrated_note="\n\n\xe2\x9a\xa0\xef\xb8\x8f <b>Migration:</b> podkop-evolution \xe2\x86\x92 NetShift. Bot runtime updated."
                send_or_edit "$mid" "$(printf '%s Podkop updated successfully.\n\n<b>Version:</b> %s\n\n<pre>%s</pre>%s' \
                    "$E_OK" "${_new_ver:-unknown}" "$(html_escape "$_log_tail")" "$_migrated_note")" \
                    "{\"inline_keyboard\":[[{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            else
                send_or_edit "$mid" "$(printf '%s Installation failed (exit %s).\n\n<pre>%s</pre>' \
                    "$E_ERR" "$_exit" "$(html_escape "$_log_tail")")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_maintenance\"}]]}"
            fi
            rm -f "$_upd_tmp" "$_upd_log"
            ;;

        # ------------------------------------------------------------------
        # Bot self-update: check version.txt on GitHub, download new script,
        # replace binary atomically, restart via init.d or exec.
        #
        # Safety sequence before replacing binary:
        #   1. Download to temp file and validate (must start with #!)
        #   2. mv (atomic on same filesystem) — no window with missing binary
        #   3. Kill watchdog subshell explicitly (HEALTH_PID)
        #   4. /etc/init.d/podkop_bot restart — procd respawns from new binary
        #      If no init.d: exec $BOT_PATH — replace current process in-place
        #
        # Note: the bot cannot reply AFTER exec — the restart confirmation
        # is sent BEFORE the binary is replaced (send_or_edit → then update).
        # ------------------------------------------------------------------
        "cmd_check_update_bot")
            local remote_ver highlights text kb
            send_or_edit "$mid" "$(printf '%s Checking GitHub...' "$E_TIME")" ""

            # version.txt format:
            #   line 1: version number (e.g. 0.13.96)
            #   line 2: highlights, comma-separated (e.g. "Probe Outbound, DNS check, Gemini")
            local version_raw
            version_raw=$(_curl_via_best_socks 8 \
                "https://raw.githubusercontent.com/Medvedolog/podkop_bot/main/version.txt")
            remote_ver=$(printf '%s' "$version_raw" | head -1 | tr -d '\r\n\t ')
            local _check_route="$_last_fetch_route"
            # highlights.txt is a separate file for forward/backward compatibility
            # Old versions (pre-0.13.96) used version.txt with tr -d '[:space:]' —
            # putting highlights in version.txt broke their update loop.
            local _hl_raw
            _hl_raw=$(_curl_via_best_socks 8 \
                "https://raw.githubusercontent.com/Medvedolog/podkop_bot/main/highlights.txt" \
                | head -1 | tr -d '\r')
            # Show route only when GitHub was reached via proxy (direct = normal, not noteworthy)
            local _via_note=""
            [ -n "$_check_route" ] && [ "$_check_route" != "direct" ] && \
                _via_note=$(printf '\n<i>Fetched via %s</i>' "$(html_escape "$_check_route")")
            # Discard if response looks like HTML (404 page) or is empty
            case "$_hl_raw" in
                ''|'<'*|'{'*) highlights="" ;;
                *) highlights="$_hl_raw" ;;
            esac

            if [ -z "$remote_ver" ] || [ "$remote_ver" = "null" ]; then
                kb="{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_maintenance\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
                send_or_edit "$mid" "$(printf '%s Cannot reach GitHub. Check connectivity.' "$E_ERR")" "$kb"
                return
            fi

            local changelog_link="https://github.com/Medvedolog/podkop_bot/blob/main/CHANGELOG.md"

            if [ "$remote_ver" = "$BOT_VERSION" ]; then
                if [ -n "$highlights" ]; then
                    text=$(printf '%s Bot is up to date: <b>v%s</b>\n\n<i>%s</i>\n\n<a href="%s">Full changelog</a>%s' \
                        "$E_OK" "$BOT_VERSION" "$(html_escape "$highlights")" "$changelog_link" "$_via_note")
                else
                    text=$(printf '%s Bot is up to date: <b>v%s</b>%s' "$E_OK" "$BOT_VERSION" "$_via_note")
                fi
                kb="{\"inline_keyboard\":[[{\"text\":\"${E_RST} Force Update\",\"callback_data\":\"ask_update_bot_force_${remote_ver}\"}],[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_maintenance\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
                send_or_edit "$mid" "$text" "$kb"
            else
                if [ -n "$highlights" ]; then
                    text=$(printf '%s <b>Bot Update Available!</b>\n\n<b>Installed:</b> v%s\n<b>Available:</b> v%s\n\n<i>%s</i>\n\n<a href="%s">Full changelog</a>%s' \
                        "$E_NEW" "$BOT_VERSION" "$remote_ver" \
                        "$(html_escape "$highlights")" "$changelog_link" "$_via_note")
                else
                    text=$(printf '%s <b>Bot Update Available!</b>\n\n<b>Installed:</b> v%s\n<b>Available:</b> v%s\n\n<a href="%s">Full changelog</a>%s' \
                        "$E_NEW" "$BOT_VERSION" "$remote_ver" "$changelog_link" "$_via_note")
                fi
                kb="{\"inline_keyboard\":[[{\"text\":\"${E_OK} Update to v${remote_ver}\",\"callback_data\":\"ask_update_bot_${remote_ver}\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"cmd_maintenance\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
                send_or_edit "$mid" "$text" "$kb"
            fi
            ;;

        "ask_update_bot_"*)
            local target_ver="${cmd#ask_update_bot_}" text kb
            # Strip force_ prefix for display, preserve it for do_ callback
            local _disp_ver="${target_ver#force_}"
            text=$(printf '%s <b>Update bot to v%s?</b>\n\nThe bot will download the new version and restart.\nAll active menus will be interrupted.\n\nSection: <code>%s</code>' \
                "$E_WARN" "$_disp_ver" "$(get_active_section)")
            kb="{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Update & Restart\",\"callback_data\":\"do_update_bot_${target_ver}\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"cmd_maintenance\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        "do_update_bot_"*)
            local target_ver="${cmd#do_update_bot_}"
            # Check for force_ prefix — force skips same-version guard
            local _force=0
            case "$target_ver" in force_*) _force=1; target_ver="${target_ver#force_}" ;; esac
            local bot_tmp="/tmp/podkop_bot_update.$$"
            local bot_url="https://raw.githubusercontent.com/Medvedolog/podkop_bot/main/podkop_bot.sh"
            local kb_err="{\"inline_keyboard\":[[{\"text\":\"${E_BACK} Back\",\"callback_data\":\"cmd_maintenance\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"

            send_or_edit "$mid" "$(printf '%s <b>Downloading bot v%s...</b>' "$E_TIME" "$target_ver")" ""

            if ! _curl_via_best_socks 30 -o "$bot_tmp" "$bot_url"; then
                rm -f "$bot_tmp"
                send_message "$(printf '%s Download failed. Check connectivity.' "$E_ERR")" "$kb_err"
                return
            fi

            if ! head -1 "$bot_tmp" | grep -q '^#!' || ! grep -q '^BOT_VERSION=' "$bot_tmp"; then
                rm -f "$bot_tmp"
                send_message "$(printf '%s Downloaded file is invalid (not a bot script).' "$E_ERR")" "$kb_err"
                return
            fi

            local new_ver
            new_ver=$(grep '^BOT_VERSION=' "$bot_tmp" | cut -d'"' -f2)

            # Guard: skip if downloaded version matches current AND not a force update.
            # Prevents infinite loop when old "do_update_bot_" callbacks are
            # replayed after a restart (e.g. offset migration or BOT_DIR change).
            if [ "$_force" = "0" ] && [ -n "$new_ver" ] && [ "$new_ver" = "$BOT_VERSION" ]; then
                rm -f "$bot_tmp"
                send_or_edit "$mid" "$(printf '%s Already running v%s — no update needed.' "$E_OK" "$BOT_VERSION")"                     "{\"inline_keyboard\":[[{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
                logger -t podkop-bot "[Self-update] Skipped: already at v${BOT_VERSION}"
                return
            fi

            chmod +x "$bot_tmp"

            # Validate the downloaded file BEFORE replacing the running bot.
            # Without this, a syntactically broken file in the repo would brick
            # the bot on restart with no way back. sh -n = busybox ash -n on router.
            if ! sh -n "$bot_tmp" 2>/dev/null; then
                rm -f "$bot_tmp"
                logger -t podkop-bot "[Self-update] ABORTED: downloaded file has shell syntax errors. Keeping current v${BOT_VERSION}."
                send_or_edit "$mid" "$(printf '%s <b>Update aborted.</b>\nDownloaded file failed syntax check — keeping current v%s.' "$E_WARN" "$BOT_VERSION")" \
                    "{\"inline_keyboard\":[[{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
                return
            fi

            local _dl_route_note=""
            [ -n "$_last_fetch_route" ] && [ "$_last_fetch_route" != "direct" ] && \
                _dl_route_note=$(printf ' <i>(via %s)</i>' "$(html_escape "$_last_fetch_route")")
            send_message \
                "$(printf '%s <b>Bot updating to v%s</b>%s\nRestarting now — startup notification will confirm when back online.' \
                    "$E_RST" "${new_ver:-$target_ver}" "$_dl_route_note")" ""

            # Download and update init.d if outdated
            local _init_path="/etc/init.d/podkop_bot"
            local _init_url="https://raw.githubusercontent.com/Medvedolog/podkop_bot/main/podkop_bot_init"
            local _init_tmp="/tmp/podkop_bot_init_update.$$"
            local _init_outdated=0
            if [ -f "$_init_path" ] && \
               { ! grep -q "_kill_all_podkop_bot" "$_init_path" 2>/dev/null || \
                 ! grep -q "return 0" "$_init_path" 2>/dev/null; }; then
                _init_outdated=1
            fi
            if [ "$_init_outdated" = "1" ]; then
                send_message "$(printf '%s <b>Updating init.d...</b> (outdated version detected)' "$E_TIME")" ""
                if _curl_via_best_socks 15 -o "$_init_tmp" "$_init_url" 2>/dev/null && \
                   head -1 "$_init_tmp" | grep -q "rc.common" 2>/dev/null; then
                    chmod +x "$_init_tmp"
                    cp -f "$_init_path" "${_init_path}.bak" 2>/dev/null || true
                    mv "$_init_tmp" "$_init_path"
                    logger -t podkop-bot "[Self-update] init.d updated from GitHub"
                    send_message "$(printf '%s init.d updated successfully.' "$E_OK")" ""
                else
                    rm -f "$_init_tmp"
                    send_message "$(printf '%s <b>Warning:</b> init.d is outdated but failed to download update.\nUpdate manually via <code>install.sh</code>.' "$E_WARN")" ""
                fi
                sleep 1
            fi

            cp -f "$BOT_PATH" "${BOT_PATH}.bak" 2>/dev/null || true
            mv "$bot_tmp" "$BOT_PATH"
            logger -t podkop-bot "[Self-update] Updated to v${new_ver}. Backup at ${BOT_PATH}.bak. Restarting..."

            # Preserve offset outside BOT_DIR before restart.
            # The trap (INT/TERM/QUIT) runs rm -rf "$BOT_DIR" which would wipe
            # OFFSET_FILE, causing offset=0 on next start and replaying old callbacks.
            # Copy to legacy flat path — startup migration block picks it up.
            cp "$OFFSET_FILE" "/tmp/podkop_bot_offset" 2>/dev/null || true

            # Step 1: Kill watchdog by saved PID (clean shutdown of health daemon)
            kill "$HEALTH_PID" 2>/dev/null

            # Step 2: Full /proc reap — kill ALL surviving podkop_bot processes
            # except ourselves. This catches orphaned subshells from previous
            # restart cycles that procd's init restart does not clean up.
            local _self_pid=$$ _reap_pid _reap_cmd
            for _reap_pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
                [ "$_reap_pid" = "$_self_pid" ] && continue
                _reap_cmd=$(cat "/proc/${_reap_pid}/cmdline" 2>/dev/null | tr '\0' ' ')
                case "$_reap_cmd" in
                    *"podkop_bot"*|*"podkop-bot"*)
                        kill -9 "$_reap_pid" 2>/dev/null || true
                        ;;
                esac
            done
            sleep 1

            if [ -f "/etc/init.d/podkop_bot" ]; then
                # procd path: procd queues the restart via ubus synchronously.
                # We kill ourselves after restart is queued — procd respawns
                # from the new binary with a clean slate.
                local _upd_pid=$$
                /etc/init.d/podkop_bot restart
                kill -9 "$_upd_pid" 2>/dev/null || true
            else
                # No init.d: exec replaces current process with new binary.
                # Process group already reaped above.
                exec "$BOT_PATH"
            fi
            exit 0
            ;;

        "ask_cmd_stop")
            send_or_edit "$mid" "$(printf '%s <b>Stop Podkop?</b>\n\nTunnel will go DOWN. All traffic routing will stop.' "$E_WARN")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Stop\",\"callback_data\":\"do_cmd_stop\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"/menu\"}]]}"
            ;;

        "do_cmd_stop")
            if do_podkop_stop; then
                send_or_edit "$mid" "$(printf '%s <b>Podkop Stopped</b>' "$E_STP")" \
                    "{\"inline_keyboard\":[[{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            else
                send_or_edit "$mid" "$(printf '%s <b>Stop Failed!</b>\nCheck: <code>ps w | grep sing-box</code>' "$E_ERR")" \
                    "{\"inline_keyboard\":[[{\"text\":\"${E_LOG} Logs\",\"callback_data\":\"cmd_get_log\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            fi
            ;;
        "cmd_start")
            ${PODKOP_INIT} start
            send_or_edit "$mid" "$(printf '%s <b>Podkop Starting...</b>' "$E_ON")" \
                "{\"inline_keyboard\":[[{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            ;;
        "ask_reload_podkop")
            send_or_edit "$mid" "$(printf '%s Reload Podkop?' "$E_WARN")" \
                "{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes, Reload\",\"callback_data\":\"do_reload_podkop\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"/menu\"}]]}"
            ;;
        "do_reload_podkop")
            local rc
            send_or_edit "$mid" "$(printf '%s Reloading...' "$E_RST")" ""
            safe_reload_podkop; rc=$?
            case "$rc" in
                0)
                    send_or_edit "$mid" "$(printf '%s Reloaded. Checking tunnel...' "$E_RST")" ""
                    podkop_dns_check 15
                    if [ "${PODKOP_DNS_OK:-0}" = "1" ]; then
                        send_or_edit "$mid" "$(printf '%s Reloaded.\n%s Tunnel OK — traffic is routing.' "$E_OK" "$E_OK")" \
                            "{\"inline_keyboard\":[[{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
                    else
                        send_or_edit "$mid" "$(printf '%s Reloaded.\n%s Tunnel check failed — podkop may not be routing traffic.' "$E_OK" "$E_WARN")" \
                            "{\"inline_keyboard\":[[{\"text\":\"${E_LOG} Logs\",\"callback_data\":\"cmd_get_log\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
                    fi
                    ;;
                1) send_or_edit "$mid" "$(printf '%s Cooldown active (10s).' "$E_WARN")" \
                       "{\"inline_keyboard\":[[{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}" ;;
                *) send_or_edit "$mid" "$(printf '%s Reload failed!' "$E_ERR")" \
                       "{\"inline_keyboard\":[[{\"text\":\"${E_LOG} Logs\",\"callback_data\":\"cmd_get_log\"},{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}" ;;
            esac
            ;;
    esac
}

# ==============================================================================
# SECTION 10: Main Command Router
# Routes callbacks and text messages to the appropriate sub-handler.
# STATE_FILE intercepts text input for multi-step flows.
# ==============================================================================
handle_command() {
    local cmd="$1" mid="$2" cb_id="$3"

    # State machine: intercept plain text (not callbacks) for multi-step input
    if [ -f "$STATE_FILE" ] && [ -z "$cb_id" ]; then
        local state; state=$(head -n 1 "$STATE_FILE")
        # Universal exit: /cancel or Menu always clears state
        case "$1" in
            /cancel|cancel|/menu|/start|main_menu|"🏠 Menu"|"🏠Menu")
                rm -f "$STATE_FILE"
                case "$1" in /cancel|cancel)
                    send_message "$(printf '%s Action cancelled.' "$E_BACK")" "" ;;
                esac
                _handle_bot "main_menu" "$mid" "" ""
                return ;;
        esac
        if echo "$cmd" | grep -qE '^/(start|menu)'; then
            rm -f "$STATE_FILE"; _handle_bot "main_menu" "$mid" "" ""; return
        fi
        case "$state" in
            wait_proxy_link|pending_sub_url_*)
                _handle_proxy "STATE_INPUT" "$mid" "$cmd" "$state" ;;
            wait_sub_url_*)
                _handle_proxy "STATE_INPUT" "$mid" "$cmd" "$state" ;;
            wait_url_link)
                _handle_url_links "STATE_INPUT" "$mid" "$cmd" "$state" ;;
            wait_fully_routed_ip|wait_excl_ip|wait_remote_domain|wait_remote_subnet|\
            wait_user_domain_add|wait_user_domain_del|wait_user_subnet_add|wait_user_subnet_del|\
            wait_utfilter_exc_*|wait_utfilter_inc_*|wait_dpi_strategy_*)
                _handle_lists "STATE_INPUT" "$mid" "$cmd" "$state" ;;
            wait_dns_server|wait_bootstrap_dns)
                _handle_dns "STATE_INPUT" "$mid" "$cmd" "$state" ;;
            wait_custom_proxy|wait_bind_iface|wait_restart_router_confirm)
                _handle_bot "STATE_INPUT" "$mid" "$cmd" "$state" ;;
            wait_admin_id|\
            wait_fb_socks_add)
                _handle_fallback_socks "STATE_INPUT" "$mid" "$cmd" "$state" ;;
            wait_quiet_hours|wait_dr_time|wait_wr_settings|wait_urltest_url|wait_urltest_interval|wait_urltest_tolerance|\
            wait_dr_server|wait_badwan_ifaces|wait_badwan_delay|\
            wait_mixed_port|wait_outbound_iface|wait_vpn_iface|wait_utl_link)
                _handle_section_extras "STATE_INPUT" "$mid" "$cmd" "$state" ;;
        esac
        return
    fi

    case "$cmd" in
        "noop") ;;
        "doc_to_runtime") delete_message "$mid"; _handle_bot "cmd_runtime" "" "" "" ;;
        "delete_msg")     delete_message "$mid" ;;

        proxy_menu|proxy_menu_p_*|px_view_*|do_px_*|do_del_px_*|test_px_*|\
        cmd_proxy_add|ask_del_px_*|do_del_px_confirmed_*|cmd_all_delay_test|\
        cmd_edit_sub_url|do_confirm_sub_url_*)
            _handle_proxy "$cmd" "$mid" "" "" ;;

        url_links_menu|url_links_p_*|\
        cmd_url_link_add|ask_del_ul_*|do_del_ul_*|\
        outbound_info)
            _handle_url_links "$cmd" "$mid" "" "" ;;

        sections_menu|set_sec_*|do_set_sec_*)
            _handle_sections "$cmd" "$mid" ;;

        main_settings_menu|advanced_settings|\
        ask_toggle_dl|ask_toggle_quic|ask_toggle_wan|ask_toggle_ntp|ask_toggle_mixed|\
        do_toggle_dl|do_toggle_quic|do_toggle_wan|do_toggle_ntp|do_toggle_mixed|\
        proxy_mode_menu|ask_switch_mode_*|do_switch_mode_*|set_log_*|set_update_int_*|conn_type_menu|do_set_conn_*|ask_toggle_autostart_off|ask_toggle_autostart_on|do_autostart_off|do_autostart_on)
            _handle_settings "$cmd" "$mid" "" "" ;;

        urltest_settings|cmd_set_ut_url|cmd_set_ut_interval|cmd_set_ut_tolerance|\
        urltest_links_menu|urltest_links_p_*|cmd_utl_add|ask_del_utl_*|do_del_utl_*|\
        cmd_clone_sel_to_utl|cmd_clone_utl_to_sel|\
        cmd_set_mixed_port|cmd_set_outbound_iface|\
        domain_resolver_settings|do_toggle_dr|set_dr_type_*|cmd_set_dr_server|\
        badwan_details|cmd_set_bw_ifaces|cmd_set_bw_delay)
            _handle_section_extras "$cmd" "$mid" "" "" ;;

        dns_settings|dns_proto_menu|do_dns_pr_*|cmd_dns_server|cmd_boot_dns)
            _handle_dns "$cmd" "$mid" "" "" ;;
        section_settings|global_settings|\
        zapret_section_menu|byedpi_section_menu|\
        do_dpi_toggle_*)
            _handle_settings "$cmd" "$mid" "$cid" "$cb_id" ;;

        urltest_filters_menu|\
        do_utfilter_mode_*|do_utfilter_cycle_dc|do_utfilter_toggle_hide)
            _handle_section_extras "$cmd" "$mid" "$cid" "$cb_id" ;;

        wait_utfilter_exc_*|wait_utfilter_inc_*|\
        wait_utfilter_excob_*|wait_utfilter_incob_*|\
        do_utfilter_obpick_*|do_utfilter_obclear_*)
            _handle_section_extras "$cmd" "$mid" "$cid" "$cb_id" ;;

        wait_dpi_strategy_*)
            _handle_section_extras "$cmd" "$mid" "$cid" "$cb_id" ;;
        cmd_maintenance)
            _handle_bot "$cmd" "$mid" "" "" ;;
        yacd_settings|\
        ask_toggle_yacd|do_toggle_yacd|\
        ask_toggle_yacd_wan|do_toggle_yacd_wan|\
        yacd_secret_menu|ask_yacd_*|do_yacd_*)
            _handle_dns "$cmd" "$mid" "" "" ;;

        community_lists|community_lists_edit|toggle_cl_*|\
        r_dom_edit|r_sub_edit|del_rdom_*|del_rsub_*|\
        fr_ips_edit|del_frip_*|\
        excl_ips_edit|del_excl_*|\
        cmd_add_fr_ip|cmd_add_excl_ip|cmd_add_r_dom|cmd_add_r_sub|\
        user_domains_menu|user_domains_menu_p_*|\
        user_subnets_menu|user_subnets_menu_p_*|\
        cmd_user_add_*|cmd_user_del_*|cmd_user_download_*)
            _handle_lists "$cmd" "$mid" "" "" ;;

        do_cmd_stop|cmd_start|ask_cmd_stop|ask_reload_podkop|do_reload_podkop|do_close_connections|\
        cmd_server_instances|\
        cmd_tunnel_health|cmd_support_bundle|\
        cmd_diagnostics|ask_upstream_health|ask_run_podkop_tests|ask_run_internal_diag|ask_support_bundle|\
        ask_probe_outbound|ask_probe_outbound_px_*|ask_probe_outbound_url|cmd_probe_outbound_back_*|\
        cmd_check_update_bot|ask_update_bot_*|do_update_bot_*|\
        ask_restart_bot|do_restart_bot|\
        ask_restart_router_1|ask_restart_router_2)
            _handle_bot "$cmd" "$mid" "" "" ;;

        ask_set_tr_menu|ask_set_tr_*|do_set_tr_*)
            _handle_bot "$cmd" "$mid" "" "" ;;

        admins_menu|cmd_admin_add|ask_del_admin_*|do_del_admin_*|toggle_anon_admins|cmd_bot_invite_info|\
        fallback_socks_menu|cmd_fb_socks_add|cmd_test_fb_socks|ask_del_fb_*|do_del_fb_*)
            _handle_fallback_socks "$cmd" "$mid" "" "" ;;

        ask_*)
            local action="${cmd#ask_}"
            local action_safe; action_safe=$(html_escape "$action")
            local text; text=$(printf '%s <b>Confirm Action</b>\n\n<code>%s</code>?' "$E_WARN" "$action_safe")
            local kb="{\"inline_keyboard\":[[{\"text\":\"${E_OK} Yes\",\"callback_data\":\"do_${action}\"}],[{\"text\":\"${E_BACK} Cancel\",\"callback_data\":\"/menu\"}]]}"
            send_or_edit "$mid" "$text" "$kb"
            ;;

        *) _handle_bot "$cmd" "$mid" "" "" ;;
    esac
}

# ==============================================================================
# SECTION 11: Startup & Main Event Loop
# ==============================================================================

# ── Singleton guard ────────────────────────────────────────────────────────────
# Kill any orphaned watchdog processes from a previous instance that survived
# SIGKILL (procd can leave subshells running). The watchdog itself does not
# hold the lock so it won't be blocked — only the main loop holds it.
BOT_LOCK_FILE="${BOT_DIR}/bot.lock"
BOT_PID_FILE="${BOT_DIR}/bot.pid"
# NOTE: stopping previous instances is the init.d script's job (it kills the
# main + forked children by cmdline). This process does NOT kill anything on
# startup — that risked killing a legitimate running instance and masking
# init.d problems. Single-instance is enforced purely by the lock-guard below
# ("refuse to start if a live instance already holds the lock"). We only record
# our PID here for the cleanup trap and external tooling.
printf '%s' "$$" > "$BOT_PID_FILE"

# Clean up orphaned temp files from a previous run that was killed mid-cycle
# (SIGKILL bypasses trap — these files are never rm'd by the dying process).
# Only remove files older than 60s to avoid racing with a concurrent startup.
find /tmp -maxdepth 1 -name 'podkop_req.*' -o -name 'podkop_updates.*' \
    -o -name 'podkop_clash.*' -o -name 'podkop_ip[1-5].*' \
    -o -name 'podkop_pubip.*' -o -name 'podkop_socks_probe.*' \
    2>/dev/null | while IFS= read -r _stale; do
    # mtime check: skip files touched in the last 60s
    _st_mtime=$(date -r "$_stale" +%s 2>/dev/null || echo 0)
    _st_now=$(date +%s)
    [ $((_st_now - _st_mtime)) -gt 60 ] && rm -f "$_stale"
done

logger -t podkop-bot "=== Podkop Bot v${BOT_VERSION} Starting ==="

# ── Single-instance guard ─────────────────────────────────────────────────────
# The init.d/procd script supervises only the main PID, but this bot forks a
# health daemon + startup-notify child that keep polling getUpdates. A failed
# stop or a respawn can leave the old children alive while a new main starts,
# producing TWO concurrent getUpdates pollers on one token → Telegram 409
# Conflict, flapping routes, and no startup card. Guard against it: refuse to
# start if a live instance is already running.
mkdir -p "$BOT_DIR" 2>/dev/null
_LOCK_PID_FILE="${BOT_DIR}/podkop_bot.pid"
if [ -f "$_LOCK_PID_FILE" ]; then
    _old_pid=$(cat "$_LOCK_PID_FILE" 2>/dev/null)
    # Is that PID still a live podkop_bot process? (not just any reused PID)
    if [ -n "$_old_pid" ] && [ -d "/proc/$_old_pid" ] && \
       grep -qa 'podkop_bot' "/proc/$_old_pid/cmdline" 2>/dev/null; then
        logger -t podkop-bot "FATAL: another podkop_bot instance is already running (PID ${_old_pid}). Refusing to start a second poller (would cause Telegram 409 Conflict). If this is wrong, remove ${_LOCK_PID_FILE} and restart."
        exit 1
    fi
    # stale pidfile (process gone) — clean it up and continue
    rm -f "$_LOCK_PID_FILE"
fi
echo "$$" > "$_LOCK_PID_FILE"
# Release the lock on exit so a clean restart isn't blocked by our own pidfile.
# Only EXIT here — INT/TERM/QUIT are handled by the main cleanup trap below,
# which also removes the pidfile (see BOT_DIR pid cleanup there).
trap 'rm -f "$_LOCK_PID_FILE" 2>/dev/null' EXIT
# ──────────────────────────────────────────────────────────────────────────────

# Migrate offset from old flat /tmp path to new BOT_DIR path (0.14.0 -> 0.14.1 upgrade).
# Without this, after update the offset resets to 0 and the bot replays old Telegram
# updates — including the "do_update_bot_" callback that triggered the update —
# causing an infinite update/restart loop.
if [ ! -f "$OFFSET_FILE" ] && [ -f "/tmp/podkop_bot_offset" ]; then
    cp "/tmp/podkop_bot_offset" "$OFFSET_FILE" 2>/dev/null
    logger -t podkop-bot "[Startup] Migrated offset from legacy path"
fi

# Pre-initialize route key file so watchdog nudge logic works from first cycle.
# Without this, MAIN_ROUTE_KEY_FILE is empty until first api_request_fast succeeds,
# and watchdog sees "unknown" → sends nudge → IPC up resets FAST/POLL → bot does
# full discovery but may land on tier4 (Direct) before tier1 is confirmed reachable.
# Setting "unknown" explicitly ensures nudge fires and triggers SOCKS-first rediscovery.
printf 'unknown' > "$MAIN_ROUTE_KEY_FILE"
printf 'Initializing...' > "$MAIN_ROUTE_FILE"

# Startup notification runs in background subprocess to not block the main loop
send_startup_notification_async() {
    local i=1 hostname p_ver active_proxy startup_txt tg_lat sec

    # Cold-start readiness check — same logic as safe_reload_podkop.
    # sing-box may still be starting when bot launches; building caches too early
    # produces empty TAG_URI/UCI_LINKS/TAG_NAME caches → raw main-N-out in UI.
    local _ci=0 _cfg="${SINGBOX_CONFIG_PATH:-${SINGBOX_CONFIG_PATH}}" _cfg_ready=0
    while [ "$_ci" -lt 10 ]; do
        jq -e '.outbounds | length > 0' "$_cfg" >/dev/null 2>&1 && { _cfg_ready=1; break; }
        sleep 1; _ci=$((_ci + 1))
    done
    if [ "$_cfg_ready" = "1" ]; then
        build_all_caches
    else
        logger -t podkop-bot "[Startup] Warning: config.json not ready after 10s, skipping early cache build"
    fi
    refresh_public_ip_cache >/dev/null 2>&1 &  # Pre-warm public IP cache on startup

    while [ "$i" -le 12 ]; do
        if api_request_fast "getMe" "{}" "5" >/dev/null; then
            load_bot_identity >/dev/null 2>&1
            # Write initial route so watchdog subshell can read it immediately
            _write_main_route "$LAST_ROUTE_FAST" "$LAST_ROUTE_NAME"
            if [ "$(uci -q get podkop_bot.settings.startup_notify || echo "1")" = "1" ]; then
                logger -t podkop-bot "Connected via: ${LAST_ROUTE_NAME} (fast=${LAST_ROUTE_FAST})"
                hostname=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo "Router")
                p_ver=$(opkg info ${PODKOP_PKG} 2>/dev/null | grep '^Version:' | tail -1 | cut -d' ' -f2 | sed 's/^v//' | cut -d'-' -f1)
            [ -z "$p_ver" ] && p_ver=$(apk info ${PODKOP_PKG} 2>/dev/null | head -1 | awk '{print $1}' | sed "s/^${PODKOP_PKG}-//;s/^v//" | cut -d'-' -f1)
                active_proxy=$(get_active_proxy_display "")
                tg_lat=$(get_tg_latency)
                sec=$(get_active_section)
                startup_txt=$(cat <<EOF
${E_BOT} <b>Bot Online</b> v${BOT_VERSION}
<b>Host:</b> ${hostname}
<b>Podkop:</b> ${p_ver:-Unknown} (${PODKOP_DISPLAY_NAME})
<b>Active Route:</b> <code>${active_proxy}</code>
<b>Bot Path:</b> ${LAST_ROUTE_NAME} (${tg_lat})
<b>Section:</b> <code>${sec}</code>
EOF
)
                reset_chat_context
                send_message "$startup_txt" "{\"inline_keyboard\":[[{\"text\":\"🏠 Menu\",\"callback_data\":\"/menu\"}]]}"
            fi
            break
        fi
        i=$((i + 1)); sleep 10
    done
    exit 0
}


# Initialize active section file BEFORE launching daemons so build_all_caches
# inside send_startup_notification_async uses the correct section.
if [ ! -f "$ACTIVE_SECTION_FILE" ]; then
    _first_sec=$(uci -q show ${PODKOP_UCI} 2>/dev/null \
        | grep "^${PODKOP_UCI}\.[^.]*=section$" \
        | head -1 | cut -d. -f2 | cut -d= -f1)
    echo "${_first_sec:-main}" > "$ACTIVE_SECTION_FILE"
fi

send_startup_notification_async &
start_health_daemon

trap 'kill "$HEALTH_PID" 2>/dev/null
    # Remove volatile runtime state but preserve persistent files:
    # OFFSET_FILE (offset survives restart), ACTIVE_SECTION_FILE (user choice),
    # BOT_USERNAME_FILE / BOT_ID_FILE (identity cache).
    rm -f "$STATE_FILE" "$HEALTH_STATE_FILE" "$SOCKS_STATE_FILE" "$SOCKS_PROBE_FILE"         "$SOCKS_REPROBE_TS_FILE" "$ROUTE_CMD_FILE" "$MAIN_ROUTE_FILE" "$MAIN_ROUTE_KEY_FILE"         "$LAST_MENU_MSG_FILE" "$LAST_ALERT_MSG_FILE" "$LAST_CMD_FILE" "$UNAUTH_FILE"         "${BOT_DIR}/last_nudge" "${BOT_DIR}/probe_ts" "${BOT_DIR}/pubip_refresh.lockdir"         "$PUBIP_CACHE" "$TAG_URI_CACHE" "$UCI_LINKS_CACHE" "$TAG_NAME_CACHE"         "$RELOAD_TS_FILE" "$RELOAD_LOCK" "$BOT_PID_FILE"
    rm -f /tmp/podkop_updates.* /tmp/podkop_req.* /tmp/podkop_clash.*         /tmp/podkop_ip[1-5].* /tmp/podkop_pubip.* /tmp/podkop_bot_update.* 2>/dev/null
    rm -f "$_LOCK_PID_FILE" 2>/dev/null
    exit' INT TERM QUIT

offset=$(cat "$OFFSET_FILE" 2>/dev/null || echo "0")

# Main long-poll loop. api_poll_long writes result to API_RESPONSE global
# (avoids subshell variable amnesia from response=$(api_poll ...) pattern).
# Uses separate LAST_ROUTE_POLL — does not share state with api_request_fast.
while true; do
    UPDATES_FILE="/tmp/podkop_updates.$$"

    api_poll_long "$offset" "50"
    response="$API_RESPONSE"
    [ -z "$response" ] && sleep 2 && continue

    printf '%s' "$response" > "$UPDATES_FILE"
    items_count=$(jq -r '.result | length' "$UPDATES_FILE" 2>/dev/null)
    if [ -z "$items_count" ] || [ "$items_count" = "null" ] || [ "$items_count" -eq 0 ]; then
        rm -f "$UPDATES_FILE"; continue
    fi

    i=0
    while [ "$i" -lt "$items_count" ]; do
        update=$(jq -c ".result[$i]" "$UPDATES_FILE" 2>/dev/null)
        i=$((i + 1))
        [ -z "$update" ] && continue

        id=$(printf '%s' "$update" | jq -r '.update_id' 2>/dev/null)
        [ -z "$id" ] && continue
        offset=$((id + 1)); echo "$offset" > "$OFFSET_FILE"

        # Single jq call — fields joined with U+001F (Unit Separator, not shell whitespace).
        # @tsv used \t which is whitespace for read, causing field shift when callback_id empty.
        # Fields: chat_id, chat_type, raw_text, callback_id, u_name, user_id,
        #         is_bot_sender, sender_chat_id, sender_chat_type, sender_chat_title,
        #         CALLBACK_MSG_ID, message_thread_id
        _upd_flat=$(printf '%s' "$update" | jq -r '
            [
                (.message.chat.id // .callback_query.message.chat.id // ""),
                (.message.chat.type // .callback_query.message.chat.type // ""),
                (.message.text // .callback_query.data // ""),
                (.callback_query.id // ""),
                (.message.from.username // .callback_query.from.username // ""),
                (.message.from.id // .callback_query.from.id // ""),
                ((.message.from.is_bot // .callback_query.from.is_bot // false) | tostring),
                (.message.sender_chat.id // .callback_query.message.sender_chat.id // ""),
                (.message.sender_chat.type // .callback_query.message.sender_chat.type // ""),
                (.message.sender_chat.title // .callback_query.message.sender_chat.title // ""),
                (.message.message_id // .callback_query.message.message_id // ""),
                (.message.message_thread_id // .callback_query.message.message_thread_id // "")
            ] | join("\u001f")
        ' 2>/dev/null)
        IFS=$(printf '\037') read -r chat_id chat_type _raw_text callback_id u_name user_id \
            is_bot_sender sender_chat_id sender_chat_type sender_chat_title \
            CALLBACK_MSG_ID message_thread_id <<EOF
$_upd_flat
EOF
        text=$(printf '%s' "$_raw_text")
        [ "$message_thread_id" = "null" ] && message_thread_id=""

        [ -z "$BOT_USERNAME" ] && load_bot_identity >/dev/null 2>&1
        [ -z "$BOT_ID" ]       && load_bot_identity >/dev/null 2>&1

        # Authorization check
        if ! is_allowed_actor "$user_id" "$sender_chat_id" "$is_bot_sender" "$ALLOW_ANON_ADMINS"; then
            if [ "$is_bot_sender" != "true" ] && [ -n "$user_id" ] && [ "$user_id" != "null" ]; then
                now=$(date +%s); count=1
                [ -f "$UNAUTH_FILE" ] && count=$(( $(cut -d'|' -f1 "$UNAUTH_FILE") + 1 ))
                echo "${count}|${now}|${u_name:-Unknown}|${user_id}" > "$UNAUTH_FILE"
                logger -t podkop-bot "[Security] Unauthorized: user=@${u_name:-Unknown} id=${user_id} text=${text}"
                safe_u_name=$(html_escape "${u_name:-Unknown}")
                safe_chat_title=$(html_escape "${sender_chat_title:-none}")
                safe_alert_text=$(html_escape "$text")
                alert_txt=$(cat <<EOF
${E_WARN} <b>Unauthorized Access!</b>
<b>User:</b> @${safe_u_name} (ID: <code>${user_id}</code>)
<b>Chat:</b> ${chat_type} | <b>Title:</b> ${safe_chat_title}
<b>Text:</b> <code>${safe_alert_text}</code>
EOF
)
                alert_payload=$(jq -n -c --arg cid "$ADMIN_ID" --arg txt "$alert_txt" \
                    '{chat_id:$cid,text:$txt,parse_mode:"HTML"}')
                api_request "sendMessage" "$alert_payload" >/dev/null
            fi
            continue
        fi

        [ "$chat_type" = "channel" ] && continue

        if is_private_chat "$chat_type"; then
            :
        elif is_group_chat "$chat_type"; then
            if [ -n "$callback_id" ]; then
                :
            else
                text=$(normalize_group_command "$text" "$BOT_USERNAME")
                if text_mentions_bot "$text" "$BOT_USERNAME"; then
                    text=$(strip_bot_mention "$text" "$BOT_USERNAME")
                    text=$(printf '%s' "$text" | sed 's/^ *//; s/ *$//')
                elif is_reply_to_bot "$update" "$BOT_ID"; then
                    :
                else
                    continue
                fi
                [ -z "$text" ] && continue
            fi
        else
            continue
        fi

        # ── Document handler: bot script upload ─────────────────────────────
        _doc_file_id=$(printf '%s' "$update" | jq -r '.message.document.file_id // empty' 2>/dev/null)
        if [ -n "$_doc_file_id" ] && is_allowed_actor "$user_id" "$sender_chat_id" "$is_bot_sender" "$ALLOW_ANON_ADMINS"; then
            _cur_doc_state=$(head -n1 "$STATE_FILE" 2>/dev/null)
            if [ "$_cur_doc_state" = "wait_bot_script_file" ]; then
                rm -f "$STATE_FILE"
                set_chat_context "$chat_id" "$CALLBACK_MSG_ID" "$chat_type" "$message_thread_id"
                send_message "$(printf '%s Downloading uploaded script...' "$E_TIME")" ""

                _file_resp=$(_curl_via_best_socks 10 \
                    "https://api.telegram.org/bot${TOKEN}/getFile?file_id=${_doc_file_id}" 2>/dev/null)
                _file_path=$(printf '%s' "$_file_resp" | jq -r '.result.file_path // empty' 2>/dev/null)

                if [ -z "$_file_path" ]; then
                    send_message "$(printf '%s Cannot get file info from Telegram.' "$E_ERR")" ""
                    reset_chat_context; continue
                fi

                _bot_tmp="/tmp/podkop_bot_upload.$$"
                _dl_url="https://api.telegram.org/file/bot${TOKEN}/${_file_path}"
                if ! _curl_via_best_socks 60 -o "$_bot_tmp" "$_dl_url" 2>/dev/null; then
                    rm -f "$_bot_tmp"
                    send_message "$(printf '%s File download failed.' "$E_ERR")" ""
                    reset_chat_context; continue
                fi

                if ! head -1 "$_bot_tmp" | grep -q '^#!' || ! grep -q '^BOT_VERSION=' "$_bot_tmp"; then
                    rm -f "$_bot_tmp"
                    send_message "$(printf '%s Invalid file — not a bot script.' "$E_ERR")" ""
                    reset_chat_context; continue
                fi

                if ! busybox ash -n "$_bot_tmp" 2>/dev/null && ! sh -n "$_bot_tmp" 2>/dev/null; then
                    rm -f "$_bot_tmp"
                    send_message "$(printf '%s Syntax errors — aborted. Current bot unchanged.' "$E_WARN")" ""
                    reset_chat_context; continue
                fi

                _upload_ver=$(grep '^BOT_VERSION=' "$_bot_tmp" | cut -d'"' -f2)
                chmod +x "$_bot_tmp"

                _init_path_doc="/etc/init.d/podkop_bot"
                if [ -f "$_init_path_doc" ] && ! grep -q "_kill_all_podkop_bot" "$_init_path_doc" 2>/dev/null; then
                    send_message "$(printf '%s <b>Warning:</b> init.d is outdated. Update via <code>install.sh</code>.' "$E_WARN")" ""
                    sleep 1
                fi

                send_message "$(printf '%s <b>Installing uploaded bot v%s...</b>\nRestarting now.' "$E_RST" "${_upload_ver:-unknown}")" ""
                logger -t podkop-bot "[Upload-update] Installing v${_upload_ver}. Backup at ${BOT_PATH}.bak."

                cp -f "$BOT_PATH" "${BOT_PATH}.bak" 2>/dev/null || true
                mv "$_bot_tmp" "$BOT_PATH"
                cp "$OFFSET_FILE" "/tmp/podkop_bot_offset" 2>/dev/null || true

                kill "$HEALTH_PID" 2>/dev/null
                _self_pid_doc=$$
                for _reap_pid_doc in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
                    [ "$_reap_pid_doc" = "$_self_pid_doc" ] && continue
                    _reap_cmd_doc=$(cat "/proc/${_reap_pid_doc}/cmdline" 2>/dev/null | tr '\0' ' ')
                    case "$_reap_cmd_doc" in
                        *"podkop_bot"*|*"podkop-bot"*)
                            kill -9 "$_reap_pid_doc" 2>/dev/null || true ;;
                    esac
                done
                sleep 1

                if [ -f "/etc/init.d/podkop_bot" ]; then
                    _upd_pid_doc=$$
                    /etc/init.d/podkop_bot restart
                    kill -9 "$_upd_pid_doc" 2>/dev/null || true
                else
                    exec "$BOT_PATH"
                fi
                reset_chat_context; continue
            else
                set_chat_context "$chat_id" "$CALLBACK_MSG_ID" "$chat_type" "$message_thread_id"
                send_message "$(printf '%s Received a file. Use Maintenance → 📤 Upload Bot Script first.' "$E_WARN")" ""
                reset_chat_context; continue
            fi
        fi

        if [ -n "$text" ] && [ "$text" != "null" ]; then
            # Normalize persistent keyboard button presses to commands
            [ -z "$callback_id" ] && text=$(normalize_reply_button "$text")

            now=$(date +%s)
            safe_text=$(echo "$text" | tr '\n' ' ' | tr '|' '_')
            echo "${now}|${u_name:-Unknown}|${safe_text}" > "$LAST_CMD_FILE"

            set_chat_context "$chat_id" "$CALLBACK_MSG_ID" "$chat_type" "$message_thread_id"

            audit_str="user=@${u_name:-Unknown} id=${user_id:-none}"
            [ -n "$sender_chat_id" ] && [ "$sender_chat_id" != "null" ] && \
                audit_str="${audit_str} sender_chat=${sender_chat_id}(${sender_chat_type:-none})"
            logger -t podkop-bot "Audit: ${audit_str} -> ${text}"

            if [ -n "$callback_id" ]; then
                CB_ANSWER_TEXT=""
                handle_command "$text" "$CALLBACK_MSG_ID" "$callback_id"
                # If handler answered the callback early (e.g. Refresh toast),
                # CB_ANSWER_TEXT is set to __ANSWERED__ — skip to avoid double-answer error.
                [ "$CB_ANSWER_TEXT" != "__ANSWERED__" ] && \
                    answer_callback "$callback_id" "$CB_ANSWER_TEXT"
                CB_ANSWER_TEXT=""
            else
                # Plain text: pass empty mid so send_or_edit always sends new message
                # (cannot editMessageText on user's own message, only on bot messages)
                handle_command "$text" "" ""
            fi

            reset_chat_context
        fi
    done

    rm -f "$UPDATES_FILE"
done
