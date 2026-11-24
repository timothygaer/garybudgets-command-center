# Open to AI: Hollywood Is Embracing AI (Reel Pipeline — 2026-11-21)

## What was built
- 6 cinematic background images via `scripts/reels/gb_bg_gen.py` (drives your logged-in Chrome through `chrome-use`).
  - Each image ~1.0–1.4 MB, 941×1672 (ChatGPT returns ~941×1672 PNG even when requesting JPEG).
  - All images saved to `public/reels/bg/reel-open-to-ai-hollywood/01.jpg` through `06.jpg`.

## Background image prompts
Each prompt must include: `Photorealistic cinematic film still, vertical 9:16` + `[specific scene]` +
`Deep blacks, high contrast, single light source, shallow depth of field, 35mm grain, teal-and-amber grade` +
`[Empty/dark region description for text overlay]` + `No people, no faces, no text, no readable text, no logos, no signage, no watermarks.`

| File | Subject | Prompt file |
|------|---------|-------------|
| 01.jpg | Soundstage at night, LED volume wall glow, cable runs, dolly silhouette | prompts/01.txt |
| 02.jpg | Dark production office, monitors with colour-graded film, budget ledger, coffee cup | prompts/02.txt |
| 03.jpg | Hollywood soundstage exterior, closed stage door, work-light, wet asphalt | prompts/03.txt |
| 04.jpg | Empty studio screening room, dark seats, screen glow from front | prompts/04.txt |
| 05.jpg | Post-production suite, blinking network gear rack, laptop, cable | prompts/05.txt |
| 06.jpg | Empty soundstage floor at dawn, director's chair, bare bulb, haze | prompts/06.txt |

### How to regenerate any background
```bash
export PATH="/Users/dit/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
python3 scripts/reels/gb_bg_gen.py \
  --prompt-file prompts/01.txt \
  --out public/reels/bg/reel-open-to-ai-hollywood/01.jpg \
  --timeout 420
```
`scripts/reels/gb_bg_gen.py` (restored 2026-11-24, verified end-to-end) uses `chrome-use --session chatgpt-web` to:
  1. Open chatgpt.com
  2. Send the prompt to the composer
  3. Poll for `Generated image N` button completion
  4. Download the blob image
Skip if the output file already exists and >500KB (idempotent).

### Rate limit note
~13–15 generations per hour before ChatGPT rate-limits. Sleep 45s between images (`--gap`).
All six at once:

```bash
python3 scripts/reels/gb_bg_gen.py --batch scripts/reels/reel-open-to-ai-hollywood/prompts \
  --out-dir public/reels/bg/reel-open-to-ai-hollywood
```
The chrome-use relay was required — the CLI `chatgpt-imagegen --backend web` fails with a false "login wall" every time.

## Scene composition
- `scripts/reels/reel-open-to-ai-hollywood/compose_frames.py` composes each frame:
  - Background image → cover-fit to 1080×1920 → apply gradient scrim (dark top for kicker, heavy bottom for body)
  - Editorial type block centred in IG-safe vertical band (y≈497–1375)
  - Kicker (red, small caps), headline (Archivo Black, auto-fit), sub/lede (Roboto Med), items with red bullet, stat (big red number), CTA
  - Feathered dark panel behind text block for contrast against busy photo regions
  - All type is local font rendering — exact text, no AI gibberish

## Font sizing (auto-fit)
- Kicker: Roboto Bold 30, red
- Headline: Archivo Black 104 → auto-fit down to 64 floor (fits within 920px column)
- Sub/lede: Roboto Medium 38
- Items: Roboto Medium 35
- Stats: Archivo Black 64 (red)
- CTA: Archivo Black 58
- Website: Roboto Medium 34
- Hashtags: Roboto Medium 32

## Animation + music
- `scripts/make_designed_reel.py` reads `scripts/reels/reel-open-to-ai-hollywood/designed.json`:
  - Scenes: 4.6s, 5.2s, 5.2s, 5.2s, 5.2s, 4.2s = 29.6s total
  - Ken Burns: zoom_in (sc1), pan_up (sc2), zoom_out (sc3), pan_down (sc4), zoom_in (sc5), zoom_out (sc6)
  - 0.4s crossfades between scenes
  - Progress segments at bottom (red active, grey past)
  - Music: `public/reels/audio/music-licensing-traps-bed.m4a`, volume 0.34
  - Color metadata: pc range, bt470bg colorspace, bt709 primaries — required for Instagram acceptance

## Content source
- Variety article: "Open to AI: Why Hollywood Embraces Artificial Intelligence"
  https://variety.com/2026/digital/features/ai-hollywood-embraces-artificial-intelligence-1236909213/
- 6 scenes written from the article (hook, location, Bitcoin savings, celebrity quotes, what to watch, CTA)
- See `scripts/reels/reel-open-to-ai-hollywood/scenes.json` for the exact copy per scene

## QA performed
- Layout QA (`frame_qa_layout.py`): text bbox inside safe area, edges clear, contrast 8.9×–17.2×
- OCR QA (Swift/Vision): all text lines read back correctly — no truncation, no gibberish
- Audio: loudnorm to −16 LUFS (phone-standard)
- File: 1080×1920, 30fps, H.264, AAC 128k, ~12.9 MB

## Publishing (VERIFIED 2026-11-24 — do it exactly this way)
1. Commit + push, then `npx vercel --prod --yes` (the deploy takes ~3 min; the CLI call must be
   allowed to finish or the site silently serves stale files).
2. Manifest entry MUST be:
   - `"media_type": "reel"`  ← `gb_post_reel_standalone.py` refuses anything else
   - `"status": "approved"`
   - `"video_url"` and `"cover_url"` = ABSOLUTE `https://garybudgets-command-center.vercel.app/...`
     (relative paths fail container creation)
3. Verify the mp4 is publicly fetchable (`curl -sI` → 200 + video/mp4) BEFORE posting.
4. Publish from the Oracle VM (token lives there, never in git):
   `ssh ubuntu@192.9.153.72 'cd ~/garybudgets/repo && git pull --ff-only && python3 scripts/gb_post_reel_standalone.py <post_id>'`
5. Verify: Graph API `/<media_id>?fields=permalink` + the public permalink returns HTTP 200.

**DO NOT post reels via the Vercel `/api/publish` route.** It polls the container inline and the
300s function limit kills the request mid-flow (video processing routinely takes 4–6 min).

**BUG FIXED 2026-11-24:** the poster polled `graph.instagram.com/v21.0/<IG_ID>/<container_id>`,
which returns `error: nonexisting field`. The old code silently kept `status_code="IN_PROGRESS"` and
polled for 2 h without publishing. Status lookups must be node-level: `/v21.0/<container_id>`.
If a container is already FINISHED, publish it directly with
`POST /v21.0/<IG_ID>/media_publish {"creation_id": <cid>}` instead of re-rendering.

## Music
- Bed used here: `public/reels/audio/music-licensing-traps-bed.m4a` at volume 0.34.
- **User directive (2026-11-24): vary the music for every future reel.** Pick the next track from
  `scripts/reels/music-library.json` (lowest `last_used_reel`), never reuse the just-used bed.
- Swap: update `music` + `music_volume` in `designed.json`, re-run `make_designed_reel.py`.
  Bed must be >= reel length; `loudnorm` to −16 LUFS is applied at assembly.

## Style notes for the next one (user feedback 2026-11-24)
- "Still looks AI generated" → push prompts toward photographic realism: name a real camera/lens
  and film stock, add imperfect practical lighting, visible grain, slight underexposure, real set
  dressing clutter. Avoid symmetrical compositions and glowing/teal-orange hero shots.
- "It's all Ken Burns effect" → vary motion per scene: beat-cut hard cuts, slow push with
  rack-focus feel, lateral slide with parallax, whip-pan transitions. Do not apply zoom/pan to
  every scene.
