"""
ReelAgent — Instagram reel build pipeline (designed-slide v2 style).

Phases:
  1. research   — topic facts (frontier agent)
  2. write      — 6 designed-frame specs (headline, bullets, CTA) at 1080x1920 (frontier agent)
  3. generate   — one chatgpt-imagegen call per frame (1080x1920) + render via make_designed_reel.py
  4. verify     — montage/frame QA gate (frontier agent)
  5. deploy     — git push + vercel + HTTP verify (scripted; NEVER approves)

Ends with reel at `ready` in queue for USER approval. Reel manifest entries must
carry video_url + cover_url, NOT image_urls (Oracle publisher rules).
"""
from __future__ import annotations

import os
import subprocess

REPO = "/Users/dit/workspace/garybudgets-command-center"
PY = "/Users/dit/hermes-hudui/venv/bin/python3"
PATH = "/Users/dit/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
REELS_DIR = os.path.join(REPO, "public", "reels")
RENDERER = os.path.join(REPO, "scripts", "make_designed_reel.py")


class ReelAgent:
    def __init__(self, post: dict):
        self.post = post
        self.id = str(post.get("id") or "")
        self.title = str(post.get("title") or "")
        self.slug = self.id.replace("-reel", "")

    def render(self, spec_path: str):
        """Render a designed-reel MP4 from a designed.json spec. Returns out mp4 path."""
        env = dict(os.environ); env["PATH"] = PATH
        r = subprocess.run([PY, RENDERER, spec_path], capture_output=True, text=True, env=env, timeout=1200)
        if r.returncode != 0:
            raise RuntimeError(f"reel render failed: {r.stderr[-400:]}")
        mp4 = os.path.join(REELS_DIR, f"{self.slug}.mp4")
        if not os.path.exists(mp4):
            raise RuntimeError(f"renderer did not produce {mp4}")
        return mp4

    def generate_frames(self, frames: list[dict], backend: str = "web"):
        """Generate 9:16 designed frames (one chatgpt-imagegen call each)."""
        import subprocess as sp
        bg = os.path.join(REPO, "public", "reels", "bg", self.slug)
        os.makedirs(bg, exist_ok=True)
        env = dict(os.environ); env["PATH"] = PATH
        for fr in frames:
            n = fr["n"]; prompt = fr["prompt"]
            out = os.path.join(bg, f"{n:02d}.jpg")
            r = sp.run(
                ["chatgpt-imagegen", prompt, "--size", "1080x1920", "--format", "jpeg", "--backend", backend, "-o", out],
                capture_output=True, text=True, env=env, timeout=280,
            )
            if r.returncode != 0 or not (os.path.exists(out) and os.path.getsize(out) > 500_000):
                raise RuntimeError(f"reel frame {n} failed: {r.stderr[-300:]}")
            print(f"[ReelAgent:{self.id}] frame {n} generated")
        return bg

    def __repr__(self):
        return f"<ReelAgent {self.id}: {self.title}>"
