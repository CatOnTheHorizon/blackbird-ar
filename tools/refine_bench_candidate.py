#!/usr/bin/env python3
"""Build a transparent bench cutout from the flattened sticker sheet.

Run outside the input directory with Python 3.10 isolated mode:
    py -3.10 -I tools/refine_bench_candidate.py --source PATH_TO_STICKER_PNG

The only generated files are written under tools/sticker_src/bench_refined/.
The source PNG is read-only; no production assets or existing candidates are changed.
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "tools" / "sticker_src" / "sticker.png"
DEFAULT_OUT = ROOT / "tools" / "sticker_src" / "bench_refined"
OUT = DEFAULT_OUT

# Half-open source coordinates in the original 1536x1024 sheet.
SOURCE_RECT = (35, 830, 1230, 995)
DONOR_RECT = (425, 833, 469, 861)  # validated clean 44x28 row strip
DONOR_EXTENSION_RECT = (425, 861, 469, 865)  # same unobstructed board, extends contact patch to 32px
SUPPORT_RECTS = ((200, 847, 253, 989), (990, 847, 1045, 989))

# Continuous source-aligned cleanup span, converted to output-local x.
SOURCE_CONTACT_SPAN = (65, 1178)
CONTACT_SPAN = (SOURCE_CONTACT_SPAN[0] - SOURCE_RECT[0], SOURCE_CONTACT_SPAN[1] - SOURCE_RECT[0])
CONTACT_SOURCE_Y = (833, 865)
SKY = (183, 211, 222, 255)


def clean_alpha(alpha):
    """Drop the faint sheet glow while retaining antialiased artwork edges."""
    lut = [max(0, min(255, round((value - 20) * 255 / (254 - 20)))) for value in range(256)]
    return alpha.point(lut)


def bench_shape_mask(size):
    """Restrict the sheet crop to the two rails and both metal supports."""
    x0, y0, _, _ = SOURCE_RECT
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)

    def local(points):
        return [(x - x0, y - y0) for x, y in points]

    draw.polygon(local([(60, 834), (1215, 834), (1221, 843), (1221, 872),
                        (1210, 887), (70, 887), (59, 879)]), fill=255)
    draw.polygon(local([(60, 900), (1215, 900), (1221, 909), (1221, 951),
                        (1210, 966), (70, 966), (59, 959)]), fill=255)
    draw.polygon(local([(200, 847), (253, 847), (253, 988), (200, 988)]), fill=255)
    draw.polygon(local([(990, 847), (1045, 847), (1045, 988), (990, 988)]), fill=255)
    return mask


def composite_on(image, color):
    bg = Image.new("RGBA", image.size, color)
    bg.alpha_composite(image.convert("RGBA"))
    return bg.convert("RGB")


def add_label(image, text):
    draw = ImageDraw.Draw(image)
    draw.rectangle((4, 4, min(image.width - 1, 12 + len(text) * 7), 23), fill=(20, 25, 31))
    draw.text((8, 7), text, fill=(255, 255, 255))


def make_background_checks(bench):
    specs = (("black", (0, 0, 0, 255)),
             ("white", (255, 255, 255, 255)),
             ("sky", SKY))
    panels = []
    for name, color in specs:
        panel = composite_on(bench, color).resize((bench.width * 2, bench.height * 2), Image.Resampling.NEAREST)
        add_label(panel, f"bench on {name}")
        panels.append(panel)
    out = Image.new("RGB", (panels[0].width, sum(p.height for p in panels) + 24), (85, 85, 85))
    y = 0
    for panel in panels:
        out.paste(panel, (0, y))
        y += panel.height + 12
    out.save(OUT / "bench_background_checks.png")

    sky = composite_on(bench, SKY).resize((bench.width * 2, bench.height * 2), Image.Resampling.NEAREST)
    add_label(sky, "full bench on sky")
    sky.save(OUT / "bench_sky_check.png")


def make_closeups(bench):
    panels = []
    y0 = CONTACT_SOURCE_Y[0] - SOURCE_RECT[1]
    y1 = CONTACT_SOURCE_Y[1] - SOURCE_RECT[1]
    x0, x1 = CONTACT_SPAN
    crop = bench.crop((x0, y0, x1, y1 + 5))
    panel = composite_on(crop, SKY).resize((crop.width * 2, crop.height * 2), Image.Resampling.NEAREST)
    add_label(panel, f"continuous contact repair: local x={x0}..{x1}, source y=833..865")
    panels.append(panel)

    bg_specs = (("black", (0, 0, 0, 255)),
                ("white", (255, 255, 255, 255)),
                ("sky", SKY))
    for title, rect in (("left support", (165, 0, 285, 165)),
                        ("right support / hardware", (925, 0, 1040, 165))):
        crop = bench.crop(rect)
        bg_panels = []
        for name, color in bg_specs:
            panel = composite_on(crop, color).resize((crop.width * 4, crop.height * 4), Image.Resampling.NEAREST)
            add_label(panel, f"{title} on {name}")
            bg_panels.append(panel)
        row = Image.new("RGB", (sum(p.width for p in bg_panels) + 24, bg_panels[0].height), (85, 85, 85))
        x = 0
        for panel in bg_panels:
            row.paste(panel, (x, 0))
            x += panel.width + 12
        panels.append(row)

    out = Image.new("RGB", (max(p.width for p in panels), sum(p.height for p in panels) + 12 * len(panels)), (85, 85, 85))
    y = 0
    for panel in panels:
        out.paste(panel, (0, y))
        y += panel.height + 12
    out.save(OUT / "bench_closeups.png")


def build(source_path):
    sheet = Image.open(source_path).convert("RGBA")
    if sheet.size != (1536, 1024):
        raise ValueError(f"Expected a 1536x1024 RGBA source, got {sheet.size} {sheet.mode}")

    bench = sheet.crop(SOURCE_RECT)
    shape = bench_shape_mask(bench.size)
    alpha = ImageChops.multiply(clean_alpha(bench.getchannel("A")), shape)
    # The output crop begins above the bench; clear that band explicitly.
    alpha.paste(0, (0, 0, bench.width, 833 - SOURCE_RECT[1]))
    bench.putalpha(alpha)

    # Build a 44x32 RGBA donor from the validated [833,861) strip plus its clean
    # four-row continuation, then REPLACE pixels across the complete contact span.
    core = sheet.crop(DONOR_RECT)
    extension = sheet.crop(DONOR_EXTENSION_RECT)
    donor = Image.new("RGBA", (core.width, core.height + extension.height), (0, 0, 0, 0))
    donor.paste(core, (0, 0))
    donor.paste(extension, (0, core.height))
    donor.putalpha(clean_alpha(donor.getchannel("A")))
    patch_y = CONTACT_SOURCE_Y[0] - SOURCE_RECT[1]
    patch_height = CONTACT_SOURCE_Y[1] - CONTACT_SOURCE_Y[0]
    span_x0, span_x1 = CONTACT_SPAN
    x = span_x0
    while x < span_x1:
        width = min(donor.width, span_x1 - x)
        tile = donor.crop((0, 0, width, patch_height))
        tile_box = (x, patch_y, x + width, patch_y + patch_height)
        tile_alpha = ImageChops.multiply(tile.getchannel("A"), shape.crop(tile_box))
        tile.putalpha(tile_alpha)
        # No alpha compositing here: transparent donor pixels must erase old
        # tail/foot RGB and alpha inside the replacement span.
        bench.paste(tile, (x, patch_y))
        x += width

    # Reapply both source supports after the tiled row copies. This also preserves the
    # near-right hardware and restores the left post where its edge meets window 1.
    for support_rect in SUPPORT_RECTS:
        support = sheet.crop(support_rect)
        local_x = support_rect[0] - SOURCE_RECT[0]
        local_y = support_rect[1] - SOURCE_RECT[1]
        support_box = (local_x, local_y, local_x + support.width, local_y + support.height)
        support_alpha = ImageChops.multiply(clean_alpha(support.getchannel("A")), shape.crop(support_box))
        support.putalpha(support_alpha)
        bench.paste(support, (local_x, local_y))

    OUT.mkdir(parents=True, exist_ok=True)
    output = OUT / "bench.png"
    bench.save(output)
    make_background_checks(bench)
    make_closeups(bench)

    metadata = {
        "bench": {
            "file": "bench.png",
            "source_rect": list(SOURCE_RECT),
        },
        "uncertainty": "The sticker is flattened; original wood pixels hidden under bird feet/tails cannot be recovered exactly. Contact wood is reconstructed from an adjacent clean strip of the same bench, so the exact hidden grain is unknown.",
        "notes": [
            "Output is a transparent 1195x165 RGBA crop; source_rect uses half-open [x0,y0,x1,y1] coordinates in sticker.png.",
            "The 44x28 donor core [425,833,469,861] plus its four-row continuation [425,861,469,865] is tiled with direct RGBA replacement across output-local span [30,1143] (source x=[65,1178]), over source rows [833,865].",
            "Pixels above source row 833 are cleared. Both support posts are restored from source rectangles [200,847,253,989] and [990,847,1045,989] after patching.",
            "No broad inpainting is used. The source file is read-only; generated files are written only to the selected output directory.",
        ],
    }
    (OUT / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"Wrote {output} ({bench.size[0]}x{bench.size[1]} {bench.mode}), {OUT / 'metadata.json'}")
    print(f"QA: {OUT / 'bench_sky_check.png'}, {OUT / 'bench_background_checks.png'}, and {OUT / 'bench_closeups.png'}")


def main():
    global OUT
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE,
                        help="authoritative sticker.png path; defaults to tools/sticker_src/sticker.png")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT,
                        help="new output directory; defaults to tools/sticker_src/bench_refined")
    args = parser.parse_args()
    OUT = args.out.resolve()
    build(args.source)


if __name__ == "__main__":
    main()
