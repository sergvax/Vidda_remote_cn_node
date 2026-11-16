#!/usr/bin/env python3
"""Запросить скриншот экрана проектора и сохранить его в JPEG."""

import argparse
import sys

from vidda import TV


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-o", "--output", default="projector.jpg", help="файл для сохранения")
    parser.add_argument("--timeout", type=float, default=6.0, help="таймаут ожидания, сек")
    args = parser.parse_args()

    tv = TV()
    try:
        data = tv.screenshot(timeout=args.timeout)
    finally:
        tv.close()

    if not data:
        print(
            "Проектор не вернул JPEG. Иногда сервис скриншотов временно отдаёт "
            "пустой ответ — попробуй ещё раз позже.",
            file=sys.stderr,
        )
        return 1

    with open(args.output, "wb") as fh:
        fh.write(data)
    print(f"saved {args.output} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
