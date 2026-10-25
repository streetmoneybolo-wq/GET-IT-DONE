# stockmarketloop.com: Videos-tab SEO module, site sweep, and the Website Dev command center

Date: 2026-10-25. Scope: the Creator Studio → Videos tab SEO module (the card in the
owner's screenshot), a sweep of the public site for bugs and errors, and the new
owner/admin-only **EVOLVE → Website Dev** command center.

## 1. The Videos-tab SEO module (SEO 77/100 · Metadata & SEO · Google / Bing index check · Request indexing)

### Where it lives

The module is rendered by the live plugin **StockMarketLoop Video Upload Studio 3.8.11**
(`sml-video-upload-studio-v381/sml-video-upload-studio`), whose REST namespace
`sml-creator-videos/v1` exposes exactly the routes behind those buttons:

| Button / text in the card | What it calls |
| --- | --- |
| SEO 77/100, "In the video sitemap · schema ✓" | `GET /sml-creator-videos/v1/list` (score and flags per video) |
| Metadata & SEO | `POST /sml-creator-videos/v1/update` (title, description, tags, thumbnail via `/thumbnail`) |
| Google index check ↗ / Bing index check ↗ | outbound links (a `site:`/`url:` search for the watch URL) |
| Request indexing | `POST /sml-creator-videos/v1/request-index` → refreshes `/sml-video-sitemap.xml` and pings IndexNow (`api.indexnow.org`) |

The plugin's source is **not** in `GET-IT-DONE` or `SML-Plugins`; it is only on the live
site (and possibly in the `StockMarketLoop` repository, which this session was not
allowed to attach). So the module was verified from the outside, end to end, against
what each button claims to do.

### What checks out

- `/sml-video-sitemap.xml` answers 200, is listed in `robots.txt` and the Rank Math index,
  and contains the video with `<video:video>` metadata (title, description, thumbnail,
  content URL, `lastmod` 2026-09-25).
- The watch page `/watch/88kbaonkfnj1/…/` answers 200 with a self canonical, Open Graph
  `video.other` tags and a `VideoObject` JSON-LD block (name, description, thumbnail,
  uploadDate, contentUrl, embedUrl, duration PT10M32S). "schema ✓" is true.
- The status text ("Requested · sitemap pinger · IndexNow HTTP 200 … Bing was pinged") is
  consistent with the IndexNow plugin 1.0.4 being active and the Loop Letters Studio
  serving an IndexNow key.
- Unauthenticated calls to `/list`, `/request-index` and the creator dashboard are
  refused (401), so the buttons are properly creator-gated.

### What is broken: the page tells Google not to index it

The public watch page is served with

```html
<meta name="robots" content="noindex, nofollow" />
```

printed right after the `<!-- /sml-ga4-creator -->` block (it is not Rank Math's tag, which
is `index, follow, max-image-preview:large` on every other page). The same video is in the
video sitemap and the card says "Google reads the video sitemap … it was refreshed; Bing
was pinged". Google will fetch the URL, see `noindex`, and drop it; Bing will do the same
after the ping. **"Request indexing" therefore cannot work for any video while this tag
is printed**, and the "SEO 77/100 · In the video sitemap" score is misleading because
indexability is the one thing that matters most and it is failing.

`nofollow` also stops link equity flowing from the watch page to the channel, the site
and the Academy.

Likely source: one of the watch-page plugins (Video Upload Studio, Watch Index, Watch
Recommendations, or the AdSense "thin screens" noindex work noted in
`CODEX-HANDOFF-ACADEMY-FINISH.md`). The fix is in that plugin: print `noindex` only for
unlisted/private videos, `index, follow` for public ones. Until then the Website Dev
plugin's **Sitemap URLs are indexable** and **Video pages: indexable with VideoObject**
checks will show this as a failing check with the conflicting URL, so it is visible every
hour rather than discovered by accident.

### Other observations on the module's data

- The Loop Channel API (`/sml-channel/v1/channel/grandmasterobi`) reports `stats.videos: 0`
  and an empty `videos` list while the owner's public video is in the video sitemap under
  `creator_handle: grandmasterobi`. The channel page therefore shows **0 VIDEOS** and an
  empty "Latest content" orbit for a channel that has a published video. Either the video's
  visibility is not `public` in the library (then it should not be in the sitemap either),
  or the channel API's creator match misses it. Worth checking in the Videos tab: the
  video's visibility and its creator attribution.

## 2. Site sweep

### How it was done, and a limit to be honest about

- `curl` fetches of the home page, Loop Letters, the channel page, the watch page,
  `/markets/`, `/creators/`, every sitemap (30) and the REST index (201 namespaces).
- A headless Chromium crawl (Playwright) over a sample of every sitemap. The host's bot
  challenge ("Checking your browser…", `/__challenge`) blocked the first full run; a
  slower one-page-at-a-time run got through on 7 pages before the site began answering
  **429 Too Many Requests** to this sandbox's IP. In addition, this sandbox's outbound
  proxy failed many subresource loads (`ERR_TOO_MANY_RETRIES`), which produced cascading
  script errors (`wp is not defined`, `reading 'hooks'`) that are **artifacts of the
  sandbox, not site bugs**. They are listed below as unverified and were not acted on.
- Static checks of everything the site serves from this repository: `php -l` on every
  plugin and WPCode snippet, `node --check` on every script in `js/` and
  `plugins/*/assets/`. All pass.

This is exactly the gap the Website Dev plugin closes: its beacon reports real errors from
real visitors' browsers, on the live site, with no crawler and no rate limit.

### Verified findings

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| 1 | Public watch page is `noindex, nofollow` while in the video sitemap | §1 above | **Open (live plugin)** |
| 2 | Channel API reports 0 videos for a channel with a public video | `sml-channel/v1/channel/grandmasterobi` → `stats.videos 0`, `videos []` | Open (live plugin) |
| 3 | `/creator-studio/` and `/go-live/` answer a bare nginx **403** to signed-out visitors instead of the sign-in flow | curl with a browser UA, 146-byte nginx page | Open (host rule or gate) |
| 4 | The 404 page weighs **~505 KB** of HTML (the full home-feed shell) and loads 36+ resources; a wrong link costs more than the home page | `/studio/` and `/watch/` 404s, 503–505 KB | Open (theme/home-feed) |
| 5 | `/markets/` renders **72 images without alt text** (letter covers) and two `<h1>` | headless DOM audit | **Fixed in this branch** (alt text; see below) |
| 6 | Logo API returns 404 for ETFs (`/api/logo/IWM`, `/api/logo/SPY`) on options-flow articles | `stockmarketloop-loop-kick.onrender.com/api/logo/{sym}` → 404 | Open (StockMarketLoop repo, loop-kick) |
| 7 | First-byte time of uncached pages is **1.2–2.1 s** (home 2.06 s, channel 2.07 s, watch 1.67 s); edge-cached repeats are 0.34 s | curl timings | Observation; the Speed tab will show p75 TTFB per route |
| 8 | A REST route `GET /sml-debug/v1/do-update` is registered with no arguments | REST index | Review: confirm it is admin-only and remove it when the debug is done; a GET that changes state is a footgun |
| 9 | 180 of 214 installed plugins are active; several are the same plugin twice (e.g. "SML Google News & Video Sitemaps" 1.1.0 active and inactive copies, three "SML Group Channel Admin" variants) | WordPress.com plugin list | Review; the Health tab's "Active plugins" check flags any plugin active twice |
| 10 | Loaders pin **three different** GET-IT-DONE revisions on jsDelivr (`ef703a9…`, `70bf7ed…`, `e4582f2…`) | home, channel, studio HTML | Drift; the CDN pins check reports it every hour |

### Unverified (sandbox artifacts, listed for completeness)

- `wp is not defined`, `Cannot read properties of undefined (reading 'hooks' / 'i18n' /
  '__' / 'setLocaleData')`, `t(...) is not a function` on article pages: all downstream of
  Gutenberg's `hooks` / `i18n` scripts failing to load through this sandbox's proxy.
- `Cannot read properties of undefined (reading 'iNn')` on options-flow articles (×5): a
  minified identifier; could not be attributed without a clean network. The beacon will
  report it with its source file and line if it is real.
- 429s on `sml-members/v1/ticker-search` and `sml-signal-news/v1/tape`: caused by this
  crawl's own request volume.

### Fix shipped in this branch

- `plugins/sml-markets-desk-index` 1.0.1: every letter cover image now carries `alt` text
  (the letter title), so the 72 unlabeled images on `/markets/` become labeled.

## 3. The Website Dev command center (`plugins/sml-website-dev`, 1.0.0)

Administrators and owners (anyone with `manage_options`) see an **EVOLVE** button at the
bottom right of every page; nobody else sees it, and every REST route checks the
capability again. It opens the **Website Dev** panel (also under Tools → Website Dev in
wp-admin; shortcut Ctrl+Shift+E):

- **Live bugs**: every distinct bug in the window, counted, with resolve/regressed; a live
  stream that refreshes every 8 s. Sources: the visitor beacon (script errors, unhandled
  promises, failed fetch/XHR, broken assets, accessibility counts) and the server (PHP
  warnings and fatals, REST 4xx/5xx, 404s with the referring page).
- **Speed**: Core Web Vitals (LCP, INP, CLS, TTFB) at p75 per route graded on Google's
  lines; server generation time, query count and peak memory per route; REST latency and
  5xx rate.
- **Health**: hourly checks with the fix for each: watched pages, jsDelivr pins, robots.txt
  and every sitemap, a sample of sitemap URLs for noindex / canonical / VideoObject
  conflicts, REST namespaces that vanished (the WPCode outage signature), the IndexNow key
  file, cron, duplicate active plugins, PHP runtime, database.
- **SEO & Index**: the index checks and the Google / Bing index-check links, site-wide.
- **Evolve**: the engine. A daily digest; knobs on rails the engine turns from the evidence
  (and the owner can pin); a brief with three to seven proposals, each with evidence,
  change, effect, risk and size (rules brief always; Claude's brief on top when an
  Anthropic key is configured); approve / dismiss / shipped; a learning loop that measures
  each shipped change a week later and re-weights the areas it proposes in.
- **Competitors**: what the site can do today (from its own REST namespaces), what
  TradingView, Discord, Robinhood, Twitch, YouTube, Substack, Patreon, Public, Webull and
  StockTwits shipped (their public product feeds), each headline turned into a gap or a
  "go further" idea, with "Add to proposals".
- **Settings**: beacon on/off, watched pages, competitor feeds, brief hour, model, key.

Install: upload `plugins/dist/sml-website-dev-1.0.0.zip` (Plugins → Add New → Upload),
activate, press EVOLVE, then "Run checks now" and "Run brief now". Details, privacy notes
and the test harness (62 assertions) are in `plugins/sml-website-dev/README.md`.
Never paste it into WPCode.
