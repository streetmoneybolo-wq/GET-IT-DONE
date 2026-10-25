# SML Website Dev

The owner's command center for stockmarketloop.com. Administrators (anyone with
`manage_options`) see an **EVOLVE** button at the bottom right of every page;
it opens the **Website Dev** panel. Nobody else sees the button, the panel, or
any of its data: every REST route checks the capability again.

The same panel lives under **Tools → Website Dev** in wp-admin, for the day the
front end itself is what is broken. Shortcut on the front end: `Ctrl+Shift+E`.

## What it shows

| Tab | What is in it | Where it comes from |
| --- | --- | --- |
| **Live bugs** | Every distinct bug of the last 1 h to 7 days, counted, newest activity first, with a resolve button; a live stream that refreshes itself every 8 s. | Browser beacon (script errors, unhandled promises, failed fetch/XHR, broken assets, accessibility counts) and the server (PHP warnings, PHP fatals, REST 4xx/5xx, 404s). |
| **Speed** | Core Web Vitals (LCP, INP, CLS, TTFB) at p75 graded on Google's lines, per route; server generation time, query count and peak memory per route; REST route latency and 5xx rate. | Beacon samples (rate is a knob) plus the shutdown hook on every page and REST request. |
| **Health** | Hourly checks with ok / warn / fail and the fix for each. | `includes/checks.php`, run from cron and the "Run checks now" button. |
| **SEO & Index** | The index-related checks, the indexability conflicts, and the same Google / Bing index-check links the Creator Studio Videos tab has, site-wide. | Health run. |
| **Evolve** | Health score, the daily brief, proposals (approve / dismiss / shipped), knobs with rails and pin, learned area weights, measured outcomes, recent turns. | `includes/evolve.php`. |
| **Competitors** | What this site can do today (from its REST namespaces), what the competition shipped (public product feeds), each headline turned into a gap or a parity-plus idea, "Add to proposals". | `includes/competitors.php`. |
| **Settings** | Beacon on/off, watched pages, competitor feeds, brief hour, model, API key. | Options. |

### The health checks

- Each watched page: status, time to first byte, size, robots meta, http:// assets.
- The jsDelivr pins printed by the loaders: every pinned asset must answer; many distinct pins means drift.
- `robots.txt` and every sitemap it names plus the Rank Math index: each must answer and hold URLs.
- A sample of URLs from each sitemap: must be 200, must not say `noindex` (meta or `X-Robots-Tag`), must canonicalise to itself; video sitemap URLs must carry `VideoObject`. **This is the check that catches the case where the Videos tab says "In the video sitemap · schema ✓" while the page says noindex, so "Request indexing" can never work.**
- REST namespaces: a namespace that was there last run and is gone now is a plugin or WPCode snippet that died (the outage signature documented in `wpcode/README.md`). The `sml-channel/v1` route is probed directly for that reason.
- IndexNow key file (`/{key}.txt`), WP-Cron overdue events, the same plugin active twice, PHP memory limit and `WP_DEBUG_DISPLAY`, the database's last error.

### The Evolve engine

The same shape as the Academy's engine (`services/sml-platform/platform/academy-evolve.js`):

1. **Digest**: the last 24 hours of errors, vitals, server timings, checks and competitor reads, bounded.
2. **Knobs**: `beaconSampleRate`, `checkIntervalMin`, `retentionDays`, `competitorScanHours`, `sitemapSample`. Each on a rail; the engine turns them from the evidence and writes down why; the owner can pin any of them.
3. **Brief**: daily in the quiet hour (and on "Run brief now"). The rules brief always runs and is grounded in the digest's numbers. With an Anthropic key, Claude's reading of the same digest is added on top. Proposals carry evidence, the change, the effect, risk, size and area. Small, low-risk proposals marked `auto` are approved on arrival.
4. **Learning loop**: marking a proposal shipped snapshots its area's metric; a week later the engine measures the change and nudges that area's weight (0.5–2.0). Proposals are ordered by impact × weight, so what it proposes next leans toward what has paid off on this site.

### Privacy and cost

The visitor beacon sends to this site only. It stores URL paths, never query strings; no cookies are read, no ids, no names. Errors are always reported (three of the same per page view at most, 25 events per page view); Web Vitals are sampled at the knob rate; the accessibility count runs on one sampled view in ten. Everything is pruned on a schedule (`retentionDays`; raw samples after two days). A `/beacon` request is rate-limited per IP (120 per minute), same-origin only, and capped at 24 KB.

The server capture records and steps aside: `set_error_handler` returns `false`, the REST filters return the response untouched, the shutdown function only reads. It never changes how a request is answered.

## Install

1. Build the zip (or take `plugins/dist/sml-website-dev-1.0.0.zip`):
   ```bash
   cd plugins && zip -rq dist/sml-website-dev-1.0.0.zip sml-website-dev -x '*.DS_Store' 'sml-website-dev/tests/*'
   ```
2. Plugins → Add New → Upload → Activate. Activation creates the `wp_sml_wd_events` table and schedules the cron events.
3. Optional, for the written brief: add to `wp-config.php`
   ```php
   define( 'SML_WD_ANTHROPIC_KEY', 'sk-ant-…' );
   ```
   or paste the key once under Settings in the panel (stored as an option, never echoed back).
4. Open any page as an administrator and press **EVOLVE**. Press **Run checks now** on Health, then **Run brief now** on Evolve.

This is a real plugin. **Never paste it into WPCode**: it registers a shutdown function and an error handler, and WPCode merges every "Run Everywhere" snippet into one `eval()` (see `wpcode/README.md`).

## Tests

```bash
php tests/harness.php
for f in sml-website-dev.php includes/*.php; do php -l "$f"; done
```

The harness covers the pure logic: path and route normalisation, fingerprinting, the beacon sanitiser, percentiles and grades, the health score, knob rails, the learning weights, the rules brief and the competitor idea mapping.
