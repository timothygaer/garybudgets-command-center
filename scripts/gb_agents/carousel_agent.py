"""
CarouselAgent — Instagram carousel build pipeline.

Phases (each is a runnable step; the LLM-heavy ones — research, write, verify —
are executed by a frontier orchestrating agent via delegate_task, never by a weak
local model):
  1. research   — gather real facts per topic (frontier agent)
  2. write      — produce 6-slide educational copy + caption + hashtags (frontier agent)
  3. generate   — one chatgpt-imagegen call per slide (scripted)
  4. verify     — independent montage-based quality gate (frontier agent)
  5. deploy     — git push + vercel + HTTP verify (scripted; NEVER approves)

The pipeline ends with posts at `ready` in the queue for the USER to approve.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

REPO = "/Users/dit/workspace/garybudgets-command-center"
IMG = os.path.join(REPO, "public", "images")
PY = "/Users/dit/hermes-hudui/venv/bin/python3"
PATH = "/Users/dit/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
SLIDE_COUNT = 6


def report(name: str, status: str = "working", post_id: str = "", phase: str = "", detail: str = ""):
    """Proxy to orchestrator.report_agent for live state.json updates."""
    import sys
    sys.path.insert(0, os.path.join(REPO, "scripts"))
    from scripts.gb_agents.orchestrator import report_agent
    report_agent(name, status, post_id, phase, detail)


def generate_one(post_id: str, slide: int, prompt: str, backend: str = "web") -> str:
    """Generate a single carousel slide with chatgpt-imagegen. Returns out path."""
    out = os.path.join(IMG, post_id, f"{slide}.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    env = dict(os.environ); env["PATH"] = PATH
    r = subprocess.run(
        ["chatgpt-imagegen", prompt, "--size", "1080x1350", "--backend", backend, "-o", out],
        capture_output=True, text=True, env=env, timeout=280,
    )
    if r.returncode != 0 or not (os.path.exists(out) and os.path.getsize(out) > 500_000):
        raise RuntimeError(f"slide {slide} generation failed: {r.stderr[-300:]}")
    return out


def build_montage(post_id: str, title: str) -> str:
    """Build a 2x3 montage for one-pass verification. Returns montage path."""
    script = _write_montage_helper()  # always write the arg-aware helper (stale copies exist)
    env = dict(os.environ)
    r = subprocess.run([PY, script, post_id, title], capture_output=True, text=True, env=env, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(f"montage build failed: {r.stderr[-300:]}")
    out = f"/tmp/gb_montages/{post_id}.png"
    if not os.path.exists(out):
        raise RuntimeError(f"montage build did not produce {out}")
    return out


def _write_montage_helper() -> str:
    path = "/tmp/gb_make_montages.py"
    with open(path, "w") as f:
        f.write(MONTAGE_HELPER)
    return path


MONTAGE_HELPER = r'''import sys, os
sys.path.insert(0, "/Users/dit/hermes-hudui/venv/lib/python3.11/site-packages")
from PIL import Image, ImageDraw
post_id, title = sys.argv[1], sys.argv[2]
IMG = "/Users/dit/workspace/garybudgets-command-center/public/images"
OUT = "/tmp/gb_montages"
os.makedirs(OUT, exist_ok=True)
slides = [Image.open(f"{IMG}/{post_id}/{i}.png").convert("RGB") for i in range(1, 7)]
tile_w, tile_h, header_h = 450, 562, 60
canvas = Image.new("RGB", (3*tile_w, header_h + 2*tile_h), (15,15,18))
ImageDraw.Draw(canvas).text((10,18), f"{post_id} — {title}", fill=(255,255,255))
for idx, img in enumerate(slides):
    r, c = divmod(idx, 3)
    canvas.paste(img.resize((tile_w, tile_h)), (c*tile_w, header_h + r*tile_h))
canvas.save(f"{OUT}/{post_id}.png")
print(f"{OUT}/{post_id}.png")
'''


class CarouselAgent:
    """Orchestrates a carousel build. LLM steps are called back by the parent agent."""

    def __init__(self, post: dict):
        self.post = post
        self.id = str(post.get("id") or "")
        self.title = str(post.get("title") or "")

    # --- phase 1-2: research + write are executed by the frontier orchestrating agent ---
    # The agent writes educational copy to /tmp/gb_slide_content.json keyed by post_id,
    # then calls generate().

    def generate(self, content: dict, backend: str = "web"):
        """Generate all slides for this carousel from approved educational content."""
        report("Carousel", "working", self.id, "generate", f"Generating {SLIDE_COUNT} slides")
        slides = content[self.id]["slides"]
        assert len(slides) == SLIDE_COUNT, f"{self.id} needs {SLIDE_COUNT} slides, got {len(slides)}"
        for s in slides:
            n = s["slide"]
            prompt = _build_prompt(self.id, n, s["heading"], s["text"])
            generate_one(self.id, n, prompt, backend=backend)
            print(f"[CarouselAgent:{self.id}] slide {n} generated")
            report("Carousel", "working", self.id, "generate", f"Slide {n}/{SLIDE_COUNT} done")
        report("Carousel", "done", self.id, "generate", "All slides generated")
        return os.path.join(IMG, self.id)

    def verify(self):
        """Build montage for the verifier agent (single vision call)."""
        return build_montage(self.id, self.title)

    def __repr__(self):
        return f"<CarouselAgent {self.id}: {self.title}>"


def _build_prompt(post_id, slide, heading, text, scenes=None):
    scene = (scenes or {}).get(slide, "dark cinematic film-production editorial scene")
    strict = ("Final slide only - this may contain garybudgets.com CTA. No fake UI, no logos, no extra words."
              if slide == 6 else
              "No website, no URL, no CTA, no slide numbers, no fake UI, no logos, no extra words.")
    return (f"Create ONE polished Instagram carousel slide, vertical 1080x1350, for Gary Budgets. "
            f"Cinematic dark film-production editorial, strong hierarchy, off-white typography, "
            f"restrained deep red accents, real production-world atmosphere. "
            f"VISUAL SUBJECT: {scene}. "
            f"STRICT REQUIREMENTS: Keep ALL main text inside safe margins. Readable mobile text. "
            f"Dark charcoal/black texture, moody lighting. Deep red accents sparingly. {strict} "
            f"EXACT TEXT TO PLACE ON THE SLIDE: {heading}. {text}")
