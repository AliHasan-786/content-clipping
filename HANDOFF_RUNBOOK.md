# Clipper Handoff Runbook

This repo is not handoff-ready until `clip doctor` prints `handoff readiness: READY`.

## One-time setup

Run these from the repo root:

```bash
python3 -m pip install -r clipper/requirements.txt
brew install ffmpeg yt-dlp
python3 clipper/clip.py initdb
python3 clipper/clip.py doctor
```

## Required credentials

### YouTube Shorts

Get credentials:

- Enable YouTube Data API v3: https://console.cloud.google.com/apis/library/youtube.googleapis.com
- Create OAuth desktop credentials: https://console.cloud.google.com/apis/credentials
- Official upload guide: https://developers.google.com/youtube/v3/guides/uploading_a_video

Install locally:

```bash
python3 clipper/clip.py auth youtube --client-secret /path/to/client_secret.json
python3 clipper/clip.py auth youtube --login
```

### Instagram Reels

Requirements:

- Instagram Professional account.
- Facebook Page linked to that Instagram account.
- Meta developer app with Instagram Content Publishing access.
- A public URL base for rendered MP4s, because Instagram Graph API publishes video by URL.

Get credentials:

- Meta app dashboard: https://developers.facebook.com/apps/
- Instagram publishing docs: https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Instagram platform overview: https://developers.facebook.com/docs/instagram-platform/overview/

Add to `clipper/.env`:

```bash
IG_USER_ID=...
IG_ACCESS_TOKEN=...
IG_PUBLIC_CLIP_BASE=https://your-public-video-host.example.com/clips
```

### TikTok

Requirements:

- TikTok developer app.
- Login Kit access so the account can authorize the app.
- Content Posting API product added to the app.
- `video.upload` scope for draft/inbox upload.
- Later: `video.publish` approval if you want direct public posting instead of app-side draft review.

Get credentials:

- TikTok developer portal: https://developers.tiktok.com/
- Content Posting API: https://developers.tiktok.com/products/content-posting-api/
- Login Kit token docs: https://developers.tiktok.com/doc/login-kit-manage-user-access-tokens/

Current app limitation: this repo can store and use a TikTok access token, but it does not yet run the TikTok OAuth login flow itself. Generate the token from your TikTok developer app/OAuth flow, then save it:

```bash
python3 clipper/clip.py auth tiktok \
  --client-key ... \
  --client-secret ... \
  --access-token ... \
  --open-id ...
```

### Reddit Discovery

Reddit credentials are required for reliable daily trend discovery. Anonymous Reddit JSON can be blocked, and RSS-only ranking is intentionally disabled by default because it does not provide trustworthy engagement counts.

Get credentials:

- Reddit app console: https://www.reddit.com/prefs/apps
- Reddit OAuth docs: https://github.com/reddit-archive/reddit/wiki/oauth2

Install locally:

```bash
python3 clipper/clip.py auth reddit \
  --client-id ... \
  --client-secret ... \
  --user-agent "content-clipping-trend-scout/0.1 by u/YOUR_REDDIT_USERNAME"
```

### Claude / Anthropic

Used for trend triage, caption variants, source-finding help, and safety review.

Get credentials:

- Anthropic API keys: https://console.anthropic.com/settings/keys
- Claude API quickstart: https://docs.anthropic.com/en/docs/get-started

Install locally:

```bash
python3 clipper/clip.py auth anthropic
```

### X / Twitter

X is optional and not currently required by the dashboard. Use it later if you want automated tweet discovery.

Get credentials:

- X developer access: https://docs.x.com/x-api/getting-started/getting-access
- X bearer tokens: https://docs.x.com/fundamentals/authentication/oauth-2-0/bearer-tokens

Add to `clipper/.env`:

```bash
X_BEARER_TOKEN=...
```

## Required source setup

Actual source-footage clips only appear if `clipper/SOURCES.md` contains approved downloadable feeds.

Add YouTube channels, handles, playlists, or RSS feeds that you are allowed to clip:

```text
yt_handle: @SomeApprovedChannel
yt_playlist: PL...
rss: https://example.com/feed.xml
```

Trend ideas live in `clipper/TREND_SOURCES.md`. They are not automatic proof of rights. They help find topics, discussion posts, or official/licensed sources.

## Daily operator flow

```bash
python3 clipper/clip.py doctor
python3 clipper/clip.py run
python3 clipper/clip.py review
```

In the dashboard:

1. Watch the full rendered video.
2. Open the source if context/rights are unclear.
3. Approve only the clips you would actually post.
4. Click `Post approved`.

CLI fallback:

```bash
python3 clipper/clip.py post
```

## Current known gaps

- TikTok OAuth is not fully automated in this repo yet; the app expects an access token.
- Instagram needs a public clip host or tunnel before Reels publishing works.
- The source allowlist must be filled with real approved feeds before the system can produce daily source-footage clips.
- Direct TikTok public posting requires TikTok app approval; until then, the app can upload to draft/inbox and a person taps publish in TikTok.
