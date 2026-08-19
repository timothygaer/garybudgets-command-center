#!/usr/bin/env python3
"""v2 reel renderer — designed-slide mode (THE pipeline).
Takes full AI-designed frames (1080x1920, text baked in) and adds ONLY subtle
motion: slow Ken Burns zoom/pan, 0.4s crossfades, story progress segments,
music bed. No raw text overlays.

Usage:
  make_designed_reel.py scripts/reels/<slug>/designed.json
  make_designed_reel.py scripts/reels/<slug>/designed.json --frame N
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

FPS = 30
W, H = 1080, 1920
CROSSFADE = 0.4


def ease_in_out(t):
    return t * t * (3 - 2 * t)


def kenburns(img, t, motion):
    zoom = 1.0 + 0.08 * ease_in_out(t)
    cw, ch = W / zoom, H / zoom
    if motion == "zoom_in":
        x0, y0 = (W - cw) / 2, (H - ch) / 2
    elif motion == "zoom_out":
        zoom = 1.08 - 0.08 * ease_in_out(t)
        cw, ch = W / zoom, H / zoom
        x0, y0 = (W - cw) / 2, (H - ch) / 2
    elif motion == "pan_up":
        x0 = (W - cw) / 2
        y0 = (H - ch) * (1 - t) * 0.10 + (H - ch) / 2
    elif motion == "pan_down":
        x0 = (W - cw) / 2
        y0 = (H - ch) * t * 0.10 + (H - ch) / 2
    else:
        x0, y0 = (W - cw) / 2, (H - ch) / 2
    crop = img.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch)))
    return crop.resize((W, H), Image.Resampling.LANCZOS)


def draw_progress(canvas, n_scenes, scene_index, scene_t, scene_dur):
    d = ImageDraw.Draw(canvas)
    seg_w = min(300, (W - 160) // n_scenes - 12)
    gap = 12
    y = H - 64
    total_w = n_scenes * seg_w + (n_scenes - 1) * gap
    x_start = W // 2 - total_w // 2
    for i in range(n_scenes):
        x = x_start + i * (seg_w + gap)
        d.rounded_rectangle([x, y, x + seg_w, y + 6], radius=3, fill=(255, 255, 255, 36))
        if i < scene_index:
            d.rounded_rectangle([x, y, x + seg_w, y + 6], radius=3, fill=(218, 32, 42, 255))
        elif i == scene_index:
            frac = scene_t / scene_dur
            d.rounded_rectangle([x, y, x + seg_w * frac, y + 6], radius=3, fill=(218, 32, 42, 255))


def main():
    spec_path = Path(sys.argv[1])
    spec = json.loads(spec_path.read_text())
    scenes = spec["scenes"]
    music = Path(spec.get("music", "public/reels/audio/music-licensing-traps-bed.m4a"))
    volume = float(spec.get("music_volume", 0.34))

    out_video = Path(spec.get("out_video", f"public/reels/{spec['slug']}.mp4"))
    out_montage = Path(spec.get("out_montage", f"public/reels/{spec['slug']}-montage.jpg"))
    frames_dir = Path("/tmp") / f"gb_design_{spec['slug']}"
    frames_dir.mkdir(exist_ok=True)

    imgs = [Image.open(s["img"]).convert("RGB") for s in scenes]
    total = sum(s["duration"] for s in scenes)
    total_frames = int(total * FPS)

    if "--frame" in sys.argv:
        n = int(sys.argv[sys.argv.index("--frame") + 1])
        # locate scene + local t for the requested global frame
        acc = 0
        for si, s in enumerate(scenes):
            dur_frames = int(s["duration"] * FPS)
            if n < acc + dur_frames:
                t = (n - acc) / dur_frames
                frame = kenburns(imgs[si], t, s.get("motion", "zoom_in"))
                draw_progress(frame, len(scenes), si, t, s["duration"])
                out = f"/tmp/{spec['slug']}_frame_{n}.png"
                frame.save(out)
                print(out)
                return
            acc += dur_frames
        print("frame out of range")
        return

    frame_idx = 0
    global_t = 0.0
    for si, scene in enumerate(scenes):
        dur = scene["duration"]
        n = int(dur * FPS)
        img = imgs[si]
        motion = scene.get("motion", "zoom_in")
        for i in range(n):
            t = i / n
            canvas = kenburns(img, t, motion)
            if si > 0 and global_t < CROSSFADE:
                prev = imgs[si - 1]
                pzoom = 1.0 + 0.08 * ease_in_out(min(1.0, (global_t + 1 / FPS) / dur))
                pcw, pch = W / pzoom, H / pzoom
                pcrop = prev.crop(((W - pcw) / 2, (H - pch) / 2, (W - pcw) / 2 + pcw, (H - pch) / 2 + pch)).resize((W, H), Image.Resampling.LANCZOS)
                alpha = global_t / CROSSFADE
                canvas = Image.blend(pcrop, canvas, alpha)
            draw_progress(canvas, len(scenes), si, t, dur)
            canvas.save(frames_dir / f"f{frame_idx:05d}.png")
            frame_idx += 1
            global_t += 1 / FPS

    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-framerate", str(FPS),
        "-i", str(frames_dir / "f%05d.png"),
        "-i", str(music),
        "-filter_complex",
        f"[1:a]volume={volume},afade=t=in:st=0:d=0.8,afade=t=out:st={total - 1.6}:d=1.6[a]",
        "-map", "0:v", "-map", "[a]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
        "-c:a", "aac", "-b:a", "192k", "-shortest",
        "-movflags", "+faststart",
        str(out_video),
    ], check=True)
    print("OUT", out_video)

    # montage: 2 frames per scene
    cols, rows = len(scenes), 2
    tw, th = 270, 480
    mont = Image.new("RGB", (cols * tw + (cols + 1) * 8, rows * th + (rows + 1) * 8 + 26), (16, 16, 24))
    d = ImageDraw.Draw(mont)
    d.text((10, 8), f"{spec['title']} — designed-slide v2", fill=(220, 220, 230))
    for si in range(len(scenes)):
        for r, sec in enumerate((0.6, 3.6)):
            frame_no = int(sec * FPS)
            im = Image.open(frames_dir / f"f{frame_no:05d}.png").resize((tw, th))
            x = 8 + si * (tw + 8)
            y = 26 + r * (th + 8)
            mont.paste(im, (x, y))
    mont.save(out_montage, quality=92)
    print("MONTAGE", out_montage)


if __name__ == "__main__":
    main()
