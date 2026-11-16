# Протокол Vidda / Hisense — заметки по реверсу

Всё ниже получено на реальном **китайском проекторе Vidda (Hisense, VIDAA)**.
Прошивка отвечает на MQTT, но не на стандартный VIDAA-пульт из некоторых
интеграций.

Сетевые идентификаторы (IP, UDN, clientId, MAC, серийный номер, device ID) в
репозитории не публикуются. Они определяются автоматически через SSDP и
хранятся только в локальном `config.json`.

## Устройство

| Параметр | Значение |
|---|---|
| DLNA modelName | `HiSmart` |
| Прошивка | `V0000.00.01R.P1228` |
| MQTT-порт | `36669` |
| transport_protocol | `1` |

`clientId` — это UDN без `uuid:` и дефисов. Он стабилен и берётся из
DLNA-описания, которое отдаётся по SSDP.

## Порты

| Порт | Что отвечает |
|---|---|
| `36669` | MQTT-брокер (рабочий канал управления) |
| `38400` | DLNA (рендерер, громкость не отражает) |
| `7002`, `7100` | HTTP-подобный сервис, на любой запрос `501 Not Implemented` |
| `9779` | «домашнее облако», снаружи не отвечает |
| `54321` | ADB: TCP открыт, но handshake не отвечает |
| `7778`, `7779` | закрыты (статья про HiSmart на этом устройстве не работает) |

## MQTT

Подключение — обычный MQTT 5 по TCP, без TLS:

```
host: <IP проектора>
port: 36669
username: hisenseservice
password: multimqttservice
protocol: MQTT 5
```

Креды статические, взяты из нативного `libmqttcrypt.so` официального APK.

### Команды

Рабочий топик:

```
/remoteapp/tv/hiservice_cmd/<clientId>/actions/sendkey
```

Payload — имя кнопки, например `KEY_VOLUMEUP`.

Стандартный VIDAA-топик:

```
/remoteapp/tv/remote_service/<clientId>/actions/sendkey
```

на этом проекторе **игнорируется**. Именно поэтому интеграции, которые шлют
только в `remote_service`, «не видят» кнопки.

### Ответы и broadcast

Брокер отдаёт подписчику его же публикации в `/remoteapp/tv/...` (эхо), поэтому
при sniff-е нужно фильтровать собственные сообщения.

Наблюдаемые ответы и состояния:

| Топик | Содержимое |
|---|---|
| `/remoteapp/mobile/<clientId>/hiservice/data/screenshot` | бинарный JPEG |
| `/remoteapp/mobile/broadcast/hiservice/data/appswitch` | `{"from":"...","to":"..."}` |
| `/remoteapp/mobile/broadcast/ui_service/state` | состояние (`statetype`, `sourceid`, ...) |
| `/remoteapp/mobile/broadcast/platform_service/actions/volumechange` | громкость (на этом проекте не наблюдалась) |
| `/remoteapp/mobile/broadcast/ui_service/volume` | громкость (на этом проекте не наблюдалась) |
| `/remoteapp/mobile/broadcast/hiservice/data/strState` | служебные строки, например `panel str on` |
| `/remoteapp/mobile/broadcast/hiservice/data/multiconfig` | конфиг устройства (виден при подключении официального приложения) |

`appswitch` приходит retained. Значение `to: com.meetingroom` означает
домашний экран/лаунчер.

## Кнопки

Подтверждены на реальном проекторе:

```
KEY_POWER
KEY_UP KEY_DOWN KEY_LEFT KEY_RIGHT KEY_OK
KEY_RETURNS KEY_HOME KEY_MENU
KEY_VOLUMEUP KEY_VOLUMEDOWN KEY_MUTE
KEY_SETTING
```

`KEY_SETTING` открывает встроенное меню проектора — подтверждено скриншотом
`docs/screenshots/projector-settings.jpg`. В меню есть пункты `Auto Keystone`,
`Manual Keystone`, `Size and Position`, `Auto Screen Alignment`, `Auto Focus`,
`Manual Focus`, `Keystone Save`.

Не поддерживаются (проверено нажатием и скриншотами):

```
KEY_BRIGHTUP KEY_BRIGHTDOWN
KEY_MULTITASK
KEY_CONTROL_CENTER
```

Экспериментальные (код отправляется, но видимая реакция не подтверждена):

```
KEY_AUTOFOCUS
KEY_FAVORITE
```

`KEY_AUTOFOCUS` и `KEY_FAVORITE` взяты как наиболее вероятные имена. Проверка
по скриншотам на домашнем экране: `KEY_AUTO_FOCUS`, `KEY_AUTOFOCUS`, `KEY_FOCUS`,
`KEY_FOCUS_AUTO`, `KEY_AF`, `KEY_FAV`, `KEY_FAVOURITE`, `KEY_FAVORITES`,
`KEY_ADD_FAVORITE`, `KEY_HEART` — все дали 0.02% отличий (только часы), то есть
видимой реакции не было. Наиболее вероятно, что эти кнопки на физическом пульте
обрабатываются не через MQTT `sendkey`, либо коды отличаются на этой прошивке.

## Входы

В протоколе VIDAA есть отдельный сервис:

```
/remoteapp/tv/ui_service/<clientId>/actions/sourcelist
/remoteapp/tv/ui_service/<clientId>/actions/changesource
```

`changesource` принимает JSON:

```json
{"sourceid": "3"}
```

Идентификаторы из `pyvidaa`:

| sourceid | Вход |
|---|---|
| `0` | TV |
| `1` | AV |
| `2` | Component |
| `3` | HDMI 1 |
| `4` | HDMI 2 |
| `5` | HDMI 3 |
| `6` | HDMI 4 |

На этом проекторе `sourcelist` ответа не дал. `changesource` с `sourceid` `4`,
а затем `3` тоже не изменил вход: скриншоты до и после совпали (разница 0.02% —
только часы). Похоже, сервис не реализован на этой прошивке.

Рабочий обходной путь: домашний экран показывает боковую панель
`HDMI 1 / HDMI 2`, откуда входы переключаются вручную. В пульте для этого есть
кнопка «Домой» в окне «Входы».

## Скриншот экрана

Запрос:

```
/remoteapp/tv/hiservice_cmd/<clientId>/actions/screenshot
payload: ""
```

Ответ:

```
/remoteapp/mobile/<clientId>/hiservice/data/screenshot
payload: JPEG (FF D8 ...)
```

Скриншот работает и отдаёт полноценный кадр 1920×1080, включая OSD/субтитры.
Если сервис занят или превышен лимит, в ответ приходит **пустой payload**.

Важно: у сервиса есть ограничение частоты. После серии быстрых снимков
(примерно 8–10 запросов подряд) проектор начинает возвращать пустые ответы на
несколько минут, затем восстанавливается. Поэтому в пульте нет автообновления:
снимок делается при открытии окна и по кнопке «Обновить».

## Питание и Wake-on-LAN

`KEY_POWER` только выключает/переводит в сон. Когда проектор выключен, MQTT
недоступен, поэтому включить его командой нельзя.

В `multiconfig` официального приложения видно:

```
network_wakeup=0
```

То есть сетевое ожидание на этом экземпляре, возможно, выключено. Пульт всё
равно отправляет magic packet на MAC из `config.json` (широковещательно, порты
9 и 7). Если WoL на проекторе разрешён — включение сработает.

## Официальное Android-приложение

Приложение подключается к локальному MQTT с clientId вида
`<uuid>:00` и отправляет в `hiservice_cmd` служебные действия:

```
getcastinfo
deviceconnect      payload: SEND_DEVICE_CONNECT$<имя-устройства>
getconfig          payload: ["file_transfer"]
screenshot
```

Ответы приходят в `/remoteapp/mobile/<app-clientId>/hiservice/data/...`:
`sendcastinfo`, `fakeStandby`, `multiconfig`, `screenshot`.

Важно: нажатия кнопок «Настройки», «Автофокус» и «Переключение входов» в
приложении **не появились** в локальном MQTT. Судя по всему, приложение с
аккаунтом отправляет их через облако. Поэтому точные коды этих кнопок не
удалось перехватить; `KEY_SETTING` найден перебором.

`multiconfig` также содержит:

```
tvDeviceId:<device-id>#DLNA_LIST@
mqttport=36669
transport_protocol=1
remote_type=012
input=0
voice=1
wire=1
cap=1
setname=1
numerickey=1
wechattv=1
jubaokey=1
network_wakeup=0
```

## Громкость и обратная связь

- DLNA `GetVolume` всегда возвращает `50` и не связан с системной громкостью.
- Broadcast-топики громкости при нажатиях `KEY_VOLUMEUP/DOWN` не появлялись.
- `getvolume` в `platform_service` и `hiservice_cmd` ответа не дал.
- `ui_service` `capability`/`applist`/`sourcelist` на этом проекторе молчат.
- Единственный надёжный индикатор — сам экран. Скриншот после нажатия громкости
  теоретически может поймать OSD, но это не потоковая обратная связь.

## Что пробовалось и не сработало

- `remote_service/sendkey` — игнорируется.
- Порты `7778/7779` — закрыты.
- ADB на `54321` — TCP открыт, handshake не отвечает.
- `gettvstate`, `getvolume`, `capability`, `sourcelist`, `applist` — ответов нет.
- Перебор `KEY_SETTINGS`, `KEY_SUBMENU`, `KEY_OPTIONS`, `KEY_PREFERENCES`,
  `KEY_CONFIG`, `KEY_SYSTEM_SETTINGS` — без эффекта. Работает именно
  `KEY_SETTING` (единственное число).
- `KEY_AUTO_FOCUS`, `KEY_FOCUS`, `KEY_AF`, `KEY_FOCUS_AUTO` — без видимого
  эффекта (проверка скриншотами).
- `KEY_SOURCE`, `KEY_INPUT`, `KEY_INPUTSOURCE`, `KEY_SOURCE_LIST`,
  `KEY_INPUT_LIST`, `KEY_TVINPUT`, `KEY_HDMI`, `KEY_SIGNAL` — без видимого
  эффекта.
- `changesource` с `sourceid` `3`/`4` — вход не переключился.

## Следующие шаги

1. Проверить `changesource` на другой прошивке/модели; на этой сервис молчит.
2. Найти способ перехватить облачные запросы приложения (прокси) — там точные
   имена действий для настроек, фокуса и входов.
3. Проверить Wake-on-LAN после включения `Network Standby` в настройках.
4. Если найдётся код автофокуса/избранного — заменить `data-key` в
   `public/index.html` и добавить код в `ALLOWED_KEYS`.
