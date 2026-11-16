# -*- coding: utf-8 -*-
"""Assemble tested PNG parts into a separate, reproducible AR/VR preview.

No production assets or recognition targets are written. The output directory must
not exist. All sprite rectangles are explicitly mapped into the 1745x1280 target
coordinate system; the new composition is not exact registration to the old print.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ART_VERSION_RE = re.compile(
    r"(?m)^\s*const\s+ART_VERSION\s*=\s*(['\"])([0-9]+)\1\s*;"
)

from PIL import Image, ImageDraw

NAMES = ["bus", "bird1", "bird2", "bird3", "bird4", "bird6",
         "sign", "bench", "wheel0", "wheel1"]
BIRDS = ["bird1", "bird2", "bird3", "bird4", "bird6"]
STAGE = (60.0, 220.0, 1.025)
BUS = (53.0, 238.0, 1.16)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def runtime_version(index_text):
    matches = ART_VERSION_RE.findall(index_text)
    if len(matches) != 1:
        raise ValueError("Expected one numeric ART_VERSION in index.html")
    return matches[0][1]


def mapped_rect(rect, transform, shift=(0, 0)):
    dx, dy, scale = transform
    x0, y0, x1, y1 = rect
    return [round(dx + scale * (x0 + shift[0]), 4),
            round(dy + scale * (y0 + shift[1]), 4),
            round(dx + scale * (x1 + shift[0]), 4),
            round(dy + scale * (y1 + shift[1]), 4)]


def composite(images, meta, background, lift=0, bench_only=False):
    size = tuple(meta["size"])
    canvas = Image.new("RGBA", size, background or (225, 225, 225, 255))
    if background is None:
        draw = ImageDraw.Draw(canvas)
        for y in range(0, size[1], 24):
            for x in range(0, size[0], 24):
                if (x // 24 + y // 24) % 2:
                    draw.rectangle((x, y, x + 23, y + 23), fill=(185, 185, 185, 255))
    if background == "sky":
        raise ValueError("Pass an RGBA colour or None")
    order = ["bench"] if bench_only else ["bus", "wheel0", "wheel1", "sign", "bench"] + BIRDS
    for name in order:
        x0, y0, x1, y1 = meta["rects"][name]
        left, top = round(x0), round(y0) - (lift if name in BIRDS else 0)
        width, height = max(1, round(x1) - left), max(1, round(y1) - round(y0))
        im = images[name].resize((width, height), Image.Resampling.LANCZOS)
        canvas.alpha_composite(im, (left, top))
    return canvas


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError("Runtime pattern changed; refusing an unsafe patch: " + old[:80])
    return text.replace(old, new, 1)


def make_preview_page(project, output, art_version):
    import os
    original = (project / "index.html").read_text(encoding="utf-8")
    if runtime_version(original) != art_version:
        raise ValueError("Runtime version changed while building the preview")
    text = original.replace("./lib/", Path(os.path.relpath(project / "lib", output)).as_posix() + "/")
    audio = Path(os.path.relpath(project / "assets" / "audio", output)).as_posix() + "/"
    text = text.replace('"./assets/audio/', '"' + audio)
    target = Path(os.path.relpath(project / "assets" / "target.mind", output)).as_posix()
    text = replace_once(text, "'./assets/target.mind'", json.dumps(target))
    # Reuse the current production runtime, including wheel and startup fixes.
    version_badge = re.compile(r"(<p\b[^>]*>)v" + re.escape(art_version) + r"(</p>)")
    text, badge_count = version_badge.subn(
        lambda match: match.group(1) + "v" + art_version + " PNG · 本地候选 · 未验证手机 AR 对位" + match.group(2),
        text,
    )
    if badge_count != 1:
        raise ValueError("Expected one matching runtime version badge in index.html")
    # Debug surface is present only in the isolated preview; it does not alter production.
    text = replace_once(text, "return { group, animate, startDriveIn };",
        "return { group, animate, startDriveIn, birds, bench, busGroup, wheels, signGroup };")
    text = replace_once(text, "    state.art = art;",
        "    state.art = art;\n    window.__stickerPreview = { art, renderer, scene, camera, pause: false, time: 0, onlyBench: false, lift: 0 };")
    text = replace_once(text,
        "      t += elapsed;\n      art.animate(t);\n\n      /* 相机：",
        "      t += elapsed;\n      const liveT = t;\n      const debug = window.__stickerPreview;\n      const artT = debug.pause ? debug.time : liveT;\n      art.animate(artT);\n      art.birds.forEach(bird => { bird.visible = !debug.onlyBench; bird.position.y += debug.lift * UNIT; });\n      art.busGroup.visible = !debug.onlyBench;\n      art.signGroup.visible = !debug.onlyBench;\n\n      /* 相机：")
    text = replace_once(text, "</body>", '''<div id="previewChecks" style="position:fixed;bottom:65px;left:12px;z-index:60;display:flex;gap:8px;flex-wrap:wrap"><button data-check="normal">正常动画</button><button data-check="bench">只看长椅</button><button data-check="lift">鸟抬起 55px</button><span style="color:#ddd;font-size:11px">本地 PNG 候选 · 非手机 AR 验收</span></div>
<script>
window.__previewMetrics = { errors: [] };
window.addEventListener('error', event => window.__previewMetrics.errors.push(String(event.message)));
window.addEventListener('unhandledrejection', event => window.__previewMetrics.errors.push(String(event.reason)));
document.getElementById('arBtn').addEventListener('click', () => {
  const metric = window.__previewMetrics;
  metric.clickAt = performance.now();
  requestAnimationFrame(() => {
    metric.feedbackFrameMs = performance.now() - metric.clickAt;
    metric.feedbackText = document.getElementById('arBtn').textContent;
  });
}, { capture: true });
for (const button of document.querySelectorAll('[data-check]')) {
  button.addEventListener('click', () => {
    const debug = window.__stickerPreview;
    if (!debug) return;
    debug.onlyBench = button.dataset.check === 'bench';
    debug.lift = button.dataset.check === 'lift' ? 55 : 0;
    debug.pause = button.dataset.check !== 'normal';
    debug.time = 8;
  });
}
</script>
</body>''')
    output.joinpath("index.html").write_text(text, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--static", required=True, type=Path)
    parser.add_argument("--birds", required=True, type=Path)
    parser.add_argument("--bench", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    static = read_json(args.static / "static_parts.json")
    birds = read_json(args.birds / "metadata.json")["birds"]
    bench = read_json(args.bench / "metadata.json")["bench"]
    source_parts = {}
    for name in ("bus", "sign", "wheel0", "wheel1"):
        source_parts[name] = (args.static / (name + ".png"), static[name]["source_rect"])
    for name in BIRDS:
        source_parts[name] = (args.birds / birds[name]["file"], birds[name]["source_rect"])
    source_parts["bench"] = (args.bench / bench["file"], bench["source_rect"])
    images = {}
    for name, (path, rect) in source_parts.items():
        im = Image.open(path).convert("RGBA")
        if im.size != (rect[2] - rect[0], rect[3] - rect[1]):
            raise ValueError("Source geometry mismatch for " + name)
        alpha_box = im.getchannel("A").getbbox()
        if not alpha_box:
            raise ValueError("Empty alpha for " + name)
        if name in BIRDS and (alpha_box[0] == 0 or alpha_box[1] == 0
                              or alpha_box[2] == im.width or alpha_box[3] == im.height):
            raise ValueError("Bird silhouette touches crop boundary: " + name)
        images[name] = im
    # Raise the wheel hubs 12 source pixels (about 14 target pixels) further into the bus body.
    wheel_shift = (20, -40)
    rects = {name: mapped_rect(rect, BUS if name == "bus" or name.startswith("wheel") else STAGE,
                              wheel_shift if name.startswith("wheel") else (0, 0))
             for name, (_, rect) in source_parts.items()}
    index_text = (args.project / "index.html").read_text(encoding="utf-8")
    art_version = runtime_version(index_text)
    old_meta = read_json(args.project / "assets" / "sprites" / "meta.json")
    if str(old_meta.get("version")) != art_version:
        raise ValueError("Production metadata version does not match ART_VERSION")
    wheels = []
    for name in ("wheel0", "wheel1"):
        hx, hy = static[name]["hub"]
        wheels.append([round(BUS[0] + BUS[2] * (hx + wheel_shift[0]), 4),
                       round(BUS[1] + BUS[2] * (hy + wheel_shift[1]), 4),
                       round(BUS[2] * static[name]["half_size"], 4)])
    meta = {"version": art_version, "wheelFaces": [
                {"radius": 51 * BUS[2], "rollingRadius": 54 * BUS[2]},
                {"radius": 51 * BUS[2], "rollingRadius": 54 * BUS[2]}],
            "rects": rects, "wheels": wheels, "size": [1745, 1280],
            "skyStops": old_meta["skyStops"], "slatTop": round(STAGE[1] + STAGE[2] * 834),
            "signPivot": [round(STAGE[0] + STAGE[2] * 1388, 4),
                           round(STAGE[1] + STAGE[2] * 1004, 4)],
            "renderOrder": {"bus": 10, "wheel0": 11, "wheel1": 11, "sign": 20, "bench": 30,
                            "bird1": 40, "bird2": 41, "bird3": 42, "bird4": 43, "bird6": 44},
            "artwork": "Supplied PNG sticker reconstruction; not exact registration to printed target"}
    args.out.mkdir(parents=True, exist_ok=False)
    sprites = args.out / "assets" / "sprites"
    sprites.mkdir(parents=True)
    manifest = {"parts": {}, "recognition_targets_unchanged": {}}
    for name in NAMES:
        im = images[name]
        im.save(sprites / (name + ".png"))
        im.save(sprites / (name + ".webp"), "WEBP", quality=90, method=6, exact=True)
        decoded = Image.open(sprites / (name + ".webp")).convert("RGBA")
        if decoded.size != im.size or decoded.getchannel("A").tobytes() != im.getchannel("A").tobytes():
            raise ValueError("WebP alpha or size changed for " + name)
        source_path, source_rect = source_parts[name]
        manifest["parts"][name] = {"source": str(source_path), "source_rect": source_rect,
                                    "size": list(im.size), "target_rect": rects[name],
                                    "webp_bytes": (sprites / (name + ".webp")).stat().st_size}
    for name in ("target.jpg", "target-1024.jpg", "target.mind"):
        path = args.project / "assets" / name
        manifest["recognition_targets_unchanged"][name] = hashlib.sha256(path.read_bytes()).hexdigest()
    (sprites / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    checks = args.out / "checks"
    checks.mkdir()
    for label, colour in (("white", (255, 255, 255, 255)), ("black", (0, 0, 0, 255)),
                          ("sky", (177, 207, 226, 255)), ("checker", None)):
        composite(images, meta, colour).convert("RGB").save(checks / ("scene_" + label + ".png"))
    for lift in (0, 55):
        composite(images, meta, (177, 207, 226, 255), lift=lift).convert("RGB").save(checks / ("birds_lift_" + str(lift) + ".png"))
    composite(images, meta, (177, 207, 226, 255), bench_only=True).convert("RGB").save(checks / "bench_only.png")
    make_preview_page(args.project, args.out, art_version)
    print(json.dumps({"preview": str(args.out / "index.html"), "sprites": len(images),
                      "webp_bytes": sum(v["webp_bytes"] for v in manifest["parts"].values()),
                      "wheels": wheels, "signPivot": meta["signPivot"]}, indent=2))


if __name__ == "__main__":
    main()
