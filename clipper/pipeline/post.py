"""Stage 7 — POST.

Publishes `approved` clips to whichever platforms the metadata has toggled on.

  YouTube Shorts → Data API v3 (videos.insert, resumable upload).  Full auto.
  Instagram Reels → Graph API (media container → publish).         Full auto.
  TikTok        → Content Posting API (PULL_FROM_URL or FILE_UPLOAD).
                  Unaudited app: drafts only (SELF_ONLY). Owner taps publish.
                  Audited app (feature flag): direct publish.

Rate-limit notes (also encoded in CLIPPER_BUILD_SPEC.md):
  TikTok ≈ 6 req/min/token, ~15 posts/day.
  IG ≈ 50 posts/day.
  YT default quota ≈ 6 uploads/day (raise via Google Cloud request).
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402


# ---------- YouTube ---------------------------------------------------------

YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def _yt_service():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    cs = Path(os.environ.get("YT_CLIENT_SECRETS_FILE", "secrets/yt_client_secret.json"))
    tok = Path(os.environ.get("YT_TOKEN_FILE", "secrets/yt_token.json"))

    creds = None
    if tok.exists():
        creds = Credentials.from_authorized_user_file(str(tok), YT_SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not cs.exists():
                raise RuntimeError(
                    f"YouTube OAuth client_secrets file missing at {cs}. "
                    "Create one in Google Cloud Console → OAuth desktop app credentials."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(cs), YT_SCOPES)
            creds = flow.run_local_server(port=0)
        tok.parent.mkdir(parents=True, exist_ok=True)
        tok.write_text(creds.to_json())
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def _post_youtube(cfg: dict, clip: dict, meta: dict) -> tuple[str, str]:
    from googleapiclient.http import MediaFileUpload

    yt_cfg = cfg["post"]["youtube"]
    svc = _yt_service()
    body = {
        "snippet": {
            "title":       (meta.get("title") or clip["hook"] or "")[:100],
            "description": meta.get("description") or "",
            "tags":        meta.get("tags") or [],
            "categoryId":  str(yt_cfg["category_id"]),
        },
        "status": {
            "privacyStatus": yt_cfg["privacy_status"],
            "selfDeclaredMadeForKids": bool(yt_cfg["made_for_kids"]),
        },
    }
    media = MediaFileUpload(clip["rendered_path"], chunksize=-1, resumable=True, mimetype="video/mp4")
    req = svc.videos().insert(part="snippet,status", body=body, media_body=media)
    resp = None
    while resp is None:
        status, resp = req.next_chunk()
        if status:
            print(f"[post] yt upload {int(status.progress()*100)}%")
    vid = resp["id"]
    return vid, f"https://www.youtube.com/shorts/{vid}"


# ---------- Instagram -------------------------------------------------------

IG_GRAPH = "https://graph.facebook.com/v19.0"


def _post_instagram(cfg: dict, clip: dict, meta: dict) -> tuple[str, str]:
    import requests

    user_id = os.environ.get("IG_USER_ID")
    token = os.environ.get("IG_ACCESS_TOKEN")
    if not user_id or not token:
        raise RuntimeError("IG_USER_ID / IG_ACCESS_TOKEN missing")

    # Instagram requires a publicly-reachable URL for the video. The owner is
    # expected to expose `data/clips/` (e.g. via Cloudflare Tunnel, S3 sync,
    # or any static host) and put the base URL in IG_PUBLIC_CLIP_BASE.
    base = os.environ.get("IG_PUBLIC_CLIP_BASE")
    if not base:
        raise RuntimeError(
            "IG_PUBLIC_CLIP_BASE missing — IG requires a public video URL. "
            "Set this to a CDN/tunnel mapped to data/clips/."
        )
    public_url = base.rstrip("/") + "/" + Path(clip["rendered_path"]).name

    caption = (meta.get("caption") or "").strip()
    if meta.get("hashtags"):
        caption = caption.rstrip() + "\n\n" + " ".join(meta["hashtags"])

    # 1. Create media container.
    create = requests.post(
        f"{IG_GRAPH}/{user_id}/media",
        data={
            "media_type": "REELS",
            "video_url":  public_url,
            "caption":    caption,
            "share_to_feed": "true",
            "access_token": token,
        },
        timeout=60,
    )
    create.raise_for_status()
    container_id = create.json()["id"]

    # 2. Poll for FINISHED.
    deadline = time.time() + 300
    while time.time() < deadline:
        st = requests.get(
            f"{IG_GRAPH}/{container_id}",
            params={"fields": "status_code,status", "access_token": token},
            timeout=30,
        ).json()
        if st.get("status_code") == "FINISHED":
            break
        if st.get("status_code") == "ERROR":
            raise RuntimeError(f"IG container error: {st}")
        time.sleep(6)
    else:
        raise RuntimeError("IG container did not finish processing in 5 min")

    # 3. Publish.
    pub = requests.post(
        f"{IG_GRAPH}/{user_id}/media_publish",
        data={"creation_id": container_id, "access_token": token},
        timeout=60,
    )
    pub.raise_for_status()
    media_id = pub.json()["id"]

    # 4. Optional first-comment hashtag drop.
    fc = meta.get("first_comment_hashtags") or []
    if fc:
        try:
            requests.post(
                f"{IG_GRAPH}/{media_id}/comments",
                data={"message": " ".join(fc), "access_token": token},
                timeout=30,
            )
        except Exception as e:
            print(f"[post] ig first-comment failed: {e}", file=sys.stderr)

    return media_id, f"https://www.instagram.com/reel/{media_id}/"


# ---------- TikTok ----------------------------------------------------------

TIKTOK_API = "https://open.tiktokapis.com"


def _post_tiktok(cfg: dict, clip: dict, meta: dict) -> tuple[str, str]:
    """Push to drafts (unaudited path) or direct-publish (audited path)."""
    import requests

    token = os.environ.get("TIKTOK_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("TIKTOK_ACCESS_TOKEN missing")

    tt_cfg = cfg["post"]["tiktok"]
    direct = bool(tt_cfg.get("direct_post"))
    path = "/v2/post/publish/video/init/" if direct else "/v2/post/publish/inbox/video/init/"

    caption = (meta.get("caption") or "").strip()
    if meta.get("hashtags"):
        caption = caption.rstrip() + " " + " ".join(meta["hashtags"])

    file_size = Path(clip["rendered_path"]).stat().st_size
    init_body: dict = {
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": file_size,
            "chunk_size": file_size,
            "total_chunk_count": 1,
        }
    }
    if direct:
        init_body["post_info"] = {
            "title": caption[:150],
            "privacy_level": tt_cfg["privacy_level"],
            "disable_duet":    bool(tt_cfg["disable_duet"]),
            "disable_comment": bool(tt_cfg["disable_comment"]),
            "disable_stitch":  bool(tt_cfg["disable_stitch"]),
        }

    init = requests.post(
        TIKTOK_API + path,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"},
        json=init_body,
        timeout=60,
    )
    init.raise_for_status()
    data = init.json().get("data", {})
    upload_url = data["upload_url"]
    publish_id = data["publish_id"]

    with open(clip["rendered_path"], "rb") as f:
        up = requests.put(
            upload_url,
            data=f.read(),
            headers={
                "Content-Type":   "video/mp4",
                "Content-Range":  f"bytes 0-{file_size-1}/{file_size}",
            },
            timeout=300,
        )
    up.raise_for_status()

    # Drafts land in the user's TikTok inbox; they tap publish.
    if not direct:
        print("[post] tiktok → DRAFT uploaded. Open TikTok app → Inbox → tap publish.")
    return publish_id, "tiktok://inbox" if not direct else f"tiktok://publish/{publish_id}"


# ---------- orchestrator ----------------------------------------------------

PLATFORMS = [
    ("youtube",   _post_youtube,   "youtube"),
    ("instagram", _post_instagram, "instagram"),
    ("tiktok",    _post_tiktok,    "tiktok"),
]


def _select_approved(clip_id: int | None) -> list[dict]:
    with db.connect() as conn:
        if clip_id is not None:
            rows = conn.execute(
                "SELECT * FROM clips WHERE id = ? AND status = 'approved'", (clip_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM clips WHERE status = 'approved' ORDER BY id ASC"
            ).fetchall()
    return [dict(r) for r in rows]


def _record_post(clip_id: int, platform: str, status: str, external_id: str | None,
                 url: str | None, error: str | None) -> None:
    with db.connect() as conn:
        db.insert(conn, "posts", {
            "clip_id":     clip_id,
            "platform":    platform,
            "external_id": external_id,
            "url":         url,
            "status":      status,
            "error":       error,
        })


def run(cfg: dict, clip_id: int | None = None) -> int:
    clips = _select_approved(clip_id)
    if not clips:
        print("[post] no approved clips")
        return 0

    posted_anything = 0
    for clip in clips:
        if not clip.get("rendered_path") or not Path(clip["rendered_path"]).exists():
            print(f"[post] #{clip['id']}: rendered file missing, skipping")
            continue
        meta_all = db.jloads(clip.get("metadata_json")) or {}
        any_success = False
        any_attempt = False

        for platform, fn, meta_key in PLATFORMS:
            if not cfg["post"].get(platform, {}).get("enabled"):
                continue
            meta = meta_all.get(meta_key) or {}
            if meta.get("enabled") is False:
                continue
            any_attempt = True
            print(f"[post] #{clip['id']} → {platform}")
            try:
                ext_id, url = fn(cfg, clip, meta)
                _record_post(clip["id"], platform, "posted", ext_id, url, None)
                print(f"[post]   ✓ {url}")
                any_success = True
            except Exception as e:
                msg = str(e)[:400]
                _record_post(clip["id"], platform, "failed", None, None, msg)
                print(f"[post]   ✗ {platform} failed: {msg}", file=sys.stderr)

        if any_success:
            with db.connect() as conn:
                conn.execute(
                    "UPDATE clips SET status = 'posted', posted_at = datetime('now') WHERE id = ?",
                    (clip["id"],),
                )
            posted_anything += 1
        elif any_attempt:
            with db.connect() as conn:
                db.set_status(conn, "clips", clip["id"], "post_failed")

    print(f"[post] {posted_anything} clips posted to ≥1 platform")
    return posted_anything
