# Open to AI: Hollywood Is Embracing AI (Reel Pipeline — 2026-11-21)

## What was built
- 6 cinematic background images via chatgpt-imagegen (web backend) using `scripts/chatgpt_web_drive.py` through the chrome-use relay.
  - Each image ~1.0–1.4 MB, 941×1672 (ChatGPT returns ~941×1672 PNG even when requesting JPEG).
  - All images saved to `public/reels/bg/reel-open-to-ai-hollywood/01.jpg` through `06.jpg`.

## Background image prompts
Each prompt must include: `Photorealistic cinematic film still, vertical 9:16` + `[specific scene]` +
`Deep blacks, high contrast, single light source, shallow depth of field, 35mm grain, teal-and-amber grade` +
`[Empty/dark region description for text overlay]` + `No people, no faces, no text, no readable text, no logos, no signage, no watermarks.`

| File | Subject | Prompt file |
|------|---------|-------------|
| 01.jpg | Soundstage at night, LED volume wall glow, cable runs, dolly silhouette | /tmp/gb_bg1.txt |
| 02.jpg | Dark production office, monitors with colour-graded film, budget ledger, coffee cup | /tmp/gb_bg2.txt |
| 03.jpg | Hollywood soundstage exterior, closed stage door, work-light, wet asphalt | /tmp/gb_bg3.txt |
| 04.jpg | Empty studio screening room, dark seats, screen glow from front | /tmp/gb_bg4.txt |
| 05.jpg | Post-production suite, blinking network gear rack, laptop, cable | /tmp/gb_bg5.txt |
| 06.jpg | Empty soundstage floor at dawn, director's chair, bare bulb, haze | /tmp/gb_bg6.txt |

### How to regenerate any background
```bash
export PATH="/Users/dit/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
python3 /Users/dit/.hermes/cache/scratch/gb_bg_gen.py \
  --prompt-file /tmp/gb_bg1.txt \
  --out public/reels/bg/reel-open-to-ai-hollywood/01.jpg \
  --timeout 420
```
The script (`gb_bg_gen.py`) uses `chrome-use --session chatgpt-web` to:
  1. Open chatgpt.com
  2. Send the prompt to the composer
  3. Poll for `Generated image N` button completion
  4. Download the blob image
Skip if the output file already exists and >500KB (idempotent).

### Rate limit note
~13–15 generations per hour before ChatGPT rate-limits. Sleep 45s between images.
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

## Post-deployment steps
1. Commit + push: git add + commit + git push
2. Deploy: `npx vercel --prod --yes`
3. Update manifest entry: set status="posted", add instagram_url/instagram_media_id
4. Post via Instagram Graph API: container flow (create_video → poll → publish)
5. Update `music-library.json` with last_used_reel increment
