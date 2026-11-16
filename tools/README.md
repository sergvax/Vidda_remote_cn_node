# Инструменты исследования

Python-утилиты, которыми разбирался протокол проектора. Работают напрямую с
MQTT-брокером на порту `36669` и читают `config.json` из корня проекта.

## Установка

```bash
python3 -m pip install -r tools/requirements.txt
```

`Pillow` нужен только для `probe_key.py` (сравнение снимков).

## Скрипты

| Скрипт | Назначение |
|---|---|
| `send_key.py KEY` | отправить кнопку (можно несколько) |
| `screenshot.py` | сохранить JPEG-снимок экрана проектора |
| `sniff.py` | слушать все топики и печатать, что приходит |
| `probe_key.py KEY` | снимок до/после кнопки + процент отличий |
| `wake.py` | отправить Wake-on-LAN на MAC из конфига |

## Примеры

```bash
python3 tools/send_key.py KEY_VOLUMEUP
python3 tools/send_key.py KEY_SETTING KEY_RETURNS
python3 tools/screenshot.py -o screen.jpg
python3 tools/sniff.py -d 120
python3 tools/probe_key.py KEY_AUTOFOCUS
python3 tools/wake.py
```

## Как искать новую кнопку

1. Переведи проектор на стабильный экран (например, «Домой»), чтобы видео не
   меняло кадры само по себе.
2. Запусти `python3 tools/probe_key.py KEY_ИМЯ`.
3. Посмотри на `shots/key_имя_after.jpg`. Если появилось меню/OSD — код рабочий.
4. Добавь код в `ALLOWED_KEYS` в `server.js` и в кнопку в `public/index.html`.

Для видео процент отличий будет большим даже без реакции на кнопку — поэтому
сравнивать нужно именно стабильный экран.
