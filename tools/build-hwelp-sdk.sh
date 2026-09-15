#!/bin/sh
# Build hwelp-proxy with an official OpenWrt SDK and copy the resulting native
# package into the owfeed artifact layout.
set -eu

[ "$#" -eq 4 ] || {
    echo "usage: $0 <sdk-url> <sdk-sha256> <expected-arch> <output-dir>" >&2
    exit 2
}

SDK_URL="$1"
SDK_SHA="$2"
ARCH="$3"
OUT="$4"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM HUP

SDK_ARCHIVE="$TMP/sdk.tar.zst"
echo "Downloading OpenWrt SDK: $SDK_URL"
curl -fL --retry 3 --retry-delay 2 -o "$SDK_ARCHIVE" "$SDK_URL"
printf '%s  %s\n' "$SDK_SHA" "$SDK_ARCHIVE" | sha256sum -c -

tar --zstd -xf "$SDK_ARCHIVE" -C "$TMP"
SDK_DIR=$(find "$TMP" -mindepth 1 -maxdepth 1 -type d -name 'openwrt-sdk-*' | head -n1)
[ -n "$SDK_DIR" ] || { echo "SDK directory not found" >&2; exit 1; }

rm -rf "$SDK_DIR/package/hwelp-proxy"
cp -a "$ROOT/hwelp-proxy" "$SDK_DIR/package/hwelp-proxy"
rm -f "$SDK_DIR/package/hwelp-proxy/owlab.yaml" "$SDK_DIR/package/hwelp-proxy/README.md"

make -C "$SDK_DIR" defconfig >/dev/null
make -C "$SDK_DIR" package/hwelp-proxy/compile -j"$(nproc)" V=s

PKG=$(find "$SDK_DIR/bin" -type f \( -name 'hwelp-proxy_*.ipk' -o -name 'hwelp-proxy-*.apk' \) | head -n1)
[ -n "$PKG" ] || { echo "hwelp-proxy package not found after SDK build" >&2; exit 1; }

mkdir -p "$OUT/$ARCH"
cp -f "$PKG" "$OUT/$ARCH/"
echo "Built $OUT/$ARCH/$(basename "$PKG")"
