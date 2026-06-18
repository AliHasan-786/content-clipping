from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import db
from pipeline import brief


ROWS = [
    {
        "id": 1,
        "title": "Reddit debate post",
        "url": "https://reddit.com/r/example/1",
        "trend_score": 92,
        "source_kind": "reddit_discussion",
        "rights_status": "allowed",
        "recommended_format": "screenshot_card",
        "treatment": "Render card.",
        "evidence_json": db.jdumps({"ai_triage": {"hook": "Everyone picked a side"}}),
    },
    {
        "id": 2,
        "title": "Streamer clip repost",
        "url": "https://example.com/clip",
        "trend_score": 88,
        "source_kind": "clipping_account_repost",
        "rights_status": "review_required",
        "recommended_format": "rights_review",
        "treatment": "Find source.",
        "evidence_json": db.jdumps({"ai_triage": {"source_search_queries": ["official streamer clip source"]}}),
    },
    {
        "id": 3,
        "title": "Raw TikTok repost",
        "url": "https://tiktok.com/@creator/video/1",
        "trend_score": 75,
        "source_kind": "raw_tiktok_repost",
        "rights_status": "blocked",
        "recommended_format": "do_not_repost",
        "treatment": "Do not repost.",
        "evidence_json": db.jdumps({}),
    },
]


class BriefTests(unittest.TestCase):
    def test_summarize_rows_groups_next_actions(self):
        summary = brief.summarize_rows(ROWS)

        self.assertEqual(summary["counts"]["total"], 3)
        self.assertEqual(summary["counts"]["allowed"], 1)
        self.assertEqual(summary["counts"]["review_required"], 1)
        self.assertEqual(summary["render_now"][0]["id"], 1)
        self.assertEqual(summary["rights_review"][0]["id"], 2)
        self.assertEqual(summary["blocked_signals"][0]["id"], 3)
        self.assertIn("official streamer clip source", summary["source_queries"])
        self.assertTrue(any("Render" in action for action in summary["next_actions"]))

    def test_format_markdown_contains_sections(self):
        text = brief.format_markdown(brief.summarize_rows(ROWS))

        self.assertIn("# Daily Trend Brief", text)
        self.assertIn("## Render now", text)
        self.assertIn("## Needs rights/source review", text)


if __name__ == "__main__":
    unittest.main()
