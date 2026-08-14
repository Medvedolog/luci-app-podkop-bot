# Аудит и подготовка RC — luci-app-podkop-bot 0.18.8

Дата проверки: 2026-07-27.

## Что включено

- Встроенный `podkop_bot` синхронизирован с последней проверенной веткой 0.18.1.
- В bot добавлена очистка stale-маркера `_ml_add.$$` перед обработкой пользовательских списков.
- SHA-256 встроенного bot закреплён в `root/usr/lib/podkop_bot/vendor.sha256`:
  `2ee7ba436e1fbd5300c7a220723ebec1e405eec7ed9946f543826dcb00b10828`.
- Локальная установка полного `.sh` переведена на штатную загрузку LuCI во временный файл, без передачи 700+ КиБ через JSON-RPC.
- RPC `update_upload` проверяет размер, shebang, `BOT_VERSION`, синтаксис ash, создаёт `.bak` и атомарно заменяет bot.
- Обновление Podkop/Forkop/NetShift получает `install.sh` по цепочке direct IPv4 → Tier 1 SOCKS → fallback SOCKS → custom proxy.
- Для core-update добавлен PID-lock с восстановлением после stale-lock.
- Polling core-update завершается и при аварийной гибели worker без exit-маркера.
- Кнопки GitHub update/uninstall остаются заблокированными до завершения операции; RPC polling имеет конечный failure-path.
- Release CI проверяет checksum vendor-копии и RPC-контракт: list ↔ dispatch ↔ definitions ↔ ACL ↔ frontend.

## Выполненные проверки

- `busybox ash -n` для shell/rpcd/init-файлов.
- `node --check` для всех LuCI JS.
- `jq empty` для menu.d и ACL.
- разбор обоих workflow через PyYAML.
- `sha256sum -c root/usr/lib/podkop_bot/vendor.sha256`.
- RPC-контракт: 29 методов, отсутствующих определений/dispatch/ACL/frontend-вызовов нет.
- Макетные failure-path тесты загрузки `.sh`: valid, bad script, >2 МиБ, missing, live/stale lock, backup.
- Макетные failure-path тесты core-update: direct fail → SOCKS success, live/stale lock, exit log.
- Polling core-update: live PID → `done:false`; dead PID/exit marker → `done:true`.

## Проверить на роутере перед RC

1. Установка локального `podkop_bot.sh` из LuCI на OpenWrt с uhttpd; проверить `.bak`, версию и перезапуск службы.
2. Обновление Forkop/NetShift при недоступном прямом GitHub, но рабочем Tier 1 SOCKS.
3. После core-update проверить восстановление `/etc/resolv.conf` и отсутствие `/tmp/podkop_core_update.lock`.
4. Двойной клик/две вкладки: второй core-update должен получить `already_running`.
5. GitHub update и uninstall: кнопка заблокирована до финала, журнал доходит до результата.
6. На Forkop повторить stale callback/state сценарии из аудита bot 0.18.1.
7. На classic/NetShift проверить dynamic/text add, del и download пользовательских доменов/подсетей.

## Ограничение локальной проверки

IPK/APK в этой среде не собирались: `nfpm` отсутствует. Workflow сборки и проверки пакетов сохранён и расширен; окончательную проверку содержимого IPK/APK должен выполнить GitHub Actions или локальная среда с `nfpm`.
