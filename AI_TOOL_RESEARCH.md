# AI Clip Pipeline Tool Research

Research date: 2026-06-18

This repo should stay local-first, but we can borrow workflow patterns from
commercial tools and selectively use APIs where they save real time.

## Platform Keys

### YouTube

Use Google Cloud + YouTube Data API v3 OAuth.

1. Create/select a Google Cloud project.
2. Enable **YouTube Data API v3**.
3. Configure the OAuth consent screen.
4. Create an OAuth client for a **Desktop app**.
5. Download the client secret JSON to `clipper/secrets/yt_client_secret.json`.
6. Run `clip post` once after approving a clip; the local OAuth browser flow saves `clipper/secrets/yt_token.json`.

Repo env:

```env
YT_CLIENT_SECRETS_FILE=secrets/yt_client_secret.json
YT_TOKEN_FILE=secrets/yt_token.json
```

Useful docs:
- https://developers.google.com/youtube/v3/guides/auth/installed-apps
- https://developers.google.com/youtube/v3/guides/authentication
- https://developers.google.com/workspace/guides/configure-oauth-consent

### TikTok

Use TikTok for Developers + Content Posting API.

1. Create a TikTok Developer account and register an app.
2. Add the **Content Posting API** product.
3. Request/enable `video.upload` for draft/inbox uploads.
4. Use Login Kit OAuth to get a user access token and open ID for your account.
5. Optional later: pass TikTok audit for `video.publish` direct posting. Without audit, uploaded content is private/draft-style and needs in-app completion.

Repo env:

```env
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_ACCESS_TOKEN=
TIKTOK_OPEN_ID=
```

Useful docs:
- https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content
- https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- https://developers.tiktok.com/products/content-posting-api/

## What To Borrow

### AI Clip Finding

Tools studied:
- OpusClip: https://www.opus.pro/
- Klap: https://klap.app/
- Vizard: https://vizard.ai/
- Descript Create Clips: https://help.descript.com/hc/en-us/articles/10119670449293-Create-clips-from-your-content

Patterns to keep:
- Transcript + visual frame analysis, not transcript alone.
- Multiple clip candidates per source with a virality/priority score.
- Fast preview-first queue: render enough for review quickly.
- Alternate hooks/captions so the owner can choose tone without writing from scratch.

Repo status:
- Implemented transcript scouting and optional sampled-frame context in `clipper/pipeline/scout.py`.
- Implemented variants/safety metadata in `clipper/pipeline/package.py`.

Next useful improvement:
- Add per-frame face/gameplay/action scoring before the LLM call so obvious dead sections are never sent to Claude.

### AI Editing Polish

Tools studied:
- Submagic: https://www.submagic.co/
- Captions.ai: https://captions.ai/
- CapCut auto captions: https://www.capcut.com/tools/auto-caption-generator
- Descript AI tools: https://help.descript.com/hc/en-us/articles/27252457732237-AI-Tools-Overview

Patterns to keep:
- Animated caption presets.
- Auto zooms and jump cuts.
- Silence/filler removal.
- Contextual B-roll, GIFs, emojis, sound effects, and background music.
- Brand/template presets so clips look consistent.

Repo status:
- Caption burn-in exists.
- Screenshot-card rendering exists.
- TTS exists.

Next useful improvement:
- Add `edit_style` presets in `config.yaml`: clean, streamer, sports, debate-card.
- Add silence removal and punch-in zoom effects in `cut.py`.
- Add optional royalty-free B-roll/GIF overlays for screenshot cards and explainers.

### Trend Discovery

Tools/data studied:
- TikTok Creative Center trends: https://ads.tiktok.com/creative/creativeCenter/trends
- TikTok Trends docs: https://ads.tiktok.com/help/article/how-to-use-trends
- TrendTok: https://apps.apple.com/us/app/trendtok-analytics-tracker/id1550778062
- vidIQ keyword/trend tools: https://vidiq.com/features/keyword-tools/
- Exploding Topics: https://explodingtopics.com/

Patterns to keep:
- Separate trend inputs from source-footage rights.
- Track hashtags/sounds/topics by category, region, and timeframe.
- Use trend sources as demand signals, then find a safe source or render a commentary card.

Repo status:
- Reddit/RSS/manual trend lane exists.
- LLM triage now adds hooks, source-search queries, comment angles, and safety flags.

Next useful improvement:
- Add manual CSV/API imports for TikTok Creative Center, TrendTok, vidIQ, and Exploding Topics exports.
- Add a daily "trend brief" panel summarizing top topics/sounds/hashtags before rendering.

### Posting / Scheduling

Tools studied:
- Ayrshare posting API: https://www.ayrshare.com/docs/apis/post/post
- Buffer TikTok scheduling: https://buffer.com/tiktok
- Repurpose.io: https://repurpose.io/
- Metricool Reels scheduling: https://metricool.com/schedule-reels-with-metricool/

Patterns to keep:
- One-click publish across platforms when credentials are connected.
- Queue/schedule approved posts instead of posting all at once.
- Store post history and failed-post reasons.
- Consider a unified posting API only if native platform auth becomes too annoying.

Repo status:
- Native YouTube, Instagram, and TikTok posting paths exist.
- Dashboard shows readiness chips and guarded post button.
- `clip schedule` adds posting order suggestions.

Next useful improvement:
- Add an optional `AYRSHARE_API_KEY` adapter as a fallback publisher. This could simplify multi-platform posting if native API setup gets painful.

## Priority Build Backlog

1. **Credential setup helpers**
   Add `clip auth youtube` and `clip auth tiktok` commands that guide setup and verify env/token files.

2. **Trend brief**
   A dashboard section that shows top daily topics, likely safe formats, source-search hints, and suggested manual sources.

3. **Edit presets**
   Add selectable render styles: streamer/gaming, sports, pop-culture debate, clean commentary.

4. **Motion/face/action scoring**
   Sample source frames before LLM scout; skip visually dead sections and bias toward reactions, scoreboards, gameplay, and crowd/event moments.

5. **Ayrshare adapter**
   Optional unified publisher if platform-native OAuth becomes too much maintenance.

6. **Performance feedback loop**
   Pull post performance once available and train ranking from real views, retention, comments, saves, and shares.
