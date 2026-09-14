# Development changelog — 0.19.18

Branch: `dev/0.19.18-warpscout-luci`

This file tracks the current development branch. The large historical `CHANGELOG.md` remains the release history and should absorb this section when 0.19.18 is promoted.

## 0.19.18-r17 — bot pending-state navigation regression fix

### Telegram bot

- Fixed a state-machine regression where a persistent reply-keyboard command such as `📊 Статус` could be consumed as pending text input while the bot was waiting for a value such as `wait_admin_id`.
- `cmd_status` now wins over pending text input: the stale pending state is cleared and the normal Status handler is executed instead of validating the button label as a Telegram ID.
- The standalone fix landed first in `Medvedolog/podkop_bot`, branch `dev/0.19.17-security-hardening`, commit `f623692915ea6c134155df727551225228282625`.
- The same bot body was then synchronized into the LuCI vendored copy. `vendor.sha256` now pins `0926d9797dcb951e286080c2ede09548cf2781b860e1df8a570e578f41182a8b`.

### Packaging / CI

- Package revision bumped to **0.19.18-r17** because the vendored executable changed and needs a distinct router-testable artifact.
- GitHub Actions run `#196` (`34822264197`) passed source checks, native OpenWrt package build and install tests for both OpenWrt 25.12 APKv3 and OpenWrt 24.10 IPK.
- Artifact: `owfeed-packages`, id `10338378001`, digest `sha256:910eed092bf8f0c0af16728c5571eedca2e11df17154df0b6d083bee9826ec55`.

## 0.19.18-r16 — detached long-operation hardening

### Long route/service probes

- Long `active_probe` diagnostics no longer depend on one 15–60 second LuCI XHR. A dedicated `podkop_bot_probe` rpcd worker starts the heavy check in the background and exposes short `start / status / result / cancel` calls.
- The async path is used for Podkop/Forkop section checks, configured transport proxies, manual proxies, WARP checks, batch “all routes” checks and the Overview full Outbound test.
- A lost browser poll/XHR no longer kills the actual probe; LuCI retries status polling and reads the finished result from the router.
- Credentialed manual proxies remain ephemeral: proxy credentials are not persisted in async state/result metadata.
- WARP manual probes request server-side cleanup. The worker calls the WARPSCOUT runtime stop/restore path when the probe exits, so Rescue restoration is no longer dependent solely on the browser reaching frontend `finally` logic.
- Runtime and Overview menu entries route through compatibility wrapper views (`runtime-async.js`, `overview-async.js`) so the existing rendering/state logic remains shared instead of being forked.

### Update path / XHR audit

- The LuCI Podkop/Forkop updater was also moved off the long synchronous XHR path: network preflight, installer download and install startup are launched by a detached backend helper, while the browser performs short log/status polls.
- The principal problematic synchronous path was `active_probe`; all user-facing callers now use the detached worker.
- Remaining synchronous calls such as one-shot transport probes, token/version checks and `ensure_mixed_proxy` are bounded operations and are not in the 60+ second diagnostic class.

## 0.19.18-r14 — WARPSCOUT / WARP Rescue UI baseline

### WARP Rescue / WARPSCOUT

- Added WARPSCOUT integration to LuCI with installation/removal, WARP account registration/import, Discovery, shortlist, targeted recheck, runtime diagnostics and Rescue controls.
- Added a dedicated **WARP Revolver** view. Its magazine contains only WARP candidates qualified as `VALID` by Telegram Bot API.
- `FIRE` activates a selected cartridge and verifies Telegram Bot API before leaving it `ON-AIR`.
- `Reload` runs the intended pipeline: Discovery → Telegram API qualification → magazine rebuild → fire best VALID candidate.
- `Stop WARP` stops Rescue and empties the magazine while preserving WARPSCOUT discovery data and qualification inputs.
- Rescue is the only user-facing persistent WARP SOCKS. The hidden test SOCKS is internal to diagnostics.
- Telegram qualification uses a separate transient WARP scan port so an active Rescue tunnel can remain on-air while candidates are checked.
- WARPSCOUT status calls are local/cache-only during normal page refresh; network version checks are forced only when explicitly requested.
- Rescue status no longer rebuilds the magazine on each poll and exposes process PID/RSS.
- Added operation progress for Reload/FIRE and clearer revolver states.
- WARPSCOUT settings were moved to `Настройки → WARP Rescue / WARPSCOUT`; transport keeps `Цепочка прокси` and `Револьвер WARP`.
- Added compatibility aliases for old LuCI URLs.
- Removed duplicate “Open revolver” button from WARPSCOUT settings.
- Added Russian tooltips for the main WARPSCOUT settings and actions.

### Telegram API qualification

- Unified qualification covers tier1, auto-discovered Podkop/Forkop sections, configured fallback proxies, tier3 and WARPSCOUT candidates.
- Legacy manual `#WARP-SCOUT` fallback entries are excluded from qualification/runtime selectors.
- Fixed parser handling for Telegram scan result/plan JSON on router `jq` variants.
- Runtime no longer leaves a permanent red `parse_error` card; last known-good results are preserved.
- `already_running` attaches LuCI to the existing qualification instead of showing duplicate red errors.
- POLL / FAST / ON-AIR route tags are shown separately where available.

### Runtime / route checks

- Runtime was renamed in the menu to **Проверка маршрутов**.
- Telegram API qualification is embedded in the route-check page; the separate TG routes tab is hidden and old URL aliases to the new location.
- WARP runtime checks use the actual Rescue endpoint instead of silently testing a different WARP exit.
- Added progress text with elapsed time for route, proxy and WARP checks.
- “Проверить все маршруты” warns that a large set can take up to about 90 seconds and load the router.
- Full route test continues to check geo, service reachability and throughput/TSPU symptoms.

### Transport UI

- `Пул прокси` renamed to **Цепочка прокси**.
- UI wording was normalized to Russian where the English term is not a protocol/API name.
- Machine badges such as `VALID`, `FAIL`, `POLL`, `FAST`, `ON-AIR` remain unchanged.

### Overview / UI language

- Overview WARP block describes Rescue rather than the hidden test runtime.
- Removed meaningless endpoint-ping row from the overview card.
- Normalized mixed Russian/English wording across WARPSCOUT, Revolver, Route checks, Proxy chain, Overview, Help and Update pages.
- Kept protocol/product names such as WARP, SOCKS, HTTP, Telegram Bot API, AWG and MASQUE unchanged.

## Known limitations / not yet claimed complete

- Continuous automatic WARP Rescue process-death watchdog/rotation is not implemented yet.
- WARP is not yet wired as an automatic final POLL/FAST failover stage; current integration is qualification + Rescue + manual/runtime control.
- Detached WARP restore logic is implemented but still needs router-level validation against browser/network loss and process failure.
- WARPSCOUT shortlist manual TG result persistence across page refresh still needs completion.
- Overview metadata can still be incomplete when the active Rescue endpoint is not matched to a current WARPSCOUT snapshot.
- Batch route-test summary is still intentionally compact and needs a richer final result view.
- Bearhole/OpenWrt Rescue backend hook exists, but routing semantics are not active yet.
