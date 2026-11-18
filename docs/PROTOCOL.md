# Протокол Vidda / Hisense — заметки по реверсу

Всё ниже получено на реальном **китайском проекторе Vidda (Hisense, VIDAA)**.
Прошивка отвечает на MQTT, но не на стандартный VIDAA-пульт из некоторых
интеграций.

Сетевые идентификаторы (IP, MAC, UDN, серийный номер, device ID) в репозитории
не публикуются. IP, MAC и `clientId` определяются автоматически и хранятся
только в локальном `config.json`.

## Устройство

| Параметр | Значение |
|---|---|
| DLNA modelName | `HiSmart` |
| Прошивка | `V0000.00.01R.P1228` |
| MQTT-порт | `36669` |
| transport_protocol | `1` |

`clientId` — произвольная строка. Проектор не сверяет её с UDN: он отвечает и
публикует данные под тем идентификатором, который указан в топике. Поэтому пульт
генерирует собственный `clientId` вида `vidda_remote_<12 hex>` и сохраняет его в
`config.json`. UDN из DLNA больше не нужен.

## Порты

| Порт | Что отвечает |
|---|---|
| `36669` | MQTT-брокер (рабочий канал управления) |
| `36671` | UDP-оповещение о устройстве (используется при автопоиске) |
| `38400` | DLNA (рендерер, громкость не отражает) |
| `7002`, `7100` | HTTP-подобный сервис, на любой запрос `501 Not Implemented` |
| `9779` | «домашнее облако», снаружи не отвечает |
| `54321` | ADB: TCP открыт, но handshake не отвечает |
| `7778`, `7779` | закрыты |

## Автопоиск

Пульт находит проектор тремя способами, по порядку:

1. **UDP-broadcast на порт `36671`** — устройство отвечает пакетом со своими
   данными.
2. **SSDP** (`M-SEARCH` на `239.255.255.250:1900`) — на проверенном экземпляре
   SSDP закрыт, ветка оставлена как резервная.
3. **Сканирование локальной сети** — TCP-подключение к порту `36669` по всем
   адресам своей `/24`.

Найденный кандидат проверяется командой `getcastinfo`: проектор присылает
`sendcastinfo` с моделью и именем. Поле `btAddress` — это Bluetooth-адрес, а не
Wi-Fi MAC, поэтому для Wake-on-LAN оно не используется. Если автопоиск ничего не
нашёл, IP можно ввести вручную — в окне подключения или через переменную
`VIDDA_IP`.

## Брокер

MQTT-брокер — это **`com.hisense.hiservice`** (`MosquittoBrokerService`), который
поднимает встроенный Mosquitto. Диспетчер команд — `HiServiceCmdMqttClient`
(слушает `/remoteapp/tv/hiservice_cmd/#`), обработчик — `DataTransportNative`
через `HiserviceCmdCallback`.

Подключение — обычный MQTT 5 по TCP, без TLS:

```
host: <IP проектора>
port: 36669
username: hisenseservice
password: multimqttservice
protocol: MQTT 5
```

Креды статические, взяты из нативного `libmqttcrypt.so` официального APK.

## Топики

Схема топиков:

```
/remoteapp/<direction>/<target>/<source>/<method>/<command>
```

| Назначение | Топик |
|---|---|
| Команды | `/remoteapp/tv/hiservice_cmd/<clientId>/actions/<action>` |
| Ответы на запросы | `/remoteapp/mobile/<clientId>/hiservice/data/<name>` |
| Broadcast-состояния | `/remoteapp/mobile/broadcast/hiservice/data/<name>` |
| Состояние UI | `/remoteapp/mobile/broadcast/ui_service/state` |

Стандартный VIDAA-топик:

```
/remoteapp/tv/remote_service/<clientId>/actions/sendkey
```

на этом проекторе **игнорируется**. Именно поэтому интеграции, которые шлют
только в `remote_service`, «не видят» кнопки. Рабочий префикс — `hiservice_cmd`.

Брокер отдаёт подписчику его же публикации в `/remoteapp/tv/...` (эхо), поэтому
при sniff-е нужно фильтровать собственные сообщения.

## Действия

Полный список действий, найденных в `com.hisense.hiservice`:

| Действие | Payload | Статус |
|---|---|---|
| `sendkey` | `KEY_*` | ✅ подтверждено |
| `screenshot` | пусто | ✅ подтверждено |
| `getcastinfo` | пусто | ✅ подтверждено |
| `changesource` | `HDMI_1`…`HDMI_4`, `LIVETV`, `VGA` | ✅ HDMI_1/HDMI_2 |
| `getapplist` | пусто | ✅ подтверждено |
| `startapp` | `{"package":"..."}` | ✅ подтверждено |
| `setvolume` | целое число | ✅ подтверждено |
| `setmute` | `true` / `false` | ✅ подтверждено |
| `playcontrol` | `PLAY` / `PAUSE` / `FAST_FORWORD` / `FAST_BACKWORD` | найдено в коде |
| `startpage` | `KARAOKE` / `MOVIE` | найдено в коде |
| `deviceconnect` | `SEND_DEVICE_CONNECT$<имя>` | служебное |
| `changetvname` | новое имя | служебное |
| `voice` | аудиопоток | служебное |
| `initbluetooth` | — | служебное |
| `bluetoothconnectstate` | — | служебное |
| `lastwill` | — | служебное |
| `tvscreenstate` | — | служебное |
| `changeaudiooutput` | — | служебное |
| `setlaserscreenstate` | `true` / `false` | найдено в коде |
| `changelasertvinstallation` | — | найдено в коде |
| `changeimagemode` | — | найдено в коде |

Проверены на реальном проекторе только строки со статусом «подтверждено».
Остальные найдены статическим разбором APK и могут отличаться на прошивке.

## Кнопки (sendkey)

Payload — имя кнопки. Имена сверены с таблицей клавиш официального приложения
`WeShare` → `assets/keycode.xml`.

```
KEY_POWER
KEY_UP KEY_DOWN KEY_LEFT KEY_RIGHT KEY_OK
KEY_RETURNS KEY_HOME KEY_MENU
KEY_VOLUMEUP KEY_VOLUMEDOWN KEY_MUTE
KEY_SETTING
KEY_CHANNELUP KEY_CHANNELDOWN
KEY_INFO KEY_STAR
KEY_VOICECONTROL KEY_RESTS
KEY_ALTERNATES KEY_POUND
KEY_0 … KEY_9
```

`KEY_SETTING` открывает встроенное меню проектора — подтверждено скриншотом.
В меню есть пункты `Auto Keystone`, `Manual Keystone`, `Size and Position`,
`Auto Screen Alignment`, `Auto Focus`, `Manual Focus`, `Keystone Save`.

Не поддерживаются (проверено нажатием и скриншотами):

```
KEY_BRIGHTUP KEY_BRIGHTDOWN
KEY_MULTITASK
KEY_CONTROL_CENTER
```

Отдельного `KEY_AUTOFOCUS` на этой прошивке нет: код отправляется, но реакции
не было. Рабочий автофокус — через меню (см. ниже).

## Автофокус

Прямого MQTT-действия «автофокус» не найдено. `com.hisense.screen` содержит
`ElectricFocusingActivity` и broadcast `com.hisense.CalibrationFocus_ACTION`, но
`startapp` запускает только launcher-пакет и не принимает имя activity.

Рабочий путь — встроенное меню:

```
KEY_SETTING → KEY_RIGHT → KEY_DOWN ×4 → KEY_OK
```

После `KEY_SETTING` фокус стоит на левой категории `Projector`. `KEY_RIGHT`
входит в список, четыре `KEY_DOWN` доводят до пункта `Auto Focus`, `KEY_OK`
запускает фокус и закрывает меню. Именно эту последовательность выполняет
`POST /api/focus`.

## Входы

Рабочее действие:

```
/remoteapp/tv/hiservice_cmd/<clientId>/actions/changesource
payload: HDMI_1
```

Payload — **строка**, а не JSON. Допустимые значения из кода:
`HDMI_1`, `HDMI_2`, `HDMI_3`, `HDMI_4`, `LIVETV`, `VGA`.

| Значение | Результат на проверенной прошивке |
|---|---|
| `HDMI_1` | ✅ вход переключился (смена кадра 76.99%) |
| `HDMI_2` | ✅ вход переключился (смена кадра 76.93%) |
| `LIVETV` | ❌ реакции нет (0.02%) |

После переключения проектор присылает
`/remoteapp/mobile/<clientId>/hiservice/data/changesourceresult`.

Старый VIDAA-сервис `ui_service/changesource` с JSON `{"sourceid":"3"}`
на этой прошивке не работает — вход не меняется.

## Приложения

Запрос списка:

```
/remoteapp/tv/hiservice_cmd/<clientId>/actions/getapplist
payload: ""
```

Ответ приходит JSON-массивом в:

```
/remoteapp/mobile/<clientId>/hiservice/data/getapplist
```

Элемент списка содержит как минимум `name` и `package`. На проверенном
проекторе вернулось 34 приложения.

Запуск:

```
/remoteapp/tv/hiservice_cmd/<clientId>/actions/startapp
payload: {"package":"com.android.tv.settings"}
```

`startapp` принимает **только имя пакета**. Строки с activity
(`com.pkg/.Activity`, `com.pkg/com.pkg.Activity`) игнорируются. При успешном
переключении приходит broadcast
`/remoteapp/mobile/broadcast/hiservice/data/appswitch`:

```json
{"from":"com.meetingroom","to":"com.android.tv.settings"}
```

Значение `com.meetingroom` — домашний экран/лаунчер.

## Избранное

«Избранное» — не команда проектора, а локальная настройка пульта. Список
пакетов хранится в `config.json` (поле `favorites`) и общий для всех устройств
в сети. Кнопки избранного просто запускают приложение тем же действием
`startapp`.

`getapplist` возвращает только `name` и `package`, без иконок. Поэтому пульт
рисует буквенный аватар: первую букву названия и стабильный цвет, вычисленный
из имени пакета.

## Громкость и звук

Проверенные действия:

```
setvolume  payload: 10        → громкость 10
setmute    payload: true      → без звука
setmute    payload: false     → звук обратно
```

Broadcast-топики громкости (`platform_service/actions/volumechange`,
`ui_service/volume`) на этом проекте не наблюдались, поэтому пульт не показывает
фактическую громкость — только отправляет команду.

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

Скриншот отдаёт полноценный кадр 1920×1080, включая OSD/субтитры. Если сервис
занят или превышен лимит, приходит **пустой payload**.

У сервиса есть ограничение частоты: после серии быстрых снимков (примерно 8–10
запросов подряд) проектор несколько минут возвращает пустые ответы, затем
восстанавливается. Поэтому в пульте нет автообновления: снимок делается при
открытии окна и по кнопке «Обновить».

## Питание, экран и Wake-on-LAN

### Что доступно через hiservice

Полный список действий диспетчера `HiServiceCmdMqttClient.onMessageReceived`:

```
sendkey, input, screenshot, voice, deviceconnect, changetvname, lastwill,
tvscreenstate, getcastinfo, changesource, initbluetooth, bluetoothconnectstate,
playcontrol, setvolume, setmute, changeaudiooutput, getapplist, startapp,
startpage, setlaserscreenstate, changelasertvinstallation, changeimagemode
```

- `setlaserscreenstate` (`true`/`false`) — гасит и возвращает изображение/лазер,
  не переводя устройство в standby. MQTT и сеть продолжают работать.
- `tvscreenstate` (`SET_TV_SCREEN_ON`) — в обычном режиме только сообщает
  состояние. В fake standby отправляет broadcast `com.hisense.wow_state.exit`.
- `KEY_POWER` — настоящий standby: Wi-Fi и MQTT отключаются.

### Почему Wake-on-LAN не работает

Действие `deviceconnect` возвращает DLNA-конфиг (`multiconfig`) и состояние
fake standby. На проверенном экземпляре:

```
fakestandbystate false
network_wakeup=0
```

`network_wakeup` формируется в `TVInforUtils.getfilenContent()` из свойства
`ro.his.tv.wifi_wakeup_support`: если оно не равно `1`, флаг принудительно
сбрасывается в `0`. Значение `0` в ответе означает, что Wi-Fi пробуждение
отключено на уровне прошивки, а не настройки пользователя.

Дополнительно проверено:

- `sendcastinfo` отдаёт только `btAddress` — это Bluetooth-адрес, а не Wi-Fi MAC.
- Wi-Fi MAC виден в `About → Info`; magic packet на него и на соседние адреса
  того же чипа, на порты `9`/`7`, broadcast и unicast, при выключенном проекторе
  не пробуждает его.
- Пункта «网络唤醒» / Wake on LAN в быстром меню нет; в `General → ON/OFF`
  доступны только Startup Source, Startup Image, Sleep Timer, Standby,
  Standby/Power-on Light Effects и On and Start.

Поэтому пульт использует `setlaserscreenstate` как рабочее «выключение»:
устройство остаётся в сети, а «Включить» возвращает изображение по MQTT.

### Запасной вариант

`wake()` в `server.js` по-прежнему умеет отправлять magic packet на адреса из
`macs` — для других моделей, где `network_wakeup=1`. Если экран был выключен
через пульт, `/api/wake` вместо этого включает его по MQTT.

## Что пробовалось и не сработало

- `remote_service/sendkey` — игнорируется.
- Порты `7778/7779` — закрыты, SSDP на `1900` закрыт.
- ADB на `54321` — TCP открыт, handshake не отвечает.
- `gettvstate`, `getvolume`, `capability`, `sourcelist` — ответов нет.
- Перебор `KEY_SETTINGS`, `KEY_SUBMENU`, `KEY_OPTIONS`, `KEY_PREFERENCES`,
  `KEY_CONFIG`, `KEY_SYSTEM_SETTINGS` — без эффекта. Работает именно
  `KEY_SETTING` (единственное число).
- `KEY_AUTO_FOCUS`, `KEY_FOCUS`, `KEY_AF`, `KEY_FOCUS_AUTO` — без видимого
  эффекта (проверка скриншотами).
- `KEY_SOURCE`, `KEY_INPUT`, `KEY_INPUTSOURCE`, `KEY_SOURCE_LIST`,
  `KEY_INPUT_LIST`, `KEY_TVINPUT`, `KEY_HDMI`, `KEY_SIGNAL` — без эффекта.
- `ui_service/changesource` с `{"sourceid":"3"}` — вход не переключился.
- `LIVETV` через `hiservice_cmd/changesource` — реакции нет.
- «Избранное» через MQTT не найдено; вместо этого в пульте список приложений.

## Ограничения разбора

- Полный `hiservice_keycode.xml` недоступен: APK `JuThirdJump` обрезан, а
  системный файл на проекторе без root/ADB не достать. Таблица клавиш собрана по
  `WeShare/assets/keycode.xml` и проверена нажатиями.
- `startapp` не принимает activity-имена, поэтому экраны вроде
  `ElectricFocusingActivity` напрямую не запускаются.
- DLNA `GetVolume` всегда возвращает `50` и не связан с системной громкостью.

## Следующие шаги

1. Проверить `changesource` для `HDMI_3`/`HDMI_4`/`VGA` на подходящем железе.
2. Проверить `playcontrol` и `startpage` на экране с видео.
3. Найти способ перехватить облачные запросы официального приложения — там
   могут быть точные действия для фокуса и избранного.
4. Проверить `setlaserscreenstate` на других моделях: на одних он гасит только
   матрицу, на других — лазер целиком.
