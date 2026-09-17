#!/bin/sh

TSNET_STATE_DIR="/etc/podkop-bot"
TSNET_STATE_FILE="$TSNET_STATE_DIR/tsnet.json"
TSNET_RUNTIME_DIR="/tmp/podkop-bot-tsnet"
TSNET_CAP_CACHE="$TSNET_RUNTIME_DIR/capability"
TSNET_ENDPOINT_TAG="podkop-bot-tailscale"
TSNET_IDENTITY_DIR="$TSNET_STATE_DIR/tailscale-state"

mkdir -p "$TSNET_RUNTIME_DIR" 2>/dev/null || true

_ts_pkg_installed() {
    _p="$1"
    if command -v apk >/dev/null 2>&1; then
        apk info -e "$_p" >/dev/null 2>&1 && return 0
    fi
    if command -v opkg >/dev/null 2>&1; then
        opkg status "$_p" 2>/dev/null | grep -q '^Status: .* installed$' && return 0
    fi
    return 1
}

tsnet_provider() {
    if [ -f /etc/config/forkop ]; then
        # Upstream/full Forkop ships the native server generator here.
        if [ -r /usr/lib/singbox/servers.uc ]; then
            printf '%s\n' forkop-native
        else
            printf '%s\n' forkop-x
        fi
        return 0
    fi
    if [ -f /etc/config/podkop ]; then
        printf '%s\n' podkop
        return 0
    fi
    printf '%s\n' none
}

tsnet_config_path() {
    _provider=$(tsnet_provider)

    # Prefer the actual sing-box service conffile when a package exposes it.
    _p=$(uci -q get sing-box.main.conffile 2>/dev/null)
    if [ -n "$_p" ]; then
        printf '%s\n' "$_p"
        return 0
    fi

    case "$_provider" in
        podkop)
            _p=$(uci -q get podkop.settings.config_path 2>/dev/null)
            [ -n "$_p" ] || _p=/etc/sing-box/config.json
            ;;
        forkop-x)
            _p=$(uci -q get forkop.settings.config_path 2>/dev/null)
            if [ -z "$_p" ]; then
                if [ -f /tmp/sing-box/config.json ]; then
                    _p=/tmp/sing-box/config.json
                else
                    _p=/etc/sing-box/config.json
                fi
            fi
            ;;
        *)
            _p=/etc/sing-box/config.json
            ;;
    esac
    printf '%s\n' "$_p"
}

tsnet_capable() {
    command -v sing-box >/dev/null 2>&1 || return 1

    # Capability probing must never execute sing-box. On 256 MB routers a second
    # Go process can create enough RSS pressure to stall or OOM the already-running
    # dataplane. Package/variant markers are authoritative when available; for an
    # ordinary package we stream-scan the binary for the build tag and cache it.
    _ts_pkg_installed sing-box-tiny && return 1
    _ts_pkg_installed sing-box-extended && return 0

    if [ -r /etc/forkop/sing-box-variant ]; then
        grep -qiE 'extended|with_tailscale|tailscale' /etc/forkop/sing-box-variant 2>/dev/null && return 0
        grep -qi 'tiny' /etc/forkop/sing-box-variant 2>/dev/null && return 1
    fi

    _bin=$(command -v sing-box)
    _key=$(stat -c '%i:%Y:%s' "$_bin" 2>/dev/null)
    [ -n "$_key" ] || _key=$(ls -ln "$_bin" 2>/dev/null | awk '{print $5":"$6":"$7":"$8}')

    if [ -r "$TSNET_CAP_CACHE" ]; then
        IFS=' ' read -r _cached_key _cached_value < "$TSNET_CAP_CACHE"
        if [ "$_cached_key" = "$_key" ]; then
            [ "$_cached_value" = 1 ]
            return
        fi
    fi

    # BusyBox grep reads the executable as a stream; it does not map/start the
    # sing-box runtime. `with_tailscale` is embedded in builds that advertise the
    # corresponding sing-box build tag. Unknown builds fail closed.
    if LC_ALL=C grep -aFq 'with_tailscale' "$_bin" 2>/dev/null; then
        printf '%s 1\n' "$_key" > "$TSNET_CAP_CACHE"
        return 0
    fi
    printf '%s 0\n' "$_key" > "$TSNET_CAP_CACHE"
    return 1
}

tsnet_version_hint() {
    # Never spawn sing-box just to paint a status page.
    [ -r /etc/forkop/sing-box-version ] && { head -n 1 /etc/forkop/sing-box-version; return 0; }
    if command -v apk >/dev/null 2>&1; then
        apk info -v sing-box 2>/dev/null | head -n 1
        return 0
    fi
    if command -v opkg >/dev/null 2>&1; then
        opkg status sing-box 2>/dev/null | sed -n 's/^Version: /sing-box /p' | head -n 1
    fi
}

tsnet_state_get() {
    _key="$1"
    [ -r "$TSNET_STATE_FILE" ] || return 1
    jq -r --arg k "$_key" '.[$k] // empty' "$TSNET_STATE_FILE" 2>/dev/null
}

tsnet_state_write() {
    _enabled="$1"; _host="$2"; _url="$3"; _key="$4"; _adv="$5"; _accept="${6:-false}"
    mkdir -p "$TSNET_STATE_DIR" "$TSNET_IDENTITY_DIR" || return 1
    umask 077
    _tmp="$TSNET_STATE_FILE.$$"
    jq -cn \
        --arg provider "$(tsnet_provider)" \
        --argjson enabled "$_enabled" \
        --arg hostname "$_host" \
        --arg control_url "$_url" \
        --arg auth_key "$_key" \
        --argjson advertise_exit_node "$_adv" \
        --argjson accept_routes "$_accept" \
        --arg tag "$TSNET_ENDPOINT_TAG" \
        --arg state_directory "$TSNET_IDENTITY_DIR" \
        '{provider:$provider,enabled:$enabled,hostname:$hostname,control_url:$control_url,auth_key:$auth_key,accept_routes:$accept_routes,advertise_exit_node:$advertise_exit_node,tag:$tag,state_directory:$state_directory}' > "$_tmp" || { rm -f "$_tmp"; return 1; }
    chmod 600 "$_tmp" 2>/dev/null || true
    mv -f "$_tmp" "$TSNET_STATE_FILE"
}

tsnet_state_set_enabled() {
    _enabled="$1"
    [ -r "$TSNET_STATE_FILE" ] || return 1
    umask 077
    _tmp="$TSNET_STATE_FILE.$$"
    jq --argjson enabled "$_enabled" '.enabled=$enabled' "$TSNET_STATE_FILE" > "$_tmp" || { rm -f "$_tmp"; return 1; }
    chmod 600 "$_tmp" 2>/dev/null || true
    mv -f "$_tmp" "$TSNET_STATE_FILE"
}
