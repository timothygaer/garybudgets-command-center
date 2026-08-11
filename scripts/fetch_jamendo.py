#!/usr/bin/env python3
"""Jamendo API music fetcher for the Gary Budgets reel rotation.

Requires a free Jamendo client_id (user registers at api.jamendo.com — see the
"Gary Budgets — TikTok & Music Launch Checklist" sheet, step 3).

Usage:
  JAMENDO_CLIENT_ID=<id> fetch_jamendo.py --mood cinematic --count 8 --out public/reels/audio/jamendo/
Registers downloaded tracks into scripts/reels/music-library.json (source: jamendo).

Jamendo API: https://api.jamendo.com/v3.0/tracks/?client_id=...&format=json&tags=<tag>&durationinsec_lte=90&order=popularity_week&include=licenses
CC-BY tracks require attribution in the caption — pick_track.py prints CREDIT.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

LIB = Path("scripts/reels/music-library.json")
BASE = "https://api.jamendo.com/v3.0/tracks/"

MOOD_TAGS = {
    "dark_cinematic": ["cinematic", "dark"],
    "tension": ["tense", "dark"],
    "motivational": ["uplifting", "corporate"],
    "emotional": ["piano", "emotional"],
    "tech": ["electronic", "ambient"],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mood", required=True, choices=list(MOOD_TAGS))
    ap.add_argument("--count", type=int, default=8)
    ap.add_argument("--out", default="public/reels/audio/jamendo")
    ap.add_argument("--max-duration", type=int, default=90)
    args = ap.parse_args()

    client_id = os.environ.get("JAMENDO_CLIENT_ID", "")
    if not client_id:
        print("ERROR: set JAMENDO_CLIENT_ID env var (register free at api.jamendo.com)", file=sys.stderr)
        sys.exit(1)

    tags = ",".join(MOOD_TAGS[args.mood])
    url = (f"{BASE}?client_id={client_id}&format=json&tags={tags}"
           f"&durationinsec_lte={args.max_duration}&order=popularity_week"
           f"&include=licenses&limit={args.count}")
    with urllib.request.urlopen(url, timeout=30) as r:
        data = json.loads(r.read())

    tracks = data.get("results", [])
    if not tracks:
        print("no results for tags", tags)
        sys.exit(1)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    lib = json.loads(LIB.read_text())
    added = 0
    for t in tracks:
        name = t.get("name", "track")
        tid = t.get("id")
        audio_url = (t.get("audio") or [{}])[0].get("audio")
        if not audio_url:
            continue
        # license check: prefer CC-BY (free with attribution)
        license_name = (t.get("license") or {}).get("fullname", "")
        cc_by = "creativecommons.org/licenses/by" in license_name.lower()
        dest = out_dir / f"jam-{args.mood}-{tid}.mp3"
        subprocess.run(["curl", "-sL", "-o", str(dest), audio_url], check=True)
        if not dest.exists() or dest.stat().st_size < 200_000:
            dest.unlink(missing_ok=True)
            continue
        lib["tracks"].append({
            "id": f"jam-{args.mood}-{tid}",
            "source": "jamendo",
            "file": str(dest),
            "mood": args.mood,
            "credit": f"{t.get('artist_name', '')} — {name} (Jamendo, CC-BY)" if cc_by else f"{t.get('artist_name', '')} — {name} (Jamendo)",
            "last_used_reel": 0,
            "attribution_required": cc_by,
        })
        added += 1
        print(f"  + {dest.name} ({dest.stat().st_size // 1024}K) credit: {lib['tracks'][-1]['credit']}")

    LIB.write_text(json.dumps(lib, indent=2))
    print(f"registered {added} tracks into music-library.json")


if __name__ == "__main__":
    main()
