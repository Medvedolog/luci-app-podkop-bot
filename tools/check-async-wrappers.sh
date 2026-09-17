#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

for f in root/www/luci-static/resources/view/podkop-bot/*-async.js; do
    [ -f "$f" ] || continue
    grep -Fq 'return base.constructor.extend({' "$f" || {
        echo "LuCI async wrapper must return a class constructor: $f" >&2
        exit 1
    }
    if grep -Fq 'return base;' "$f"; then
        echo "FAIL  LuCI async wrapper returns injected instance: $f" >&2
        exit 1
    fi
done

echo "LuCI async wrapper constructor contract OK"

sh tools/check-ui-layout.sh
sh tools/check-tailscale-rpc-acl.sh
sh tools/check-tsnet-runtime-integration.sh

# This script is already a dedicated source-regression CI step. Keep the bot
# transport hardware regression in the same early gate so it fails before any
# package/SDK build starts.
sh tools/check-bot-transport.sh
