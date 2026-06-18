"""Import external trend-tool CSV exports into the trend queue.

This is the lightweight bridge for tools like TikTok Creative Center, TrendTok,
vidIQ, Exploding Topics, and manual spreadsheets. It intentionally reuses the
existing rights gates instead of treating imported popularity as permission.
"""
from __future__ import annotations

import csv
import hashlib
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402
from pipeline import trend  # noqa: E402


ALIASES = {
    "title": ["title", "topic", "keyword", "hashtag", "name", "trend", "text"],
    "url": ["url", "link", "source_url", "post_url", "video_url"],
    "author": ["author", "creator", "account", "username", "channel"],
    "score": ["score", "views", "view_count", "posts", "post_count", "search_volume", "volume"],
    "comments": ["comments", "comment_count", "engagement", "engagements"],
    "trend_score": ["trend_score", "virality_score", "growth_score", "opportunity_score"],
    "source_kind": ["source_kind", "kind", "content_type", "type"],
    "published_at": ["published_at", "date", "created_at", "timestamp", "first_seen"],
}


def _norm_key(key: str) -> str:
    return key.strip().lower().replace(" ", "_").replace("-", "_")


def _normalize_row(row: dict[str, str]) -> dict[str, str]:
    return {_norm_key(k): (v or "").strip() for k, v in row.items() if k is not None}


def _pick(row: dict[str, str], field: str) -> str:
    for key in ALIASES[field]:
        value = row.get(_norm_key(key))
        if value:
            return value
    return ""


def _int_or_none(value: str) -> int | None:
    if not value:
        return None
    cleaned = value.replace(",", "").replace("+", "").strip()
    try:
        return int(float(cleaned))
    except ValueError:
        return None


def _published(value: str) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat()
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
    except ValueError:
        return datetime.now(timezone.utc).isoformat()


def _fallback_url(source: str, title: str) -> str:
    query = quote_plus(f"{title} {source}".strip())
    return f"https://www.google.com/search?q={query}"


def _canonical(source: str, url: str, title: str) -> str:
    seed = f"import:{source}:{url}:{title}".lower()
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:24]


def _row_to_opportunity(
    raw: dict[str, str],
    cfg: dict,
    source: str,
    default_kind: str,
    row_number: int,
) -> dict[str, Any] | None:
    row = _normalize_row(raw)
    title = _pick(row, "title")
    if not title:
        return None
    url = _pick(row, "url") or _fallback_url(source, title)
    author = _pick(row, "author") or None
    explicit_kind = _pick(row, "source_kind")
    inferred_kind = trend._infer_source_kind(url, title)
    source_kind = inferred_kind if inferred_kind != "random_video" else explicit_kind or default_kind

    published_at = _published(_pick(row, "published_at"))
    score = _int_or_none(_pick(row, "score"))
    comments = _int_or_none(_pick(row, "comments"))
    velocity, computed_score = trend._score(score, comments, published_at)
    imported_score = _int_or_none(_pick(row, "trend_score"))
    trend_score = max(45, min(100, imported_score if imported_score is not None else computed_score or 80 - row_number))

    rights_status, recommended_format = trend._rights_gate(source_kind, {}, cfg)
    evidence = {
        "import_source": source,
        "row_number": row_number,
        "raw_row": row,
        "score_source": "csv_import",
    }
    return {
        "canonical_id": _canonical(source, url, title),
        "source_type": "csv_import",
        "source_id": source,
        "source_kind": source_kind,
        "url": url,
        "title": title,
        "author": author,
        "published_at": published_at,
        "score": score,
        "comments": comments,
        "velocity": velocity,
        "trend_score": trend_score,
        "rights_status": rights_status,
        "recommended_format": recommended_format,
        "treatment": trend._treatment(source_kind, title, recommended_format, rights_status),
        "evidence_json": db.jdumps(evidence),
        "status": "blocked" if rights_status == "blocked" else "new",
    }


def parse_csv(path: Path, cfg: dict, source: str, default_kind: str = "social_text", limit: int | None = None) -> list[dict]:
    delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
    rows: list[dict] = []
    with path.open(newline="") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        for idx, raw in enumerate(reader, start=1):
            if limit is not None and len(rows) >= limit:
                break
            parsed = _row_to_opportunity(raw, cfg, source, default_kind, idx)
            if parsed:
                rows.append(parsed)
    return rows


def import_csv(path: str, cfg: dict, source: str | None = None, default_kind: str = "social_text", limit: int | None = None) -> int:
    csv_path = Path(path).expanduser()
    if not csv_path.exists():
        raise FileNotFoundError(f"trend import file not found: {csv_path}")
    source_name = source or csv_path.stem
    rows = parse_csv(csv_path, cfg, source_name, default_kind=default_kind, limit=limit)
    inserted = 0
    with db.connect() as conn:
        for row in rows:
            if db.upsert_trend_opportunity(conn, row):
                inserted += 1
    return inserted
