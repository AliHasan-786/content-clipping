"""Stage 3 — SCOUT.

Read each ingested transcript, send it to Claude with `prompts/scout.md`,
parse the JSON back, gate on `virality_score`, and persist clip candidates
to the `clips` table with status `scouted`.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402
from pipeline import ai, learning  # noqa: E402

PROMPT_PATH = ROOT / "prompts" / "scout.md"
DOWNLOADS = ROOT / "data" / "downloads"


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


def _build_prompt(cfg: dict, cand: dict, tx: dict, feedback_profile: str) -> str:
    template = PROMPT_PATH.read_text()
    return (template
            .replace("{niche}", cfg["niche"])
            .replace("{max_clips}", str(cfg["scout"]["max_clips_per_source"]))
            .replace("{title}", cand.get("title") or "(unknown)")
            .replace("{channel}", cand.get("channel") or "(unknown)")
            .replace("{duration}", str(cand.get("duration_s") or int(tx.get("duration") or 0)))
            .replace("{feedback_profile}", feedback_profile)
            .replace("{transcript}", _format_transcript(tx, cfg["scout"]["min_clip_seconds"])))


def _extract_json(text: str) -> dict:
    # Strip ```json fences if Claude added them despite instructions.
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise ValueError("no JSON object found in model response")
    return json.loads(m.group(0))


def _resolve_media(cand: dict) -> Path | None:
    noted = cand.get("notes")
    if noted and Path(noted).exists():
        return Path(noted)
    vid = cand.get("video_id")
    for ext in (".mp4", ".mkv", ".webm", ".mov"):
        path = DOWNLOADS / f"{vid}{ext}"
        if path.exists():
            return path
    return None


def _sample_frames(cfg: dict, cand: dict, duration: float) -> list[Path]:
    frame_cfg = cfg.get("scout", {}).get("visual_frames", {})
    if not frame_cfg.get("enabled", False) or not shutil.which("ffmpeg"):
        return []
    media = _resolve_media(cand)
    if not media:
        return []

    max_frames = max(0, int(frame_cfg.get("max_frames", 4)))
    if max_frames <= 0:
        return []

    tmp = Path(tempfile.mkdtemp(prefix="clip_scout_frames_"))
    usable_duration = max(duration, 1.0)
    frames: list[Path] = []
    for idx in range(max_frames):
        pct = (idx + 1) / (max_frames + 1)
        ts = usable_duration * pct
        out = tmp / f"frame_{idx+1}.jpg"
        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{ts:.2f}",
            "-i", str(media),
            "-frames:v", "1",
            "-vf", "scale=480:-1",
            "-q:v", "4",
            str(out),
        ]
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if out.exists() and out.stat().st_size > 0:
                frames.append(out)
        except subprocess.CalledProcessError:
            continue
    return frames


def _call_claude(model: str, prompt: str, frames: list[Path]) -> dict:
    return ai.call_json(model, prompt, max_tokens=4096, image_paths=frames)


def _scout_one(cfg: dict, cand: dict, feedback_profile: str) -> int:
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
    prompt = _build_prompt(cfg, cand, tx, feedback_profile)
    duration = float(cand.get("duration_s") or tx.get("duration") or 0)
    frames = _sample_frames(cfg, cand, duration)
    frame_dir = frames[0].parent if frames else None

    try:
        parsed = _call_claude(cfg["scout"]["model"], prompt, frames)
    except Exception as e:
        print(f"[scout]   {vid}: claude error: {e}", file=sys.stderr)
        return 0
    finally:
        if frame_dir:
            shutil.rmtree(frame_dir, ignore_errors=True)

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
                "why_it_works": "",
                "virality_score": score,
                "metadata_json": db.jdumps({
                    "clip_ai": {
                        "variants": clip.get("variants") or {},
                        "safety_review": clip.get("safety_review") or {},
                        "self_check": clip.get("self_check", ""),
                        "visual_frames_used": len(frames),
                    }
                }),
                "status": "scouted",
            })
            kept += 1
            print(f"[scout]   ✓ kept score={score} dur={dur:.1f}s — {clip.get('hook','')[:70]}")
        conn.execute("UPDATE candidates SET status = 'scouted' WHERE video_id = ?", (vid,))
    return kept


def run(cfg: dict) -> int:
    ai.require_available(cfg)
    profile = learning.approval_profile()
    feedback_profile = learning.prompt_context(profile)
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
        total += _scout_one(cfg, c, feedback_profile)
    print(f"[scout] {total} clip candidates kept across {len(cands)} sources")
    return total
