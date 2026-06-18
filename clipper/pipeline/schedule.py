"""Posting order suggestions for approved clips."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402
from pipeline import ai  # noqa: E402

PROMPT_PATH = ROOT / "prompts" / "schedule.md"
SLOTS = ["morning", "midday", "afternoon", "evening", "late"]


def _approved_rows() -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT c.*, v.title AS source_title, v.channel AS source_channel "
            "FROM clips c LEFT JOIN candidates v ON v.video_id = c.video_id "
            "WHERE c.status = 'approved' "
            "ORDER BY c.virality_score DESC, c.id ASC"
        ).fetchall()
    return [dict(r) for r in rows]


def _clip_payload(rows: list[dict]) -> list[dict]:
    payload = []
    for row in rows:
        payload.append({
            "clip_id": row["id"],
            "hook": row.get("hook"),
            "format": row.get("format"),
            "score": row.get("virality_score"),
            "source": row.get("source_channel"),
            "source_title": row.get("source_title"),
            "metadata": db.jloads(row.get("metadata_json")) or {},
        })
    return payload


def _fallback_schedule(rows: list[dict]) -> list[dict]:
    return [
        {
            "clip_id": row["id"],
            "rank": idx + 1,
            "slot_label": SLOTS[idx % len(SLOTS)],
            "reason": "score-based fallback order",
        }
        for idx, row in enumerate(rows)
    ]


def _llm_schedule(cfg: dict, rows: list[dict]) -> list[dict] | None:
    if not cfg.get("ai", {}).get("scheduling", True) or not ai.available(cfg):
        return None
    prompt = (PROMPT_PATH.read_text()
              .replace("{niche}", cfg["niche"])
              .replace("{clips_json}", json.dumps(_clip_payload(rows), ensure_ascii=False, indent=2)))
    model = cfg.get("ai", {}).get("model_fast") or cfg["package"]["model"]
    parsed = ai.safe_call_json(model, prompt, max_tokens=2048, label="schedule")
    if not parsed:
        return None
    schedule = parsed.get("schedule")
    return schedule if isinstance(schedule, list) else None


def apply_schedule(cfg: dict) -> int:
    rows = _approved_rows()
    if not rows:
        print("[schedule] no approved clips")
        return 0
    schedule = _llm_schedule(cfg, rows) or _fallback_schedule(rows)
    by_id = {int(item.get("clip_id")): item for item in schedule if item.get("clip_id") is not None}

    updated = 0
    with db.connect() as conn:
        for row in rows:
            plan = by_id.get(int(row["id"]))
            if not plan:
                continue
            metadata = db.jloads(row.get("metadata_json")) or {}
            metadata["posting_plan"] = {
                "rank": int(plan.get("rank") or 999),
                "slot_label": plan.get("slot_label") or "anytime",
                "reason": plan.get("reason") or "",
            }
            conn.execute(
                "UPDATE clips SET metadata_json = ? WHERE id = ?",
                (db.jdumps(metadata), row["id"]),
            )
            updated += 1
    print(f"[schedule] planned {updated} approved clips")
    return updated
