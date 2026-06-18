from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import trend_import


CFG = {
    "trend": {
        "allowed_source_kinds": [
            "official_clip",
            "licensed_clip",
            "public_domain_clip",
            "creator_owned_clip",
            "social_text",
            "reddit_discussion",
            "news_article",
        ],
        "review_required_source_kinds": [
            "streamer_clip",
            "movie_clip",
            "sports_highlight",
            "concert_clip",
            "random_video",
            "viral_clip",
            "reddit_linked_video",
            "clipping_account_repost",
        ],
        "blocked_source_kinds": [
            "independent_creator_repost",
            "raw_tiktok_repost",
            "private_person_video",
        ],
    }
}


class TrendImportTests(unittest.TestCase):
    def test_parse_external_csv_as_safe_text_trends(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "trends.csv"
            path.write_text(
                "Keyword,Search Volume,Growth Score\n"
                "funny streamer argument,125000,94\n"
            )

            rows = trend_import.parse_csv(path, CFG, source="vidiq", default_kind="social_text")

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "funny streamer argument")
        self.assertEqual(rows[0]["source_type"], "csv_import")
        self.assertEqual(rows[0]["rights_status"], "allowed")
        self.assertEqual(rows[0]["recommended_format"], "screenshot_card")
        self.assertEqual(rows[0]["trend_score"], 94)

    def test_tiktok_video_url_stays_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "trends.csv"
            path.write_text(
                "Title,URL,Views\n"
                "random creator video,https://www.tiktok.com/@creator/video/1,999999\n"
            )

            rows = trend_import.parse_csv(path, CFG, source="manual", default_kind="social_text")

        self.assertEqual(rows[0]["source_kind"], "raw_tiktok_repost")
        self.assertEqual(rows[0]["rights_status"], "blocked")
        self.assertEqual(rows[0]["recommended_format"], "do_not_repost")


if __name__ == "__main__":
    unittest.main()
