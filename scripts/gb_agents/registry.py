"""
Gary Budgets Agent Workflow — platform registry.

Each platform is a content type the build pipeline can produce. Adding a new
platform (TikTok, YouTube Shorts, X) = add ONE entry here with its specialist
class and asset requirements. Nothing else in the orchestrator changes.
Mirrors scripts/gb-publish.py CONTENT_TYPES so routing stays consistent with
the publisher.
"""
from __future__ import annotations


class Platform:
    def __init__(self, key, label, specialist, required_assets, aspect):
        self.key = key                     # media_type value (carousel, reel, tiktok...)
        self.label = label
        self.specialist = specialist       # agent class name in agents/
        self.required_assets = required_assets  # human description
        self.aspect = aspect               # "4:5", "9:16", ...

    def __repr__(self):
        return f"<Platform {self.key} -> {self.specialist}>"


# ---------------------------------------------------------------------------
# REGISTRY — the single place to add a new platform.
#   To add TikTok later:
#     from agents.tiktok_agent import TiktokAgent
#     PLATFORMS["tiktok"] = Platform("tiktok", "TikTok", TiktokAgent, "video_url", "9:16")
# ---------------------------------------------------------------------------
PLATFORMS: dict[str, Platform] = {
    "carousel": Platform(
        key="carousel", label="Instagram Carousel",
        specialist="CarouselAgent", required_assets="2-10 image URLs", aspect="4:5",
    ),
    "reel": Platform(
        key="reel", label="Instagram Reel",
        specialist="ReelAgent", required_assets="video_url (+ cover)", aspect="9:16",
    ),
    # "tiktok": Platform("tiktok", "TikTok", TiktokAgent, "video_url", "9:16"),
    # "shorts": Platform("shorts", "YouTube Shorts", ShortsAgent, "video_url", "9:16"),
}

# Alias for readability / forward-compat.
SUPPORTED = set(PLATFORMS)


def resolve(post: dict) -> Platform:
    """Resolve which platform a manifest/queue post belongs to.

    Explicit `media_type` wins. Otherwise infer from assets (video_url => reel,
    2+ images => carousel), mirroring gb-publish.py. Unknown/unsupported type
    raises so the orchestrator surfaces it loudly instead of guessing.
    """
    declared = (post.get("media_type") or "").strip().lower()
    if declared:
        if declared not in PLATFORMS:
            raise KeyError(
                f"post {post.get('id')} media_type={declared!r} not in registry "
                f"{sorted(PLATFORMS)}; add it to PLATFORMS in registry.py to build it"
            )
        return PLATFORMS[declared]

    if post.get("video_url"):
        return PLATFORMS["reel"]
    # Drafts awaiting build: infer from the established "-reel" ID suffix used by
    # write-selection for reel siblings (carousel is the default).
    post_id = (post.get("id") or "").lower()
    if post_id.endswith("-reel"):
        return PLATFORMS["reel"]
    urls = [u for u in (post.get("image_urls") or []) if u]
    if len(urls) >= 2:
        return PLATFORMS["carousel"]
    if len(urls) == 1:
        return PLATFORMS["carousel"]  # treat single as carousel (publisher routes by count)
    raise KeyError(f"post {post.get('id')} has no media_type, no video_url, and no inferable assets")
