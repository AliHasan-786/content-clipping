"""Stage 5 — PACKAGE.

For each `pending_review` clip that doesn't yet have metadata, call Claude with
`prompts/package.md` and store per-platform titles / captions / hashtags as a
JSON blob on the clip row.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402

PROMPT_PATH = ROOT / "prompts" / "package.md"


def _client():
    from anthropic import Anthropic
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY missing in .env")
    return Anthropic(api_key=key)


def _build_prompt(cfg: dict, clip: dict, cand: dict) -> str:
    template = PROMPT_PATH.read_text()
    return (template
            .replace("{niche}",        cfg["niche"])
            .replace("{hook}",         clip.get("hook") or "")
            .replace("{vo_script}",    clip.get("vo_script") or "")
            .replace("{why_it_works}", clip.get("why_it_works") or "")
            .replace("{source_title}", cand.get("title") or "")
            .replace("{format}",       clip.get("format") or "")
            .replace("{yt_count}", str(cfg["package"]["hashtags"]["youtube_count"]))
            .replace("{tt_count}", str(cfg["package"]["hashtags"]["tiktok_count"]))
            .replace("{ig_count}", str(cfg["package"]["hashtags"]["instagram_count"])))


def _extract_json(text: str) -> dict:
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise ValueError("no JSON object found in model response")
    return json.loads(m.group(0))


def _call(client, model: str, prompt: str) -> dict:
    resp = client.messages.create(
        model=model,
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(getattr(b, "text", "") for b in resp.content)
    return _extract_json(text)


def run(cfg: dict) -> int:
    client = _client()
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM clips WHERE status = 'pending_review' AND metadata_json IS NULL"
        ).fetchall()
        rows = [dict(r) for r in rows]
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
            meta = _call(client, cfg["package"]["model"], _build_prompt(cfg, clip, cand))
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
