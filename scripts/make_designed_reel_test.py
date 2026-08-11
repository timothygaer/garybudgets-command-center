#!/usr/bin/env python3
"""v2 test: designed-slide reels.
Takes full designed frames (chatgpt-imagegen 1080x1920, text baked in) and adds
ONLY subtle motion: slow Ken Burns zoom/pan, scene crossfade, story progress
segments, music bed. No raw text overlays — the design IS the slide.
"""
import json
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

FPS = 30
W, H = 1080, 1920
MUSIC = Path("public/reels/audio/music-licensing-traps-bed.m4a")
MUSIC_VOLUME = 0.34

SCENES = [
    {"img": "public/reels/designed-test/01-hook.jpg",    "duration": 4.5, "motion": "zoom_in"},
    {"img": "public/reels/designed-test/02-trucks.jpg",  "duration": 5.0, "motion": "pan_up"},
]
CROSSFADE = 0.4  # seconds

OUT_VIDEO = "public/reels/designed-slide-test.mp4"
OUT_MONTAGE = "public/reels/designed-slide-test-montage.jpg"


def ease_in_out(t):
    return t * t * (3 - 2 * t)


def kenburns(img, t, motion):
    """Crop-zoom within the same 9:16 frame. t in [0,1]."""
    zoom = 1.0 + 0.08 * ease_in_out(t)
    cw, ch = W / zoom, H / zoom
    if motion == "zoom_in":
        x0 = (W - cw) / 2
        y0 = (H - ch) / 2
    elif motion == "pan_up":
        x0 = (W - cw) / 2
        y0 = (H - ch) * (1 - t) * 0.12 + (H - ch) / 2
    else:
        x0 = (W - cw) / 2
        y0 = (H - ch) / 2
    crop = img.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch)))
    return crop.resize((W, H), Image.Resampling.LANCZOS)


def draw_progress(canvas, scene_index, scene_t, scene_dur, total_dur):
    """Story-style progress segments at the bottom safe zone."""
    d = ImageDraw.Draw(canvas)
    seg_w = 300
    gap = 16
    y = H - 64
    for i in range(len(SCENES)):
        x = W // 2 - (len(SCENES) * seg_w + (len(SCENES) - 1) * gap) // 2 + i * (seg_w + gap)
        fill = i < scene_index
        frac = scene_t / scene_dur if i == scene_index else (1.0 if fill else 0.0)
        d.rounded_rectangle([x, y, x + seg_w, y + 6], radius=3, fill=(255, 255, 255, 40))
        if frac > 0:
            d.rounded_rectangle([x, y, x + seg_w * frac, y + 6], radius=3, fill=(218, 32, 42, 255))


def main():
    imgs = [Image.open(s["img"]).convert("RGB") for s in SCENES]
    total = sum(s["duration"] for s in SCENES)
    total_frames = int(total * FPS)
    frames_dir = Path("/tmp/gb_design_test_frames")
    frames_dir.mkdir(exist_ok=True)

    frame_idx = 0
    global_t = 0.0
    for si, scene in enumerate(SCENES):
        dur = scene["duration"]
        n = int(dur * FPS)
        img = imgs[si]
        for i in range(n):
            t = i / n
            canvas = kenburns(img, t, scene["motion"])
            # crossfade from previous scene
            if si > 0 and global_t < CROSSFADE:
                prev = imgs[si - 1]
                prev_zoom = 1.0 + 0.08 * ease_in_out(max(0, (global_t + 1 / FPS) / dur))
                # approximate previous ending frame
                pcw, pch = W / prev_zoom, H / prev_zoom
                pcrop = prev.crop(((W - pcw) / 2, (H - pch) / 2, (W - pcw) / 2 + pcw, (H - pch) / 2 + pch)).resize((W, H), Image.Resampling.LANCZOS)
                alpha = global_t / CROSSFADE
                canvas = Image.blend(pcrop, canvas, alpha)
            draw_progress(canvas, si, t, dur, total)
            canvas.save(frames_dir / f"f{frame_idx:05d}.png")
            frame_idx += 1
            global_t += 1 / FPS

    # assemble video
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-framerate", str(FPS),
        "-i", str(frames_dir / "f%05d.png"),
        "-i", str(MUSIC),
        "-filter_complex",
        f"[1:a]volume={MUSIC_VOLUME},afade=t=in:st=0:d=0.8,afade=t=out:st={total - 1.6}:d=1.6[a]",
        "-map", "0:v", "-map", "[a]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
        "-c:a", "aac", "-b:a", "192k", "-shortest",
        OUT_VIDEO,
    ], check=True)
    print("OUT", OUT_VIDEO)

    # montage: 2 frames per scene side by side
    cols, rows = len(SCENES), 2
    tw, th = 270, 480
    mont = Image.new("RGB", (cols * tw + (cols + 1) * 8, rows * th + (rows + 1) * 8 + 26), (16, 16, 24))
    d = ImageDraw.Draw(mont)
    d.text((10, 8), "designed-slide test — hook + trucks", fill=(220, 220, 230))
    for si in range(len(SCENES)):
        for r, sec in enumerate((0.6, 3.6)):
            frame_no = int(sec * FPS)
            im = Image.open(frames_dir / f"f{frame_no:05d}.png").resize((tw, th))
            x = 8 + si * (tw + 8)
            y = 26 + r * (th + 8)
            mont.paste(im, (x, y))
    mont.save(OUT_MONTAGE, quality=92)
    print("MONTAGE", OUT_MONTAGE)


if __name__ == "__main__":
    main()
