# Индекс апстримов — Podkop и форки

Собрано 2026-08-01 по ссылкам из `_podkop_repo_for()`. Всё, что ниже, взято с
GitHub, а не из памяти.

## Сводка

| Вариант в коде | Репозиторий | Состояние | Звёзд | Версии |
|---|---|---|---|---|
| `podkop` (default) | `itdoginfo/podkop` | активен, апстрим для всех | 1.8k | 0.7.x, PR до #403 |
| `plus` | `ushan0v/podkop-plus` | **переименован в forkop** | 242 | 0.7.19 |
| `forkop` | `ushan0v/forkop` | активен, самый популярный форк | 318 | 1.0.5 (подтверждено на железе) |
| `netshift` | `yandexru45/netshift` | активен | 156 | 0.8.6, 0.9.2 (13 июня) |
| `evolution` | `yandexru45/podkop-evolution` | мостик совместимости | 6 | ставит NetShift |

Все четыре форка — форки `itdoginfo/podkop`.

## Что это значит для нашего кода

### `evolution` — обработан правильно ✓

Репозиторий жив намеренно: его README прямо говорит, что это разовый мостик,
уже установленные роутеры проверяют обновления по старому адресу, поэтому
рабочий `install.sh` там оставлен, и он ставит NetShift. То есть фикс P1 из
0.18.8 («ветка evolution уходила в чужой itdoginfo/podkop») сделан верно, и
менять там ничего не надо.

### `plus` — надо решить, что с ним делать

Forkop — это переименованный Podkop Plus, но в LuCI это до сих пор два разных
варианта с разными репозиториями. Апстрим-репозиторий `podkop-plus` в поиске
всё ещё виден отдельно, и неясно, отдаёт ли он сейчас редирект на `forkop`.

Практический вопрос: у пользователя с определённым вариантом `plus` кнопка
«Обновить Podkop Plus» потянет `install.sh` из `ushan0v/podkop-plus`. Если это
редирект — установится Forkop (что апстрим и имеет в виду), и после обновления
детект варианта переключится на `forkop`. Если репозиторий заморожен —
пользователь останется на старой ветке навсегда.

Проверяется на роутере:

```sh
curl -4 -sSI -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  https://raw.githubusercontent.com/ushan0v/podkop-plus/refs/heads/main/install.sh
```

### Форма URL различается, но обе рабочие

Мы всегда строим `raw.githubusercontent.com/${repo}/refs/heads/main/install.sh`.
README Forkop даёт короткую форму (`/main/install.sh`), Podkop и NetShift —
длинную (`/refs/heads/main/`). На raw обе формы эквивалентны, так что менять не
нужно; отмечаю, чтобы при следующем чтении README не показалось расхождением.

### Forkop переписан на ucode

В README Forkop: служба полностью переписана на ucode (плюс sing-box extended,
XHTTP, IPv6, Bypass, Zapret/Zapret2/ByeDPI как действия секции). Мы читаем
только UCI, так что нативная child-модель из HANDOFF остаётся верной, но при
любой будущей логике, которая полезет глубже UCI (парсинг конфига sing-box,
состояние службы), у Forkop будет другой бэкенд, чем у остальных трёх.

### NetShift поддерживает и opkg, и apk

README NetShift: OpenWrt 24.10+, поддерживаются и сборки на opkg/.ipk, и новые
на apk/.apk (OpenWrt 25.12+). Зависимости на устройстве: sing-box ≥ 1.12.0,
jq ≥ 1.7.1, coreutils-base64 ≥ 9.7. Наша проверка диска в 50 МБ выглядит
разумной: сам NetShift требует минимум 25 МБ, как и Podkop.

---

## Дополнение: схема Forkop прочитана по исходникам (август 2026)

Репозиторий Forkop получен и разобран. Ключевое, чего бот пока не знает —
подробности и приоритеты в CHANGELOG 0.19.2 и в HANDOFF:

- `action=dns` — отдельный класс секций, **не входит** в `ROUTING_ACTIONS`
  (`dns_type`, `dns_server`, `dns_detour_enabled`, `dns_detour_section`).
- Пять childType: `subscription_url`, `urltest`, `section_interface`,
  `priority_group`, `priority_level` — бот знает три. Причём `priority_level`
  вложен в `priority_group`, то есть структура двухуровневая.
- Rule Sets устроены **не как у Plus**: `rule_set` — `SettingsDynamicList` с
  настройками на элемент, `rule_set_with_subnets` — не отдельный список, а флаг
  `include_subnets` внутри этих настроек; плюс `community_lists` и
  `domain_ip_lists` (оба `DynamicList`), которых у Plus нет. Поэтому снятие
  гейта `= "plus"` карточку не починит — нужна отдельная ветка чтения.
- `mixed_proxy_auth_enabled` / `mixed_proxy_username` / `mixed_proxy_password`,
  `sort_by_latency`, `resolve_real_ip_for_routing`, `nfqws2_opt`,
  `outbound_jsons`, `label` — существуют.
- Условия маршрутизации применяются ко всем `ROUTING_ACTIONS`, включая
  `zapret`/`zapret2`/`byedpi`/`block` — показ всех четырёх полей условий в боте
  корректен.
- `fakeip.podkop.fyi` — канон в трёх местах; `fakeip.forkop.fyi` не встречается
  ни разу.

**Вывод для процесса:** схему Forkop дважды угадывали и дважды ошиблись.
Стоит завести тест, который вытаскивает имена полей и childType из
`luci-app-forkop/.../section.js` и сравнивает со списком, известным боту, —
расхождение должно падать в CI, а не всплывать через полгода.
