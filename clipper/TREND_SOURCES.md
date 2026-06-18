# Trendjacking source allowlist

# HUMAN-EDITED ONLY. This file is for daily trend discovery, not automatic
# reposting. The pipeline stores opportunities with a rights posture:
#   allowed         = safe format/source class, still review before posting
#   review_required = interesting, but owner must confirm rights/context
#   blocked         = do not repost
#
# Format:
#   type: identifier | key=value | key=value   # optional note
#
# Source types:
#   reddit_hot: r/subreddit
#   reddit_top: r/subreddit
#   rss: https://example.com/feed.xml
#   manual_url: https://example.com/post | kind=social_text | title=...
#
# Useful kind values:
#   social_text              X/Twitter-style post screenshot or text discussion
#   reddit_discussion        Reddit post/comment screenshot card
#   official_clip            Official publisher/team/channel clip
#   licensed_clip            Explicitly licensed/permissioned clip
#   public_domain_clip       Public domain source
#   creator_owned_clip       Content from an account you own/control
#   streamer_clip            Streamer/YouTuber moment; review rights first
#   movie_clip               Studio/movie footage; review rights first
#   sports_highlight         League/team/broadcast footage; review rights first
#   concert_clip             Live music/event footage; review rights first
#   random_video             Random viral video; review rights first
#   clipping_account_repost  Viral repost from another clipping account; find original/official source first
#   independent_creator_repost  Independent TikTok/Reels/etc.; blocked by default
#
# Active broad viral/funny lane sources. These queue discussion/screenshot-card
# opportunities only; linked creator videos still need separate rights review.
reddit_top: r/LivestreamFail | kind=reddit_discussion
reddit_top: r/gaming | kind=reddit_discussion
reddit_top: r/sports | kind=reddit_discussion
reddit_top: r/popculturechat | kind=reddit_discussion
reddit_top: r/OutOfTheLoop | kind=reddit_discussion

# Manual examples:
# manual_url: https://x.com/example/status/123 | kind=social_text | title=viral streamer tweet
# manual_url: https://www.youtube.com/watch?v=... | kind=official_clip | rights=allowed | permission=official | title=official sports highlight
# manual_url: https://www.tiktok.com/@clipsaccount/video/... | kind=clipping_account_repost | rights=review_required | title=viral repost signal
