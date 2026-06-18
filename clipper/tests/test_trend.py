from __future__ import annotations

import tempfile
import unittest
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import trend


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


class TrendPipelineTests(unittest.TestCase):
    def test_parse_trend_sources_ignores_comments(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "TREND_SOURCES.md"
            path.write_text(
                "\n".join(
                    [
                        "# comment",
                        "reddit_hot: r/LivestreamFail | kind=reddit_discussion",
                        "manual_url: https://x.com/example/status/1 | kind=social_text | title=viral post",
                    ]
                )
            )

            sources = trend.parse_trend_sources(path)

        self.assertEqual([s.type for s in sources], ["reddit_hot", "manual_url"])
        self.assertEqual(sources[0].identifier, "r/LivestreamFail")
        self.assertEqual(sources[1].meta["title"], "viral post")

    def test_raw_tiktok_urls_are_blocked(self):
        src = trend.TrendSource(type="manual_url", identifier="https://tiktok.com/@creator/video/1", meta={})

        opp = trend._make_opp(
            src,
            url=src.identifier,
            title="viral creator video",
            author=None,
            published_at=trend._utc_now_iso(),
            score=5000,
            comments=600,
            evidence={},
            cfg=CFG,
        )

        self.assertEqual(opp.source_kind, "raw_tiktok_repost")
        self.assertEqual(opp.rights_status, "blocked")
        self.assertEqual(opp.recommended_format, "do_not_repost")

    def test_social_text_uses_screenshot_card(self):
        src = trend.TrendSource(type="manual_url", identifier="https://mobile.twitter.com/user/status/1", meta={})

        opp = trend._make_opp(
            src,
            url=src.identifier,
            title="viral debate post",
            author="user",
            published_at=trend._utc_now_iso(),
            score=1000,
            comments=250,
            evidence={},
            cfg=CFG,
        )

        self.assertEqual(opp.source_kind, "social_text")
        self.assertEqual(opp.rights_status, "allowed")
        self.assertEqual(opp.recommended_format, "screenshot_card")

    def test_ambiguous_youtube_clip_needs_rights_review(self):
        src = trend.TrendSource(type="manual_url", identifier="https://youtu.be/example", meta={})

        opp = trend._make_opp(
            src,
            url=src.identifier,
            title="iconic streamer clip",
            author=None,
            published_at=trend._utc_now_iso(),
            score=1000,
            comments=200,
            evidence={},
            cfg=CFG,
        )

        self.assertEqual(opp.source_kind, "viral_clip")
        self.assertEqual(opp.rights_status, "review_required")
        self.assertEqual(opp.recommended_format, "rights_review")

    def test_clipping_account_repost_needs_rights_review(self):
        src = trend.TrendSource(
            type="manual_url",
            identifier="https://tiktok.com/@clipsaccount/video/1",
            meta={"kind": "clipping_account_repost"},
        )

        opp = trend._make_opp(
            src,
            url=src.identifier,
            title="viral repost from another clips page",
            author="clipsaccount",
            published_at=trend._utc_now_iso(),
            score=50000,
            comments=1200,
            evidence={},
            cfg=CFG,
        )

        self.assertEqual(opp.source_kind, "clipping_account_repost")
        self.assertEqual(opp.rights_status, "review_required")
        self.assertEqual(opp.recommended_format, "rights_review")


if __name__ == "__main__":
    unittest.main()
