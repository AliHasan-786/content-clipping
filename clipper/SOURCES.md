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
# yt_handle: @Ludwig                  # streamer/pop-culture commentary; review rights/context first
# yt_handle: @GoodMythicalMorning     # evergreen funny moments; use only approved/clip-friendly sources
# yt_handle: @FirstWeFeast            # celebrity/pop-culture interview moments; commentary layer required
# rss: https://www.reddit.com/r/popculturechat/top/.rss
