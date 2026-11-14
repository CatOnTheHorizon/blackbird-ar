# -*- coding: utf-8 -*-
"""用 ORA 分层文件重建五只乌鸦的贴片。

ORA 的乌鸦图层本身手切得很干净，但有几处需要处理：
- 上层带进来的天空/白云高光（冷色浅色）要去掉；
- 底部会带一条长椅木色横线，改用现有 v25 贴片的干净脚/尾部分混合；
- ORA 里没有把枫叶、115 牌、横幅单独切出来（它们只在 ORA 预览叠原图时出现），
  这三样从原图/v25 贴片补回。
"""
import json
import os
import zipfile

import numpy as np
from PIL import Image
from scipy import ndimage

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "assets", "target.jpg")
SPRITES = os.path.join(BASE, "assets", "sprites")
ORA = os.path.join(BASE, "tools", "ora_src")
OUT = os.path.join(BASE, "tools", "ora_src", "new_sprites")
os.makedirs(OUT, exist_ok=True)

src = np.asarray(Image.open(SRC).convert("RGB")).astype(np.int16)
H, W = src.shape[:2]
R, G, B = src[:, :, 0], src[:, :, 1], src[:, :, 2]
yy, xx = np.mgrid[0:H, 0:W]
meta = json.load(open(os.path.join(SPRITES, "meta.json"), encoding="utf-8"))
RECTS = meta["rects"]


def ora_alpha(layer_idx):
    """ORA 画布 1439x1056 → 原图 1745x1280 的 alpha。"""
    a = np.asarray(Image.open(os.path.join(ORA, "data", "layer%d.png" % layer_idx)).convert("RGBA"))[:, :, 3]
    return np.asarray(Image.fromarray(a).resize((W, H), Image.BILINEAR)).astype(np.float32) / 255.0


def v25_alpha(name):
    x0, y0, x1, y1 = RECTS[name]
    im = np.asarray(Image.open(os.path.join(SPRITES, name + ".png")).convert("RGBA"))
    a = np.zeros((H, W), np.float32)
    a[y0:y0 + im.shape[0], x0:x0 + im.shape[1]] = im[:, :, 3] / 255.0
    return a


def clean_ora(a):
    """去掉冷色浅色天空/白云高光，保留鸟身、道具和暖色。"""
    cool = (src.max(axis=2) > 135) & (B >= R - 12) & (src.min(axis=2) > 85)
    a = a.copy()
    a[cool] = 0
    # 小碎片（噪声/邻层残片）去掉，保留鸟身和道具
    b = a > 0.35
    lab, n = ndimage.label(b)
    keep = np.zeros_like(b)
    for i in range(1, n + 1):
        if int((lab == i).sum()) >= 600:
            keep |= (lab == i)
    return a * keep


def blend_bottom(a, va):
    """鸟身上部用 ORA，脚/尾底部用 v25 的干净版本（去掉长椅横线）。"""
    g = np.clip((yy - 1080.0) / 20.0, 0.0, 1.0)
    return a * (1.0 - g) + va * g


def card_mask():
    """115 号牌：奶油色纸 + 黑色边框，补回 ORA 缺失的整块牌子。"""
    box = np.zeros((H, W), bool)
    box[830:920, 585:690] = True
    paper = (R > 210) & (G > 200) & (B > 145) & (R > B + 12) & box
    paper = ndimage.binary_fill_holes(ndimage.binary_closing(paper, iterations=2))
    card = ndimage.binary_dilation(paper, iterations=4) & (paper | (src.max(axis=2) < 115) | box)
    card = ndimage.binary_fill_holes(card)
    counts = (src.max(axis=2) < 115)[820:900, 595:680].sum(axis=1)
    top = None
    for i, c in enumerate(counts):
        if c > 30:
            top = 820 + i
            break
    if top is not None:
        card[:top + 1, :] = False
    lab, n = ndimage.label(card)
    if n:
        sizes = ndimage.sum(card, lab, range(1, n + 1))
        card = (lab == int(np.argmax(sizes)) + 1)
    return card


def banner_mask():
    """横幅：奶油卷轴 + 墨线 + 红杆，从原图泛洪（含 v25 同款纹理）。"""
    ink = src.max(axis=2) < 115
    red = (R > 120) & ((R - np.maximum(G, B)) > 55)
    zone = (yy >= 640) & (yy <= 880) & (xx >= 845) & (xx <= 1345)
    cream = (R > 195) & (G > 185) & (B > 148) & (B < 205) & (B < R + 8)
    bus_a = np.zeros((H, W), bool)
    b = np.asarray(Image.open(os.path.join(SPRITES, "bus.png")).convert("RGBA"))[:, :, 3] > 10
    bx0, by0, bx1, by1 = RECTS["bus"]
    bus_a[by0:by1, bx0:bx1] = b
    bus_a = ndimage.binary_dilation(bus_a, iterations=3)
    m = (cream | ink | red) & zone & ~bus_a
    seeds = np.zeros_like(m)
    for sx, sy in [(1000, 748), (1100, 742), (1160, 756), (930, 752), (1215, 762)]:
        if m[sy, sx]:
            seeds[sy, sx] = True
        else:
            sub = np.argwhere(m[sy - 8:sy + 9, sx - 8:sx + 9])
            if len(sub):
                seeds[sy - 8 + sub[0][0], sx - 8 + sub[0][1]] = True
    return ndimage.binary_propagation(seeds, mask=m)


CARD = card_mask()
BANNER = banner_mask()

BIRDS = {
    "bird1": (3, "leaf"),
    "bird2": (4, None),
    "bird3": (5, "card"),
    "bird4": (6, None),
    "bird6": (8, "banner"),
}

for name, (layer, extra) in BIRDS.items():
    x0, y0, x1, y1 = RECTS[name]
    a = clean_ora(ora_alpha(layer))
    va = v25_alpha(name)
    a = blend_bottom(a, va)

    if extra == "leaf":
        leaf = np.zeros((H, W), bool)
        leaf[815:905, 230:330] = True
        a = np.maximum(a, va * leaf)
    elif extra == "card":
        a = np.maximum(a, CARD.astype(np.float32))
    elif extra == "banner":
        a = np.maximum(a, BANNER.astype(np.float32))

    # 清掉孤立小碎片（例如 bird6 左下角的长椅金属件）
    b = a > 0.35
    lab, n = ndimage.label(b)
    keep = np.zeros_like(b)
    for i in range(1, n + 1):
        if int((lab == i).sum()) >= 500:
            keep |= (lab == i)
    a = a * keep
    # 椅面以下的细横线/细竖线（长椅边、残留线）用 3x3 开运算去掉，脚和尾巴主体保留
    band = np.zeros_like(a, bool)
    band[1100:y1, :] = True
    b = a > 0.45
    opened = ndimage.binary_opening(b, structure=np.ones((3, 3), bool))
    fixed = b.copy()
    fixed[band] = opened[band]
    a = np.clip(ndimage.gaussian_filter(fixed.astype(np.float32), 0.5), 0, 1)

    af = a[y0:y1, x0:x1]
    rgba = np.dstack([src[y0:y1, x0:x1].astype(np.uint8), (af * 255).astype(np.uint8)])
    Image.fromarray(rgba, "RGBA").save(os.path.join(OUT, name + ".png"))

    bg = Image.new("RGBA", (x1 - x0, y1 - y0), (55, 55, 70, 255))
    bg.alpha_composite(Image.fromarray(rgba, "RGBA"))
    bg.convert("RGB").save(os.path.join(OUT, name + "_check.png"))
    print("%s <- layer%d, alpha px %d" % (name, layer, int((af > 0.3).sum())))

print("done")
