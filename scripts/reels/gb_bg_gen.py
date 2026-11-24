#!/usr/bin/env python3
"""Generate reel background stills with ChatGPT web, driving the user's real Chrome.

Restored 2026-11-24: the original helper lived in a pruned scratch dir and was lost.

Why this exists: `chatgpt-imagegen --backend web` reports a false login wall, and the
chatgpt/image site adapter times out on 9:16 prompts. This drives the composer directly.

Usage:
  python3 scripts/reels/gb_bg_gen.py --prompt-file path/to/prompt.txt --out public/reels/bg/<slug>/01.jpg
  python3 scripts/reels/gb_bg_gen.py --prompt "..." --out ... --timeout 420
  python3 scripts/reels/gb_bg_gen.py --batch scripts/reels/<slug>/prompts   # 01.txt, 02.txt, ...

Behaviour:
  - idempotent: skips when --out already exists and is >= 500 KB
  - sleeps --gap seconds between generations (default 45) to stay under ChatGPT rate limits
  - saves whatever ChatGPT returns (PNG ~941x1672 even for "JPEG" requests); the compositor
    cover-fits to 1080x1920, so the exact pixel size does not matter
"""
import argparse
import glob
import os
import subprocess
import sys
import time

PATH = "/Users/dit/.local/bin:/usr/local/bin:/opt/homebrew/bin:" + os.environ.get("PATH", "")
ENV = dict(os.environ, PATH=PATH)
SESSION = "chatgpt-web"
COMPOSER = "div.ProseMirror"


def run(args, timeout=180, check=False):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=ENV)
    if check and r.returncode != 0:
        raise SystemExit(f"command failed: {' '.join(args[:3])}\n{r.stdout[-500:]}\n{r.stderr[-500:]}")
    return r


def cu(*args, timeout=180):
    return run(["chrome-use", "--session", SESSION, *args], timeout=timeout)


def wait_composer(tries=30):
    for _ in range(tries):
        r = cu("eval", f"(() => !!document.querySelector('{COMPOSER}'))()")
        if "true" in r.stdout.lower():
            return True
        time.sleep(2)
    return False


def count_images():
    r = cu("eval", "(() => document.querySelectorAll('img[alt=\"Generated image\"], "
                   "img[src^=\"blob:\"], img[src*=\"oaiusercontent\"]').length)()")
    digits = "".join(ch for ch in r.stdout.strip().splitlines()[-1] if ch.isdigit())
    return int(digits) if digits else 0


def newest_src():
    r = cu("eval", "(() => { const a=[...document.querySelectorAll('img')].filter("
                   "i=>/oaiusercontent|blob:/.test(i.src)); return a.length ? a[a.length-1].src : ''; })()")
    line = r.stdout.strip().splitlines()[-1].strip()
    if line.startswith('"') and line.endswith('"'):
        line = line[1:-1]
    return line


def generate(prompt, out, timeout=420, baseline=None):
    out = os.path.abspath(out)
    if os.path.exists(out) and os.path.getsize(out) >= 500_000:
        print(f"skip (exists, {os.path.getsize(out)//1024} KB): {out}")
        return True
    os.makedirs(os.path.dirname(out), exist_ok=True)

    cu("open", "https://chatgpt.com/", timeout=120)
    if not wait_composer():
        print("composer never appeared (logged out?)", file=sys.stderr)
        return False

    base = count_images() if baseline is None else baseline
    tmp = os.path.join("/tmp", "gb_bg_prompt.txt")
    with open(tmp, "w") as f:
        f.write(prompt)
    cu("fill", COMPOSER, "--file", tmp, timeout=120)
    time.sleep(1)
    cu("press", "Enter", "--selector", COMPOSER, timeout=120)
    print("prompt sent; waiting for image…")

    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(8)
        if count_images() > base:
            src = newest_src()
            if src:
                time.sleep(3)  # let the blob settle
                d = cu("download-url", src, out, timeout=180)
                if os.path.exists(out) and os.path.getsize(out) > 200_000:
                    print(f"saved {out} ({os.path.getsize(out)//1024} KB)")
                    return True
                print("download failed:", (d.stdout or d.stderr)[-300:], file=sys.stderr)
        print("  …still generating")
    print(f"timed out after {timeout}s", file=sys.stderr)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt")
    ap.add_argument("--prompt-file")
    ap.add_argument("--out")
    ap.add_argument("--batch", help="dir of NN.txt prompt files")
    ap.add_argument("--out-dir", help="output dir for --batch")
    ap.add_argument("--timeout", type=int, default=420)
    ap.add_argument("--gap", type=int, default=45)
    a = ap.parse_args()

    if a.batch:
        if not a.out_dir:
            sys.exit("--batch needs --out-dir")
        files = sorted(glob.glob(os.path.join(a.batch, "*.txt")))
        if not files:
            sys.exit(f"no .txt prompts in {a.batch}")
        ok = 0
        for i, f in enumerate(files):
            out = os.path.join(a.out_dir, os.path.splitext(os.path.basename(f))[0] + ".jpg")
            if generate(open(f).read().strip(), out, a.timeout):
                ok += 1
            if i < len(files) - 1:
                time.sleep(a.gap)
        print(f"\n{ok}/{len(files)} images ready")
        return 0 if ok == len(files) else 1

    prompt = a.prompt
    if a.prompt_file:
        prompt = open(a.prompt_file).read().strip()
    if not prompt or not a.out:
        sys.exit("need --prompt/--prompt-file and --out")
    return 0 if generate(prompt, a.out, a.timeout) else 1


if __name__ == "__main__":
    sys.exit(main())
