#!/bin/sh

. /usr/lib/podkop_bot/tsnet-provider.sh

log() { logger -t podkop-bot-tsnet "$*"; }

singbox_running() {
    if [ -x /etc/init.d/sing-box ]; then
        /etc/init.d/sing-box running >/dev/null 2>&1 && return 0
    fi
    pidof sing-box >/dev/null 2>&1
}

provider_busy() {
    case "$(tsnet_provider)" in
        forkop-x)
            [ -d /var/run/forkop.reload.lock ] && return 0
            ;;
        podkop)
            for _c in /proc/[0-9]*/cmdline; do
                [ -r "$_c" ] || continue
                _cl=$(tr '\0' ' ' <"$_c" 2>/dev/null) || continue
                case "$_cl" in
                    *'/usr/bin/podkop '*|*'/usr/bin/podkop') return 0 ;;
                esac
            done
            ;;
    esac
    return 1
}

render_endpoint() {
    _host=$(tsnet_state_get hostname)
    _url=$(tsnet_state_get control_url)
    _key=$(tsnet_state_get auth_key)
    _adv=$(tsnet_state_get advertise_exit_node)
    _accept=$(tsnet_state_get accept_routes)
    [ "$_adv" = true ] || _adv=false
    [ "$_accept" = true ] || _accept=false
    _state=$(tsnet_state_get state_directory)
    [ -n "$_state" ] || _state="$TSNET_IDENTITY_DIR"

    jq -cn \
        --arg tag "$TSNET_ENDPOINT_TAG" \
        --arg hostname "$_host" \
        --arg control_url "$_url" \
        --arg auth_key "$_key" \
        --arg state_directory "$_state" \
        --argjson advertise_exit_node "$_adv" \
        --argjson accept_routes "$_accept" \
        '{type:"tailscale",tag:$tag,state_directory:$state_directory,accept_routes:$accept_routes}
         + (if $hostname != "" then {hostname:$hostname} else {} end)
         + (if $control_url != "" then {control_url:$control_url} else {} end)
         + (if $auth_key != "" then {auth_key:$auth_key} else {} end)
         + (if $advertise_exit_node then {advertise_exit_node:true} else {} end)'
}

apply_runtime() {
    provider_busy && return 3
    _cfg=$(tsnet_config_path)
    [ -r "$_cfg" ] || return 2
    jq -e . "$_cfg" >/dev/null 2>&1 || return 2

    _endpoint=$(render_endpoint) || return 1
    _dir=${_cfg%/*}; [ "$_dir" = "$_cfg" ] && _dir=.
    _tmp="$_dir/.podkop-bot-tsnet.$$"
    _bak="$_dir/.podkop-bot-tsnet.bak.$$"

    if [ "$(tsnet_state_get enabled)" = true ]; then
        jq --arg tag "$TSNET_ENDPOINT_TAG" --argjson ep "$_endpoint" \
            '.endpoints = (((.endpoints // []) | map(select(.tag != $tag))) + [$ep])' \
            "$_cfg" >"$_tmp" || { rm -f "$_tmp"; return 1; }
    else
        jq --arg tag "$TSNET_ENDPOINT_TAG" \
            'if has("endpoints") then .endpoints |= map(select(.tag != $tag)) else . end' \
            "$_cfg" >"$_tmp" || { rm -f "$_tmp"; return 1; }
    fi

    jq -e . "$_tmp" >/dev/null 2>&1 || { rm -f "$_tmp"; return 1; }
    cmp -s "$_cfg" "$_tmp" && { rm -f "$_tmp"; return 0; }
    provider_busy && { rm -f "$_tmp"; return 3; }

    cp -p "$_cfg" "$_bak" 2>/dev/null || { rm -f "$_tmp" "$_bak"; return 1; }
    chmod --reference="$_cfg" "$_tmp" 2>/dev/null || chmod 600 "$_tmp" 2>/dev/null || true
    chown --reference="$_cfg" "$_tmp" 2>/dev/null || true
    mv -f "$_tmp" "$_cfg" || { rm -f "$_tmp" "$_bak"; return 1; }

    if singbox_running; then
        if /etc/init.d/sing-box restart >/dev/null 2>&1; then
            rm -f "$_bak"
            log "event=runtime_apply restart=ok provider=$(tsnet_provider) enabled=$(tsnet_state_get enabled)"
            return 0
        fi
        mv -f "$_bak" "$_cfg" >/dev/null 2>&1 || true
        /etc/init.d/sing-box restart >/dev/null 2>&1 || true
        log "event=runtime_apply rollback=restart_failed provider=$(tsnet_provider)"
        return 1
    fi

    rm -f "$_bak"
    log "event=runtime_apply restart=not_needed provider=$(tsnet_provider) enabled=$(tsnet_state_get enabled)"
    return 0
}

apply_runtime
