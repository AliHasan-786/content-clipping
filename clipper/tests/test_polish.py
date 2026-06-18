from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import db
from pipeline import polish


CFG = {
    "niche": "Funny and viral internet culture",
    "cut": {"width": 1080, "height": 1920, "fps": 30},
}


CLIP = {
    "id": 12,
    "video_id": "abc123",
    "format": "context_explainer",
    "status": "pending_review",
    "start_s": 10.0,
    "end_s": 42.5,
    "hook": "This moment aged instantly",
    "vo_script": "Here is the missing context behind the joke.",
    "why_it_works": "Clear setup and payoff.",
    "virality_score": 91,
    "metadata_json": db.jdumps({
        "youtube": {"title": "Test Short"},
        "tiktok": {"caption": "test"},
        "instagram": {"caption": "test"},
        "safety_review": {"status": "review", "flags": ["rights"]},
    }),
}


CANDIDATE = {
    "title": "Original viral clip",
    "channel": "OfficialChannel",
    "url": "https://example.com/video",
    "source_type": "youtube",
    "published_at": "2026-06-18T12:00:00Z",
}


PROVIDER = {
    "name": "Palmier Pro",
    "category": "timeline MCP editor",
    "ready": False,
    "needs": "Open Palmier Pro.",
    "source": "https://github.com/palmier-io/palmier-pro",
}


class PolishManifestTests(unittest.TestCase):
    def test_manifest_contains_editor_handoff_context(self):
        manifest = polish._build_manifest(
            CFG,
            "palmier_pro",
            CLIP,
            CANDIDATE,
            None,
            PROVIDER,
            {"rendered_mp4": "/tmp/rendered.mp4", "source_media": None, "transcript_json": None},
        )

        self.assertEqual(manifest["provider"], "palmier_pro")
        self.assertEqual(manifest["clip"]["duration_s"], 32.5)
        self.assertEqual(manifest["source"]["title"], "Original viral clip")
        self.assertEqual(manifest["platform_metadata"]["youtube"]["title"], "Test Short")
        self.assertIn("VO script", " ".join(manifest["provider_instructions"]))
        self.assertIn("Do not turn a rights-review item into a raw repost.", manifest["polish_goals"])


if __name__ == "__main__":
    unittest.main()
