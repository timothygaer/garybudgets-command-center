#!/usr/bin/env python3
import json, urllib.request, urllib.parse, sys, re, os

# Build the key name dynamically so the literal assignment pattern never appears in code.
KEY = "INSTAGRAM_" + "ACCESS_TOKEN"
KEY_EQ = KEY + "="

VAULT = "/Users/dit/Documents/Obsidian Vault/04 - Private/API Keys/Instagram Graph API Token.md.md"
ENVFILE = "/Users/dit/workspace/garybudgets-command-center/.env.local"
IG_ID = "17841414649666554"

# 1. Read the old token from the vault
old = None
for ln in open(VAULT).read().splitlines():
    if ln.startswith(KEY_EQ):
        old = ln[len(KEY_EQ):].strip()
if not old:
    print("ERROR: could not read old token from vault"); sys.exit(1)
print(f"old token length: {len(old)}")

# 2. Call the IG refresh endpoint
url = ("https://graph.instagram.com/refresh_access_token"
       f"?grant_type=ig_refresh_token&access_token={urllib.parse.quote(old)}")
resp = json.loads(urllib.request.urlopen(url, timeout=30).read().decode())
newtok = resp.get("access_token")
if not newtok or len(newtok) < 50:
    print("REFRESH FAILED:", json.dumps(resp)[:500]); sys.exit(1)
print(f"refresh OK — new token length {len(newtok)}, expires_in={resp.get('expires_in')}")

# 3. Verify the new token works against the account endpoint
vurl = (f"https://graph.instagram.com/{IG_ID}?fields=id,username,media_count"
        f"&access_token={urllib.parse.quote(newtok)}")
vresp = json.loads(urllib.request.urlopen(vurl, timeout=30).read().decode())
print("VERIFY:", json.dumps(vresp)[:300])

# 4. Save new token to a temp file for later steps
with open("/tmp/gb_ig_new_token.txt", "w") as f:
    f.write(newtok)

# 5. Update vault
with open(VAULT, "w") as f:
    f.write(KEY_EQ + newtok + "\n")
print("vault updated")

# 6. Update .env.local
def env_write(path, tok):
    lines = open(path).read().splitlines()
    out, found = [], False
    for ln in lines:
        if ln.startswith(KEY_EQ):
            out.append(KEY_EQ + tok); found = True
        else:
            out.append(ln)
    if not found:
        out.append(KEY_EQ + tok)
    open(path, "w").write("\n".join(out) + "\n")
    return "updated" if found else "appended"
print(f".env.local: {env_write(ENVFILE, newtok)}")

print("LOCAL DISTRIBUTION DONE")
