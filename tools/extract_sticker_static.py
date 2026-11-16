# -*- coding: utf-8 -*-
"""Extract the bus, sign and hub-centred wheels to a new candidate directory.

The input is the supplied 1536x1024 RGBA sticker sheet. This helper never writes
production assets. Run it with isolated mode and explicit source/output paths:
    python -I tools/extract_sticker_static.py --source /path/sticker.png --out /path/new-dir
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

REGIONS = {
    "bus": (70, 0, 1010, 420),
    "sign": (1245, 0, 1536, 1024),
    "wheel0": (145, 410, 330, 555),
    "wheel1": (565, 410, 755, 555),
}
# Wheel order follows the supplied sheet: left first. Hub centres, not silhouette
# bounding-box centres, must be used as pivots when the irregular drawings rotate.
HUBS = {"wheel0": (227, 491), "wheel1": (653, 491)}
ALPHA_FLOOR = 20


def extract(sheet, region):
    x0, y0, x1, y1 = region
    part = sheet[y0:y1, x0:x1].copy()
    original_alpha = part[:, :, 3].copy()
    components = (original_alpha > 32).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(components, 8)
    if count <= 1:
        raise ValueError("No foreground in region %s" % (region,))
    largest = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    keep = (labels == largest).astype(np.uint8)
    # Keep nearby antialiased pixels but not isolated neighboring elements.
    keep = cv2.dilate(keep, np.ones((3, 3), np.uint8), iterations=2) > 0
    cleaned = np.clip((original_alpha.astype(np.float32) - ALPHA_FLOOR)
                      * (255.0 / (254 - ALPHA_FLOOR)), 0, 255).astype(np.uint8)
    part[:, :, 3] = np.where(keep, cleaned, 0)
    part[part[:, :, 3] == 0, :3] = 0
    return part


def trim(part, region):
    ys, xs = np.nonzero(part[:, :, 3])
    if not len(xs):
        raise ValueError("Empty extraction")
    x0, y0, _, _ = region
    xlo, xhi = int(xs.min()), int(xs.max()) + 1
    ylo, yhi = int(ys.min()), int(ys.max()) + 1
    return part[ylo:yhi, xlo:xhi], [x0 + xlo, y0 + ylo, x0 + xhi, y0 + yhi]


def pad_wheel(part, region, hub):
    x0, y0, _, _ = region
    ys, xs = np.nonzero(part[:, :, 3])
    if not len(xs):
        raise ValueError("Empty wheel extraction")
    x_abs, y_abs = xs + x0, ys + y0
    hx, hy = hub
    half = int(np.ceil(np.hypot(x_abs - hx, y_abs - hy).max())) + 3
    canvas = np.zeros((2 * half, 2 * half, 4), np.uint8)
    dst_x, dst_y = x_abs - hx + half, y_abs - hy + half
    canvas[dst_y, dst_x] = part[ys, xs]
    return canvas, [hx - half, hy - half, hx + half, hy + half], half


def make_checks(images, out):
    cell_w, cell_h = 360, 260
    preview = Image.new("RGB", (cell_w * 4, cell_h * len(images)), (42, 42, 50))
    draw = ImageDraw.Draw(preview)
    backgrounds = [(255, 255, 255), (0, 0, 0), (178, 204, 222), None]
    for row, (name, im) in enumerate(images.items()):
        thumb = im.copy()
        thumb.thumbnail((cell_w - 20, cell_h - 40), Image.Resampling.LANCZOS)
        for col, bg in enumerate(backgrounds):
            panel = Image.new("RGB", (cell_w - 10, cell_h - 30), bg or (225, 225, 225))
            if bg is None:
                p = ImageDraw.Draw(panel)
                for y in range(0, panel.height, 16):
                    for x in range(0, panel.width, 16):
                        if (x // 16 + y // 16) % 2:
                            p.rectangle((x, y, x + 15, y + 15), fill=(185, 185, 185))
            panel.paste(thumb, ((panel.width - thumb.width) // 2,
                                (panel.height - thumb.height) // 2), thumb)
            preview.paste(panel, (col * cell_w + 5, row * cell_h + 25))
        draw.text((5, row * cell_h + 5), name, fill="white")
    preview.save(out / "four_backgrounds.png")

    panel = Image.new("RGBA", (4 * 190, 2 * 210), (210, 225, 235, 255))
    draw = ImageDraw.Draw(panel)
    for row, name in enumerate(("wheel0", "wheel1")):
        for col, degrees in enumerate((0, 45, 90, 135)):
            rotated = images[name].rotate(degrees, resample=Image.Resampling.BICUBIC)
            panel.alpha_composite(rotated, (col * 190 + (190 - rotated.width) // 2,
                                            row * 210 + 30))
            draw.text((col * 190 + 8, row * 210 + 8), f"{name} {degrees}°", fill=(0, 0, 0))
    panel.convert("RGB").save(out / "wheel_rotations.png")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path,
                        help="New candidate directory; an existing directory is never overwritten")
    args = parser.parse_args()
    sheet = np.asarray(Image.open(args.source).convert("RGBA"))
    if sheet.shape != (1024, 1536, 4):
        raise ValueError("Expected a 1536x1024 RGBA sticker sheet")
    args.out.mkdir(parents=True, exist_ok=False)
    images = {}
    details = {}
    for name, region in REGIONS.items():
        part = extract(sheet, region)
        if name in HUBS:
            part, rect, half = pad_wheel(part, region, HUBS[name])
            details[name] = {"source_rect": rect, "hub": list(HUBS[name]), "half_size": half}
        else:
            part, rect = trim(part, region)
            details[name] = {"source_rect": rect}
        im = Image.fromarray(part, "RGBA")
        images[name] = im
        im.save(args.out / (name + ".png"))
        print(name, rect, im.size)
    (args.out / "static_parts.json").write_text(
        json.dumps(details, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    make_checks(images, args.out)


if __name__ == "__main__":
    main()
