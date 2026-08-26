#!/usr/bin/env python3
"""
Auto-refresh the Instagram long-lived access token 48h before it expires.

Canonical refresher = the Oracle VM (always-on). Run via VM cron daily.
If the token is expiring within REFRESH_WINDOW_HOURS (48h) of its 60-day life,
this refreshes it via the IG Graph API, rewrites the local token file, records
the refresh timestamp in a sidecar state file, and notifies Telegram.

Safe to run every day: it is a no-op unless the token is near expiry.

Compatible with gb-publish.py's read_token() (which does raw.split("=",1)[1]),
so the token file keeps the single-line  KEY=VALUE  format (no comment lines).
"""
import os, sys, json, time, datetime, urllib.request, urllib.parse

KEY = "INSTAGRAM_" + "ACCESS_TOKEN"
TOKEN_LIFE_DAYS = 60
REFRESH_WINDOW_HOURS = 48          # refresh when within this many hours of expiry

home = str(os.path.expanduser("~"))
if home == "/Users/dit":           # Mac reference copy (for manual runs)
    TOKEN_PATH = home + "/Documents/Obsidian Vault/04 - Private/API Keys/Instagram Graph API Token.md.md"
    STATE_PATH = home + "/.hermes/gb_ig_token_refreshed_at"
else:                              # Oracle VM (canonical)
    TOKEN_PATH = home + "/garybudgets/scripts/ig_token.txt"
    STATE_PATH = home + "/garybudgets/scripts/ig_token_refreshed_at"


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def read_token():
    raw = open(TOKEN_PATH).read()
    if "=" not in raw:
        raise RuntimeError("token file format invalid (expected KEY=VALUE)")
    tok = raw.split("=", 1)[1].strip()
    if not tok:
        raise RuntimeError("empty token")
    return tok


def last_refresh_epoch():
    """Epoch of the last recorded refresh. Falls back to token-file mtime."""
    try:
        return float(open(STATE_PATH).read().strip())
    except Exception:
        pass
    try:
        return os.path.getmtime(TOKEN_PATH)
    except Exception:
        return None


def refresh(token):
    url = ("https://graph.instagram.com/refresh_access_token"
           f"?grant_type=ig_refresh_token&access_token={urllib.parse.quote(token)}")
    data = json.loads(urllib.request.urlopen(url, timeout=30).read().decode())
    newtok = data.get("access_token")
    if not newtok or len(newtok) < 50:
        raise RuntimeError("refresh failed: " + json.dumps(data)[:300])
    return newtok, data.get("expires_in")


def notify_telegram(msg):
    try:
        tok = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
        if not tok or not chat:
            return
        body = urllib.parse.urlencode({
            "chat_id": chat, "text": msg,
            "disable_web_page_preview": "true",
        }).encode()
        urllib.request.urlopen(
            "https://api.telegram.org/bot" + tok + "/sendMessage",
            data=body, timeout=20)
    except Exception as e:
        print("telegram notify failed (non-fatal):", e)


def main():
    token = read_token()
    last = last_refresh_epoch()
    now = time.time()
    if last is None:
        # No state; assume the token file was just written (mtime fallback above
        # usually catches this). Refresh once to establish a known baseline.
        expiry = now + TOKEN_LIFE_DAYS * 86400
        due = True
        days_left = TOKEN_LIFE_DAYS
    else:
        expiry = last + TOKEN_LIFE_DAYS * 86400
        due = now >= expiry - REFRESH_WINDOW_HOURS * 3600
        days_left = (expiry - now) / 86400

    if not due:
        print(f"{now_iso()} token ok: {days_left:.1f} days left; no refresh needed")
        return

    print(f"{now_iso()} token expiring in {days_left:.1f}d — refreshing...")
    newtok, expires_in = refresh(token)
    with open(TOKEN_PATH, "w") as f:
        f.write(KEY + "=" + newtok + "\n")
    os.chmod(TOKEN_PATH, 0o600)
    with open(STATE_PATH, "w") as f:
        f.write(str(int(now)))
    print(f"{now_iso()} refreshed: new token len {len(newtok)}, expires_in={expires_in}, state written")
    notify_telegram("✅ Gary Budgets IG access token auto-refreshed (valid 60 more days). Posting unaffected.")


if __name__ == "__main__":
    main()
