"""
Verifier — independent quality gate (shared across platforms).

Implements the "verification-agent gate" rule: a fresh-context agent (or the
parent orchestrating agent acting as a strict reviewer) must actually LOOK at the
deliverable against our rules before a post is marked done. A shallow check
(HTTP 200 / file size) is NOT verification.

This module provides the deterministic scaffolding (montage build, expected-content
checklist, verdict record). The actual vision inspection is executed by a frontier
agent via delegate_task (montage = 1 vision call covers all slides).
"""
from __future__ import annotations

import json
import os

REPO = "/Users/dit/workspace/garybudgets-command-center"
MONTAGES = "/tmp/gb_montages"

# The rules the verifier enforces, per platform. Shared, human-readable contract.
# "technical" is enforced by the deterministic reel_qa gate (never by the builder);
# the rest by the independent frontier verifier agent.
RULES = {
    "carousel": {
        "slide_count": 6,
        "checks": [
            "headline matches expected copy",
            "REAL substantive educational bullets visible (NOT just headings/empty labels)",
            "text is readable on mobile",
            "slide 6 shows garybudgets.com CTA",
            "no fake UI / product screenshots",
            "no repeated/recycled images across slides",
        ],
    },
    "reel": {
        "slide_count": 6,
        "checks": [
            "headline/text readable within safe margins (12%-85% vertical)",
            "REAL substantive content per scene (NOT bare backgrounds)",
            "final scene shows garybudgets.com + 'SAVE THIS'",
            "no fake UI / product screenshots",
            "no readable gibberish AI text in backgrounds",
        ],
        "technical": [
            "moov atom near the START (faststart, < 5%) — else Instagram sits IN_PROGRESS forever",
            "resolution 1080x1920 (9:16)",
            "video h264, 4:2:0 (yuv420p/yuvj420p)",
            "audio aac",
            "duration <= 90s",
            "file size sane (< 650MB)",
        ],
    },
}


def expected_for(post: dict, platform_key: str) -> dict:
    """Build the expected-content contract a verifier checks against."""
    return {
        "post_id": post.get("id"),
        "platform": platform_key,
        "rules": RULES.get(platform_key, RULES["carousel"]),
        # The write-agent fills per-slide expected copy here before verify runs.
        "expected_slides": post.get("slides", []),
    }


def montage_path(post_id: str) -> str:
    return os.path.join(MONTAGES, f"{post_id}.png")


def record_verdict(post_id: str, verdicts: list[dict], passed: bool, notes: str = "") -> str:
    """Persist a verification result. Returns the report path."""
    out = f"/tmp/gb_verdicts/{post_id}.json"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump({
            "post_id": post_id,
            "passed": passed,
            "verdicts": verdicts,
            "notes": notes,
        }, f, indent=2)
    return out


def verify_reel_technical(mp4_path: str) -> dict:
    """
    Deterministic Instagram technical-compliance gate for a reel MP4.

    Runs the standalone reel_qa module (NEVER the builder's self-report) against
    the shared technical contract. Returns {passed, checks} where passed=False
    means the reel MUST NOT be deployed.
    """
    from scripts.gb_agents import reel_qa
    results = reel_qa.check(mp4_path)
    return {"passed": reel_qa.passed(results), "checks": results}
