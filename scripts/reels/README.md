# Gary Budgets Reel Pipeline

Turn a post topic into a finished 1080×1920 Instagram Reel with AI cinematic
backgrounds, kinetic typography, and a real music bed.

```
topic → spec.json → AI backgrounds (chatgpt-imagegen) → make_kinetic_reel.py → MP4 + QA montage → approval → publish
```

## Quick start (new reel)

1. **Copy an existing spec**
   ```bash
   cp -r scripts/reels/music-licensing-traps scripts/reels/<slug>
   ```
   Edit `spec.json`: slug, title, music path, and the 6 `scenes[]`.

2. **Write the scenes**
   - `name` — short slug shown in logs
   - `duration` — seconds (3.2–4.4 each; total 20–30s is the sweet spot)
   - `bg` — filename of this scene's background image
   - `kenburns` — `zoom_in | zoom_out | pan_up | pan_down | pan_left | pan_right | none`
   - `blocks` — text layers, in z-order:
     - `headline` — `lines[]` of `{text, font, size, color}`, one layer per line (stagger animates line by line)
     - `sub` — single-line `text` (use for the URL CTA on the last scene)
     - `check` — `items[]` list, staggered slide-in
     - `cta` — multi-line big text
   - Animations: `elastic_scale` (overshoot slam), `punch` (fast slam), `fade_up`,
     `slide_left`, `expand` (center wipe)
   - `y` / `y0` — vertical anchor as a fraction of height (keep text between ~0.18 and 0.85)

3. **Generate backgrounds**
   ```bash
   mkdir -p public/reels/bg/<slug>
   chatgpt-imagegen --backend web --size 1024x1536 --format jpeg \
     "Cinematic dark [scene], moody red/amber accents, no people, no text, film still" \
     -o public/reels/bg/<slug>/01-hook.jpg
   ```
   One per scene. **Always include "no text / no readable text"** — AI renders
   gibberish text and we overlay our own. Sizes should land 1.5–2.5MB; under
   500KB means too flat, regenerate.

4. **Music** — drop a royalty-free track (e.g. yt-dlp a no-copyright cinematic
   track, or a Pixabay/Suno asset) into `public/reels/audio/` and set `music`,
   `music_volume` (0.3–0.45), fade in/out in the spec. Credit the artist in the
   Instagram caption if the license requires it.

5. **Render + QA**
   ```bash
   /Users/dit/hermes-hudui/venv/bin/python3 scripts/make_kinetic_reel.py scripts/reels/<slug>/spec.json
   ```
   Produces `public/reels/<slug>.mp4` + `public/reels/<slug>-montage.jpg` (2×3 QA grid).

6. **Fast iteration**
   - `--frame N` dumps a single frame PNG to /tmp for spot-checks
   - `--no-audio` skips the music mix
   - `--frames-dir /tmp/x` keeps the frame cache

## Style rules (brand)

- Palette: off-white `#F5EFE2`, red `#DA202A`, amber `#F5B24A`, green `#46BE80`, muted `#B0A99A`
- Fonts: **Archivo Black** headlines, **Anton** for accent lines, **Roboto** body — all in `assets/fonts/`
- Hook scene: 2-line money contrast ("$500 SONG / $15K RECUT" pattern)
- Education scenes: one idea per scene, 3–5 checklist items max
- Final scene: **SAVE THIS** + `garybudgets.com` visible on-slide (recruitment rule:
  URL must be in the image, not just the caption)
- Text stays inside y 180–1700 (IG UI covers the bottom ~15% and top bar)
- No fake product screenshots — conceptual backgrounds only (same rule as carousels)

## Known limits / next steps

- Pillow renders at 30fps; ~700 frames ≈ 2–4 min
- Backgrounds are 1024×1536 upscaled — acceptable with grain/vignette, but a
  higher-res model pass would sharpen them
- Word-level stagger (per-word, not per-line) and caption burn-ins are TODO
- Publishing via the IG Graph API (reel upload ≠ carousel publish) is TODO
