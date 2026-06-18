"""Tiny approval/rejection feedback layer.

This keeps learning local and transparent: it derives lightweight source and
term preferences from the owner's approve/reject history and feeds them back
into trend ranking and prompts.
"""
from __future__ import annotations

import re
from collections import Counter

import db


STOPWORDS = {
    "about", "after", "again", "already", "because", "being", "clip", "clips",
    "from", "have", "into", "just", "like", "more", "over", "post", "that",
    "their", "there", "this", "trend", "video", "viral", "with", "would",
}


def _tokens(*parts: str) -> list[str]:
    text = " ".join(p or "" for p in parts).lower()
    words = re.findall(r"[a-z0-9][a-z0-9_]{2,}", text)
    return [w for w in words if w not in STOPWORDS and not w.isdigit()]


def approval_profile(limit: int = 250) -> dict:
    approved_terms: Counter[str] = Counter()
    rejected_terms: Counter[str] = Counter()
    approved_sources: Counter[str] = Counter()
    rejected_sources: Counter[str] = Counter()

    with db.connect() as conn:
        rows = conn.execute(
            "SELECT c.status, c.hook, c.vo_script, c.reject_reason, "
            "v.title AS source_title, v.channel AS source_channel, v.source_id "
            "FROM clips c LEFT JOIN candidates v ON v.video_id = c.video_id "
            "WHERE c.status IN ('approved', 'posted', 'rejected') "
            "ORDER BY c.id DESC LIMIT ?",
            (limit,),
        ).fetchall()

    for row in rows:
        status = row["status"]
        source = row["source_channel"] or row["source_id"] or ""
        terms = _tokens(row["hook"], row["source_title"], row["reject_reason"])
        if status in {"approved", "posted"}:
            approved_terms.update(terms)
            if source:
                approved_sources.update([source])
        elif status == "rejected":
            rejected_terms.update(terms)
            if source:
                rejected_sources.update([source])

    return {
        "approved_terms": [term for term, _ in approved_terms.most_common(16)],
        "rejected_terms": [term for term, _ in rejected_terms.most_common(16)],
        "approved_sources": [src for src, _ in approved_sources.most_common(8)],
        "rejected_sources": [src for src, _ in rejected_sources.most_common(8)],
    }


def trend_score_adjustment(title: str, source: str, profile: dict) -> int:
    terms = set(_tokens(title))
    score = 0
    score += 4 * len(terms.intersection(profile.get("approved_terms", [])))
    score -= 5 * len(terms.intersection(profile.get("rejected_terms", [])))
    if source and source in profile.get("approved_sources", []):
        score += 6
    if source and source in profile.get("rejected_sources", []):
        score -= 8
    return max(-20, min(20, score))


def prompt_context(profile: dict) -> str:
    if not any(profile.values()):
        return "No approval history yet."
    return (
        f"Approved terms: {', '.join(profile.get('approved_terms', []) or ['none'])}\n"
        f"Rejected terms: {', '.join(profile.get('rejected_terms', []) or ['none'])}\n"
        f"Approved sources: {', '.join(profile.get('approved_sources', []) or ['none'])}\n"
        f"Rejected sources: {', '.join(profile.get('rejected_sources', []) or ['none'])}"
    )
