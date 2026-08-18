#!/usr/bin/env python3
"""
Gary Budgets Publisher — Oracle VM version (v2, content-type driven).

Content-type routing
--------------------
Every post declares its content type explicitly in the manifest via `media_type`.
The publisher routes each post to the pipeline registered for that type:

    media_type   pipeline          assets required
    ----------   --------          ----------------
    image        single post       1 image URL
    carousel     carousel post     2-10 image URLs
    reel         video reel        video_url (mp4/mov/m4v/webm) + optional cover_url

- The declared type is authoritative and is validated against the post's assets,
  so a mis-tagged post fails loudly instead of publishing the wrong format.
- Posts without a declared type are inferred from their assets (legacy support),
  then validated the same way.
- To add a new type later (TikTok, YouTube, fewer-photo variants, …):
  add a pipeline function + one entry in CONTENT_TYPES. Nothing else changes.

Safety rules (inherited)
------------------------
- Optional POST_ID argument. With no POST_ID, selects only approved posts whose
  schedule is due (never future posts unless --force).
- --max-catchup-hours caps how old a missed schedule can be before it is skipped.
- Never publishes from a dirty repo; syncs to origin/main before every run.
- Detects already-live posts by caption and marks them posted instead of duplicating.

Alerting
--------
On any publish ERROR the VM sends a Telegram alert (deduped), so failures are
noticed even when the Mac is off. Requires TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
in the environment (cron sources scripts/telegram_env).
"""
import argparse
import fcntl
import json
import os
import re
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse

import requests

home = str(Path.home())
if home == "/Users/dit":
    DEFAULT_REPO_DIR = home + "/workspace/garybudgets-command-center"
    DEFAULT_TOKEN_PATH = home + "/Documents/Obsidian Vault/04 - Private/API Keys/Instagram Graph API Token.md.md"
else:
    DEFAULT_REPO_DIR = home + "/garybudgets/repo"
    DEFAULT_TOKEN_PATH = home + "/garybudgets/scripts/ig_token.txt"
MANIFEST = Path(os.environ.get("GB_MANIFEST", DEFAULT_REPO_DIR + "/manifest.json"))
TOKEN_PATH = Path(os.environ.get("GB_TOKEN_PATH", DEFAULT_TOKEN_PATH))
REPO_DIR = Path(os.environ.get("GB_REPO_DIR", DEFAULT_REPO_DIR))
IG_ID = os.environ.get("GB_IG_ID", "17841414649666554")
BASE = "https://graph.instagram.com/v21.0/" + IG_ID
GH_TOKEN = os.environ.get("GITHUB_TOKEN", "")

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}
MONTHS = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
          "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
TZ_MAP = {
    "PT": "America/Los_Angeles", "PST": "America/Los_Angeles", "PDT": "America/Los_Angeles",
    "ET": "America/New_York", "EST": "America/New_York", "EDT": "America/New_York",
    "UTC": "UTC",
}

# ---------------------------------------------------------------------------
# Content-type registry — the single place to add a new publishable type.
# Each entry: pipeline name + human description of required assets.
# ---------------------------------------------------------------------------
CONTENT_TYPES = {
    "image":    "single-image post (exactly 1 image URL)",
    "carousel": "carousel post (2-10 image URLs)",
    "reel":     "video reel (video_url, optional cover_url)",
}

ALERT_STATE_PATH = Path("/tmp/gb-alert-state.json")
ALERT_DEDUPE_SECONDS = 3600  # at most one alert per key per hour


# ---------------------------------------------------------------------------
# Alerting (VM-side, works with the Mac off)
# ---------------------------------------------------------------------------
def notify_telegram(message):
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        print("ALERT_SKIPPED: no TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID in env (message: " + message[:80] + ")")
        return False
    try:
        r = requests.post(
            "https://api.telegram.org/bot" + token + "/sendMessage",
            json={"chat_id": chat_id, "text": message, "disable_web_page_preview": True},
            timeout=20,
        )
        ok = r.status_code == 200 and r.json().get("ok") is True
        print(("ALERT_SENT" if ok else "ALERT_FAILED: " + r.text[:200]))
        return ok
    except Exception as e:
        print("ALERT_ERROR: " + str(e))
        return False


def alert_deduped(key, message, seconds=ALERT_DEDUPE_SECONDS):
    """Send an alert at most once per key per window (persisted across cron ticks)."""
    state = {}
    if ALERT_STATE_PATH.exists():
        try:
            state = json.loads(ALERT_STATE_PATH.read_text())
        except Exception:
            state = {}
    now = time.time()
    last = state.get(key)
    if last and now - last.get("ts", 0) < seconds and last.get("msg") == message:
        print("ALERT_DEDUPED: " + key)
        return False
    ok = notify_telegram(message)
    state[key] = {"ts": now, "msg": message}
    try:
        ALERT_STATE_PATH.write_text(json.dumps(state))
    except Exception:
        pass
    return ok


def fail(message):
    """Print an error, alert Telegram, and exit non-zero."""
    print("ERROR: " + message)
    alert_deduped("error:" + str(message)[:80], "🚨 Gary Budgets publish ERROR:\n" + message)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Manifest / repo plumbing
# ---------------------------------------------------------------------------
def parse_args():
    p = argparse.ArgumentParser(description="Publish scheduled Gary Budgets Instagram posts safely.")
    p.add_argument("post_id", nargs="?", help="Specific post id to publish if due")
    p.add_argument("--dry-run", action="store_true", help="Validate selection/media without posting")
    p.add_argument("--force", action="store_true", help="Allow publishing before scheduled time for explicit manual recovery")
    p.add_argument("--max-catchup-hours", type=float, default=float(os.environ.get("GB_MAX_CATCHUP_HOURS", "36")),
                   help="With no POST_ID, only auto-publish posts due within this many hours; older stale approvals are skipped")
    return p.parse_args()


def load_manifest():
    if not MANIFEST.exists():
        fail("No manifest at " + str(MANIFEST))
    return json.loads(MANIFEST.read_text())


def _abort_stale_rebase():
    """If a previous pull --rebase was left abandoned mid-conflict (2026-08-18 incident:
    a UU manifest.json left a dirty repo that blocked publishing for ~9 hours), clear it so
    the publisher self-heals instead of refusing forever. Safe: only touches a partial rebase
    that git itself left incomplete, never committed work."""
    if not (REPO_DIR / ".git").exists():
        return
    import os
    for d in (REPO_DIR / ".git" / "rebase-merge", REPO_DIR / ".git" / "rebase-apply"):
        if d.exists():
            print("GIT_SELFHEAL: aborting abandoned rebase state at " + d.name)
            subprocess.run(["git", "rebase", "--abort"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=30, check=False)
            # If still dirty (unmerged), reset to origin/main since the only in-flight
            # work is a half-applied rebase we just aborted.
            st = subprocess.run(["git", "status", "--porcelain"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=15, check=False)
            if st.stdout.strip():
                print("GIT_SELFHEAL: residual conflict markers; hard-resetting to origin/main")
                subprocess.run(["git", "reset", "--hard", "origin/main"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=30, check=False)
            break


def sync_repo_before_publish():
    """Start every publish from origin/main so Oracle cannot post from stale state."""
    if not (REPO_DIR / ".git").exists():
        return
    _abort_stale_rebase()
    subprocess.run(["git", "fetch", "origin", "main"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=45, check=False)
    status = subprocess.run(["git", "status", "--porcelain"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=15, check=False)
    if status.stdout.strip():
        raise RuntimeError("Repo has uncommitted changes before publish; refusing to publish from dirty state")
    rebase = subprocess.run(["git", "pull", "--rebase", "origin", "main"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=60)
    if rebase.returncode != 0:
        # A pull --rebase that fails leaves the repo dirty (conflict markers). Don't leave
        # it locked for hours — abort so the NEXT tick gets a clean repo and can retry.
        print("GIT_SELFHEAL: pull --rebase failed; aborting to leave a clean repo: " + (rebase.stderr.strip()[-300:] or str(rebase.returncode)))
        subprocess.run(["git", "rebase", "--abort"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=30, check=False)
        raise RuntimeError("Repo sync failed before publish: " + (rebase.stderr.strip()[-500:] or str(rebase.returncode)))


def parse_schedule(schedule_str):
    if not schedule_str:
        return None
    # Examples: Thu, Jul 2 · 6:00 AM PT ; Mon, Jul 13 · 10:00 AM ET
    match = re.match(r"\w+,\s+(\w+)\s+(\d+)\s+·\s+(\d+):(\d+)\s+(AM|PM)\s+([A-Z]{2,3})", schedule_str)
    if not match:
        return None
    month = MONTHS.get(match.group(1))
    if not month:
        return None
    day = int(match.group(2))
    hour = int(match.group(3))
    minute = int(match.group(4))
    ampm = match.group(5)
    tz_label = match.group(6)
    if ampm == "PM" and hour != 12:
        hour += 12
    elif ampm == "AM" and hour == 12:
        hour = 0
    year = datetime.now(timezone.utc).year
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(TZ_MAP.get(tz_label, "America/Los_Angeles"))
        return datetime(year, month, day, hour, minute, tzinfo=tz)
    except Exception:
        return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def now_utc():
    return datetime.now(timezone.utc)


def post_schedule_dt(post):
    return parse_schedule(post.get("proposed_schedule") or post.get("original_schedule") or "")


def is_due(post):
    sched = post_schedule_dt(post)
    if sched is None:
        return False
    return sched.astimezone(timezone.utc) <= now_utc()


def select_post(manifest, post_id, force=False, max_catchup_hours=36):
    posts = manifest.get("posts", [])
    if post_id:
        post = next((p for p in posts if p.get("id") == post_id), None)
        if not post:
            fail("Post " + post_id + " not found in manifest")
        if post.get("status") == "posted":
            print("SKIP: " + post_id + " already posted")
            return None
        if post.get("status") != "approved" and not force:
            print("SKIP: " + post_id + " status is " + str(post.get("status")) + " (not approved)")
            return None
        if not force and not is_due(post):
            sched = post.get("proposed_schedule") or post.get("original_schedule") or "unknown"
            print("SKIP_NOT_DUE: " + post_id + " scheduled for " + sched)
            return None
        return post

    due = []
    for p in posts:
        if p.get("status") != "approved":
            continue
        sched = post_schedule_dt(p)
        if not sched:
            print("SKIP_NO_PARSEABLE_SCHEDULE: " + p.get("id", "?") + " " + str(p.get("proposed_schedule") or p.get("original_schedule")))
            continue
        sched_utc = sched.astimezone(timezone.utc)
        age_hours = (now_utc() - sched_utc).total_seconds() / 3600
        if sched_utc <= now_utc() and age_hours <= max_catchup_hours:
            due.append((sched_utc, p))
        elif sched_utc <= now_utc():
            print("SKIP_STALE_APPROVAL: " + p.get("id", "?") + " scheduled " + str(p.get("proposed_schedule") or p.get("original_schedule")) + f" ({age_hours:.1f}h old)")
    if not due:
        print("NO_DUE_APPROVED_POSTS: no approved posts are scheduled at or before now")
        return None
    due.sort(key=lambda x: x[0])
    return due[0][1]


# ---------------------------------------------------------------------------
# Asset resolution + content-type routing
# ---------------------------------------------------------------------------
def is_image_url(url):
    try:
        parsed = urlparse(url)
        ext = Path(parsed.path).suffix.lower()
        return parsed.scheme in ("http", "https") and ext in IMAGE_EXTENSIONS
    except Exception:
        return False


def is_video_url(url):
    try:
        parsed = urlparse(url)
        ext = Path(parsed.path).suffix.lower()
        return parsed.scheme in ("http", "https") and ext in VIDEO_EXTENSIONS
    except Exception:
        return False


def numeric_key(value):
    name = Path(urlparse(value).path).name if value.startswith("http") else Path(value).name
    stem = Path(name).stem
    m = re.match(r"^(\d+)$", stem)
    return (0, int(stem)) if m else (1, name.lower())


def media_urls_for_post(post):
    urls = [u for u in (post.get("image_urls") or []) if isinstance(u, str) and is_image_url(u)]
    if urls:
        return sorted(urls, key=numeric_key)

    # Fallback: scan repo public/images/<POST_ID>/ for actual images only.
    post_id = post.get("id")
    image_dir = REPO_DIR / "public" / "images" / post_id
    if not image_dir.exists():
        return []
    files = [p for p in image_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS]
    # Only publish numeric image filenames; this avoids prompts, exports, source notes, etc.
    numeric_files = [p for p in files if re.match(r"^\d+$", p.stem)]
    base_url = "https://garybudgets-command-center.vercel.app/images/" + post_id + "/"
    return [base_url + p.name for p in sorted(numeric_files, key=lambda p: numeric_key(p.name))]


def resolve_content_type(post):
    """Return the authoritative content type for a post.

    Declared `media_type` wins (validated against the registry); legacy posts
    without one are inferred from assets, and the result is validated so the
    pipeline never guesses.
    """
    post_id = post.get("id", "?")
    declared = (post.get("media_type") or "").strip().lower()
    if declared:
        if declared not in CONTENT_TYPES:
            fail(f"post {post_id} declares unknown media_type {declared!r}; supported types: {', '.join(sorted(CONTENT_TYPES))}")
        return declared

    if post.get("video_url") and is_video_url(post.get("video_url")):
        inferred = "reel"
    else:
        urls = media_urls_for_post(post)
        if len(urls) == 1:
            inferred = "image"
        elif len(urls) >= 2:
            inferred = "carousel"
        else:
            fail(f"post {post_id} has no media_type and no usable assets (no video_url, no image URLs/files)")
    print(f"INFERRED_TYPE: {post_id} -> {inferred} (no explicit media_type; add one to the manifest to make it explicit)")
    return inferred


def validate_assets_for_type(post, content_type):
    """Validate the post's assets against its content type; return the asset bundle."""
    post_id = post.get("id", "?")
    if content_type == "reel":
        video = post.get("video_url") or ""
        if not is_video_url(video):
            fail("reel post " + post_id + " missing valid video_url: " + video)
        return {"video_url": video, "cover_url": post.get("cover_url") or ""}

    urls = media_urls_for_post(post)
    if content_type == "image":
        if len(urls) != 1:
            fail("image post " + post_id + " needs exactly 1 image; found " + str(len(urls)))
        return urls
    if content_type == "carousel":
        if len(urls) < 2:
            fail("carousel post " + post_id + " needs at least 2 images; found " + str(len(urls)))
        if len(urls) > 10:
            fail("Instagram carousel max is 10 images; found " + str(len(urls)) + " for " + post_id)
        return urls
    fail("post " + post_id + " has unhandled content type " + repr(content_type))


# ---------------------------------------------------------------------------
# Instagram pipelines
# ---------------------------------------------------------------------------
def read_token():
    if not TOKEN_PATH.exists():
        fail("Token file not found at " + str(TOKEN_PATH))
    raw = TOKEN_PATH.read_text()
    if "=" not in raw:
        fail("Token format invalid — expected key=VALUE")
    token = raw.split("=", 1)[1].strip()
    if not token:
        fail("Empty token")
    return token


def norm_text(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def caption_key(s):
    return norm_text(s)[:220]


def find_live_match(post, token):
    key = caption_key(post.get("caption", ""))
    if not key:
        return None
    url = "https://graph.instagram.com/v21.0/" + IG_ID + "/media?" + urlencode({
        "fields": "id,caption,media_type,permalink,timestamp",
        "limit": "50",
        "access_token": token,
    })
    r = requests.get(url, timeout=30)
    data = r.json()
    for item in data.get("data", []):
        if caption_key(item.get("caption", "")) == key:
            return item
    return None


def mark_posted_from_live_match(manifest, post, match):
    post["status"] = "posted"
    post["posted_at"] = match.get("timestamp") or time.strftime("%Y-%m-%dT%H:%M:%S+0000", time.gmtime())
    post["instagram_url"] = match.get("permalink")
    post["instagram_media_id"] = match.get("id")
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print("SKIP_ALREADY_LIVE: " + post.get("id", "?") + " " + str(match.get("permalink")))
    commit_and_push(post.get("id", "?"), post.get("title", ""))


def acquire_local_lock(post_id):
    lock_name = post_id or "auto"
    lock_path = Path("/tmp") / ("gb-publish-" + re.sub(r"[^A-Za-z0-9_.-]+", "_", lock_name) + ".lock")
    lock_file = open(lock_path, "w")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("SKIP_LOCKED: another publisher is already running for " + lock_name)
        return None
    lock_file.write(socket.gethostname() + " " + str(os.getpid()) + " " + datetime.now(timezone.utc).isoformat() + "\n")
    lock_file.flush()
    return lock_file


def commit_and_push(post_id, post_title):
    try:
        if GH_TOKEN:
            subprocess.run(
                ["git", "remote", "set-url", "origin", f"https://timothygaer:{GH_TOKEN}@github.com/timothygaer/garybudgets-command-center.git"],
                cwd=str(REPO_DIR), capture_output=True, text=True, timeout=15, check=False,
            )
        subprocess.run(["git", "add", "manifest.json"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=15, check=False)
        msg = f"auto: Post {post_id} '{post_title}' published [Oracle] [{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}]"
        commit = subprocess.run(["git", "commit", "-m", msg], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=20)
        if commit.returncode != 0 and "nothing to commit" not in (commit.stdout + commit.stderr).lower():
            print("GIT_ERROR: commit failed: " + (commit.stderr.strip()[-300:] or str(commit.returncode)))
            return False
        push = subprocess.run(["git", "push"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=45)
        if push.returncode != 0:
            print("GIT_ERROR: push failed: " + (push.stderr.strip()[-500:] or str(push.returncode)))
            return False
        print("GIT_OK: pushed manifest update")
        return True
    except Exception as e:
        print("GIT_ERROR: " + str(e))
        return False
    finally:
        if GH_TOKEN:
            subprocess.run(["git", "remote", "set-url", "origin", "https://github.com/timothygaer/garybudgets-command-center.git"],
                           cwd=str(REPO_DIR), capture_output=True, text=True, timeout=5, check=False)


def create_single_container(url, caption, token):
    r = requests.post(BASE + "/media", json={"image_url": url, "caption": caption, "access_token": token}, timeout=30)
    data = r.json()
    if "id" not in data:
        raise RuntimeError("Single-image container failed: " + json.dumps(data))
    return data["id"]


def create_carousel_container(urls, caption, token):
    child_ids = []
    for i, url in enumerate(urls, 1):
        r = requests.post(BASE + "/media", json={"image_url": url, "is_carousel_item": True, "access_token": token}, timeout=30)
        data = r.json()
        if "id" not in data:
            raise RuntimeError("Slide " + str(i) + " failed: " + json.dumps(data))
        child_ids.append(data["id"])
        print("  Slide " + str(i) + ": " + data["id"])
        time.sleep(1)
    time.sleep(3)
    r = requests.post(BASE + "/media", json={"media_type": "CAROUSEL", "children": ",".join(child_ids), "caption": caption, "access_token": token}, timeout=30)
    data = r.json()
    if "id" not in data:
        raise RuntimeError("Carousel container failed: " + json.dumps(data))
    return data["id"]


def create_reel_container(video_url, caption, token, cover_url=None):
    body = {"media_type": "REELS", "video_url": video_url, "caption": caption, "share_to_feed": "true", "access_token": token}
    if cover_url:
        body["cover_url"] = cover_url
    r = requests.post(BASE + "/media", json=body, timeout=60)
    data = r.json()
    if "id" not in data:
        raise RuntimeError("Reel container failed: " + json.dumps(data))
    return data["id"]


def wait_reel_finished(container_id, token, timeout=1500):
    deadline = time.time() + timeout
    last_status = "IN_PROGRESS"
    while time.time() < deadline:
        try:
            r = requests.get(BASE + "/" + container_id + "?fields=status_code&access_token=" + token, timeout=30)
            data = r.json()
            last_status = data.get("status_code", last_status)
        except Exception:
            time.sleep(10)
            continue
        if last_status == "FINISHED":
            print("  Reel container FINISHED")
            return
        if last_status in ("ERROR", "EXPIRED"):
            raise RuntimeError("Reel container failed: " + json.dumps(data))
        time.sleep(10)
    raise RuntimeError("Reel container still " + last_status + " after " + str(timeout) + "s")


def publish_container(container_id, token):
    time.sleep(10)
    r = requests.post(BASE + "/media_publish", json={"creation_id": container_id, "access_token": token}, timeout=30)
    data = r.json()
    if "id" not in data:
        raise RuntimeError("Publish failed: " + json.dumps(data))
    return data["id"]


def get_permalink(media_id, token):
    time.sleep(2)
    r = requests.get("https://graph.instagram.com/v21.0/" + media_id + "?fields=id,permalink,timestamp,media_type&access_token=" + token, timeout=15)
    data = r.json()
    if data.get("error") or not data.get("permalink"):
        raise RuntimeError("Published media verification failed: " + json.dumps(data))
    return data.get("permalink", ""), data.get("timestamp", "")


def main():
    args = parse_args()
    lock_file = acquire_local_lock(args.post_id)
    if lock_file is None:
        return 0
    try:
        sync_repo_before_publish()
        manifest = load_manifest()
        post = select_post(manifest, args.post_id, force=args.force, max_catchup_hours=args.max_catchup_hours)
        if not post:
            return 0

        post_id = post["id"]
        sched = post.get("proposed_schedule") or post.get("original_schedule") or "unknown"
        content_type = resolve_content_type(post)
        assets = validate_assets_for_type(post, content_type)

        print(f"SELECTED: {post_id} — {post.get('title', '')}")
        print(f"SCHEDULE: {sched}")
        print(f"CONTENT_TYPE: {content_type} (pipeline: {content_type})")
        if content_type == "reel":
            print("MEDIA: reel video " + assets["video_url"])
        else:
            print(f"MEDIA: {len(assets)} image(s), mode={content_type}")
            for i, url in enumerate(assets, 1):
                print(f"  {i}. {url}")

        if args.dry_run:
            print("DRY_RUN_OK: selection + type + assets validated; no Instagram calls made")
            return 0

        token = read_token()
        live_match = find_live_match(post, token)
        if live_match:
            mark_posted_from_live_match(manifest, post, live_match)
            return 0

        caption = (post.get("caption", "") + "\n\n" + post.get("hashtags", "")).strip()

        try:
            if content_type == "reel":
                print("Creating reel container...")
                container_id = create_reel_container(assets["video_url"], caption, token, assets.get("cover_url") or None)
                wait_reel_finished(container_id, token)
            elif content_type == "image":
                print("Creating single-image container...")
                container_id = create_single_container(assets[0], caption, token)
            else:
                print("Creating carousel containers...")
                container_id = create_carousel_container(assets, caption, token)
            print("Container: " + container_id)
            media_id = publish_container(container_id, token)
            permalink, timestamp = get_permalink(media_id, token)
        except Exception as e:
            fail("Publishing " + post_id + " failed: " + str(e))

        post["status"] = "posted"
        post["posted_at"] = timestamp or time.strftime("%Y-%m-%dT%H:%M:%S+0000", time.gmtime())
        post["instagram_url"] = permalink
        post["instagram_media_id"] = media_id
        MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))

        print("RESULT:posted " + post_id + " " + permalink)
        print("Title: " + post.get("title", ""))

        if not commit_and_push(post_id, post.get("title", "")):
            alert_deduped("sync:" + post_id, "⚠️ " + post_id + " was PUBLISHED to Instagram (" + permalink + ") but the manifest sync to GitHub failed. Check publish.log.")
            print("POSTED_BUT_NOT_SYNCED: Instagram succeeded, but GitHub/Vercel manifest sync failed")
            sys.exit(2)
    except SystemExit:
        raise
    except Exception as e:
        fail("Unexpected error: " + str(e))


if __name__ == "__main__":
    main()
