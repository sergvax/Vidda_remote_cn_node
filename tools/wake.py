#!/usr/bin/env python3
"""Отправить Wake-on-LAN magic packet на MAC-адреса проектора.

На проверенной прошивке (V0000.00.01R.P1228) Wi-Fi wakeup отключён
(network_wakeup=0), поэтому проектор на пакет не реагирует. Скрипт оставлен для
моделей, где сетевое ожидание действительно включено.
"""

import argparse
import socket

from vidda import load_config


def magic_packet(mac: str) -> bytes:
    hex_digits = "".join(ch for ch in mac if ch in "0123456789abcdefABCDEF")
    if len(hex_digits) != 12:
        raise ValueError(f"некорректный MAC: {mac}")
    mac_bytes = bytes.fromhex(hex_digits)
    return b"\xff" * 6 + mac_bytes * 16


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", help="путь к config.json")
    parser.add_argument("--port", type=int, action="append", help="порт (можно несколько)")
    args = parser.parse_args()

    config = load_config(args.config)
    macs = config.get("macs") or []
    if not macs:
        print("в config.json нет поля macs")
        return 1

    ports = args.port or [9, 7]
    ip = config.get("ip")
    targets = {"255.255.255.255"}
    if ip and ip.count(".") == 3:
        targets.add(".".join(ip.split(".")[:3]) + ".255")

    for mac in macs:
        packet = magic_packet(mac)
        for target in sorted(targets):
            for port in ports:
                sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                try:
                    sock.sendto(packet, (target, port))
                    print(f"{mac} -> {target}:{port}")
                finally:
                    sock.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
