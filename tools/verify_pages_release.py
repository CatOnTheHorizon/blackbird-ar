# -*- coding: utf-8 -*-
"""Verify actual Pages bytes against a committed release, using the system proxy.

No downloaded content is executed or written to disk. Text is compared with the
committed Git blobs, avoiding Windows working-tree line-ending differences.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

NAMES = ["bus", "wheel0", "wheel1", "bird1", "bird2", "bird3", "bird4", "bird6", "sign", "bench"]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--revision", default="HEAD")
    parser.add_argument("--version", default="28")
    parser.add_argument("--attempts", type=int, default=16)
    parser.add_argument("--interval", type=int, default=15)
    args = parser.parse_args()
    parsed = urllib.parse.urlparse(args.base)
    if parsed.scheme != "https" or parsed.hostname != "catonthehorizon.github.io" or parsed.path.rstrip("/") != "/blackbird-ar":
        raise SystemExit("Verifier is restricted to the configured blackbird-ar Pages site")
    if not args.version.isdigit():
        raise SystemExit("Version must be numeric")
    paths = ["index.html", "assets/sprites/meta.json"]
    paths.extend("assets/sprites/" + name + ".webp" for name in NAMES)
    paths.append("assets/target.mind")
    expected = {}
    for name in paths:
        data = subprocess.check_output(["git", "-C", str(args.project), "show", args.revision + ":" + name])
        expected[name] = sha(data)
    commit = subprocess.check_output(["git", "-C", str(args.project), "rev-parse", args.revision], text=True).strip()
    base = args.base.rstrip("/") + "/"
    # GitHub is an overseas service and must use the configured Clash proxy.
    proxy = urllib.request.ProxyHandler({"https": "http://127.0.0.1:7890", "http": "http://127.0.0.1:7890"})

    def check(name):
        resource = "" if name == "index.html" else name
        suffix = "?v=" + args.version if name != "assets/target.mind" else ""
        url = base + resource + suffix
        last = None
        for retry in range(3):
            try:
                opener = urllib.request.build_opener(proxy)
                request = urllib.request.Request(url, headers={"Accept-Encoding": "identity", "Cache-Control": "no-cache"})
                with opener.open(request, timeout=30) as response:
                    body = response.read()
                    actual = sha(body)
                    return {"path": name, "url": url, "http": response.status,
                            "bytes": len(body), "sha256": actual,
                            "match": actual == expected[name], "age": response.headers.get("Age"),
                            "etag": response.headers.get("ETag")}
            except (OSError, urllib.error.URLError) as error:
                last = str(error)
                if retry < 2:
                    time.sleep(2 ** retry)
        return {"path": name, "url": url, "match": False, "error": last}

    for attempt in range(1, args.attempts + 1):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(check, paths))
        matches = sum(item["match"] for item in results)
        print(f"Pages check {attempt}/{args.attempts}: {matches}/{len(paths)} committed files match", flush=True)
        if matches == len(paths):
            print(json.dumps({"verified": True, "commit": commit, "version": args.version,
                              "files": results}, ensure_ascii=False, indent=2), flush=True)
            return
        mismatches = [item["path"] for item in results if not item["match"]]
        print("Not updated:", ", ".join(mismatches), flush=True)
        if attempt < args.attempts:
            time.sleep(args.interval)
    print(json.dumps({"verified": False, "commit": commit, "files": results}, ensure_ascii=False, indent=2))
    raise SystemExit("Pages does not yet match the release; publication is not verified")


if __name__ == "__main__":
    main()
