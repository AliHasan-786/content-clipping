import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import doctor  # noqa: E402


def _cfg():
    return {
        "trend": {"enabled": True},
        "ai": {"enabled": True},
        "post": {
            "youtube": {"enabled": True},
            "instagram": {"enabled": True},
            "tiktok": {"enabled": True},
        },
    }


def _auth_row(key, ready):
    return {
        "key": key,
        "name": key.title(),
        "enabled": True,
        "configured": ready,
        "ready": ready,
        "needs": f"{key} creds",
        "details": {},
    }


class DoctorTests(unittest.TestCase):
    def test_missing_credentials_and_sources_block_handoff(self):
        facts = {
            "auth": [
                _auth_row("youtube", False),
                _auth_row("instagram", False),
                _auth_row("tiktok", False),
                _auth_row("anthropic", False),
                _auth_row("reddit", False),
            ],
            "source_count": 0,
            "trend_source_count": 10,
            "queue": {"source_review": 0, "approved_source": 0, "card_clips": 0, "post_failed": 0},
            "tools": {"ffmpeg": True, "yt-dlp": True},
        }

        result = doctor.evaluate(_cfg(), facts)

        self.assertFalse(result["ready"])
        self.assertIn("youtube", result["missing_publishers"])
        self.assertTrue(any("SOURCES.md" in b for b in result["blockers"]))
        self.assertTrue(any("Reddit" in b for b in result["blockers"]))

    def test_all_core_requirements_ready_passes_with_low_queue_warning(self):
        facts = {
            "auth": [
                _auth_row("youtube", True),
                _auth_row("instagram", True),
                _auth_row("tiktok", True),
                _auth_row("anthropic", True),
                _auth_row("reddit", True),
            ],
            "source_count": 4,
            "trend_source_count": 10,
            "queue": {"source_review": 1, "approved_source": 1, "card_clips": 3, "post_failed": 0},
            "tools": {"ffmpeg": True, "yt-dlp": True},
        }

        result = doctor.evaluate(_cfg(), facts)

        self.assertTrue(result["ready"])
        self.assertTrue(any("target is 3-5 per day" in w for w in result["warnings"]))


if __name__ == "__main__":
    unittest.main()
