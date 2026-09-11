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
    ./usr/lib/podkop_bot/install.sh \
    ./usr/lib/podkop_bot/podkop_bot \
    ./usr/lib/podkop_bot/podkop_bot_init \
    ./usr/lib/podkop_bot/vendor.sha256 \
    ./usr/share/luci/menu.d/luci-app-podkop-bot.json \
    ./usr/share/rpcd/acl.d/luci-app-podkop-bot.json \
    ./www/luci-static/resources/view/podkop-bot/overview.js \
    ./www/luci-static/resources/css/podkop-bot/podkop-bot.css
do
    [ -f "$work/data/$f" ] || { echo "missing from package: $f" >&2; exit 1; }
done

for f in \
    ./usr/libexec/rpcd/podkop_bot \
    ./usr/lib/podkop_bot/install.sh \
    ./usr/lib/podkop_bot/podkop_bot \
    ./usr/lib/podkop_bot/podkop_bot_init
do
    [ -x "$work/data/$f" ] || { echo "payload is not executable: $f" >&2; exit 1; }
done

# This LuCI package deliberately does not own the bot's persistent UCI config.
[ ! -e "$work/data/etc/config/podkop_bot" ] || {
    echo "unexpected conffile: /etc/config/podkop_bot" >&2; exit 1;
}

# Dependency set must not drift silently. Ignore package-manager decoration and
# compare the four names rather than relying on field ordering.
deps=$(sed -n 's/^Depends:[[:space:]]*//p' "$work/control/control" | tr ',' '\n' | sed 's/[[:space:]]//g;s/[[:space:](].*$//' | sed '/^$/d' | sort -u)
expected=$(printf '%s\n' libc luci-base jq curl | sort -u)
[ "$deps" = "$expected" ] || {
    echo "dependency mismatch" >&2
    echo "expected:" >&2; printf '%s\n' "$expected" >&2
    echo "actual:" >&2; printf '%s\n' "$deps" >&2
    exit 1
}

[ -x "$work/control/postinst" ] || { echo "postinst missing/not executable" >&2; exit 1; }
# post-deinstall maps to postrm for the IPK leg when supported by the builder.
[ -x "$work/control/postrm" ] || { echo "postrm missing/not executable" >&2; exit 1; }

# Vendor checksum must validate inside the actual package payload.
(cd "$work/data/usr/lib/podkop_bot" && sha256sum -c vendor.sha256)

echo "package contents OK"
