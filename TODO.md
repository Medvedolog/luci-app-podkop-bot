# TODO — dev/0.19.18-warpscout-luci

Priorities are ordered by release risk, not by implementation size.

## P0 — before calling 0.19.18 ready

- [ ] **Router-verify Telegram qualification after parser/lifecycle fixes.** Confirm no persistent `raw lines: N · parse_error`, no duplicate `already_running` errors, and that LuCI correctly attaches to an already-running scan.
- [ ] **Harden exact Rescue restore after manual hidden-runtime tests.** Before any temporary test SOCKS starts, capture the exact previous Rescue endpoint/state; on completion or error, restore that exact endpoint when still valid. Do not claim exact restoration until tested on hardware.
- [ ] **Persist per-endpoint TG status in WARPSCOUT shortlist.** Manual/central qualification result must survive `refreshView()` and page reload; show `VALID` / `FAIL`, latency and age where available.
- [ ] **Fix Overview WARP metadata resolution.** If `active_snapshot` is empty/stale, resolve metadata by the actual Rescue endpoint from the shortlist. Do not show misleading rows filled only with dashes.
- [ ] **Router-verify Stop WARP semantics.** Confirm Rescue stops, magazine becomes `0 / 0`, shortlist/discovery data remain intact, and a later Reload rebuilds normally.
- [ ] **Router-verify Reload/FIRE with Rescue already active.** Qualification must use the transient scan SOCKS/port and must not accidentally kill or replace the persistent Rescue until FIRE succeeds.
- [ ] **Regression-check POLL and FAST separation.** Ensure TG qualification, Runtime and watchdog diagnostics never overwrite authoritative POLL/FAST route state.
- [ ] **Run full r14 hardware smoke test** on OpenWrt 24.10.x/Forkop: Settings → Discovery → TG qualification → Revolver Reload → FIRE → Stop → Runtime selected WARP → all-routes test.

## P1 — important UX / diagnostics

- [ ] **Make the all-routes final summary rich.** Per route show outbound/server, country/provider/IP, Telegram result, service pass/fail summary, speed/TSPU result and errors; preferably collapsible details.
- [ ] **Clarify Shortlist vs Magazine visually.** Shortlist = WARPSCOUT discovery candidates; Magazine = only TG-qualified VALID cartridges. Remove generic unexplained “traffic-light” semantics where possible.
- [ ] **Remove/migrate legacy manual `WARP-SCOUT` fallback config entries** instead of only filtering them from Runtime/TG scan.
- [ ] **Finish Russian UI language audit** in remaining edge strings, errors and rarely used dialogs. Keep protocol/API/product names and machine badges unchanged.
- [ ] **Audit tooltips on WARPSCOUT settings** on desktop/mobile LuCI themes for overflow and accessibility; tooltips should explain effect, expected format and risk, not repeat labels.
- [ ] **Transport text layout cleanup.** Keep explanatory sentences readable on narrow screens; avoid giant one-line paragraphs.
- [ ] **Add explicit timestamps/age to important qualification data** where stale results could be mistaken for current state.

## P2 — architecture / follow-up features

- [ ] **Continuous WARP Rescue watchdog.** Detect arbitrary later Rescue process/tunnel failure and rotate to the next VALID cartridge without requiring an open LuCI page.
- [ ] **Integrate WARP Rescue into real Telegram transport failover.** Define exact position after normal configured routes, interaction with sticky POLL/FAST and recovery back to higher-priority routes.
- [ ] **Define Bearhole/OpenWrt Rescue semantics** before activating the existing backend hook. Avoid a second independent failover state machine.
- [ ] **Unify qualification/result storage** so Settings, Revolver, Runtime and Overview consume one authoritative per-route/per-endpoint result model.
- [ ] **Add deterministic state-machine tests** for Discovery → qualification → magazine → FIRE → Stop/Reload and failure paths.
- [ ] **Add UI/source checks for Russian terminology** to prevent reintroduction of `endpoint / shortlist / account / Discovery / fallback` in user-facing strings where a normal Russian term exists.

## P3 — polish / release preparation

- [ ] Merge the 0.19.18 development notes from `CHANGELOG_DEV.md` into the main historical `CHANGELOG.md` when the release is finalized.
- [ ] Update README screenshots/navigation after UI names stabilize.
- [ ] Finalize release notes only after hardware validation; do not create tag/release from this branch without an explicit command.
- [ ] Confirm IPK/APK artifacts install and upgrade cleanly from the previous public release on supported OpenWrt branches.
