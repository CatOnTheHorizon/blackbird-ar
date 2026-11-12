# -*- coding: utf-8 -*-
"""从月历插画中抠出各元素为透明 PNG 贴片（最终版）
方法：以「深色墨线 + 红色」为边界，从画面边缘 flood 圈背景；
墨线闭合区域全部视为元素；站牌黄盘按红环拟合圆强制填充。"""
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

# ── 边界：深色墨线 + 红色 ──
ink  = img.max(axis=2) < 115
red  = (R > 120) & ((R - np.maximum(G, B)) > 55)
barrier = ink | red
free = ~barrier
lab, n = ndimage.label(free)
border_ids = set(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]).tolist())
border_ids.discard(0)
bg = np.isin(lab, list(border_ids))
fg = ~bg

# ── 长椅上沿（木色出现的最早行）──
wood = (R > 165) & (G > 125) & (G < 205) & (B < 140)
slat_top = H
for y in range(int(H * 0.7), H):
    if wood[y, 300:1000].mean() > 0.35:
        slat_top = y
        break
print("slat_top =", slat_top)

def feather(b, sigma=0.8):
    return np.clip(ndimage.gaussian_filter(b.astype(np.float32), sigma), 0, 1)

def keep_seed_components(mask, seeds, min_area=250):
    lab2, n2 = ndimage.label(mask)
    keep = np.zeros_like(mask)
    ids = set()
    for sx, sy in seeds:
        if 0 <= sy < mask.shape[0] and 0 <= sx < mask.shape[1]:
            i = lab2[sy, sx]
            if i:
                ids.add(i)
    if not ids:
        sizes = ndimage.sum(mask, lab2, range(1, n2 + 1))
        if n2:
            ids.add(int(np.argmax(sizes)) + 1)
    for i in ids:
        keep |= (lab2 == i)
    lab3, n3 = ndimage.label(keep)
    out = np.zeros_like(keep)
    for i in range(1, n3 + 1):
        comp = (lab3 == i)
        if comp.sum() >= min_area:
            out |= comp
    return out

SLAT = slat_top - 3
CROPS = {
    "bus":   (145, 160, 1225, 830,  [(680, 400)]),
    "bird1": (60,   740, 350,  SLAT, [(190, 950 - 740)]),
    "bird2": (300,  790, 560,  SLAT, [(420, 950 - 790)]),
    "bird3": (495,  680, 815,  SLAT, [(650, 950 - 680), (575, 760 - 680)]),
    "bird4": (760,  790, 1085, SLAT, [(880, 950 - 790), (1000, 1030 - 790)]),
    "bird6": (850,  650, 1345, SLAT, [(1130, 950 - 690), (1085, 765 - 690)]),
    "sign":  (1330, 0,   1745, 1280, None),   # None = 保留全部大组件（不做种子筛选）
    "bench": (55,  slat_top - 6, 1300, 1280, [(600, 100), (150, 250)]),
}

rects, alphas = {}, {}
for name, (x0, y0, x1, y1, seeds) in CROPS.items():
    fgc = fg[y0:y1, x0:x1]
    if seeds is None:
        # 站牌：保留所有面积够大的组件（红环/黄盘/乌鸦/杆），去火星点
        lab2, n2 = ndimage.label(fgc)
        keep = np.zeros_like(fgc)
        for i in range(1, n2 + 1):
            comp = (lab2 == i)
            if comp.sum() >= 1500:
                keep |= comp
    else:
        keep = keep_seed_components(fgc, seeds)
    if name == "bird6":
        # 横幅卷轴：墨线（+红）闭合填充，把卷轴底色和文字补回来
        b_ink = barrier[y0:y1, x0:x1] | red[y0:y1, x0:x1]
        bs, be = max(0, 650 - y0), 870 - y0      # 横幅带的裁剪内纵向范围
        strip = np.zeros_like(b_ink)
        strip[bs:be, :] = b_ink[bs:be, :]
        keep |= ndimage.binary_fill_holes(strip)
    a = feather(keep)
    rgba = np.dstack([img[y0:y1, x0:x1], (a * 255).astype(np.uint8)])
    im = Image.fromarray(rgba.astype(np.uint8), "RGBA")
    im.save(os.path.join(OUT, f"{name}.png"))
    rects[name] = (x0, y0, x1, y1)
    alphas[name] = a
    checker = Image.new("RGB", (x1 - x0, y1 - y0), (45, 45, 60))
    checker.paste(im, (0, 0), im)
    checker.save(os.path.join(DBG, f"{name}_check.png"))

# ── 鸟贴片去重：后处理的鸟扣掉前面鸟已占据的像素（避免重叠区在动画中分身）──
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

# ── 站牌黄盘：按黄色区域检测圆心半径，强制填充内部 ──
x0, y0, x1, y1 = rects["sign"]
sign_rgb = img[y0:y1, x0:x1]
yellow = (sign_rgb[:, :, 0] > 185) & (sign_rgb[:, :, 1] > 160) & (sign_rgb[:, :, 2] < 150)
yellow[int(y1 * 0.45):, :] = False      # 只看上半部分（黄盘）
y_lab, y_n = ndimage.label(yellow)
sign_file = os.path.join(OUT, "sign.png")
sign_img = np.asarray(Image.open(sign_file).convert("RGBA")).copy()
if y_n:
    sizes = ndimage.sum(yellow, y_lab, range(1, y_n + 1))
    ci = int(np.argmax(sizes)) + 1
    ys, xs = np.nonzero(y_lab == ci)
    ccx, ccy = xs.mean(), ys.mean()
    rad = 0.5 * max(xs.max() - xs.min(), ys.max() - ys.min()) + 6
    yy, xx = np.mgrid[0:sign_img.shape[0], 0:sign_img.shape[1]]
    d = np.sqrt((xx - ccx) ** 2 + (yy - ccy) ** 2)
    inside = np.clip((rad - d) / 2.5, 0, 1)
    sign_img[:, :, 3] = np.maximum(sign_img[:, :, 3], (inside * 255).astype(np.uint8))
    Image.fromarray(sign_img, "RGBA").save(sign_file)
    print("disc filled: c=(%.0f,%.0f) r=%.0f" % (ccx, ccy, rad))
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
bgcol = np.zeros((H, 3), np.float32)
for y in range(H):
    bgcol[y] = np.median(img[y, 0:40].astype(np.float32), axis=0)
bgcol = ndimage.uniform_filter1d(bgcol, size=25, axis=0)
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
