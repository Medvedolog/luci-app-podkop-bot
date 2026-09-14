# HANDOFF — luci-app-podkop-bot 0.19.18 WARPSCOUT integration

Updated: 2026-09-14

## Repository / branch

- Repository: `Medvedolog/luci-app-podkop-bot`
- Development branch: `dev/0.19.18-warpscout-luci`
- Current package version: **`0.19.18-r17`**
- Current branch head before this docs refresh: `f9bc51960bf9cb6d5759228981463b5f720b35ae`
- Latest validated package CI: GitHub Actions run `34822264197`, run number `#196`, success
- Artifact: `owfeed-packages`, id `10338378001`, digest `sha256:910eed092bf8f0c0af16728c5571eedca2e11df17154df0b6d083bee9826ec55`
- Package names: `luci-app-podkop-bot_0.19.18-r17_all.ipk` and `luci-app-podkop-bot-0.19.18-r17.apk`
- Do **not** merge to `main`, create a tag, or publish a release without an explicit user command.

## Current product model

### Navigation

- `Настройки → Основные`
- `Настройки → WARP Rescue / WARPSCOUT`
- `Транспорт → Цепочка прокси`
- `Транспорт → Револьвер WARP`
- `Проверка маршрутов`

Old WARPSCOUT/TG-route URLs have compatibility aliases where already implemented.

### WARP architecture

1. WARPSCOUT performs Discovery and ranks WARP candidates.
2. Telegram qualification checks configured routes and WARPSCOUT candidates against real Telegram Bot API `getMe`.
3. Only WARPSCOUT candidates with TG status `VALID` belong in the Revolver magazine.
4. `FIRE` selects a cartridge and verifies Telegram Bot API again before leaving it ON-AIR.
5. `Next WARP` rotates to the next cartridge.
6. `Reload` is intended to run: Discovery → TG qualification → magazine rebuild → FIRE best VALID candidate.
7. Qualification is diagnostic/advisory and must not mutate authoritative POLL/FAST route state.
8. Persistent user-facing WARP SOCKS is **WARP Rescue only**.
9. Hidden test SOCKS is internal to diagnostics and must not appear as a second user-facing WARP service.

### Important runtime separation

Persistent Rescue runtime:

- PID file: `/tmp/podkop_bot/warpscout_rescue_socks.pid`

Hidden manual/test runtime:

- PID file: `/tmp/podkop_bot/warpscout_socks.pid`

Manual WARP checks must not silently test a different exit from the one shown to the operator. If Rescue needs to be paused for a hidden-runtime operation, the exact previous endpoint/state should be restored on success or error.

Since r16, long WARP/manual route probes run in a detached backend worker and request server-side runtime cleanup/restore when the worker exits. This removes the browser/XHR from the critical restore path, but router-level validation under browser/network loss is still required before claiming the recovery path fully proven.

## Long diagnostics / XHR model

All heavy route/service diagnostics use the same detached pattern:

`start → background worker → short status polling → result`

This covers:

- Podkop/Forkop section checks;
- configured transport proxies;
- manual proxies;
- WARP route checks;
- batch `Проверить все маршруты`;
- Overview full Outbound test.

A lost XHR/browser tab no longer terminates the actual heavy probe. The router continues the worker and LuCI can resume polling/read the result.

The Podkop/Forkop update path was also hardened in r16: network preflight/download/install startup is launched detached, with LuCI polling logs/status instead of holding one long update XHR.

Remaining synchronous calls are intended to stay bounded: one-shot transport probe, token/version checks, and `ensure_mixed_proxy`.

## Telegram transport model

The bot keeps POLL and FAST routing state separate.

Normal transport order remains conceptually:

`Podkop SOCKS / auto-discovered sections → configured reserve proxies → custom proxy → Direct → emergency Telegram IPs`

The last working route is sticky and is tried first. Degraded Direct/Emergency paths periodically re-probe higher-priority SOCKS routes and recover upward when available.

WARP Rescue is **not yet** wired as an automatic final POLL/FAST failover stage. Current WARP work is qualification, Rescue control, Revolver and diagnostics.

## Bot state-machine regression fixed in r17

Observed on router/Telegram: while the bot was waiting for a pending text value such as `wait_admin_id`, pressing the persistent keyboard button `📊 Статус` produced “Некорректный ID” because the reply-button command was consumed by `STATE_INPUT` and validated as the pending ID.

Fix:

- `cmd_status` now has priority over pending text input;
- pending `STATE_FILE` is cleared;
- the normal Status handler runs instead of the pending-value validator.

Standalone source of truth for this fix:

- Repository: `Medvedolog/podkop_bot`
- Branch: `dev/0.19.17-security-hardening`
- Commit: `f623692915ea6c134155df727551225228282625`
- Commit message: `fix(bot): let Status escape pending input state`

LuCI vendored copy was synchronized afterwards. Current vendored checksum:

`0926d9797dcb951e286080c2ede09548cf2781b860e1df8a570e578f41182a8b  podkop_bot`

Keep the standalone and vendored bot synchronized when modifying bot logic.

## Completed in the current development line

### WARPSCOUT backend/UI

- Install/remove WARPSCOUT from LuCI.
- WARP account create/import.
- Discovery / shortlist / targeted recheck.
- Rescue start/stop.
- Revolver magazine, FIRE, Next and Reload controls.
- Stop WARP empties the magazine while preserving discovery inputs.
- Rescue status is lightweight/local and no longer rebuilds the magazine on every poll.
- Status exposes PID/RSS where available.
- Normal WARPSCOUT status refresh does not hit GitHub; network version check is explicit/forced.

### Telegram qualification

- Dedicated tgscan backend.
- Separate transient WARP qualification port so active Rescue can stay on-air during candidate qualification.
- Includes tier1, auto-discovered Podkop/Forkop sections, configured fallback proxies, tier3 and WARP candidates.
- Legacy `#WARP-SCOUT` manual fallback entries are filtered from scan/runtime selectors.
- Result/plan parser hardened for router jq behavior.
- Runtime preserves last good TG result instead of leaving a permanent parser error card.
- `already_running` attaches to the existing scan instead of showing duplicate red errors.

### LuCI UX

- WARPSCOUT moved under Settings.
- Separate TG Routes page removed from visible navigation; TG qualification is integrated into route checks.
- `Runtime` renamed to `Проверка маршрутов`.
- `Пул прокси` renamed to `Цепочка прокси`.
- Russian wording pass completed across major WARPSCOUT/Revolver/Runtime/Transport/Overview/Help/Update surfaces.
- Protocol/API/product names remain English where appropriate: WARP, SOCKS, HTTP, Telegram Bot API, AWG, MASQUE.
- Machine-status badges remain `VALID`, `FAIL`, `POLL`, `FAST`, `ON-AIR`.
- WARPSCOUT settings have explanatory tooltips for main fields/actions.
- All-routes check warns that many routes may take up to about 90 seconds and load the router.

### Reliability / long operations

- Long route/service probes detached from browser XHR.
- Runtime, Overview, manual proxy, Podkop/Forkop section and WARP checks use one shared async worker model.
- WARP probe worker requests server-side cleanup/Rescue restore on exit.
- Podkop/Forkop update preflight/download path detached from the LuCI XHR.

## Important files

LuCI views:

- `root/www/luci-static/resources/view/podkop-bot/warpscout.js`
- `root/www/luci-static/resources/view/podkop-bot/warpscout-rescue.js`
- `root/www/luci-static/resources/view/podkop-bot/runtime.js`
- `root/www/luci-static/resources/view/podkop-bot/runtime-async.js`
- `root/www/luci-static/resources/view/podkop-bot/transport.js`
- `root/www/luci-static/resources/view/podkop-bot/overview.js`
- `root/www/luci-static/resources/view/podkop-bot/overview-async.js`
- `root/www/luci-static/resources/view/podkop-bot/help.js`
- `root/www/luci-static/resources/view/podkop-bot/update.js`
- `root/www/luci-static/resources/view/podkop-bot/update-async.js`

Core / workers:

- `root/usr/lib/podkop_bot/podkop_bot`
- `root/usr/lib/podkop_bot/vendor.sha256`
- `root/usr/libexec/rpcd/podkop_bot`
- `root/usr/libexec/rpcd/podkop_bot_probe`
- `root/usr/libexec/rpcd/podkop_bot_update_async`

WARPSCOUT rpcd backends:

- `root/usr/libexec/rpcd/podkop_bot_warpscout`
- `root/usr/libexec/rpcd/podkop_bot_warpscout_rescue`
- `root/usr/libexec/rpcd/podkop_bot_warpscout_runtime`
- `root/usr/libexec/rpcd/podkop_bot_warpscout_tgscan`

Project docs:

- `CHANGELOG.md` — historical/release changelog
- `CHANGELOG_DEV.md` — current 0.19.18 development changelog
- `TODO.md` — prioritized remaining work
- `HANDOFF.md` — this file

## Recent commits of interest

WARPSCOUT / UI line:

- `e5248156` — harden Telegram qualification result/plan parsing
- `06b2c050` — Stop WARP empties magazine
- `dca94cb2` — Runtime TG lifecycle / preserve valid results / already-running handling
- `a3b631e2` — remove duplicate revolver button
- `5907831a` — WARPSCOUT Russian wording
- `a7effe43` — Runtime wording + all-routes warning
- `9d497b7b` — Revolver wording
- `749e3eec` — WARPSCOUT tooltips
- `cf65f5ee` — Proxy chain wording cleanup
- `1d9762be` — Overview wording cleanup
- `88fc8ab3` — Help wording/navigation cleanup
- `d9ef4913` — Update-page wording cleanup
- `abf6ab5a` — r14 baseline

Long-operation hardening:

- `9bd913a2` — detached active-probe worker
- `165b6954` — async Runtime route/proxy/WARP probes
- `b31cf693` — async Overview Outbound probe
- `20d78e94` / `dc6f729e` — detached Podkop/Forkop update launcher
- `b75ab2cb` — async Update UI
- `5f6b5744` — r16 package revision

Bot state fix / r17:

- standalone `f6236929` — Status escapes pending input state
- LuCI `cd6ceac8` — synchronize vendored bot state fix
- LuCI `df7d27b1` — bump package revision to r17
- LuCI `f9bc5196` — refresh vendored bot checksum

## Latest validated build

GitHub Actions:

- Run: `34822264197`
- Run number: `#196`
- Result: success
- Source checks: success
- Native OpenWrt package build: success
- OpenWrt 25.12 APKv3 install test: success
- OpenWrt 24.10 IPK install test: success
- Artifact: `owfeed-packages`
- Artifact id: `10338378001`
- Artifact digest: `sha256:910eed092bf8f0c0af16728c5571eedca2e11df17154df0b6d083bee9826ec55`

Package names:

- `luci-app-podkop-bot_0.19.18-r17_all.ipk`
- `luci-app-podkop-bot-0.19.18-r17.apk`

## Known P0 risks

See `TODO.md` for the full list. Release-blocking/high-risk items still include:

- router validation of TG qualification parser/lifecycle fixes;
- router validation that detached WARP/manual probe failure always restores the exact previous Rescue endpoint/state;
- persistent per-endpoint TG status in WARPSCOUT shortlist;
- resolving Overview metadata from the actual Rescue endpoint;
- Stop/Reload/FIRE hardware verification;
- regression verification that qualification/runtime never contaminates POLL/FAST route state.

## Explicit non-features / do not claim yet

- No continuous process-death WARP watchdog that automatically rotates after arbitrary later Rescue failure.
- No production POLL/FAST automatic failover through WARP Rescue yet.
- Bearhole/OpenWrt Rescue hook does not currently change routing.
- Manual TG result persistence in Settings is not complete yet.
- Rich final batch result rendering is not complete yet.

## Development rules

- Keep machine/syslog messages from `podkop-bot` / `podkop-bot-rpcd` English and machine-readable; do not log localized route display names as authoritative state.
- Keep vendored bot and standalone bot synchronized when bot code is intentionally updated.
- Do not re-use `PKG_RELEASE` for a new router-testable change; bump revision for each new test slice.
- Documentation-only commits do **not** require a package revision bump.
- Do not create release/tag or merge to main without an explicit user command.
- Prefer one clear operator action over multiple confirmation ceremonies; destructive actions should use one meaningful confirmation plus automatic preflight where applicable.
