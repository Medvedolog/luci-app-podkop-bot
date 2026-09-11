# Релизы luci-app-podkop-bot через owfeed

Этот репозиторий собирает два нативных для OpenWrt формата из одного staged tree:

- OpenWrt 25.12+ — APKv3/ADB (`dist/noarch/*.apk`);
- OpenWrt 24.10 — IPK (`dist/all/*.ipk`).

`owfeed` заменяет nFPM. Версия релиза берётся из git tag, нормализуется для пакетного менеджера в `X.Y.Z-rN`, а содержимое пакета формируется из `root/` и `scripts/` через `tools/stage.sh`.

## Однократная настройка подписей

Нужны два постоянных ключа. Их нельзя генерировать внутри CI на каждый релиз: feed должен один раз закрепить публичный ключ автора и проверять им все последующие релизы.

На доверенной машине с `gh` выполните:

```sh
./tools/setup-keys.sh
```

Скрипт создаст и загрузит в GitHub Secrets:

- `PODKOP_BOT_SIGN_KEY` — EC prime256v1, подпись пакета;
- `PODKOP_BOT_USIGN_KEY` — usign, подпись `manifest.txt` и release assets.

Приватные файлы из `keys-setup/` нужно сохранить вне git, например в менеджере секретов, после чего удалить каталог. Публичные половины скрипт копирует в:

```text
keys/podkop-bot-sign.pub.pem
keys/podkop-bot-release.pub
```

Их следует закоммитить. Обычный релиз не является поводом вращать ключи: community feed закрепляет публичную половину.

## Pipeline

CI устроен как четыре последовательно усиливающихся gate:

```text
sources -> build -> verify -> release
```

`source` проверяет JS, shell, JSON, vendor checksum и RPC contract. `build` выполняет `tools/stage.sh`, `owfeed plan`, `owfeed check`, `owfeed build` и затем проверяет фактическое содержимое IPK через `tools/check-package.sh`. `verify` запускает OpenWrt через `owlab`, ставит только что собранный пакет на 25.12 и 24.10 и открывает страницу LuCI. Только после успешных build+verify тег может перейти к `release`, где reusable workflow owfeed подписывает пакеты и manifest и публикует GitHub Release.

В build/verify jobs секретных ключей нет. Они доступны только release job.

## Создание релиза

Перед тегом убедитесь, что `version.txt`, `PKG_VERSION` в `Makefile` и `LUCI_APP_VERSION` в rpcd содержат одну базовую версию.

Пример для `0.19.13`:

```sh
git tag 0.19.13
git push origin 0.19.13
```

`tools/stage.sh` превратит её в package version `0.19.13-r1`. Если когда-либо понадобится package revision без изменения upstream версии, tag вида `0.19.13-2` нормализуется в `0.19.13-r2`.

Ожидаемые assets:

```text
luci-app-podkop-bot-0.19.13-r1.apk
luci-app-podkop-bot_0.19.13-r1_all.ipk
manifest.txt
*.sig
```

## Добавление в owfeed-packages

Предпочтительный intake — signed upstream manifest: feed ничего не пересобирает, а забирает наш опубликованный пакет, проверяет release manifest и подпись автора и включает те же байты в свой индекс.

После первого подписанного релиза создаётся PR в `owfeed/owfeed-packages` с `KIND="manifest"`, где указываются как минимум:

```sh
KIND="manifest"
REPO="Medvedolog/luci-app-podkop-bot"
VERSION="0.19.13-r1"
TAG="0.19.13"
```

Также прикладывается/закрепляется публичный signing key в формате, который требует текущий intake owfeed-packages. Перед подачей нужно сверить актуальный `CONTRIBUTING_ru.md` этого репозитория: формат intake является внешним контрактом и может меняться.

Лицензия проекта и метаданные пакета: `GPL-2.0-or-later`.

## Локальная проверка

При установленном `owfeed`:

```sh
./tools/check-sources.sh
./tools/stage.sh 0.19.13
owfeed plan
owfeed check
owfeed build
./tools/check-package.sh
```

`dist/` является build output и в git не коммитится.
