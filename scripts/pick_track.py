#!/usr/bin/env python3
"""Music rotation picker — no song repeats within 10 reels (2-week window).

Usage:
  pick_track.py --mood dark_cinematic [--reel-slug <slug>]
Prints the chosen track path (relative to repo root) to stdout and updates
last_used_reel + usage_log in music-library.json. Run BEFORE rendering a reel
so the spec's "music" field points at the picked track.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

LIB = Path("scripts/reels/music-library.json")
WINDOW = 10  # reels


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mood", required=True)
    ap.add_argument("--reel-slug", default="?")
    ap.add_argument("--register", action="store_true",
                    help="interactive: register new tracks into the library")
    args = ap.parse_args()

    lib = json.loads(LIB.read_text())
    tracks = lib["tracks"]

    if args.register:
        mood = input("mood (dark_cinematic/tension/motivational/emotional/tech): ").strip()
        fp = input("file path (relative to repo): ").strip()
        credit = input("credit line for caption (blank if none): ").strip()
        tid = f"man-{Path(fp).stem}"
        tracks.append({"id": tid, "source": "manual", "file": fp,
                       "mood": mood, "credit": credit, "last_used_reel": 0})
        lib["tracks"] = tracks
        LIB.write_text(json.dumps(lib, indent=2))
        print(f"registered {tid}")
        return

    pool = [t for t in tracks if t.get("mood") == args.mood]
    if not pool:
        pool = tracks  # fall back to any track if mood empty
    if not pool:
        print("ERROR: no tracks in library", file=sys.stderr)
        sys.exit(1)

    # least-recently-used wins; never reuse within WINDOW if alternatives exist
    pool = sorted(pool, key=lambda t: t.get("last_used_reel", 0))
    best = pool[0]
    for t in pool:
        if t.get("last_used_reel", 0) < best.get("last_used_reel", 0):
            best = t
    # if best was used within the window and others exist, pick the oldest other
    if best.get("last_used_reel", 0) > 0 and len(pool) > 1:
        others = [t for t in pool if t is not best]
        best = min(others, key=lambda t: t.get("last_used_reel", 0))

    next_reel = max([t.get("last_used_reel", 0) for t in tracks] + [0]) + 1
    best["last_used_reel"] = next_reel
    lib["usage_log"].append({
        "track": best["id"],
        "reel": next_reel,
        "reel_slug": args.reel_slug,
        "at": datetime.now(timezone.utc).isoformat(),
    })
    LIB.write_text(json.dumps(lib, indent=2))
    print(best["file"])
    if best.get("credit"):
        print("CREDIT:" + best["credit"])


if __name__ == "__main__":
    main()
