#!/usr/bin/env python3
"""
Runs the topic research agent and publishes its output.

Two modes:
  (default)          run the research agent now, publish topics.json, notify
  --check-request    run ONLY if the app queued a manual refresh (i.e.
                     research-request.json is newer than topics.json)

This is the piece that makes the agent independent of the app: the app never
crawls anything, it just drops a request file and reads the JSON that this
script publishes.

Credentials come from the environment (cron sources scripts/github_env and
scripts/telegram_env). Nothing is required for the research itself — every
source is a free RSS or news-search endpoint.
"""

from __future__ import annotations

import fcntl
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"
ENGINE = SCRIPTS / "research" / "engine.py"
CONFIG = SCRIPTS / "research" / "configs" / "garybudgets.json"
TOPICS = REPO / "topics.json"
REQUEST = REPO / "research-request.json"
LOCK = Path("/tmp/gb-research.lock")

# Files this script owns when it commits. Deliberately narrow so a research
# run can never sweep up someone else's in-flight changes.
PUBLISH_FILES = ["topics.json", "scripts/research/.history.json"]


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] {msg}", flush=True)


def notify_telegram(message: str, preview: bool = False) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        log("TELEGRAM_SKIPPED: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not in env")
        return False
    payload = {"chat_id": chat_id, "text": message, "disable_web_page_preview": preview}
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        "https://api.telegram.org/bot" + token + "/sendMessage",
        data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status == 200
    except Exception as e:
        log(f"TELEGRAM_FAILED: {type(e).__name__}: {e}")
        return False


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=str(REPO), check=check,
                          capture_output=True, text=True)


def publish(message: str) -> bool:
    """Commit and push just the research outputs. Retries once against a
    non-fast-forward, because the publisher and the tiktok cron also push."""
    try:
        git("add", *PUBLISH_FILES)
    except subprocess.CalledProcessError as e:
        log(f"GIT_ADD_FAILED: {e.stderr.strip()[:200]}")
        return False

    if not git("diff", "--cached", "--quiet", check=False).returncode:
        log("nothing to commit")
        return True

    try:
        git("commit", "-q", "-m", message)
    except subprocess.CalledProcessError as e:
        log(f"GIT_COMMIT_FAILED: {e.stderr.strip()[:200]}")
        return False

    for attempt in (1, 2):
        try:
            git("push", "-q", "origin", "HEAD:main")
            log(f"pushed (attempt {attempt})")
            return True
        except subprocess.CalledProcessError as e:
            log(f"push attempt {attempt} failed: {e.stderr.strip()[:160]}")
            git("pull", "--rebase", "--autostash", "-q", "origin", "main", check=False)
            time.sleep(3)
    return False


def format_notification(out: dict, pushed: bool) -> str:
    run = out.get("run", {})
    topics = out.get("topics", [])
    lines = [
        "🔎 Topic Scout found %d new topics" % len(topics),
        "%d/%d sources · %s signals · %d already used" % (
            run.get("sources_ok", 0), run.get("sources_total", 0),
            f"{run.get('signals_seen', 0):,}", run.get("corpus_titles", 0)),
        "",
    ]
    for t in topics[:5]:
        lines.append(f"• {t['confidence']}% {t['topic'][:88]}")
        lines.append(f"   {t['source']} — {t['url'][:70]}")
    if len(topics) > 5:
        lines.append(f"…and {len(topics) - 5} more")
    gaps = run.get("sources_failed", [])
    if gaps:
        lines.append("")
        lines.append("Source gaps: " + ", ".join(g["id"] for g in gaps[:8]))
    lines.append("")
    lines.append("Open the command center → Start Research." if pushed
                 else "⚠️ Topics generated but the GitHub push failed — check research.log.")
    return "\n".join(lines)


def main() -> int:
    check_request = "--check-request" in sys.argv

    lock_file = open(LOCK, "w")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("SKIP_LOCKED: another research run is in progress")
        return 0

    if check_request:
        if not REQUEST.exists():
            return 0  # nothing queued — stay silent, this runs every 5 minutes
        try:
            requested = REQUEST.stat().st_mtime
            published = TOPICS.stat().st_mtime if TOPICS.exists() else 0
        except OSError:
            return 0
        if requested <= published:
            return 0  # already served this request
        log("manual refresh requested by the app — running")

    if not ENGINE.exists() or not CONFIG.exists():
        log(f"MISSING ENGINE OR CONFIG: {ENGINE} / {CONFIG}")
        return 1

    log("running research agent")
    proc = subprocess.run([sys.executable, str(ENGINE), str(CONFIG)],
                          cwd=str(REPO), capture_output=True, text=True)
    tail = (proc.stdout or "")[-400:]
    if proc.returncode != 0:
        log(f"ENGINE_FAILED rc={proc.returncode}: {tail} {(proc.stderr or '')[-300:]}")
        notify_telegram("⚠️ Topic Scout failed to run.\n" + ((proc.stderr or "")[-300:]))
        return 1
    log(tail.strip().replace("\n", " | "))

    try:
        out = json.loads(TOPICS.read_text())
    except (OSError, json.JSONDecodeError) as e:
        log(f"OUTPUT_UNREADABLE: {e}")
        return 1

    topics = out.get("topics", [])
    if not topics:
        log("no topics selected — not publishing")
        fail = out.get("run", {}).get("sources_failed", [])
        notify_telegram("⚠️ Topic Scout ran but found no usable topics.\n"
                        + f"{len(fail)} source gaps: " + ", ".join(f["id"] for f in fail[:8]))
        return 0

    pushed = publish(f"auto: topic scout — {len(topics)} topics"
                     f" [{datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC]")

    if REQUEST.exists():
        REQUEST.unlink()
        git("rm", "--cached", "-q", "--ignore-unmatch", "research-request.json", check=False)
        git("add", "-A", "research-request.json", check=False)
        git("commit", "-q", "-m", "chore(research): consume refresh request", check=False)
        git("push", "-q", "origin", "HEAD:main", check=False)

    notify_telegram(format_notification(out, pushed), preview=True)
    log(f"DONE topics={len(topics)} pushed={pushed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
