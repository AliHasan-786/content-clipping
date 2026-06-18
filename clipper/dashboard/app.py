"""Stage 6 — REVIEW dashboard.

FastAPI app at `localhost:<port>`. One page, server-rendered, vanilla JS for
the per-card form posts. The owner's entire daily job lives here.

  GET  /                 → list of pending_review clips
  GET  /clip/{id}/media  → serve the rendered MP4 inline
  POST /clip/{id}/save   → persist edited per-platform metadata + toggles
  POST /clip/{id}/approve → mark approved
  POST /clip/{id}/reject  → mark rejected, capture reason
  POST /clip/{id}/polish  → create external editor handoff package
  POST /trend/{id}/approve → approve non-blocked trend treatment
  POST /trend/{id}/reject  → reject/dismiss trend opportunity
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

import yaml
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402

try:
    from dotenv import load_dotenv  # noqa: E402
    load_dotenv(ROOT / ".env")
except Exception:
    pass

app = FastAPI(title="Clipper Review")
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


def _load_config() -> dict:
    with open(ROOT / "config.yaml") as f:
        return yaml.safe_load(f)


def _posting_status(cfg: dict) -> list[dict]:
    def env_path_exists(name: str, default: str) -> bool:
        return Path(os.environ.get(name, default)).exists()

    post_cfg = cfg.get("post", {})
    platforms = [
        {
            "name": "YouTube",
            "enabled": bool(post_cfg.get("youtube", {}).get("enabled")),
            "configured": env_path_exists("YT_TOKEN_FILE", "secrets/yt_token.json"),
            "needs": "OAuth token file from first YouTube login",
        },
        {
            "name": "Instagram",
            "enabled": bool(post_cfg.get("instagram", {}).get("enabled")),
            "configured": all(os.environ.get(k) for k in ["IG_USER_ID", "IG_ACCESS_TOKEN", "IG_PUBLIC_CLIP_BASE"]),
            "needs": "IG_USER_ID, IG_ACCESS_TOKEN, IG_PUBLIC_CLIP_BASE",
        },
        {
            "name": "TikTok",
            "enabled": bool(post_cfg.get("tiktok", {}).get("enabled")),
            "configured": bool(os.environ.get("TIKTOK_ACCESS_TOKEN")),
            "needs": "TIKTOK_ACCESS_TOKEN",
        },
    ]
    for platform in platforms:
        platform["ready"] = bool(platform["enabled"] and platform["configured"])
    return platforms


def _ai_ready(cfg: dict) -> bool:
    return bool(cfg.get("ai", {}).get("enabled", True) and os.environ.get("ANTHROPIC_API_KEY"))


def _integration_status(cfg: dict) -> list[dict]:
    from pipeline import integrations

    return integrations.status(cfg)


def _queue_trend_source_candidate(trend_id: int) -> None:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM trend_opportunities WHERE id = ?",
            (trend_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "trend opportunity not found")
        if row["rights_status"] != "allowed":
            raise HTTPException(400, "source video trends require allowed rights status")
        if row["recommended_format"] != "commentary_clip":
            raise HTTPException(400, "only commentary_clip trends can be queued as source footage")

        video_id = f"trendsrc_{trend_id:06d}"
        db.upsert_candidate(conn, {
            "source_type": "trend_source",
            "source_id": row["source_id"],
            "video_id": video_id,
            "url": row["url"],
            "title": row["title"],
            "channel": row["author"] or row["source_kind"],
            "published_at": row["published_at"],
            "duration_s": None,
            "views": row["score"],
            "velocity": row["velocity"],
            "status": "new",
            "notes": f"queued from trend opportunity #{trend_id}",
        })
        conn.execute(
            "UPDATE trend_opportunities SET status = 'queued_source', notes = ? WHERE id = ?",
            (f"queued source candidate {video_id}; run clip run to ingest/scout/cut", trend_id),
        )


@app.get("/", response_class=HTMLResponse)
def index(request: Request, show: str = "pending_review", notice: Optional[str] = None):
    cfg = _load_config()
    with db.connect() as conn:
        if show == "all":
            rows = conn.execute(
                "SELECT c.*, v.title AS source_title, v.channel AS source_channel, v.url AS source_url "
                "FROM clips c LEFT JOIN candidates v ON v.video_id = c.video_id "
                "ORDER BY c.id DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT c.*, v.title AS source_title, v.channel AS source_channel, v.url AS source_url "
                "FROM clips c LEFT JOIN candidates v ON v.video_id = c.video_id "
                "WHERE c.status = ? ORDER BY c.virality_score DESC, c.id DESC",
                (show,),
            ).fetchall()
        counts = dict((r["status"], r["c"]) for r in conn.execute(
            "SELECT status, COUNT(*) c FROM clips GROUP BY status"
        ).fetchall())
        trend_rows = conn.execute(
            "SELECT * FROM trend_opportunities "
            "WHERE status IN ('new', 'blocked') "
            "ORDER BY CASE rights_status "
            "WHEN 'allowed' THEN 0 WHEN 'review_required' THEN 1 ELSE 2 END, "
            "trend_score DESC, id DESC LIMIT 25"
        ).fetchall()
        trend_counts = dict((r["status"], r["c"]) for r in conn.execute(
            "SELECT status, COUNT(*) c FROM trend_opportunities GROUP BY status"
        ).fetchall())
        recent_posts = conn.execute(
            "SELECT p.*, c.hook AS clip_hook "
            "FROM posts p LEFT JOIN clips c ON c.id = p.clip_id "
            "ORDER BY p.id DESC LIMIT 8"
        ).fetchall()

    clips = []
    for r in rows:
        d = dict(r)
        d["metadata"] = db.jloads(d.get("metadata_json")) or {}
        clips.append(d)

    trends = []
    for r in trend_rows:
        d = dict(r)
        d["evidence"] = db.jloads(d.get("evidence_json")) or {}
        trends.append(d)

    posting_status = _posting_status(cfg)
    return templates.TemplateResponse(
        "review.html",
        {
            "request": request,
            "clips": clips,
            "show": show,
            "counts": counts,
            "trends": trends,
            "trend_counts": trend_counts,
            "posting_status": posting_status,
            "post_ready_count": sum(1 for p in posting_status if p["ready"]),
            "integration_status": _integration_status(cfg),
            "recent_posts": [dict(r) for r in recent_posts],
            "notice": notice,
            "ai_ready": _ai_ready(cfg),
        },
    )


@app.get("/clip/{clip_id}/media")
def media(clip_id: int):
    with db.connect() as conn:
        row = conn.execute("SELECT rendered_path FROM clips WHERE id = ?", (clip_id,)).fetchone()
    if not row or not row["rendered_path"]:
        raise HTTPException(404, "clip media not found")
    p = Path(row["rendered_path"])
    if not p.exists():
        raise HTTPException(404, f"file missing: {p}")
    return FileResponse(p, media_type="video/mp4")


@app.post("/clip/{clip_id}/save")
async def save(clip_id: int, request: Request):
    form = await request.form()
    metadata = {
        "youtube": {
            "title":       form.get("yt_title", "").strip(),
            "description": form.get("yt_description", "").strip(),
            "tags": [t.strip() for t in form.get("yt_tags", "").split(",") if t.strip()],
            "enabled":     form.get("yt_enabled") == "on",
        },
        "tiktok": {
            "caption":  form.get("tt_caption", "").strip(),
            "hashtags": [h.strip() for h in form.get("tt_hashtags", "").split() if h.strip()],
            "enabled":  form.get("tt_enabled") == "on",
        },
        "instagram": {
            "caption":  form.get("ig_caption", "").strip(),
            "hashtags": [h.strip() for h in form.get("ig_hashtags", "").split() if h.strip()],
            "first_comment_hashtags": [h.strip() for h in form.get("ig_first_comment", "").split() if h.strip()],
            "enabled":  form.get("ig_enabled") == "on",
        },
    }
    with db.connect() as conn:
        conn.execute(
            "UPDATE clips SET metadata_json = ? WHERE id = ?",
            (db.jdumps(metadata), clip_id),
        )
    return RedirectResponse(url="/", status_code=303)


@app.post("/clip/{clip_id}/approve")
def approve(clip_id: int):
    with db.connect() as conn:
        conn.execute("UPDATE clips SET status = 'approved' WHERE id = ?", (clip_id,))
    return RedirectResponse(url="/?show=approved", status_code=303)


@app.post("/clip/{clip_id}/reject")
async def reject(clip_id: int, request: Request):
    form = await request.form()
    reason = form.get("reason", "").strip() or None
    with db.connect() as conn:
        conn.execute(
            "UPDATE clips SET status = 'rejected', reject_reason = ? WHERE id = ?",
            (reason, clip_id),
        )
    return RedirectResponse(url="/", status_code=303)


@app.post("/clip/{clip_id}/ai-assist")
async def ai_assist(clip_id: int, request: Request):
    cfg = _load_config()
    if not _ai_ready(cfg):
        return RedirectResponse(
            url=f"/?show=pending_review&notice=ai_needs_key#clip-{clip_id}",
            status_code=303,
        )
    form = await request.form()
    action = (form.get("action") or "Generate better caption variants").strip()
    try:
        from pipeline import package
        package.rewrite_clip_metadata(cfg, clip_id, action)
        return RedirectResponse(
            url=f"/?show=pending_review&notice=ai_updated#clip-{clip_id}",
            status_code=303,
        )
    except Exception as exc:
        return RedirectResponse(
            url=f"/?show=pending_review&notice=ai_failed#clip-{clip_id}",
            status_code=303,
        )


@app.post("/clip/{clip_id}/polish")
async def polish_handoff(clip_id: int, request: Request):
    cfg = _load_config()
    form = await request.form()
    provider = (form.get("provider") or "palmier_pro").strip()
    copy_media = form.get("copy_media") == "on"
    try:
        from pipeline import polish
        polish.export_handoff(cfg, clip_id=clip_id, provider=provider, copy_media=copy_media)
        return RedirectResponse(
            url=f"/?show=pending_review&notice=polish_created#clip-{clip_id}",
            status_code=303,
        )
    except Exception:
        return RedirectResponse(
            url=f"/?show=pending_review&notice=polish_failed#clip-{clip_id}",
            status_code=303,
        )


@app.post("/post-approved")
def post_approved():
    cfg = _load_config()
    if not any(p["ready"] for p in _posting_status(cfg)):
        return RedirectResponse(url="/?show=approved&notice=posting_needs_credentials", status_code=303)

    from pipeline import post as poster

    posted = poster.run(cfg)
    if posted:
        return RedirectResponse(url="/?show=posted&notice=posted", status_code=303)
    return RedirectResponse(url="/?show=approved&notice=post_attempt_failed", status_code=303)


@app.post("/schedule-approved")
def schedule_approved():
    cfg = _load_config()
    try:
        from pipeline import schedule
        updated = schedule.apply_schedule(cfg)
    except Exception:
        updated = 0
    notice = "schedule_updated" if updated else "schedule_empty"
    return RedirectResponse(url=f"/?show=approved&notice={notice}", status_code=303)


@app.post("/trend/{trend_id}/approve")
def approve_trend(trend_id: int):
    should_render = False
    should_queue_source = False
    with db.connect() as conn:
        row = conn.execute(
            "SELECT rights_status, recommended_format FROM trend_opportunities WHERE id = ?",
            (trend_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "trend opportunity not found")
        if row["rights_status"] == "blocked":
            raise HTTPException(400, "blocked trend opportunities cannot be approved")
        conn.execute("UPDATE trend_opportunities SET status = 'approved' WHERE id = ?", (trend_id,))
        should_render = row["rights_status"] == "allowed" and row["recommended_format"] == "screenshot_card"
        should_queue_source = row["rights_status"] == "allowed" and row["recommended_format"] == "commentary_clip"
    if should_render:
        from pipeline import cut
        cut.render_approved_trends(_load_config(), trend_id=trend_id)
        return RedirectResponse(url="/?show=pending_review", status_code=303)
    if should_queue_source:
        _queue_trend_source_candidate(trend_id)
        return RedirectResponse(url="/#trend-queue", status_code=303)
    return RedirectResponse(url="/#trend-queue", status_code=303)


@app.post("/trend/{trend_id}/reject")
async def reject_trend(trend_id: int, request: Request):
    form = await request.form()
    reason = form.get("reason", "").strip() or None
    with db.connect() as conn:
        conn.execute(
            "UPDATE trend_opportunities SET status = 'rejected', notes = ? WHERE id = ?",
            (reason, trend_id),
        )
    return RedirectResponse(url="/#trend-queue", status_code=303)
