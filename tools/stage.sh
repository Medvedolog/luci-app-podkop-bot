#!/bin/sh
# Stage luci-app-podkop-bot as the router filesystem consumed by owfeed/mkpkg.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/dist}"

# Release tags are authoritative. Branch/PR CI uses the checked-in app version
# so a release-preparation commit can be tested before its tag exists.
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

# Keep release/package version sources coherent. The staged rpcd payload gets the
# same BASE_VERSION below; this avoids rewriting the 100+ KiB backend merely to
# change its build-visible LUCI_APP_VERSION constant on a development branch.
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

# root/ is already laid out as an OpenWrt root filesystem.
cp -a "$ROOT/root/." "$OUT/root/"

# Synchronize app_info/footer version in the staged package payload. Source bot
# version remains independent; only LUCI_APP_VERSION is replaced.
RPCD="$OUT/root/usr/libexec/rpcd/podkop_bot"
[ -f "$RPCD" ] || { echo "required payload missing: /usr/libexec/rpcd/podkop_bot" >&2; exit 1; }
sed -i "s/^LUCI_APP_VERSION=\"[^\"]*\"/LUCI_APP_VERSION=\"$BASE_VERSION\"/" "$RPCD"
RPC_VERSION="$(sed -n 's/^LUCI_APP_VERSION="\([^"]*\)".*/\1/p' "$RPCD" | head -n1)"
[ "$RPC_VERSION" = "$BASE_VERSION" ] || { echo "failed to synchronize staged rpcd version" >&2; exit 1; }

# Runtime files that must remain executable even if a checkout/import lost modes.
for f in \
    usr/libexec/rpcd/podkop_bot \
    usr/libexec/rpcd/podkop_bot_warpscout \
    usr/libexec/rpcd/podkop_bot_warpscout_runtime \
    usr/libexec/rpcd/podkop_bot_warpscout_tgscan \
    usr/libexec/rpcd/podkop_bot_warpscout_rescue \
    usr/lib/podkop_bot/install.sh \
    usr/lib/podkop_bot/podkop_bot \
    usr/lib/podkop_bot/podkop_bot_init
do
    [ -f "$OUT/root/$f" ] || { echo "required payload missing: /$f" >&2; exit 1; }
    chmod 0755 "$OUT/root/$f"
done

# Normalize maintainer hooks only; payload bytes otherwise stay untouched.
for s in postinst postrm; do
    src="$ROOT/scripts/$s"
    [ -f "$src" ] || continue
    sed -e '1s/^\xef\xbb\xbf//' -e 's/\r$//' "$src" > "$OUT/scripts/$s"
    chmod 0755 "$OUT/scripts/$s"
done

echo "staged luci-app-podkop-bot $PKG_VERSION"
