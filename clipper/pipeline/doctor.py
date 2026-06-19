"""Operational readiness checks for handing the clipper to a non-developer."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402
from pipeline import auth, source, trend  # noqa: E402


CREDENTIAL_GUIDES = {
    "youtube": [
        ("Enable YouTube Data API v3", "https://console.cloud.google.com/apis/library/youtube.googleapis.com"),
        ("Create OAuth credentials", "https://console.cloud.google.com/apis/credentials"),
        ("Official upload guide", "https://developers.google.com/youtube/v3/guides/uploading_a_video"),
    ],
    "instagram": [
        ("Meta app dashboard", "https://developers.facebook.com/apps/"),
        ("Instagram content publishing", "https://developers.facebook.com/docs/instagram-platform/content-publishing/"),
        ("Instagram platform overview", "https://developers.facebook.com/docs/instagram-platform/overview/"),
    ],
    "tiktok": [
        ("TikTok developer portal", "https://developers.tiktok.com/"),
        ("Content Posting API", "https://developers.tiktok.com/products/content-posting-api/"),
        ("Login Kit access tokens", "https://developers.tiktok.com/doc/login-kit-manage-user-access-tokens/"),
    ],
    "reddit": [
        ("Reddit app console", "https://www.reddit.com/prefs/apps"),
        ("Reddit OAuth docs", "https://github.com/reddit-archive/reddit/wiki/oauth2"),
    ],
    "anthropic": [
        ("Anthropic API keys", "https://console.anthropic.com/settings/keys"),
        ("Claude API quickstart", "https://docs.anthropic.com/en/docs/get-started"),
    ],
    "x": [
        ("X developer access", "https://docs.x.com/x-api/getting-started/getting-access"),
        ("X bearer tokens", "https://docs.x.com/fundamentals/authentication/oauth-2-0/bearer-tokens"),
    ],
}


def _queue_counts() -> dict[str, int]:
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT
              SUM(CASE WHEN status = 'pending_review' AND format != 'screenshot_card'
                        AND rendered_path IS NOT NULL THEN 1 ELSE 0 END) AS source_review,
              SUM(CASE WHEN status = 'approved' AND format != 'screenshot_card'
                        AND rendered_path IS NOT NULL THEN 1 ELSE 0 END) AS approved_source,
              SUM(CASE WHEN status IN ('pending_review', 'approved') AND format = 'screenshot_card'
                        AND rendered_path IS NOT NULL THEN 1 ELSE 0 END) AS card_clips,
              SUM(CASE WHEN status = 'post_failed' THEN 1 ELSE 0 END) AS post_failed
            FROM clips
            """
        ).fetchone()
    return {
        "source_review": int(rows["source_review"] or 0),
        "approved_source": int(rows["approved_source"] or 0),
        "card_clips": int(rows["card_clips"] or 0),
        "post_failed": int(rows["post_failed"] or 0),
    }


def _tool_status() -> dict[str, bool]:
    return {
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "yt-dlp": bool(shutil.which("yt-dlp")),
    }


def collect(cfg: dict) -> dict[str, Any]:
    """Collect local readiness facts with no secret values."""
    return {
        "auth": auth.status(cfg),
        "source_count": len(source.parse_allowlist()),
        "trend_source_count": len(trend.parse_trend_sources()),
        "queue": _queue_counts(),
        "tools": _tool_status(),
    }


def evaluate(cfg: dict, facts: dict[str, Any]) -> dict[str, Any]:
    auth_rows = facts["auth"]
    auth_by_key = {row["key"]: row for row in auth_rows}
    enabled_publishers = [
        key for key in ["youtube", "instagram", "tiktok"]
        if cfg.get("post", {}).get(key, {}).get("enabled", False)
    ]
    missing_publishers = [
        key for key in enabled_publishers
        if not auth_by_key.get(key, {}).get("ready")
    ]

    blockers: list[str] = []
    warnings: list[str] = []

    missing_tools = [name for name, ok in facts["tools"].items() if not ok]
    if missing_tools:
        blockers.append("Install local media tools: " + ", ".join(missing_tools) + ".")

    if facts["source_count"] == 0:
        blockers.append("Add approved source video feeds to clipper/SOURCES.md.")

    reddit_ready = bool(auth_by_key.get("reddit", {}).get("ready"))
    if cfg.get("trend", {}).get("enabled", False) and not reddit_ready:
        blockers.append("Add Reddit API credentials for reliable daily trend discovery.")

    if missing_publishers:
        blockers.append("Connect posting credentials for: " + ", ".join(missing_publishers) + ".")

    if cfg.get("ai", {}).get("enabled", False) and not auth_by_key.get("anthropic", {}).get("ready"):
        warnings.append("Anthropic is missing, so AI triage/caption/source-finding help is disabled.")

    if facts["trend_source_count"] == 0:
        warnings.append("clipper/TREND_SOURCES.md has no active trend sources.")

    queue = facts["queue"]
    ready_clips = queue["source_review"] + queue["approved_source"]
    if ready_clips < 3:
        warnings.append(
            f"Only {ready_clips} source-footage clips are ready/approved; target is 3-5 per day."
        )
    if queue["post_failed"]:
        warnings.append(f"{queue['post_failed']} clip(s) have failed posting attempts.")

    return {
        "ready": not blockers,
        "blockers": blockers,
        "warnings": warnings,
        "missing_publishers": missing_publishers,
        "auth": auth_rows,
        "facts": facts,
    }


def print_report(cfg: dict) -> bool:
    result = evaluate(cfg, collect(cfg))
    facts = result["facts"]
    print("handoff readiness:", "READY" if result["ready"] else "NOT READY")

    print("\nlocal media tools:")
    for name, ok in facts["tools"].items():
        print(f"  {name:<8} {'ok' if ok else 'missing'}")

    print("\ndiscovery:")
    print(f"  source feeds: {facts['source_count']} active entries in SOURCES.md")
    print(f"  trend feeds:  {facts['trend_source_count']} active entries in TREND_SOURCES.md")

    print("\nqueue:")
    print(f"  source clips ready for review: {facts['queue']['source_review']}")
    print(f"  approved source clips to post: {facts['queue']['approved_source']}")
    print(f"  screenshot-card drafts:        {facts['queue']['card_clips']}")
    print(f"  failed posting attempts:       {facts['queue']['post_failed']}")

    print("\ncredentials:")
    for row in result["auth"]:
        state = "ready" if row["ready"] else "missing" if row["enabled"] else "off"
        print(f"  {row['name']:<10} {state}")
        if row["enabled"] and not row["ready"]:
            print(f"    needs: {row['needs']}")

    if result["blockers"]:
        print("\nblockers:")
        for item in result["blockers"]:
            print(f"  - {item}")

    if result["warnings"]:
        print("\nwarnings:")
        for item in result["warnings"]:
            print(f"  - {item}")

    print("\ncredential links:")
    for key in ["youtube", "instagram", "tiktok", "reddit", "anthropic", "x"]:
        print(f"  {key}:")
        for label, url in CREDENTIAL_GUIDES[key]:
            print(f"    - {label}: {url}")

    return bool(result["ready"])
