"""Stage 3 — SCOUT.

Read each ingested transcript, send it to Claude with `prompts/scout.md`,
parse the JSON back, gate on `virality_score`, and persist clip candidates
to the `clips` table with status `scouted`.
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

PROMPT_PATH = ROOT / "prompts" / "scout.md"


def _client():
    try:
        from anthropic import Anthropic
    except ImportError:
        raise RuntimeError("anthropic SDK not installed. `pip install anthropic`.")
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY missing in .env")
    return Anthropic(api_key=key)


def _format_transcript(tx: dict, min_clip_s: float) -> str:
    """Collapse word-level transcripts into ~1–3s phrases for prompt density."""
    words = tx.get("words") or []
    if not words:
        return "\n".join(f"[{s['start']:.1f}-{s['end']:.1f}] {s['text'].strip()}"
                         for s in tx.get("segments", []))
    lines, buf, buf_start = [], [], None
    target_chunk = max(min_clip_s / 8, 1.5)  # ~8 chunks per minimum clip window
    for w in words:
        if buf_start is None:
            buf_start = w["start"]
        buf.append(w["text"])
        if (w["end"] - buf_start) >= target_chunk:
            lines.append(f"[{buf_start:.1f}-{w['end']:.1f}] {' '.join(buf)}")
            buf, buf_start = [], None
    if buf:
        lines.append(f"[{buf_start:.1f}-{words[-1]['end']:.1f}] {' '.join(buf)}")
    return "\n".join(lines)


def _build_prompt(cfg: dict, cand: dict, tx: dict) -> str:
    template = PROMPT_PATH.read_text()
    return (template
            .replace("{niche}", cfg["niche"])
            .replace("{max_clips}", str(cfg["scout"]["max_clips_per_source"]))
            .replace("{title}", cand.get("title") or "(unknown)")
            .replace("{channel}", cand.get("channel") or "(unknown)")
            .replace("{duration}", str(cand.get("duration_s") or int(tx.get("duration") or 0)))
            .replace("{transcript}", _format_transcript(tx, cfg["scout"]["min_clip_seconds"])))


def _extract_json(text: str) -> dict:
    # Strip ```json fences if Claude added them despite instructions.
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise ValueError("no JSON object found in model response")
    return json.loads(m.group(0))


def _call_claude(client, model: str, prompt: str) -> dict:
    resp = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    # SDK gives a list of content blocks; concatenate text blocks.
    text = "".join(getattr(b, "text", "") for b in resp.content)
    return _extract_json(text)


def _scout_one(cfg: dict, client, cand: dict) -> int:
    """Returns number of clips persisted."""
    vid = cand["video_id"]
    with db.connect() as conn:
        tx_row = conn.execute(
            "SELECT path FROM transcripts WHERE video_id = ?", (vid,)
        ).fetchone()
    if not tx_row:
        print(f"[scout]   {vid}: no transcript on disk; skipping")
        return 0

    tx = json.loads(Path(tx_row["path"]).read_text())
    prompt = _build_prompt(cfg, cand, tx)

    try:
        parsed = _call_claude(client, cfg["scout"]["model"], prompt)
    except Exception as e:
        print(f"[scout]   {vid}: claude error: {e}", file=sys.stderr)
        return 0

    clips = parsed.get("clips", [])
    min_score = int(cfg["scout"]["min_virality_score"])
    min_s = float(cfg["scout"]["min_clip_seconds"])
    max_s = float(cfg["scout"]["max_clip_seconds"])

    kept = 0
    with db.connect() as conn:
        for clip in clips:
            try:
                start = float(clip["start"])
                end = float(clip["end"])
                score = int(clip.get("virality_score", 0))
                fmt = clip.get("format", "context_explainer")
                vo = (clip.get("vo_script") or "").strip()
            except (KeyError, TypeError, ValueError):
                continue
            dur = end - start
            if dur < min_s or dur > max_s:
                print(f"[scout]   reject (duration {dur:.1f}s): {clip.get('hook','')[:60]}")
                continue
            if score < min_score:
                print(f"[scout]   reject (score {score}): {clip.get('hook','')[:60]}")
                continue
            if not vo:
                print(f"[scout]   reject (empty VO): {clip.get('hook','')[:60]}")
                continue
            db.insert(conn, "clips", {
                "video_id": vid,
                "start_s": start,
                "end_s":   end,
                "format":  fmt,
                "hook":    clip.get("hook", ""),
                "vo_script": vo,
                "why_it_works": clip.get("why_it_works", ""),
                "virality_score": score,
                "status": "scouted",
            })
            kept += 1
            print(f"[scout]   ✓ kept score={score} dur={dur:.1f}s — {clip.get('hook','')[:70]}")
        conn.execute("UPDATE candidates SET status = 'scouted' WHERE video_id = ?", (vid,))
    return kept


def run(cfg: dict) -> int:
    client = _client()
    with db.connect() as conn:
        cands = conn.execute(
            "SELECT * FROM candidates WHERE status = 'ingested' ORDER BY velocity DESC"
        ).fetchall()
        cands = [dict(r) for r in cands]
    if not cands:
        print("[scout] no ingested candidates")
        return 0

    total = 0
    for c in cands:
        print(f"[scout] {c['video_id']} — {c['title'][:80]}")
        total += _scout_one(cfg, client, c)
    print(f"[scout] {total} clip candidates kept across {len(cands)} sources")
    return total
