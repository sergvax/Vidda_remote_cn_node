#!/usr/bin/env python3
"""Проверить кнопку: снимок до, нажатие, снимок после и процент отличий."""

import argparse
import io
import time
from pathlib import Path

from vidda import TV


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("key", help="например KEY_AUTOFOCUS")
    parser.add_argument("--delay", type=float, default=1.6, help="пауза после нажатия, сек")
    parser.add_argument("--outdir", default="shots", help="куда сохранять снимки")
    args = parser.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    tag = args.key.lower()

    tv = TV(client_id="vidda_probe")
    try:
        before = tv.screenshot()
        tv.key(args.key)
        time.sleep(args.delay)
        after = tv.screenshot()
    finally:
        tv.close()

    if not before or not after:
        print("не удалось получить скриншоты — проектор вернул пустой ответ")
        return 1

    before_path = outdir / f"{tag}_before.jpg"
    after_path = outdir / f"{tag}_after.jpg"
    before_path.write_bytes(before)
    after_path.write_bytes(after)

    try:
        from PIL import Image, ImageChops
    except ImportError:
        print(f"saved {before_path} and {after_path} (Pillow не установлен, diff пропущен)")
        return 0

    a = Image.open(io.BytesIO(before)).convert("RGB")
    b = Image.open(io.BytesIO(after)).convert("RGB")
    diff = ImageChops.difference(a, b)
    histogram = diff.convert("L").histogram()
    changed = sum(histogram[8:])
    total = a.size[0] * a.size[1]
    print(f"{args.key}: changed {changed}/{total} ({changed * 100 / total:.2f}%)")
    print(f"saved {before_path} and {after_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
