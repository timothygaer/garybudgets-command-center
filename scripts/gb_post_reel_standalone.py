#!/usr/bin/env python3
"""
Hardened standalone reel poster for Gary Budgets — runs on the Oracle VM.

REEL-ONLY. Refuses to run for carousel/image posts (media_type must be "reel"),
so it can never touch the carousel publishing path.

Design (reliable + does NOT interfere with carousels):
  * IG work (create container -> poll FINISHED -> publish -> permalink) runs
    with NO lock held, so it never blocks the 15-min carousel cron.
  * Resume pattern: state files under /tmp, so a network blip or restart picks
    up where it left off instead of re-creating a container.
  * The only manifest.json write ("mark posted") is a SHORT, lock-protected
    pull-apply-commit-push — identical discipline to gb-publish.py, so there is
    no lost update / no Oracle-clobbers-GitHub. If that write fails, the
    reconciler marks the reel posted by caption within 15 min.

Usage (on VM):  python3 gb_post_reel_standalone.py <post_id>
"""
import sys, os, json, time, datetime, urllib.parse, requests, fcntl, subprocess

IG_ID = "17841414649666554"
BASE = "https://graph.instagram.com/v21.0/" + IG_ID
TOKEN_PATH = os.path.expanduser("~") + "/garybudgets/scripts/ig_token.txt"
REPO_DIR = os.path.expanduser("~") + "/garybudgets/repo"
MANIFEST = REPO_DIR + "/manifest.json"
SLUG = None
AUTO_LOCK = "/tmp/gb-publish-auto.lock"   # same lock the carousel cron uses


def token():
    raw = open(TOKEN_PATH).read()
    return raw.split("=", 1)[1].strip()


def state_path(kind):
    return f"/tmp/gb_{SLUG}_{kind}.txt"


def write_state(kind, val):
    with open(state_path(kind), "w") as f:
        f.write(str(val))


def read_state(kind):
    try:
        return open(state_path(kind)).read().strip()
    except Exception:
        return None


def find_post():
    m = json.load(open(MANIFEST))
    for p in m.get("posts", []):
        if p.get("id") == sys.argv[1]:
            return p
    return None


def create_container(post, tok):
    caption = (post.get("caption", "") + "\n\n" + post.get("hashtags", "")).strip()
    body = {"media_type": "REELS", "video_url": post["video_url"],
            "caption": caption, "share_to_feed": "true", "access_token": tok}
    if post.get("cover_url"):
        body["cover_url"] = post["cover_url"]
    r = requests.post(BASE + "/media", json=body, timeout=60)
    data = r.json()
    if "id" not in data:
        raise RuntimeError("create failed: " + json.dumps(data)[:300])
    return data["id"]


def wait_finished(cid, tok, timeout=7200):
    deadline = time.time() + timeout
    last = "IN_PROGRESS"
    while time.time() < deadline:
        try:
            r = requests.get(BASE + "/" + cid + "?fields=status_code&access_token=" + tok, timeout=30)
            data = r.json()
            last = data.get("status_code", last)
            print(datetime.datetime.now().isoformat(), "container status:", last)
        except Exception as e:
            print("poll error (retrying):", e)
            time.sleep(10)
            continue
        if last == "FINISHED":
            return
        if last in ("ERROR", "EXPIRED"):
            raise RuntimeError("container " + last + ": " + json.dumps(data)[:300])
        time.sleep(10)
    raise RuntimeError("container still " + last + " after " + str(timeout) + "s")


def publish(cid, tok):
    time.sleep(10)
    r = requests.post(BASE + "/media_publish", json={"creation_id": cid, "access_token": tok}, timeout=30)
    data = r.json()
    if "id" not in data:
        raise RuntimeError("publish failed: " + json.dumps(data)[:300])
    return data["id"]


def permalink(mid, tok):
    r = requests.get("https://graph.instagram.com/v21.0/" + mid + "?fields=id,permalink,timestamp,media_type&access_token=" + tok, timeout=15)
    data = r.json()
    if data.get("error") or not data.get("permalink"):
        raise RuntimeError("permalink fetch failed: " + json.dumps(data)[:200])
    return data["permalink"], data.get("timestamp", "")


def safe_mark_posted(post, mid, perm, ts):
    """SHORT, lock-protected pull-apply-commit-push. Falls back to the reconciler
    (caption match) if anything fails — this is a best-effort sync only."""
    try:
        lock = open(AUTO_LOCK, "w")
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("AUTO_LOCK held (carousel posting) — skipping manifest write; reconciler will mark posted")
        return False
    try:
        subprocess.run(["git", "pull", "--ff-only", "origin", "main"],
                       cwd=REPO_DIR, capture_output=True, text=True, timeout=30, check=False)
        m = json.load(open(MANIFEST))
        for p in m.get("posts", []):
            if p.get("id") == post["id"]:
                p["status"] = "posted"
                p["posted_at"] = ts or datetime.datetime.now(datetime.timezone.utc).isoformat()
                p["instagram_url"] = perm
                p["instagram_media_id"] = mid
                p["stuck"] = False
                p.pop("stuck_at", None)
                break
        json.dump(m, open(MANIFEST, "w"), indent=2, ensure_ascii=False)
        subprocess.run(["git", "add", "manifest.json"], cwd=REPO_DIR, capture_output=True, text=True, timeout=15, check=False)
        subprocess.run(["git", "commit", "-m", f"auto: reel {post['id']} published [Oracle]"],
                       cwd=REPO_DIR, capture_output=True, text=True, timeout=20, check=False)
        r = subprocess.run(["git", "push"], cwd=REPO_DIR, capture_output=True, text=True, timeout=45)
        if r.returncode != 0:
            print("git push failed (reconciler will still mark posted):", r.stderr.strip()[-300:])
            return False
        print("manifest marked posted + pushed")
        return True
    except Exception as e:
        print("safe_mark_posted failed (reconciler will cover):", e)
        return False
    finally:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
            lock.close()
        except Exception:
            pass


def main():
    global SLUG
    if len(sys.argv) < 2:
        print("usage: gb_post_reel_standalone.py <post_id>"); sys.exit(1)
    post = find_post()
    if not post:
        print("ERROR: post not found"); sys.exit(1)
    if post.get("media_type") != "reel":
        print(f"ERROR: {post['id']} is media_type={post.get('media_type')} — this poster is REEL-ONLY. Aborting (carousel path untouched).")
        sys.exit(1)
    SLUG = post["id"]
    tok = token()
    print("post:", post["id"], "| video:", post.get("video_url"))

    cid = read_state("cid")
    if cid:
        print("resuming with existing container", cid)
    else:
        print("creating container...")
        cid = create_container(post, tok)
        write_state("cid", cid)
        print("container:", cid)

    wait_finished(cid, tok)
    write_state("cid_done", "1")

    mid = read_state("mid")
    if not mid:
        print("publishing...")
        mid = publish(cid, tok)
        write_state("mid", mid)
        print("media_id:", mid)
    else:
        print("already published, media_id", mid)

    perm, ts = read_state("permalink"), read_state("ts")
    if not perm:
        perm, ts = permalink(mid, tok)
        write_state("permalink", perm); write_state("ts", ts)
    print("permalink:", perm)

    safe_mark_posted(post, mid, perm, ts)
    print("DONE — reel posted:", perm)


if __name__ == "__main__":
    main()
