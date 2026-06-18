"""Stage 2 — INGEST.

Take the top-K `new` candidates, download with yt-dlp, transcribe with
faster-whisper (word-level timestamps), persist transcripts to disk + DB.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402

DOWNLOADS = ROOT / "data" / "downloads"
TRANSCRIPTS = ROOT / "data" / "transcripts"


@dataclass
class Word:
    start: float
    end: float
    text: str


def _ytdlp_download(url: str, fmt: str, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    template = str(out_dir / "%(id)s.%(ext)s")
    cmd = [
        "yt-dlp",
        "-f", fmt,
        "--merge-output-format", "mp4",
        "-o", template,
        "--no-progress",
        "--no-playlist",
        url,
    ]
    subprocess.run(cmd, check=True)
    # Resolve produced filename via `--print after_move:filepath` for safety.
    name = subprocess.run(
        ["yt-dlp", "-f", fmt, "--merge-output-format", "mp4",
         "--get-filename", "-o", template, url],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    p = Path(name)
    # yt-dlp may write .mp4 even when template ends differently after merge.
    if not p.exists():
        for alt in [p.with_suffix(".mp4"), p.with_suffix(".mkv"), p.with_suffix(".webm")]:
            if alt.exists():
                return alt
    return p


def _transcribe(audio_path: Path, model_name: str, device: str, compute: str) -> dict:
    """faster-whisper with word_timestamps=True → flat dict for JSON dump."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise RuntimeError("faster-whisper not installed. `pip install faster-whisper`.")

    model = WhisperModel(model_name, device=device, compute_type=compute)
    segments, info = model.transcribe(str(audio_path), word_timestamps=True, vad_filter=True)

    seg_out, words_out = [], []
    for s in segments:
        seg_out.append({"start": s.start, "end": s.end, "text": s.text})
        for w in (s.words or []):
            words_out.append({"start": w.start, "end": w.end, "text": w.word.strip()})
    return {
        "language": info.language,
        "duration": info.duration,
        "segments": seg_out,
        "words": words_out,
    }


def _select_candidates(limit: int) -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM candidates WHERE status = 'new' "
            "ORDER BY velocity DESC, discovered_at ASC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def run(cfg: dict) -> int:
    limit = int(cfg["ingest"]["max_daily_ingest"])
    fmt = cfg["ingest"]["yt_dlp_format"]
    model_name = cfg["ingest"]["whisper_model"]
    device = cfg["ingest"]["whisper_device"]
    compute = cfg["ingest"]["whisper_compute_type"]

    cands = _select_candidates(limit)
    if not cands:
        print("[ingest] no new candidates")
        return 0

    n_done = 0
    for c in cands:
        vid = c["video_id"]
        print(f"[ingest] {vid} — {c['title'][:80]}")
        try:
            t0 = time.time()
            media_path = _ytdlp_download(c["url"], fmt, DOWNLOADS)
            print(f"[ingest]   downloaded in {time.time()-t0:.1f}s → {media_path.name}")

            t1 = time.time()
            tx = _transcribe(media_path, model_name, device, compute)
            print(f"[ingest]   transcribed in {time.time()-t1:.1f}s "
                  f"({len(tx['words'])} words)")

            TRANSCRIPTS.mkdir(parents=True, exist_ok=True)
            tx_path = TRANSCRIPTS / f"{vid}.json"
            tx_path.write_text(json.dumps(tx, ensure_ascii=False))

            with db.connect() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO transcripts (video_id, path, duration_s, language) "
                    "VALUES (?, ?, ?, ?)",
                    (vid, str(tx_path), tx["duration"], tx["language"]),
                )
                conn.execute(
                    "UPDATE candidates SET status='ingested' WHERE video_id = ?",
                    (vid,),
                )
                conn.execute(
                    "UPDATE candidates SET notes = ? WHERE video_id = ?",
                    (str(media_path), vid),
                )
            n_done += 1
        except subprocess.CalledProcessError as e:
            print(f"[ingest]   yt-dlp failed: {e}", file=sys.stderr)
            with db.connect() as conn:
                db.set_status(conn, "candidates", vid, "failed", pk_col="video_id")
        except Exception as e:
            print(f"[ingest]   error: {e}", file=sys.stderr)
            with db.connect() as conn:
                db.set_status(conn, "candidates", vid, "failed", pk_col="video_id")

    print(f"[ingest] {n_done} ingested")
    return n_done


def purge_old_downloads(cfg: dict) -> int:
    """Delete media older than retention. Keeps transcripts (cheap on disk)."""
    retention_hours = int(cfg["ingest"]["download_retention_hours"])
    cutoff = time.time() - retention_hours * 3600
    n = 0
    if not DOWNLOADS.exists():
        return 0
    for p in DOWNLOADS.iterdir():
        try:
            if p.is_file() and p.stat().st_mtime < cutoff:
                p.unlink()
                n += 1
        except OSError:
            continue
    print(f"[purge] removed {n} files older than {retention_hours}h")
    return n
