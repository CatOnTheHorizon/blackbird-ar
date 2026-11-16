# -*- coding: utf-8 -*-
"""Build a PNG-derived candidate scene without overwriting production.

Run with Python 3.10 -I from outside the source input directory. The source must
be alone in a separate input directory; --out must be a new, empty output path.
Each helper is executed from the maintained tools directory, never from input.
"""
import argparse
from pathlib import Path
import subprocess
import sys


def run(script, *arguments):
    subprocess.run([sys.executable, "-I", str(script), *map(str, arguments)],
                   cwd=str(script.parent.parent), check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path,
                        help="Supplied sticker.png in a source-only isolated input directory")
    parser.add_argument("--out", required=True, type=Path,
                        help="New output directory, not assets/sprites")
    args = parser.parse_args()
    source, output = args.source.resolve(strict=True), args.out.resolve()
    project = Path(__file__).resolve().parent.parent
    tools = project / "tools"
    if output == source.parent or source.parent in output.parents:
        raise ValueError("Output must not be inside the isolated input directory")
    if output == project / "assets" or project / "assets" in output.parents:
        raise ValueError("Candidate generation must not write production assets")
    output.mkdir(parents=True, exist_ok=False)
    static, birds, bench = output / "parts_static", output / "parts_birds", output / "parts_bench"
    run(tools / "extract_sticker_static.py", "--source", source, "--out", static)
    # Bird and bench final CLI invocations are documented in the candidate README.
    # Generation intentionally stops here if their source-only APIs have changed.
    run(tools / "refine_bird_candidates.py", "--source", source, "--authoritative", source,
        "--output", birds, "--stage", "refine", "--final")
    run(tools / "refine_bench_candidate.py", "--source", source, "--out", bench)
    run(tools / "build_sticker_preview.py", "--project", project, "--static", static,
        "--birds", birds, "--bench", bench, "--out", output / "scene")
    print("Candidate-only scene:", output / "scene" / "index.html")


if __name__ == "__main__":
    main()
