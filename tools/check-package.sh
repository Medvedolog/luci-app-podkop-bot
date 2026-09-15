#!/bin/sh
# Package-specific assertions against the built IPK. APK and IPK are produced
# from the same staged tree; owfeed itself validates both container formats.
set -eu
cd "$(dirname "$0")/.."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/control" "$work/data"

ipk=$(find dist/all -maxdepth 1 -type f -name 'luci-app-podkop-bot_*.ipk' | head -n1)
[ -n "$ipk" ] || { echo "IPK artifact not found" >&2; exit 1; }

tar xzf "$ipk" -C "$work"
tar xzf "$work/control.tar.gz" -C "$work/control"
tar xzf "$work/data.tar.gz" -C "$work/data"

echo "--- control ---"
cat "$work/control/control"

for f in \
    ./usr/libexec/rpcd/podkop_bot \
    ./usr/libexec/rpcd/podkop_bot_bearhole \
    ./usr/lib/podkop_bot/install.sh \
    ./usr/lib/podkop_bot/podkop_bot \
    ./usr/lib/podkop_bot/podkop_bot_init \
    ./usr/lib/podkop_bot/bearhole.sh \
    ./usr/lib/podkop_bot/warpscout-rescue-watchdog \
    ./usr/lib/podkop_bot/vendor.sha256 \
    ./etc/init.d/podkop-bearhole \
    ./etc/init.d/podkop-warp-rescue \
    ./usr/share/luci/menu.d/luci-app-podkop-bot.json \
    ./usr/share/rpcd/acl.d/luci-app-podkop-bot.json \
    ./www/luci-static/resources/view/podkop-bot/overview.js \
    ./www/luci-static/resources/view/podkop-bot/bearhole.js \
    ./www/luci-static/resources/css/podkop-bot/podkop-bot.css
do
    [ -f "$work/data/$f" ] || { echo "missing from package: $f" >&2; exit 1; }
done

for f in \
    ./usr/libexec/rpcd/podkop_bot \
    ./usr/libexec/rpcd/podkop_bot_bearhole \
    ./usr/lib/podkop_bot/install.sh \
    ./usr/lib/podkop_bot/podkop_bot \
    ./usr/lib/podkop_bot/podkop_bot_init \
    ./usr/lib/podkop_bot/bearhole.sh \
    ./usr/lib/podkop_bot/warpscout-rescue-watchdog \
    ./etc/init.d/podkop-bearhole \
    ./etc/init.d/podkop-warp-rescue
do
    [ -x "$work/data/$f" ] || { echo "payload is not executable: $f" >&2; exit 1; }
done

# Native HWELP is a separate architecture-specific package. Neither the new
# binary nor the retired ucode helper belongs in this noarch management package.
[ ! -e "$work/data/usr/bin/hwelp-proxy" ] || { echo "native hwelp-proxy leaked into noarch LuCI package" >&2; exit 1; }
[ ! -e "$work/data/usr/bin/podkop-bearhole-proxy" ] || { echo "legacy ucode Bearhole helper still packaged" >&2; exit 1; }

# This LuCI package deliberately does not own the bot's persistent UCI config.
[ ! -e "$work/data/etc/config/podkop_bot" ] || {
    echo "unexpected conffile: /etc/config/podkop_bot" >&2; exit 1;
}

[ ! -e "$work/data/etc/config/podkop_bearhole" ] || {
    echo "Bearhole config must be user-owned, not packaged" >&2; exit 1;
}
if [ -f "$work/control/conffiles" ] && grep -qx '/etc/config/podkop_bearhole' "$work/control/conffiles"; then
    echo "Bearhole config unexpectedly declared as package conffile" >&2; exit 1
fi

# Bootstrap contract: hwelp-proxy must NOT be a hard dependency. Bearhole can
# fetch the native package on first launch, while LuCI remains repairable even
# when feeds are inaccessible.
deps=$(sed -n 's/^Depends:[[:space:]]*//p' "$work/control/control" | tr ',' '\n' | sed 's/[[:space:]]//g;s/[[:space:](].*$//' | sed '/^$/d' | sort -u)
expected=$(printf '%s\n' libc luci-base jq curl | sort -u)
[ "$deps" = "$expected" ] || {
    echo "dependency mismatch" >&2
    echo "expected:" >&2; printf '%s\n' "$expected" >&2
    echo "actual:" >&2; printf '%s\n' "$deps" >&2
    exit 1
}
for forbidden in hwelp-proxy ucode-mod-socket ucode-mod-struct ucode-mod-uloop; do
    printf '%s\n' "$deps" | grep -qx "$forbidden" && {
        echo "bootstrap: forbidden hard dependency: $forbidden" >&2; exit 1;
    }
done

[ -x "$work/control/preinst" ] || { echo "preinst missing/not executable" >&2; exit 1; }
[ -x "$work/control/postinst" ] || { echo "postinst missing/not executable" >&2; exit 1; }
[ -x "$work/control/postrm" ] || { echo "postrm missing/not executable" >&2; exit 1; }

(cd "$work/data/usr/lib/podkop_bot" && sha256sum -c vendor.sha256)

echo "package contents OK"
