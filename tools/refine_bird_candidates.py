"""Review/refine flattened sticker birds; never write inputs or production sprites.

Run only with Python 3.10 -I. All coordinates are source-image pixels, xyxy,
right/bottom exclusive. Inputs are supplied as arguments; outputs go only to
a fresh non-production candidate directory (this task uses bird_refined).
No input code is imported. Prototypes are optional comparison inputs only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

NAMES = ("bird1", "bird2", "bird3", "bird4", "bird6")
# Selection uses only source-space seeds; prototypes are optional QA references.
SEEDS = {"bird1": (130, 680), "bird2": (350, 670), "bird3": (610, 650),
         "bird4": (790, 655), "bird6": (1100, 660)}
CROP_BOTTOMS = {"bird1": 859, "bird2": 856, "bird3": 857, "bird4": 857, "bird6": 857}
SEARCH = {
    "bird1": (20, 565, 250, 865),
    "bird2": (260, 600, 470, 865),
    "bird3": (480, 565, 690, 865),
    "bird4": (680, 590, 975, 865),
    "bird6": (920, 500, 1280, 865),
}
CONTACTS = {
    "bird1": (62, 786, 185, 856),
    "bird2": (298, 786, 400, 858),
    "bird3": (548, 784, 651, 858),
    "bird4": (688, 780, 938, 858),
    "bird6": (1052, 782, 1144, 858),
}


def font(size=15):
    return ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", size)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def background(size, kind):
    w, h = size
    colors = {"white": (255, 255, 255), "dark": (29, 34, 43),
              "blue": (48, 128, 202), "checker": (235, 235, 235)}
    out = Image.new("RGBA", size, (*colors[kind], 255))
    if kind == "checker":
        d = ImageDraw.Draw(out)
        for y in range(0, h, 12):
            for x in range(0, w, 12):
                if (x // 12 + y // 12) % 2:
                    d.rectangle((x, y, x + 11, y + 11), fill=(191, 199, 208, 255))
    return out


def composite(im, kind):
    out = background(im.size, kind)
    out.alpha_composite(im)
    return out.convert("RGB")


def four_background(im, name):
    cw, ch = im.width + 24, im.height + 45
    out = Image.new("RGB", (cw * 2, ch * 2), (66, 71, 80))
    d = ImageDraw.Draw(out)
    for i, kind in enumerate(("white", "dark", "blue", "checker")):
        x, y = i % 2 * cw, i // 2 * ch
        out.paste(composite(im, kind), (x + 12, y + 32))
        d.text((x + 12, y + 8), f"{name} / {kind} / 1:1", font=font(), fill="white")
    return out


def register(source, proto, box):
    x0, y0, x1, y1 = box
    template = np.asarray(proto)[:, :, :3].copy()
    a = np.asarray(proto)[:, :, 3]
    mask = ((a >= 248) & (template.max(2) >= 32)).astype(np.uint8)
    mask[-32:] = 0  # Prototypes contain retouched contact pixels here.
    search = source[y0:y1, x0:x1, :3].copy()
    scores = cv2.matchTemplate(search, template, cv2.TM_SQDIFF, mask=mask)
    _, _, loc, _ = cv2.minMaxLoc(scores)
    x, y = x0 + loc[0], y0 + loc[1]
    crop = (x, y, x + proto.width, y + proto.height)
    ref = source[y:y + proto.height, x:x + proto.width, :3]
    errors = np.max(np.abs(ref.astype(int) - template.astype(int)), axis=2)
    return crop, {"registration_samples": int(mask.sum()),
                  "registration_exact_rgb_fraction": float((errors[mask > 0] == 0).mean())}


def annotated_contact(im, box, name, scale=5):
    zoom = im.resize((im.width * scale, im.height * scale), Image.Resampling.NEAREST)
    out = Image.new("RGB", (zoom.width, zoom.height + 48), (55, 60, 67))
    out.paste(zoom, (0, 48))
    d = ImageDraw.Draw(out)
    d.text((6, 4), f"{name} | source crop {list(box)} | {scale}x nearest", font=font(), fill="white")
    for x in range((box[0] // 10 + 1) * 10, box[2], 10):
        sx = (x - box[0]) * scale
        d.line((sx, 35, sx, 47), fill=(235, 230, 130))
        d.text((sx - 9, 22), str(x), font=font(10), fill="white")
    for y in range((box[1] // 5 + 1) * 5, box[3], 5):
        sy = (y - box[1]) * scale + 48
        d.line((0, sy, 5, sy), fill=(230, 30, 220))
        d.text((7, sy - 5), str(y), font=font(10), fill=(255, 30, 220))
    return out


def inspect(args, sheet, crops):
    out = args.output / "inspection"
    out.mkdir(exist_ok=True)
    source = Image.fromarray(sheet, "RGBA")
    source_box = (22, 500, 1280, 866)
    composite(source.crop(source_box), "white").save(out / "source_birds_white.png")
    for name in NAMES:
        proto = Image.open(args.prototypes / f"{name}_extend2.png").convert("RGBA")
        four_background(proto, name + " prototype").save(out / f"{name}_prototype_four_backgrounds.png")
        box = CONTACTS[name]
        im = composite(source.crop(box), "white")
        annotated_contact(im, box, name + " source").save(out / f"{name}_source_contact_5x.png")
        crop = crops[name]["source_crop_xyxy"]
        aligned = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]))
        aligned.paste(proto, (crop[0] - box[0], crop[1] - box[1]))
        annotated_contact(composite(aligned, "white"), box, name + " prototype").save(
            out / f"{name}_prototype_contact_5x.png")


# These are local lower-silhouette envelopes, not row erasers. Cubic control
# points are fitted to visible outline above/below each rail intersection.
# Membership at the black rail is necessarily reconstructed, and is flagged.
PATHS = {
    "bird1": [
        [("M", 69.4, 829), ("C", 69.6, 834.5, 72.6, 838.8, 79.8, 838.7),
         ("C", 86.7, 838.9, 92.2, 835.8, 95.3, 829), ("Z",)],
        [("M", 109, 830), ("C", 106.8, 831.8, 106, 836.6, 107.8, 839.8),
         ("C", 109.8, 842.9, 113.3, 841, 114, 837.4), ("L", 114.5, 834.5),
         ("L", 116, 834.2), ("C", 115, 838.1, 113.9, 841.6, 116.2, 842.3),
         ("C", 119.2, 843.3, 121.2, 840.3, 122, 836), ("L", 123.5, 833.1),
         ("C", 124.1, 837.5, 125.7, 841.7, 130.4, 842),
         ("C", 134.3, 842, 137.9, 835.5, 137.1, 830), ("Z",)],
        [("M", 141, 830), ("C", 138.6, 833.5, 139, 837.2, 142.8, 840.4),
         ("C", 145.3, 842.9, 149.7, 842.6, 151.3, 837.2),
         ("L", 152.6, 833.5), ("L", 154, 833.5),
         ("C", 155, 837.1, 156.7, 842, 161, 842),
         ("C", 165, 842, 168.3, 837.1, 168, 830), ("Z",)],
    ],
    "bird2": [[
        ("M", 308, 830), ("C", 307.8, 834.2, 308.4, 840.2, 314.5, 843.4),
        ("C", 320, 846.5, 327.1, 845, 330.5, 840.2),
        ("C", 331, 845.8, 335.7, 851, 343, 852.2),
        ("C", 350.5, 854, 359, 849.6, 362.5, 840.8),
        ("C", 367.2, 845.1, 373.3, 845.6, 378.7, 841.6),
        ("C", 384.2, 837.6, 385, 832.2, 383.5, 830), ("Z",),
    ]],
    "bird3": [[
        ("M", 566, 830), ("C", 564.6, 835, 565.9, 842.2, 569.7, 845.7),
        ("C", 575, 850.2, 584.5, 849.2, 589.6, 840.7),
        ("C", 589.8, 847, 595, 853.4, 603.5, 854),
        ("C", 612, 853.7, 617.3, 848, 619.5, 840.1),
        ("C", 623, 846.2, 630.9, 848.5, 637, 842.2),
        ("C", 641.1, 837.9, 641.2, 834.5, 640.5, 830), ("Z",),
    ]],
    "bird4": [
        [("M", 699.5, 830), ("C", 698.9, 833, 701, 837.8, 706.6, 839.1),
         ("C", 709.5, 839.8, 712.3, 839.1, 713.4, 837.3),
         ("C", 713.5, 842, 717, 847.4, 723.6, 848.3),
         ("C", 729, 849, 735.8, 843.8, 738, 838.1),
         ("C", 738, 844.5, 743, 852.9, 751.2, 853.8),
         ("C", 762, 854.5, 769.2, 844, 771, 835),
         ("C", 771.6, 832.6, 772.3, 831.6, 772.4, 830), ("Z",)],
        [("M", 786, 828), ("C", 783.2, 832.2, 780.5, 835.2, 779.8, 837.5),
         ("C", 778.8, 840.5, 781.4, 842.5, 784.2, 841.1),
         ("C", 788, 839.5, 792.3, 832, 795, 828), ("Z",)],
        [("M", 871.5, 828), ("C", 871, 831, 868, 834, 868, 838),
         ("C", 867.7, 841.7, 872.3, 841.3, 873.5, 835.3),
         ("C", 873.4, 837.8, 875.3, 840.2, 878, 840.2),
         ("C", 879.5, 839.5, 880, 835.5, 876, 831), ("L", 876.8, 828), ("Z",)],
        [("M", 887.1, 827), ("C", 887.8, 833.2, 887.5, 838, 891.1, 840),
         ("C", 895.5, 842, 900.2, 839, 900.6, 833),
         ("C", 901, 838, 902.8, 841, 906.2, 839.8),
         ("C", 910.5, 838.4, 910.8, 832.3, 910.3, 829.1),
         ("C", 915, 834, 921, 833, 923.1, 827), ("Z",)],
    ],
    "bird6": [[
        ("M", 1057, 830), ("C", 1054.8, 835, 1058.7, 840, 1066, 842),
        ("C", 1071, 843.7, 1077.2, 841.8, 1080.7, 838.2),
        ("C", 1080.6, 846, 1087, 852.8, 1096, 854),
        ("C", 1107.5, 854.1, 1114.5, 847.5, 1117.6, 839),
        ("C", 1122.7, 843.2, 1129.3, 841.8, 1132.8, 837),
        ("C", 1135.5, 834.9, 1135.8, 832.4, 1135.5, 830), ("Z",),
    ]],
}


def path_mask(paths, crop, scale=8):
    x0, y0, x1, y1 = crop
    im = Image.new("L", ((x1 - x0) * scale, (y1 - y0) * scale))
    draw = ImageDraw.Draw(im)
    for commands in paths:
        points = []
        current = None
        for command in commands:
            op, *v = command
            if op in ("M", "L"):
                current = np.array(v, float)
                points.append(current.copy())
            elif op == "C":
                p0 = current.copy()
                p1, p2, p3 = np.array(v, float).reshape(3, 2)
                for t in np.linspace(0, 1, 49)[1:]:
                    points.append((1-t)**3*p0 + 3*(1-t)**2*t*p1 +
                                  3*(1-t)*t*t*p2 + t**3*p3)
                current = p3
        draw.polygon([((p[0] - x0)*scale, (p[1] - y0)*scale) for p in points], fill=255)
    return np.array(im.resize((x1 - x0, y1 - y0), Image.Resampling.BOX)) / 255.0


def align_image(im, source_crop, target_crop):
    out = Image.new("RGBA", (target_crop[2] - target_crop[0], target_crop[3] - target_crop[1]))
    out.paste(im, (source_crop[0] - target_crop[0], source_crop[1] - target_crop[1]))
    return out


def source_component(sheet, name, labels):
    sx, sy = SEEDS[name]
    component_id = int(labels[sy, sx])
    if not component_id:
        raise RuntimeError("Source-space seed does not identify a foreground component")
    core = labels == component_id
    ys, xs = np.nonzero(core)
    crop = (int(xs.min()) - 4, int(ys.min()) - 4, int(xs.max()) + 5, CROP_BOTTOMS[name])
    x0, y0, x1, y1 = crop
    local_core = core[y0:y1, x0:x1]
    distance = ndimage.distance_transform_edt(~local_core)
    # Only original low-alpha AA immediately adjacent to the chosen source
    # component can be recovered. Other source components cannot be added.
    allowed = (distance <= 1.5) & ((labels[y0:y1, x0:x1] == component_id) |
                                 (labels[y0:y1, x0:x1] == 0))
    alpha = sheet[y0:y1, x0:x1, 3].astype(float)
    alpha[alpha < 6] = 0
    low = (alpha >= 6) & (alpha < 24)
    alpha[low] = (alpha[low] - 6) * 24 / 18
    alpha *= allowed
    alpha[max(0, 832 - y0):] = 0
    rgba = sheet[y0:y1, x0:x1].copy()
    rgba[:, :, 3] = np.rint(alpha).astype(np.uint8)
    return crop, rgba, component_id


def refine_contact(sheet, name, crop, rgba):
    x0, y0, x1, y1 = crop
    source = sheet[y0:y1, x0:x1]
    geom = path_mask(PATHS[name], crop)
    hard = geom > 0.5
    outside_dist = ndimage.distance_transform_edt(~hard)
    inside_dist = ndimage.distance_transform_edt(hard)
    guard = outside_dist <= 2
    boundary = ((inside_dist <= 2.1) & hard) | ((geom > 0) & ~hard)
    ambiguity = np.zeros(hard.shape, bool)
    reconstructed = np.zeros(hard.shape, bool)
    # Sample untouched wood at the same source row, never from another input.
    bench_x = np.r_[180:195, 450:480, 675:690, 810:830, 970:985, 1160:1190]
    af = 253.0 / 255
    for sy in range(831, y1):
        ly = sy - y0
        c = source[ly, :, :3].astype(float)
        orig_a = source[ly, :, 3].astype(float) / 255
        samples = sheet[sy, bench_x].astype(float)
        bg = np.median(samples[:, :3], axis=0)
        bg_a = np.median(samples[:, 3]) / 255
        row_rail = sy in (833, 834, 835, 836, 847, 848, 849)
        new_c = c.copy()
        if row_rail:
            cov = geom[ly].copy()
            # Only ambiguous outline membership is drawn; original visible core
            # texture is kept. The source black rail cannot be unmixed here.
            edge = boundary[ly] & (cov > 0)
            new_c[edge] = 3.0
            uncertainty = edge | ((c.max(1) < 32) & (cov > 0))
            reconstructed[ly] |= edge
        elif sy < 833:
            # The bench is almost transparent at y831/832, so source alpha is
            # informative; use it instead of throwing away either whole row.
            cov = np.clip((orig_a - bg_a) / max(af - bg_a, 0.01), 0, 1)
            cov *= guard[ly]
            uncertainty = boundary[ly] & (cov > 0)
            edge = (cov > 0.02) & (cov < 0.98) & guard[ly]
            denominator = np.maximum(cov * af, 0.001)[:, None]
            unmixed = (c * orig_a[:, None] - (1-cov[:, None])*bg_a*bg) / denominator
            neutral = np.median(np.clip(unmixed, 0, 255), axis=1)
            new_c[edge] = neutral[edge, None]
        else:
            # Gray ink over colored wood permits a local chroma matte. This is
            # an estimate, not recovery of an unavailable original layer.
            bc = np.array((bg[0]-bg[2], bg[1]-bg[2]))
            cc = np.stack((c[:, 0]-c[:, 2], c[:, 1]-c[:, 2]), axis=1)
            raw_cov = np.clip(1 - (cc @ bc) / max(float(bc @ bc), 1), 0, 1)
            cov = np.clip((raw_cov - 0.035) / 0.965, 0, 1) * guard[ly]
            cov[c.max(1) > 215] = 0
            # Final QA found connected diagonal wood hatch in the two-pixel
            # guard below tail tips. Apply each contour locally, not a row cut.
            if sy >= 850:
                cov = np.minimum(cov, geom[ly])
            # Decontaminate small colored toe holes as well as exterior edges;
            # neutral opaque source texture (raw_cov near 1) stays untouched.
            edge = (cov > 0.02) & (raw_cov < 0.98)
            unmixed = (c - (1-raw_cov[:, None])*bg) / np.maximum(raw_cov[:, None], 0.001)
            neutral = np.median(np.clip(unmixed, 0, 255), axis=1)
            new_c[edge] = neutral[edge, None]
            uncertainty = ((inside_dist[ly] <= 2.1) | ~hard[ly]) & (cov > 0)
        cov[cov < 0.015] = 0
        rgba[ly, :, 3] = np.rint(cov * 253).astype(np.uint8)
        rgba[ly, :, :3] = np.rint(np.clip(new_c, 0, 255)).astype(np.uint8)
        ambiguity[ly] |= uncertainty
        reconstructed[ly] |= (np.max(np.abs(new_c - c), axis=1) >= 0.5) & (cov > 0)
    # Bird1's tail touches a diagonal bench outline as well as the horizontal
    # rail; even the source-derived part of this tip is not unambiguous.
    if name == "bird1":
        yy, xx = np.mgrid[y0:y1, x0:x1]
        ambiguity |= (yy >= 832) & (yy <= 839) & (xx < 98) & (rgba[:, :, 3] > 0)
    # Remove only disconnected contact-band specks. Never filter decorations.
    lab, count = ndimage.label(rgba[:, :, 3] > 3, np.ones((3, 3)))
    removed_specks = 0
    for i in range(1, count + 1):
        m = lab == i
        yy, _ = np.nonzero(m)
        if yy.size < 8 and yy.size and yy.min() + y0 >= 832:
            rgba[m, 3] = 0
            removed_specks += int(yy.size)
    visible = rgba[:, :, 3] > 0
    reconstructed &= visible
    ambiguity = (ambiguity | reconstructed) & visible
    rgba[~visible] = 0  # No hidden bench RGB in transparent output pixels.
    return rgba, ambiguity, reconstructed, removed_specks


def overlay_flags(im, ambiguous, reconstructed):
    out = composite(im, "white")
    a = np.array(out).astype(float)
    a[ambiguous] = 0.4*a[ambiguous] + 0.6*np.array((255, 165, 0))
    a[reconstructed] = 0.25*a[reconstructed] + 0.75*np.array((228, 0, 214))
    return Image.fromarray(np.uint8(np.clip(a, 0, 255)), "RGB")


def overview_four(images):
    cw, ch = 366, 390
    out = Image.new("RGB", (cw * 5, ch * 4), (62, 67, 76))
    d = ImageDraw.Draw(out)
    for row, kind in enumerate(("white", "dark", "blue", "checker")):
        for col, name in enumerate(NAMES):
            im = images[name]
            tile = background((cw-14, ch-38), kind)
            tile.alpha_composite(im, ((tile.width-im.width)//2, (tile.height-im.height)//2))
            x, y = cw*col, ch*row
            out.paste(tile.convert("RGB"), (x+7, y+31))
            d.text((x+9, y+7), f"{name} / {kind} / native pixels", font=font(), fill="white")
    return out


def preview_contacts(args, folder, sheet, name, crop, im, ambiguity, reconstruction, proto_crop):
    box = CONTACTS[name]
    aligned = align_image(im, crop, box)
    panels = []
    for label, kind in (("refined / white", "white"), ("refined / dark", "dark")):
        panels.append(annotated_contact(composite(aligned, kind), box, name + " " + label))
    flag_full = overlay_flags(im, ambiguity, reconstruction).convert("RGBA")
    flag = align_image(flag_full, crop, box).convert("RGB")
    panels.append(annotated_contact(flag, box, name + " orange=uncertain; magenta=reconstructed"))
    out = Image.new("RGB", (panels[0].width, sum(p.height for p in panels)), (55, 60, 67))
    yy = 0
    for p in panels:
        out.paste(p, (0, yy))
        yy += p.height
    out.save(folder / f"{name}_contact_5x.png")
    source = Image.fromarray(sheet[box[1]:box[3], box[0]:box[2]], "RGBA")
    entries = [("source with bench", composite(source, "white"))]
    if args.prototypes is not None and proto_crop is not None:
        proto = Image.open(args.prototypes / f"{name}_extend2.png").convert("RGBA")
        proto = align_image(proto, proto_crop, box)
        entries.append(("prototype extend2", composite(proto, "white")))
    entries.append(("refined candidate", composite(aligned, "white")))
    scale = 3
    cw, ch = (box[2]-box[0])*scale, (box[3]-box[1])*scale+30
    comparison = Image.new("RGB", (cw, ch*3), (55, 60, 67))
    d = ImageDraw.Draw(comparison)
    for i, (label, tile) in enumerate(entries):
        d.text((5, i*ch+7), f"{name}: {label} / 3x", font=font(), fill="white")
        comparison.paste(tile.resize((cw, ch-30), Image.Resampling.NEAREST), (0, i*ch+30))
    comparison.save(folder / f"{name}_contact_comparison.png")


def production_snapshot(args):
    project = Path(__file__).resolve().parent.parent
    files = sorted(p for p in (project / "assets").rglob("*") if p.is_file())
    files += [project / "index.html"]
    current = {str(p): sha256(p) for p in files}
    guard = args.output / "production_guard.json"
    if guard.exists():
        baseline = json.loads(guard.read_text(encoding="utf-8"))
        if baseline != current:
            raise RuntimeError("Production snapshot changed since baseline; stop.")
    else:
        guard.write_text(json.dumps(current, indent=2), encoding="utf-8")
    return len(current)


def refine(args, sheet, registrations):
    folder = args.output if args.final else args.output / f"iteration{args.iteration:02d}"
    folder.mkdir(exist_ok=True)
    m = sheet[:, :, 3] >= 16
    m[832:] = False  # Label above the bench; contacts are added independently.
    labels, _ = ndimage.label(m, np.ones((3, 3)))
    birds, images = {}, {}
    for name in NAMES:
        reg = registrations.get(name)
        proto = (Image.open(args.prototypes / f"{name}_extend2.png").convert("RGBA")
                 if args.prototypes is not None else None)
        proto_crop = reg["source_crop_xyxy"] if reg else None
        crop, rgba, component_id = source_component(sheet, name, labels)
        rgba, ambiguous, reconstructed, specks = refine_contact(sheet, name, crop, rgba)
        im = Image.fromarray(rgba, "RGBA")
        im.save(folder / f"{name}.png")
        Image.fromarray(ambiguous.astype(np.uint8)*255, "L").save(folder / f"{name}_ambiguous_mask.png")
        Image.fromarray(reconstructed.astype(np.uint8)*255, "L").save(folder / f"{name}_reconstructed_mask.png")
        overlay_flags(im, ambiguous, reconstructed).save(folder / f"{name}_uncertainty_overlay.png")
        four_background(im, name + " refined").save(folder / f"{name}_four_backgrounds.png")
        preview_contacts(args, folder, sheet, name, crop, im, ambiguous, reconstructed, proto_crop)
        x0, y0, x1, y1 = crop
        yy = np.arange(y0, y1)[:, None]
        source = sheet[y0:y1, x0:x1]
        original_core = (labels[y0:y1, x0:x1] == component_id) & (source[:, :, 3] >= 128)
        upper = original_core & (yy < 831)
        exact_upper = bool(np.array_equal(rgba[upper], source[upper]))
        neighbors = ((labels[y0:y1, x0:x1] != 0) & (labels[y0:y1, x0:x1] != component_id) &
                     (rgba[:, :, 3] > 0) & (yy < 832))
        assert exact_upper and not neighbors.any(), (name, "upper/source or neighbor QA")
        assert not np.r_[rgba[0, :, 3], rgba[-1, :, 3], rgba[:, 0, 3], rgba[:, -1, 3]].any()
        removed = np.zeros(rgba.shape[:2], bool)
        if proto is not None:
            p = np.array(align_image(proto, proto_crop, crop))
            removed = (p[:, :, 3] > 8) & (rgba[:, :, 3] <= 8)
            Image.fromarray(removed.astype(np.uint8)*255, "L").save(folder / f"{name}_prototype_removed_mask.png")
        below = (yy >= 832) & (rgba[:, :, 3] > 0)
        rgb_changed = np.any(rgba[:, :, :3] != source[:, :, :3], axis=2) & below
        birds[name] = {
            "file": f"{name}.png", "path": str(folder / f"{name}.png"), "source_rect": list(crop),
            "size": list(im.size), "prototype_rect": proto_crop,
            "ambiguous_mask": f"{name}_ambiguous_mask.png",
            "reconstructed_mask": f"{name}_reconstructed_mask.png",
            "uncertainty_overlay": f"{name}_uncertainty_overlay.png",
            "four_background_preview": f"{name}_four_backgrounds.png",
            "zoomed_contact_preview": f"{name}_contact_5x.png",
            "source_prototype_refined_contact": f"{name}_contact_comparison.png",
            "ambiguous_visible_pixels": int(ambiguous.sum()),
            "reconstructed_visible_pixels": int(reconstructed.sum()),
            "contact_rgb_changed_pixels": int(rgb_changed.sum()),
            "prototype_pixels_removed_above_alpha8": int(removed.sum()),
            "disconnected_contact_specks_removed": specks,
            "opaque_upper_source_pixels_preserved_exactly": exact_upper,
            "neighbor_source_component_pixels_added": int(neighbors.sum()),
            "retained_pixels_on_rail_rows": {str(y): int((rgba[y-y0, :, 3] > 8).sum())
                                             for y in (833, 834, 835, 836, 848)},
            "contact_envelope_commands_source_space": PATHS[name],
            "qa_observations": {
                "bird1": ["Red feather/leaf prop and source silhouette retained; long rail bridge removed between tail and feet."],
                "bird2": ["Rope prop and three tail lobes retained; horizontal rail projections removed."],
                "bird3": ["115 card and three tail lobes retained; left horizontal rail remnant removed; final local contour excludes diagonal wood hatch below center tip."],
                "bird4": ["Adult plus chick remain in one image with red bag; no neighboring bird/banner component added; rail bridges between the three contact groups removed."],
                "bird6": ["Full banner including source left tip x929 recovered (prototype started x935); poles and wing feathers retained."],
            }[name],
            "remaining_defects": {
                "bird1": ["Toe joints over the black rail and tail-tip contact with the diagonal bench outline are inferred, not exact original-layer pixels.", "Tiny toe holes/edges can retain estimated gray or warm shading at 5x."],
                "bird2": ["Rail-crossing outline membership is reconstructed; the fitted boundary is slightly smoother than the hand-drawn source."],
                "bird3": ["Lower center-tip boundary across the second rail is estimated; a one-pixel matte/shape difference remains possible."],
                "bird4": ["Adult lower foot hook and chick toe fork at the rail are ambiguous and locally reconstructed.", "Small warm/gray traces inside toe loops are not guaranteed completely removed."],
                "bird6": ["Tail boundary across both rail intersections is estimated; subtle edge tint or one-pixel smoothing remains possible."],
            }[name],
        }
        images[name] = im
        print("refined", name, "crop", crop, "size", im.size,
              "ambiguous", int(ambiguous.sum()), "reconstructed", int(reconstructed.sum()))
    overview_four(images).save(folder / "four_backgrounds.png")
    independent = None
    if args.final and (args.output / "iteration02" / "bird1.png").exists():
        independent = all(sha256(folder / f"{n}.png") == sha256(args.output / "iteration02" / f"{n}.png") for n in NAMES)
        if not independent:
            raise RuntimeError("Candidate pixels depend on optional prototypes")
    record = {
        "status": "refined review candidates; not installed in production; explicit limitations below",
        "prototype_independent_generation_verified_by_identical_png_hashes": independent,
        "generation_dependencies": "Python 3.10 -I, source PNG, this maintained script; prototypes optional for QA only",
        "iterations": ["iteration01: first matte, visually reviewed", "iteration02/final: contour-limited lower-tip matte and toe-hole neutralization"],
        "authoritative_source": str(args.authoritative), "isolated_source_copy": str(args.source),
        "source_sha256": sha256(args.source), "source_size": [1536, 1024],
        "coordinate_convention": "source-space [x0,y0,x1,y1], right/bottom exclusive; native scale; transparent padding included",
        "alpha": "straight/unassociated RGBA; transparent RGB zeroed; original core alpha retained (usually 253)",
        "mask_convention": "8-bit L masks: 255 flagged / 0 unflagged; same dimensions/crop as corresponding bird PNG",
        "overlay_legend": {"orange": "ambiguous subject/bench membership or estimated matte",
                           "magenta": "reconstructed rail-boundary membership and/or changed RGB (overrides orange)"},
        "limitations": ["Flattened input has no hidden bird layer. Exact toe/outline pixels merged with black rail are unavailable.",
                        "Cubic contact envelopes are conservative local interpretations, not original-layer recovery.",
                        "Chroma matting/neutralization estimates dark outline colors over yellow wood; flagged pixels may look smoother than the original ink.",
                        "No whole row is removed: subject pixels are retained through both rail intersections."],
        "birds": birds, "four_background_preview": "four_backgrounds.png",
        "python": sys.version, "isolated": bool(sys.flags.isolated),
        "production_guard": str(args.output / "production_guard.json"),
        "production_guard_file_count": production_snapshot(args),
        "source_and_prototypes_unchanged": True,
    }
    if sha256(args.source) != sha256(args.authoritative):
        raise RuntimeError("Isolated source copy mismatch")
    if args.prototypes is not None:
        for name in NAMES:
            if sha256(args.prototypes / f"{name}_extend2.png") != registrations[name]["sha256"]:
                raise RuntimeError("Prototype changed")
    (folder / "metadata.json").write_text(json.dumps(record, indent=2), encoding="utf-8")


def main():
    if sys.version_info[:2] != (3, 10) or not sys.flags.isolated:
        raise SystemExit("Use isolated Python 3.10: py -3.10 -I <script> ...")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Verified source-only isolated input copy")
    parser.add_argument("--authoritative", type=Path, required=True, help="Original sticker.png, hash-checked only")
    parser.add_argument("--prototypes", type=Path, help="Optional prototype directory for registration/comparison only")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--stage", choices=("inspect", "refine"), default="refine")
    parser.add_argument("--iteration", type=int, default=1)
    parser.add_argument("--final", action="store_true")
    args = parser.parse_args()
    args.source = args.source.resolve()
    args.authoritative = args.authoritative.resolve()
    args.prototypes = args.prototypes.resolve() if args.prototypes is not None else None
    args.output = args.output.resolve()
    project = Path(__file__).resolve().parent.parent
    task_output = project / "tools" / "sticker_src" / "bird_refined"
    production = (project / "assets").resolve()
    # A parent orchestrator may use any fresh candidate tree. Never permit
    # output in production or in the isolated input/prototype directories.
    protected = [production, args.source.parent]
    if args.prototypes is not None:
        protected.append(args.prototypes)
    if any(args.output == p or args.output.is_relative_to(p) for p in protected):
        raise SystemExit("Candidate output must not be in production, the isolated input, or prototypes.")
    if args.output == args.authoritative.parent or args.output == project:
        raise SystemExit("Candidate output must be a new directory, not the authoritative source/project directory.")
    if args.output.exists() and any(args.output.iterdir()):
        # Only this task's existing guarded scratch tree may be rerun. All
        # other callers must supply a new or empty non-production directory.
        if args.output != task_output or not (args.output / "production_guard.json").is_file():
            raise SystemExit("Candidate output directory must be new or empty.")
    if list(args.source.parent.iterdir()) != [args.source]:
        raise SystemExit("Isolated source input folder must contain only sticker.png.")
    if sha256(args.source) != sha256(args.authoritative):
        raise SystemExit("Isolated source hash does not match authoritative sticker.png.")
    args.output.mkdir(parents=True, exist_ok=True)
    production_snapshot(args)
    im = Image.open(args.source)
    if im.mode != "RGBA" or im.size != (1536, 1024):
        raise SystemExit("Expected authoritative 1536x1024 RGBA input.")
    sheet = np.array(im)
    crops = {}
    if args.prototypes is not None:
        for name in NAMES:
            path = args.prototypes / f"{name}_extend2.png"
            proto = Image.open(path).convert("RGBA")
            crop, score = register(sheet, proto, SEARCH[name])
            crops[name] = {"prototype": str(path), "sha256": sha256(path),
                           "source_crop_xyxy": list(crop), **score}
            print(name, crops[name])
    elif args.stage == "inspect":
        raise SystemExit("Inspection comparisons require --prototypes; refinement does not.")
    record = {"python": sys.version, "isolated": bool(sys.flags.isolated),
              "source": str(args.source), "source_sha256": sha256(args.source),
              "coordinate_convention": "source xyxy; right/bottom exclusive", "prototypes": crops}
    (args.output / "input_registration.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    if args.stage == "inspect":
        inspect(args, sheet, crops)
    else:
        refine(args, sheet, crops)
    production_snapshot(args)


if __name__ == "__main__":
    main()
