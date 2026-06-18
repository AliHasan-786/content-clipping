"""Stage 1 — SOURCE.

Read the SOURCES.md allowlist, poll each entry for recent uploads, rank by
velocity (views/hour since publish), dedup against the DB, and write the
survivors into the `candidates` table.

Nothing here ever clips, transcribes, or hits Claude — it's pure discovery.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402

SOURCES_FILE = ROOT / "SOURCES.md"

VALID_TYPES = {"yt_channel", "yt_handle", "yt_playlist", "rss"}


@dataclass
class Source:
    type: str
    identifier: str


@dataclass
class Candidate:
    source_type: str
    source_id: str
    video_id: str
    url: str
    title: str
    channel: str | None
    published_at: str  # ISO 8601 UTC
    duration_s: int | None
    views: int | None
    velocity: float


def parse_allowlist(path: Path = SOURCES_FILE) -> list[Source]:
    """`type: identifier  # note` lines, ignoring blanks + comments."""
    if not path.exists():
        return []
    sources: list[Source] = []
    for raw in path.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        type_, _, rest = line.partition(":")
        type_ = type_.strip()
        ident = rest.strip()
        if type_ not in VALID_TYPES:
            print(f"[source] skipping unknown type: {type_}", file=sys.stderr)
            continue
        sources.append(Source(type=type_, identifier=ident))
    return sources


def _ytdlp_json(args: list[str]) -> list[dict]:
    """Run yt-dlp with `-J`/`--dump-json` and return parsed entries."""
    try:
        out = subprocess.run(
            ["yt-dlp", *args],
            check=True, capture_output=True, text=True, timeout=120,
        ).stdout
    except FileNotFoundError:
        raise RuntimeError("yt-dlp not installed. `brew install yt-dlp`.")
    except subprocess.CalledProcessError as e:
        print(f"[source] yt-dlp error: {e.stderr.strip()[:400]}", file=sys.stderr)
        return []
    entries: list[dict] = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return entries


def _hours_since(iso_utc: str) -> float:
    try:
        dt = datetime.fromisoformat(iso_utc.replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    return max((datetime.now(timezone.utc) - dt).total_seconds() / 3600.0, 0.001)


def _yt_upload_date_to_iso(s: str | None) -> str:
    """yt-dlp gives 'YYYYMMDD' for upload_date when timestamp is absent."""
    if not s:
        return datetime.now(timezone.utc).isoformat()
    if re.fullmatch(r"\d{8}", s):
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}T00:00:00+00:00"
    return s


def _entry_to_candidate(entry: dict, src: Source, lookback_hours: int) -> Candidate | None:
    video_id = entry.get("id")
    if not video_id:
        return None
    url = entry.get("webpage_url") or entry.get("url") or f"https://www.youtube.com/watch?v={video_id}"

    timestamp = entry.get("timestamp")
    if timestamp:
        published_at = datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()
    else:
        published_at = _yt_upload_date_to_iso(entry.get("upload_date"))

    age = _hours_since(published_at)
    if age > lookback_hours:
        return None

    views = entry.get("view_count") or 0
    velocity = views / age if views else 0.0

    return Candidate(
        source_type=src.type,
        source_id=src.identifier,
        video_id=video_id,
        url=url,
        title=entry.get("title") or "",
        channel=entry.get("channel") or entry.get("uploader"),
        published_at=published_at,
        duration_s=int(entry["duration"]) if entry.get("duration") else None,
        views=int(views) if views else None,
        velocity=velocity,
    )


def _poll_youtube(src: Source, lookback_hours: int) -> list[Candidate]:
    if src.type == "yt_channel":
        # Resolve channel ID → uploads playlist (UU = uploads counterpart of UC).
        playlist = "UU" + src.identifier[2:] if src.identifier.startswith("UC") else src.identifier
        target = f"https://www.youtube.com/playlist?list={playlist}"
    elif src.type == "yt_handle":
        handle = src.identifier if src.identifier.startswith("@") else "@" + src.identifier
        target = f"https://www.youtube.com/{handle}/videos"
    elif src.type == "yt_playlist":
        target = f"https://www.youtube.com/playlist?list={src.identifier}"
    else:
        return []

    # `--flat-playlist` lists without resolving each video. We then look up the
    # top 8 with full metadata for accurate view counts.
    flat = _ytdlp_json(["--flat-playlist", "--dump-json", "--playlist-end", "8", target])
    candidates: list[Candidate] = []
    for entry in flat:
        vid = entry.get("id")
        if not vid:
            continue
        meta = _ytdlp_json([f"https://www.youtube.com/watch?v={vid}", "--dump-json", "--skip-download"])
        if not meta:
            continue
        cand = _entry_to_candidate(meta[0], src, lookback_hours)
        if cand:
            candidates.append(cand)
    return candidates


def _poll_rss(src: Source, lookback_hours: int) -> list[Candidate]:
    try:
        import feedparser
    except ImportError:
        raise RuntimeError("feedparser not installed. `pip install -r clipper/requirements.txt`.")

    feed = feedparser.parse(src.identifier)
    out: list[Candidate] = []
    for entry in feed.entries[:8]:
        # RSS items don't carry view counts → velocity stays 0, but recency
        # alone is enough to keep new podcast episodes flowing through.
        published = entry.get("published") or entry.get("updated") or ""
        try:
            published_iso = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).isoformat()
        except Exception:
            published_iso = datetime.now(timezone.utc).isoformat()
        if _hours_since(published_iso) > lookback_hours:
            continue
        url = entry.get("link") or ""
        if not url:
            continue
        video_id = entry.get("id") or url
        out.append(Candidate(
            source_type=src.type,
            source_id=src.identifier,
            video_id=video_id[:64],
            url=url,
            title=entry.get("title", ""),
            channel=feed.feed.get("title"),
            published_at=published_iso,
            duration_s=None,
            views=None,
            velocity=0.0,
        ))
    return out


def discover(sources: list[Source], lookback_hours: int) -> list[Candidate]:
    found: list[Candidate] = []
    for src in sources:
        try:
            if src.type.startswith("yt_"):
                found.extend(_poll_youtube(src, lookback_hours))
            elif src.type == "rss":
                found.extend(_poll_rss(src, lookback_hours))
        except Exception as e:
            print(f"[source] {src.type}:{src.identifier} → {e}", file=sys.stderr)
    return found


def run(cfg: dict) -> int:
    lookback = int(cfg["source"]["lookback_hours"])
    max_keep = int(cfg["source"]["max_candidates"])

    sources = parse_allowlist()
    if not sources:
        print("[source] SOURCES.md is empty — add at least one entry to begin.")
        return 0

    print(f"[source] polling {len(sources)} sources, lookback={lookback}h")
    candidates = discover(sources, lookback)
    candidates.sort(key=lambda c: c.velocity, reverse=True)
    candidates = candidates[:max_keep]

    inserted = 0
    with db.connect() as conn:
        for c in candidates:
            row = {
                "source_type":  c.source_type,
                "source_id":    c.source_id,
                "video_id":     c.video_id,
                "url":          c.url,
                "title":        c.title,
                "channel":      c.channel,
                "published_at": c.published_at,
                "duration_s":   c.duration_s,
                "views":        c.views,
                "velocity":     c.velocity,
                "status":       "new",
            }
            if db.upsert_candidate(conn, row):
                inserted += 1

    print(f"[source] {inserted} new candidates (of {len(candidates)} ranked)")
    return inserted
