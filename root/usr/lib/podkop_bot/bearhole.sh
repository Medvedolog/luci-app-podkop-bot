#!/bin/sh
# OpenWrt Bearhole control plane for luci-app-podkop-bot.

BH_DIR=/tmp/podkop_bot/bearhole
BH_REGISTRY="$BH_DIR/routes.registry"
BH_ACTIVE="$BH_DIR/routes.conf"
BH_RESULTS="$BH_DIR/system.results"
BH_STATE="$BH_DIR/state"
BH_PID="$BH_DIR/qualify.pid"
BH_LOCK="$BH_DIR/qualify.lock"
BH_LOG="$BH_DIR/bearhole.log"
BH_AUTH="$BH_DIR/hwelp.auth"
BH_BEGIN="# BEGIN PODKOP BEARHOLE"
BH_END="# END PODKOP BEARHOLE"
HWELP=/usr/bin/hwelp-proxy
OWFEED_SUBSCRIBE=https://repo.owfeed.org/subscribe.sh

mkdir -p "$BH_DIR" 2>/dev/null

bh_log(){ logger -t podkop-bearhole "$*" 2>/dev/null || true; printf '%s %s\n' "$(date +%s 2>/dev/null || echo 0)" "$*" >>"$BH_LOG" 2>/dev/null || true; }
bh_json_escape(){ printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n\r\t' '   '; }
bh_json_str(){ printf '"%s"' "$(bh_json_escape "$1")"; }
bh_mask_proxy(){ printf '%s' "$1" | sed -E 's|(://[^:@/]+:)[^@/]*@|\1***@|'; }
bh_section_id(){ _s=$(printf '%s' "$1"|tr '[:upper:]' '[:lower:]'|sed -E 's/[^a-z0-9_]+/_/g;s/^_+//;s/_+$//'); [ -n "$_s" ]||_s=route; printf 'section_%s' "$_s"; }

bh_cfg_get(){ _k=$1; _d=$2; _v=$(uci -q get "podkop_bearhole.main.$_k" 2>/dev/null); [ -n "$_v" ]&&printf '%s' "$_v"||printf '%s' "$_d"; }
bh_cfg_ensure(){ [ -e /etc/config/podkop_bearhole ]||{ mkdir -p /etc/config||return 1; : >/etc/config/podkop_bearhole||return 1; }; uci -q get podkop_bearhole.main >/dev/null 2>&1||uci -q set podkop_bearhole.main=bearhole; }
bh_cfg_set(){ _k=$1; _v=$2; bh_cfg_ensure||return 1; uci -q set "podkop_bearhole.main.$_k=$_v"&&uci -q commit podkop_bearhole; }
bh_port(){ _p=$(bh_cfg_get port 1066); case "$_p" in ''|*[!0-9]*) _p=1066;; esac; [ "$_p" -ge 1024 ] 2>/dev/null&&[ "$_p" -le 65535 ] 2>/dev/null||_p=1066; printf '%s' "$_p"; }
bh_auth_enabled(){ [ "$(bh_cfg_get auth_enabled 0)" = 1 ]; }
bh_auth_user(){ bh_cfg_get auth_user ''; }
bh_auth_pass(){ bh_cfg_get auth_pass ''; }
bh_urlencode(){ printf '%s' "$1" | jq -sRr @uri 2>/dev/null; }
bh_gateway(){ printf 'http://127.0.0.1:%s' "$(bh_port)"; }
bh_gateway_auth(){
    if bh_auth_enabled; then
        _u=$(bh_auth_user); _p=$(bh_auth_pass)
        [ -n "$_u" ] && [ -n "$_p" ] || return 1
        printf 'http://%s:%s@127.0.0.1:%s' "$(bh_urlencode "$_u")" "$(bh_urlencode "$_p")" "$(bh_port)"
    else
        bh_gateway
    fi
}
bh_write_authfile(){
    rm -f "$BH_AUTH" 2>/dev/null || true
    bh_auth_enabled || return 0
    _u=$(bh_auth_user); _p=$(bh_auth_pass)
    [ -n "$_u" ] && [ -n "$_p" ] || return 1
    ( umask 077; printf 'user=%s\npass=%s\n' "$_u" "$_p" > "$BH_AUTH" ) || return 1
    chmod 600 "$BH_AUTH" 2>/dev/null
}
bh_hwelp_ready(){ [ -x "$HWELP" ]&&"$HWELP" --check >/dev/null 2>&1; }
bh_hwelp_version(){ [ -x "$HWELP" ]||return 0; "$HWELP" --version 2>/dev/null|awk '{print $2;exit}'; }

bh_state_write(){ _tmp="$BH_STATE.$$"; { printf 'state=%s\n' "$1"; printf 'reason=%s\n' "$2"; printf 'updated_at=%s\n' "$(date +%s 2>/dev/null||echo 0)"; } >"$_tmp"&&mv "$_tmp" "$BH_STATE"; }
bh_state_get(){ [ -s "$BH_STATE" ]&&sed -n "s/^$1=//p" "$BH_STATE"|head -n1; }

bh_registry(){
    _tmp="$BH_REGISTRY.$$"; : >"$_tmp"
    _ts=$(ubus call podkop_bot transport_state '{}' 2>/dev/null||true)
    _rs=$(ubus call podkop_bot runtime_sections '{}' 2>/dev/null||true)
    if [ -n "$_ts" ]; then
        _t1=$(printf '%s' "$_ts"|jq -r 'if (.tier1.mixed_proxy_enabled == true) then (.tier1.endpoint // "") else "" end' 2>/dev/null)
        [ -n "$_t1" ]&&printf 'tier1|Podkop/Forkop Mixed Proxy|%s|proxy|0\n' "$_t1" >>"$_tmp"
    fi
    if [ -n "$_rs" ]; then
        _primary=$(printf '%s' "$_rs"|jq -r '.primary_section // ""' 2>/dev/null)
        printf '%s' "$_rs"|jq -r --arg p "$_primary" '.sections[]? | select(.name != $p and .enabled_for_runtime == true and (.endpoint // "") != "") | [(.name // "route"), (.endpoint // "")] | @tsv' 2>/dev/null |
        while IFS="	" read -r _name _ep; do [ -n "$_ep" ]||continue; printf '%s|Podkop/Forkop: %s|%s|proxy|0\n' "$(bh_section_id "$_name")" "$_name" "$_ep"; done >>"$_tmp"
    fi
    if [ -n "$_ts" ]; then
        _i=0
        printf '%s' "$_ts"|jq -r '.tier2_fallback_socks[]? // empty' 2>/dev/null |
        while IFS= read -r _fb; do [ -n "$_fb" ]||continue; case "$_fb" in *'#WARP-SCOUT'*) continue;; esac; _i=$((_i+1)); _ep=${_fb%%#*}; [ -n "$_ep" ]&&printf 'tier2_%s|Fallback proxy #%s|%s|proxy|0\n' "$_i" "$_i" "$_ep"; done >>"$_tmp"
        _t3=$(printf '%s' "$_ts"|jq -r '.tier3_custom_proxy // ""' 2>/dev/null); _t3=${_t3%%#*}; [ -n "$_t3" ]&&printf 'tier3|Custom proxy|%s|proxy|0\n' "$_t3" >>"$_tmp"
    fi
    _wr=$(ubus call podkop_bot_warpscout_rescue status '{}' 2>/dev/null||true)
    if [ -n "$_wr" ]&&[ "$(printf '%s' "$_wr"|jq -r '.running // false' 2>/dev/null)" = true ]; then
        _wep=$(printf '%s' "$_wr"|jq -r '.proxy // ""' 2>/dev/null); _wnode=$(ubus call podkop_bot_warpscout status '{"force":""}' 2>/dev/null|jq -r '.active_snapshot.node // ""' 2>/dev/null); [ -n "$_wnode" ]||_wnode=WARP
        [ -n "$_wep" ]&&printf 'warp_rescue|WARP Rescue / %s|%s|proxy|0\n' "$_wnode" "$_wep" >>"$_tmp"
    fi
    _policy=$(printf '%s' "$_ts"|jq -r '.policy // "auto"' 2>/dev/null); [ "$_policy" = socks ]||printf 'direct|Direct|direct://|direct|999\n' >>"$_tmp"
    awk -F'|' 'BEGIN{OFS="|";p=10}!seen[$1]++{if($1=="direct")$5=999;else{$5=p;p+=10}print}' "$_tmp" >"$BH_REGISTRY"&&rm -f "$_tmp"
    chmod 600 "$BH_REGISTRY" 2>/dev/null; [ -s "$BH_REGISTRY" ]
}

bh_write_bootstrap_routes(){ bh_registry||return 1; cp "$BH_REGISTRY" "$BH_ACTIVE"||return 1; chmod 600 "$BH_ACTIVE" 2>/dev/null; }

bh_feed_targets(){
    _tmp="$BH_DIR/feeds.$$"; : >"$_tmp"
    [ -d /etc/apk/repositories.d ]&&grep -hEo 'https?://[^[:space:]#]+' /etc/apk/repositories.d/* 2>/dev/null >>"$_tmp"||true
    for _f in /etc/opkg/distfeeds.conf /etc/opkg/customfeeds.conf /etc/opkg/*.conf; do [ -f "$_f" ]||continue; awk '$1~/^src/&&$3~/^https?:\/\//{u=$3;sub(/[[:space:]]+$/, "", u);print u "/Packages.gz"}' "$_f" 2>/dev/null >>"$_tmp"||true; done
    [ -s "$_tmp" ]||printf '%s\n' 'https://downloads.openwrt.org/' >"$_tmp"; awk '!seen[$0]++' "$_tmp"; rm -f "$_tmp"
}

bh_curl(){ _ep=$1; shift; if [ "$_ep" = direct:// ]; then curl -q -4 -L -fsS --proxy '' --connect-timeout 5 --max-time 18 "$@"; else curl -q -4 -L -fsS --proxy "$_ep" --connect-timeout 5 --max-time 20 "$@"; fi; }
bh_probe_small(){ rm -f "$3" 2>/dev/null; bh_curl "$1" --range 0-2047 -o "$3" "$2" >/dev/null 2>&1; }

bh_probe_route(){
    _id=$1; _label=$2; _ep=$3; _tmp="$BH_DIR/probe.$$.tmp"; _api="$BH_DIR/api.$$.json"; _core=fail; _raw=fail; _ghapi=fail; _codeload=fail; _asset=skip; _feeds=ok
    bh_probe_small "$_ep" 'https://github.com/' "$_tmp"&&_core=ok
    bh_probe_small "$_ep" 'https://raw.githubusercontent.com/Medvedolog/luci-app-podkop-bot/main/version.txt' "$_tmp"&&_raw=ok
    if bh_probe_small "$_ep" 'https://api.github.com/repos/Medvedolog/luci-app-podkop-bot/releases/latest' "$_api"; then _ghapi=ok; _asset_url=$(jq -r '.assets[0].browser_download_url // empty' "$_api" 2>/dev/null); if [ -n "$_asset_url" ]; then _asset=fail; bh_probe_small "$_ep" "$_asset_url" "$_tmp"&&_asset=ok; fi; fi
    bh_probe_small "$_ep" 'https://codeload.github.com/Medvedolog/luci-app-podkop-bot/tar.gz/refs/heads/main' "$_tmp"&&_codeload=ok
    for _feed in $(bh_feed_targets); do bh_probe_small "$_ep" "$_feed" "$_tmp"||{ _feeds=fail; break; }; done
    rm -f "$_tmp" "$_api" 2>/dev/null; _status=FAIL
    if [ "$_core" = ok ]&&[ "$_raw" = ok ]&&[ "$_ghapi" = ok ]&&[ "$_codeload" = ok ]&&[ "$_feeds" = ok ]&&{ [ "$_asset" = ok ]||[ "$_asset" = skip ]; }; then _status=VALID; elif [ "$_core" = ok ]||[ "$_raw" = ok ]||[ "$_feeds" = ok ]; then _status=DEGRADED; fi
    printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n' "$_id" "$_label" "$_ep" "$_core" "$_raw" "$_ghapi" "$_codeload" "$_asset" "$_feeds" "$_status" "$(date +%s 2>/dev/null||echo 0)"
}

bh_select_valid_routes(){
    [ -s "$BH_REGISTRY" ]||bh_registry||return 1; [ -s "$BH_RESULTS" ]||{ bh_write_bootstrap_routes; return $?; }; _cur=$(cut -d'|' -f1 "$BH_DIR/current" 2>/dev/null); _tmp="$BH_ACTIVE.$$"; : >"$_tmp"
    [ -n "$_cur" ]&&awk -F'|' -v id="$_cur" 'NR==FNR{if($1==id&&$10=="VALID")ok=1;next}ok&&$1==id{print;exit}' "$BH_RESULTS" "$BH_REGISTRY" >>"$_tmp"
    awk -F'|' 'NR==FNR{if($10=="VALID")v[$1]=1;next}v[$1]{print}' "$BH_RESULTS" "$BH_REGISTRY"|awk -F'|' -v cur="$_cur" '$1!=cur' >>"$_tmp"
    if [ ! -s "$_tmp" ]; then : >"$BH_ACTIVE"; rm -f "$_tmp"; bh_state_write degraded no_system_valid_route; return 1; fi
    mv "$_tmp" "$BH_ACTIVE"; chmod 600 "$BH_ACTIVE" 2>/dev/null; bh_state_write ready system_valid_routes
}

bh_qualify(){
    mkdir "$BH_LOCK" 2>/dev/null||return 1; printf '%s\n' "$$" >"$BH_PID"; trap 'rm -rf "$BH_LOCK" "$BH_PID" 2>/dev/null' EXIT INT TERM HUP; bh_state_write probing system_qualification; bh_registry||{ bh_state_write degraded no_routes; return 1; }; _tmp="$BH_RESULTS.$$"; : >"$_tmp"
    while IFS='|' read -r _id _label _ep _type _prio; do [ -n "$_id" ]||continue; bh_log "event=bearhole_probe_start route=$_id"; _line=$(bh_probe_route "$_id" "$_label" "$_ep"); printf '%s\n' "$_line" >>"$_tmp"; _res=$(printf '%s' "$_line"|awk -F'|' '{print $10}'); bh_log "event=bearhole_probe route=$_id profile=system result=$(printf '%s' "$_res"|tr '[:upper:]' '[:lower:]')"; done <"$BH_REGISTRY"
    mv "$_tmp" "$BH_RESULTS"; chmod 600 "$BH_RESULTS" 2>/dev/null; bh_select_valid_routes||true
}
bh_qualify_start(){ [ -d "$BH_LOCK" ]&&return 2; ( "$0" qualify >/dev/null 2>&1 ) & }

bh_bootstrap_http_candidates(){
    bh_registry||return 1
    while IFS='|' read -r _id _label _ep _type _prio; do
        case "$_ep" in
            direct://) printf 'direct://\n';;
            http://*) printf '%s\n' "$_ep";;
            socks5://*|socks5h://*) case "$_id" in tier1|section_*) printf 'http://%s\n' "${_ep#*://}";; esac;;
        esac
    done <"$BH_REGISTRY" | awk '!seen[$0]++'
}

bh_pkg_run(){ _proxy=$1; shift; if [ "$_proxy" = direct:// ]; then (unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY; "$@"); else (export http_proxy="$_proxy" https_proxy="$_proxy" HTTP_PROXY="$_proxy" HTTPS_PROXY="$_proxy"; "$@"); fi; }

bh_owfeed_subscribed(){ grep -qs 'repo\.owfeed\.org' /etc/opkg/*.conf /etc/opkg/*feeds.conf 2>/dev/null&&return 0; grep -Rqs 'repo\.owfeed\.org' /etc/apk/repositories /etc/apk/repositories.d 2>/dev/null&&return 0; return 1; }

bh_install_hwelp(){
    bh_hwelp_ready&&return 0
    bh_state_write starting installing_hwelp; bh_log 'event=hwelp_install stage=begin source=owfeed'; _sub="$BH_DIR/owfeed-subscribe.sh"; _opkg_tmp=/etc/opkg/99-hwelp-bootstrap.conf
    for _proxy in $(bh_bootstrap_http_candidates); do
        rm -f "$_sub" "$_opkg_tmp" 2>/dev/null
        bh_curl "$_proxy" -o "$_sub" "$OWFEED_SUBSCRIBE" >/dev/null 2>&1||continue
        if ! bh_owfeed_subscribed; then bh_pkg_run "$_proxy" sh "$_sub" >/dev/null 2>&1||continue; fi
        if command -v apk >/dev/null 2>&1; then
            bh_pkg_run "$_proxy" apk update >/dev/null 2>&1||continue
            bh_pkg_run "$_proxy" apk add hwelp-proxy >/dev/null 2>&1||continue
        elif command -v opkg >/dev/null 2>&1; then
            if [ "$_proxy" != direct:// ]; then mkdir -p /etc/opkg; { printf 'option http_proxy %s\n' "$_proxy"; printf 'option https_proxy %s\n' "$_proxy"; } >"$_opkg_tmp"; fi
            bh_pkg_run "$_proxy" opkg update >/dev/null 2>&1||{ rm -f "$_opkg_tmp"; continue; }
            bh_pkg_run "$_proxy" opkg install hwelp-proxy >/dev/null 2>&1||{ rm -f "$_opkg_tmp"; continue; }
            rm -f "$_opkg_tmp"
        else rm -f "$_sub"; bh_state_write failed package_manager_missing; return 1; fi
        rm -f "$_sub" "$_opkg_tmp" 2>/dev/null
        if bh_hwelp_ready; then bh_log "event=hwelp_install result=ok version=$(bh_hwelp_version)"; return 0; fi
    done
    rm -f "$_sub" "$_opkg_tmp" 2>/dev/null; bh_log 'event=hwelp_install result=fail'; bh_state_write failed hwelp_install_failed; return 1
}

bh_strip_block(){ _file=$1; [ -f "$_file" ]||return 0; _tmp="$_file.bearhole.$$"; awk -v b="$BH_BEGIN" -v e="$BH_END" '$0==b{skip=1;next}$0==e{skip=0;next}!skip{print}' "$_file" >"$_tmp"&&mv "$_tmp" "$_file"; }
bh_append_block(){ _file=$1; shift; mkdir -p "$(dirname "$_file")" 2>/dev/null; [ -f "$_file" ]||: >"$_file"; bh_strip_block "$_file"; { printf '%s\n' "$BH_BEGIN"; for _line in "$@"; do printf '%s\n' "$_line"; done; printf '%s\n' "$BH_END"; } >>"$_file"; }

bh_system_on(){
    _gw=$(bh_gateway_auth) || return 1
    mkdir -p /etc/profile.d /root 2>/dev/null
    cat >/etc/profile.d/99-podkop-bearhole.sh <<EOF2
# Managed by luci-app-podkop-bot OpenWrt Bearhole.
export http_proxy=$_gw
export https_proxy=$_gw
export HTTP_PROXY=$_gw
export HTTPS_PROXY=$_gw
export no_proxy=127.0.0.1,localhost,::1
export NO_PROXY=127.0.0.1,localhost,::1
EOF2
    chmod 0644 /etc/profile.d/99-podkop-bearhole.sh 2>/dev/null
    bh_append_block /etc/environment "http_proxy=$_gw" "https_proxy=$_gw" "HTTP_PROXY=$_gw" "HTTPS_PROXY=$_gw" "no_proxy=127.0.0.1,localhost,::1" "NO_PROXY=127.0.0.1,localhost,::1"
    bh_append_block /root/.curlrc "proxy = \"$_gw\"" 'noproxy = "127.0.0.1,localhost,::1"'
    bh_append_block /root/.wgetrc 'use_proxy = on' "http_proxy = $_gw" "https_proxy = $_gw" 'no_proxy = 127.0.0.1,localhost,::1'
    [ -d /etc/opkg ]&&cat >/etc/opkg/99-podkop-bearhole.conf <<EOF2
option http_proxy $_gw
option https_proxy $_gw
option no_proxy 127.0.0.1,localhost,::1
EOF2
    bh_log "event=bearhole_enable gateway=127.0.0.1:$(bh_port) auth=$([ "$(bh_cfg_get auth_enabled 0)" = 1 ] && echo on || echo off)"
}

bh_system_off(){ rm -f /etc/profile.d/99-podkop-bearhole.sh /etc/opkg/99-podkop-bearhole.conf /etc/opkg/99-hwelp-bootstrap.conf 2>/dev/null; bh_strip_block /etc/environment; bh_strip_block /root/.curlrc; bh_strip_block /root/.wgetrc; bh_log 'event=bearhole_disable'; }

bh_status(){
    _en=$(bh_cfg_get enabled 0); [ "$_en" = 1 ]&&_enj=true||_enj=false; _state=$(bh_state_get state); [ -n "$_state" ]||_state=idle; _reason=$(bh_state_get reason); _upd=$(bh_state_get updated_at); [ -n "$_upd" ]||_upd=0
    _pid=$(ubus call service list '{"name":"podkop-bearhole"}' 2>/dev/null|jq -r '.["podkop-bearhole"].instances[]?.pid // 0' 2>/dev/null|head -n1); case "$_pid" in ''|*[!0-9]*) _pid=0;; esac; _running=false; [ "$_pid" -gt 0 ] 2>/dev/null&&kill -0 "$_pid" 2>/dev/null&&_running=true
    _rss=0; if [ "$_running" = true ]; then _r=$(awk '/VmRSS/{print int($2/1024)}' "/proc/$_pid/status" 2>/dev/null); case "$_r" in ''|*[!0-9]*) _r=0;; esac; _rss=$_r; fi
    _cur_id=$(cut -d'|' -f1 "$BH_DIR/current" 2>/dev/null); _cur_label=$(cut -d'|' -f2- "$BH_DIR/current" 2>/dev/null); _valid=$(awk -F'|' '$10=="VALID"{n++}END{print n+0}' "$BH_RESULTS" 2>/dev/null); _degraded=$(awk -F'|' '$10=="DEGRADED"{n++}END{print n+0}' "$BH_RESULTS" 2>/dev/null)
    _system=false; [ -f /etc/profile.d/99-podkop-bearhole.sh ]&&_system=true; _installed=false; [ -x "$HWELP" ]&&_installed=true; _ver=$(bh_hwelp_version); _port=$(bh_port); _gw=$(bh_gateway)
    _env_hook=false; grep -qsF "$BH_BEGIN" /etc/environment 2>/dev/null && _env_hook=true
    _curl_hook=false; grep -qsF "$BH_BEGIN" /root/.curlrc 2>/dev/null && _curl_hook=true
    _wget_hook=false; grep -qsF "$BH_BEGIN" /root/.wgetrc 2>/dev/null && _wget_hook=true
    _opkg_hook=false; [ -f /etc/opkg/99-podkop-bearhole.conf ] && _opkg_hook=true
    _pkg=none; command -v apk >/dev/null 2>&1 && _pkg=apk; command -v opkg >/dev/null 2>&1 && _pkg=opkg
    _auth=false; [ "$(bh_cfg_get auth_enabled 0)" = 1 ]&&_auth=true; _auth_user=$(bh_auth_user); _auth_configured=false; [ -n "$_auth_user" ]&&[ -n "$(bh_auth_pass)" ]&&_auth_configured=true
    printf '{"ok":true,"enabled":%s,"running":%s,"state":%s,"reason":%s,"updated_at":%s,"gateway":%s,"port":%s,"route_id":%s,"route_label":%s,"system_applied":%s,"env_hook":%s,"curl_hook":%s,"wget_hook":%s,"opkg_hook":%s,"package_manager":%s,"valid_routes":%s,"degraded_routes":%s,"probing":%s,"pid":%s,"hwelp_rss_mb":%s,"hwelp_installed":%s,"hwelp_version":%s,"auth_enabled":%s,"auth_user":%s,"auth_configured":%s}\n' "$_enj" "$_running" "$(bh_json_str "$_state")" "$(bh_json_str "$_reason")" "$_upd" "$(bh_json_str "$_gw")" "$_port" "$(bh_json_str "$_cur_id")" "$(bh_json_str "$_cur_label")" "$_system" "$_env_hook" "$_curl_hook" "$_wget_hook" "$_opkg_hook" "$(bh_json_str "$_pkg")" "${_valid:-0}" "${_degraded:-0}" "$([ -d "$BH_LOCK" ]&&echo true||echo false)" "$_pid" "$_rss" "$_installed" "$(bh_json_str "$_ver")" "$_auth" "$(bh_json_str "$_auth_user")" "$_auth_configured"
}

bh_results_json(){ printf '{"ok":true,"items":['; _first=1; while IFS='|' read -r _id _label _ep _core _raw _api _codeload _asset _feeds _status _checked; do [ -n "$_id" ]||continue; [ "$_first" = 1 ]&&_first=0||printf ','; printf '{"id":%s,"label":%s,"endpoint":%s,"github_core":"%s","github_raw":"%s","github_api":"%s","github_codeload":"%s","github_assets":"%s","openwrt_feeds":"%s","status":"%s","checked_at":%s}' "$(bh_json_str "$_id")" "$(bh_json_str "$_label")" "$(bh_json_str "$(bh_mask_proxy "$_ep")")" "$_core" "$_raw" "$_api" "$_codeload" "$_asset" "$_feeds" "$_status" "${_checked:-0}"; done <"$BH_RESULTS" 2>/dev/null; printf ']}\n'; }

bh_disable(){ bh_cfg_set enabled 0||return 1; /etc/init.d/podkop-bearhole stop >/dev/null 2>&1||true; /etc/init.d/podkop-bearhole disable >/dev/null 2>&1||true; bh_system_off; rm -f "$BH_AUTH" 2>/dev/null || true; bh_state_write disabled user; }

case "${1:-}" in
 registry) bh_registry;; bootstrap) bh_write_bootstrap_routes;; qualify) bh_qualify;; qualify-start) bh_qualify_start;; select) bh_select_valid_routes;; install-hwelp) bh_install_hwelp;; system-on) bh_system_on;; system-off) bh_system_off;; proxy-url) bh_gateway_auth;; status) bh_status;; results) bh_results_json;; disable) bh_disable;;
 *) echo "usage: $0 {registry|bootstrap|qualify|qualify-start|select|install-hwelp|system-on|system-off|proxy-url|status|results|disable}" >&2; exit 2;;
esac
