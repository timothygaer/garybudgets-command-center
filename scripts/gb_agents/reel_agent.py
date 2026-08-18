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

Slug: pass an explicit readable slug (e.g. "actor-travel-costs-v2") so frames,
the designed.json spec, and the output MP4 all use the SAME slug. If omitted,
falls back to the post id. (Cleaned up 2026-08-17 — previously the scout ID was
used, which made spec/frame paths disagree.)
"""
from __future__ import annotations

import os
import subprocess

REPO = "/Users/dit/workspace/garybudgets-command-center"
PY = "/Users/dit/hermes-hudui/venv/bin/python3"
PATH = "/Users/dit/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
REELS_DIR = os.path.join(REPO, "public", "reels")
RENDERER = os.path.join(REPO, "scripts", "make_designed_reel.py")


def report(name: str, status: str = "working", post_id: str = "", phase: str = "", detail: str = ""):
    """Proxy to orchestrator.report_agent for live state.json updates."""
    import sys
    sys.path.insert(0, os.path.join(REPO, "scripts"))
    from scripts.gb_agents.orchestrator import report_agent
    report_agent(name, status, post_id, phase, detail)


class ReelAgent:
    def __init__(self, post: dict, slug: str | None = None):
        self.post = post
        self.id = str(post.get("id") or "")
        self.title = str(post.get("title") or "")
        # Explicit readable slug wins; else fall back to post id (minus -reel suffix).
        self.slug = slug or self.id.replace("-reel", "")

    @property
    def bg_dir(self):
        """Where designed frames are stored (one dir per reel slug)."""
        return os.path.join(REPO, "public", "reels", "bg", self.slug)

    def generate_frames(self, frames: list[dict], backend: str = "web"):
        """Generate 9:16 designed frames (one chatgpt-imagegen call each)."""
        report("Reel", "working", self.id, "generate", f"Generating {len(frames)} frames")
        bg = self.bg_dir
        os.makedirs(bg, exist_ok=True)
        env = dict(os.environ); env["PATH"] = PATH
        for fr in frames:
            n = fr["n"]; prompt = fr["prompt"]
            out = os.path.join(bg, f"{n:02d}.jpg")
            r = subprocess.run(
                ["chatgpt-imagegen", prompt, "--size", "1080x1920", "--format", "jpeg",
                 "--backend", backend, "-o", out],
                capture_output=True, text=True, env=env, timeout=280,
            )
            if r.returncode != 0 or not (os.path.exists(out) and os.path.getsize(out) > 500_000):
                report("Reel", "error", self.id, "generate", f"frame {n} failed")
                raise RuntimeError(f"reel frame {n} failed: {r.stderr[-300:]}")
            print(f"[ReelAgent:{self.id}] frame {n} generated")
            report("Reel", "working", self.id, "generate", f"Frame {n}/{len(frames)} done")
        report("Reel", "done", self.id, "generate", "All frames generated")
        return bg

    def render(self, spec_path: str):
        """Render a designed-reel MP4 from a designed.json spec. Returns out mp4 path."""
        report("Reel", "working", self.id, "render", "Rendering MP4")
        env = dict(os.environ); env["PATH"] = PATH
        r = subprocess.run([PY, RENDERER, spec_path], capture_output=True, text=True, env=env, timeout=1200)
        if r.returncode != 0:
            report("Reel", "error", self.id, "render", "render failed")
            raise RuntimeError(f"reel render failed: {r.stderr[-400:]}")
        mp4 = os.path.join(REELS_DIR, f"{self.slug}.mp4")
        if not os.path.exists(mp4):
            report("Reel", "error", self.id, "render", "no output mp4")
            raise RuntimeError(f"renderer did not produce {mp4}")
        report("Reel", "done", self.id, "render", f"Rendered {os.path.basename(mp4)}")
        return mp4

    def build_spec(self, scenes, music="public/reels/audio/music-licensing-traps-bed.m4a",
                   music_volume=0.34, out_dir: str | None = None):
        """Write the designed.json spec. Scenes = list of {dur, motion}. Returns spec path."""
        import json
        out_dir = out_dir or os.path.join(REPO, "scripts", "reels", self.slug)
        os.makedirs(out_dir, exist_ok=True)
        spec = {
            "slug": self.slug,
            "title": self.title.replace(" (Reel)", ""),
            "music": music,
            "music_volume": music_volume,
            "out_video": f"public/reels/{self.slug}.mp4",
            "out_montage": f"public/reels/{self.slug}-montage.jpg",
            "scenes": [
                {"img": f"public/reels/bg/{self.slug}/{i+1:02d}.jpg", "duration": s["dur"], "motion": s.get("motion", "zoom_in")}
                for i, s in enumerate(scenes)
            ],
        }
        path = os.path.join(out_dir, "designed.json")
        with open(path, "w") as f:
            json.dump(spec, f, indent=2)
        return path

    def __repr__(self):
        return f"<ReelAgent {self.id}: {self.title} slug={self.slug}>"
