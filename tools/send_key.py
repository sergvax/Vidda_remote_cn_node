#!/usr/bin/env python3
"""Отправить одну или несколько кнопок на проектор."""

import argparse
import time

from vidda import TV, load_config


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("keys", nargs="+", help="например KEY_SETTING KEY_HOME")
    parser.add_argument("--delay", type=float, default=0.4, help="пауза между кнопками, сек")
    parser.add_argument("--config", help="путь к config.json")
    args = parser.parse_args()

    config = load_config(args.config) if args.config else None
    tv = TV(config=config)
    try:
        for key in args.keys:
            tv.key(key)
            print(f"sent {key}")
            time.sleep(args.delay)
    finally:
        tv.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
