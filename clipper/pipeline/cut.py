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
import textwrap
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


# ---------- trend screenshot cards ------------------------------------------

def _font(size: int, bold: bool = False):
    try:
        from PIL import ImageFont
    except ImportError:
        raise RuntimeError("Pillow not installed. `pip install -r clipper/requirements.txt`.")

    names = (
        ("Arial Bold.ttf", "Arial.ttf") if bold else ("Arial.ttf", "Helvetica.ttc")
    )
    candidates = []
    for name in names:
        candidates.extend([
            Path("/System/Library/Fonts/Supplemental") / name,
            Path("/Library/Fonts") / name,
            Path("/usr/share/fonts/truetype/dejavu") / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"),
        ])
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def _text_width(draw, text: str, font) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return int(box[2] - box[0])


def _wrap_for_width(draw, text: str, font, max_width: int) -> list[str]:
    words = text.split()
    if not words:
        return []
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if _text_width(draw, candidate, font) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
                current = word
            else:
                lines.extend(textwrap.wrap(word, width=18) or [word])
                current = ""
    if current:
        lines.append(current)
    return lines


def _draw_wrapped(draw, xy: tuple[int, int], text: str, font, fill, max_width: int,
                  line_gap: int = 12, max_lines: int | None = None) -> int:
    x, y = xy
    lines = _wrap_for_width(draw, text, font, max_width)
    if max_lines is not None and len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(". ") + "..."
    line_h = draw.textbbox((0, 0), "Ag", font=font)[3] + line_gap
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += line_h
    return y


def _trend_video_id(row: dict) -> str:
    return f"trend_{int(row['id']):06d}"


def _trend_source_label(row: dict) -> str:
    if row.get("source_type", "").startswith("reddit"):
        src = row.get("source_id") or "reddit"
        return src if str(src).startswith("r/") else f"r/{src}"
    author = row.get("author")
    if author:
        return f"@{author}"
    return row.get("source_kind") or "trend"


def _trend_evidence(row: dict) -> dict:
    raw = row.get("evidence_json")
    if raw:
        return db.jloads(raw) or {}
    return row.get("evidence") or {}


def _trend_ai(row: dict) -> dict:
    return _trend_evidence(row).get("ai_triage") or {}


def _trend_hook(row: dict) -> str:
    ai_hook = _trend_ai(row).get("hook")
    if ai_hook:
        return str(ai_hook)[:140]
    kind = row.get("source_kind") or "trend"
    if kind == "reddit_discussion":
        return "The comment section is already split on this"
    if kind == "social_text":
        return "This post is turning into the debate of the day"
    return "The internet is already arguing about this"


def _trend_metadata(row: dict, cfg: dict) -> dict:
    title = (row.get("title") or "Viral internet moment").strip()
    short_title = title[:82].rstrip()
    source = _trend_source_label(row)
    triage = _trend_ai(row)
    safety = triage.get("safety_review") or {}
    conversation = (
        (triage.get("comment_mining") or {}).get("best_comment_prompt")
        or triage.get("conversation_prompt")
        or _trend_hook(row)
    )
    hashtags = ["#viral", "#funny", "#internetculture", "#streamers", "#gaming"]
    meta = {
        "youtube": {
            "title": short_title,
            "description": (
                f"{_trend_hook(row)}.\n"
                f"Source: {source} - {row.get('url')}\n"
                "#Shorts #viral #internetculture"
            ),
            "tags": ["viral", "funny", "internet culture", "streamers", "gaming"],
            "enabled": True,
        },
        "tiktok": {
            "caption": f"{_trend_hook(row).lower()} #viral #funny #internetculture",
            "hashtags": hashtags[:5],
            "enabled": True,
        },
        "instagram": {
            "caption": (
                f"{conversation}\n\n"
                "Screenshot-card commentary, with visible source attribution."
            ),
            "hashtags": hashtags,
            "first_comment_hashtags": ["#reels", "#popculture", "#sports", "#livestreamfails"],
            "enabled": True,
        },
        "variants": {
            "hooks": [h for h in [_trend_hook(row), title[:100], triage.get("conversation_prompt")] if h],
            "tiktok_captions": [c for c in [conversation, triage.get("hook")] if c],
        },
        "safety_review": safety or {
            "status": "ok",
            "flags": [],
            "note": "screenshot-card trend with visible attribution",
        },
        "source_search": {
            "queries": triage.get("source_search_queries") or [],
            "candidates": triage.get("source_candidates") or [],
        },
        "trend_ai": triage,
    }
    return meta


def _render_trend_card_image(cfg: dict, row: dict, out_png: Path) -> None:
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        raise RuntimeError("Pillow not installed. `pip install -r clipper/requirements.txt`.")

    width = int(cfg["cut"]["width"])
    height = int(cfg["cut"]["height"])
    card_cfg = cfg.get("trend", {}).get("screenshot_card", {})
    max_chars = int(card_cfg.get("max_text_chars", 420))

    img = Image.new("RGB", (width, height), (10, 12, 16))
    draw = ImageDraw.Draw(img)

    # Subtle bitmap background: dark base, warm/cool diagonals, no external assets.
    for y in range(height):
        r = 10 + int(18 * y / height)
        g = 12 + int(10 * y / height)
        b = 16 + int(24 * y / height)
        draw.line((0, y, width, y), fill=(r, g, b))
    draw.rectangle((0, 0, 28, height), fill=(40, 190, 175))
    draw.polygon([(width, 0), (width, 520), (width - 420, 0)], fill=(116, 92, 235))
    draw.polygon([(0, height), (0, height - 380), (360, height)], fill=(229, 68, 87))

    margin = 82
    card_x0, card_y0 = margin, 270
    card_x1, card_y1 = width - margin, height - 290
    draw.rounded_rectangle((card_x0, card_y0, card_x1, card_y1), radius=42, fill=(247, 249, 252))
    draw.rounded_rectangle((card_x0 + 8, card_y0 + 8, card_x1 - 8, card_y1 - 8), radius=34, outline=(224, 229, 236), width=3)

    label_font = _font(38, bold=True)
    title_font = _font(64, bold=True)
    body_font = _font(45)
    meta_font = _font(34)
    small_font = _font(28)

    source = _trend_source_label(row)
    score = row.get("trend_score") or 0
    badge = "TRENDING DISCUSSION"
    if row.get("source_kind") == "social_text":
        badge = "TRENDING POST"

    y = card_y0 + 56
    draw.rounded_rectangle((card_x0 + 54, y, card_x0 + 430, y + 64), radius=28, fill=(16, 20, 28))
    draw.text((card_x0 + 82, y + 13), badge, font=small_font, fill=(255, 255, 255))
    draw.rounded_rectangle((card_x1 - 188, y, card_x1 - 54, y + 64), radius=28, fill=(36, 211, 181))
    draw.text((card_x1 - 153, y + 12), str(score), font=label_font, fill=(8, 43, 37))
    y += 112

    title = (row.get("title") or "Viral moment").strip()
    title = title[:max_chars].strip()
    y = _draw_wrapped(
        draw,
        (card_x0 + 56, y),
        title,
        title_font,
        (12, 18, 28),
        card_x1 - card_x0 - 112,
        line_gap=16,
        max_lines=6,
    )
    y += 30

    comments = row.get("comments")
    score_text = f"{row.get('score') or 0:,} upvotes" if row.get("score") is not None else "high engagement"
    comments_text = f"{comments:,} comments" if comments is not None else "active discussion"
    meta = f"{source}  |  {score_text}  |  {comments_text}"
    y = _draw_wrapped(draw, (card_x0 + 56, y), meta, meta_font, (88, 98, 112), card_x1 - card_x0 - 112, line_gap=8, max_lines=3)
    y += 46

    draw.line((card_x0 + 56, y, card_x1 - 56, y), fill=(223, 229, 238), width=3)
    y += 54

    triage = _trend_ai(row)
    prompt = "Question: hilarious moment, valid outrage, or is everyone overreacting?"
    if row.get("source_kind") == "reddit_discussion":
        prompt = "Question: is the top comment right, or is the thread missing the point?"
    prompt = (
        (triage.get("comment_mining") or {}).get("best_comment_prompt")
        or triage.get("conversation_prompt")
        or prompt
    )
    _draw_wrapped(draw, (card_x0 + 56, y), prompt, body_font, (26, 32, 44), card_x1 - card_x0 - 112, line_gap=12, max_lines=4)

    footer = f"Source shown for attribution: {source} - {row.get('url')}"
    _draw_wrapped(draw, (margin, height - 205), footer, small_font, (215, 221, 230), width - margin * 2, line_gap=8, max_lines=2)
    draw.text((margin, height - 116), "Context card - not a raw repost", font=small_font, fill=(150, 229, 218))

    out_png.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_png)


def _render_trend_card_video(cfg: dict, row: dict, out_mp4: Path) -> None:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg not installed. `brew install ffmpeg`.")

    width = int(cfg["cut"]["width"])
    height = int(cfg["cut"]["height"])
    fps = int(cfg["cut"]["fps"])
    duration = float(cfg.get("trend", {}).get("screenshot_card", {}).get("duration_seconds", 12))

    with tempfile.TemporaryDirectory(prefix="trend_card_") as tmpd:
        png = Path(tmpd) / "card.png"
        _render_trend_card_image(cfg, row, png)
        out_mp4.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            "ffmpeg", "-y",
            "-loop", "1", "-i", str(png),
            "-f", "lavfi", "-i", f"anoisesrc=color=pink:duration={duration}:amplitude=0.018",
            "-f", "lavfi", "-i", f"sine=frequency=176:duration={duration}",
            "-filter_complex",
            "[1:a]volume=0.10[a1];[2:a]volume=0.018[a2];"
            "[a1][a2]amix=inputs=2:duration=first,alimiter=limit=0.85[a]",
            "-map", "0:v", "-map", "[a]",
            "-t", f"{duration:.3f}",
            "-vf", f"scale={width}:{height},format=yuv420p",
            "-r", str(fps),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            str(out_mp4),
        ]
        try:
            _run(cmd)
        except subprocess.CalledProcessError:
            fallback = [
                "ffmpeg", "-y",
                "-loop", "1", "-i", str(png),
                "-f", "lavfi", "-i", f"anullsrc=channel_layout=stereo:sample_rate=44100",
                "-t", f"{duration:.3f}",
                "-vf", f"scale={width}:{height},format=yuv420p",
                "-r", str(fps),
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                str(out_mp4),
            ]
            _run(fallback)


def render_approved_trends(cfg: dict, trend_id: int | None = None) -> int:
    duration = float(cfg.get("trend", {}).get("screenshot_card", {}).get("duration_seconds", 12))
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM trend_opportunities "
            "WHERE status = 'approved' "
            "AND rights_status = 'allowed' "
            "AND recommended_format = 'screenshot_card' "
            "AND (? IS NULL OR id = ?) "
            "ORDER BY trend_score DESC, id DESC",
            (trend_id, trend_id),
        ).fetchall()
        rows = [dict(r) for r in rows]

    if not rows:
        return 0

    rendered = 0
    for t in rows:
        video_id = _trend_video_id(t)
        out = CLIPS / f"{video_id}.mp4"
        print(f"[cut] trend #{t['id']} -> screenshot_card score={t['trend_score']}")
        try:
            _render_trend_card_video(cfg, t, out)
            with db.connect() as conn:
                db.upsert_candidate(conn, {
                    "source_type": "trend",
                    "source_id": t["source_id"],
                    "video_id": video_id,
                    "url": t["url"],
                    "title": t.get("title"),
                    "channel": _trend_source_label(t),
                    "published_at": t.get("published_at"),
                    "duration_s": int(duration),
                    "views": t.get("score"),
                    "velocity": t.get("velocity"),
                    "status": "rendered",
                })
                clip_id = db.insert(conn, "clips", {
                    "video_id": video_id,
                    "start_s": 0,
                    "end_s": duration,
                    "format": "screenshot_card",
                    "hook": _trend_hook(t),
                    "vo_script": _trend_ai(t).get("vo_script") or "",
                    "why_it_works": "",
                    "virality_score": t.get("trend_score"),
                    "rendered_path": str(out),
                    "metadata_json": db.jdumps(_trend_metadata(t, cfg)),
                    "status": "pending_review",
                })
                conn.execute(
                    "UPDATE trend_opportunities SET status = 'rendered', notes = ? WHERE id = ?",
                    (f"rendered clip #{clip_id}: {out}", t["id"]),
                )
            rendered += 1
            print(f"[cut]   trend card ready: {out.name}")
        except subprocess.CalledProcessError as e:
            err = (e.stderr or b"").decode(errors="ignore")[-400:]
            print(f"[cut]   trend ffmpeg error: {err}", file=sys.stderr)
            with db.connect() as conn:
                conn.execute(
                    "UPDATE trend_opportunities SET status = 'failed', notes = ? WHERE id = ?",
                    (err, t["id"]),
                )
        except Exception as e:
            print(f"[cut]   trend error: {e}", file=sys.stderr)
            with db.connect() as conn:
                conn.execute(
                    "UPDATE trend_opportunities SET status = 'failed', notes = ? WHERE id = ?",
                    (str(e), t["id"]),
                )

    return rendered


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

    trend_rendered = render_approved_trends(cfg)

    with db.connect() as conn:
        clips = conn.execute(
            "SELECT * FROM clips WHERE status = 'scouted' ORDER BY virality_score DESC"
        ).fetchall()
        clips = [dict(c) for c in clips]

    if not clips:
        if trend_rendered:
            print(f"[cut] {trend_rendered} trend cards rendered -> pending_review")
        else:
            print("[cut] no scouted clips")
        return trend_rendered

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

    total = n + trend_rendered
    print(f"[cut] {n} source clips, {trend_rendered} trend cards rendered -> pending_review")
    return total
