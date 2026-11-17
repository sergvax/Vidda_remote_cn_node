# Карта кнопок

Команды отправляются в топик:

```
/remoteapp/tv/hiservice_cmd/<clientId>/actions/sendkey
```

Payload — одно из значений ниже. Имена кнопок сверены с таблицей клавиш
официального приложения `WeShare` → `assets/keycode.xml` и проверены нажатиями
на реальном проекторе.

## Подтверждено на проекторе

| Кнопка | Payload | Keycode | Действие |
|---|---|---|---|
| Питание | `KEY_POWER` | 26 | выключение / сон (включение — WoL) |
| Вверх | `KEY_UP` | 19 | навигация |
| Вниз | `KEY_DOWN` | 20 | навигация |
| Влево | `KEY_LEFT` | 21 | навигация |
| Вправо | `KEY_RIGHT` | 22 | навигация |
| OK | `KEY_OK` | 23 | подтвердить |
| Назад | `KEY_RETURNS` | 4 | назад |
| Домой | `KEY_HOME` | 142 | домашний экран |
| Меню | `KEY_MENU` | 82 | меню |
| Громче | `KEY_VOLUMEUP` | 24 | громкость +1 |
| Тише | `KEY_VOLUMEDOWN` | 25 | громкость −1 |
| Mute | `KEY_MUTE` | 164 | без звука |
| Настройки | `KEY_SETTING` | — | встроенное меню проектора |
| Канал + | `KEY_CHANNELUP` | 166 | следующий канал |
| Канал − | `KEY_CHANNELDOWN` | 167 | предыдущий канал |

`KEY_SETTING` открывает меню проектора. В нём: `Auto Keystone`,
`Manual Keystone`, `Size and Position`, `Auto Screen Alignment`, `Auto Focus`,
`Manual Focus`, `Keystone Save`.

## Найдено в таблице клавиш, не проверено

| Кнопка | Payload | Keycode | Комментарий |
|---|---|---|---|
| Назад (дубль) | `KEY_BACKS` | 4 | тот же keycode, что у `KEY_RETURNS` |
| Возврат | `KEY_RESTS` | 176 | не проверено |
| Инфо | `KEY_INFO` | 17 | не проверено |
| Звезда | `KEY_STAR` | 17 | тот же keycode, что у `KEY_INFO` |
| Голос | `KEY_VOICECONTROL` | 4294 | не проверено |
| Alt | `KEY_ALTERNATES` | 18 | не проверено |
| Решётка | `KEY_POUND` | 18 | тот же keycode, что у `KEY_ALTERNATES` |
| Цифры | `KEY_0`…`KEY_9` | 7…16 | не проверено |

## Автофокус

Отдельного `KEY_AUTOFOCUS` на этой прошивке нет — код отправляется, но реакции
не было. Рабочая последовательность через меню:

```
KEY_SETTING → KEY_RIGHT → KEY_DOWN ×4 → KEY_OK
```

Она реализована в `POST /api/focus` и кнопке «Автофокус» в интерфейсе.

## Не поддерживается

| Кнопка | Payload | Что происходит |
|---|---|---|
| Яркость + | `KEY_BRIGHTUP` | ничего |
| Яркость − | `KEY_BRIGHTDOWN` | ничего |
| Задачи | `KEY_MULTITASK` | ничего |
| Центр управления | `KEY_CONTROL_CENTER` | ничего |

## Не сработавшие кандидаты

Перебирались нажатиями и проверялись скриншотами — видимой реакции нет:

```
KEY_SETTINGS        KEY_SETTING_MENU
KEY_SUBMENU         KEY_OPTIONS
KEY_PREFERENCES     KEY_CONFIG
KEY_SYSTEM_SETTINGS
KEY_AUTO_FOCUS      KEY_FOCUS
KEY_AF              KEY_FOCUS_AUTO
KEY_AUTOFOCUSING    KEY_AUTO_FOCUSING
KEY_AUTOFOCUS
KEY_FAV             KEY_FAVOURITE
KEY_FAVORITES       KEY_ADD_FAVORITE
KEY_FAVORITE        KEY_HEART
KEY_SOURCE          KEY_INPUT
KEY_INPUTSOURCE     KEY_SOURCE_LIST
KEY_INPUT_LIST      KEY_TVINPUT
KEY_HDMI            KEY_SIGNAL
KEY_SOURCES
```

«Избранное» через MQTT не найдено. Вместо неработающей кнопки пульт показывает
список приложений (`getapplist` + `startapp`).

## Где менять

- `server.js` → `ALLOWED_KEYS` — список разрешённых payload.
- `public/index.html` → кнопки с `data-key="..."`.
- `public/app.js` → клавиатурные сокращения и модальные окна.
- `config.json` → `sources` для переключения входов.

Если найдётся новый рабочий код, достаточно заменить `data-key` у кнопки и
добавить код в `ALLOWED_KEYS`.
