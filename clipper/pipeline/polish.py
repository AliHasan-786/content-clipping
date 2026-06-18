"""External editor polish handoff packages.

This stage prepares everything an AI editor connector needs without requiring
that connector to exist yet: rendered clip, source context, VO, metadata, and
provider-specific edit instructions.
"""
from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402
from pipeline import integrations  # noqa: E402

DOWNLOADS = ROOT / "data" / "downloads"
POLISH_DIR = ROOT / "data" / "polish"

PROVIDER_INSTRUCTIONS = {
    "palmier_pro": [
        "Open Palmier Pro and connect its local MCP server.",
        "Import the rendered MP4 first, then the source media if available.",
        "Use the VO script and platform metadata as the editorial source of truth.",
        "Add only value-add polish: tighter pacing, b-roll, sound design, caption styling, and visual emphasis.",
        "Export a 1080x1920 MP4 and replace the clip rendered_path only after owner review.",
    ],
    "descript": [
        "Import the rendered MP4 or source media into Descript.",
        "Use Underlord for captions, filler/silence cleanup, Studio Sound, and highlight variations.",
        "Keep the hook, attribution, and rights/safety notes intact.",
        "Export a vertical 1080x1920 MP4 and replace the clip rendered_path only after owner review.",
    ],
    "runway": [
        "Use this package to generate short b-roll or background visuals only.",
        "Do not replace the factual source moment with fabricated footage.",
        "Export generated assets and add them back through the local renderer or a timeline editor.",
    ],
}


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _source_media(video_id: str) -> Path | None:
    for ext in (".mp4", ".mkv", ".webm", ".mov"):
        path = DOWNLOADS / f"{video_id}{ext}"
        if path.exists():
            return path
    return None


def _provider_row(cfg: dict, provider: str) -> dict[str, Any]:
    rows = integrations.status(cfg)
    for row in rows:
        if row["key"] == provider:
            return row
    raise ValueError(f"unknown polish provider: {provider}")


def _copy_optional(src: Path | None, dest: Path | None) -> str | None:
    if not src or not src.exists() or not dest:
        return str(src) if src else None
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return str(dest)


def _load_clip_context(clip_id: int) -> tuple[dict, dict, dict | None]:
    with db.connect() as conn:
        clip_row = conn.execute("SELECT * FROM clips WHERE id = ?", (clip_id,)).fetchone()
        if not clip_row:
            raise ValueError(f"clip #{clip_id} not found")
        clip = dict(clip_row)
        cand_row = conn.execute(
            "SELECT * FROM candidates WHERE video_id = ?",
            (clip["video_id"],),
        ).fetchone()
        tx_row = conn.execute(
            "SELECT * FROM transcripts WHERE video_id = ?",
            (clip["video_id"],),
        ).fetchone()
    return clip, dict(cand_row) if cand_row else {}, dict(tx_row) if tx_row else None


def _build_manifest(
    cfg: dict,
    provider: str,
    clip: dict,
    candidate: dict,
    transcript: dict | None,
    provider_status: dict,
    files: dict[str, str | None],
) -> dict[str, Any]:
    metadata = db.jloads(clip.get("metadata_json")) or {}
    safety = metadata.get("safety_review") or metadata.get("clip_ai", {}).get("safety_review") or {}
    source_search = metadata.get("source_search") or {}
    return {
        "created_at": _now(),
        "provider": provider,
        "provider_status": {
            "name": provider_status["name"],
            "category": provider_status["category"],
            "ready": provider_status["ready"],
            "needs": provider_status["needs"],
            "source": provider_status["source"],
        },
        "project": {
            "niche": cfg.get("niche"),
            "render_size": {
                "width": cfg.get("cut", {}).get("width"),
                "height": cfg.get("cut", {}).get("height"),
                "fps": cfg.get("cut", {}).get("fps"),
            },
        },
        "clip": {
            "id": clip["id"],
            "video_id": clip["video_id"],
            "format": clip["format"],
            "status": clip["status"],
            "start_s": clip["start_s"],
            "end_s": clip["end_s"],
            "duration_s": round(float(clip["end_s"]) - float(clip["start_s"]), 3),
            "hook": clip.get("hook"),
            "vo_script": clip.get("vo_script"),
            "why_it_works": clip.get("why_it_works"),
            "virality_score": clip.get("virality_score"),
            "safety_review": safety,
            "source_search": source_search,
        },
        "source": {
            "title": candidate.get("title"),
            "channel": candidate.get("channel"),
            "url": candidate.get("url"),
            "source_type": candidate.get("source_type"),
            "published_at": candidate.get("published_at"),
        },
        "files": files,
        "platform_metadata": {
            "youtube": metadata.get("youtube") or {},
            "tiktok": metadata.get("tiktok") or {},
            "instagram": metadata.get("instagram") or {},
            "variants": metadata.get("variants") or {},
        },
        "polish_goals": [
            "Keep the first three seconds hook-forward.",
            "Do not remove visible attribution from screenshot/commentary cards.",
            "Do not turn a rights-review item into a raw repost.",
            "Improve pacing, captions, visual emphasis, and sound without changing facts.",
        ],
        "provider_instructions": PROVIDER_INSTRUCTIONS.get(provider, [
            "Use this handoff as source context for optional external polish.",
            "Export a final MP4 for dashboard review before posting.",
        ]),
        "transcript": {
            "path": transcript.get("path") if transcript else None,
            "duration_s": transcript.get("duration_s") if transcript else None,
            "language": transcript.get("language") if transcript else None,
        },
    }


def _write_brief(manifest: dict[str, Any], path: Path) -> None:
    clip = manifest["clip"]
    source = manifest["source"]
    lines = [
        f"# Polish Brief: Clip #{clip['id']}",
        "",
        f"Provider: {manifest['provider_status']['name']}",
        f"Ready: {manifest['provider_status']['ready']}",
        f"Source: {source.get('title') or source.get('url') or clip['video_id']}",
        f"Hook: {clip.get('hook') or ''}",
        "",
        "## Voiceover",
        "",
        clip.get("vo_script") or "",
        "",
        "## Goals",
        "",
    ]
    lines.extend(f"- {goal}" for goal in manifest["polish_goals"])
    lines.extend(["", "## Provider Instructions", ""])
    lines.extend(f"- {step}" for step in manifest["provider_instructions"])
    lines.extend(["", "## Files", ""])
    for key, value in manifest["files"].items():
        lines.append(f"- {key}: {value or 'missing'}")
    path.write_text("\n".join(lines) + "\n")


def export_handoff(cfg: dict, clip_id: int, provider: str, copy_media: bool = False) -> Path:
    provider_status = _provider_row(cfg, provider)
    clip, candidate, transcript = _load_clip_context(clip_id)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = POLISH_DIR / f"clip_{clip_id:05d}_{provider}_{timestamp}"
    out_dir.mkdir(parents=True, exist_ok=True)

    rendered = Path(clip["rendered_path"]) if clip.get("rendered_path") else None
    source = _source_media(clip["video_id"])
    transcript_path = Path(transcript["path"]) if transcript and transcript.get("path") else None

    files = {
        "rendered_mp4": _copy_optional(rendered, out_dir / "rendered.mp4" if copy_media else None),
        "source_media": _copy_optional(source, out_dir / f"source{source.suffix}" if copy_media and source else None),
        "transcript_json": _copy_optional(transcript_path, out_dir / "transcript.json" if copy_media else None),
    }

    manifest = _build_manifest(cfg, provider, clip, candidate, transcript, provider_status, files)
    manifest_path = out_dir / "manifest.json"
    brief_path = out_dir / "brief.md"
    metadata_path = out_dir / "platform_metadata.json"

    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    _write_brief(manifest, brief_path)
    metadata_path.write_text(
        json.dumps(manifest["platform_metadata"], indent=2, ensure_ascii=False) + "\n"
    )

    metadata = db.jloads(clip.get("metadata_json")) or {}
    metadata["polish_handoff"] = {
        "provider": provider,
        "path": str(out_dir),
        "manifest": str(manifest_path),
        "created_at": manifest["created_at"],
        "provider_ready": provider_status["ready"],
    }
    with db.connect() as conn:
        conn.execute(
            "UPDATE clips SET metadata_json = ? WHERE id = ?",
            (db.jdumps(metadata), clip_id),
        )
    return out_dir
