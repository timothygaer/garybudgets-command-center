#!/usr/bin/env python3
"""
Domain-agnostic research agent engine.

Pipeline:  fetch -> normalize -> dedupe -> cluster (trending) -> score -> rank -> emit

A "research agent" is this engine + a config. The config declares what to
watch, what counts as relevant, how to score it, which corpus to dedupe
against, how often to run, and where to deliver. The engine contains no
domain knowledge.

Canonical output schema (schema_version 1) is the integration contract:
any app can consume any agent's output without knowing how it was produced.

Stdlib only by design — nothing to install, nothing to rot on the VM.
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path
from urllib.parse import quote_plus
from xml.etree import ElementTree as ET

SCHEMA_VERSION = 1
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")

STOPWORDS = {
    "film", "films", "movie", "movies", "industry", "latest", "news", "2025",
    "2026", "your", "that", "with", "from", "about", "this", "have", "will",
    "into", "over", "after", "than", "they", "their", "what", "when", "where",
    "which", "been", "more", "most", "some", "such", "only", "also", "just",
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "has",
}


# --------------------------------------------------------------------------
# fetching
# --------------------------------------------------------------------------

def _http(url: str, timeout: float = 12.0) -> str | None:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "Accept-Language": "en-US,en;q=0.9",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            import gzip
            raw = gzip.decompress(raw)
        return raw.decode("utf-8", errors="replace")
    except Exception:
        return None


def _strip_junk(text: str) -> str:
    """Remove characters that are illegal in XML so one bad byte cannot
    kill an entire feed."""
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text or "")


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _first_text(node, *names: str) -> str:
    for want in names:
        for child in node:
            if _localname(child.tag) == want and child.text and child.text.strip():
                return child.text.strip()
    return ""


def _first_link(node) -> str:
    for child in node:
        if _localname(child.tag) != "link":
            continue
        href = child.get("href")
        if href:
            return href.strip()
        if child.text and child.text.strip():
            return child.text.strip()
    return ""


def _parse_date(value: str) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        dt = parsedate_to_datetime(value)
        if dt:
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, IndexError):
        pass
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# --- tolerant parsing -----------------------------------------------------
# Many real feeds declare namespaces they then fail to use (e.g. TheWrap
# emits <media:content> with no xmlns:media), which makes strict XML parsers
# reject the entire document. Try strict XML, then fall back to a
# block-scoped regex scan that only needs the four fields we actually use.

_ITEM_BLOCK = re.compile(r"<(item|entry)\b[^>]*>(.*?)</\1>", re.I | re.S)


def _regex_field(block: str, names: str) -> str:
    m = re.search(rf"<({names})\b[^>]*>(.*?)</\1>", block, re.I | re.S)
    if m and m.group(2).strip():
        return m.group(2).strip()
    m = re.search(rf"<({names})\b[^>]*\bhref=[\"']([^\"']+)[\"']", block, re.I)
    return m.group(2).strip() if m else ""


def _parse_feed_regex(text: str) -> list[dict]:
    out = []
    for m in _ITEM_BLOCK.finditer(text):
        block = m.group(2)
        link = _regex_field(block, "link")
        if not link:
            href = re.search(r"<link\b[^>]*\bhref=[\"']([^\"']+)[\"']", block, re.I)
            link = href.group(1).strip() if href else ""
        out.append({
            "title": _regex_field(block, "title"),
            "url": link,
            "summary": _regex_field(block, "description|summary|content:encoded|content"),
            "published": _parse_date(_regex_field(
                block, "pubDate|published|updated|dc:date")),
        })
    return out


def parse_feed(text: str) -> list[dict]:
    text = _strip_junk(text.strip())
    if not text:
        return []

    try:
        root = ET.fromstring(text)
        if _localname(root.tag) == "feed":
            nodes = [e for e in root if _localname(e.tag) == "entry"]
        else:
            nodes = [e for e in root.iter() if _localname(e.tag) == "item"]
        if nodes:
            return [{
                "title": _first_text(n, "title"),
                "url": _first_link(n),
                "summary": _first_text(n, "description", "summary", "content"),
                "published": _parse_date(_first_text(
                    n, "pubdate", "published", "updated", "date")),
            } for n in nodes]
    except ET.ParseError:
        pass

    return _parse_feed_regex(text)


def fetch_source(src: dict) -> tuple[str, list[dict], str | None]:
    """
    Returns (source_id, signals, error).

    A failure returns error != None and zero signals — callers MUST treat a
    failed source as a COVERAGE GAP, never as "nothing happened".
    """
    url = src.get("url") or ""
    if src.get("query"):
        tmpl = src.get("query_url") or (
            "https://www.bing.com/news/search?q={q}&format=RSS")
        url = tmpl.replace("{q}", quote_plus(src["query"]))
    if not url:
        return src["id"], [], "no url configured"

    body = _http(url, timeout=float(src.get("timeout", 12)))
    if body is None:
        return src["id"], [], "fetch failed (timeout / blocked / non-200)"

    items = parse_feed(body)
    if not items:
        return src["id"], [], "no parseable feed items"

    signals = []
    for it in items:
        title = clean_text(it["title"])
        if len(title) < 18:
            continue
        signals.append({
            "title": title,
            "url": it["url"] or url,
            "source": src["name"],
            "source_id": src["id"],
            "category": src.get("category", "general"),
            "summary": clean_text(it["summary"])[:400],
            "published": it["published"],
        })
    return src["id"], signals, None


def clean_text(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value or "")
    value = unescape(value)
    return re.sub(r"\s+", " ", value).strip()


# --------------------------------------------------------------------------
# dedupe / clustering helpers
# --------------------------------------------------------------------------

def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def token_set(value: str) -> set[str]:
    return {w for w in normalize(value).split()
            if len(w) > 3 and w not in STOPWORDS}


def similarity(a: str, b: str) -> float:
    ta, tb = token_set(a), token_set(b)
    # Short titles (few meaningful tokens) match everything, which creates
    # phantom "trending" clusters and false duplicate hits. Refuse to judge.
    if len(ta) < 4 or len(tb) < 4:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))


def best_match(title: str, corpus: list[str]) -> tuple[float, str]:
    best_s, best_t = 0.0, ""
    for c in corpus:
        s = similarity(title, c)
        if s > best_s:
            best_s, best_t = s, c
            if s >= 0.99:
                break
    return best_s, best_t


def cluster_trending(signals: list[dict], threshold: float = 0.5) -> None:
    """
    Annotate each signal with how many DISTINCT sources are carrying the same
    story. Independent corroboration is the strongest 'this is trending'
    signal we have, and it needs no external API.
    """
    for i, sig in enumerate(signals):
        sources = {sig["source_id"]}
        title = sig["title"]
        for j, other in enumerate(signals):
            if i == j or other["source_id"] in sources:
                continue
            if similarity(title, other["title"]) >= threshold:
                sources.add(other["source_id"])
        sig["trending_sources"] = len(sources)


# --------------------------------------------------------------------------
# corpus — the "already done" list: the only hardcoded-shaped input,
# and it is always read live
# --------------------------------------------------------------------------

def load_corpus(cfg: dict) -> list[str]:
    titles: list[str] = []

    raw_url = cfg.get("dedupe", {}).get("corpus_url")
    if raw_url:
        body = _http(raw_url, timeout=25)
        if body:
            try:
                for post in json.loads(body).get("posts", []):
                    t = str(post.get("title") or "").strip()
                    if t:
                        titles.append(t)
            except json.JSONDecodeError:
                pass

    for path in cfg.get("dedupe", {}).get("corpus_files", []):
        p = Path(path).expanduser()
        if p.exists():
            try:
                for post in json.loads(p.read_text()).get("posts", []):
                    t = str(post.get("title") or "").strip()
                    if t:
                        titles.append(t)
            except (json.JSONDecodeError, OSError):
                pass

    hist = Path(cfg["output"]["history_file"]).expanduser()
    if hist.exists():
        try:
            titles.extend(t for t in json.loads(hist.read_text()).get("titles", []) if t)
        except (json.JSONDecodeError, OSError):
            pass

    return titles


# --------------------------------------------------------------------------
# scoring
# --------------------------------------------------------------------------

def compile_rubric(cfg: dict) -> dict:
    r = cfg.get("rubric", {})
    return {
        "relevance": re.compile(r["relevance_regex"], re.I),
        "finance": re.compile(r["finance_regex"], re.I),
        "rework": re.compile(r.get("rework_regex", r"$^"), re.I),
        "priority": re.compile(r.get("priority_regex", r"$^"), re.I),
        "low_signal": re.compile(r.get("low_signal_regex", r"$^"), re.I),
        "confidence_divisor": float(r.get("confidence_divisor", 120)),
        "boost_terms": r.get("boost_terms", {}),
        "source_weights": r.get("source_weights", {}),
        "recency_points": r.get("recency_points", 12),
        "trending_points": r.get("trending_points", 7),
        "similar_threshold": r.get("similar_threshold", 0.55),
        "duplicate_threshold": r.get("duplicate_threshold", 0.62),
        "min_confidence": r.get("min_confidence", 60),
        "max_confidence": r.get("max_confidence", 96),
    }


def score_signal(sig: dict, corpus: list[str], cfg: dict, rub: dict,
                 now: datetime) -> dict | None:
    blob = f"{sig['title']} {sig['summary']}"

    if not rub["relevance"].search(blob):
        return None

    # Headlines too short to carry real industry substance are feed noise or
    # mangled syndication titles; they cannot be scored or deduped reliably.
    if len(token_set(sig["title"])) < 4:
        return None

    age_days = None
    if sig["published"]:
        age_days = (now - sig["published"]).total_seconds() / 86400
        if age_days > cfg.get("window_days", 14) or age_days < -2:
            return None

    finance = bool(rub["finance"].search(blob))
    score = 20.0
    # A mild edge for finance-adjacent stories keeps the account's voice present
    # without letting budget stories crowd out general film news.
    score += 3.0 if finance else 0.0
    score += float(rub["source_weights"].get(sig["category"], 0))

    low = blob.lower()
    for term, pts in rub["boost_terms"].items():
        if term.lower() in low:
            score += float(pts)

    # Notability: a concrete news angle (release, casting, deal, festival…) lifts a
    # story; genuinely content-free chatter drops it. Applied independently so a
    # story that matches both is penalised rather than rescued.
    priority_angle = bool(rub["priority"].search(blob))
    if priority_angle:
        score += 6.0
    if rub["low_signal"].search(blob):
        score -= 15.0

    if age_days is not None:
        score += rub["recency_points"] * max(
            0.0, 1.0 - (age_days / cfg.get("window_days", 14)))

    score += rub["trending_points"] * max(0, sig.get("trending_sources", 1) - 1)

    sim, near = best_match(sig["title"], corpus)
    rework = bool(rub["rework"].search(blob)) and sim >= rub["duplicate_threshold"]
    if sim >= rub["similar_threshold"] and not rework:
        return None
    if sim >= rub["similar_threshold"]:
        score -= 8.0
    score += min(12.0, len(sig["summary"]) / 35.0)

    # Confidence is a calibrated band on absolute score, not 58+score, which
    # saturates and makes every topic read 96%.
    q = min(1.0, max(0.0, score) / rub["confidence_divisor"])
    conf = int(round(rub["min_confidence"] +
                     q * (rub["max_confidence"] - rub["min_confidence"])))
    conf = max(rub["min_confidence"], min(rub["max_confidence"], conf))

    out = dict(sig)
    reasons = []
    if priority_angle:
        reasons.append("carries a clear current film-news angle")
    trend = int(sig.get("trending_sources", 1))
    if trend > 1:
        reasons.append(f"corroborated by {trend} independent sources")
    if age_days is not None:
        hours = age_days * 24
        reasons.append(f"published {hours:.0f}h ago" if hours < 48
                       else f"published {age_days:.0f}d ago")
    reasons.append(f"{sig['source']} is a {sig['category']} source")
    out.update({
        "score": round(score, 2),
        "confidence": conf,
        "confidence_reason": "; ".join(reasons) + ".",
        "finance_related": finance,
        "priority_angle": priority_angle,
        "duplicate_similarity": round(sim, 3),
        "duplicate_status": "rework_allowed" if rework else "new",
        "duplicate_note": (
            f"Similar to existing post \u201c{near}\u201d (match {sim:.0%}) but carries a "
            f"current change/news angle, so it is allowed as a rework."
            if rework else
            "No close match in the existing-post corpus."
        ),
        "age_days": round(age_days, 1) if age_days is not None else None,
    })
    return out


def select_topics(signals: list[dict], corpus: list[str], cfg: dict,
                  rub: dict, now: datetime) -> list[dict]:
    scored = [s for s in (score_signal(s, corpus, cfg, rub, now)
                          for s in signals) if s]
    scored.sort(key=lambda s: s["score"], reverse=True)

    mix = cfg.get("mix", {})
    want_finance = int(mix.get("finance", 0))
    total = int(cfg.get("max_topics", 10))

    picked: list[dict] = []
    # A finance target of 0 means "no finance-first pass": rank purely by score so
    # the selection reflects what is genuinely trending, not a forced quota.
    passes = ([(None, total)] if want_finance <= 0
              else [(True, want_finance), (False, total), (None, total)])
    for finance_pass, limit in passes:
        for s in scored:
            if len(picked) >= limit or len(picked) >= total:
                continue
            if any(p["title"] == s["title"] for p in picked):
                continue
            if picked and similarity(s["title"], " ".join(p["title"] for p in picked)) > 0.45:
                continue
            if finance_pass is True and not s["finance_related"]:
                continue
            if finance_pass is False and s["finance_related"]:
                continue
            picked.append(s)

    for i, s in enumerate(picked):
        s["id"] = f"{cfg['agent_id']}-{int(now.timestamp())}-{i}"
        s["topic"] = s["title"][:140]
        s["hook"] = make_hook(s, cfg)
        # why_now was declared in the schema but never populated; the story's own
        # opening line is real, story-specific and free to produce. Feeds whose
        # summary is just the headline again get null rather than a duplicate.
        wn = first_sentence(s.get("summary", ""))
        if wn and wn.lower().strip("“”\"' .")[:35] == clean_title(s["title"]).lower().strip("“”\"' .")[:35]:
            wn = None
        s["why_now"] = wn
        s["suggested_format"] = "both"
    return picked[:total]


SOURCE_SUFFIX_RE = re.compile(r"\s+[-–—|]\s+[A-Z0-9][A-Za-z0-9&.'’ ]{2,28}$")


def clean_title(title: str) -> str:
    """Strip a trailing syndication source ("... - Cartoon Brew") from a headline."""
    t = re.sub(r"\s+", " ", (title or "").strip())
    stripped = SOURCE_SUFFIX_RE.sub("", t).strip()
    return stripped or t


def first_sentence(text: str, limit: int = 180) -> str | None:
    """The story's own opening line — real, story-specific, never invented."""
    t = re.sub(r"\s+", " ", (text or "").strip())
    if not t:
        return None
    m = re.match(r"^(.{15,%d}?[.!?])(?:\s|$)" % limit, t)
    if m:
        return m.group(1).strip()
    if len(t) <= limit:
        return t
    return t[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def make_hook(sig: dict, cfg: dict) -> str:
    """A hook that describes THIS story.

    Hooks must never contradict the article. The previous implementation matched
    the story against a fixed list of budget/business SENTENCES and returned the
    first hit, so a preschool cartoon announcement came back as "This is why your
    crew budget keeps fighting back". Instead we now either return the story's own
    headline or apply a neutral category label that is bound to that headline
    ("Casting: <headline>"), so the hook can only ever restate the story.

    cfg["hooks"] entries are [regex, template] and MUST contain {title}.
    """
    title = clean_title(sig.get("title", ""))
    for pattern, hook in cfg.get("hooks", []):
        if "{title}" not in hook:
            continue  # a template that cannot bind to the story is not usable
        if re.search(pattern, title, re.I):
            return hook.replace("{title}", title)
    return title


# --------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------

def run(cfg_path: str, dry_run: bool = False, verbose: bool = True) -> dict:
    cfg = json.loads(Path(cfg_path).read_text())
    now = datetime.now(timezone.utc)
    rub = compile_rubric(cfg)
    sources = cfg["sources"]

    tmpl = cfg.get("query_url_template")
    if tmpl:
        for s in sources:
            if s.get("query") and not s.get("query_url"):
                s["query_url"] = tmpl

    log = (lambda m: print(m, flush=True)) if verbose else (lambda m: None)
    log(f"[{cfg['agent_id']}] scanning {len(sources)} sources ...")

    parallel = [s for s in sources if not s.get("paced")]
    paced = [s for s in sources if s.get("paced")]

    signals: list[dict] = []
    failed: list[dict] = []
    lock_step = []

    def collect(result):
        sid, sigs, err = result
        if err:
            failed.append({"id": sid, "reason": err})
            log(f"  ! {sid}: {err}")
        else:
            signals.extend(sigs)
            log(f"  + {sid}: {len(sigs)} items")

    if parallel:
        with ThreadPoolExecutor(max_workers=int(cfg.get("concurrency", 6))) as pool:
            for res in pool.map(fetch_source, parallel):
                collect(res)

    # Paced sources (Reddit throttles hard) go one at a time with a pause.
    for src in paced:
        collect(fetch_source(src))
        time.sleep(float(cfg.get("paced_pause", 6)))

    corpus = load_corpus(cfg)
    log(f"corpus: {len(corpus)} existing titles | signals: {len(signals)}")

    cluster_trending(signals)
    topics = select_topics(signals, corpus, cfg, rub, now)
    log(f"selected {len(topics)} topics")

    out = {
        "schema_version": SCHEMA_VERSION,
        "agent_id": cfg["agent_id"],
        "domain": cfg.get("domain", ""),
        "generated_at": now.isoformat(),
        "window_days": cfg.get("window_days", 14),
        "run": {
            "sources_total": len(sources),
            "sources_ok": len(sources) - len(failed),
            "sources_failed": failed,
            "signals_seen": len(signals),
            "corpus_titles": len(corpus),
            "topics_found": len(topics),
        },
        "topics": [_jsonable(t) for t in topics],
    }

    if not dry_run:
        write_output(out, cfg)

    log(f"done — {len(topics)} topics, {len(failed)} source gaps")
    return out


def _jsonable(topic: dict) -> dict:
    t = dict(topic)
    pub = t.get("published")
    if isinstance(pub, datetime):
        t["published"] = pub.isoformat()
    return t


def write_output(out: dict, cfg: dict) -> None:
    path = Path(cfg["output"]["path"]).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False))

    hist = Path(cfg["output"]["history_file"]).expanduser()
    hist.parent.mkdir(parents=True, exist_ok=True)
    titles: list[str] = []
    if hist.exists():
        try:
            titles = json.loads(hist.read_text()).get("titles", [])
        except (json.JSONDecodeError, OSError):
            titles = []
    for t in [x["topic"] for x in out["topics"]] + titles:
        if t and t not in titles:
            titles.append(t)
    hist.write_text(json.dumps({"titles": titles[-400:]}, indent=2,
                               ensure_ascii=False))


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description="Run a research agent from config.")
    ap.add_argument("config", help="path to agent config JSON")
    ap.add_argument("--dry-run", action="store_true", help="do not write output")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    out = run(args.config, dry_run=args.dry_run, verbose=not args.quiet)
    if args.dry_run:
        for t in out["topics"]:
            print(f"  {t['confidence']:>3}%  [{t['category']}] {t['topic']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
