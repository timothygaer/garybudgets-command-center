"""
reel_qa.py — deterministic Instagram technical-compliance gate for reel MP4s.

INDEPENDENT of the builder (ReelAgent). Run it in the VERIFY phase against the
rules contract — a reel must NOT be marked done or deployed unless every check
passes. This is the durable guardrail so the 2026-08-19 moov-at-end failure can
never silently return.

Checks (all against the shared IG reel spec):
  faststart : moov atom near the START of the file (< 5%) — Instagram needs this
              to begin progressive transcoding. moov-at-end (99%) => the post
              sits IN_PROGRESS forever and never goes live.
  resolution: 1080x1920 (9:16 portrait)
  codec     : h264 + yuv420p
  audio     : aac
  duration  : <= 90s (reels feed format; our spec is ~29s)
  size      : sane (< 650MB IG hard limit)

Pure-Python (stdlib only) for the byte-level moov check; ffprobe for the media
specs (available on this Mac via homebrew). Exit code 0 = ALL PASS, 1 = any fail.

Usage:
    python3 scripts/gb_agents/reel_qa.py --check public/reels/<slug>.mp4
    python3 scripts/gb_agents/reel_qa.py --check public/reels/<slug>.mp4 --json
    python3 scripts/gb_agents/reel_qa.py --check <file> --summary   # one-line
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

MOOV_MAX_PCT = 5.0            # moov atom must be within the first 5% of the file
MAX_DURATION_S = 90.0         # IG reels feed cap
MAX_SIZE_BYTES = 650 * 1024 * 1024  # 650MB IG hard limit
REQUIRED_WH = (1080, 1920)    # 9:16
REQUIRED_VCODEC = "h264"
REQUIRED_PIXFMTS = {"yuv420p", "yuvj420p"}   # both are 4:2:0; IG accepts both
REQUIRED_ACODEC = "aac"


# ---------------------------------------------------------------- moov (pure-Python)
def _top_level_boxes(data: bytes):
    """Yield (offset, box_type, box_size) for each top-level MP4 box."""
    i, n = 0, len(data)
    while i + 8 <= n:
        size = int.from_bytes(data[i:i + 4], "big")
        btype = data[i + 4:i + 8]
        hdr = 8
        if size == 1:                       # 64-bit largesize
            if i + 16 > n:
                break
            size = int.from_bytes(data[i + 8:i + 16], "big")
            hdr = 16
        elif size == 0:                     # box extends to end of file
            size = n - i
        if size < hdr:
            break
        yield i, btype, size
        i += size


def moov_position_pct(path: str) -> float:
    """Fraction (0-100) of the file offset where the moov box starts."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        data = f.read()                     # reels are small (~12MB); fine to load
    for offset, btype, _ in _top_level_boxes(data):
        if btype == b"moov":
            return offset / size * 100.0 if size else 0.0
    return 100.0  # no moov at all => treat as broken


# ------------------------------------------------------------- media specs (ffprobe)
def _ffprobe_json(path: str, args: list[str]) -> dict:
    cmd = ["ffprobe", "-v", "error", "-of", "json"] + args + [path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        return {}
    try:
        return json.loads(r.stdout or "{}")
    except json.JSONDecodeError:
        return {}


def media_specs(path: str) -> dict:
    """Return resolved media specs, or None per-key when undetectable."""
    spec: dict = {"width": None, "height": None, "vcodec": None, "pix_fmt": None,
                  "acodec": None, "duration": None}
    data = _ffprobe_json(path, ["-show_streams", "-show_format"])
    streams = data.get("streams", [])
    for s in streams:
        ct = s.get("codec_type")
        if ct == "video" and spec["width"] is None:
            spec["width"] = s.get("width")
            spec["height"] = s.get("height")
            spec["vcodec"] = s.get("codec_name")
            spec["pix_fmt"] = s.get("pix_fmt")
        elif ct == "audio" and spec["acodec"] is None:
            spec["acodec"] = s.get("codec_name")
    fmt = data.get("format", {})
    d = fmt.get("duration")
    if d is not None:
        try:
            spec["duration"] = float(d)
        except (TypeError, ValueError):
            spec["duration"] = None
    return spec


# -------------------------------------------------------------------- the checks
def check(path: str) -> dict:
    """Run every gate against one MP4. Returns {check: {"ok": bool, "detail": str}}."""
    exists = os.path.exists(path)
    results = {"file_exists": {"ok": exists, "detail": path if exists else "missing"}}
    if not exists:
        results["faststart"] = {"ok": False, "detail": "cannot check (file missing)"}
        for k in ("resolution", "codec", "pix_fmt", "audio", "duration", "size"):
            results[k] = {"ok": False, "detail": "cannot check (file missing)"}
        return results

    size = os.path.getsize(path)
    results["size"] = {"ok": size <= MAX_SIZE_BYTES, "detail": f"{size/1024/1024:.1f}MB"}

    moov = moov_position_pct(path)
    results["faststart"] = {
        "ok": moov <= MOOV_MAX_PCT,
        "detail": f"moov at {moov:.1f}% (must be < {MOOV_MAX_PCT:.0f}%)",
    }

    m = media_specs(path)
    wh = (m["width"], m["height"])
    results["resolution"] = {
        "ok": wh == REQUIRED_WH,
        "detail": f"{m['width'] or '?'}x{m['height'] or '?'} (need {REQUIRED_WH[0]}x{REQUIRED_WH[1]})",
    }
    results["codec"] = {
        "ok": m["vcodec"] == REQUIRED_VCODEC,
        "detail": f"video codec {m['vcodec'] or '?'} (need {REQUIRED_VCODEC})",
    }
    results["pix_fmt"] = {
        "ok": m["pix_fmt"] in REQUIRED_PIXFMTS,
        "detail": f"pix_fmt {m['pix_fmt'] or '?'} (need one of {sorted(REQUIRED_PIXFMTS)})",
    }
    results["audio"] = {
        "ok": m["acodec"] == REQUIRED_ACODEC,
        "detail": f"audio codec {m['acodec'] or '?'} (need {REQUIRED_ACODEC})",
    }
    d = m["duration"]
    results["duration"] = {
        "ok": d is not None and d <= MAX_DURATION_S,
        "detail": f"{d:.1f}s (must be <= {MAX_DURATION_S:.0f}s)" if d is not None else "duration unknown",
    }
    return results


def passed(results: dict) -> bool:
    return all(r["ok"] for r in results.values())


def print_report(results: dict, path: str) -> None:
    print(f"Reel QA — {os.path.basename(path)}")
    for k, v in results.items():
        mark = "PASS" if v["ok"] else "FAIL"
        print(f"  [{mark:<4}] {k:<11} {v['detail']}")
    print("  RESULT:", "PASS — ready for deploy" if passed(results) else "FAIL — do NOT deploy")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Deterministic IG reel technical QA gate")
    ap.add_argument("--check", required=True, help="path to the reel MP4")
    ap.add_argument("--json", action="store_true", help="emit JSON only")
    ap.add_argument("--summary", action="store_true", help="one-line result")
    args = ap.parse_args(argv)

    results = check(args.check)
    if args.json:
        print(json.dumps({"path": args.check, "passed": passed(results), "checks": results}, indent=2))
    elif args.summary:
        print(f"{'PASS' if passed(results) else 'FAIL'} {os.path.basename(args.check)}")
    else:
        print_report(results, args.check)
    return 0 if passed(results) else 1


if __name__ == "__main__":
    sys.exit(main())
