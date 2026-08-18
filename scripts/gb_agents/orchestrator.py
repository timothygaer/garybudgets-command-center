"""
Gary Budgets Agent Workflow — orchestrator / router.

The orchestrator is the single entry point. It:
  1. Reads the authoritative queue from the live API (never local file).
  2. Filters to posts that need building (per user's platform + approval-gate rules).
  3. Routes each post to the correct platform specialist via the registry.
  4. Tracks job state so you can see "what each agent is working on" in the UI later.
  5. Coordinates build → verify → deploy-ready (NEVER approves on the user's behalf).

Usage:
    python3 -m scripts.gb_agents.orchestrator --plan          # dry-run: show the work order
    python3 -m scripts.gb_agents.orchestrator --list-platforms
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime

# Allow running as `python3 -m scripts.gb_agents.orchestrator` from repo root.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from scripts.gb_agents.registry import PLATFORMS, resolve  # noqa: E402

QUEUE_API = "https://garybudgets-command-center.vercel.app/api/queue"
STATE_FILE = os.path.join(os.path.dirname(__file__), "state.json")

# Statuses that mean "this post still needs building" (user approval gate is separate).
BUILDABLE_STATUSES = {"draft", "ready", "awaiting_images", "pending"}


def fetch_queue() -> list[dict]:
    """Authoritative queue from the live API."""
    with urllib.request.urlopen(QUEUE_API, timeout=60) as r:
        data = json.loads(r.read().decode())
    return data.get("queue", [])


def plan_build(include_statuses=BUILDABLE_STATUSES) -> list[dict]:
    """Return the work order: each queued post routed to a platform specialist."""
    queue = fetch_queue()
    work = []
    for post in queue:
        if post.get("status") not in include_statuses:
            continue
        try:
            platform = resolve(post)
        except KeyError as e:
            work.append({
                "id": post.get("id"), "title": post.get("title"),
                "status": post.get("status"), "route": "ERROR", "reason": str(e),
            })
            continue
        work.append({
            "id": post.get("id"),
            "title": post.get("title"),
            "status": post.get("status"),
            "media_type": platform.key,
            "route": platform.specialist,
            "has_images": post.get("has_images"),
            "aspect": platform.aspect,
        })
    return work


def list_platforms() -> None:
    print("Registered platforms (expandable in registry.py):")
    for key, p in PLATFORMS.items():
        print(f"  {key:<10} -> {p.specialist:<16} assets={p.required_assets} aspect={p.aspect}")


def write_state(work: list[dict]) -> None:
    """Persist job state so a future UI panel can show agent activity."""
    state = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "jobs": work,
        "note": "READ ONLY — orchestrator never approves/schedules/posts. Posts here are Ready-for-user-approval at most.",
    }
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def main() -> int:
    ap = argparse.ArgumentParser(description="Gary Budgets agent-workflow orchestrator")
    ap.add_argument("--plan", action="store_true", help="dry-run: print the work order (no builds)")
    ap.add_argument("--list-platforms", action="store_true", help="show registered platforms")
    ap.add_argument("--status", default=None, help="comma list of statuses to include (default: draft,ready,awaiting_images,pending)")
    args = ap.parse_args()

    if args.list_platforms:
        list_platforms()
        return 0

    statuses = set(s.strip() for s in args.status.split(",")) if args.status else BUILDABLE_STATUSES
    work = plan_build(include_statuses=statuses)

    if not work:
        print("No buildable posts in queue.")
        return 0

    print(f"Work order ({len(work)} posts):")
    for j in work:
        flag = f"  ⚠ {j['reason']}" if j["route"] == "ERROR" else ""
        print(f"  {j['id']}  [{j['route']:<16}] {j['title']}{flag}")

    write_state(work)
    if args.plan:
        print(f"\n[PLAN MODE] No builds executed. Work order written to {STATE_FILE}")
    else:
        print(f"\nWork order written to {STATE_FILE}. Specialists not yet wired for execution.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
