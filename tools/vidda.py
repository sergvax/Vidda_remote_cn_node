"""Общие функции для инструментов Vidda Remote.

Читает config.json из корня проекта, подключается к MQTT проектора и умеет
отправлять кнопки, запрашивать скриншот и переключать входы.
"""

from __future__ import annotations

import json
import pathlib
import time

import paho.mqtt.client as mqtt

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.json"

MQTT_USER = "hisenseservice"
MQTT_PASS = "multimqttservice"


def load_config(path: str | pathlib.Path | None = None) -> dict:
    config_path = pathlib.Path(path) if path else CONFIG_PATH
    return json.loads(config_path.read_text(encoding="utf-8"))


def make_client(client_id: str = "vidda_tool") -> mqtt.Client:
    """Создаёт MQTT-клиент, совместимый с paho-mqtt 1.x и 2.x."""
    try:
        return mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=client_id,
            protocol=mqtt.MQTTv5,
        )
    except AttributeError:  # paho-mqtt 1.x
        return mqtt.Client(client_id=client_id, protocol=mqtt.MQTTv5)


class TV:
    def __init__(self, config: dict | None = None, client_id: str = "vidda_tool"):
        self.config = config or load_config()
        self.ip = self.config["ip"]
        self.cid = self.config["clientId"]
        self.port = int(self.config.get("port", 36669))
        self.on_event = None
        self._shot: bytes | None = None

        self.client = make_client(client_id)
        self.client.username_pw_set(MQTT_USER, MQTT_PASS)
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.connect(self.ip, self.port, 20)
        self.client.loop_start()
        time.sleep(1.2)

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        client.subscribe("#", qos=0)

    def _on_message(self, client, userdata, msg):
        if msg.topic.endswith("/hiservice/data/screenshot") and msg.payload[:2] == b"\xff\xd8":
            self._shot = msg.payload
        if self.on_event:
            self.on_event(msg.topic, msg.payload)

    def _action(self, action: str, payload: str = "") -> None:
        topic = f"/remoteapp/tv/hiservice_cmd/{self.cid}/actions/{action}"
        self.client.publish(topic, payload, qos=0)

    def key(self, key: str) -> None:
        self._action("sendkey", key)

    def source(self, source_id: str) -> None:
        """Вход задаётся строкой: HDMI_1, HDMI_2, HDMI_3, HDMI_4, LIVETV, VGA."""
        self._action("changesource", str(source_id))

    def start_app(self, package: str) -> None:
        self._action("startapp", json.dumps({"package": package}))

    def request_apps(self) -> None:
        self._action("getapplist")

    def volume(self, value: int) -> None:
        self._action("setvolume", str(int(value)))

    def mute(self, muted: bool) -> None:
        self._action("setmute", "true" if muted else "false")

    def play(self, command: str) -> None:
        self._action("playcontrol", command.upper())

    def focus(self, delay: float = 0.4) -> None:
        """Автофокус через встроенное меню проектора."""
        for key, pause in [
            ("KEY_HOME", 0.9),
            ("KEY_SETTING", 1.4),
            ("KEY_RIGHT", 0.5),
            ("KEY_DOWN", delay),
            ("KEY_DOWN", delay),
            ("KEY_DOWN", delay),
            ("KEY_DOWN", delay),
            ("KEY_OK", 0.0),
        ]:
            self.key(key)
            if pause:
                time.sleep(pause)

    def screenshot(self, timeout: float = 6.0) -> bytes | None:
        self._shot = None
        topic = f"/remoteapp/tv/hiservice_cmd/{self.cid}/actions/screenshot"
        self.client.publish(topic, "", qos=0)
        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(0.15)
            if self._shot:
                return self._shot
        return None

    def close(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()
