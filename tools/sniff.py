#!/usr/bin/env python3
"""Слушать MQTT-трафик проектора и печатать топики с payload."""

import argparse
import time

from vidda import TV


def preview(payload: bytes) -> str:
    if payload[:2] == b"\xff\xd8":
        return f"<JPEG {len(payload)} bytes>"
    if payload[:1] == b"\x89" and payload[1:4] == b"PNG":
        return f"<PNG {len(payload)} bytes>"
    text = payload.decode("utf-8", errors="replace").strip()
    if not text:
        return "<empty>"
    return text[:500].replace("\n", " ")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-d", "--duration", type=float, default=60.0, help="сколько слушать, сек")
    parser.add_argument("--all", action="store_true", help="показывать и эхо команд /remoteapp/tv/")
    args = parser.parse_args()

    tv = TV(client_id="vidda_sniff")

    def on_event(topic: str, payload: bytes) -> None:
        if not args.all and topic.startswith("/remoteapp/tv/"):
            return
        stamp = time.strftime("%H:%M:%S")
        print(f"{stamp} {topic} -> {preview(payload)}", flush=True)

    tv.on_event = on_event
    print(f"listening {args.duration:.0f}s ...", flush=True)
    try:
        time.sleep(args.duration)
    except KeyboardInterrupt:
        pass
    finally:
        tv.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
