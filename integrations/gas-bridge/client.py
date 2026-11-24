#!/usr/bin/env python3
"""Client for the Hermes ↔ Google Apps Script bridge.

Replaces the OAuth client (`~/.hermes/google_token.json`) that kept expiring.
No tokens, no refresh, no 7-day expiry: the script runs as the user.

Config: ~/.hermes/gas_bridge.json
    {"url": "https://script.google.com/macros/s/.../exec", "secret": "..."}

Library use:
    from gas_bridge import call
    call("drive.list", folderId="...")
    call("sheets.read", spreadsheetId="...", range="A1:E20")

CLI:
    gas_bridge.py ping
    gas_bridge.py raw '{"action":"drive.list","params":{"pageSize":5}}'
    gas_bridge.py drive-search --name budget
    gas_bridge.py sheets-read --id <sheet> --range A1:E20
    gas_bridge.py gmail-search --query "is:unread" --max 5
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

CONFIG = os.path.expanduser("~/.hermes/gas_bridge.json")


def load_config():
    if not os.path.exists(CONFIG):
        raise SystemExit(f"missing {CONFIG} — deploy the script and write the url+secret there")
    cfg = json.load(open(CONFIG))
    if not cfg.get("url") or "PASTE" in cfg["url"]:
        raise SystemExit("gas_bridge.json has no url yet — deploy the web app and paste the /exec URL")
    return cfg


def call(action, retries=3, timeout=120, **params):
    cfg = load_config()
    payload = json.dumps({"k": cfg["secret"], "action": action, "params": params}).encode()
    last = None
    for attempt in range(1, retries + 1):
        req = urllib.request.Request(
            cfg["url"], data=payload,
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read().decode())
            if not data.get("ok"):
                raise RuntimeError(data.get("error", "unknown error"))
            return data.get("result")
        except urllib.error.HTTPError as e:
            last = RuntimeError(f"HTTP {e.code}: {e.read()[:200]}")
        except Exception as e:  # transient html redirect / network
            last = e
        if attempt < retries:
            time.sleep(2 * attempt)
    raise last


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("ping")
    r = sub.add_parser("raw")
    r.add_argument("json")
    d = sub.add_parser("drive-list")
    d.add_argument("--folder")
    d.add_argument("--query")
    d.add_argument("--page-size", type=int, default=25)
    s = sub.add_parser("drive-search")
    s.add_argument("--name", required=True)
    m = sub.add_parser("drive-mkdir")
    m.add_argument("--name", required=True)
    m.add_argument("--parent")
    sh = sub.add_parser("sheets-read")
    sh.add_argument("--id", required=True)
    sh.add_argument("--range")
    sw = sub.add_parser("sheets-write")
    sw.add_argument("--id", required=True)
    sw.add_argument("--range", required=True)
    sw.add_argument("--values", help="JSON 2D array")
    g = sub.add_parser("gmail-search")
    g.add_argument("--query", default="in:inbox")
    g.add_argument("--max", type=int, default=10)
    c = sub.add_parser("cal-list")
    c.add_argument("--days", type=int, default=7)
    a = ap.parse_args()

    if a.cmd == "ping":
        out = call("ping")
    elif a.cmd == "raw":
        req = json.loads(a.json)
        out = call(req["action"], **(req.get("params") or {}))
    elif a.cmd == "drive-list":
        out = call("drive.list", folderId=a.folder, query=a.query, pageSize=a.page_size)
    elif a.cmd == "drive-search":
        out = call("drive.search", name=a.name)
    elif a.cmd == "drive-mkdir":
        out = call("drive.mkdir", name=a.name, parentId=a.parent)
    elif a.cmd == "sheets-read":
        out = call("sheets.read", spreadsheetId=a.id, range=a.range)
    elif a.cmd == "sheets-write":
        out = call("sheets.write", spreadsheetId=a.id, range=a.range, values=json.loads(a.values))
    elif a.cmd == "gmail-search":
        out = call("gmail.search", query=a.query, max=a.max)
    elif a.cmd == "cal-list":
        now = time.time()
        out = call("calendar.list", timeMin=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
                   timeMax=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now + a.days * 86400)))

    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
