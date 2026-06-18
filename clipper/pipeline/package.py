"""Stage 5 — PACKAGE.

For each `pending_review` clip that doesn't yet have metadata, call Claude with
`prompts/package.md` and store per-platform titles / captions / hashtags as a
JSON blob on the clip row.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402
from pipeline import ai  # noqa: E402

PROMPT_PATH = ROOT / "prompts" / "package.md"
ASSIST_PROMPT_PATH = ROOT / "prompts" / "assist.md"


def _build_prompt(cfg: dict, clip: dict, cand: dict) -> str:
    template = PROMPT_PATH.read_text()
    existing = db.jloads(clip.get("metadata_json")) or {}
    clip_ai = {
        "clip_ai": existing.get("clip_ai") or {},
        "variants": existing.get("variants") or {},
        "safety_review": existing.get("safety_review") or {},
    }
    return (template
            .replace("{niche}",        cfg["niche"])
            .replace("{hook}",         clip.get("hook") or "")
            .replace("{vo_script}",    clip.get("vo_script") or "")
            .replace("{source_title}", cand.get("title") or "")
            .replace("{format}",       clip.get("format") or "")
            .replace("{clip_ai_json}", db.jdumps(clip_ai))
            .replace("{yt_count}", str(cfg["package"]["hashtags"]["youtube_count"]))
            .replace("{tt_count}", str(cfg["package"]["hashtags"]["tiktok_count"]))
            .replace("{ig_count}", str(cfg["package"]["hashtags"]["instagram_count"])))


def _extract_json(text: str) -> dict:
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise ValueError("no JSON object found in model response")
    return json.loads(m.group(0))


def _call(model: str, prompt: str) -> dict:
    return ai.call_json(model, prompt, max_tokens=3072)


def _merge_metadata(existing: dict, incoming: dict) -> dict:
    merged = dict(existing or {})
    for platform in ("youtube", "tiktok", "instagram"):
        old_platform = dict(merged.get(platform) or {})
        new_platform = dict(incoming.get(platform) or {})
        if not new_platform:
            continue
        if "enabled" in old_platform:
            new_platform["enabled"] = old_platform["enabled"]
        else:
            new_platform["enabled"] = True
        merged[platform] = new_platform

    for key in ("variants", "safety_review", "posting_plan"):
        if incoming.get(key):
            merged[key] = incoming[key]
    if incoming.get("clip_ai"):
        merged["clip_ai"] = incoming["clip_ai"]
    return merged


def _has_platform_package(meta: dict) -> bool:
    return all(meta.get(platform) for platform in ("youtube", "tiktok", "instagram"))


def run(cfg: dict) -> int:
    ai.require_available(cfg)
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM clips WHERE status = 'pending_review'"
        ).fetchall()
        rows = [dict(r) for r in rows]
    rows = [r for r in rows if not _has_platform_package(db.jloads(r.get("metadata_json")) or {})]
    if not rows:
        print("[package] nothing to package")
        return 0

    n = 0
    for clip in rows:
        with db.connect() as conn:
            cand = dict(conn.execute(
                "SELECT * FROM candidates WHERE video_id = ?", (clip["video_id"],)
            ).fetchone())
        print(f"[package] #{clip['id']} — {clip['hook'][:60]}")
        try:
            existing = db.jloads(clip.get("metadata_json")) or {}
            meta = _call(cfg["package"]["model"], _build_prompt(cfg, clip, cand))
            meta = _merge_metadata(existing, meta)
            with db.connect() as conn:
                conn.execute(
                    "UPDATE clips SET metadata_json = ? WHERE id = ?",
                    (db.jdumps(meta), clip["id"]),
                )
            n += 1
        except Exception as e:
            print(f"[package]   error: {e}", file=sys.stderr)

    print(f"[package] {n} packaged")
    return n


def _build_assist_prompt(cfg: dict, clip: dict, cand: dict, action: str) -> str:
    metadata = db.jloads(clip.get("metadata_json")) or {}
    return (ASSIST_PROMPT_PATH.read_text()
            .replace("{niche}", cfg["niche"])
            .replace("{action}", action)
            .replace("{hook}", clip.get("hook") or "")
            .replace("{vo_script}", clip.get("vo_script") or "")
            .replace("{source_title}", cand.get("title") or "")
            .replace("{metadata_json}", db.jdumps(metadata)))


def rewrite_clip_metadata(cfg: dict, clip_id: int, action: str) -> dict:
    ai.require_available(cfg)
    with db.connect() as conn:
        clip_row = conn.execute("SELECT * FROM clips WHERE id = ?", (clip_id,)).fetchone()
        if not clip_row:
            raise ValueError(f"clip #{clip_id} not found")
        clip = dict(clip_row)
        cand_row = conn.execute(
            "SELECT * FROM candidates WHERE video_id = ?", (clip["video_id"],)
        ).fetchone()
        cand = dict(cand_row) if cand_row else {}

    model = cfg.get("ai", {}).get("model_fast") or cfg["package"]["model"]
    incoming = _call(model, _build_assist_prompt(cfg, clip, cand, action))
    merged = _merge_metadata(db.jloads(clip.get("metadata_json")) or {}, incoming)
    with db.connect() as conn:
        conn.execute(
            "UPDATE clips SET metadata_json = ? WHERE id = ?",
            (db.jdumps(merged), clip_id),
        )
    return merged
