"""Trendjacking discovery lane.

Find daily opportunities from Reddit/RSS/manual URLs and classify them by
rights posture before anything can be rendered or posted. This module is
intentionally conservative: it queues screenshot-card and official/licensed
opportunities, sends ambiguous media through review, and blocks raw reposts of
independent creators' viral clips.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402

TREND_SOURCES_FILE = ROOT / "TREND_SOURCES.md"
USER_AGENT = "content-clipping-trend-scout/0.1"

VALID_TYPES = {"reddit_hot", "reddit_top", "rss", "manual_url"}


@dataclass
class TrendSource:
    type: str
    identifier: str
    meta: dict[str, str]


@dataclass
class TrendOpportunity:
    source_type: str
    source_id: str
    source_kind: str
    canonical_id: str
    url: str
    title: str
    author: str | None
    published_at: str
    score: int | None
    comments: int | None
    velocity: float
    trend_score: int
    rights_status: str
    recommended_format: str
    treatment: str
    evidence: dict


def _split_identifier(raw: str) -> tuple[str, dict[str, str]]:
    parts = [p.strip() for p in raw.split("|")]
    ident = parts[0]
    meta: dict[str, str] = {}
    for part in parts[1:]:
        if "=" not in part:
            continue
        key, _, value = part.partition("=")
        meta[key.strip()] = value.strip()
    return ident, meta


def parse_trend_sources(path: Path = TREND_SOURCES_FILE) -> list[TrendSource]:
    """Parse `type: identifier | key=value` lines, ignoring comments/blanks."""
    if not path.exists():
        return []
    sources: list[TrendSource] = []
    for raw in path.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        type_, _, rest = line.partition(":")
        type_ = type_.strip()
        if type_ not in VALID_TYPES:
            print(f"[trend] skipping unknown type: {type_}", file=sys.stderr)
            continue
        ident, meta = _split_identifier(rest.strip())
        if ident:
            sources.append(TrendSource(type=type_, identifier=ident, meta=meta))
    return sources


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_datetime(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


def _hours_since(iso_utc: str) -> float:
    dt = _parse_datetime(iso_utc)
    return max((datetime.now(timezone.utc) - dt).total_seconds() / 3600.0, 0.25)


def _canonical_id(url: str, title: str = "") -> str:
    seed = (url or title).strip().lower()
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:24]


def _normalize_reddit_name(value: str) -> str:
    value = value.strip()
    if value.startswith("/r/"):
        return value[3:]
    if value.startswith("r/"):
        return value[2:]
    return value


def _domain(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        return host[4:]
    return host


def _infer_source_kind(url: str, title: str, default: str | None = None) -> str:
    if default:
        return default
    host = _domain(url)
    text = f"{title} {url}".lower()
    if host == "x.com" or host.endswith(".x.com") or host == "twitter.com" or host.endswith(".twitter.com"):
        return "social_text"
    if host == "reddit.com" or host.endswith(".reddit.com"):
        return "reddit_discussion"
    if host == "tiktok.com" or host.endswith(".tiktok.com"):
        return "raw_tiktok_repost"
    if host == "twitch.tv" or host.endswith(".twitch.tv"):
        return "streamer_clip"
    if host == "youtube.com" or host.endswith(".youtube.com") or host == "youtu.be":
        return "viral_clip"
    if any(w in text for w in ("movie clip", "film clip", "scene from")):
        return "movie_clip"
    if any(w in text for w in ("nba", "nfl", "mlb", "nhl", "ufc", "fifa", "goal", "touchdown")):
        return "sports_highlight"
    if any(w in text for w in ("concert", "tour", "live performance")):
        return "concert_clip"
    return "random_video"


def _rights_gate(kind: str, meta: dict[str, str], cfg: dict) -> tuple[str, str]:
    allowed = set(cfg["trend"].get("allowed_source_kinds", []))
    review = set(cfg["trend"].get("review_required_source_kinds", []))
    blocked = set(cfg["trend"].get("blocked_source_kinds", []))

    permission = meta.get("permission", "").lower()
    explicit = meta.get("rights", "").lower()

    if explicit in {"blocked", "review_required"}:
        rights_status = explicit
    elif explicit == "allowed" and permission in {"owned", "licensed", "official", "public_domain"}:
        rights_status = "allowed"
    elif kind in blocked:
        rights_status = "blocked"
    elif kind in allowed:
        rights_status = "allowed"
    elif kind in review:
        rights_status = "review_required"
    else:
        rights_status = "review_required"

    if rights_status == "blocked":
        return rights_status, "do_not_repost"
    if rights_status == "review_required":
        return rights_status, "rights_review"
    if kind in {"social_text", "reddit_discussion", "news_article"}:
        return rights_status, "screenshot_card"
    return rights_status, "commentary_clip"


def _score(score: int | None, comments: int | None, published_at: str) -> tuple[float, int]:
    s = max(score or 0, 0)
    c = max(comments or 0, 0)
    age = _hours_since(published_at)
    velocity = (s + c * 2) / age
    trend_score = min(
        100,
        int(math.log1p(s) * 8 + math.log1p(c) * 9 + min(35, velocity / 8)),
    )
    return velocity, trend_score


def _treatment(kind: str, title: str, recommended_format: str, rights_status: str) -> str:
    if recommended_format == "screenshot_card":
        return (
            "Render a vertical screenshot/commentary card with visible attribution, "
            "a short context VO, background music, and a caption that asks viewers "
            "which side they take."
        )
    if recommended_format == "commentary_clip":
        return (
            "Use only the official/licensed/owned source clip, add transformative VO "
            "with context/stakes, and avoid presenting it as raw reposted footage."
        )
    if rights_status == "blocked":
        return (
            "Do not repost this source. Use it only as a signal to find an official, "
            "licensed, public-domain, or creator-owned alternative."
        )
    return (
        "Owner must confirm rights or swap in an official/licensed source before "
        "rendering. If cleared, add commentary rather than raw reposting."
    )


def _make_opp(
    src: TrendSource,
    url: str,
    title: str,
    author: str | None,
    published_at: str,
    score: int | None,
    comments: int | None,
    evidence: dict,
    cfg: dict,
) -> TrendOpportunity:
    kind = _infer_source_kind(url, title, src.meta.get("kind"))
    rights_status, recommended_format = _rights_gate(kind, src.meta, cfg)
    velocity, trend_score = _score(score, comments, published_at)
    return TrendOpportunity(
        source_type=src.type,
        source_id=src.identifier,
        source_kind=kind,
        canonical_id=_canonical_id(url, title),
        url=url,
        title=src.meta.get("title") or title,
        author=author,
        published_at=published_at,
        score=score,
        comments=comments,
        velocity=velocity,
        trend_score=trend_score,
        rights_status=rights_status,
        recommended_format=recommended_format,
        treatment=_treatment(kind, title, recommended_format, rights_status),
        evidence=evidence,
    )


def _poll_reddit_json(src: TrendSource, cfg: dict) -> list[TrendOpportunity]:
    try:
        import requests
    except ImportError:
        raise RuntimeError("requests not installed. `pip install -r clipper/requirements.txt`.")

    subreddit = _normalize_reddit_name(src.identifier)
    sort = "hot" if src.type == "reddit_hot" else "top"
    limit = int(cfg["trend"].get("reddit_limit_per_source", 25))
    url = f"https://www.reddit.com/r/{subreddit}/{sort}.json"
    params = {"limit": limit}
    if sort == "top":
        params["t"] = "day"
    resp = requests.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    out: list[TrendOpportunity] = []
    for child in data.get("data", {}).get("children", []):
        post = child.get("data", {})
        if post.get("over_18"):
            continue
        created = datetime.fromtimestamp(post.get("created_utc", 0), tz=timezone.utc).isoformat()
        if _hours_since(created) > int(cfg["trend"]["lookback_hours"]):
            continue
        permalink = "https://www.reddit.com" + post.get("permalink", "")
        title = post.get("title") or ""
        score = int(post.get("score") or 0)
        comments = int(post.get("num_comments") or 0)
        evidence = {
            "subreddit": subreddit,
            "sort": sort,
            "score": score,
            "comments": comments,
            "is_self": bool(post.get("is_self")),
            "linked_url": post.get("url"),
        }
        local_src = TrendSource(
            type=src.type,
            identifier=src.identifier,
            meta={**src.meta, "kind": src.meta.get("kind", "reddit_discussion")},
        )
        out.append(_make_opp(local_src, permalink, title, post.get("author"), created, score, comments, evidence, cfg))
    return out


def _poll_reddit_rss(src: TrendSource, cfg: dict, json_error: str | None = None) -> list[TrendOpportunity]:
    try:
        import requests
    except ImportError:
        raise RuntimeError("requests not installed. `pip install -r clipper/requirements.txt`.")

    subreddit = _normalize_reddit_name(src.identifier)
    sort = "hot" if src.type == "reddit_hot" else "top"
    url = f"https://www.reddit.com/r/{subreddit}/{sort}/.rss"
    params = {"limit": int(cfg["trend"].get("reddit_limit_per_source", 25))}
    if sort == "top":
        params["t"] = "day"

    resp = requests.get(
        url,
        params=params,
        headers={"User-Agent": "Mozilla/5.0 (compatible; content-clipping-trend-scout/0.1)"},
        timeout=30,
    )
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    ns = {"atom": "http://www.w3.org/2005/Atom"}

    out: list[TrendOpportunity] = []
    for idx, entry in enumerate(root.findall("atom:entry", ns)):
        title = (entry.findtext("atom:title", default="", namespaces=ns) or "").strip()
        link_el = entry.find("atom:link", ns)
        permalink = link_el.attrib.get("href", "") if link_el is not None else ""
        if not title or not permalink:
            continue
        updated = (
            entry.findtext("atom:updated", default="", namespaces=ns)
            or entry.findtext("atom:published", default="", namespaces=ns)
            or _utc_now_iso()
        )
        if _hours_since(updated) > int(cfg["trend"]["lookback_hours"]):
            continue
        author = entry.findtext("atom:author/atom:name", default="", namespaces=ns) or None
        # Reddit RSS omits score/comment counts. Feed rank is still a trend
        # signal, so synthesize conservative engagement values for scoring.
        synthetic_score = max(900, 12000 - idx * 800)
        synthetic_comments = max(35, 650 - idx * 40)
        evidence = {
            "subreddit": subreddit,
            "sort": sort,
            "rss_rank": idx + 1,
            "score_source": "synthetic_from_reddit_rss_rank",
            "json_error": json_error,
        }
        local_src = TrendSource(
            type=src.type,
            identifier=src.identifier,
            meta={**src.meta, "kind": src.meta.get("kind", "reddit_discussion")},
        )
        out.append(
            _make_opp(
                local_src,
                permalink,
                title,
                author,
                updated,
                synthetic_score,
                synthetic_comments,
                evidence,
                cfg,
            )
        )
    return out


def _poll_reddit(src: TrendSource, cfg: dict) -> list[TrendOpportunity]:
    try:
        rows = _poll_reddit_rss(src, cfg)
        if rows:
            return rows
    except Exception as rss_error:
        try:
            return _poll_reddit_json(src, cfg)
        except Exception as json_error:
            raise RuntimeError(f"rss failed: {rss_error}; json failed: {json_error}")
    return _poll_reddit_json(src, cfg)


def _poll_rss(src: TrendSource, cfg: dict) -> list[TrendOpportunity]:
    try:
        import feedparser
    except ImportError:
        raise RuntimeError("feedparser not installed. `pip install -r clipper/requirements.txt`.")

    feed = feedparser.parse(src.identifier)
    out: list[TrendOpportunity] = []
    for entry in feed.entries[: int(cfg["trend"].get("max_opportunities", 25))]:
        try:
            published = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).isoformat()
        except Exception:
            published = _utc_now_iso()
        if _hours_since(published) > int(cfg["trend"]["lookback_hours"]):
            continue
        url = entry.get("link") or entry.get("id") or ""
        if not url:
            continue
        evidence = {
            "feed_title": feed.feed.get("title"),
            "summary": re.sub(r"<[^>]+>", "", entry.get("summary", ""))[:500],
        }
        out.append(_make_opp(src, url, entry.get("title", ""), entry.get("author"), published, None, None, evidence, cfg))
    return out


def _manual(src: TrendSource, cfg: dict) -> list[TrendOpportunity]:
    score = int(src.meta["score"]) if src.meta.get("score", "").isdigit() else None
    comments = int(src.meta["comments"]) if src.meta.get("comments", "").isdigit() else None
    published = src.meta.get("published_at") or _utc_now_iso()
    title = src.meta.get("title") or src.identifier
    evidence = {k: v for k, v in src.meta.items() if k not in {"title", "score", "comments"}}
    return [_make_opp(src, src.identifier, title, src.meta.get("author"), published, score, comments, evidence, cfg)]


def discover(sources: list[TrendSource], cfg: dict) -> list[TrendOpportunity]:
    found: list[TrendOpportunity] = []
    max_keep = int(cfg.get("trend", {}).get("max_opportunities", 25))
    for src in sources:
        try:
            if src.type in {"reddit_hot", "reddit_top"}:
                found.extend(_poll_reddit(src, cfg))
            elif src.type == "rss":
                found.extend(_poll_rss(src, cfg))
            elif src.type == "manual_url":
                found.extend(_manual(src, cfg))
        except Exception as e:
            print(f"[trend] {src.type}:{src.identifier} → {e}", file=sys.stderr)
        if len(found) >= max_keep:
            break
    return found


def recent(limit: int = 10) -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM trend_opportunities "
            "ORDER BY discovered_at DESC, trend_score DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def run(cfg: dict) -> int:
    if not cfg.get("trend", {}).get("enabled", True):
        print("[trend] disabled")
        return 0

    sources = parse_trend_sources()
    if not sources:
        print("[trend] TREND_SOURCES.md has no active entries")
        return 0

    min_score = int(cfg["trend"].get("min_trend_score", 45))
    max_keep = int(cfg["trend"].get("max_opportunities", 25))

    opportunities = discover(sources, cfg)
    opportunities = [
        o for o in opportunities
        if o.trend_score >= min_score or o.source_type == "manual_url" or o.rights_status == "blocked"
    ]
    opportunities.sort(key=lambda o: (o.rights_status == "blocked", -o.trend_score))
    opportunities = opportunities[:max_keep]

    inserted = 0
    with db.connect() as conn:
        for o in opportunities:
            row = {
                "canonical_id": o.canonical_id,
                "source_type": o.source_type,
                "source_id": o.source_id,
                "source_kind": o.source_kind,
                "url": o.url,
                "title": o.title,
                "author": o.author,
                "published_at": o.published_at,
                "score": o.score,
                "comments": o.comments,
                "velocity": o.velocity,
                "trend_score": o.trend_score,
                "rights_status": o.rights_status,
                "recommended_format": o.recommended_format,
                "treatment": o.treatment,
                "evidence_json": db.jdumps(o.evidence),
                "status": "blocked" if o.rights_status == "blocked" else "new",
            }
            if db.upsert_trend_opportunity(conn, row):
                inserted += 1

    counts: dict[str, int] = {}
    for o in opportunities:
        counts[o.rights_status] = counts.get(o.rights_status, 0) + 1
    count_str = ", ".join(f"{k}={v}" for k, v in sorted(counts.items())) or "none"
    print(f"[trend] {inserted} new opportunities ({count_str})")
    return inserted
