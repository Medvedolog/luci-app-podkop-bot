#!/bin/sh
# Stage luci-app-podkop-bot as the router filesystem consumed by owfeed/mkpkg.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/dist}"

if [ "$#" -gt 0 ]; then
    VERSION="$1"
elif [ "${GITHUB_REF_TYPE:-}" = "tag" ] && [ -n "${GITHUB_REF_NAME:-}" ]; then
    VERSION="$GITHUB_REF_NAME"
else
    VERSION="$(cat "$ROOT/version.txt" 2>/dev/null || echo 0.0.0)"
fi
VERSION="${VERSION#v}"

MAKE_RELEASE="$(sed -n 's/^PKG_RELEASE:=//p' "$ROOT/Makefile" | head -n1)"
case "$MAKE_RELEASE" in ''|*[!0-9]*) MAKE_RELEASE=1;; esac

case "$VERSION" in
    *-r[0-9]*) PKG_VERSION="$VERSION"; BASE_VERSION="${VERSION%-r*}" ;;
    *-[0-9]*)  BASE_VERSION="${VERSION%-*}"; PKG_VERSION="${BASE_VERSION}-r${VERSION##*-}" ;;
    *)         BASE_VERSION="$VERSION"; PKG_VERSION="${VERSION}-r${MAKE_RELEASE}" ;;
esac

TXT_VERSION="$(cat "$ROOT/version.txt" 2>/dev/null || true)"
MAKE_VERSION="$(sed -n 's/^PKG_VERSION:=//p' "$ROOT/Makefile" | head -n1)"
for pair in "version.txt:$TXT_VERSION" "Makefile:$MAKE_VERSION"; do
    name=${pair%%:*}; value=${pair#*:}
    if [ -z "$value" ] || [ "$value" != "$BASE_VERSION" ]; then
        echo "version mismatch: release=$BASE_VERSION, $name=${value:-missing}" >&2
        exit 1
    fi
done

rm -rf "$OUT/root" "$OUT/scripts"
mkdir -p "$OUT/root" "$OUT/scripts"
printf '%s\n' "$PKG_VERSION" > "$OUT/VERSION"
cp -a "$ROOT/root/." "$OUT/root/"

# Native hwelp-proxy is an independent architecture-specific package.
rm -f "$OUT/root/usr/bin/podkop-bearhole-proxy"

RPCD="$OUT/root/usr/libexec/rpcd/podkop_bot"
[ -f "$RPCD" ] || { echo "required payload missing: /usr/libexec/rpcd/podkop_bot" >&2; exit 1; }
sed -i "s/^LUCI_APP_VERSION=\"[^\"]*\"/LUCI_APP_VERSION=\"$BASE_VERSION\"/" "$RPCD"
RPC_VERSION="$(sed -n 's/^LUCI_APP_VERSION="\([^"]*\)".*/\1/p' "$RPCD" | head -n1)"
[ "$RPC_VERSION" = "$BASE_VERSION" ] || { echo "failed to synchronize staged rpcd version" >&2; exit 1; }

# The update backend was written when Bearhole used a fixed 1066 gateway. Keep
# source compatibility for now, but make the installed payload read the validated
# UCI port so changing HWELP's port also affects curl/apk/opkg update subprocesses.
python3 - "$RPCD" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
s = p.read_text()
old = '_bh_gateway="http://127.0.0.1:1066"'
new = '_bh_gateway="http://127.0.0.1:$(uci -q get podkop_bearhole.main.port 2>/dev/null || printf 1066)"'
count = s.count(old)
if count != 2:
    raise SystemExit(f'expected 2 fixed Bearhole gateways in rpcd, found {count}')
p.write_text(s.replace(old, new))
PY

# Vendored bot is already synchronized byte-for-byte with standalone dev.
BOT="$OUT/root/usr/lib/podkop_bot/podkop_bot"
[ -f "$BOT" ] || { echo "required payload missing: /usr/lib/podkop_bot/podkop_bot" >&2; exit 1; }
sh -n "$BOT"
(
    cd "$OUT/root/usr/lib/podkop_bot"
    sha256sum -c vendor.sha256
)

for f in \
    usr/libexec/rpcd/podkop_bot \
    usr/libexec/rpcd/podkop_bot_warpscout \
    usr/libexec/rpcd/podkop_bot_warpscout_runtime \
    usr/libexec/rpcd/podkop_bot_warpscout_tgscan \
    usr/libexec/rpcd/podkop_bot_warpscout_rescue \
    usr/libexec/rpcd/podkop_bot_bearhole \
    usr/lib/podkop_bot/install.sh \
    usr/lib/podkop_bot/podkop_bot \
    usr/lib/podkop_bot/podkop_bot_init \
    usr/lib/podkop_bot/bearhole.sh \
    usr/lib/podkop_bot/warpscout-rescue-watchdog \
    etc/init.d/podkop-bearhole \
    etc/init.d/podkop-warp-rescue
do
    [ -f "$OUT/root/$f" ] || { echo "required payload missing: /$f" >&2; exit 1; }
    chmod 0755 "$OUT/root/$f"
done

for s in preinst postinst postrm; do
    src="$ROOT/scripts/$s"
    [ -f "$src" ] || continue
    sed -e '1s/^\xef\xbb\xbf//' -e 's/\r$//' "$src" > "$OUT/scripts/$s"
    chmod 0755 "$OUT/scripts/$s"
done

echo "staged luci-app-podkop-bot $PKG_VERSION"
