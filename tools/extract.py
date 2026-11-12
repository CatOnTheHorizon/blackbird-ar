# -*- coding: utf-8 -*-
"""从月历插画中抠出各元素为透明 PNG 贴片（v2 色差分割版）
思路：背景是纵向平滑渐变 + 纸面噪点 → 先高斯模糊去噪，再按「与背景渐变的色差」
+ 墨线 + 红色 判定前景；闭合 + 填洞（仅实心元素）后按种子连通块取元素。
"""
import os, json
import numpy as np
from PIL import Image
from scipy import ndimage

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(BASE, "assets", "target.jpg")
OUT  = os.path.join(BASE, "assets", "sprites")
DBG  = os.path.join(BASE, "tools", "debug")
os.makedirs(OUT, exist_ok=True)
os.makedirs(DBG, exist_ok=True)

img = np.asarray(Image.open(SRC).convert("RGB"))
H, W = img.shape[:2]
R, G, B = img[:, :, 0].astype(np.int16), img[:, :, 1].astype(np.int16), img[:, :, 2].astype(np.int16)

# ── 背景纵向渐变（左缘中位数）──
bgcol = np.zeros((H, 3), np.float32)
for y in range(H):
    bgcol[y] = np.median(img[y, 0:40].astype(np.float32), axis=0)
bgcol = ndimage.uniform_filter1d(bgcol, size=25, axis=0)

# ── 分割掩码 ──
blur = np.stack([ndimage.gaussian_filter(img[:, :, c], 2) for c in range(3)], axis=2).astype(np.float32)
diff = np.abs(blur - bgcol[:, None, :]).max(axis=2)
ink  = img.max(axis=2) < 115
red  = (R > 120) & ((R - np.maximum(G, B)) > 55)
fg_global = ink | red | (diff > 60)
# 横幅卷轴的奶油色：亮度高且不低于蓝色分量（浅蓝天空 B 最大，可区分）
cream = (R > 195) & (G > 185) & (B > 135) & (B < R + 8)
cream[:690, :] = False
cream[830:, :] = False          # 只允许出现在横幅那一带
band = np.zeros_like(cream); band[690:830, 900:1330] = True
fg_global = fg_global | (cream & band)

# ── 长椅上沿 ──
wood = (R > 165) & (G > 125) & (G < 205) & (B < 140)
slat_top = H
for y in range(int(H * 0.7), H):
    if wood[y, 300:1000].mean() > 0.35:
        slat_top = y
        break
print("slat_top =", slat_top)

SLAT = slat_top - 12      # 鸟贴片底边：避开长椅顶部黑边

def feather(b, sigma=0.8):
    return np.clip(ndimage.gaussian_filter(b.astype(np.float32), sigma), 0, 1)

def keep_seed_components(mask, seeds, min_area=250):
    lab, n = ndimage.label(mask)
    keep = np.zeros_like(mask)
    ids = set()
    for sx, sy in seeds:
        if 0 <= sy < mask.shape[0] and 0 <= sx < mask.shape[1]:
            i = lab[sy, sx]
            if i:
                ids.add(i)
    if not ids:
        sizes = ndimage.sum(mask, lab, range(1, n + 1))
        if n:
            ids.add(int(np.argmax(sizes)) + 1)
    for i in ids:
        keep |= (lab == i)
    lab2, n2 = ndimage.label(keep)
    out = np.zeros_like(keep)
    for i in range(1, n2 + 1):
        comp = (lab2 == i)
        if comp.sum() >= min_area:
            out |= comp
    return out

CROPS = {
    # name: (x0, y0, x1, y1, seeds 相对裁剪坐标, 是否填洞)
    "bus":   (145, 160, 1225, 830,  [(535, 400), (692, 613), (191, 611)], "ink"),
    "bird1": (60,   740, 350,  SLAT, [(130, 210)], False),
    "bird2": (300,  790, 560,  SLAT, [(120, 160)], False),
    "bird3": (495,  680, 815,  SLAT, [(155, 270), (80, 80)], False),
    "bird4": (760,  790, 1085, SLAT, [(120, 160), (240, 240)], False),
    "bird6": (850,  650, 1345, SLAT, [(280, 300), (235, 115)], False),
    "sign":  (1330, 0,   1745, 1280, [(210, 200), (270, 640), (110, 1000)], True),
    "bench": (55,  slat_top - 6, 1300, 1280, [(600, 60), (200, 40)], True),
}

rects, alphas = {}, {}
for name, (x0, y0, x1, y1, seeds, mode) in CROPS.items():
    if mode == "ink":
        ink_c = ndimage.binary_closing(ink[y0:y1, x0:x1], iterations=2)
        fgc = ndimage.binary_fill_holes(ink_c) | red[y0:y1, x0:x1]
        fgc = ndimage.binary_opening(fgc, iterations=1)
    else:
        fgc = fg_global[y0:y1, x0:x1].copy()
        fgc = ndimage.binary_closing(fgc, iterations=2)
        fgc = ndimage.binary_opening(fgc, iterations=2)
        if mode is True:
            fgc = ndimage.binary_fill_holes(fgc)
    keep = keep_seed_components(fgc, seeds, min_area=500 if name == "bus" else 250)
    if name == "bird6":
        keep = ndimage.binary_opening(keep, iterations=1)
        busA = np.asarray(Image.open(os.path.join(OUT, "bus.png")).convert("RGBA"))[:, :, 3] > 10
        bmask = np.zeros((H, W), bool)
        bmask[160:830, 145:1225] = busA
        bmask = ndimage.binary_dilation(bmask, iterations=4)[y0:y1, x0:x1]
        keep &= ~bmask
        keep = ndimage.binary_fill_holes(keep)
    a = feather(keep)
    rgba = np.dstack([img[y0:y1, x0:x1], (a * 255).astype(np.uint8)])
    im = Image.fromarray(rgba.astype(np.uint8), "RGBA")
    im.save(os.path.join(OUT, f"{name}.png"))
    rects[name] = (x0, y0, x1, y1)
    alphas[name] = a
    checker = Image.new("RGB", (x1 - x0, y1 - y0), (45, 45, 60))
    checker.paste(im, (0, 0), im)
    checker.save(os.path.join(DBG, f"{name}_check.png"))
    Image.fromarray((a * 255).astype(np.uint8)).save(os.path.join(DBG, f"alpha_{name}.png"))

# ── 鸟贴片去重：后处理的鸟扣掉前面鸟已占据的像素 ──
acc = np.zeros((H, W), np.float32)
for name in ["bird1", "bird2", "bird3", "bird4", "bird6"]:
    fp = os.path.join(OUT, f"{name}.png")
    im = np.asarray(Image.open(fp).convert("RGBA")).copy()
    x0, y0, x1, y1 = rects[name]
    a_full = np.zeros((H, W), np.float32)
    a_full[y0:y1, x0:x1] = im[:, :, 3].astype(np.float32) / 255
    a_full *= (1.0 - acc)
    im[:, :, 3] = (np.clip(a_full[y0:y1, x0:x1], 0, 1) * 255).astype(np.uint8)
    Image.fromarray(im, "RGBA").save(fp)
    acc = np.maximum(acc, a_full)
    alphas[name] = a_full[y0:y1, x0:x1]

# ── 站牌圆盘：按红环拟合圆，兜底强制填充 ──
x0, y0, x1, y1 = rects["sign"]
sign_rgb = img[y0:y1, x0:x1]
sr = (sign_rgb[:, :, 0] > 120) & ((sign_rgb[:, :, 0].astype(np.int16) - np.maximum(sign_rgb[:, :, 1], sign_rgb[:, :, 2])) > 55)
sr[int(sign_rgb.shape[0] * 0.45):, :] = False
s_lab, s_n = ndimage.label(sr)
sign_file = os.path.join(OUT, "sign.png")
sign_img = np.asarray(Image.open(sign_file).convert("RGBA")).copy()
if s_n:
    sizes = ndimage.sum(sr, s_lab, range(1, s_n + 1))
    ci = int(np.argmax(sizes)) + 1
    ys, xs = np.nonzero(s_lab == ci)
    ccx, ccy = xs.mean(), ys.mean()
    rad = (np.sqrt((xs - ccx) ** 2 + (ys - ccy) ** 2)).max() + 3
    yy, xx = np.mgrid[0:sign_img.shape[0], 0:sign_img.shape[1]]
    d = np.sqrt((xx - ccx) ** 2 + (yy - ccy) ** 2)
    inside = np.clip((rad - d) / 2.5, 0, 1)
    sign_img[:, :, 3] = np.maximum(sign_img[:, :, 3], (inside * 255).astype(np.uint8))
    Image.fromarray(sign_img, "RGBA").save(sign_file)
    print("disc fill: c=(%.0f,%.0f) r=%.0f" % (ccx, ccy, rad))
    alphas["sign"] = sign_img[:, :, 3].astype(np.float32) / 255

# ── 车轮（巴士贴片内红区）──
bus_img = np.asarray(Image.open(os.path.join(OUT, "bus.png")).convert("RGBA"))
BUS_RECT = rects["bus"]
br = (bus_img[:, :, 0] > 110) & (bus_img[:, :, 1] < 110) & (bus_img[:, :, 2] < 110) & (bus_img[:, :, 3] > 200)
br[:bus_img.shape[0] // 2] = False
w_lab, w_n = ndimage.label(br)
wheels = []
if w_n:
    sizes = ndimage.sum(br, w_lab, range(1, w_n + 1))
    for idx in np.argsort(sizes)[::-1][:2]:
        comp = (w_lab == idx + 1)
        ys, xs = np.nonzero(comp)
        if len(xs) < 300:
            continue
        cx, cy = xs.mean(), ys.mean()
        rad = np.sqrt(len(xs) / np.pi) + 7
        wheels.append((cx, cy, rad))
for i, (cx, cy, rad) in enumerate(wheels):
    px0, px1 = int(cx - rad), int(cx + rad)
    py0, py1 = int(cy - rad), int(cy + rad)
    crop = bus_img[max(0, py0):py1, max(0, px0):px1].copy()
    h, w = crop.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    ccx, ccy = cx - max(0, px0), cy - max(0, py0)
    d = np.sqrt((xx - ccx) ** 2 + (yy - ccy) ** 2)
    alpha = np.clip((rad - 1.5 - d) / 2.0, 0, 1)
    crop[:, :, 3] = (alpha * 255).astype(np.uint8)
    Image.fromarray(crop, "RGBA").save(os.path.join(OUT, f"wheel{i}.png"))

# ── 长椅：鸟占位补木色 ──
bx0, by0, bx1, by1 = rects["bench"]
bench = np.asarray(Image.open(os.path.join(OUT, "bench.png")).convert("RGBA")).copy()
fill_mask = np.zeros(bench.shape[:2], bool)
for name in ["bird1", "bird2", "bird3", "bird4", "bird6"]:
    ax0, ay0, ax1, ay1 = rects[name]
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    if ix1 <= ix0 or iy1 <= iy0:
        continue
    a = alphas[name][iy0 - ay0:iy1 - ay0, ix0 - ax0:ix1 - ax0] > 0.3
    fill_mask[iy0 - by0:iy1 - by0, ix0 - bx0:ix1 - bx0] |= a
fill_mask = ndimage.binary_dilation(fill_mask, iterations=3)
valid = ~fill_mask
inds = ndimage.distance_transform_edt(~valid, return_distances=False, return_indices=True)
filled = bench[inds[0], inds[1]].copy()
bench[fill_mask] = filled[fill_mask]
Image.fromarray(bench, "RGBA").save(os.path.join(OUT, "bench.png"))

# ── 天空色标 ──
stops = []
for i in range(9):
    y = int(i * (H - 1) / 8)
    c = bgcol[y].astype(int)
    stops.append("#%02x%02x%02x" % (c[0], c[1], c[2]))

meta = {
    "rects": {k: list(map(int, v)) for k, v in rects.items()},
    "wheels": [[BUS_RECT[0] + cx, BUS_RECT[1] + cy, rad] for (cx, cy, rad) in wheels],
    "size": [W, H],
    "skyStops": stops,
    "slatTop": int(slat_top),
}
with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as f:
    json.dump(meta, f, ensure_ascii=False, indent=1)

# ── 合成预览 ──
sky = np.repeat(bgcol[:, None, :], W, axis=1).astype(np.uint8)
canvas = Image.fromarray(sky.copy(), "RGB")
for name in ["bus", "sign", "bench", "bird1", "bird2", "bird3", "bird4", "bird6"]:
    im = Image.open(os.path.join(OUT, f"{name}.png"))
    cx0, cy0, cx1, cy1 = rects[name]
    canvas.paste(im, (cx0, cy0), im)
canvas.save(os.path.join(DBG, "composite.png"))

print("rects:", json.dumps(meta["rects"]))
print("wheels:", meta["wheels"])
print("done")
