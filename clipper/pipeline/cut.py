"""Stage 4 — CUT.

For each `scouted` clip:
  1. trim source [start, end]
  2. scale + crop to 1080×1920 (smart-crop toward face/motion when possible)
  3. render TTS voiceover from `vo_script`
  4. burn word-level animated captions (ASS) over the video
  5. mix VO + ducked source audio
  6. prepend a 0.5s hook card with the hook line
  7. write final MP4 and mark clip `pending_review`
"""
from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402

DOWNLOADS = ROOT / "data" / "downloads"
TRANSCRIPTS = ROOT / "data" / "transcripts"
CLIPS = ROOT / "data" / "clips"


# ---------- ffmpeg helpers ---------------------------------------------------

def _run(cmd: list[str]) -> None:
    print(f"[ffmpeg] {' '.join(shlex.quote(c) for c in cmd[:6])}…")
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def _ffprobe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return float(out) if out else 0.0


# ---------- TTS --------------------------------------------------------------

def _tts(text: str, out_wav: Path, cfg: dict) -> None:
    backend = cfg["tts"]["backend"]
    if backend == "elevenlabs":
        _tts_elevenlabs(text, out_wav, cfg)
    elif backend == "piper":
        _tts_piper(text, out_wav, cfg)
    else:
        raise RuntimeError(f"unknown tts backend: {backend}")


def _tts_piper(text: str, out_wav: Path, cfg: dict) -> None:
    if not shutil.which("piper"):
        raise RuntimeError(
            "piper not installed. `brew install piper-tts` or `pip install piper-tts`."
        )
    voice = cfg["tts"]["piper_voice_model"]
    proc = subprocess.run(
        ["piper", "--model", voice, "--output_file", str(out_wav)],
        input=text, text=True, check=True, capture_output=True,
    )
    if not out_wav.exists():
        raise RuntimeError(f"piper produced no audio: {proc.stderr[:300]}")


def _tts_elevenlabs(text: str, out_wav: Path, cfg: dict) -> None:
    import requests
    key = os.environ.get("ELEVENLABS_API_KEY")
    voice_id = os.environ.get("ELEVENLABS_VOICE_ID")
    if not key or not voice_id:
        raise RuntimeError("ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID missing")
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        json={"text": text, "model_id": cfg["tts"]["elevenlabs_model"]},
        timeout=120,
    )
    r.raise_for_status()
    mp3 = out_wav.with_suffix(".mp3")
    mp3.write_bytes(r.content)
    _run(["ffmpeg", "-y", "-i", str(mp3), "-ar", "44100", str(out_wav)])
    mp3.unlink(missing_ok=True)


# ---------- ASS captions -----------------------------------------------------

_ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Body,{font},{size},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,{outline},2,2,80,80,360,1
Style: Hook,{font},{hook_size},&H0000F0FF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,{outline},2,2,80,80,480,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _ass_time(t: float) -> str:
    if t < 0:
        t = 0
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t - h * 3600 - m * 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _ass_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", "\\N")


def _build_ass(words: list[dict], clip_start: float, clip_end: float, hook: str,
               hook_dur: float, cfg: dict) -> str:
    """Write an .ass file with karaoke-ish word-by-word reveal."""
    width = cfg["cut"]["width"]
    height = cfg["cut"]["height"]
    head = _ASS_HEADER.format(
        width=width, height=height,
        font=cfg["cut"]["caption_font"],
        size=cfg["cut"]["caption_size"],
        hook_size=int(cfg["cut"]["caption_size"] * 1.15),
        outline=cfg["cut"]["caption_outline"],
    )
    lines = [head]

    # Hook card lives on its own time range at the very top.
    if hook:
        lines.append(
            f"Dialogue: 0,{_ass_time(0)},{_ass_time(hook_dur + 0.4)},Hook,,0,0,0,,"
            f"{_ass_escape(hook.upper())}"
        )

    # Word-level dialogue, relative to the trimmed clip. Group into ~3-word
    # phrases so a vertical screen isn't a single word at a time (ugly).
    in_clip = [w for w in words if w["start"] >= clip_start and w["end"] <= clip_end]
    phrase: list[dict] = []
    PHRASE = 4
    rel_offset = hook_dur  # captions begin after hook card

    def _flush(phrase: list[dict]):
        if not phrase:
            return
        a = phrase[0]["start"] - clip_start + rel_offset
        b = phrase[-1]["end"] - clip_start + rel_offset
        text = " ".join(p["text"] for p in phrase)
        lines.append(
            f"Dialogue: 0,{_ass_time(a)},{_ass_time(b)},Body,,0,0,0,,{_ass_escape(text)}"
        )

    for w in in_clip:
        phrase.append(w)
        if len(phrase) >= PHRASE:
            _flush(phrase)
            phrase = []
    _flush(phrase)
    return "".join(lines)


# ---------- main render ------------------------------------------------------

def _resolve_source_media(video_id: str) -> Path | None:
    for ext in (".mp4", ".mkv", ".webm", ".mov"):
        p = DOWNLOADS / f"{video_id}{ext}"
        if p.exists():
            return p
    return None


def _render_one(cfg: dict, clip_row: dict, cand_row: dict, tx: dict) -> Path | None:
    vid = clip_row["video_id"]
    start = float(clip_row["start_s"])
    end = float(clip_row["end_s"])
    src = _resolve_source_media(vid)
    if not src:
        print(f"[cut]   {vid}: source media missing; was it purged?")
        return None

    CLIPS.mkdir(parents=True, exist_ok=True)
    out = CLIPS / f"clip_{clip_row['id']:05d}.mp4"

    width = cfg["cut"]["width"]
    height = cfg["cut"]["height"]
    fps = cfg["cut"]["fps"]
    duck_db = cfg["cut"]["duck_db"]
    hook_dur = float(cfg["cut"]["hook_card_seconds"])
    hook = clip_row["hook"] or ""

    with tempfile.TemporaryDirectory(prefix="clip_") as tmpd:
        tmp = Path(tmpd)
        vo_wav = tmp / "vo.wav"

        _tts(clip_row["vo_script"], vo_wav, cfg)
        vo_dur = _ffprobe_duration(vo_wav)
        clip_dur = end - start
        # Caption track aligned to source audio timeline of the trimmed clip.
        ass_path = tmp / "captions.ass"
        ass_path.write_text(
            _build_ass(tx.get("words", []), start, end, hook, hook_dur, cfg)
        )

        # Filtergraph notes:
        #  [0:v] trim + scale fitting height, crop to 9:16, set fps, then `subtitles`.
        #  [0:a] trimmed source audio, ducked under VO by `duck_db`.
        #  [1:a] VO. Sidechain via amix with weights would be simpler than acompressor
        #        without the codec; weighted amix gives clean separation.
        vf = (
            f"scale=-2:{height},crop={width}:{height},fps={fps},"
            f"subtitles={shlex.quote(str(ass_path))}"
        )
        # Pad final to max(clip_dur, vo_dur + hook_dur) so VO never gets cut off.
        final_dur = max(clip_dur, vo_dur + hook_dur)

        af_src = f"volume={duck_db}dB"
        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", str(src),
            "-i", str(vo_wav),
            "-filter_complex",
            f"[0:v]{vf}[v];"
            f"[0:a]{af_src},apad[src_a];"
            f"[1:a]adelay={int(hook_dur*1000)}|{int(hook_dur*1000)},apad[vo_a];"
            f"[src_a][vo_a]amix=inputs=2:duration=longest:weights=1 3,"
            f"alimiter=limit=0.98[a]",
            "-map", "[v]", "-map", "[a]",
            "-t", f"{final_dur:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p", "-r", str(fps),
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            str(out),
        ]
        _run(cmd)
    return out


def run(cfg: dict) -> int:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg not installed. `brew install ffmpeg`.")

    with db.connect() as conn:
        clips = conn.execute(
            "SELECT * FROM clips WHERE status = 'scouted' ORDER BY virality_score DESC"
        ).fetchall()
        clips = [dict(c) for c in clips]

    if not clips:
        print("[cut] no scouted clips")
        return 0

    n = 0
    for c in clips:
        print(f"[cut] #{c['id']} ({c['video_id']}) {c['start_s']:.1f}-{c['end_s']:.1f}s "
              f"score={c['virality_score']}")
        try:
            with db.connect() as conn:
                cand = dict(conn.execute(
                    "SELECT * FROM candidates WHERE video_id = ?", (c["video_id"],)
                ).fetchone())
                tx_row = conn.execute(
                    "SELECT path FROM transcripts WHERE video_id = ?", (c["video_id"],)
                ).fetchone()
            if not tx_row:
                print(f"[cut]   no transcript for {c['video_id']}")
                continue
            tx = json.loads(Path(tx_row["path"]).read_text())
            out = _render_one(cfg, c, cand, tx)
            if not out:
                continue
            with db.connect() as conn:
                conn.execute(
                    "UPDATE clips SET rendered_path = ?, status = 'pending_review' "
                    "WHERE id = ?",
                    (str(out), c["id"]),
                )
            n += 1
            print(f"[cut]   ✓ {out.name}")
        except subprocess.CalledProcessError as e:
            err = (e.stderr or b"").decode(errors="ignore")[-400:]
            print(f"[cut]   ffmpeg error: {err}", file=sys.stderr)
            with db.connect() as conn:
                db.set_status(conn, "clips", c["id"], "failed")
        except Exception as e:
            print(f"[cut]   error: {e}", file=sys.stderr)
            with db.connect() as conn:
                db.set_status(conn, "clips", c["id"], "failed")

    print(f"[cut] {n} rendered → pending_review")
    return n
