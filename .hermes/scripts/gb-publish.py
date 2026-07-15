#!/usr/bin/env python3
"""
Gary Budgets Instagram Publisher — Oracle VM version.

Safe publisher rules:
- Optional POST_ID argument. With no POST_ID, selects only approved posts whose schedule is due.
- Schedule-aware: never publishes future approved posts unless --force is passed.
- Dynamic media mode: 1 image => single image post; 2-10 images => carousel.
- Image filtering: uses manifest image_urls or public/images/<POST_ID>/ numeric image files only.
  It never posts prompt/docs/markdown files.
- Supports --dry-run for verification without Instagram side effects.
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
MONTHS = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
          "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
TZ_MAP = {
    "PT": "America/Los_Angeles", "PST": "America/Los_Angeles", "PDT": "America/Los_Angeles",
    "ET": "America/New_York", "EST": "America/New_York", "EDT": "America/New_York",
    "UTC": "UTC",
}


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
        print("ERROR: No manifest at " + str(MANIFEST))
        sys.exit(1)
    return json.loads(MANIFEST.read_text())


def sync_repo_before_publish():
    """Start every publish from origin/main so Oracle cannot post from stale state."""
    if not (REPO_DIR / ".git").exists():
        return
    subprocess.run(["git", "fetch", "origin", "main"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=45, check=False)
    status = subprocess.run(["git", "status", "--porcelain"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=15, check=False)
    if status.stdout.strip():
        raise RuntimeError("Repo has uncommitted changes before publish; refusing to publish from dirty state")
    rebase = subprocess.run(["git", "pull", "--rebase", "origin", "main"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=60)
    if rebase.returncode != 0:
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
            print("ERROR: Post " + post_id + " not found in manifest")
            sys.exit(1)
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


def is_image_url(url):
    try:
        parsed = urlparse(url)
        ext = Path(parsed.path).suffix.lower()
        return parsed.scheme in ("http", "https") and ext in IMAGE_EXTENSIONS
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


def validate_media(post):
    urls = media_urls_for_post(post)
    if not urls:
        raise ValueError("No valid image URLs/files found for " + post.get("id", "?"))
    if len(urls) > 10:
        raise ValueError("Instagram carousel max is 10 images; found " + str(len(urls)) + " for " + post.get("id", "?"))
    return urls


def read_token():
    if not TOKEN_PATH.exists():
        print("ERROR: Token file not found at " + str(TOKEN_PATH))
        sys.exit(1)
    raw = TOKEN_PATH.read_text()
    if "=" not in raw:
        print("ERROR: Token format invalid — expected key=VALUE")
        sys.exit(1)
    token = raw.split("=", 1)[1].strip()
    if not token:
        print("ERROR: Empty token")
        sys.exit(1)
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
    MANIFEST.write_text(json.dumps(manifest, indent=2))
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
    sync_repo_before_publish()
    manifest = load_manifest()
    post = select_post(manifest, args.post_id, force=args.force, max_catchup_hours=args.max_catchup_hours)
    if not post:
        return 0

    post_id = post["id"]
    urls = validate_media(post)
    mode = "single" if len(urls) == 1 else "carousel"
    sched = post.get("proposed_schedule") or post.get("original_schedule") or "unknown"
    print(f"SELECTED: {post_id} — {post.get('title', '')}")
    print(f"SCHEDULE: {sched}")
    print(f"MEDIA: {len(urls)} image(s), mode={mode}")
    for i, url in enumerate(urls, 1):
        print(f"  {i}. {url}")

    if args.dry_run:
        print("DRY_RUN_OK: no Instagram calls made")
        return 0

    token = read_token()
    live_match = find_live_match(post, token)
    if live_match:
        mark_posted_from_live_match(manifest, post, live_match)
        return 0

    caption = (post.get("caption", "") + "\n\n" + post.get("hashtags", "")).strip()

    try:
        if mode == "single":
            print("Creating single-image container...")
            container_id = create_single_container(urls[0], caption, token)
        else:
            print("Creating carousel containers...")
            container_id = create_carousel_container(urls, caption, token)
        print("Container: " + container_id)
        media_id = publish_container(container_id, token)
        permalink, timestamp = get_permalink(media_id, token)
    except Exception as e:
        print("ERROR: " + str(e))
        sys.exit(1)

    post["status"] = "posted"
    post["posted_at"] = timestamp or time.strftime("%Y-%m-%dT%H:%M:%S+0000", time.gmtime())
    post["instagram_url"] = permalink
    post["instagram_media_id"] = media_id
    MANIFEST.write_text(json.dumps(manifest, indent=2))

    print("RESULT:posted " + post_id + " " + permalink)
    print("Title: " + post.get("title", ""))

    if not commit_and_push(post_id, post.get("title", "")):
        print("POSTED_BUT_NOT_SYNCED: Instagram succeeded, but GitHub/Vercel manifest sync failed")
        sys.exit(2)


if __name__ == "__main__":
    main()
