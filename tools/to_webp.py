# -*- coding: utf-8 -*-
"""把 extract.py 生成的透明 PNG 贴片转成网页用的 WebP（保留 alpha）。"""
import os
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPRITES = os.path.join(BASE, "assets", "sprites")
NAMES = ["bus", "bird1", "bird2", "bird3", "bird4", "bird6",
         "sign", "bench", "wheel0", "wheel1"]

total = 0
for name in NAMES:
    src = os.path.join(SPRITES, name + ".png")
    dst = os.path.join(SPRITES, name + ".webp")
    im = Image.open(src).convert("RGBA")
    im.save(dst, "WEBP", quality=82, method=6)
    size = os.path.getsize(dst)
    total += size
    print("%-7s %sx%s  %.1fKB" % (name, im.width, im.height, size / 1024))
print("total %.1fKB" % (total / 1024))
