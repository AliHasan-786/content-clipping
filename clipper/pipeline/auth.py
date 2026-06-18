"""Credential setup and readiness helpers.

Secrets stay local under `clipper/.env` and `clipper/secrets/` by default.
Do not commit files written by this module.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
SECRETS = ROOT / "secrets"
YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def resolve_path(value: str | None, default: str) -> Path:
    """Resolve credential paths relative to `clipper/` unless absolute."""
    path = Path(value or default).expanduser()
    if path.is_absolute():
        return path
    return ROOT / path


def env_path(name: str, default: str) -> Path:
    return resolve_path(os.environ.get(name), default)


def _truthy(value: str | None) -> bool:
    return bool(value and value.strip() and value.strip().lower() not in {"0", "false", "no"})


def _read_env_lines() -> list[str]:
    if not ENV_PATH.exists():
        return []
    return ENV_PATH.read_text().splitlines()


def update_env(values: dict[str, str]) -> None:
    """Create/update simple KEY=value lines in clipper/.env."""
    lines = _read_env_lines()
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            out.append(line)
            continue
        key = stripped.split("=", 1)[0]
        if key in values:
            out.append(f"{key}={values[key]}")
            seen.add(key)
        else:
            out.append(line)

    missing = [key for key in values if key not in seen]
    if missing and out and out[-1].strip():
        out.append("")
    for key in missing:
        out.append(f"{key}={values[key]}")

    ENV_PATH.write_text("\n".join(out).rstrip() + "\n")
    for key, value in values.items():
        os.environ[key] = value


def _safe_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def youtube_secret_path() -> Path:
    return env_path("YT_CLIENT_SECRETS_FILE", "secrets/yt_client_secret.json")


def youtube_token_path() -> Path:
    return env_path("YT_TOKEN_FILE", "secrets/yt_token.json")


def validate_youtube_client_secret(path: Path) -> tuple[bool, str]:
    data = _safe_json(path)
    if not data:
        return False, "file is not valid JSON"
    app = data.get("installed") or data.get("web")
    if not isinstance(app, dict):
        return False, "missing installed/web OAuth client block"
    if not app.get("client_id") or not app.get("client_secret"):
        return False, "missing client_id/client_secret"
    if not app.get("auth_uri") or not app.get("token_uri"):
        return False, "missing auth_uri/token_uri"
    return True, "ok"


def install_youtube_client_secret(source_path: str) -> Path:
    src = Path(source_path).expanduser()
    if not src.exists():
        raise FileNotFoundError(f"YouTube client secret not found: {src}")
    valid, reason = validate_youtube_client_secret(src)
    if not valid:
        raise ValueError(f"invalid YouTube OAuth client secret: {reason}")

    dest = SECRETS / "yt_client_secret.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    update_env({
        "YT_CLIENT_SECRETS_FILE": "secrets/yt_client_secret.json",
        "YT_TOKEN_FILE": "secrets/yt_token.json",
    })
    return dest


def youtube_login() -> Path:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    secret = youtube_secret_path()
    token = youtube_token_path()
    if not secret.exists():
        raise FileNotFoundError(f"YouTube OAuth client secret missing: {secret}")

    creds = None
    if token.exists():
        creds = Credentials.from_authorized_user_file(str(token), YT_SCOPES)
    if creds and creds.valid:
        return token
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    else:
        flow = InstalledAppFlow.from_client_secrets_file(str(secret), YT_SCOPES)
        creds = flow.run_local_server(port=0)
    token.parent.mkdir(parents=True, exist_ok=True)
    token.write_text(creds.to_json())
    return token


def set_tiktok_credentials(
    client_key: str | None = None,
    client_secret: str | None = None,
    access_token: str | None = None,
    open_id: str | None = None,
) -> None:
    values = {
        "TIKTOK_CLIENT_KEY": client_key,
        "TIKTOK_CLIENT_SECRET": client_secret,
        "TIKTOK_ACCESS_TOKEN": access_token,
        "TIKTOK_OPEN_ID": open_id,
    }
    update_env({k: v for k, v in values.items() if v})


def set_anthropic_key(api_key: str) -> None:
    if not api_key.startswith("sk-ant-"):
        raise ValueError("Anthropic key should start with sk-ant-")
    update_env({"ANTHROPIC_API_KEY": api_key})


def set_ayrshare_key(api_key: str) -> None:
    update_env({"AYRSHARE_API_KEY": api_key})


def status(cfg: dict | None = None) -> list[dict[str, Any]]:
    secret = youtube_secret_path()
    token = youtube_token_path()
    secret_valid = False
    secret_note = "missing"
    if secret.exists():
        secret_valid, secret_note = validate_youtube_client_secret(secret)

    platforms = [
        {
            "key": "youtube",
            "name": "YouTube",
            "enabled": bool((cfg or {}).get("post", {}).get("youtube", {}).get("enabled", True)),
            "configured": token.exists(),
            "ready": token.exists(),
            "needs": "OAuth token. Run `clip auth youtube --login` after adding the client secret.",
            "details": {
                "client_secret": str(secret),
                "client_secret_ok": secret_valid,
                "client_secret_note": secret_note,
                "token": str(token),
                "token_exists": token.exists(),
            },
        },
        {
            "key": "instagram",
            "name": "Instagram",
            "enabled": bool((cfg or {}).get("post", {}).get("instagram", {}).get("enabled", True)),
            "configured": all(_truthy(os.environ.get(k)) for k in ["IG_USER_ID", "IG_ACCESS_TOKEN", "IG_PUBLIC_CLIP_BASE"]),
            "ready": all(_truthy(os.environ.get(k)) for k in ["IG_USER_ID", "IG_ACCESS_TOKEN", "IG_PUBLIC_CLIP_BASE"]),
            "needs": "IG_USER_ID, IG_ACCESS_TOKEN, IG_PUBLIC_CLIP_BASE.",
            "details": {
                "ig_user_id": bool(os.environ.get("IG_USER_ID")),
                "ig_access_token": bool(os.environ.get("IG_ACCESS_TOKEN")),
                "public_clip_base": bool(os.environ.get("IG_PUBLIC_CLIP_BASE")),
            },
        },
        {
            "key": "tiktok",
            "name": "TikTok",
            "enabled": bool((cfg or {}).get("post", {}).get("tiktok", {}).get("enabled", True)),
            "configured": _truthy(os.environ.get("TIKTOK_ACCESS_TOKEN")),
            "ready": _truthy(os.environ.get("TIKTOK_ACCESS_TOKEN")),
            "needs": "TIKTOK_ACCESS_TOKEN from TikTok Login Kit OAuth.",
            "details": {
                "client_key": bool(os.environ.get("TIKTOK_CLIENT_KEY")),
                "client_secret": bool(os.environ.get("TIKTOK_CLIENT_SECRET")),
                "access_token": bool(os.environ.get("TIKTOK_ACCESS_TOKEN")),
                "open_id": bool(os.environ.get("TIKTOK_OPEN_ID")),
            },
        },
        {
            "key": "anthropic",
            "name": "AI",
            "enabled": bool((cfg or {}).get("ai", {}).get("enabled", True)),
            "configured": _truthy(os.environ.get("ANTHROPIC_API_KEY")),
            "ready": _truthy(os.environ.get("ANTHROPIC_API_KEY")),
            "needs": "ANTHROPIC_API_KEY.",
            "details": {"api_key": bool(os.environ.get("ANTHROPIC_API_KEY"))},
        },
    ]
    for platform in platforms:
        platform["ready"] = bool(platform["enabled"] and platform["configured"])
    return platforms


def print_status(cfg: dict | None = None) -> int:
    rows = status(cfg)
    print("credential status:")
    for row in rows:
        state = "ready" if row["ready"] else "needs setup" if row["enabled"] else "off"
        print(f"  {row['name']:<10} {state}")
        if not row["ready"]:
            print(f"    needs: {row['needs']}")
        for key, value in row["details"].items():
            print(f"    {key}: {value}")
    return sum(1 for row in rows if row["ready"])


if __name__ == "__main__":
    import yaml

    with open(ROOT / "config.yaml") as f:
        config = yaml.safe_load(f)
    sys.exit(0 if print_status(config) else 1)
