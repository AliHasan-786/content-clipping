# Allowlist of approved source feeds

# HUMAN-EDITED ONLY. The pipeline will refuse to ingest anything whose source is
# not listed here. Bias the list toward clip-encouraged / CC / news-commentary
# sources. Anything ambiguous goes through the owner first.
#
# Format: one entry per line, `type: identifier   # optional note`
#   yt_channel:    UCxxxxxxxxxxxxxxxxxx     YouTube channel ID (UC…)
#   yt_handle:     @handle                  YouTube @-handle (resolved at runtime)
#   yt_playlist:   PLxxxxxxxxxxxxxxxxxx     YouTube playlist ID
#   rss:           https://example.com/feed.xml
#
# Lines starting with `#` are comments. Blank lines ignored.
#
# Trending tweets / Reddit posts / evergreen viral moments belong in
# TREND_SOURCES.md instead. This allowlist is for source media that can be
# downloaded/transcribed into actual clips.

# --- Seed examples (replace with your actual approved sources) ---
# yt_handle: @AllInPodcast            # AI/tech commentary — clip-friendly culture
# yt_handle: @lexfridman              # long-form, easy to find self-contained moments
# yt_handle: @TheVerge                # tech news, fair-use commentary territory
# rss: https://feeds.megaphone.fm/hardfork   # NYT Hard Fork podcast
