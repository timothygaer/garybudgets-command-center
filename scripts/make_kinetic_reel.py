#!/usr/bin/env python3
"""Gary Budgets kinetic reel engine.

Pipeline: AI cinematic background per scene (1024x1536) + kinetic typography
(Archivo Black / Anton / Bebas Neue / Roboto) + Ken Burns motion + real music.

Usage:
  make_kinetic_reel.py spec.json [--out OUT.mp4] [--frames-dir DIR]
                                [--no-audio] [--frame N] [--montage-only]

Spec: JSON file (see reels/<slug>/spec.json for examples).
  - slug, title, fps, music (path), music_volume, fades
  - bg_dir: directory holding per-scene background images
  - scenes[]: { name, duration, bg (filename), kenburns (zoom_in|zoom_out|pan_up|pan_down|pan_right|none),
                blocks: [
                  { kind: headline|sub|check|cta,
                    lines: [{text, font, size, color}]   // for headline
                    text: "..."                           // for sub/cta
                    anim: elastic_scale|punch|fade_up|expand|slide_left
                    stagger: seconds between lines
                    delay: seconds before block starts
                    y: vertical center position (fraction of height) } ] }

Output: 1080x1920 H.264 MP4 @ fps + AAC music bed. A 2x3 QA montage is written
next to the output as <slug>-montage.jpg.
"""
from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ───────────────────────────── constants ─────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "assets" / "fonts"
W, H = 1080, 1920
FPS = 30
BG_BASE = (1440, 2160)      # virtual canvas for Ken Burns headroom (2:3)
WIN_W = 1215                # 9:16 window width inside BG_BASE at zoom 1.0
WIN_H = 2160
PALETTE = {
    "white": (245, 239, 226),
    "muted": (176, 169, 154),
    "red": (218, 32, 42),
    "deep_red": (96, 12, 18),
    "amber": (245, 178, 74),
    "green": (70, 190, 128),
    "blue": (72, 111, 170),
    "ink": (8, 9, 14),
}

FONT_MAP = {
    "ArchivoBlack": "ArchivoBlack-Regular.ttf",
    "Anton": "Anton-Regular.ttf",
    "BebasNeue": "BebasNeue-Regular.ttf",
    "Roboto": "Roboto-Regular.ttf",
    "RobotoMedium": "Roboto-Medium.ttf",
    "RobotoBold": "Roboto-Bold.ttf",
}


def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    path = FONTS / FONT_MAP[name]
    return ImageFont.truetype(str(path), size=size)


def hex_rgb(v: str) -> tuple:
    v = v.lstrip("#")
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))


# ───────────────────────────── easing ─────────────────────────────
def clamp01(t):
    return max(0.0, min(1.0, t))


def ease_out_cubic(t):
    t = clamp01(t)
    return 1 - (1 - t) ** 3


def ease_in_out(t):
    t = clamp01(t)
    return t * t * (3 - 2 * t)


def ease_out_back(t, s=1.70158):
    t = clamp01(t) - 1
    return 1 + (t * t * ((s + 1) * t + s))


def elastic_out(t):
    t = clamp01(t)
    if t == 0 or t == 1:
        return t
    return 2 ** (-10 * t) * math.sin((t * 10 - 0.75) * (2 * math.pi / 3)) + 1


# ───────────────────────────── Ken Burns ─────────────────────────────
def kenburns_box(kind: str, t: float) -> tuple:
    """Return (x, y, w, h) crop window inside BG_BASE for progress t in [0,1]."""
    t = clamp01(t)
    if kind == "zoom_in":
        w = WIN_W - int((WIN_W * 0.12) * t)
        x = (BG_BASE[0] - w) // 2
    elif kind == "zoom_out":
        w = WIN_W - int((WIN_W * 0.12) * (1 - t))
        x = (BG_BASE[0] - w) // 2
    elif kind == "pan_up":
        w = WIN_W
        x = (BG_BASE[0] - w) // 2
        y = int((BG_BASE[1] - WIN_H) * (1 - t))
        return (x, y, w, WIN_H)
    elif kind == "pan_down":
        w = WIN_W
        x = (BG_BASE[0] - w) // 2
        y = int((BG_BASE[1] - WIN_H) * t)
        return (x, y, w, WIN_H)
    elif kind == "pan_right":
        w = WIN_W
        x = int((BG_BASE[0] - w) * t)
        return (x, 0, w, WIN_H)
    elif kind == "pan_left":
        w = WIN_W
        x = int((BG_BASE[0] - w) * (1 - t))
        return (x, 0, w, WIN_H)
    else:  # none
        w = WIN_W
        x = (BG_BASE[0] - w) // 2
    return (x, 0, w, WIN_H)


# ───────────────────────────── text layers ─────────────────────────────
class TextLayer:
    """Pre-rendered RGBA layer for one text block (or one line)."""

    def __init__(self, img: Image.Image, cx: int, cy: int):
        self.img = img  # RGBA, tightly cropped
        self.cx = cx    # anchor center x in output coords
        self.cy = cy    # anchor center y

    def paste(self, canvas: Image.Image, scale: float = 1.0, dx: float = 0.0,
              dy: float = 0.0, alpha: float = 1.0):
        if alpha <= 0.01 or scale <= 0.01:
            return
        img = self.img
        if scale != 1.0:
            nw = max(1, int(img.width * scale))
            nh = max(1, int(img.height * scale))
            img = img.resize((nw, nh), Image.Resampling.LANCZOS)
        if alpha < 1.0:
            img = img.copy()
            a = img.getchannel("A").point(lambda v: int(v * alpha))
            img.putalpha(a)
        x = int(self.cx + dx - img.width / 2)
        y = int(self.cy + dy - img.height / 2)
        canvas.alpha_composite(img, (x, y))


def render_text_layer(lines: list, font_size: int, font_name: str,
                      color, line_gap: int = 14, stroke: int = 0) -> TextLayer:
    """Render centered multi-line text at output resolution (no scaling applied
    yet — scale/position happens at paste time)."""
    font = load_font(font_name, font_size)
    tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    # measure
    widths, heights = [], []
    for line in lines:
        bb = d.textbbox((0, 0), line, font=font, stroke_width=stroke)
        widths.append(bb[2] - bb[0])
        heights.append(bb[3] - bb[1])
    total_h = sum(heights) + line_gap * (len(lines) - 1)
    block_h = max(heights) if lines else 1
    block_w = max(widths) if widths else 1
    canvas = Image.new("RGBA", (block_w + 40, total_h + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    yy = 20
    for line, wline, hline in zip(lines, widths, heights):
        d.text(((block_w - wline) // 2 + 20, yy), line, font=font, fill=color + (255,),
               stroke_width=stroke, stroke_fill=(0, 0, 0, 160))
        yy += hline + line_gap
    # center anchor at output center
    return TextLayer(canvas, W // 2, H // 2)


def render_line_layer(text: str, font_size: int, font_name: str, color,
                      stroke: int = 0) -> TextLayer:
    font = load_font(font_name, font_size)
    tmp = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    bb = d.textbbox((0, 0), text, font=font, stroke_width=stroke)
    w = bb[2] - bb[0] + 40
    h = bb[3] - bb[1] + 40
    canvas = Image.new("RGBA", (int(w), int(h)), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    # hard shadow for contrast on bright backgrounds
    d.text((20 - bb[0] + 5, 20 - bb[1] + 6), text, font=font, fill=(0, 0, 0, 150),
           stroke_width=stroke, stroke_fill=(0, 0, 0, 150))
    d.text((20 - bb[0], 20 - bb[1]), text, font=font, fill=color + (255,),
           stroke_width=stroke, stroke_fill=(0, 0, 0, 160))
    return TextLayer(canvas, W // 2, H // 2)


# ───────────────────────────── block animation ─────────────────────────────
def block_transform(anim: str, t: float, dur: float):
    """Return (scale, dx, dy, alpha) for animation progress t in [0,1]."""
    if anim == "elastic_scale":
        p = ease_out_back(clamp01(t / (dur * 0.55)))
        return (0.2 + 0.8 * p, 0, 0, 1.0)
    if anim == "punch":
        p = elastic_out(clamp01(t / (dur * 0.5)))
        return (1.35 - 0.35 * p, 0, 0, 1.0)
    if anim == "fade_up":
        p = clamp01(t / (dur * 0.4))
        return (1.0, 0, int((1 - p) * 60), p)
    if anim == "slide_left":
        p = clamp01(t / (dur * 0.5))
        return (1.0, int((1 - p) * 260), 0, p)
    if anim == "expand":
        p = ease_out_cubic(clamp01(t / (dur * 0.5)))
        return (0.05 + 0.95 * p, 0, 0, 1.0)
    return (1.0, 0, 0, 1.0)


# ───────────────────────────── overlays ─────────────────────────────
def make_overlays():
    """Bottom gradient + vignette, composited over the bg every frame."""
    grad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(grad)
    for i in range(H):
        if i < 480:
            continue
        t = (i - 480) / (H - 480)
        a = int(210 * t ** 1.6)
        d.line([(0, i), (W, i)], fill=(0, 0, 0, a))
    # top subtle shade for progress bar legibility
    for i in range(0, 200):
        d.line([(0, i), (W, i)], fill=(0, 0, 0, int(90 * (1 - i / 200))))
    vign = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(vign)
    for y in range(0, H, 8):
        for x in range(0, W, 8):
            nx = x / W - 0.5
            ny = y / H - 0.5
            dist = math.hypot(nx * 2, ny * 2) / 1.2
            if dist > 1:
                continue
            a = int((1 - dist) ** 2 * 60)
            d.rectangle([x, y, x + 8, y + 8], fill=(0, 0, 0, a))
    return grad, vign


def draw_progress(canvas: Image.Image, scenes: list, scene_idx: int, t: float):
    """Top story-style progress segments."""
    d = ImageDraw.Draw(canvas, "RGBA")
    n = len(scenes)
    gap = 10
    seg_w = (W - 2 * 60 - gap * (n - 1)) // n
    y0 = 54
    for i in range(n):
        x0 = 60 + i * (seg_w + gap)
        d.rounded_rectangle([x0, y0, x0 + seg_w, y0 + 8], radius=4,
                            fill=(255, 255, 255, 40))
        if i < scene_idx:
            d.rounded_rectangle([x0, y0, x0 + seg_w, y0 + 8], radius=4,
                                fill=(218, 32, 42, 235))
        elif i == scene_idx:
            d.rounded_rectangle([x0, y0, x0 + int(seg_w * t), y0 + 8], radius=4,
                                fill=(218, 32, 42, 235))


def draw_brand(canvas: Image.Image):
    d = ImageDraw.Draw(canvas, "RGBA")
    f = load_font("RobotoMedium", 30)
    d.text((60, 170), "GARY BUDGETS", font=f, fill=(245, 239, 226, 170))
    d.rectangle([60, 208, 60 + 46, 212], fill=(218, 32, 42, 220))


# ───────────────────────────── scene render ─────────────────────────────
def build_text_blocks(scene: dict):
    """Pre-render all TextLayers for a scene: returns list of
    (layer, anim, delay, stagger, duration)."""
    blocks = []
    for b in scene.get("blocks", []):
        kind = b.get("kind", "headline")
        anim = b.get("anim", "fade_up")
        delay = b.get("delay", 0.0)
        stagger = b.get("stagger", 0.0)
        dur = scene.get("duration", 3.0)
        y = b.get("y", 0.35)
        cy = int(y * H)
        if kind == "headline":
            lines = b["lines"]
            # one layer per line so we can stagger them
            for i, ln in enumerate(lines):
                layer = render_line_layer(
                    ln["text"], ln.get("size", 96), ln.get("font", "ArchivoBlack"),
                    hex_rgb(ln.get("color", "#F5EFE2")), stroke=ln.get("stroke", 0))
                layer.cy = cy + int((i - (len(lines) - 1) / 2) * ln.get("size", 96) * 1.12)
                blocks.append((layer, anim, delay + i * stagger, 0.0, dur))
        elif kind == "sub":
            layer = render_line_layer(
                b["text"], b.get("size", 42), b.get("font", "Roboto"),
                hex_rgb(b.get("color", "#B0A99A")))
            layer.cy = cy
            blocks.append((layer, anim, delay, 0.0, dur))
        elif kind == "check":
            # checklist item: 'text' with optional color; expands in staggered
            items = b["items"]
            for i, it in enumerate(items):
                layer = render_line_layer(
                    it["text"], it.get("size", 58), it.get("font", "RobotoBold"),
                    hex_rgb(it.get("color", "#F5EFE2")))
                layer.cy = int(b.get("y0", 0.55) * H) + i * it.get("size", 58) * 1.5
                blocks.append((layer, "slide_left", delay + i * stagger, 0.0, dur))
        elif kind == "cta":
            for i, ln in enumerate(b["lines"]):
                layer = render_line_layer(
                    ln["text"], ln.get("size", 80), ln.get("font", "ArchivoBlack"),
                    hex_rgb(ln.get("color", "#F5EFE2")))
                layer.cy = cy + i * ln.get("size", 80) * 1.15
                blocks.append((layer, "elastic_scale", delay + i * stagger, 0.0, dur))
    return blocks


def render_scene_frame(scene: dict, bg_img: Image.Image, frame_in_scene: int,
                       fps: int, text_blocks: list, overlays: tuple) -> Image.Image:
    dur = scene["duration"]
    t = frame_in_scene / fps / dur  # 0..1 scene progress
    gt = frame_in_scene / fps       # seconds into scene

    # Ken Burns background
    box = kenburns_box(scene.get("kenburns", "zoom_in"), t)
    crop = bg_img.crop(box).resize((W, H), Image.Resampling.LANCZOS).convert("RGBA")

    grad, vign = overlays
    canvas = Image.new("RGBA", (W, H))
    canvas.alpha_composite(crop)
    canvas.alpha_composite(grad)
    canvas.alpha_composite(vign)

    # text blocks
    for layer, anim, delay, _stagger, dur_s in text_blocks:
        lt = gt - delay
        if lt < 0:
            continue
        scale, dx, dy, alpha = block_transform(anim, lt, dur_s)
        layer.paste(canvas, scale=scale, dx=dx, dy=dy, alpha=alpha)

    return canvas.convert("RGB")


# ───────────────────────────── audio ─────────────────────────────
def build_audio(total_sec: float, music_path: str, volume: float,
                fade_in: float, fade_out: float, out_wav: Path):
    dur = max(total_sec + 0.3, 2)
    fade_out_start = max(0.0, dur - fade_out)
    cmd = [
        "ffmpeg", "-y", "-i", str(music_path),
        "-af", (
            f"volume={volume},"
            f"afade=t=in:d={fade_in},"
            f"afade=t=out:st={fade_out_start:.2f}:d={fade_out},"
            f"atrim=0:{dur:.2f},asetpts=PTS-STARTPTS"
        ),
        "-ac", "2", "-ar", "44100", str(out_wav),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


# ───────────────────────────── main ─────────────────────────────
def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("spec", help="path to spec.json")
    ap.add_argument("--out", default=None)
    ap.add_argument("--frames-dir", default=None)
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--frame", type=int, default=None, help="render single frame N to /tmp and exit")
    ap.add_argument("--montage-only", action="store_true")
    args = ap.parse_args()

    spec = json.load(open(args.spec))
    slug = spec["slug"]
    fps = spec.get("fps", FPS)
    out = Path(args.out) if args.out else ROOT / "public" / "reels" / f"{slug}.mp4"
    frames_dir = Path(args.frames_dir) if args.frames_dir else Path(tempfile.mkdtemp(prefix=f"gb_{slug}_"))
    frames_dir.mkdir(parents=True, exist_ok=True)

    # load backgrounds
    bg_dir = ROOT / spec["bg_dir"]
    scenes = spec["scenes"]
    bgs = []
    for sc in scenes:
        p = bg_dir / sc["bg"]
        img = Image.open(p).convert("RGB").resize(BG_BASE, Image.Resampling.LANCZOS)
        bgs.append(img)

    text_blocks = [build_text_blocks(sc) for sc in scenes]
    overlays = make_overlays()

    total_frames = sum(int(sc["duration"] * fps) for sc in scenes)
    total_sec = total_frames / fps

    # single frame dump
    if args.frame is not None:
        n = args.frame
        # locate scene
        acc = 0
        for si, sc in enumerate(scenes):
            scene_frames = int(sc["duration"] * fps)
            if n < acc + scene_frames:
                img = render_scene_frame(sc, bgs[si], n - acc, fps, text_blocks[si], overlays)
                out_png = Path("/tmp") / f"{slug}_frame_{n}.png"
                img.save(out_png)
                print(out_png)
                return
            acc += scene_frames
        print(f"frame {n} out of range (0..{total_frames - 1})")
        return

    # render all frames
    print(f"rendering {total_frames} frames ({total_sec:.1f}s) to {frames_dir}")
    idx = 0
    for si, sc in enumerate(scenes):
        scene_frames = int(sc["duration"] * fps)
        for fi in range(scene_frames):
            img = render_scene_frame(sc, bgs[si], fi, fps, text_blocks[si], overlays)
            img.save(frames_dir / f"frame_{idx:05d}.jpg", quality=92, subsampling=0)
            idx += 1
        print(f"  scene {si + 1}/{len(scenes)} done ({sc['name']})")

    video_no_audio = frames_dir / "video_silent.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-framerate", str(fps), "-i", str(frames_dir / "frame_%05d.jpg"),
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(video_no_audio),
    ], check=True, capture_output=True)

    if args.no_audio or not spec.get("music"):
        out_final = video_no_audio
        subprocess.run(["ffmpeg", "-y", "-i", str(video_no_audio), "-c", "copy", str(out)],
                       check=True, capture_output=True)
    else:
        wav = frames_dir / "bed.wav"
        build_audio(total_sec, str(ROOT / spec["music"]),
                    spec.get("music_volume", 0.4),
                    spec.get("music_fade_in", 0.8),
                    spec.get("music_fade_out", 1.5), wav)
        subprocess.run([
            "ffmpeg", "-y", "-i", str(video_no_audio), "-i", str(wav),
            "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest",
            "-movflags", "+faststart", str(out),
        ], check=True, capture_output=True)

    print(f"OUT {out}")

    # QA montage: one frame near the middle of each scene, 2x3 grid
    if not args.montage_only:
        picks = []
        acc = 0
        for si, sc in enumerate(scenes):
            scene_frames = int(sc["duration"] * fps)
            picks.append(acc + scene_frames // 2)
            acc += scene_frames
        thumb_w, thumb_h = 270, 480
        cols = 3
        rows = (len(picks) + cols - 1) // cols
        mont = Image.new("RGB", (cols * thumb_w + (cols + 1) * 10,
                                rows * thumb_h + (rows + 1) * 10 + 26), (18, 18, 26))
        d = ImageDraw.Draw(mont)
        d.text((12, 8), f"{slug} · {total_sec:.1f}s QA", fill=(200, 200, 210))
        for i, pi in enumerate(picks):
            im = Image.open(frames_dir / f"frame_{pi:05d}.jpg").resize((thumb_w, thumb_h))
            x = 10 + (i % cols) * (thumb_w + 10)
            y = 26 + (i // cols) * (thumb_h + 10)
            mont.paste(im, (x, y))
        mont_path = out.parent / f"{slug}-montage.jpg"
        mont.save(mont_path, quality=90)
        print(f"MONTAGE {mont_path}")


if __name__ == "__main__":
    main()
