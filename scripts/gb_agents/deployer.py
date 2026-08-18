"""
Deployer — shared deployment + verification (never approves).

Takes verified assets, pushes to git, deploys to Vercel, and verifies:
  - all images HTTP 200 + >500KB in production
  - queue API shows post as ready (NOT approved)
This is the last step. It NEVER calls /api/approve or /api/publish — that is the
USER's step ("Approve & Schedule" in the UI).
"""
from __future__ import annotations

import os
import subprocess
import urllib.request

REPO = "/Users/dit/workspace/garybudgets-command-center"
BASE = "https://garybudgets-command-center.vercel.app"


def _run(cmd: list[str], timeout: int = 600) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} failed: {r.stderr[-400:]}")
    return r.stdout


def deploy_images(post_ids: list[str], message: str):
    """git add/commit/push the image dirs, then deploy. Returns deploy output."""
    add_args = ["git", "add", "manifest.json"]
    for pid in post_ids:
        add_args.append(os.path.join("public", "images", pid))
        add_args.append(os.path.join("public", "reels", pid.replace("-reel", "")))
    _run(add_args)
    _run(["git", "commit", "-q", "-m", message])
    _run(["git", "pull", "--rebase", "origin", "main"])
    _run(["git", "push", "origin", "main"])
    return _run(["npx", "vercel", "--prod", "--yes"], timeout=300)


def verify_http_200(post_ids: list[str], platform: str) -> bool:
    """HEAD-check every asset in production. carousel -> /images/<id>/N.png; reel -> /reels/<slug>.mp4."""
    all_ok = True
    for pid in post_ids:
        if platform == "reel":
            slug = pid.replace("-reel", "")
            url = f"{BASE}/reels/{slug}.mp4"
            if not _ok(url):
                print(f"  [FAIL] {url}"); all_ok = False
            continue
        for i in range(1, 7):
            url = f"{BASE}/images/{pid}/{i}.png"
            if not _ok(url):
                print(f"  [FAIL] {url}"); all_ok = False
    return all_ok


def _ok(url: str) -> bool:
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=30) as r:
            cl = int(r.headers.get("content-length", "0"))
            return r.status == 200 and cl > 500_000
    except Exception:
        return False
