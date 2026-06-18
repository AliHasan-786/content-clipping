"""Shared Anthropic helpers for optional LLM enrichment.

Every caller should treat AI output as advisory. Rights gates and deterministic
pipeline checks remain the source of truth.
"""
from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional


class AIUnavailable(RuntimeError):
    pass


def available(cfg: Optional[dict] = None) -> bool:
    if cfg is not None and not cfg.get("ai", {}).get("enabled", True):
        return False
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def require_available(cfg: Optional[dict] = None) -> None:
    if not available(cfg):
        raise AIUnavailable("ANTHROPIC_API_KEY missing or AI disabled")


def _client():
    try:
        from anthropic import Anthropic
    except ImportError:
        raise AIUnavailable("anthropic SDK not installed. `pip install -r clipper/requirements.txt`.")
    require_available()
    return Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("no JSON object found in model response")
    return json.loads(match.group(0))


def _image_block(path: Path) -> dict[str, Any]:
    mime = mimetypes.guess_type(str(path))[0] or "image/jpeg"
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": mime,
            "data": base64.b64encode(path.read_bytes()).decode("ascii"),
        },
    }


def call_json(
    model: str,
    prompt: str,
    max_tokens: int = 2048,
    image_paths: Optional[list[Path]] = None,
) -> dict[str, Any]:
    client = _client()
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for path in image_paths or []:
        if path.exists():
            content.append(_image_block(path))

    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": content}],
    )
    text = "".join(getattr(block, "text", "") for block in resp.content)
    return extract_json(text)


def safe_call_json(
    model: str,
    prompt: str,
    max_tokens: int = 2048,
    image_paths: Optional[list[Path]] = None,
    label: str = "ai",
) -> Optional[dict[str, Any]]:
    try:
        return call_json(model, prompt, max_tokens=max_tokens, image_paths=image_paths)
    except Exception as exc:
        print(f"[{label}] skipped: {exc}", file=sys.stderr)
        return None
