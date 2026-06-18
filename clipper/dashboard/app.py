"""Stage 6 — REVIEW dashboard.

FastAPI app at `localhost:<port>`. One page, server-rendered, vanilla JS for
the per-card form posts. The owner's entire daily job lives here.

  GET  /                 → list of pending_review clips
  GET  /clip/{id}/media  → serve the rendered MP4 inline
  POST /clip/{id}/save   → persist edited per-platform metadata + toggles
  POST /clip/{id}/approve → mark approved
  POST /clip/{id}/reject  → mark rejected, capture reason
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402

app = FastAPI(title="Clipper Review")
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


@app.get("/", response_class=HTMLResponse)
def index(request: Request, show: str = "pending_review"):
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

    clips = []
    for r in rows:
        d = dict(r)
        d["metadata"] = db.jloads(d.get("metadata_json")) or {}
        clips.append(d)

    return templates.TemplateResponse(
        "review.html",
        {"request": request, "clips": clips, "show": show, "counts": counts},
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
    return RedirectResponse(url="/", status_code=303)


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
