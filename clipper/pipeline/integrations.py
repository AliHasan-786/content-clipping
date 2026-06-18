"""Optional external AI/video tool integration readiness.

The local ffmpeg renderer remains the default path. These providers are
escape hatches for timeline-level polish, AI-generated b-roll, cloud renders,
or unified posting when a third-party tool is actually connected.
"""
from __future__ import annotations

import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent


PROVIDERS: dict[str, dict[str, Any]] = {
    "palmier_pro": {
        "name": "Palmier Pro",
        "category": "timeline MCP editor",
        "role": "AI timeline polish, generated b-roll/audio, manual export handoff",
        "env": ["PALMIER_MCP_URL"],
        "default_url": "http://127.0.0.1:19789/mcp",
        "needs": "Open Palmier Pro and connect its local MCP server.",
        "source": "https://github.com/palmier-io/palmier-pro",
    },
    "descript": {
        "name": "Descript",
        "category": "API/MCP editor",
        "role": "Underlord edits, filler removal, Studio Sound, captions, highlight reels",
        "env": ["DESCRIPT_API_TOKEN", "DESCRIPT_MCP_CONNECTED"],
        "needs": "Connect Descript MCP or set DESCRIPT_API_TOKEN.",
        "source": "https://help.descript.com/hc/en-us/articles/43370311322509-Descript-API",
    },
    "shotstack": {
        "name": "Shotstack",
        "category": "cloud render API",
        "role": "Template/cloud rendering fallback for high-volume batches",
        "env": ["SHOTSTACK_API_KEY"],
        "needs": "Set SHOTSTACK_API_KEY.",
        "source": "https://shotstack.io/product/video-editing-api/",
    },
    "creatomate": {
        "name": "Creatomate",
        "category": "template render API",
        "role": "Reusable templates for quote cards, recaps, and social variants",
        "env": ["CREATOMATE_API_KEY"],
        "needs": "Set CREATOMATE_API_KEY.",
        "source": "https://creatomate.com/",
    },
    "json2video": {
        "name": "JSON2Video",
        "category": "template render API",
        "role": "Simple JSON renders for cards, subtitles, voiceover-led formats",
        "env": ["JSON2VIDEO_API_KEY"],
        "needs": "Set JSON2VIDEO_API_KEY.",
        "source": "https://json2video.com/",
    },
    "runway": {
        "name": "Runway",
        "category": "generative media API",
        "role": "Generated b-roll or AI video edits where source footage is not usable",
        "env": ["RUNWAY_API_KEY"],
        "needs": "Set RUNWAY_API_KEY.",
        "source": "https://docs.dev.runwayml.com/",
    },
    "ayrshare": {
        "name": "Ayrshare",
        "category": "unified posting API",
        "role": "Fallback publisher if native platform APIs become too much maintenance",
        "env": ["AYRSHARE_API_KEY"],
        "needs": "Set AYRSHARE_API_KEY.",
        "source": "https://www.ayrshare.com/docs/apis/post/post",
    },
}


def _provider_cfg(cfg: dict, key: str) -> dict:
    return (
        cfg.get("integrations", {})
        .get("providers", {})
        .get(key, {})
    )


def _truthy_env(name: str) -> bool:
    value = os.environ.get(name, "").strip()
    return value not in {"", "0", "false", "False", "no", "NO"}


def _local_mcp_alive(url: str, timeout: float = 0.25) -> bool:
    try:
        req = urllib.request.Request(url, method="GET")
        urllib.request.urlopen(req, timeout=timeout).close()
        return True
    except urllib.error.HTTPError as exc:
        # MCP endpoints may reject GET but still prove that the server is up.
        return exc.code < 500
    except Exception:
        return False


def _configured(key: str, provider: dict, provider_cfg: dict) -> tuple[bool, str | None]:
    if key == "palmier_pro":
        url = (
            os.environ.get("PALMIER_MCP_URL")
            or provider_cfg.get("mcp_url")
            or provider.get("default_url")
        )
        if _local_mcp_alive(str(url)):
            return True, str(url)
        app_path = os.environ.get("PALMIER_APP_PATH") or provider_cfg.get("app_path")
        if app_path and Path(str(app_path)).exists():
            return True, str(app_path)
        return False, str(url)

    for env_name in provider.get("env", []):
        if _truthy_env(env_name):
            return True, env_name
    return False, None


def status(cfg: dict) -> list[dict]:
    """Return dashboard/CLI-friendly status rows for optional providers."""
    rows: list[dict] = []
    for key, provider in PROVIDERS.items():
        provider_cfg = _provider_cfg(cfg, key)
        enabled = bool(provider_cfg.get("enabled", False))
        configured, detail = _configured(key, provider, provider_cfg) if enabled else (False, None)
        rows.append({
            "key": key,
            "name": provider["name"],
            "category": provider["category"],
            "role": provider["role"],
            "enabled": enabled,
            "configured": configured,
            "ready": enabled and configured,
            "detail": detail,
            "needs": provider["needs"],
            "source": provider["source"],
        })
    return rows


def print_status(cfg: dict) -> int:
    rows = status(cfg)
    print("external AI/video integrations:")
    for row in rows:
        if row["ready"]:
            state = "ready"
        elif row["enabled"]:
            state = "needs setup"
        else:
            state = "off"
        print(f"  {row['name']:<14} {state:<12} {row['category']}")
        print(f"    use: {row['role']}")
        if row["detail"]:
            print(f"    detail: {row['detail']}")
        if not row["ready"]:
            print(f"    needs: {row['needs']}")
    return sum(1 for row in rows if row["ready"])


if __name__ == "__main__":
    import yaml

    with open(ROOT / "config.yaml") as f:
        config = yaml.safe_load(f)
    sys.exit(0 if print_status(config) else 1)
