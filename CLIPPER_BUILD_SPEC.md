# Faceless Clip Pipeline — Build Spec

A local-first, near-zero-input pipeline that pulls trending source clips, finds the best moments, cuts vertical clips with burned-in captions + an AI voiceover that *adds* context, packages per-platform metadata, drops everything in a review dashboard, and posts to YouTube / Instagram / TikTok on approval.

Owner runs it daily. Daily human effort target: **~5 minutes** (approve queue + tap TikTok publish on phone).

---

## 0. Strategy decisions (locked — do not re-litigate)

- **Model:** Faceless, AI-voiceover. The voiceover ALWAYS adds information the source footage didn't have (ranking, context, "why it matters"). It NEVER just narrates what's on screen. This is the suppression defense and the monetization unlock — it is non-negotiable in the prompt design.
- **Niche bias (chosen):** **Funny and viral moments across streamers, gaming, sports, pop culture, and internet culture.** Rationale: the channel should feel like a fast, faceless commentator on what the internet is laughing at or arguing about today, not a narrow tech/AI page. The system chases broad viral demand while still using rights gates before rendering.
- **Format priority:** (1) Ranked list ("3 things everyone missed about X"), (2) Context explainer over footage. Both are fully scriptable by AI with zero owner input.
- **Trendjacking lane:** In addition to long-form source clipping, the system should find proven/trending moments that already have demand: iconic streamer/YouTuber moments, official event clips, evergreen funny clips, sports/pop-culture discourse, gaming arguments, and same-day Reddit/X threads. This is a signal + packaging lane, not a license to rip. The system can render screenshot/commentary cards for public posts and can queue official/licensed/owned clips, but ambiguous movie/sports/concert/streamer footage requires owner rights review before rendering.
- **Posting reality:**
  - YouTube Shorts → official Data API v3 → fully automated. ✅
  - Instagram Reels → Graph API (requires Business/Creator account linked to a FB Page) → fully automated. ✅
  - TikTok → Content Posting API. Unaudited app = **draft/SELF_ONLY only**; owner taps publish in-app (~10s/clip). Build the audited `direct-post` path behind a feature flag for later. ✅(with manual tap)
- **Legal posture:** Source list biased to clip-encouraged / CC / news-commentary sources. Transformative voiceover layer is mandatory. No re-uploading raw viral clips. A `SOURCES.md` allowlist gates ingestion — nothing gets clipped unless its source is on the allowlist. `TREND_SOURCES.md` separately gates trendjacking opportunities and classifies each as `allowed`, `review_required`, or `blocked`.
- **No independent-creator ripping:** The system must not repost an independent TikTok/Reels/Shorts creator's viral video just because it is working. It can use that as a signal to find an official/licensed alternative or make a commentary/screenshot card if the source is a public text post and attribution is visible.
- **Clipping-account reposts:** A viral post from another clipping account can be used as proof that demand exists, especially when that account added no commentary or editing value. It still does not prove rights to the underlying footage. Treat it as `clipping_account_repost` / `review_required`: find the original/official source, confirm the clip is licensed/owned/public-domain/official, or transform the idea into a screenshot/commentary card.

---

## 1. Architecture

```
            ┌─────────────────────────────────────────────────┐
            │            orchestrator (CLI: `clip run`)         │
            └─────────────────────────────────────────────────┘
                                  │
   0 TREND ──► 1 SOURCE ──► 2 INGEST ──► 3 SCOUT ──► 4 CUT ──► 5 PACKAGE ──► 6 REVIEW ──► 7 POST
   Reddit/X     watchlist     yt-dlp +     Claude      ffmpeg     Claude        local web    YT API
   discourse    poll          whisper.cpp  picks       vertical   per-platform  dashboard    IG API
   + iconic     (allowlist)   transcript   moments +   + captions captions +    approve/     TikTok
   moments                               writes      + TTS VO    hashtags      reject       (draft)
   rights-gated                          VO script
```

**Tech stack (all local, all free/cheap):**
- **Language:** Python 3.11 + FastAPI (orchestrator + review dashboard). Matches owner's stack.
- **Download:** `yt-dlp`
- **Transcribe:** `whisper.cpp` (or `faster-whisper`) — local, free, word-level timestamps. Fast on Apple Silicon.
- **Brain (trend triage + scout + packaging + dashboard assist):** Claude API (`claude-opus-4-7` for scout judgment, `claude-sonnet` for packaging/triage/rewrites to save cost).
- **Cut/render:** `ffmpeg` + `ffmpeg-python`. Captions via ASS subtitle format (animated word-by-word).
- **TTS voiceover:** ElevenLabs API (best quality) OR local `kokoro`/`piper` (free). Default to a free local TTS, ElevenLabs behind a flag.
- **Queue/state:** SQLite (`clips.db`). Dead simple, no server.
- **Dashboard:** FastAPI + a single HTML page (HTMX or vanilla). Runs at `localhost:8765`.
- **Scheduler:** `cron` (Mac/Linux) or just run `clip run` manually.
- **Optional external AI/video tools:** Palmier Pro MCP or Descript API/MCP for timeline polish; Shotstack/Creatomate/JSON2Video for cloud/template renders; Runway for generated b-roll; Ayrshare for unified posting fallback. These are optional provider slots, not core dependencies.

**Repo layout:**
```
clipper/
├── clip.py                 # CLI entrypoint (run, review, post, status)
├── config.yaml             # all tunables
├── SOURCES.md              # allowlist of approved sources (HUMAN-EDITED ONLY)
├── TREND_SOURCES.md        # allowlist of trend/discourse sources + rights labels
├── pipeline/
│   ├── trend.py            # find trendjacking opportunities, rights-gated
│   ├── source.py           # poll watchlist, find trending candidates
│   ├── ingest.py           # yt-dlp download + whisper transcribe
│   ├── scout.py            # Claude: pick moments + write VO script, optionally with sampled frames
│   ├── cut.py              # ffmpeg: vertical reframe, captions, VO mux
│   ├── package.py          # Claude: per-platform captions + hashtags
│   ├── schedule.py         # posting order suggestions
│   ├── ai.py               # shared Anthropic JSON/multimodal helper
│   ├── learning.py         # approval/rejection feedback profile
│   └── post.py             # YT / IG / TikTok publishers
├── dashboard/
│   ├── app.py              # FastAPI review UI
│   └── templates/
├── prompts/
│   ├── scout.md            # the virality + transformation prompt
│   └── package.md          # per-platform metadata prompt
├── clips.db                # SQLite state
├── data/
│   ├── downloads/          # raw source (gitignored, auto-purged)
│   ├── clips/              # rendered finals
│   └── transcripts/
└── .env                    # API keys (gitignored)
```

---

## 2. Stage-by-stage spec

### Stage 1 — SOURCE (`pipeline/source.py`)
- Read `SOURCES.md` allowlist (YouTube channels/playlists, podcast RSS, subreddits with CC content, etc.).
- For each source, pull recent uploads (last N hours) via `yt-dlp --flat-playlist` + RSS.
- **Trend signal:** rank candidates by velocity (views/hour since publish), not just raw views. A 50k-view video that's 3 hours old beats a 2M-view video that's 2 weeks old. This is how you "chase trends" *within* the niche.
- Dedup against `clips.db` (never process the same source video twice).
- Output: ranked list of candidate source URLs → write to `candidates` table.

### Stage 0 — TREND (`pipeline/trend.py`)
- Read `TREND_SOURCES.md` allowlist. Supported inputs:
  - `reddit_hot` / `reddit_top`: subreddits whose posts/comments are useful conversation starters.
  - `rss`: feeds for news/discourse sources or Reddit RSS.
  - `manual_url`: one-off X/Twitter, Reddit, official clip, licensed clip, or evergreen moment URL that the owner wants tracked.
- Discover same-day opportunities and score by recency + engagement velocity:
  - Reddit: upvotes, comments, age.
  - RSS/manual: recency plus optional manually supplied score/comment signals.
- Classify every opportunity by `source_kind`:
  - **Allowed:** `social_text`, `reddit_discussion`, `official_clip`, `licensed_clip`, `public_domain_clip`, `creator_owned_clip`, `news_article`.
  - **Review-required:** `streamer_clip`, `movie_clip`, `sports_highlight`, `concert_clip`, `random_video`, `viral_clip`, `reddit_linked_video`.
  - **Review-required repost signal:** `clipping_account_repost`.
  - **Blocked:** `independent_creator_repost`, `raw_tiktok_repost`, `private_person_video`.
- Output to `trend_opportunities` table with:
  - `trend_score`, `rights_status`, `recommended_format`, `treatment`, `evidence_json`.
- If `ANTHROPIC_API_KEY` is present, enrich each opportunity with:
  - stronger hook/treatment and conversation prompt,
  - source-search queries for original/official/licensed alternatives,
  - comment-mining angle for Reddit/X-style discussion,
  - safety/rights flags.
- Approval/rejection history lightly adjusts trend scores so the queue learns owner taste without hiding the underlying evidence.
- Recommended formats:
  - `screenshot_card`: for X/Twitter-style posts, Reddit posts/comments, or news/discourse snippets. Must include visible attribution, background music, and a value-add caption/VO/question.
  - `commentary_clip`: only for official/licensed/public-domain/owned clips, with transformative VO. These are queued as source media and run through ingest/scout/cut before a full source-footage video appears in review.
  - `rights_review`: owner must confirm source rights or replace with official/licensed source.
  - `do_not_repost`: blocked; use only as a trend signal.

### Stage 2 — INGEST (`pipeline/ingest.py`)
- `yt-dlp` download top K candidates (config: `max_daily_ingest`, default 5) at 1080p.
- Transcribe with whisper.cpp → word-level JSON timestamps → `data/transcripts/`.
- Store transcript + metadata in `clips.db`.
- Auto-purge `downloads/` older than 48h to save disk.

### Stage 3 — SCOUT (`pipeline/scout.py`) ← the core IP
- Feed full transcript (with timestamps) to Claude using `prompts/scout.md`.
- Claude returns JSON: ranked list of clip candidates, each with:
  - `start`, `end` (exact timestamps, self-contained 20–60s moment)
  - `format`: `"ranked_list"` | `"context_explainer"`
  - `hook`: the first-3-seconds hook line
  - `vo_script`: the full voiceover script — **MUST add context/ranking/analysis the footage lacks**, timed to fit the clip
  - `variants`: alternate hooks/VO angles for dashboard editing
  - `safety_review`: rights/context/brand-safety flags
  - `virality_score`: 0–100
- If source media is still available, the scout can sample a few frames and send them with the transcript so visual jokes, gameplay state, streamer reactions, scoreboards, and event context influence clip selection.
- Take top N per source (config: `clips_per_source`, default 1–2).
- **Quality gate:** discard anything with `virality_score < 70` or where `vo_script` merely restates on-screen content (the prompt enforces a self-check).

### Stage 4 — CUT (`pipeline/cut.py`)
- `ffmpeg`: trim to [start, end], scale/crop to 1080×1920 (9:16). Smart-crop toward motion/face center if detectable; else center.
- Generate TTS audio from `vo_script` → duck the original audio under the VO (sidechain compress) so both are audible but VO leads.
- Burn in **word-level animated captions** (ASS format, karaoke `\k` timing from whisper words for original speech; styled bold captions for VO segments). Big, high-contrast, safe-zone-aware (avoid platform UI overlap zones).
- Add a 0.5s hook text card at the very start (the `hook` line) — drives 3-second retention.
- Output final MP4 → `data/clips/` + register in `clips.db` with status `pending_review`.
- For `screenshot_card` trend opportunities, render a vertical card instead of source footage:
  - screenshot or reconstructed text card with visible source/author attribution,
  - subtle background motion/music,
  - optional VO that adds context/stakes,
  - comment-bait prompt that invites disagreement without fabricating facts.
  - approved screenshot-card trends become normal `clips` rows with rendered MP4s and platform metadata, so they enter the same review/post path as source clips.
- For actual source-footage trend clips, add or approve an official/licensed/owned/public-domain media URL. The dashboard queues it as a source candidate; `clip run` downloads, transcribes, scouts, cuts, and then shows the full rendered video in review.
- Optional external polish is allowed after local render:
  - Palmier Pro MCP: send source MP4, rendered MP4, VO script, captions, and b-roll prompts for timeline-level polish.
  - Descript API/MCP: import rendered/source media for Underlord edits such as captions, Studio Sound, filler removal, and highlight variations.
  - Cloud render APIs: use only for template/card scaling when local ffmpeg becomes a bottleneck.
  - The dashboard must always show the final MP4, regardless of which renderer produced it.
- `clip polish --clip-id N --provider palmier_pro|descript|runway` creates a local handoff package in `data/polish/` with `manifest.json`, `brief.md`, platform metadata, source context, and optional media copies.

### Stage 5 — PACKAGE (`pipeline/package.py`)
- Feed clip context to Claude using `prompts/package.md`. Returns per-platform metadata:
  - **YouTube Shorts:** title (≤100 char, hook-forward), description (with 3–5 hashtags inline), tags.
  - **TikTok:** caption (native, casual, hook-first), 4–6 hashtags (mix: 1 broad, 2–3 niche, 1–2 trending).
  - **Instagram Reels:** caption (slightly more polished), 8–15 hashtags (IG rewards more), first-comment hashtag option.
- Also returns editable variants, a safety review, and a first-pass posting slot suggestion.
- Hashtag strategy per platform is researched/encoded in the prompt; refresh trending tags via a light web lookup monthly (manual config update, not per-run).
- Store metadata JSON in `clips.db`.

### Stage 6 — REVIEW (`dashboard/app.py`)
- `clip review` launches FastAPI at `localhost:8765`.
- Open the dashboard through the server URL (`http://127.0.0.1:8765`), not by opening `dashboard/templates/review.html` directly. The template file is not a standalone app.
- One page: card per `pending_review` clip showing:
  - Video player (the rendered MP4)
  - Open-full-video and download links for the rendered MP4
  - `virality_score`, safety flags, source-finding hints, variants, and posting plan
  - Editable captions/hashtags per platform (pre-filled; edit optional)
  - AI rewrite buttons: funnier, more debate-driving, shorter TikTok, safer
  - Per-platform toggles (post to YT? IG? TikTok?)
  - ✓ Approve  /  ✗ Reject buttons
- Top-level queue summary shows ready-to-review clips, approved clips, posted clips, and same-day trend ideas.
- Posting setup chips show whether YouTube, Instagram, and TikTok credentials are connected before the dashboard allows direct posting.
- Approve → status `approved`. Reject → `rejected` (+ optional reason to improve scout over time).
- **This is the owner's entire daily job.** ~5 min.

### Stage 7 — POST (`pipeline/post.py`)
- `clip post` or the dashboard's **Post approved** button publishes all `approved` clips:
  - **YouTube:** Data API v3 `videos.insert`, category/privacy/`madeForKids=false`, schedule or immediate. Fully auto.
  - **Instagram:** Graph API — create media container (Reels), poll status, publish. Fully auto. (Needs IG Business + linked FB Page + long-lived token.)
  - **TikTok:** Content Posting API. **Unaudited path:** `PULL_FROM_URL` or `FILE_UPLOAD` to draft/inbox (`SELF_ONLY`). System pushes a phone notification / prints a checklist; owner taps publish in TikTok app. **Audited path** (feature flag `tiktok_direct_post: true`): direct publish once app passes audit.
- Respect rate limits (TikTok: 6 req/min/token, ~15 posts/day; IG: 50 posts/day; YT: quota cost ~1600 units/upload, 10k/day default ≈ 6 uploads/day — request quota increase if scaling).
- Log results, update status `posted`, store post URLs.

---

## 3. The two prompts (most important files)

### `prompts/scout.md` (Claude = virality scout + transformation writer)
Core instructions to encode:
- Role: elite short-form editor for a faceless commentary channel in the {niche} lane.
- Input: full timestamped transcript of a trending source video.
- Find 1–3 self-contained 20–60s moments with the strongest hook + payoff.
- For each, write a voiceover script that ADDS a layer: a ranking, missing context, a "why this matters," or a contrarian-but-fair take. **Hard rule, self-checked:** if the VO just describes what's visibly happening, reject it and rewrite. The VO must make the clip more valuable than the original moment alone.
- Hook must land in <3 seconds and create an open loop.
- Output strict JSON (schema in Stage 3).
- Calibrate scores honestly — don't inflate. Better to return 1 great clip than 3 mediocre ones.

### `prompts/package.md` (Claude = per-platform growth metadata)
- Generate platform-native captions (YT title-driven, TikTok casual hook-first, IG polished).
- Hashtag mix rules per platform (broad/niche/trending ratios above).
- No clickbait that the clip doesn't deliver on (trust = retention = money).
- Output strict JSON.

---

## 4. API / account setup checklist (do in this order)

1. **YouTube Data API v3** — Google Cloud project → enable API → OAuth desktop credentials → run once to get refresh token. *Free.* (Optionally request quota increase later.)
   - Save/upload the downloaded OAuth JSON with `clip auth youtube --client-secret /path/to/client_secret.json`.
   - Then run `clip auth youtube --login` once to create `clipper/secrets/yt_token.json`.
2. **Instagram** — Convert IG to **Business/Creator** → link to a **Facebook Page** → Meta Developer app → Graph API → Instagram Content Publishing permission → long-lived access token. *Free, ~30 min, slightly fiddly.*
3. **TikTok** — developers.tiktok.com → create app → request `video.upload` (draft, instant) now; apply for `video.publish` (direct post) audit later (2–6 wks). *Free.*
   - Save OAuth values with `clip auth tiktok --client-key ... --client-secret ... --access-token ... --open-id ...`.
4. **Claude API** — console.anthropic.com → API key. *Pay per use; this pipeline is cheap — pennies per clip.*
   - Save locally with `clip auth anthropic`.
5. **TTS** — start with local `kokoro`/`piper` (free). ElevenLabs key optional for premium voice.
6. **Local tools** — `brew install yt-dlp ffmpeg` + build/install `whisper.cpp` (or `pip install faster-whisper`).

Put all keys in `.env`. Never commit it.

---

## 5. Daily operation (the whole owner workflow)

```bash
clip run        # trend discovery + stages 1–5. ~10–20 min unattended.
clip auth status # verify API/posting credentials without printing secrets
clip trends     # run only the trendjacking discovery lane
clip review     # opens http://127.0.0.1:8765. View full MP4s, approve/reject, optionally post.
clip schedule   # suggest posting order for approved clips
clip integrations # show optional AI editor/render/publisher readiness
clip polish --clip-id 1 --provider palmier_pro # create external editor handoff
clip post       # CLI fallback for approved clips. YT+IG auto; TikTok → tap publish on phone.
```
Or wire `clip run` to a morning cron job so the queue is ready when you wake up; you just review and post from the dashboard.

---

## 6. Build order for Claude Code (milestones)

- **M1 — Skeleton:** repo, `config.yaml`, SQLite schema, `clip` CLI with stub stages, `.env` loading. Verify `clip status` works.
- **M2 — Ingest path:** `source.py` + `ingest.py`. Get a real trending video downloaded + transcribed end to end.
- **M3 — Trend lane:** `trend.py` + `TREND_SOURCES.md` + `prompts/trend.md`. Find daily Reddit/X/official-clip opportunities, classify rights posture, and queue screenshot-card/commentary treatments without raw creator ripping.
- **M4 — Scout:** `scout.py` + `prompts/scout.md`. Feed a transcript, get back good clip candidates + VO scripts. Iterate on the prompt until clips are genuinely good.
- **M5 — Cut:** `cut.py`. Vertical reframe + burned captions + TTS VO muxing. This is the heaviest ffmpeg work — expect iteration. Render approved screenshot-card trend opportunities into vertical MP4s.
- **M6 — Package + Review:** `package.py` + dashboard. Full clip + trend queue visible and approvable.
- **M7 — Post:** YouTube first (easiest), then Instagram, then TikTok draft path.
- **M8 — Polish:** cron, auto-purge, reject-reason feedback loop, multi-account support (run the same pipeline for a 2nd niche/account — this is the real leverage).

Build and test each milestone before moving on. Use real content from `SOURCES.md` at every step.

---

## 7. Honest expectations (keep in head, then forget)

- $0 for ~1–3 months until you cross monetization thresholds (YT: 1k subs + 10M Shorts views/90d or 500+3M; TikTok Creativity: 10k followers, US; IG bonuses invite-only).
- Realistic single-account ceiling: low-thousands/mo after 6–12 months of *consistent* daily posting with real editorial quality.
- The leverage is **multiple accounts off one pipeline** (M7). That's why we built the machine instead of doing it by hand.
- The transformative VO layer is what keeps you out of the suppression bucket. Don't disable it to save effort — it IS the product.
