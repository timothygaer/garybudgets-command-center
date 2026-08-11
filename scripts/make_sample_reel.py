#!/usr/bin/env python3
from __future__ import annotations

import math
import os
import random
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path('/Users/dit/workspace/garybudgets-command-center')
OUT = ROOT / 'public' / 'reels' / 'sample-music-licensing-traps.mp4'
FRAMES = Path('/tmp/gb_sample_reel_frames')
WIDTH, HEIGHT = 1080, 1920
FPS = 24
DURATION = 22.0
TOTAL_FRAMES = int(DURATION * FPS)

BG = (7, 8, 14)
PANEL = (17, 18, 27)
RED = (220, 38, 38)
DEEP_RED = (120, 18, 24)
AMBER = (245, 184, 89)
TEXT = (244, 238, 226)
MUTED = (170, 162, 150)
DIM = (82, 82, 92)

FONT_CANDIDATES = [
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/Library/Fonts/Arial.ttf',
]

def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = FONT_CANDIDATES if not bold else [FONT_CANDIDATES[0], FONT_CANDIDATES[2], FONT_CANDIDATES[1]]
    for p in candidates:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size=size)
            except Exception:
                pass
    return ImageFont.load_default()

F_TITLE = font(96, True)
F_BIG = font(82, True)
F_SOLID = font(68, True)
F_MED = font(52, True)
F_BODY = font(42)
F_SMALL = font(30)
F_TINY = font(24)

SCENES = [
    (0.0, 3.2, 'MUSIC RIGHTS\nCAN BREAK\nYOUR INDIE FILM', 'Festival rights are not worldwide rights.'),
    (3.2, 7.0, 'TRAP #1', 'A cheap festival-only song can force an expensive recut later.'),
    (7.0, 10.7, 'TRAP #2', 'Streaming, VOD, trailers, socials, and worldwide rights are separate budget questions.'),
    (10.7, 14.3, 'TRAP #3', 'Delivery can expose missing cue sheets, licenses, M&E needs, and clearance gaps.'),
    (14.3, 18.4, 'BUDGET THE RIGHTS\nBEFORE YOU CUT', 'Track every song by use, territory, term, platform, and approval status.'),
    (18.4, 22.0, 'SAVE THIS\nBEFORE PICTURE LOCK', 'Gary Budgets turns creative choices into real budget lines.'),
]

def ease(x: float) -> float:
    return 1 - (1 - max(0, min(1, x))) ** 3

def lerp(a, b, t):
    return a + (b - a) * t

def wrap_text(draw: ImageDraw.ImageDraw, text: str, fnt, max_width: int):
    words = text.split()
    lines, cur = [], ''
    for w in words:
        test = (cur + ' ' + w).strip()
        if draw.textbbox((0, 0), test, font=fnt)[2] <= max_width or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines

def draw_centered(draw, lines, fnt, y, fill=TEXT, line_gap=14, stroke=0):
    heights = []
    widths = []
    for line in lines:
        box = draw.textbbox((0,0), line, font=fnt, stroke_width=stroke)
        widths.append(box[2]-box[0]); heights.append(box[3]-box[1])
    total_h = sum(heights) + line_gap*(len(lines)-1)
    yy = y - total_h/2
    for line, h, w in zip(lines, heights, widths):
        x = (WIDTH - w) / 2
        draw.text((x, yy), line, font=fnt, fill=fill, stroke_width=stroke, stroke_fill=(0,0,0))
        yy += h + line_gap

def background(frame_idx: int):
    t = frame_idx / FPS
    img = Image.new('RGB', (WIDTH, HEIGHT), BG)
    pix = img.load()
    for y in range(0, HEIGHT, 4):
        for x in range(0, WIDTH, 4):
            dx = (x - WIDTH/2) / WIDTH
            dy = (y - HEIGHT/2) / HEIGHT
            r = math.sqrt(dx*dx + dy*dy)
            glow = max(0, 1 - r*2.1)
            wave = (math.sin(x*0.011 + t*1.7) + math.cos(y*0.007 - t*1.1)) * 0.5
            red = int(7 + glow*26 + max(0, wave)*9)
            g = int(8 + glow*8)
            b = int(14 + glow*12)
            for yy in range(y, min(y+4, HEIGHT)):
                for xx in range(x, min(x+4, WIDTH)):
                    pix[xx, yy] = (red, g, b)
    return img.filter(ImageFilter.GaussianBlur(radius=1.2))

def draw_waveform(draw: ImageDraw.ImageDraw, t: float, y: int, amp: int, color=RED):
    center_x = WIDTH//2
    bars = 48
    spacing = 16
    for i in range(bars):
        phase = t*3 + i*0.38
        h = int(20 + amp*(0.35 + 0.65*abs(math.sin(phase))*abs(math.cos(phase*0.57))))
        x = center_x + (i-bars/2)*spacing
        c = tuple(int(lerp(color[j], AMBER[j], (math.sin(phase)+1)/4)) for j in range(3))
        draw.rounded_rectangle([x, y-h//2, x+7, y+h//2], radius=4, fill=c)

def draw_ticket(draw: ImageDraw.ImageDraw, x, y, w, h, label, alpha=255):
    fill = PANEL
    outline = RED
    draw.rounded_rectangle([x, y, x+w, y+h], radius=28, fill=fill, outline=outline, width=3)
    draw.line([x+80, y, x+80, y+h], fill=DIM, width=2)
    for yy in range(y+16, y+h, 34):
        draw.ellipse([x+68, yy, x+92, yy+18], fill=BG)
    draw.text((x+112, y+34), label, font=F_SMALL, fill=TEXT)

def render_frame(idx: int):
    global_t = idx / FPS
    img = background(idx)
    draw = ImageDraw.Draw(img)

    # subtle film frame border and safe-area guides as design elements
    draw.rounded_rectangle([54, 78, WIDTH-54, HEIGHT-78], radius=46, outline=(55, 30, 34), width=3)
    draw.rectangle([0, 0, WIDTH, 18], fill=(20, 8, 10))
    draw.rectangle([0, HEIGHT-18, WIDTH, HEIGHT], fill=(20, 8, 10))

    # Determine scene
    scene_idx = 0
    for i, (start, end, _, _) in enumerate(SCENES):
        if start <= global_t < end:
            scene_idx = i
            break
    start, end, headline, sub = SCENES[scene_idx]
    local = (global_t - start) / (end - start)
    enter = ease(min(local * 3.0, 1))
    pulse = 0.5 + 0.5 * math.sin(global_t * 4.2)

    # Moving red accent slashes
    for k in range(5):
        off = ((global_t*95 + k*270) % (WIDTH+420)) - 210
        y = 270 + k*275
        draw.line([off-160, y+80, off+120, y-80], fill=(70+k*18, 10, 14), width=9)

    # Scene-specific visuals
    if scene_idx == 0:
        draw_waveform(draw, global_t, 1280, 130)
        draw_ticket(draw, 150, 1380, 780, 150, 'FESTIVAL ONLY LICENSE')
        font_main = F_TITLE
        y = 620 - (1-enter)*70
    elif scene_idx in [1, 2, 3]:
        draw_waveform(draw, global_t, 430, 75)
        cards = [
            ('FESTIVAL', 'ONLY'), ('STREAMING', '??'), ('WORLDWIDE', '$$$'), ('TRAILER', 'ADD-ON')
        ]
        for j,(a,b) in enumerate(cards):
            xx = 112 + (j%2)*438
            yy = 1080 + (j//2)*190 + int(math.sin(global_t*2+j)*8)
            draw.rounded_rectangle([xx, yy, xx+380, yy+140], radius=20, fill=(20,22,31), outline=(55,55,66), width=2)
            draw.text((xx+26, yy+28), a, font=F_SMALL, fill=MUTED)
            draw.text((xx+26, yy+74), b, font=F_MED, fill=AMBER if b in ['$$$','??'] else TEXT)
        font_main = F_BIG
        y = 650
    elif scene_idx == 4:
        # Checklist board
        board = [150, 950, 930, 1390]
        draw.rounded_rectangle(board, radius=28, fill=(14,16,24), outline=(70,32,36), width=3)
        rows = ['USE', 'TERRITORY', 'TERM', 'PLATFORM', 'APPROVAL']
        for j, r in enumerate(rows):
            yy = 1018 + j*68
            draw.rounded_rectangle([205, yy, 235, yy+30], radius=6, outline=RED, width=3)
            if local > j*0.12:
                draw.line([210, yy+16, 220, yy+26, 238, yy-2], fill=AMBER, width=5)
            draw.text((260, yy-5), r, font=F_SMALL, fill=TEXT)
        font_main = F_SOLID
        y = 560
    else:
        draw_waveform(draw, global_t, 1220, 100, AMBER)
        draw.rounded_rectangle([160, 1360, 920, 1490], radius=34, fill=RED)
        cta = 'garybudgets.com'
        box = draw.textbbox((0,0), cta, font=F_MED)
        draw.text(((WIDTH-(box[2]-box[0]))/2, 1396), cta, font=F_MED, fill=(10,10,12))
        font_main = F_SOLID
        y = 620

    # Main text panel
    panel_y = int(y - 240 - (1-enter)*80)
    draw.rounded_rectangle([96, panel_y, WIDTH-96, panel_y+520], radius=38, fill=(10,11,18), outline=(86, 24, 30), width=3)
    draw.rectangle([96, panel_y, 112, panel_y+520], fill=RED)

    headline_lines = headline.split('\n')
    draw_centered(draw, headline_lines, font_main, panel_y+210, fill=TEXT, line_gap=10, stroke=2)

    sub_lines = wrap_text(draw, sub, F_BODY, 770)
    draw_centered(draw, sub_lines, F_BODY, panel_y+395, fill=MUTED, line_gap=8)

    # Branding footer
    draw.text((86, HEIGHT-108), 'GARY BUDGETS', font=F_TINY, fill=MUTED)
    progress_w = int((idx / max(1, TOTAL_FRAMES-1)) * (WIDTH-172))
    draw.rounded_rectangle([86, HEIGHT-74, WIDTH-86, HEIGHT-62], radius=6, fill=(34,34,42))
    draw.rounded_rectangle([86, HEIGHT-74, 86+progress_w, HEIGHT-62], radius=6, fill=RED)

    return img

def main():
    if FRAMES.exists():
        shutil.rmtree(FRAMES)
    FRAMES.mkdir(parents=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)

    for idx in range(TOTAL_FRAMES):
        img = render_frame(idx)
        img.save(FRAMES / f'frame_{idx:05d}.jpg', quality=92)
        if idx % 80 == 0:
            print(f'rendered {idx}/{TOTAL_FRAMES}')

    cmd = [
        'ffmpeg', '-y', '-framerate', str(FPS), '-i', str(FRAMES / 'frame_%05d.jpg'),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', str(OUT)
    ]
    subprocess.run(cmd, check=True)
    print(OUT)

if __name__ == '__main__':
    main()
