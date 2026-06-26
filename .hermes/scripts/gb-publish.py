#!/usr/bin/env python3
"""
Gary Budgets Instagram Publisher — zero-token script.
Posts a pre-configured carousel to Instagram via the Graph API.
Called by cron jobs with POST_ID as the argument.
After posting, the updated manifest is committed and pushed to git
so Vercel picks up the status change.
"""
import json, os, sys, time, requests, subprocess
from pathlib import Path
from datetime import datetime

home = str(Path.home())
MANIFEST = Path(home + "/workspace/garybudgets-command-center/manifest.json")
TOKEN_PATH = Path(os.environ.get("GB_TOKEN_PATH", home + "/Documents/Obsidian Vault/Private/API Keys/Instagram Graph API Token.md.md"))
REPO_DIR = Path(home + "/workspace/garybudgets-command-center")
IG_ID = "17841414649666554"
BASE = "https://graph.instagram.com/v21.0/" + IG_ID


def commit_and_push(post_id, post_title):
    """Commit the updated manifest to git so Vercel picks it up."""
    try:
        subprocess.run(["git", "add", "manifest.json"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=15)
        msg = "auto: Post " + post_id + " '" + post_title + "' published [" + datetime.now().strftime('%Y-%m-%d %H:%M %Z') + "]"
        subprocess.run(["git", "commit", "-m", msg], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=15)
        result = subprocess.run(["git", "push"], cwd=str(REPO_DIR), capture_output=True, text=True, timeout=30)
        st = result.stdout.strip()
        print("GIT: " + (st[-100:] if st else "pushed"))
        if result.returncode != 0:
            err = result.stderr.strip()
            print("GIT_WARN: " + (err[-200:] if err else str(result.returncode)))
    except Exception as e:
        print("GIT_WARN: " + str(e))


def main():
    post_id = sys.argv[1] if len(sys.argv) > 1 else ""
    if not post_id:
        print("ERROR: POST_ID required as argument")
        sys.exit(1)

    if not MANIFEST.exists():
        print("ERROR: No manifest at " + str(MANIFEST))
        sys.exit(1)

    manifest = json.loads(MANIFEST.read_text())
    post = None
    for p in manifest["posts"]:
        if p["id"] == post_id:
            post = p
            break
    if not post:
        print("ERROR: Post " + post_id + " not found in manifest")
        sys.exit(1)

    if post.get("status") == "posted":
        print("SKIP: " + post_id + " already posted")
        return 0

    if not TOKEN_PATH.exists():
        print("ERROR: Token file not found at " + str(TOKEN_PATH))
        sys.exit(1)

    raw = TOKEN_PATH.read_text()
    if "=" not in raw:
        print("ERROR: Token format invalid — expected key=VALUE")
        sys.exit(1)
    ig_token = raw.split("=", 1)[1].strip()
    if not ig_token:
        print("ERROR: Empty token")
        sys.exit(1)

    image_urls = post.get("image_urls", [])
    if not image_urls:
        print("ERROR: No image_urls for " + post_id)
        sys.exit(1)

    caption = post.get("caption", "") + "\n\n" + post.get("hashtags", "")

    # Step 1: Create individual media containers
    print("Creating carousel containers...")
    container_ids = []
    for i, url in enumerate(image_urls, 1):
        r = requests.post(
            BASE + "/media",
            json={"image_url": url, "is_carousel_item": True, "access_token": ig_token},
            timeout=30,
        )
        data = r.json()
        if "id" not in data:
            err_str = json.dumps(data)
            if "expired" in err_str.lower():
                print("ERROR: Token expired. " + err_str)
            else:
                print("ERROR: Slide " + str(i) + " failed: " + err_str)
            sys.exit(1)
        container_ids.append(data["id"])
        print("  Slide " + str(i) + ": " + data["id"])
        time.sleep(1)

    # Step 2: Create carousel
    print("Creating carousel container...")
    time.sleep(3)
    r = requests.post(
        BASE + "/media",
        json={
            "media_type": "CAROUSEL",
            "children": ",".join(container_ids),
            "caption": caption,
            "access_token": ig_token,
        },
        timeout=30,
    )
    carousel = r.json()
    if "id" not in carousel:
        print("ERROR: Carousel failed: " + json.dumps(carousel))
        sys.exit(1)
    print("Carousel: " + carousel["id"])

    # Step 3: Publish
    print("Waiting 10s...")
    time.sleep(10)
    r = requests.post(
        BASE + "/media_publish",
        json={"creation_id": carousel["id"], "access_token": ig_token},
        timeout=30,
    )
    pub = r.json()
    if "id" not in pub:
        print("ERROR: Publish failed: " + json.dumps(pub))
        sys.exit(1)

    # Get permalink
    time.sleep(2)
    r = requests.get(BASE + "/" + pub["id"] + "?fields=id,permalink&access_token=" + ig_token, timeout=15)
    perm = r.json()
    url = perm.get("permalink", "")

    post["status"] = "posted"
    post["posted_at"] = time.strftime("%Y-%m-%dT%H:%M:%S+0000", time.gmtime())
    post["instagram_url"] = url
    post["instagram_media_id"] = pub["id"]
    MANIFEST.write_text(json.dumps(manifest, indent=2))

    print("RESULT:posted " + post_id + " " + url)
    print("Title: " + post["title"])

    # Push to git so Vercel knows this post was published
    commit_and_push(post_id, post.get("title", ""))


if __name__ == "__main__":
    main()
