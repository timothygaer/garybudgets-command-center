#!/usr/bin/env python3
"""
Mac-side sync: pull the Oracle VM's current IG token and, if it differs from the
local vault copy, push it to the vault, .env.local, and the Vercel production env.

Runs daily via a Hermes cron. No-op unless the Oracle VM auto-refreshed the token
(which it does ~48h before expiry). The Oracle refresh is the canonical, critical
one (protects posting even if the Mac is off); this keeps the dashboard + local
references fresh.
"""
import subprocess, sys, os, datetime

KEY = "INSTAGRAM_" + "ACCESS_TOKEN"
KEY_EQ = KEY + "="
VAULT = "/Users/dit/Documents/Obsidian Vault/04 - Private/API Keys/Instagram Graph API Token.md.md"
REPO = "/Users/dit/workspace/garybudgets-command-center"
ENVFILE = REPO + "/.env.local"
ORACLE_HOST = "ubuntu@192.9.153.72"
SSH_KEY = os.path.expanduser("~/.ssh/oracle_cloud_ed25519")
LOG = os.path.expanduser("~/.hermes/logs/ig_token_sync.log")


def log(msg):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    ts = datetime.datetime.now().isoformat()
    try:
        with open(LOG, "a") as f:
            f.write(f"{ts} {msg}\n")
    except Exception:
        pass


def read_local():
    try:
        for ln in open(VAULT).read().splitlines():
            if ln.startswith(KEY_EQ):
                return ln[len(KEY_EQ):].strip()
    except Exception:
        pass
    return None


def read_oracle():
    try:
        out = subprocess.run(
            ["ssh", "-i", SSH_KEY, "-o", "ConnectTimeout=20", ORACLE_HOST,
             "cat /home/ubuntu/garybudgets/scripts/ig_token.txt"],
            capture_output=True, text=True, timeout=40).stdout
        for ln in out.splitlines():
            if ln.startswith(KEY_EQ):
                return ln[len(KEY_EQ):].strip()
    except Exception as e:
        print("ssh/oracle read failed:", e)
    return None


def write_env(path, tok):
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


def update_vercel(tok):
    # remove + re-add so the value is actually replaced
    r = subprocess.run(["npx", "vercel", "env", "rm", KEY, "production", "--yes"],
                       cwd=REPO, capture_output=True, text=True, timeout=120)
    r2 = subprocess.run(["npx", "vercel", "env", "add", KEY, "production"],
                        cwd=REPO, input=tok, capture_output=True, text=True, timeout=120)
    return r2.returncode == 0


def main():
    local = read_local()
    oracle = read_oracle()
    if not oracle:
        log("ERROR could not read Oracle token; aborting (retry next run)")
        return  # silent — don't spam; will retry
    if oracle == local:
        log("token in sync; no action needed")
        return  # silent no-op (cron delivers nothing when stdout empty)
    open(VAULT, "w").write(KEY_EQ + oracle + "\n")
    log("vault updated")
    print("vault updated")
    envr = write_env(ENVFILE, oracle)
    log("env.local: " + envr)
    print("env.local:", envr)
    if update_vercel(oracle):
        log("vercel env updated")
        print("vercel env updated")
    else:
        log("vercel env update FAILED (manual intervention needed)")
        print("vercel env update FAILED (manual intervention needed)")
    log("SYNC DONE — token changed and distributed")
    print("SYNC DONE — IG token changed and distributed (vault/.env.local/vercel)")


if __name__ == "__main__":
    main()
