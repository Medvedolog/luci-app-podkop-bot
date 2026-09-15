#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

VIEW_DIR='root/www/luci-static/resources/view/podkop-bot'
MENU='root/usr/share/luci/menu.d/luci-app-podkop-bot.json'

bad=$(find "$VIEW_DIR" -maxdepth 1 -type f -name '*-r[0-9]*.js' -print)
if [ -n "$bad" ]; then
    echo "FAIL versioned LuCI view filenames are forbidden:" >&2
    printf '%s\n' "$bad" >&2
    exit 1
fi

if grep -ERq "require view\.podkop-bot\.[A-Za-z0-9_-]*-r[0-9]+" "$VIEW_DIR"; then
    echo 'FAIL versioned LuCI view dependency returned' >&2
    grep -ERn "require view\.podkop-bot\.[A-Za-z0-9_-]*-r[0-9]+" "$VIEW_DIR" >&2 || true
    exit 1
fi

for view in overview-live runtime-live bearhole-live; do
    [ -f "$VIEW_DIR/$view.js" ] || { echo "FAIL missing stable view: $view.js" >&2; exit 1; }
    grep -Fq '"path": "podkop-bot/'"$view"'"' "$MENU" || {
        echo "FAIL menu does not use stable view: $view" >&2
        exit 1
    }
done

echo 'LuCI stable view layout OK'
