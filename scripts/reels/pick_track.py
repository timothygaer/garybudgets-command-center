#!/usr/bin/env python3
"""Pick a music bed for the next reel, enforcing the no-repeat-within-10-reels rule.

Usage:
  python3 scripts/reels/pick_track.py --mood dark_cinematic
  python3 scripts/reels/pick_track.py --mood dark_cinematic --mark   # record usage
  python3 scripts/reels/pick_track.py --stats
  python3 scripts/reels/pick_track.py            # any mood, least recently used

Selection order:
  1. only tracks whose `file` exists on disk (legacy archive entries with no file are skipped)
  2. only tracks not used within the last REPEAT_WINDOW reels
  3. lowest `last_used_reel` wins; ties broken by a stable hash so the choice is
     deterministic per bookkeeping state but still rotates across tracks
"""
import argparse
import hashlib
import json
import os
import sys

REPEAT_WINDOW = 10
LIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "music-library.json")


def load():
    with open(LIB) as f:
        return json.load(f)


def save(lib):
    with open(LIB, "w") as f:
        json.dump(lib, f, indent=2, ensure_ascii=False)
        f.write("\n")


def resolve(track):
    """Expand ~ and make relative paths repo-relative."""
    p = track.get("file")
    if not p:
        return None
    p = os.path.expanduser(p)
    if not os.path.isabs(p):
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
            os.path.abspath(__file__)))), p)
    return p if os.path.exists(p) else None


def candidates(lib, mood=None):
    tracks = lib["tracks"]
    latest = max([t.get("last_used_reel", 0) for t in tracks] + [0])
    fresh = [t for t in tracks if latest - t.get("last_used_reel", 0) > REPEAT_WINDOW]
    pool = fresh if fresh else tracks
    out = []
    for t in pool:
        if mood and t.get("mood") != mood:
            continue
        path = resolve(t)
        if path:
            out.append(dict(t, resolved_path=path))
    return out, latest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mood", help="dark_cinematic | tension | driving_urban | upbeat_energetic | warm_emotive | emotional")
    ap.add_argument("--mark", action="store_true", help="record this pick as used")
    ap.add_argument("--stats", action="store_true")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    lib = load()
    if args.stats:
        from collections import Counter
        usable = [t for t in lib["tracks"] if resolve(t)]
        print(f"total={len(lib['tracks'])} usable={len(usable)}")
        for mood, n in sorted(Counter(t.get("mood") for t in usable).items(),
                              key=lambda kv: -kv[1]):
            unused = sum(1 for t in usable if t.get("mood") == mood and t.get("last_used_reel", 0) == 0)
            print(f"  {mood:<18} {n:>3} usable ({unused} never used)")
        return 0

    pool, latest = candidates(lib, args.mood)
    if not pool:
        print(f"no usable track for mood={args.mood}", file=sys.stderr)
        return 1

    pool.sort(key=lambda t: (t.get("last_used_reel", 0),
                             hashlib.md5((t["id"] + str(latest)).encode()).hexdigest()))
    pick = pool[0]

    if args.mark:
        idx = latest + 1
        for t in lib["tracks"]:
            if t["id"] == pick["id"]:
                t["last_used_reel"] = idx
                break
        lib.setdefault("usage_log", []).append({"reel": idx, "track": pick["id"],
                                                "mood": pick.get("mood")})
        save(lib)
        pick["reel_index"] = idx

    result = {
        "id": pick["id"],
        "mood": pick.get("mood"),
        "file": pick["resolved_path"],
        "credit": pick.get("credit"),
        "source": pick.get("source"),
        "local_only": pick.get("local_only", False),
        "last_used_reel": pick.get("last_used_reel", 0),
        "marked": args.mark,
    }
    if args.json:
        print(json.dumps(result, indent=1))
    else:
        print(f"PICK: {result['id']}  [{result['mood']}]")
        print(f"file:  {result['file']}")
        print(f"credit: {result['credit']}")
        print(f"last_used_reel: {result['last_used_reel']}" + (" -> marked used" if args.mark else " (use --mark to record)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
