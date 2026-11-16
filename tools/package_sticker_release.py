# -*- coding: utf-8 -*-
"""Create a clean release stage using the current production runtime.

This writes a new stage directory only. It never changes production assets or
index.html; promotion to the repository root is a separate, explicit action.
Run with Python 3.10 -I and --out pointing to a new directory.
"""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

ART_VERSION_RE = re.compile(
    r"(?m)^\s*const\s+ART_VERSION\s*=\s*(['\"])([0-9]+)\1\s*;"
)
SPRITES = ["bus", "wheel0", "wheel1", "bird1", "bird2", "bird3", "bird4", "bird6", "sign", "bench"]
TARGETS = ["target.jpg", "target-1024.jpg", "target.mind"]


def patch_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError("Runtime source changed; refusing a non-unique patch: " + old[:90])
    return text.replace(old, new, 1)


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def runtime_version(text):
    matches = ART_VERSION_RE.findall(text)
    if len(matches) != 1:
        raise ValueError("Expected one numeric ART_VERSION in index.html")
    return matches[0][1]


def build_index(source):
    text = source.read_text(encoding="utf-8")
    art_version = runtime_version(text)
    if f">v{art_version}</p>" not in text:
        raise ValueError("Runtime version badge does not match ART_VERSION")
    if "previewChecks" in text or "__stickerPreview" in text or "window.__previewMetrics" in text:
        raise ValueError("Preview-only diagnostics must not enter release HTML")
    return text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True,
                        help="Candidate assets/sprites directory")
    parser.add_argument("--out", type=Path, required=True,
                        help="New staging directory; no existing output is overwritten")
    args = parser.parse_args()
    project = args.project.resolve(strict=True)
    candidate = args.candidate.resolve(strict=True)
    out = args.out.resolve()
    if out.exists():
        raise ValueError("Stage output already exists; select a new directory")
    if candidate == project / "assets" / "sprites":
        raise ValueError("Candidate must be separate from production assets")
    source_index = project / "index.html"
    source_lib = project / "lib"
    source_assets = project / "assets"
    if not source_index.is_file() or not source_lib.is_dir():
        raise ValueError("Expected static project root with index.html and lib/")
    for name in SPRITES:
        if not (candidate / (name + ".png")).is_file() or not (candidate / (name + ".webp")).is_file():
            raise ValueError("Missing candidate sprite: " + name)
    if not (candidate / "meta.json").is_file():
        raise ValueError("Candidate metadata is missing")
    meta = json.loads((candidate / "meta.json").read_text(encoding="utf-8"))
    metadata_version = str(meta.get("version", ""))
    if not metadata_version.isdigit() or len(meta.get("wheelFaces", [])) != 2:
        raise ValueError("Candidate metadata must have a numeric version and two wheel faces")
    index_text = build_index(source_index)
    if runtime_version(index_text) != metadata_version:
        raise ValueError("Runtime ART_VERSION does not match candidate metadata")

    out.mkdir(parents=True, exist_ok=False)
    shutil.copytree(source_lib, out / "lib")
    stage_assets = out / "assets"
    stage_assets.mkdir()
    for name in TARGETS:
        shutil.copy2(source_assets / name, stage_assets / name)
    stage_sprites = stage_assets / "sprites"
    shutil.copytree(candidate, stage_sprites)
    (out / "index.html").write_text(index_text, encoding="utf-8")
    manifest = {name: sha256(stage_assets / name) for name in TARGETS}
    print("Release stage:", out)
    print("Preview:", out / "index.html")
    print("Sprites:", len(SPRITES))
    print("Recognition target SHA-256:", json.dumps(manifest, sort_keys=True))


if __name__ == "__main__":
    main()
