#!/usr/bin/env python3
"""
Dispatch due reel posts to the hardened poster on the Oracle VM.
Runs every 15 min via cron. Delegates REEL posting to gb_post_reel_standalone.py
(reliable: resume + 2h wait + safe manifest write) so gb-publish.py never has to
handle reels. Carousels/images are untouched (still gb-publish.py).

One reel at a time: if a reel poster is already running, this exits so we never
launch duplicate poster processes for the same reel.

Exit silent when nothing to do (cron-friendly).
"""
import os, sys, json, subprocess, datetime, time
from pathlib import Path

REPO_DIR = os.path.expanduser("~") + "/garybudgets/repo"
MANIFEST = REPO_DIR + "/manifest.json"
POSTER = REPO_DIR + "/scripts/gb_post_reel_standalone.py"
LOG = os.path.expanduser("~") + "/garybudgets/logs/reel_dispatch.log"
CATCHUP_HOURS = 24  # a due reel more than 24h past its slot is stale; skip it


def log(msg):
    try:
        with open(LOG, "a") as f:
            f.write(datetime.datetime.now().isoformat() + " " + msg + "\n")
    except Exception:
        pass


def is_due(sched_str, now):
    if not sched_str:
        return False
    # schedule format: "Wed, Aug 26 · 12:00 PM PT"
    try:
        dt = datetime.datetime.strptime(sched_str, "%a, %b %d · %I:%M %p %Z")
        # naive local (VM UTC); compare with generous window
        delta = now - dt
        return datetime.timedelta(0) <= delta <= datetime.timedelta(hours=CATCHUP_HOURS)
    except Exception:
        return False


def poster_running():
    out = subprocess.run(["pgrep", "-f", "gb_post_reel_standalone.py"],
                         capture_output=True, text=True, timeout=15).stdout
    return bool(out.strip())


def main():
    m = json.load(open(MANIFEST))
    now = datetime.datetime.now()
    candidates = []
    for p in m.get("posts", []):
        if p.get("media_type") != "reel":
            continue
        if p.get("status") != "approved":
            continue
        if p.get("stuck") or p.get("skipped"):
            continue
        sched = p.get("proposed_schedule") or p.get("original_schedule")
        if is_due(sched, now):
            # skip if already started (state file exists)
            if Path(f"/tmp/gb_{p['id']}_cid.txt").exists():
                continue
            candidates.append((sched, p))
    if not candidates:
        return  # silent
    if poster_running():
        log("poster already running — skipping dispatch")
        return  # one at a time
    candidates.sort()
    _, post = candidates[0]
    log("dispatching reel: " + post["id"] + " (" + post.get("title", "") + ") sched=" + str(candidates[0][0]))
    subprocess.Popen(
        ["/usr/bin/python3", "-u", POSTER, post["id"]],
        stdout=open(os.path.expanduser("~") + f"/garybudgets/logs/reel_{post['id']}.log", "w"),
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    print("DISPPATCHED_REEL " + post["id"])


if __name__ == "__main__":
    main()
