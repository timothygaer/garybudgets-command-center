#!/usr/bin/env python3
from __future__ import annotations

import math
import os
import random
import shutil
import subprocess
import wave
import struct
from pathlib import Path
from typing import Sequence

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

ROOT = Path('/Users/dit/workspace/garybudgets-command-center')
OUT = ROOT / 'public' / 'reels' / 'music-licensing-traps-publish-ready.mp4'
TMP = Path('/tmp/gb_publish_ready_music_reel')
FRAMES = TMP / 'frames'
AUDIO = TMP / 'bed.wav'
VIDEO_NO_AUDIO = TMP / 'video_silent.mp4'
WIDTH, HEIGHT = 1080, 1920
FPS = 30
DURATION = 24.0
TOTAL = int(DURATION * FPS)
random.seed(42)

# Gary Budgets palette: dark cinematic set + red/amber finance accents.
BLACK = (5, 6, 10)
CHARCOAL = (12, 14, 21)
PANEL = (18, 20, 29)
PANEL2 = (24, 25, 34)
TEXT = (245, 239, 226)
MUTED = (176, 169, 154)
RED = (218, 32, 42)
DEEP_RED = (96, 12, 18)
AMBER = (245, 178, 74)
GREEN = (70, 190, 128)
BLUE = (72, 111, 170)
LINE = (72, 54, 55)

FONT_PATHS = [
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Avenir Next.ttc',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
]

def fnt(size: int, bold: bool = True):
    for p in FONT_PATHS:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size=size)
            except Exception:
                continue
    return ImageFont.load_default()

F_HUGE = fnt(116)
F_HOOK = fnt(98)
F_BIG = fnt(78)
F_MED = fnt(54)
F_BODY = fnt(46, False)
F_BODY_B = fnt(46)
F_SMALL = fnt(34, False)
F_TINY = fnt(28, False)

SCENES = [
    # start, end, type, headline lines, subline
    (0.0, 3.4, 'hook', ['$500 SONG', '$15K RECUT'], 'Music rights can break your film after picture lock.'),
    (3.4, 7.1, 'equation', ['FESTIVAL RIGHTS', 'ARE NOT', 'STREAMING RIGHTS'], 'Cheap clearance now can become expensive delivery later.'),
    (7.1, 10.9, 'timeline', ['THE TRAP'], 'You cut to a track before worldwide rights are priced.'),
    (10.9, 15.1, 'checklist', ['BUDGET THE LICENSE'], 'Track use, territory, term, platform, and approvals.'),
    (15.1, 19.7, 'fix', ['BEFORE', 'PICTURE LOCK'], 'Clear it. Cap it. Document it. Or replace it early.'),
    (19.7, 24.0, 'cta', ['SAVE THIS', 'BEFORE YOU CUT'], 'Gary Budgets turns creative choices into real budget lines.'),
]

# Precomputed cinematic dust specks / particles.
DUST = [(random.randrange(WIDTH), random.randrange(HEIGHT), random.random(), random.randrange(1, 4)) for _ in range(220)]


def clamp(v, a=0, b=255): return max(a, min(b, int(v)))
def ease_out(t): return 1 - (1 - max(0, min(1, t))) ** 3
def ease_in_out(t):
    t = max(0, min(1, t))
    return t*t*(3-2*t)
def lerp(a, b, t): return a + (b-a)*t

def mix(c1, c2, t):
    return tuple(clamp(lerp(c1[i], c2[i], t)) for i in range(3))


def text_size(draw, text, font, stroke=0):
    box = draw.textbbox((0,0), text, font=font, stroke_width=stroke)
    return box[2]-box[0], box[3]-box[1]


def centered_text(draw, text: str, y: int, font, fill=TEXT, stroke=0, anchor='mm'):
    draw.text((WIDTH//2, y), text, font=font, fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=(0,0,0))


def wrap(draw, text, font, max_w):
    words = text.split()
    lines, cur = [], ''
    for w in words:
        trial = (cur + ' ' + w).strip()
        if not cur or text_size(draw, trial, font)[0] <= max_w:
            cur = trial
        else:
            lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines


def draw_multiline_center(draw, lines: Sequence[str], y: int, font, fill=TEXT, gap=12, stroke=0):
    hs = [text_size(draw, line, font, stroke)[1] for line in lines]
    total_h = sum(hs) + gap*(len(lines)-1)
    yy = y - total_h/2
    for line, h in zip(lines, hs):
        centered_text(draw, line, int(yy + h/2), font, fill, stroke)
        yy += h + gap


def add_noise_grain(img: Image.Image, frame: int) -> Image.Image:
    # Subtle deterministic scan/grain overlay.
    overlay = Image.new('RGBA', (WIDTH, HEIGHT), (0,0,0,0))
    d = ImageDraw.Draw(overlay)
    for y in range(0, HEIGHT, 6):
        a = 8 if (y//6 + frame) % 2 == 0 else 3
        d.line([(0,y),(WIDTH,y)], fill=(255,255,255,a), width=1)
    for x,y,r,s in DUST:
        yy = int((y + frame*(0.18 + r*0.55)) % HEIGHT)
        alpha = int(20 + 35*abs(math.sin(frame*0.02 + r*10)))
        d.ellipse([x-s, yy-s, x+s, yy+s], fill=(255,226,170,alpha))
    return Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')


def base_bg(frame: int) -> Image.Image:
    t = frame / FPS
    # Build a large gradient with moving red/amber light spill.
    img = Image.new('RGB', (WIDTH, HEIGHT), BLACK)
    pix = img.load()
    cx1 = WIDTH*(0.22 + 0.06*math.sin(t*0.37)); cy1 = HEIGHT*(0.22 + 0.04*math.cos(t*0.29))
    cx2 = WIDTH*(0.82 + 0.05*math.cos(t*0.31)); cy2 = HEIGHT*(0.73 + 0.06*math.sin(t*0.24))
    for y in range(0, HEIGHT, 6):
        for x in range(0, WIDTH, 6):
            d1 = math.hypot((x-cx1)/WIDTH, (y-cy1)/HEIGHT)
            d2 = math.hypot((x-cx2)/WIDTH, (y-cy2)/HEIGHT)
            g1 = max(0, 1-d1*2.4)
            g2 = max(0, 1-d2*2.0)
            wave = 0.5+0.5*math.sin(x*0.009 + y*0.004 + t*1.2)
            col = (
                clamp(5 + g1*42 + g2*24 + wave*5),
                clamp(6 + g1*10 + g2*14),
                clamp(10 + g1*8 + g2*19),
            )
            for yy in range(y, min(y+6, HEIGHT)):
                for xx in range(x, min(x+6, WIDTH)):
                    pix[xx,yy] = col
    img = img.filter(ImageFilter.GaussianBlur(2.0))
    d = ImageDraw.Draw(img, 'RGBA')
    # Cinematic frame / safe area.
    d.rounded_rectangle([44, 62, WIDTH-44, HEIGHT-62], radius=50, outline=(105,34,38,118), width=3)
    d.rounded_rectangle([72, 94, WIDTH-72, HEIGHT-94], radius=38, outline=(255,255,255,18), width=1)
    # Parallax diagonal red light streaks.
    for i in range(6):
        x = ((frame*4.2 + i*265) % (WIDTH+500)) - 250
        y = 230 + i*270
        d.line([(x-210,y+110),(x+160,y-110)], fill=(180,20,32,55), width=10)
        d.line([(x-205,y+118),(x+160,y-102)], fill=(255,160,80,20), width=3)
    return add_noise_grain(img, frame)


def draw_brand(draw):
    draw.text((86, HEIGHT-126), 'GARY BUDGETS', font=F_SMALL, fill=MUTED)


def progress(draw, frame):
    w = WIDTH-172
    p = frame / max(1, TOTAL-1)
    draw.rounded_rectangle([86, HEIGHT-82, WIDTH-86, HEIGHT-68], radius=7, fill=(36,36,43))
    draw.rounded_rectangle([86, HEIGHT-82, 86+int(w*p), HEIGHT-68], radius=7, fill=RED)


def draw_contract_scene(draw, t, yoff=0):
    # Angled cue sheet / contract on a desk.
    x, y, w, h = 135, 980+yoff, 810, 410
    shadow = Image.new('RGBA',(WIDTH,HEIGHT),(0,0,0,0)); sd=ImageDraw.Draw(shadow)
    sd.rounded_rectangle([x+24,y+30,x+w+24,y+h+30], radius=24, fill=(0,0,0,110))
    draw.bitmap((0,0), shadow.filter(ImageFilter.GaussianBlur(16)), fill=None)
    draw.rounded_rectangle([x,y,x+w,y+h], radius=24, fill=(230,222,204), outline=(255,255,255), width=2)
    draw.text((x+50,y+42), 'MUSIC CUE SHEET', font=F_MED, fill=(25,24,26))
    rows = [('USE', 'Festival cut'), ('TERM', '12 months'), ('PLATFORM', 'NOT STREAMING')]
    for i,(a,b) in enumerate(rows):
        yy=y+138+i*72
        draw.line([x+50,yy+50,x+w-50,yy+50], fill=(190,184,172), width=2)
        draw.text((x+50, yy), a, font=F_SMALL, fill=(74,67,62))
        color = (160,18,28) if 'NOT' in b else (28,28,32)
        draw.text((x+380, yy), b, font=F_SMALL, fill=color)
    # Red stamp.
    stamp_x=x+455+int(math.sin(t*4)*4); stamp_y=y+274
    draw.rounded_rectangle([stamp_x,stamp_y,stamp_x+286,stamp_y+86], radius=12, outline=(185,20,28), width=6)
    draw.text((stamp_x+143, stamp_y+43), 'NOT STREAMING', font=F_SMALL, fill=(185,20,28), anchor='mm')


def draw_wave(draw, frame, y, amp=90, color=RED):
    t=frame/FPS
    bars=58; spacing=13
    x0=WIDTH//2 - bars*spacing//2
    for i in range(bars):
        phase=t*4.5+i*0.34
        h=int(16+amp*(0.18+0.82*abs(math.sin(phase))*abs(math.cos(phase*0.43))))
        x=x0+i*spacing
        c=mix(color, AMBER, 0.20+0.35*math.sin(phase)**2)
        draw.rounded_rectangle([x,y-h//2,x+7,y+h//2], radius=4, fill=c)


def draw_timeline(draw, scene_p):
    x0,y=130,1160
    draw.rounded_rectangle([x0,y-34,WIDTH-x0,y+34], radius=34, fill=(26,27,35), outline=(88,53,56), width=2)
    labels=[('CUT',0.12),('LOCK',0.40),('DELIVERY',0.68),('RELEASE',0.88)]
    for lab,p in labels:
        x=x0+int((WIDTH-2*x0)*p)
        draw.ellipse([x-26,y-26,x+26,y+26], fill=RED if p<0.45 else (50,52,63), outline=AMBER if p<scene_p else LINE, width=3)
        draw.text((x,y+58), lab, font=F_TINY, fill=TEXT, anchor='mm')
    # moving money burn marker
    marker_p = 0.18 + 0.55*ease_in_out(scene_p)
    mx=x0+int((WIDTH-2*x0)*marker_p)
    draw.polygon([(mx,y-112),(mx-30,y-54),(mx+30,y-54)], fill=AMBER)
    draw.text((mx,y-142),'$ RISK',font=F_SMALL,fill=AMBER,anchor='mm')


def draw_checklist(draw, scene_p):
    x,y,w,h=118,965,844,520
    draw.rounded_rectangle([x,y,x+w,y+h], radius=34, fill=(13,15,22), outline=(110,35,42), width=3)
    items=['USE','TERRITORY','TERM','PLATFORM','APPROVAL']
    for i,item in enumerate(items):
        yy=y+72+i*82
        draw.rounded_rectangle([x+58,yy-10,x+96,yy+28], radius=7, outline=RED, width=4)
        if scene_p > i/5:
            draw.line([x+64,yy+8,x+78,yy+24,x+104,yy-14], fill=AMBER, width=6)
        draw.text((x+130,yy-20),item,font=F_MED,fill=TEXT)
        draw.line([x+58,yy+53,x+w-58,yy+53],fill=(47,48,57),width=1)


def draw_before_lock(draw, scene_p):
    words=[('CLEAR IT',GREEN),('CAP IT',AMBER),('DOCUMENT IT',RED)]
    for i,(word,col) in enumerate(words):
        p=ease_out(max(0,min(1,scene_p*2.2-i*0.35)))
        x=130+int((1-p)*-260)
        y=990+i*150
        draw.rounded_rectangle([x,y,x+820,y+105],radius=28,fill=(17,19,26),outline=col,width=3)
        draw.text((x+48,y+52),word,font=F_MED,fill=col,anchor='lm')
        draw.text((x+760,y+52),'✓',font=F_BIG,fill=col,anchor='mm')


def render_frame(frame: int):
    gt=frame/FPS
    img=base_bg(frame)
    draw=ImageDraw.Draw(img,'RGBA')
    scene=SCENES[-1]
    for s in SCENES:
        if s[0] <= gt < s[1]: scene=s; break
    start,end,kind,heads,sub=scene
    sp=(gt-start)/(end-start)
    enter=ease_out(min(1,sp*3.0))
    exitp=ease_out(max(0,(sp-0.82)/0.18))
    y_shift=int((1-enter)*90 - exitp*80)

    # Background visual layer per scene.
    if kind in ('hook','equation'):
        draw_contract_scene(draw, gt, int(18*math.sin(gt*2)))
        draw_wave(draw, frame, 1510, 80)
    elif kind=='timeline':
        draw_contract_scene(draw, gt, 190)
        draw_timeline(draw, sp)
    elif kind=='checklist':
        draw_checklist(draw, sp)
    elif kind=='fix':
        draw_before_lock(draw, sp)
    else:
        draw_wave(draw, frame, 1230, 100, AMBER)
        draw.rounded_rectangle([185,1370,895,1488],radius=34,fill=RED)
        draw.text((WIDTH//2,1429),'garybudgets.com',font=F_MED,fill=(8,8,10),anchor='mm')

    # Main headline panel.
    panel_top = 220 + y_shift
    panel_bottom = 840 + y_shift
    draw.rounded_rectangle([80,panel_top,WIDTH-80,panel_bottom], radius=46, fill=(7,8,13,230), outline=(130,31,38,180), width=3)
    draw.rectangle([80,panel_top+50,100,panel_bottom-50], fill=RED)

    if kind == 'hook':
        draw_multiline_center(draw, heads, panel_top+250, F_HUGE, fill=TEXT, gap=24, stroke=2)
    elif kind == 'equation':
        centered_text(draw, heads[0], panel_top+150, F_MED, TEXT, 1)
        centered_text(draw, heads[1], panel_top+282, F_HOOK, RED, 2)
        centered_text(draw, heads[2], panel_top+420, F_MED, TEXT, 1)
    elif kind == 'checklist':
        draw_multiline_center(draw, heads, panel_top+235, F_MED, fill=TEXT, gap=18, stroke=1)
    elif kind in ('fix', 'cta'):
        draw_multiline_center(draw, heads, panel_top+235, F_BIG, fill=TEXT, gap=18, stroke=2)
    else:
        draw_multiline_center(draw, heads, panel_top+220, F_HOOK, fill=TEXT, gap=18, stroke=2)

    sub_lines=wrap(draw,sub,F_BODY_B,800)
    draw_multiline_center(draw,sub_lines,panel_bottom-108,F_BODY_B,fill=MUTED,gap=8)

    # Top slug.
    draw.rounded_rectangle([86,116,474,168],radius=26,fill=(25,17,20),outline=(120,34,39),width=1)
    draw.text((112,142),'MUSIC LICENSING TRAPS',font=F_TINY,fill=AMBER,anchor='lm')

    draw_brand(draw)
    progress(draw,frame)
    return img


def make_audio():
    # Original procedural audio bed: low pulse + soft tick + risers. No copyrighted samples.
    sr=44100
    n=int(DURATION*sr)
    with wave.open(str(AUDIO),'wb') as wf:
        wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(sr)
        for i in range(n):
            t=i/sr
            # tempo around 100 BPM pulse
            beat=(math.sin(2*math.pi*1.66*t)>0.965)
            kick=math.exp(-((t*1.66)%1)*18)*math.sin(2*math.pi*62*t)*0.18
            bass=math.sin(2*math.pi*(43+4*math.sin(t*0.4))*t)*0.055
            shimmer=(math.sin(2*math.pi*440*t)+math.sin(2*math.pi*660*t))*0.012*(0.5+0.5*math.sin(t*0.7))
            tick=(0.12*math.sin(2*math.pi*2200*t))*beat
            # fade in/out
            env=min(1,t/1.2,(DURATION-t)/1.5)
            val=(kick+bass+shimmer+tick)*env
            s=clamp(val*32767,-32767,32767)
            wf.writeframes(struct.pack('<hh',s,s))


def main():
    if TMP.exists(): shutil.rmtree(TMP)
    FRAMES.mkdir(parents=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    for frame in range(TOTAL):
        render_frame(frame).save(FRAMES/f'frame_{frame:05d}.jpg', quality=93, subsampling=0)
        if frame % 90 == 0: print(f'rendered {frame}/{TOTAL}')
    make_audio()
    subprocess.run([
        'ffmpeg','-y','-framerate',str(FPS),'-i',str(FRAMES/'frame_%05d.jpg'),
        '-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(VIDEO_NO_AUDIO)
    ], check=True)
    subprocess.run([
        'ffmpeg','-y','-i',str(VIDEO_NO_AUDIO),'-i',str(AUDIO),'-c:v','copy','-c:a','aac','-b:a','128k','-shortest','-movflags','+faststart',str(OUT)
    ], check=True)
    print(OUT)

if __name__=='__main__':
    main()
