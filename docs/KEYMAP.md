# Карта кнопок

Команды отправляются в топик:

```
/remoteapp/tv/hiservice_cmd/<clientId>/actions/sendkey
```

Payload — одно из значений ниже.

## Подтверждено на проекторе

| Кнопка | Payload | Действие |
|---|---|---|
| Питание | `KEY_POWER` | выключение / сон |
| Вверх | `KEY_UP` | навигация |
| Вниз | `KEY_DOWN` | навигация |
| Влево | `KEY_LEFT` | навигация |
| Вправо | `KEY_RIGHT` | навигация |
| OK | `KEY_OK` | подтвердить |
| Назад | `KEY_RETURNS` | назад |
| Домой | `KEY_HOME` | домашний экран |
| Меню | `KEY_MENU` | меню |
| Громче | `KEY_VOLUMEUP` | громкость +1 |
| Тише | `KEY_VOLUMEDOWN` | громкость −1 |
| Mute | `KEY_MUTE` | без звука |
| Настройки | `KEY_SETTING` | встроенное меню проектора |

## Экспериментально

| Кнопка | Payload | Комментарий |
|---|---|---|
| Автофокус | `KEY_AUTOFOCUS` | код отправляется, видимой реакции не зафиксировано |
| Избранное | `KEY_FAVORITE` | код отправляется, реакция не подтверждена |

## Не поддерживается

| Кнопка | Payload | Что происходит |
|---|---|---|
| Яркость + | `KEY_BRIGHTUP` | ничего |
| Яркость − | `KEY_BRIGHTDOWN` | ничего |
| Задачи | `KEY_MULTITASK` | ничего |
| Центр управления | `KEY_CONTROL_CENTER` | ничего |
| Входы | `changesource` `{"sourceid":"3"}` | вход не переключился |

Для входов на этом проекторе остаётся домашний экран с боковой панелью
`HDMI 1 / HDMI 2` — в окне «Входы» есть кнопка «Домой».

## Кандидаты, которые не сработали

```
KEY_SETTINGS        KEY_SETTING_MENU
KEY_SUBMENU         KEY_OPTIONS
KEY_PREFERENCES     KEY_CONFIG
KEY_SYSTEM_SETTINGS
KEY_AUTO_FOCUS      KEY_FOCUS
KEY_AF              KEY_FOCUS_AUTO
KEY_AUTOFOCUSING    KEY_AUTO_FOCUSING
KEY_FAV             KEY_FAVOURITE
KEY_FAVORITES       KEY_ADD_FAVORITE
KEY_HEART
KEY_SOURCE          KEY_INPUT
KEY_INPUTSOURCE     KEY_SOURCE_LIST
KEY_INPUT_LIST      KEY_TVINPUT
KEY_HDMI            KEY_SIGNAL
KEY_SOURCES
```

## Где менять

- `server.js` → `ALLOWED_KEYS` — список разрешённых payload.
- `public/index.html` → кнопки с `data-key="..."`.
- `public/app.js` → клавиатурные сокращения и модальные окна.
- `config.json` → `sources` для переключения входов.

Если найдётся точный код автофокуса или избранного, достаточно заменить
`data-key` у соответствующей кнопки и добавить код в `ALLOWED_KEYS`.
