from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import cut


CFG = {
    "niche": "Funny and viral moments across streamers, gaming, sports, pop culture, and internet culture",
    "cut": {
        "width": 540,
        "height": 960,
        "fps": 30,
    },
    "trend": {
        "screenshot_card": {
            "duration_seconds": 12,
            "max_text_chars": 420,
        }
    },
}


ROW = {
    "id": 7,
    "source_type": "reddit_hot",
    "source_id": "r/LivestreamFail",
    "source_kind": "reddit_discussion",
    "url": "https://www.reddit.com/r/LivestreamFail/comments/example",
    "title": "Streamer accidentally creates the funniest possible ending to a ranked match",
    "author": "clipfan",
    "score": 25000,
    "comments": 1800,
    "velocity": 900.0,
    "trend_score": 94,
    "treatment": "Render as a screenshot-card discussion with visible attribution.",
}


class CutTrendCardTests(unittest.TestCase):
    def test_trend_video_id_is_stable(self):
        self.assertEqual(cut._trend_video_id(ROW), "trend_000007")

    def test_trend_metadata_is_postable(self):
        metadata = cut._trend_metadata(ROW, CFG)

        self.assertTrue(metadata["youtube"]["enabled"])
        self.assertIn("Source:", metadata["youtube"]["description"])
        self.assertLessEqual(len(metadata["youtube"]["title"]), 100)
        self.assertIn("#viral", metadata["tiktok"]["hashtags"])

    def test_trend_hook_uses_title_not_generic_comment_section(self):
        hook = cut._trend_hook(ROW)

        self.assertIn("Streamer accidentally", hook)
        self.assertNotEqual(hook, "The comment section is already split on this")

    def test_render_trend_card_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "card.png"
            cut._render_trend_card_image(CFG, ROW, out)

            self.assertTrue(out.exists())
            self.assertGreater(out.stat().st_size, 1000)


if __name__ == "__main__":
    unittest.main()
