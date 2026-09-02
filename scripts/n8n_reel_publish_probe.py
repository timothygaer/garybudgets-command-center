#!/usr/bin/env python3
"""Local n8n bridge for Gary Budgets Instagram Reel posting tests.

Default mode is DRY RUN. It validates the selected reel, checks public video/cover URLs,
and prints the exact Meta Graph API flow it would use. To actually publish, set
N8N_REEL_DO_PUBLISH=1 in the n8n Execute Command node/environment.

Secrets are read from environment only; never print tokens.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "manifest.json"
BASE = os.environ.get("IG_GRAPH_BASE") or "https://graph.instagram.com/v21.0"
IG_USER_ID = os.environ.get("IG_USER_ID") or "17841414649666554"
TOKEN = os.environ.get("INSTAGRAM_ACCESS_TOKEN") or os.environ.get("META_ACCESS_TOKEN") or ""


def load_posts():
    data = json.loads(MANIFEST.read_text())
    if isinstance(data, dict) and "posts" in data:
        return data["posts"]
    if isinstance(data, list):
        return data
    raise RuntimeError("Unknown manifest format")


def find_post(posts, post_id: str | None):
    reels = [p for p in posts if p.get("video_url")]
    if post_id:
        for p in reels:
            if p.get("id") == post_id:
                return p
        raise RuntimeError(f"No reel found with id={post_id}")
    # Prefer a draft/manual reel with public video_url; otherwise newest reel.
    for p in reversed(reels):
        if p.get("status") in {"draft", "ready"} and p.get("video_url"):
            return p
    if reels:
        return reels[-1]
    raise RuntimeError("No reels with video_url found in manifest")


def check_url(url: str, label: str):
    if not url:
        return {"label": label, "ok": False, "error": "missing"}
    try:
        req = Request(url, method="HEAD", headers={"User-Agent": "GaryBudgets-n8n-probe/1.0"})
        with urlopen(req, timeout=25) as r:
            return {
                "label": label,
                "ok": 200 <= r.status < 400,
                "status": r.status,
                "content_type": r.headers.get("content-type"),
                "content_length": r.headers.get("content-length"),
                "url": url,
            }
    except HTTPError as e:
        return {"label": label, "ok": False, "status": e.code, "error": str(e), "url": url}
    except URLError as e:
        return {"label": label, "ok": False, "error": str(e), "url": url}


def api_post(path: str, body: dict):
    encoded = urlencode(body).encode()
    req = Request(BASE + path, data=encoded, method="POST")
    with urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def api_get(path: str, params: dict):
    url = BASE + path + "?" + urlencode(params)
    with urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode())


def main():
    post_id = os.environ.get("GB_REEL_POST_ID") or (sys.argv[1] if len(sys.argv) > 1 else None)
    do_publish = os.environ.get("N8N_REEL_DO_PUBLISH") == "1"
    posts = load_posts()
    post = find_post(posts, post_id)
    caption = (post.get("caption") or "").strip()
    hashtags = (post.get("hashtags") or "").strip()
    full_caption = (caption + "\n\n" + hashtags).strip()

    result = {
        "mode": "PUBLISH" if do_publish else "DRY_RUN",
        "post_id": post.get("id"),
        "title": post.get("title"),
        "status": post.get("status"),
        "ig_user_id": IG_USER_ID,
        "video_check": check_url(post.get("video_url") or "", "video_url"),
        "cover_check": check_url(post.get("cover_url") or "", "cover_url") if post.get("cover_url") else {"label": "cover_url", "ok": True, "note": "no cover provided"},
        "caption_chars": len(full_caption),
        "would_call": [
            f"POST /{IG_USER_ID}/media media_type=REELS video_url=<public-url> caption=<caption> share_to_feed=true",
            "GET /<container_id>?fields=status_code,status",
            f"POST /{IG_USER_ID}/media_publish creation_id=<container_id>",
        ],
    }

    if not result["video_check"].get("ok"):
        result["ok"] = False
        result["error"] = "Video URL is not reachable; will not publish."
        print(json.dumps(result, indent=2))
        sys.exit(2)

    if not do_publish:
        result["ok"] = True
        result["next_step"] = "Set N8N_REEL_DO_PUBLISH=1 only when Timothy explicitly approves a real publish test."
        print(json.dumps(result, indent=2))
        return

    if not TOKEN:
        raise RuntimeError("INSTAGRAM_ACCESS_TOKEN/META_ACCESS_TOKEN is not set in the n8n environment")

    body = {
        "media_type": "REELS",
        "video_url": post["video_url"],
        "caption": full_caption,
        "share_to_feed": "true",
        "access_token": TOKEN,
    }
    if post.get("cover_url"):
        body["cover_url"] = post["cover_url"]

    container = api_post(f"/{IG_USER_ID}/media", body)
    cid = container.get("id")
    if not cid:
        raise RuntimeError(f"No container id returned: {container}")

    status_history = []
    deadline = time.time() + int(os.environ.get("GB_REEL_WAIT_SECONDS", "3600"))
    while time.time() < deadline:
        st = api_get(f"/{cid}", {"fields": "status_code,status", "access_token": TOKEN})
        status_history.append(st)
        if st.get("status_code") == "FINISHED":
            break
        if st.get("status_code") == "ERROR":
            raise RuntimeError(f"Meta container error: {st}")
        time.sleep(int(os.environ.get("GB_REEL_POLL_SECONDS", "20")))
    else:
        raise RuntimeError(f"Timed out waiting for reel container {cid}; history={status_history[-5:]}")

    published = api_post(f"/{IG_USER_ID}/media_publish", {"creation_id": cid, "access_token": TOKEN})
    result.update({"ok": True, "container_id": cid, "status_history_tail": status_history[-5:], "publish_result": published})
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, indent=2))
        sys.exit(1)
