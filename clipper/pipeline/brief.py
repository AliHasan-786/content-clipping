"""Daily trend brief for the review dashboard and CLI."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402


def _evidence(row: dict) -> dict:
    return db.jloads(row.get("evidence_json")) or row.get("evidence") or {}


def _ai(row: dict) -> dict:
    return _evidence(row).get("ai_triage") or {}


def _item(row: dict) -> dict[str, Any]:
    ai = _ai(row)
    return {
        "id": row["id"],
        "title": row.get("title") or row.get("url"),
        "url": row.get("url"),
        "score": row.get("trend_score") or 0,
        "source_kind": row.get("source_kind"),
        "rights_status": row.get("rights_status"),
        "recommended_format": row.get("recommended_format"),
        "hook": ai.get("hook") or row.get("title") or row.get("url"),
        "treatment": row.get("treatment"),
        "conversation_prompt": (
            (ai.get("comment_mining") or {}).get("best_comment_prompt")
            or ai.get("conversation_prompt")
            or ""
        ),
        "source_search_queries": ai.get("source_search_queries") or [],
    }


def _fetch_rows(limit: int) -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM trend_opportunities "
            "WHERE status IN ('new', 'blocked') "
            "ORDER BY CASE rights_status "
            "WHEN 'allowed' THEN 0 WHEN 'review_required' THEN 1 ELSE 2 END, "
            "trend_score DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def summarize_rows(rows: list[dict], limit_per_section: int = 4) -> dict[str, Any]:
    counts = {
        "total": len(rows),
        "allowed": 0,
        "review_required": 0,
        "blocked": 0,
        "screenshot_card": 0,
        "commentary_clip": 0,
        "rights_review": 0,
    }
    for row in rows:
        rights = row.get("rights_status")
        fmt = row.get("recommended_format")
        if rights in counts:
            counts[rights] += 1
        if fmt in counts:
            counts[fmt] += 1

    allowed_cards = [
        _item(row) for row in rows
        if row.get("rights_status") == "allowed" and row.get("recommended_format") == "screenshot_card"
    ][:limit_per_section]
    allowed_sources = [
        _item(row) for row in rows
        if row.get("rights_status") == "allowed" and row.get("recommended_format") == "commentary_clip"
    ][:limit_per_section]
    review_needed = [
        _item(row) for row in rows
        if row.get("rights_status") == "review_required"
    ][:limit_per_section]
    blocked_signals = [
        _item(row) for row in rows
        if row.get("rights_status") == "blocked"
    ][:limit_per_section]

    queries: list[str] = []
    for item in review_needed + blocked_signals:
        for query in item.get("source_search_queries") or []:
            if query and query not in queries:
                queries.append(query)
            if len(queries) >= 8:
                break

    next_actions: list[str] = []
    if allowed_cards:
        next_actions.append("Render the safe screenshot-card items first; they are fastest to review and post.")
    if allowed_sources:
        next_actions.append("Queue allowed source videos and run the normal ingest/scout/cut path.")
    if review_needed:
        next_actions.append("Use review-required items as demand signals until an official/licensed source is found.")
    if blocked_signals:
        next_actions.append("Do not repost blocked items; mine them only for topic and search direction.")
    if not next_actions:
        next_actions.append("Run `clip trends` or add more sources to TREND_SOURCES.md.")

    return {
        "counts": counts,
        "render_now": allowed_cards,
        "queue_source": allowed_sources,
        "rights_review": review_needed,
        "blocked_signals": blocked_signals,
        "source_queries": queries,
        "next_actions": next_actions,
    }


def build(limit: int = 25) -> dict[str, Any]:
    return summarize_rows(_fetch_rows(limit))


def format_markdown(brief: dict[str, Any]) -> str:
    counts = brief["counts"]
    lines = [
        "# Daily Trend Brief",
        "",
        (
            f"Total: {counts['total']} | allowed: {counts['allowed']} | "
            f"review: {counts['review_required']} | blocked: {counts['blocked']}"
        ),
        "",
    ]

    sections = [
        ("Render now", brief["render_now"]),
        ("Queue source videos", brief["queue_source"]),
        ("Needs rights/source review", brief["rights_review"]),
        ("Blocked signals only", brief["blocked_signals"]),
    ]
    for title, items in sections:
        lines.extend([f"## {title}", ""])
        if not items:
            lines.extend(["- none", ""])
            continue
        for item in items:
            lines.append(f"- #{item['id']} [{item['score']}] {item['title']}")
            if item.get("hook"):
                lines.append(f"  Hook: {item['hook']}")
            if item.get("conversation_prompt"):
                lines.append(f"  Prompt: {item['conversation_prompt']}")
        lines.append("")

    if brief["source_queries"]:
        lines.extend(["## Source search queries", ""])
        lines.extend(f"- {query}" for query in brief["source_queries"])
        lines.append("")

    lines.extend(["## Next actions", ""])
    lines.extend(f"- {action}" for action in brief["next_actions"])
    return "\n".join(lines).rstrip() + "\n"


def print_brief(limit: int = 25) -> None:
    print(format_markdown(build(limit=limit)))
