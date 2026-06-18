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

Local helper commands:

```bash
clip auth youtube --client-secret ~/Downloads/client_secret.json
clip auth youtube --login
clip auth status
```

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

Local helper command:

```bash
clip auth tiktok --client-key ... --client-secret ... --access-token ... --open-id ...
clip auth status
```

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

### Editor MCPs and API Renderers

Tools studied:
- Palmier Pro: https://www.palmier.io/ and https://github.com/palmier-io/palmier-pro
- Descript API/MCP: https://help.descript.com/hc/en-us/articles/43370311322509-Descript-API and https://help.descript.com/hc/en-us/articles/46056322186509-Descript-MCP-overview
- Premiere Pro MCP: https://github.com/leancoderkavy/premiere-pro-mcp
- DaVinci Resolve MCP: https://github.com/samuelgursky/davinci-resolve-mcp
- Shotstack: https://shotstack.io/product/video-editing-api/
- Creatomate: https://creatomate.com/
- JSON2Video: https://json2video.com/
- Remotion: https://www.remotion.dev/docs/api
- Runway API: https://docs.dev.runwayml.com/

Recommended integration posture:
- Keep `ffmpeg` as the default renderer. It is local, cheap, deterministic, and already gets clips into the dashboard.
- Use Palmier Pro as a manual/agentic timeline-polish lane when the owner wants to refine a specific approved clip with generated b-roll, sound, or detailed timeline edits. Palmier exposes a local MCP server when the app is open, which makes it a good optional companion rather than a mandatory pipeline dependency.
- Use Descript as the best near-term hosted AI editor candidate. Its API/MCP can import media, run Underlord edits, add captions, remove filler words, apply Studio Sound, create highlight reels, and publish web links. Its current limitation is that local file export may still require a web-link/signed-url workflow or manual export.
- Treat Premiere Pro and DaVinci Resolve MCPs as advanced power-user options. They are valuable if the owner already edits in those apps, but they add desktop app complexity that is not needed for daily faceless short clips.
- Treat Shotstack, Creatomate, and JSON2Video as cloud renderer fallbacks for template-driven formats or high-volume rendering. They are less useful than local ffmpeg until we need bulk template renders or server-side scaling.
- Treat Runway as a generative b-roll/video-edit provider, not as the core editor. Use it when source footage is unavailable, rights are risky, or a card/explainer needs generated filler visuals.

Repo status:
- Added optional integration readiness tracking in `clipper/pipeline/integrations.py`.
- Added `clip integrations` to print editor/render/publisher readiness.
- Dashboard now shows optional AI editing integrations separately from platform posting credentials.
- Added `clip polish --clip-id N --provider palmier_pro|descript|runway` to create local handoff packages for external editor polish.
- Dashboard clip cards can create Palmier or Descript handoff packages and record the package path on the clip.

Next useful improvement:
- Add an `external_render_provider` field on clips so the dashboard can show whether a video came from local ffmpeg, Descript, Palmier, or a cloud renderer.
- For Palmier, upgrade the handoff package into a direct MCP action after the local MCP server is available.
- For Descript, build an import/edit/publish adapter after a token or MCP connector is available.

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
- `clip brief` and the dashboard daily trend brief now group open opportunities into render-now, source-review, blocked-signal, source-search, and next-action lanes.
- `clip import-trends path/to/export.csv --source tool-name` imports CSV/TSV exports from external trend tools into the same rights-gated review queue.

Next useful improvement:
- Add direct API/scraper adapters only for exports that prove useful repeatedly; keep CSV import as the default bridge.

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
