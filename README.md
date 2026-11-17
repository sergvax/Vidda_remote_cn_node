# Vidda_remote_cn_node — пульт китайского проектора Vidda

Локальный веб-пульт для **китайского проектора Vidda (Hisense, VIDAA)**.
Работает целиком в домашней сети: Node.js-сервер общается с MQTT-брокером
проектора, а интерфейс открывается с телефона как обычная страница. Без облака,
аккаунта и официального приложения.

> Проверено на проекторе с DLNA-моделью `HiSmart` и прошивкой
> `V0000.00.01R.P1228`. Другие модели и регионы могут отличаться.
>
> Проект не аффилирован с Vidda, Hisense или их дочерними компаниями.


## Возможности

- D-pad, OK, «Назад», «Домой», «Меню».
- Громкость ±, mute, автоповтор при удержании.
- Кнопка скриншотов.
- **Настройки проектора** — открывает встроенное меню (`KEY_SETTING`).
- **Автофокус** — рабочая последовательность через меню проектора.
- **Приложения** — список с проектора (`getapplist`), запуск через `startapp`.
- **Входы** — переключение HDMI 1 / HDMI 2 командой `changesource`.
- **Экран проектора** — снимок экрана по MQTT по кнопке «Обновить».
- **Питание** — выключение командой и включение по Wake-on-LAN.
- Автопоиск проектора по UDP-broadcast, SSDP и сканированию порта `36669`;
  IP, MAC и `clientId` сохраняются в `config.json`.
- Статус подключения, состояние интерфейса и список приложений.
- PWA: можно добавить на домашний экран телефона.

## Скриншоты

| Пульт | Домашний экран проектора |
|---|---|
| ![Пульт](docs/screenshots/remote-ui.png) | ![Домашний экран](docs/screenshots/projector-home.jpg) |

| Меню настроек (`KEY_SETTING`) | Снимок экрана через MQTT |
|---|---|
| ![Настройки](docs/screenshots/projector-settings.jpg) |  |

## Быстрый старт

Нужен Node.js 18+ и Git.

```bash
git clone https://github.com/sergvax/Vidda_remote_cn_node.git
cd Vidda_remote_cn_node
npm install
npm start
```

Открыть на компьютере:

```
http://localhost:3000
```

С телефона (та же Wi-Fi сеть):

```
http://<IP-компьютера>:3000
```

IP компьютера:

```bash
ipconfig getifaddr en0
```

При первом запуске пульт сам ищет проектор: UDP-broadcast на `36671`, SSDP и
сканирование локальной сети по порту `36669`. Если не нашёл — нажми
кнопку-статус в правом верхнем углу и введи IP вручную. IP и `clientId` можно
задать и переменными окружения:

```bash
VIDDA_IP=<IP-проектора> VIDDA_CLIENT_ID=<любая-строка> npm start
```

`clientId` — произвольный идентификатор. Проектор не сверяет его с UDN и
отвечает под тем, который указан в топике.

## Кнопки

| Кнопка | Команда | Статус |
|---|---|---|
| Питание | `KEY_POWER` | ✅ выключает (включение — WoL) |
| Стрелки, OK | `KEY_UP/DOWN/LEFT/RIGHT`, `KEY_OK` | ✅ |
| Назад / Домой / Меню | `KEY_RETURNS`, `KEY_HOME`, `KEY_MENU` | ✅ |
| Громкость ± / Mute | `KEY_VOLUMEUP`, `KEY_VOLUMEDOWN`, `KEY_MUTE` | ✅ |
| Настройки | `KEY_SETTING` | ✅ открывает меню проектора |
| Автофокус | последовательность через меню | ✅ работает |
| Приложения | `getapplist` + `startapp` | ✅ запускает приложения |
| Входы | `changesource` + `HDMI_1`/`HDMI_2` | ✅ переключает HDMI 1 и 2 |
| Яркость ± | `KEY_BRIGHTUP/DOWN` | ❌ не поддерживается |
| Задачи, Центр | `KEY_MULTITASK`, `KEY_CONTROL_CENTER` | ❌ не поддерживается |

Подробный разбор кодов и топиков — в [docs/KEYMAP.md](docs/KEYMAP.md) и
[docs/PROTOCOL.md](docs/PROTOCOL.md).

### Автофокус

Отдельного MQTT-действия «автофокус» на этой прошивке нет. Пульт открывает
встроенное меню проектора и доходит до пункта `Auto Focus`:

```
KEY_HOME → KEY_SETTING → KEY_RIGHT → KEY_DOWN ×4 → KEY_OK
```

Это выполняет кнопка «Автофокус» (клавиша `F`) и `POST /api/focus`.

### Приложения

Кнопка «Приложения» (клавиша `A`) запрашивает `getapplist` и показывает список
установленных приложений. Нажатие на элемент отправляет `startapp` с именем
пакета. `startapp` принимает только пакет, activity-имена игнорируются.

### Входы

`changesource` принимает строку: `HDMI_1`, `HDMI_2`, `HDMI_3`, `HDMI_4`,
`LIVETV`, `VGA`. На проверенном проекторе работают только **`HDMI_1`** и
**`HDMI_2`**; `LIVETV` реакции не дал и в списке входов по умолчанию его нет.
Список входов задаётся в `config.json`.

## Экран проектора

Кнопка с камерой в шапке запрашивает снимок экрана через MQTT:

```
/remoteapp/tv/hiservice_cmd/<clientId>/actions/screenshot
```

Ответ приходит бинарным JPEG в топик:

```
/remoteapp/mobile/<clientId>/hiservice/data/screenshot
```

Интерфейс делает один снимок при открытии окна и обновляет его по кнопке
«Обновить». Автообновление специально не включено: проектор ограничивает частоту
снимков и после серии быстрых запросов начинает возвращать пустой ответ на
несколько минут. Пульт показывает понятную ошибку и продолжает работать.

## Включение проектора

MQTT-брокер доступен только когда проектор включён, поэтому `KEY_POWER` умеет
только выключать. Для включения пульт отправляет **Wake-on-LAN** magic packet на
MAC, полученный из `sendcastinfo` (`btAddress`), и сохранённый в `config.json`:

```json
"macs": ["<MAC>"]
```

MAC-адреса не захардкожены: если `macs` пустой, кнопка «Включить» вернёт
понятную ошибку и попросит заполнить `config.json`.

На проекторе должно быть разрешено сетевое ожидание (Network Standby / Wake on
LAN). На проверенном экземпляре после magic packet проектор стал отвечать на
ping и открыл порт `36669`.

## API

```
GET  /api/status               состояние, источники, приложения, громкость
POST /api/discover             повторный поиск проектора
POST /api/key                  {"key":"KEY_VOLUMEUP"}
POST /api/source               {"id":"HDMI_1"}
GET  /api/apps                 список приложений (getapplist)
POST /api/app                  {"package":"com.android.tv.settings"}
POST /api/volume               {"value":10}
POST /api/mute                 {"muted":true}
POST /api/play                 {"command":"PLAY"}   (PLAY/PAUSE/FAST_FORWORD/FAST_BACKWORD)
POST /api/focus                автофокус через меню проектора
POST /api/wake                 Wake-on-LAN
GET  /api/screenshot?fresh=1   JPEG-снимок экрана
POST /api/connect              переподключить MQTT
```

Пример:

```bash
curl -X POST http://localhost:3000/api/key \
  -H 'Content-Type: application/json' \
  -d '{"key":"KEY_SETTING"}'
```

## Конфигурация

`config.json` создаётся автоматически и не попадает в Git. Пример —
[`config.example.json`](config.example.json).

| Поле | Назначение |
|---|---|
| `ip` | IP проектора |
| `clientId` | произвольный идентификатор в топиках |
| `macs` | MAC-адреса для Wake-on-LAN |
| `sources` | список входов: `id` — `HDMI_1` / `HDMI_2` |

Переменные окружения:

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `3000` | Порт веб-пульта |
| `VIDDA_IP` | автопоиск | IP проектора |
| `VIDDA_PORT` | `36669` | MQTT-порт проектора |
| `VIDDA_CLIENT_ID` | генерируется | идентификатор в топиках |
| `VIDDA_USER` | `hisenseservice` | MQTT-логин |
| `VIDDA_PASS` | `multimqttservice` | MQTT-пароль |

## Ограничения

- **Громкость.** Проектор не присылает системную громкость ни по MQTT, ни по
  DLNA (DLNA всегда отдаёт 50). Пульт отправляет `setvolume`/`setmute`, но не
  показывает фактическое значение.
- **Состояние.** Надёжно определяется смена приложения (`appswitch`) и некоторые
  broadcast-состояния (`launcher`, `remote_setting`, `sourceswitch`).
- **Автофокус.** Работает только через встроенное меню; отдельного MQTT-кода нет.
- **Входы.** На проверенной прошивке переключаются только `HDMI_1` и `HDMI_2`.
- **Включение.** Wake-on-LAN зависит от настроек проектора.
- **Скриншоты.** Проектор ограничивает частоту снимков: после серии быстрых
  запросов несколько минут возвращает пустой ответ.

## Как это работает

Проектор держит MQTT-брокер на порту `36669` (`com.hisense.hiservice`,
Mosquitto) со статическими кредами:

```
username: hisenseservice
password: multimqttservice
```

Команды идут в топик:

```
/remoteapp/tv/hiservice_cmd/<clientId>/actions/<action>
```

Например:

```
action:  sendkey
payload: KEY_SETTING
```

Ответы приходят в `/remoteapp/mobile/<clientId>/hiservice/data/<name>`, состояния
— в `/remoteapp/mobile/broadcast/...`. Стандартный VIDAA-топик
`remote_service/sendkey` на этом проекторе игнорируется.

Полный разбор протокола, таблица действий и эксперименты — в
[docs/PROTOCOL.md](docs/PROTOCOL.md).

## Структура проекта

```
Vidda_remote_cn_node/
├── server.js              Node.js-сервер, автопоиск, MQTT, API
├── public/                HTML-пульт
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── manifest.webmanifest
│   └── icon.svg
├── docs/
│   ├── PROTOCOL.md        разбор протокола и эксперименты
│   ├── KEYMAP.md          таблица кодов кнопок
│   └── screenshots/       скриншоты пульта и проектора
├── tools/                 Python-утилиты для исследования
├── config.example.json
└── package.json
```

## Инструменты исследования

В [`tools/`](tools/) лежат скрипты, которыми искали протокол:

```bash
python3 -m pip install -r tools/requirements.txt
python3 tools/send_key.py KEY_SETTING
python3 tools/screenshot.py -o screen.jpg
python3 tools/sniff.py -d 60
python3 tools/probe_key.py KEY_MENU
python3 tools/wake.py
```

Они читают `config.json` и работают напрямую с MQTT проектора.

## Безопасность

Пульт не имеет авторизации и доступен всем в локальной сети. Не выставляй порт
`3000` в интернет. Если это важно — reverse-proxy с паролем или токен в API.

## Благодарности

- `pyvidaa` — описание VIDAA-протокола.
- `vidda_fish` — рабочий топик `hiservice_cmd`.
- Официальный веб-пульт HiSmart — базовый список `KEY_*`.

## Лицензия

MIT — см. [LICENSE](LICENSE).

Проект не аффилирован с Vidda, Hisense, VIDAA и их дочерними компаниями.
Названия продуктов и товарные знаки принадлежат их владельцам. Всё
взаимодействие идёт с собственным устройством в локальной сети.
