#!/usr/bin/env python3
"""Compose designed 1080x1920 reel frames: cinematic photo + editorial type.

Backgrounds are text-free AI cinematic stills; all type is rendered locally with
real fonts so the words are exactly right. Output frames feed make_designed_reel.py
(motion + crossfade + progress + music).

Usage:
  /Users/dit/hermes-hudui/venv/bin/python3 compose_frames.py
"""
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[3]
FONTS = ROOT / "assets" / "fonts"
BG = ROOT / "public" / "reels" / "bg" / "reel-open-to-ai-hollywood"
OUT = ROOT / "public" / "reels" / "frames" / "reel-open-to-ai-hollywood"

W, H = 1080, 1920
X = 80                 # left margin
COL_W = W - 2 * X      # 920
WHITE = (245, 239, 226)
BODY = (222, 216, 204)
RED = (218, 32, 42)
MUTED = (150, 145, 133)

F = {
    "black": FONTS / "ArchivoBlack-Regular.ttf",
    "bold": FONTS / "Roboto-Bold.ttf",
    "med": FONTS / "Roboto-Medium.ttf",
    "reg": FONTS / "Roboto-Regular.ttf",
}


def font(kind, size):
    return ImageFont.truetype(str(F[kind]), size=size)


def cover(img, w=W, h=H):
    sw, sh = img.size
    s = max(w / sw, h / sh)
    img = img.resize((int(sw * s + 0.5), int(sh * s + 0.5)), Image.Resampling.LANCZOS)
    l = (img.width - w) // 2
    t = (img.height - h) // 2
    return img.crop((l, t, l + w, t + h))


def scrim(img):
    """Cinematic gradient: darkened top for the kicker, heavy bottom for body copy."""
    ov = Image.new("L", (1, H), 0)
    px = ov.load()
    for y in range(H):
        top = 165 * max(0.0, 1 - y / 430) ** 1.3
        bot = 246 * max(0.0, (y - 880) / (H - 880)) ** 1.15
        px[0, y] = int(min(252, max(top, bot)))
    ov = ov.resize((W, H))
    black = Image.new("RGB", (W, H), (6, 7, 10))
    out = Image.composite(black, img, ov)
    # gentle vignette on the edges so the frame reads photographic, not flat
    vig = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(vig)
    d.rectangle([0, 0, W, H], fill=0)
    d.ellipse([-W * 0.35, -H * 0.22, W * 1.35, H * 1.22], fill=70)
    vig = vig.filter(ImageFilter.GaussianBlur(180))
    return Image.composite(out, Image.composite(black, out, vig.point(lambda v: v // 2)), vig.point(lambda v: 255 - v))


def wrap(draw, text, fnt, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= maxw:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def fit_headline(draw, lines, maxw, start=104, floor=64):
    size = start
    while size > floor:
        fnt = font("black", size)
        if all(draw.textlength(l, font=fnt) <= maxw for l in lines):
            return fnt, size
        size -= 2
    return font("black", floor), floor


def draw_kicker(d, text, y):
    fnt = font("bold", 30)
    # manual letter-spacing for an editorial feel
    track = 5
    x = X
    for ch in text.upper():
        d.text((x, y), ch, font=fnt, fill=RED)
        x += draw_len(d, ch, fnt) + track
    return y + 46


def draw_len(d, ch, fnt):
    return d.textlength(ch, font=fnt)


def compose(scene, idx, total):
    bg = cover(Image.open(BG / scene["bg"]).convert("RGB"))
    img = scrim(bg).convert("RGB")
    # all type goes on a transparent layer first, so the block can be centred in
    # the safe band instead of hanging off the top of the frame
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    y = 0
    y = draw_kicker(d, scene["kicker"], y)

    hl = scene["headline"]
    fnt, size = fit_headline(d, hl, COL_W)
    lh = int(size * 1.03)
    for line in hl:
        d.text((X, y), line, font=fnt, fill=WHITE)
        y += lh

    y += 30
    d.rectangle([X, y, X + 132, y + 7], fill=RED)
    y += 52

    if scene.get("lede"):
        fnt = font("med", 38)
        for line in wrap(d, scene["lede"], fnt, COL_W):
            d.text((X, y), line, font=fnt, fill=WHITE)
            y += 52
        y += 26

    fnt = font("med", 35)
    for item in scene.get("items", []):
        lines = wrap(d, item, fnt, COL_W - 46)
        d.rectangle([X, y + 14, X + 13, y + 27], fill=RED)
        for i, line in enumerate(lines):
            d.text((X + 40, y), line, font=fnt, fill=BODY)
            y += 47
        y += 24

    if scene.get("stat"):
        y += 8
        sf = font("black", 64)
        d.text((X, y), scene["stat"], font=sf, fill=RED)
        y += 78
        cf = font("med", 32)
        for line in wrap(d, scene["stat_caption"], cf, COL_W):
            d.text((X, y), line, font=cf, fill=MUTED)
            y += 42

    if scene.get("cta"):
        y += 10
        cf = font("black", 58)
        d.text((X, y), scene["cta"], font=cf, fill=WHITE)
        y += 74
        cf2 = font("med", 34)
        for line in scene["cta_sub"]:
            d.text((X, y), line, font=cf2, fill=MUTED)
            y += 46

    assert y < 1660, f"scene {idx} text overflows safe area: bottom={y}"

    # centre the text block inside the safe band (240..1632)
    bb = layer.getbbox()
    if bb:
        block_h = bb[3] - bb[1]
        target_top = 240 + ((1632 - 240) - block_h) // 2
        dy = max(240 - bb[1], min(target_top - bb[1], 1632 - bb[3]))
        layer = layer.transform(layer.size, Image.Transform.AFFINE,
                                (1, 0, 0, 0, 1, -dy), resample=Image.Resampling.BICUBIC)
        # feathered scrim behind the type so busy photo regions can't eat contrast
        panel = Image.new("L", (W, H), 0)
        pd = ImageDraw.Draw(panel)
        pd.rounded_rectangle([bb[0] - 34, bb[1] + dy - 42, bb[2] + 34, bb[3] + dy + 42],
                             radius=48, fill=255)
        panel = panel.filter(ImageFilter.GaussianBlur(64)).point(lambda v: int(v * 0.62))
        img = Image.composite(Image.new("RGB", (W, H), (4, 5, 8)), img, panel)
    img = img.convert("RGBA")
    img.alpha_composite(layer)
    return img.convert("RGB"), layer.getchannel("A")


SCENES = json.loads((Path(__file__).parent / "scenes.json").read_text())["scenes"]

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "masks").mkdir(exist_ok=True)
    for i, sc in enumerate(SCENES):
        im, mask = compose(sc, i, len(SCENES))
        p = OUT / f"{i + 1:02d}.png"
        im.save(p)
        mask.save(OUT / "masks" / f"{i + 1:02d}.png")
        print("wrote", p, im.size)
